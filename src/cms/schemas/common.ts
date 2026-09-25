import { z } from "zod";

function hasControlOrSpace(v: string): boolean {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f) return true;
  }
  return false;
}

export function isSafeUrl(value: string, opts: { allowMailTel: boolean }): boolean {
  if (value.length === 0 || value.length > 2000 || hasControlOrSpace(value)) return false;
  if (value.startsWith("/")) return !value.startsWith("//") && !value.includes("\\");
  if (value.startsWith("https://")) {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }
  if (opts.allowMailTel) return /^mailto:[^\s@]+@[^\s@]+$/.test(value) || /^tel:\+?[0-9()\-.]{3,30}$/.test(value);
  return false;
}

/** Image/media URL: `https://...` or `/path` (no leading `//`). */
export const safeImageUrl = z.string().refine((v) => isSafeUrl(v, { allowMailTel: false }), {
  message: "URL inválida: use https:// o /ruta (sin // inicial)",
});

/** Link URL: `https://`, `/path`, `mailto:` or `tel:`. Rejects javascript: and data:. */
export const safeLinkUrl = z.string().refine((v) => isSafeUrl(v, { allowMailTel: true }), {
  message: "URL inválida: use https://, /ruta, mailto: o tel:",
});

export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color inválido (use #RRGGBB)");

export const handleSlug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Handle inválido (minúsculas, números y guiones)");

export const nodeId = z.string().regex(/^[a-z0-9-]{3,40}$/, "Id inválido (^[a-z0-9-]{3,40}$)");

export const text = (max = 300) => z.string().max(max);
