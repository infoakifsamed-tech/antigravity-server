import http from "http";
import mongoose from "mongoose";
import { createApp } from "./app";
import { env } from "./config/env";
import { connectMongo } from "./db/mongo";
import { migratePostgres, pg } from "./db/postgres";
import { redis } from "./db/redis";
import { resetPresence } from "./services/presence";
import { createSocketServer } from "./sockets";

async function main(): Promise<void> {
  await migratePostgres();
  console.log("[postgres] şema hazır");
  await connectMongo();
  console.log("[mongo] bağlandı");
  await redis.ping();
  console.log("[redis] bağlandı");
  await resetPresence();

  const server = http.createServer(createApp());
  const io = createSocketServer(server);

  server.listen(env.PORT, "0.0.0.0", () => console.log(`[server] http://0.0.0.0:${env.PORT}`));

  // Render ücretsiz katmanının uyku moduna geçmesini önlemek için kendi kendini tetikleyici
  const keepAliveUrl = process.env.RENDER_EXTERNAL_URL || "https://antigravity-server-bewm.onrender.com";
  setInterval(() => {
    fetch(`${keepAliveUrl}/api/health`).catch(() => undefined);
  }, 8 * 60 * 1000);

  const shutdown = async (signal: string) => {
    console.log(`[server] ${signal} alındı, kapatılıyor...`);
    io.close();
    server.close();
    await Promise.allSettled([pg.end(), mongoose.disconnect(), redis.quit()]);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[server] başlatılamadı:", err);
  process.exit(1);
});
