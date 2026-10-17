import cors from "cors";
import express from "express";
import helmet from "helmet";
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
      origin: env.NODE_ENV === "production" ? env.corsOrigins : true,
      credentials: true,
    })
  );
  app.use(express.json({ limit: "8mb" }));

  const apkFile = path.resolve(__dirname, "../../mobile/Antigravity.apk");
  app.get(["/apk", "/Antigravity.apk"], (_req, res) => {
    res.download(apkFile, "Antigravity.apk");
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
