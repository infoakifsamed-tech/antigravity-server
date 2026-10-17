import { presenceKeys, redis } from "../db/redis";

const connKey = (userId: string) => `presence:conn:${userId}`;

export interface PresenceInfo {
  online: boolean;
  lastSeen: number | null;
}

/** Aynı kullanıcının birden çok cihaz/sekmesi olabilir; sayaç ile takip edilir. */
export async function userConnected(userId: string): Promise<boolean> {
  const n = await redis.incr(connKey(userId));
  return n === 1;
}

/** Son bağlantı koptuysa true döner ve "son görülme" yazılır. */
export async function userDisconnected(userId: string): Promise<{ last: boolean; lastSeen: number }> {
  const n = await redis.decr(connKey(userId));
  const lastSeen = Date.now();
  if (n <= 0) {
    await redis.del(connKey(userId));
    await redis.set(presenceKeys.lastSeen(userId), String(lastSeen));
    return { last: true, lastSeen };
  }
  return { last: false, lastSeen };
}

export async function getPresence(userIds: string[]): Promise<Record<string, PresenceInfo>> {
  if (userIds.length === 0) return {};
  const pipe = redis.pipeline();
  for (const id of userIds) {
    pipe.get(connKey(id));
    pipe.get(presenceKeys.lastSeen(id));
  }
  const res = (await pipe.exec()) ?? [];
  const out: Record<string, PresenceInfo> = {};
  userIds.forEach((id, i) => {
    const conn = Number(res[i * 2]?.[1] ?? 0);
    const seen = res[i * 2 + 1]?.[1];
    out[id] = { online: conn > 0, lastSeen: seen ? Number(seen) : null };
  });
  return out;
}

export async function setTyping(chatId: string, userId: string, isTyping: boolean): Promise<void> {
  const key = presenceKeys.typing(chatId, userId);
  if (isTyping) await redis.set(key, "1", "EX", 5);
  else await redis.del(key);
}

/** Sunucu yeniden başladığında kalan eski sayaçları temizler (tek sunucu örneği varsayımı). */
export async function resetPresence(): Promise<void> {
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", "presence:conn:*", "COUNT", 200);
    cursor = next;
    if (keys.length > 0) await redis.del(...keys);
  } while (cursor !== "0");
}
