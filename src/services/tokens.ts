import { randomUUID } from "crypto";
import jwt, { JwtPayload } from "jsonwebtoken";
import { env } from "../config/env";
import { redis } from "../db/redis";

const ACCESS_TTL_SEC = 30 * 24 * 60 * 60;
const REFRESH_TTL_SEC = 30 * 24 * 60 * 60;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const refreshKey = (userId: string, jti: string) => `refresh:${userId}:${jti}`;

function verify(token: string, type: "access" | "refresh"): JwtPayload & { sub: string } {
  const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"], ignoreExpiration: true });
  if (typeof payload === "string" || payload.typ !== type || typeof payload.sub !== "string") {
    throw new Error("Geçersiz token türü");
  }
  return payload as JwtPayload & { sub: string };
}

export function verifyAccessToken(token: string): string {
  return verify(token, "access").sub;
}

export async function issueTokenPair(userId: string): Promise<TokenPair> {
  const jti = randomUUID();
  const accessToken = jwt.sign({ typ: "access" }, env.JWT_SECRET, {
    subject: userId,
    expiresIn: ACCESS_TTL_SEC,
    algorithm: "HS256",
  });
  const refreshToken = jwt.sign({ typ: "refresh", jti }, env.JWT_SECRET, {
    subject: userId,
    expiresIn: REFRESH_TTL_SEC,
    algorithm: "HS256",
  });
  await redis.set(refreshKey(userId, jti), "1", "EX", REFRESH_TTL_SEC);
  return { accessToken, refreshToken };
}

/** Refresh token döndürme (rotation): paralel isteklerin çakışmaması için kısa tolerans süresi tanınır. */
export async function rotateRefreshToken(token: string): Promise<{ userId: string; pair: TokenPair }> {
  const payload = verify(token, "refresh");
  const jti = payload.jti;
  if (!jti) throw new Error("jti yok");
  const exists = await redis.exists(refreshKey(payload.sub, jti));
  if (exists === 1) {
    await redis.expire(refreshKey(payload.sub, jti), 120);
  }
  return { userId: payload.sub, pair: await issueTokenPair(payload.sub) };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  try {
    const payload = verify(token, "refresh");
    if (payload.jti) await redis.del(refreshKey(payload.sub, payload.jti));
  } catch {
    /* zaten geçersiz: yapılacak bir şey yok */
  }
}
