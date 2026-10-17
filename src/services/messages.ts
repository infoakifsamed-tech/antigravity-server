import { isValidObjectId } from "mongoose";
import { Message } from "../models/Message";

export interface AttachmentDto {
  key: string;
  name: string;
  mime: string;
  size: number;
}

export interface ReactionDto {
  userId: string;
  emoji: string;
}

export interface MessageDto {
  id: string;
  chatId: string;
  senderId: string;
  body: string;
  isEncrypted: boolean;
  timestamp: number;
  clientId: string | null;
  readBy: string[];
  reactions: ReactionDto[];
  attachments: AttachmentDto[];
  expiresAt: number | null;
}

interface MessageLike {
  _id: { toString(): string };
  chat_id: string;
  sender_id: string;
  message_body: string;
  is_encrypted?: boolean | null;
  timestamp: Date;
  client_id?: string | null;
  read_by?: string[] | null;
  reactions?: { user_id?: string | null; emoji?: string | null }[] | null;
  expires_at?: Date | null;
  attachments?: { key?: string | null; name?: string | null; mime?: string | null; size?: number | null }[] | null;
}

export function toDto(doc: MessageLike): MessageDto {
  return {
    id: doc._id.toString(),
    chatId: doc.chat_id,
    senderId: doc.sender_id,
    body: doc.message_body ?? "",
    isEncrypted: !!doc.is_encrypted,
    timestamp: doc.timestamp.getTime(),
    clientId: doc.client_id ?? null,
    readBy: doc.read_by ?? [],
    reactions: (doc.reactions ?? [])
      .filter((r) => r.user_id && r.emoji)
      .map((r) => ({ userId: r.user_id as string, emoji: r.emoji as string })),
    attachments: (doc.attachments ?? []).map((a) => ({
      key: a.key ?? "",
      name: a.name ?? "",
      mime: a.mime ?? "",
      size: a.size ?? 0,
    })),
    expiresAt: doc.expires_at ? doc.expires_at.getTime() : null,
  };
}

/** Süresi dolmamış mesajlar. MongoDB TTL temizliği dakikada bir çalıştığından sorgu tarafında da filtrelenir. */
const notExpired = () => ({ $or: [{ expires_at: null }, { expires_at: { $gt: new Date() } }] });

/** Aynı client_id ile tekrar gelen mesaj (yeniden deneme) çift kaydedilmez. */
export async function saveMessage(input: {
  chatId: string;
  senderId: string;
  body: string;
  clientId: string;
  silent?: boolean;
  attachments?: AttachmentDto[];
  expiresAt?: Date | null;
}): Promise<{ message: MessageDto; duplicate: boolean }> {
  const existing = await Message.findOne({ chat_id: input.chatId, client_id: input.clientId }).lean();
  if (existing) return { message: toDto(existing as unknown as MessageLike), duplicate: true };

  try {
    const doc = await Message.create({
      chat_id: input.chatId,
      sender_id: input.senderId,
      message_body: input.body,
      is_encrypted: false,
      client_id: input.clientId,
      silent: input.silent ?? false,
      read_by: [input.senderId],
      reactions: [],
      attachments: input.attachments ?? [],
      expires_at: input.expiresAt ?? null,
    });
    return { message: toDto(doc as unknown as MessageLike), duplicate: false };
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      const again = await Message.findOne({ chat_id: input.chatId, client_id: input.clientId }).lean();
      if (again) return { message: toDto(again as unknown as MessageLike), duplicate: true };
    }
    throw err;
  }
}

export async function history(chatId: string, before?: number, limit = 50, userId?: string): Promise<MessageDto[]> {
  const query: Record<string, unknown> = { chat_id: chatId, deleted_for_all: false, ...notExpired() };
  if (userId) query.deleted_for = { $ne: userId };
  if (before) query.timestamp = { $lt: new Date(before) };
  const docs = await Message.find(query).sort({ timestamp: -1 }).limit(limit).lean();
  return docs.reverse().map((d) => toDto(d as unknown as MessageLike));
}

export async function lastMessages(chatIds: string[], userId?: string): Promise<Record<string, MessageDto>> {
  if (chatIds.length === 0) return {};
  const match: Record<string, unknown> = { chat_id: { $in: chatIds }, deleted_for_all: false, ...notExpired() };
  if (userId) match.deleted_for = { $ne: userId };
  const rows = await Message.aggregate<{ _id: string; last: MessageLike }>([
    { $match: match },
    { $sort: { timestamp: -1 } },
    { $group: { _id: "$chat_id", last: { $first: "$$ROOT" } } },
  ]);
  return Object.fromEntries(rows.map((r) => [r._id, toDto(r.last)]));
}

export async function markSeen(chatId: string, userId: string, messageIds: string[]): Promise<string[]> {
  const ids = messageIds.filter((id) => isValidObjectId(id));
  if (ids.length === 0) return [];
  await Message.updateMany(
    { _id: { $in: ids }, chat_id: chatId, sender_id: { $ne: userId } },
    { $addToSet: { read_by: userId } }
  );
  return ids;
}

export async function toggleReaction(
  chatId: string,
  messageId: string,
  userId: string,
  emoji: string
): Promise<MessageDto | null> {
  if (!isValidObjectId(messageId)) return null;
  const doc = await Message.findOne({ _id: messageId, chat_id: chatId });
  if (!doc) return null;

  const existingIdx = doc.reactions.findIndex((r) => r.user_id === userId);
  if (existingIdx >= 0) {
    const currentEmoji = doc.reactions[existingIdx]?.emoji;
    if (currentEmoji === emoji) {
      doc.reactions.splice(existingIdx, 1);
    } else {
      (doc.reactions[existingIdx] as any).emoji = emoji;
    }
  } else {
    doc.reactions.push({ user_id: userId, emoji } as any);
  }
  await doc.save();
  return toDto(doc.toObject() as unknown as MessageLike);
}

export async function deleteMessageForUser(
  chatId: string,
  messageId: string,
  userId: string
): Promise<boolean> {
  if (!isValidObjectId(messageId)) return false;
  const res = await Message.updateOne(
    { _id: messageId, chat_id: chatId },
    { $addToSet: { deleted_for: userId } }
  );
  return res.matchedCount > 0;
}
