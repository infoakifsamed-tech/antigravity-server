import cors from "cors";
import express from "express";
import helmet from "helmet";
import fs from "fs";
import path from "path";
import { env } from "./config/env";
import { errorHandler, notFound } from "./middleware/errorHandler";
import { authRouter } from "./routes/auth";
import { chatsRouter } from "./routes/chats";
import { healthRouter } from "./routes/health";
import { mediaRouter } from "./routes/media";
import { usersRouter } from "./routes/users";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(
    cors({
      origin: (_origin, callback) => callback(null, true),
      credentials: true,
    })
  );
  app.use(express.json({ limit: "8mb" }));

  app.get(["/apk", "/download", "/Antigravity.apk", "/Antigravity_Online.apk"], (_req, res) => {
    const candidates = [
      path.resolve(__dirname, "../public/Antigravity.apk"),
      path.resolve(process.cwd(), "public/Antigravity.apk"),
      path.resolve(__dirname, "../../public/Antigravity.apk"),
      path.resolve(process.cwd(), "apps/server/public/Antigravity.apk"),
      "C:\\AndroidMini\\Antigravity_Online.apk",
    ];
    const found = candidates.find((p) => fs.existsSync(p));
    if (found) {
      return res.download(found, "Antigravity_Online.apk");
    }
    res.status(404).send("APK dosyası hazırlanıyor, lütfen 1 dakika sonra tekrar deneyin.");
  });

  app.use("/api", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/chats", chatsRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/media", mediaRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
