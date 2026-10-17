import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { env } from "../config/env";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: "Kaynak bulunamadı" });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: err.issues[0]?.message ?? "Geçersiz istek",
      fields: err.flatten().fieldErrors,
    });
    return;
  }
  const status = (err as { status?: number })?.status;
  if (status === 400) {
    res.status(400).json({ error: "Geçersiz istek" });
    return;
  }
  console.error("[http] beklenmeyen hata:", err);
  res.status(500).json({
    error: "Sunucu hatası",
    ...(env.isProd ? {} : { detail: err instanceof Error ? err.message : String(err) }),
  });
}
