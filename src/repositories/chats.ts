import { pg } from "../db/postgres";
import { HttpError } from "../middleware/errorHandler";

export interface ChatMemberDto {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl?: string | null;
}

export interface ChatRow {
  id: string;
  type: "direct" | "group" | "channel";
  title: string | null;
  disappearSeconds: number | null;
  members: ChatMemberDto[];
}

export async function isMember(chatId: string, userId: string): Promise<boolean> {
  const { rowCount } = await pg.query("SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2", [
    chatId,
    userId,
  ]);
  return (rowCount ?? 0) > 0;
}

export async function userChatIds(userId: string): Promise<string[]> {
  const { rows } = await pg.query<{ chat_id: string }>("SELECT chat_id FROM chat_members WHERE user_id = $1", [
    userId,
  ]);
  return rows.map((r) => r.chat_id);
}

export async function memberIds(chatId: string): Promise<string[]> {
  const { rows } = await pg.query<{ user_id: string }>("SELECT user_id FROM chat_members WHERE chat_id = $1", [
    chatId,
  ]);
  return rows.map((r) => r.user_id);
}

export async function listChats(userId: string): Promise<ChatRow[]> {
  const { rows } = await pg.query<ChatRow>(
    `SELECT c.id, c.type, c.title, c.disappear_seconds AS "disappearSeconds",
            json_agg(json_build_object('id', u.id, 'username', u.username, 'displayName', u.display_name, 'avatarUrl', u.avatar_url)) AS members
       FROM chats c
       JOIN chat_members me ON me.chat_id = c.id AND me.user_id = $1
       JOIN chat_members cm ON cm.chat_id = c.id
       JOIN users u ON u.id = cm.user_id
      GROUP BY c.id
      ORDER BY c.created_at DESC`,
    [userId]
  );
  return rows;
}

/** İki kullanıcı arasındaki birebir sohbeti döndürür; yoksa oluşturur. */
export async function getOrCreateDirect(
  userId: string,
  otherUsername: string
): Promise<{ chatId: string; otherUserId: string }> {
  const other = await pg.query<{ id: string }>("SELECT id FROM users WHERE lower(username) = lower($1)", [
    otherUsername,
  ]);
  if (other.rowCount === 0) throw new HttpError(404, "Bu kullanıcı bulunamadı");
  const otherUserId = other.rows[0].id;
  if (otherUserId === userId) throw new HttpError(400, "Kendinizle sohbet başlatamazsınız");

  const existing = await pg.query<{ id: string }>(
    `SELECT c.id FROM chats c
       JOIN chat_members a ON a.chat_id = c.id AND a.user_id = $1
       JOIN chat_members b ON b.chat_id = c.id AND b.user_id = $2
      WHERE c.type = 'direct' LIMIT 1`,
    [userId, otherUserId]
  );
  if (existing.rowCount && existing.rowCount > 0) return { chatId: existing.rows[0].id, otherUserId };

  const client = await pg.connect();
  try {
    await client.query("BEGIN");
    const chat = await client.query<{ id: string }>(
      "INSERT INTO chats (type, owner_id) VALUES ('direct', $1) RETURNING id",
      [userId]
    );
    const chatId = chat.rows[0].id;
    await client.query("INSERT INTO chat_members (chat_id, user_id) VALUES ($1, $2), ($1, $3)", [
      chatId,
      userId,
      otherUserId,
    ]);
    await client.query("COMMIT");
    return { chatId, otherUserId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function isInvisibleMode(userId: string): Promise<boolean> {
  const { rows } = await pg.query<{ invisible: string | null }>(
    "SELECT settings->>'invisibleMode' AS invisible FROM users WHERE id = $1",
    [userId]
  );
  return rows[0]?.invisible === "true";
}

export async function getDisappearSeconds(chatId: string): Promise<number | null> {
  const { rows } = await pg.query<{ disappear_seconds: number | null }>(
    "SELECT disappear_seconds FROM chats WHERE id = $1",
    [chatId]
  );
  return rows[0]?.disappear_seconds ?? null;
}

export async function setDisappearSeconds(chatId: string, seconds: number | null): Promise<void> {
  await pg.query("UPDATE chats SET disappear_seconds = $2 WHERE id = $1", [chatId, seconds]);
}
