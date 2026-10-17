import bcrypt from "bcryptjs";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { HttpError } from "../middleware/errorHandler";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/auth";
import { createUser, findById, findForLogin } from "../repositories/users";
import { createAndSendVerificationCode, verifyEmailCode } from "../services/mailer";
import { issueTokenPair, revokeRefreshToken, rotateRefreshToken } from "../services/tokens";

export const authRouter = Router();

const BCRYPT_COST = 12;
// Kullanıcı bulunamasa bile aynı sürede bcrypt çalıştırarak zamanlama saldırılarını engeller
const DUMMY_HASH = bcrypt.hashSync("antigravity-dummy-password", BCRYPT_COST);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Çok fazla deneme. Lütfen daha sonra tekrar deneyin." },
});

const sendCodeSchema = z.object({
  username: z.string().regex(/^[a-zA-Z0-9_]{3,32}$/, "Kullanıcı adı 3-32 karakter; harf, rakam ve _ içerebilir"),
  email: z.string().email("Geçerli bir e-posta girin").max(255),
});

const registerSchema = z.object({
  username: z.string().regex(/^[a-zA-Z0-9_]{3,32}$/, "Kullanıcı adı 3-32 karakter; harf, rakam ve _ içerebilir"),
  email: z.string().email("Geçerli bir e-posta girin").max(255),
  password: z.string().min(8, "Şifre en az 8 karakter olmalı").max(72, "Şifre en fazla 72 karakter olabilir"),
  code: z.string().regex(/^\d{5}$/, "Doğrulama kodu 5 haneli sayı olmalıdır"),
  publicKey: z.string().max(4096).optional(),
});

const loginSchema = z.object({
  identifier: z.string().min(1, "Kullanıcı adı veya e-posta gerekli").max(255),
  password: z.string().min(1, "Şifre gerekli").max(72),
});

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

authRouter.post(
  "/send-code",
  limiter,
  asyncHandler(async (req, res) => {
    const body = sendCodeSchema.parse(req.body);
    const existingUser = await findForLogin(body.username);
    if (existingUser) {
      throw new HttpError(409, "Bu kullanıcı adı zaten kullanılıyor");
    }
    const existingEmail = await findForLogin(body.email);
    if (existingEmail) {
      throw new HttpError(409, "Bu e-posta zaten kullanılıyor");
    }

    try {
      const result = await createAndSendVerificationCode(body.email, body.username);
      res.json({ sent: true, ...result });
    } catch (err) {
      console.error("[mail-dogrulama] SMTP hatası:", err);
      throw new HttpError(500, "Doğrulama e-postası gönderilemedi. SMTP ayarlarınızı kontrol edin.");
    }
  })
);

authRouter.post(
  "/register",
  limiter,
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const codeOk = await verifyEmailCode(body.email, body.code);
    if (!codeOk) {
      throw new HttpError(400, "5 haneli doğrulama kodu hatalı veya süresi dolmuş");
    }

    const passwordHash = await bcrypt.hash(body.password, BCRYPT_COST);
    try {
      const user = await createUser({
        username: body.username,
        email: body.email,
        passwordHash,
        publicKey: body.publicKey,
      });
      const tokens = await issueTokenPair(user.id);
      res.status(201).json({ user, ...tokens });
    } catch (err) {
      const e = err as { code?: string; constraint?: string };
      if (e.code === "23505") {
        const field = e.constraint?.includes("email") ? "e-posta" : "kullanıcı adı";
        throw new HttpError(409, `Bu ${field} zaten kullanılıyor`);
      }
      throw err;
    }
  })
);

authRouter.post(
  "/login",
  limiter,
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const found = await findForLogin(body.identifier);
    const ok = await bcrypt.compare(body.password, found?.password_hash ?? DUMMY_HASH);
    if (!found || !found.password_hash || !ok) throw new HttpError(401, "Kullanıcı adı veya şifre hatalı");

    const { password_hash: _omit, ...user } = found;
    void _omit;
    const tokens = await issueTokenPair(user.id);
    res.json({ user, ...tokens });
  })
);

authRouter.post(
  "/refresh",
  limiter,
  asyncHandler(async (req, res) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    try {
      const { pair } = await rotateRefreshToken(refreshToken);
      res.json(pair);
    } catch {
      throw new HttpError(401, "Oturum yenilenemedi, lütfen tekrar giriş yapın");
    }
  })
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    await revokeRefreshToken(refreshToken);
    res.status(204).end();
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const user = await findById(res.locals.userId as string);
    if (!user) throw new HttpError(404, "Kullanıcı bulunamadı");
    res.json({ user });
  })
);
