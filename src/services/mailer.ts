import crypto from "crypto";
import nodemailer from "nodemailer";
import { env } from "../config/env";
import { redis } from "../db/redis";

const CODE_TTL_SECONDS = 600; // 10 dakika

function redisKey(email: string): string {
  return `verify:email:${email.trim().toLowerCase()}`;
}

/** Sadece rakamlardan oluşan 5 haneli (10000 - 99999) doğrulama kodu üretir. */
export function generateFiveDigitCode(): string {
  return String(crypto.randomInt(10000, 100000));
}

export async function createAndSendVerificationCode(
  email: string,
  username: string
): Promise<{ sentViaSmtp: boolean; devCode?: string }> {
  const code = generateFiveDigitCode();
  await redis.set(redisKey(email), code, "EX", CODE_TTL_SECONDS);

  console.log(`[mail-dogrulama] ${email} (${username}) icin 5 haneli kod: ${code}`);

  if (!env.SMTP_USER || !env.SMTP_PASS) {
    return { sentViaSmtp: false, devCode: code };
  }

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });

  const from = env.SMTP_FROM || `"Antigravity" <${env.SMTP_USER}>`;

  await transporter.sendMail({
    from,
    to: email,
    subject: `${code} - Antigravity E-posta Doğrulama Kodunuz`,
    text: `Merhaba ${username},\n\nAntigravity hesabınızı oluşturmak için 5 haneli doğrulama kodunuz: ${code}\n\nBu kod 10 dakika boyunca geçerlidir.`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 460px; margin: 0 auto; padding: 28px; border-radius: 20px; background: linear-gradient(145deg, #073B7A, #0D78D8); color: #ffffff; text-align: center;">
        <h2 style="margin: 0 0 8px 0; font-size: 26px; letter-spacing: 0.5px;">Antigravity</h2>
        <p style="margin: 0 0 24px 0; color: #D8F0FF; font-size: 14px;">Merhaba <strong>@${username}</strong>, kaydını tamamlamak için aşağıdaki 5 haneli kodu uygulamaya gir:</p>
        <div style="background: rgba(255, 255, 255, 0.18); border: 1px solid rgba(255, 255, 255, 0.45); border-radius: 16px; padding: 18px 24px; display: inline-block; margin-bottom: 20px;">
          <span style="font-size: 36px; font-weight: 800; letter-spacing: 10px; color: #ffffff;">${code}</span>
        </div>
        <p style="margin: 0; color: #CBE8FF; font-size: 12px;">Bu kod 10 dakika boyunca geçerlidir ve yalnızca rakamlardan oluşur.</p>
      </div>
    `,
  });

  return { sentViaSmtp: true };
}

export async function verifyEmailCode(email: string, code: string): Promise<boolean> {
  const cleanCode = code.trim();
  if (!/^\d{5}$/.test(cleanCode)) return false;
  const key = redisKey(email);
  const stored = await redis.get(key);
  if (!stored || stored !== cleanCode) return false;
  await redis.del(key);
  return true;
}
