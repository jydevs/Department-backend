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
        /** Short brand statement (footer, about blocks). */
        description: z.string().max(500).optional(),
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
            /** darker / lighter tints of the accent (small text on the background needs the light one for contrast) */
            accentDark: hexColor.optional(),
            accentLight: hexColor.optional(),
            /** secondary action colour (e.g. third-party sign-in button) */
            info: hexColor.optional(),
            gray100: hexColor.optional(),
            gray300: hexColor.optional(),
            gray500: hexColor.optional(),
            gray900: hexColor.optional(),
          })
          .strict(),
        fonts: z
          .object({
            heading: z.string().min(1).max(80),
            body: z.string().min(1).max(80),
            /** condensed uppercase face used by nav, buttons and micro-labels */
            condensed: z.string().min(1).max(80).optional(),
            /** decorative script face */
            script: z.string().min(1).max(80).optional(),
          })
          .strict(),
        colorScheme: z.enum(["dark", "light"]).optional(),
      })
      .strict(),
    seo: z
      .object({
        titleTemplate: z.string().min(1).max(120),
        /** <title> of the home page (the template does not apply to it) */
        defaultTitle: z.string().max(160).optional(),
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
    announcement: z
      .object({
        enabled: z.boolean(),
        text: z.string().max(200),
        /** Ticker lines; when present the storefront scrolls them as a marquee (text stays as the single-line fallback). */
        items: z.array(z.string().min(1).max(120)).max(10).optional(),
        href: safeLinkUrl.optional(),
        backgroundColor: hexColor.optional(),
        textColor: hexColor.optional(),
        separator: z.string().max(5).optional(),
        /** seconds per marquee loop */
        duration: z.number().min(5).max(180).optional(),
      })
      .strict(),
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
