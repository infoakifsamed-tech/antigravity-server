import { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { z } from "zod";
import { env } from "../config/env";
import { HttpError } from "../middleware/errorHandler";
import { getDisappearSeconds, memberIds, userChatIds } from "../repositories/chats";
import { isInvisibleMode } from "../repositories/chats";
import { deleteMessageForUser, markSeen, saveMessage, toggleReaction } from "../services/messages";
import { getPresence, setTyping, userConnected, userDisconnected } from "../services/presence";
import { verifyAccessToken } from "../services/tokens";
import { registerCallHandlers } from "./calls";
import { ensureMember, on, uuid } from "./helpers";
import { chatRoom, setIo, userRoom } from "./registry";

const joinSchema = z.object({ chatId: uuid });

const attachmentSchema = z.object({
  key: z.string().min(1).max(2_500_000),
  name: z.string().max(255),
  mime: z.string().max(127),
  size: z.number().int().nonnegative(),
});

const sendSchema = z
  .object({
    chatId: uuid,
    body: z.string().trim().max(4000).default(""),
    clientId: z.string().min(8).max(64),
    silent: z.boolean().optional(),
    attachments: z.array(attachmentSchema).max(10).optional(),
  })
  .refine((v) => v.body.length > 0 || (v.attachments?.length ?? 0) > 0, { message: "Mesaj boş olamaz" });

const typingSchema = z.object({ chatId: uuid, isTyping: z.boolean() });
const seenSchema = z.object({ chatId: uuid, messageIds: z.array(z.string()).min(1).max(100) });
const presenceSchema = z.object({ userIds: z.array(uuid).max(200) });
const reactSchema = z.object({
  chatId: uuid,
  messageId: z.string().min(1).max(64),
  emoji: z.string().min(1).max(16),
});
const deleteForMeSchema = z.object({
  chatId: uuid,
  messageId: z.string().min(1).max(64),
});

export function createSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: env.NODE_ENV === "production" ? env.corsOrigins : true,
      credentials: true,
    },
    pingInterval: 10_000,
    pingTimeout: 8_000,
    maxHttpBufferSize: 8e6,
  });
  setIo(io);

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== "string") return next(new Error("unauthorized"));
    try {
      socket.data.userId = verifyAccessToken(token);
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", async (socket) => {
    const userId = socket.data.userId as string;
    let chatRooms: string[] = [];

    try {
      await socket.join(userRoom(userId));
      const chatIds = await userChatIds(userId);
      chatRooms = chatIds.map(chatRoom);
      if (chatRooms.length > 0) await socket.join(chatRooms);

      const first = await userConnected(userId);
      if (first && chatRooms.length > 0) {
        socket.to(chatRooms).emit("presence", { userId, online: true, lastSeen: null });
      }
    } catch (err) {
      console.error("[socket] bağlantı kurulumu başarısız:", err);
      socket.disconnect(true);
      return;
    }

    socket.emit("server:ready", { serverTime: Date.now(), userId });
    registerCallHandlers(io, socket);

    on(socket, "join_room", joinSchema, async ({ chatId }, ack) => {
      await ensureMember(socket, chatId);
      ack({ ok: true });
    });

    on(socket, "send_message", sendSchema, async (data, ack) => {
      const room = await ensureMember(socket, data.chatId);
      const prefix = `chats/${data.chatId}/`;
      if (data.attachments?.some((a) => !a.key.startsWith(prefix) && !a.key.startsWith("data:image/"))) {
        throw new HttpError(400, "Geçersiz dosya anahtarı");
      }
      // Kaybolan mesajlar: süre sohbet ayarından alınır ve mesaj gönderildiği an başlar
      const ttl = await getDisappearSeconds(data.chatId);
      const { message, duplicate } = await saveMessage({
        chatId: data.chatId,
        senderId: userId,
        body: data.body,
        clientId: data.clientId,
        silent: data.silent,
        attachments: data.attachments ?? [],
        expiresAt: ttl ? new Date(Date.now() + ttl * 1000) : null,
      });
      if (!duplicate) {
        socket.to(room).emit("receive_message", message);
        void setTyping(data.chatId, userId, false);
        socket.to(room).emit("typing", { chatId: data.chatId, userId, isTyping: false });
      }
      ack({ ok: true, message });
    });

    on(socket, "react_message", reactSchema, async ({ chatId, messageId, emoji }, ack) => {
      const room = await ensureMember(socket, chatId);
      const updated = await toggleReaction(chatId, messageId, userId, emoji);
      if (!updated) throw new HttpError(404, "Mesaj bulunamadı");
      io.to(room).emit("message_reaction", {
        chatId,
        messageId,
        reactions: updated.reactions,
      });
      ack({ ok: true, reactions: updated.reactions });
    });

    on(socket, "delete_for_me", deleteForMeSchema, async ({ chatId, messageId }, ack) => {
      await ensureMember(socket, chatId);
      await deleteMessageForUser(chatId, messageId, userId);
      ack({ ok: true });
    });

    on(socket, "typing", typingSchema, async ({ chatId, isTyping }, ack) => {
      const room = await ensureMember(socket, chatId);
      await setTyping(chatId, userId, isTyping);
      socket.to(room).emit("typing", { chatId, userId, isTyping });
      ack({ ok: true });
    });

    on(socket, "seen", seenSchema, async ({ chatId, messageIds }, ack) => {
      const room = await ensureMember(socket, chatId);
      // Görünmez mod: okundu bilgisi ne kaydedilir ne de karşı tarafa iletilir
      if (!(await isInvisibleMode(userId))) {
        const ids = await markSeen(chatId, userId, messageIds);
        if (ids.length > 0) socket.to(room).emit("seen", { chatId, messageIds: ids, userId });
      }
      ack({ ok: true });
    });

    on(socket, "presence_get", presenceSchema, async ({ userIds }, ack) => {
      // Yalnızca ortak sohbeti olan kullanıcıların durumu paylaşılır
      const shared = new Set<string>();
      for (const room of socket.rooms) {
        if (!room.startsWith("chat:")) continue;
        (await memberIds(room.slice(5))).forEach((id) => shared.add(id));
      }
      const allowed = userIds.filter((id) => shared.has(id));
      ack({ ok: true, presence: await getPresence(allowed) });
    });

    socket.on("ping:client", (ack?: (t: number) => void) => {
      if (typeof ack === "function") ack(Date.now());
    });

    socket.on("disconnect", async (reason) => {
      console.log(`[socket] ayrıldı: ${socket.id} (${reason})`);
      try {
        const { last, lastSeen } = await userDisconnected(userId);
        if (last && chatRooms.length > 0) {
          io.to(chatRooms).emit("presence", { userId, online: false, lastSeen });
        }
      } catch (err) {
        console.error("[socket] ayrılma işlemi başarısız:", err);
      }
    });

    socket.on("error", (err) => console.error(`[socket] hata ${socket.id}:`, err));
  });

  return io;
}
