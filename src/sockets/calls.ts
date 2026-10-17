import { randomUUID } from "crypto";
import { Server, Socket } from "socket.io";
import { z } from "zod";
import { HttpError } from "../middleware/errorHandler";
import { getDisappearSeconds, memberIds } from "../repositories/chats";
import { saveMessage } from "../services/messages";
import { ensureMember, on, uuid } from "./helpers";
import { chatRoom, userRoom } from "./registry";

/**
 * WebRTC sinyalleşmesi. Medya sunucudan geçmez (P2P); sunucu yalnızca SDP/ICE mesajlarını iletir.
 * Karşı taraf çevrimdışı olsa bile arama çalar; yanıtlanmazsa sohbete ve arama geçmişine "Yanıtsız arama" düşer.
 */
interface Call {
  id: string;
  chatId: string;
  callerId: string;
  calleeId: string;
  kind: "audio" | "video";
  offer: { type: "offer" | "answer"; sdp: string };
  callerSocket: string;
  calleeSocket?: string;
  answeredAt?: number;
  timer: ReturnType<typeof setTimeout>;
}

const calls = new Map<string, Call>();
const RING_TIMEOUT_MS = 30_000;

const sdp = (type: "offer" | "answer") =>
  z.object({ type: z.literal(type), sdp: z.string().min(1).max(100_000) });

const inviteSchema = z.object({
  chatId: uuid,
  kind: z.enum(["audio", "video"]),
  offer: sdp("offer"),
});
const answerSchema = z.object({ callId: uuid, answer: sdp("answer") });
const iceSchema = z.object({
  callId: uuid,
  candidate: z.object({
    candidate: z.string().max(2000),
    sdpMid: z.string().max(64).nullable().optional(),
    sdpMLineIndex: z.number().int().nullable().optional(),
    usernameFragment: z.string().max(128).nullable().optional(),
  }),
});
const endSchema = z.object({ callId: uuid, reason: z.string().max(32).optional() });

const inCall = (userId: string) =>
  [...calls.values()].some((c) => c.callerId === userId || c.calleeId === userId);

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Arama sonlandığında sohbete yanıtsız arama veya görüşme özeti mesajı kaydeder. */
async function recordCallMessage(io: Server, call: Call, reason: string): Promise<void> {
  try {
    const icon = call.kind === "video" ? "📹" : "📞";
    const label = call.kind === "video" ? "görüntülü arama" : "sesli arama";
    let body: string;

    if (call.answeredAt) {
      const sec = Math.max(1, Math.round((Date.now() - call.answeredAt) / 1000));
      body = `${icon} ${call.kind === "video" ? "Görüntülü görüşme" : "Sesli görüşme"} · ${formatDuration(sec)}`;
    } else if (reason === "rejected") {
      body = `${icon} Cevapsız ${label} (reddedildi)`;
    } else {
      body = `${icon} Yanıtsız ${label}`;
    }

    const ttl = await getDisappearSeconds(call.chatId);
    const { message, duplicate } = await saveMessage({
      chatId: call.chatId,
      senderId: call.callerId,
      body,
      clientId: `call-${call.id}`,
      silent: false,
      attachments: [],
      expiresAt: ttl ? new Date(Date.now() + ttl * 1000) : null,
    });
    if (!duplicate) {
      io.to(chatRoom(call.chatId)).emit("receive_message", message);
    }
  } catch (err) {
    console.error("[call] arama kaydı mesajı yazılamadı:", err);
  }
}

function finish(io: Server, call: Call, reason: string, exceptSocket?: string): void {
  if (!calls.has(call.id)) return;
  clearTimeout(call.timer);
  calls.delete(call.id);
  const payload = { callId: call.id, chatId: call.chatId, kind: call.kind, callerId: call.callerId, calleeId: call.calleeId, reason };
  for (const uid of [call.callerId, call.calleeId]) {
    const target = io.to(userRoom(uid));
    (exceptSocket ? target.except(exceptSocket) : target).emit("call:ended", payload);
  }
  void recordCallMessage(io, call, reason);
}

function participant(call: Call | undefined, userId: string): Call {
  if (!call || (call.callerId !== userId && call.calleeId !== userId)) {
    throw new HttpError(404, "Arama bulunamadı");
  }
  return call;
}

