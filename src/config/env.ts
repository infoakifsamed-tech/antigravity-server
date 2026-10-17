import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  CORS_ORIGINS: z.string().default("http://localhost:8081"),
  POSTGRES_URL: z.string().min(1),
  MONGO_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET en az 32 karakter olmalı"),

  // Dosya depolama (S3 veya S3 uyumlu: Cloudflare R2, MinIO, Backblaze B2...). Boşsa dosya yükleme kapalıdır.
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).optional(),

  // E-posta doğrulaması için SMTP ayarları (Gmail / Outlook / Özel Mail)
  SMTP_HOST: z.string().default("smtp.gmail.com"),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Geçersiz ortam değişkenleri:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(",").map((s) => s.trim()),
  isProd: parsed.data.NODE_ENV === "production",
  s3ForcePathStyle: parsed.data.S3_FORCE_PATH_STYLE === "true",
};
