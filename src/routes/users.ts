import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/errorHandler";
import { searchUsers, updateProfile } from "../repositories/users";

export const usersRouter = Router();
usersRouter.use(requireAuth);

const patchSchema = z
  .object({
    displayName: z.string().trim().min(1, "Ad boş olamaz").max(64, "Ad en fazla 64 karakter olabilir").optional(),
    avatarUrl: z.string().max(2_500_000).nullable().optional(),
    settings: z
      .object({
        invisibleMode: z.boolean().optional(),
        liquidGlass: z.boolean().optional(),
        theme: z
          .enum([
            "system",
            "light",
            "dark",
            "aqua",
            "matrix",
            "synthwave",
            "nordic",
            "cyberpunk",
            "ember",
            "obsidian",
            "aurora",
            "sakura",
            "solar",
            "arctic",
            "titanium",
          ])
          .optional(),
      })
      .strict()
      .optional(),
  })
  .refine((v) => v.displayName !== undefined || v.avatarUrl !== undefined || v.settings !== undefined, {
    message: "Değiştirilecek bir alan gönderilmedi",
  });

const searchSchema = z.object({
  q: z
    .string()
    .trim()
    .transform((s) => s.replace(/^@/, ""))
    .pipe(z.string().min(1, "Arama metni gerekli").max(32)),
});

usersRouter.get(
  "/search",
  asyncHandler(async (req, res) => {
    const { q } = searchSchema.parse(req.query);
    res.json({ users: await searchUsers(q, res.locals.userId as string) });
  })
);

usersRouter.patch(
  "/me",
  asyncHandler(async (req, res) => {
    const patch = patchSchema.parse(req.body);
    const user = await updateProfile(res.locals.userId as string, patch);
    if (!user) throw new HttpError(404, "Kullanıcı bulunamadı");
    res.json({ user });
  })
);