export function registerCallHandlers(io: Server, socket: Socket): void {
  const userId = socket.data.userId as string;

  // Kullanıcı bağlandığında o sırada kendisine çalan aktif bir arama varsa hemen ilet
  for (const call of calls.values()) {
    if (call.calleeId === userId && !call.calleeSocket) {
      socket.emit("call:incoming", {
        callId: call.id,
        chatId: call.chatId,
        fromUserId: call.callerId,
        kind: call.kind,
        offer: call.offer,
      });
    }
  }

  on(socket, "call:invite", inviteSchema, async ({ chatId, kind, offer }, ack) => {
    await ensureMember(socket, chatId);
    const members = await memberIds(chatId);
    if (members.length !== 2) throw new HttpError(400, "Aramalar yalnızca birebir sohbetlerde yapılabilir");
    const calleeId = members.find((m) => m !== userId);
    if (!calleeId) throw new HttpError(400, "Aranacak kişi bulunamadı");
    if (inCall(userId)) throw new HttpError(409, "Zaten bir aramadasınız");
    if (inCall(calleeId)) throw new HttpError(409, "Kullanıcı meşgul");

    const calleeSockets = await io.in(userRoom(calleeId)).fetchSockets();
    const calleeOnline = calleeSockets.length > 0;

    const id = randomUUID();
    const call: Call = {
      id,
      chatId,
      callerId: userId,
      calleeId,
      kind,
      offer,
      callerSocket: socket.id,
      timer: setTimeout(() => {
        const c = calls.get(id);
        if (c && !c.calleeSocket) finish(io, c, "timeout");
      }, RING_TIMEOUT_MS),
    };
    calls.set(id, call);
    console.log(
      `[call:invite] id=${id} caller=${userId} callee=${calleeId} online=${calleeOnline} kind=${kind} sdpCandidates=${(offer.sdp.match(/a=candidate:/g) || []).length}`
    );
    if (calleeOnline) {
      io.to(userRoom(calleeId)).emit("call:incoming", { callId: id, chatId, fromUserId: userId, kind, offer });
    }
    ack({ ok: true, callId: id, calleeOnline });
  });

  on(socket, "call:answer", answerSchema, async ({ callId, answer }, ack) => {
    const call = participant(calls.get(callId), userId);
    if (call.calleeId !== userId) throw new HttpError(403, "Bu aramayı yalnızca aranan kişi yanıtlayabilir");
    if (call.calleeSocket) throw new HttpError(409, "Arama zaten yanıtlandı");
    clearTimeout(call.timer);
    call.calleeSocket = socket.id;
    call.answeredAt = Date.now();
    console.log(`[call:answer] id=${callId} sdpCandidates=${(answer.sdp.match(/a=candidate:/g) || []).length}`);
    // Aynı kullanıcının diğer cihazlarında çalan zil susturulur
    socket.to(userRoom(userId)).emit("call:ended", { callId, reason: "answered_elsewhere" });
    io.to(call.callerSocket).emit("call:answer", { callId, answer });
    ack({ ok: true });
  });

  on(socket, "call:ice", iceSchema, async ({ callId, candidate }, ack) => {
    const call = participant(calls.get(callId), userId);
    const toCaller = userId === call.calleeId;
    const target = toCaller ? call.callerSocket : (call.calleeSocket ?? userRoom(call.calleeId));
    console.log(`[call:ice] id=${callId} from=${toCaller ? "callee" : "caller"} cand=${candidate.candidate.slice(0, 75)}`);
    io.to(target).emit("call:ice", { callId, candidate });
    ack({ ok: true });
  });

  on(socket, "call:end", endSchema, async ({ callId, reason }, ack) => {
    const call = participant(calls.get(callId), userId);
    const finalReason = reason ?? (call.answeredAt ? "hangup" : "missed");
    console.log(`[call:end] id=${callId} reason=${finalReason}`);
    finish(io, call, finalReason);
    ack({ ok: true });
  });

  socket.on("disconnect", () => {
    for (const call of [...calls.values()]) {
      if (call.callerSocket === socket.id || call.calleeSocket === socket.id) {
        finish(io, call, call.answeredAt ? "disconnected" : "missed");
      }
    }
  });
}
