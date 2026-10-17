import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/errorHandler";
import { getOrCreateDirect, isMember, listChats, setDisappearSeconds } from "../repositories/chats";
import { history, lastMessages } from "../services/messages";
import { chatRoom, getIo, userRoom } from "../sockets/registry";

export const chatsRouter = Router();
chatsRouter.use(requireAuth);

const directSchema = z.object({ username: z.string().min(1).max(32) });
const chatIdSchema = z.string().uuid();

chatsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const userId = res.locals.userId as string;
    const chats = await listChats(userId);
    const last = await lastMessages(chats.map((c) => c.id), userId);
    res.json({ chats: chats.map((c) => ({ ...c, lastMessage: last[c.id] ?? null })) });
  })
);

chatsRouter.post(
  "/direct",
  asyncHandler(async (req, res) => {
    const { username } = directSchema.parse(req.body);
    const userId = res.locals.userId as string;
    const { chatId, otherUserId } = await getOrCreateDirect(userId, username.trim());

    // Açık socket bağlantıları yeni odaya katılır, karşı taraf bilgilendirilir
    const io = getIo();
    if (io) {
      io.in(userRoom(userId)).socketsJoin(chatRoom(chatId));
      io.in(userRoom(otherUserId)).socketsJoin(chatRoom(chatId));
      io.to(userRoom(otherUserId)).emit("chat_created", { chatId });
    }
    res.status(201).json({ chatId });
  })
);

chatsRouter.get(
  "/:id/messages",
  asyncHandler(async (req, res) => {
    const userId = res.locals.userId as string;
    const chatId = chatIdSchema.safeParse(req.params.id);
    if (!chatId.success) throw new HttpError(400, "Geçersiz sohbet kimliği");
    if (!(await isMember(chatId.data, userId))) {
      throw new HttpError(403, "Bu sohbete erişiminiz yok");
    }
    const before = req.query.before ? Number(req.query.before) : undefined;
    if (before !== undefined && !Number.isFinite(before)) throw new HttpError(400, "Geçersiz 'before' değeri");
    res.json({ messages: await history(chatId.data, before, 50, userId) });
  })
);

const disappearSchema = z.object({
  seconds: z.union([z.literal(0), z.literal(5), z.literal(60), z.literal(3600), z.literal(86400)]),
});

/** Kaybolan mesaj süresini ayarlar (0 = kapalı). Yalnızca bundan sonra gönderilen mesajları etkiler. */
chatsRouter.put(
  "/:id/disappear",
  asyncHandler(async (req, res) => {
    const chatId = chatIdSchema.safeParse(req.params.id);
    if (!chatId.success) throw new HttpError(400, "Geçersiz sohbet kimliği");
    const { seconds } = disappearSchema.parse(req.body);
    if (!(await isMember(chatId.data, res.locals.userId as string))) {
      throw new HttpError(403, "Bu sohbete erişiminiz yok");
    }
    const value = seconds === 0 ? null : seconds;
    await setDisappearSeconds(chatId.data, value);
    getIo()?.to(chatRoom(chatId.data)).emit("chat_settings", { chatId: chatId.data, disappearSeconds: value });
    res.json({ disappearSeconds: value });
  })
);
