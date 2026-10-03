import { z } from "zod";
import { hexColor, isSafeUrl, safeImageUrl, safeLinkUrl } from "./common";

const httpsUrl = z
  .string()
  .max(500)
  .refine((v) => v.startsWith("https://") && isSafeUrl(v, { allowMailTel: false }), { message: "Debe ser una URL https://" });

export const settingsSchema = z
  .object({
    brand: z
      .object({
        name: z.string().min(1).max(80),
        tagline: z.string().max(200).optional(),
        logoMediaUrl: safeImageUrl.optional(),
      })
      .strict(),
    theme: z
      .object({
        colors: z
          .object({
            background: hexColor,
            foreground: hexColor,
            accent: hexColor,
            muted: hexColor.optional(),
            border: hexColor.optional(),
          })
          .strict(),
        fonts: z.object({ heading: z.string().min(1).max(80), body: z.string().min(1).max(80) }).strict(),
      })
      .strict(),
    seo: z
      .object({
        titleTemplate: z.string().min(1).max(120),
        defaultDescription: z.string().max(320),
        ogImageUrl: safeImageUrl.optional(),
      })
      .strict(),
    social: z
      .object({
        instagram: httpsUrl.optional(),
        tiktok: httpsUrl.optional(),
        facebook: httpsUrl.optional(),
        youtube: httpsUrl.optional(),
        pinterest: httpsUrl.optional(),
        x: httpsUrl.optional(),
      })
      .strict(),
    announcement: z.object({ enabled: z.boolean(), text: z.string().max(200), href: safeLinkUrl.optional() }).strict(),
    store: z
      .object({
        currency: z.literal("COP"),
        locale: z.literal("es-CO"),
        contactEmail: z.email().max(200).optional(),
        whatsapp: z.string().regex(/^\+?[0-9]{7,15}$/, "WhatsApp inválido").optional(),
      })
      .strict(),
  })
  .strict();

export type SettingsDocument = z.infer<typeof settingsSchema>;
