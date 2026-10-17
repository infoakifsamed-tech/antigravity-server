import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { env } from "../config/env";

export const MAX_FILE_BYTES = 2 * 1024 ** 3; // 2 GB
const UPLOAD_URL_TTL_SEC = 15 * 60;
const DOWNLOAD_URL_TTL_SEC = 60 * 60;

export const storageEnabled = Boolean(env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);

let client: S3Client | null = null;

function s3(): S3Client {
  if (!storageEnabled) throw new Error("Dosya depolama yapılandırılmamış");
  if (!client) {
    client = new S3Client({
      region: env.S3_REGION ?? "auto",
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.s3ForcePathStyle,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID as string,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY as string,
      },
    });
  }
  return client;
}

/** Anahtar biçimi: chats/<chatId>/<uuid>-<dosya adı>. Yetki kontrolü chatId üzerinden yapılır. */
export function buildKey(chatId: string, filename: string): string {
  const safe = filename.replace(/[^\w.-]+/g, "_").slice(-80) || "dosya";
  return `chats/${chatId}/${randomUUID()}-${safe}`;
}

export const KEY_PATTERN = /^chats\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[\w.-]+$/i;

/** Dosya doğrudan istemciden depoya yüklenir (sunucu bant genişliği/bellek kullanmaz). Boyut imzaya dahildir. */
export function presignUpload(key: string, mime: string, size: number): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
    ContentType: mime,
    ContentLength: size,
  });
  return getSignedUrl(s3(), cmd, { expiresIn: UPLOAD_URL_TTL_SEC });
}

export function presignDownload(key: string): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key });
  return getSignedUrl(s3(), cmd, { expiresIn: DOWNLOAD_URL_TTL_SEC });
}
