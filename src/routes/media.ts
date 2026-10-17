import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/errorHandler";
import { isMember } from "../repositories/chats";
import {
  KEY_PATTERN,
  MAX_FILE_BYTES,
  buildKey,
  presignDownload,
  presignUpload,
  storageEnabled,
} from "../services/storage";

export const mediaRouter = Router();
mediaRouter.use(requireAuth);
mediaRouter.use((_req, _res, next) => {
  if (!storageEnabled) next(new HttpError(503, "Dosya depolama henüz yapılandırılmadı"));
  else next();
});

const uploadSchema = z.object({
  chatId: z.string().uuid(),
  filename: z.string().min(1).max(255),
  mime: z.string().max(127).regex(/^[\w.+-]+\/[\w.+-]+$/, "Geçersiz dosya türü"),
  size: z.number().int().positive().max(MAX_FILE_BYTES, "Dosya 2 GB sınırını aşıyor"),
});

mediaRouter.post(
  "/upload-url",
  asyncHandler(async (req, res) => {
    const body = uploadSchema.parse(req.body);
    if (!(await isMember(body.chatId, res.locals.userId as string))) {
      throw new HttpError(403, "Bu sohbete erişiminiz yok");
    }
    const key = buildKey(body.chatId, body.filename);
    res.json({ key, uploadUrl: await presignUpload(key, body.mime, body.size) });
  })
);

mediaRouter.get(
  "/url",
  asyncHandler(async (req, res) => {
    const key = typeof req.query.key === "string" ? req.query.key : "";
    const match = KEY_PATTERN.exec(key);
    if (!match) throw new HttpError(400, "Geçersiz dosya anahtarı");
    if (!(await isMember(match[1], res.locals.userId as string))) {
      throw new HttpError(403, "Bu dosyaya erişiminiz yok");
    }
    res.json({ url: await presignDownload(key) });
  })
);
