import { Socket } from "socket.io";
import { z, ZodError, ZodTypeAny } from "zod";
import { HttpError } from "../middleware/errorHandler";
import { isMember } from "../repositories/chats";
import { chatRoom } from "./registry";

export type Ack = (res: { ok: true; [k: string]: unknown } | { ok: false; error: string }) => void;

export const uuid = z.string().uuid();

export async function ensureMember(socket: Socket, chatId: string): Promise<string> {
  const room = chatRoom(chatId);
  if (socket.rooms.has(room)) return room;
  if (!(await isMember(chatId, socket.data.userId as string))) {
    throw new HttpError(403, "Bu sohbete erişiminiz yok");
  }
  await socket.join(room);
  return room;
}

/** Şema doğrulaması, hata yakalama ve ack yanıtını tek yerde toplar. */
export function on<S extends ZodTypeAny>(
  socket: Socket,
  event: string,
  schema: S,
  handler: (data: z.infer<S>, ack: Ack) => Promise<void>
): void {
  socket.on(event, async (raw: unknown, ackFn?: unknown) => {
    const ack: Ack = typeof ackFn === "function" ? (ackFn as Ack) : () => undefined;
    try {
      await handler(schema.parse(raw), ack);
    } catch (err) {
      if (err instanceof ZodError) ack({ ok: false, error: "Geçersiz veri" });
      else if (err instanceof HttpError) ack({ ok: false, error: err.message });
      else {
        console.error(`[socket] ${event} hatası:`, err);
        ack({ ok: false, error: "Sunucu hatası" });
      }
    }
  });
}
