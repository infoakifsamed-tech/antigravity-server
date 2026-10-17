import { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../services/tokens";
import { HttpError } from "./errorHandler";

/** Başarılı doğrulamada kullanıcı kimliği res.locals.userId içine yazılır. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    next(new HttpError(401, "Kimlik doğrulaması gerekli"));
    return;
  }
  try {
    res.locals.userId = verifyAccessToken(header.slice(7));
    next();
  } catch {
    next(new HttpError(401, "Oturum süresi doldu veya token geçersiz"));
  }
}
