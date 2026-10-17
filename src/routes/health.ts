import { Router } from "express";
import { mongoReady } from "../db/mongo";
import { pg } from "../db/postgres";
import { redis } from "../db/redis";

export const healthRouter = Router();

async function check(fn: () => Promise<unknown>): Promise<"up" | "down"> {
  try {
    await fn();
    return "up";
  } catch {
    return "down";
  }
}

healthRouter.get("/health", async (_req, res, next) => {
  try {
    const [postgres, redisStatus] = await Promise.all([
      check(() => pg.query("SELECT 1")),
      check(() => redis.ping()),
    ]);
    const mongo = mongoReady() ? "up" : "down";
    const ok = postgres === "up" && redisStatus === "up" && mongo === "up";
    res.status(ok ? 200 : 503).json({
      status: ok ? "ok" : "degraded",
      postgres,
      mongo,
      redis: redisStatus,
      uptime: process.uptime(),
    });
  } catch (err) {
    next(err);
  }
});
