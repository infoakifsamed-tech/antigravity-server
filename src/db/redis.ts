import Redis from "ioredis";
import { env } from "../config/env";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 200, 3000),
});

redis.on("error", (err) => console.error("[redis] hata:", err.message));

/** Presence anahtarları (Adım 4'te kullanılacak) */
export const presenceKeys = {
  online: (userId: string) => `presence:online:${userId}`,
  lastSeen: (userId: string) => `presence:last_seen:${userId}`,
  typing: (chatId: string, userId: string) => `typing:${chatId}:${userId}`,
};
