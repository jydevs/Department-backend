import { z } from "zod";

function hasControlOrSpace(v: string): boolean {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f) return true;
  }
  return false;
}

const LOCAL_HTTP = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:[/?#]|$)/;

/** `http://localhost|127.0.0.1|[::1]` with an optional port (development uploads). No userinfo, no other hosts. */
function isLocalHttpUrl(value: string): boolean {
  if (!LOCAL_HTTP.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && url.username === "" && url.password === "" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function isSafeUrl(value: string, opts: { allowMailTel: boolean; allowLocalHttp?: boolean }): boolean {
  if (value.length === 0 || value.length > 2000 || hasControlOrSpace(value)) return false;
  if (value.startsWith("/")) return !value.startsWith("//") && !value.includes("\\");
  if (value.startsWith("https://")) {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }
  if (opts.allowLocalHttp && isLocalHttpUrl(value)) return true;
  if (opts.allowMailTel) return /^mailto:[^\s@]+@[^\s@]+$/.test(value) || /^tel:\+?[0-9()\-.]{3,30}$/.test(value);
  return false;
}

/**
 * Image/media URL: `https://...` or `/path` (no leading `//`). Outside production it also accepts
 * `http://localhost`, `http://127.0.0.1` and `http://[::1]` (optional port) so images uploaded in development validate.
 * NODE_ENV is read at validation time, never cached.
 */
export const safeImageUrl = z.string().refine((v) => isSafeUrl(v, { allowMailTel: false, allowLocalHttp: process.env.NODE_ENV !== "production" }), {
  message: "URL inválida: use https:// o /ruta (sin // inicial)",
});

/** Link URL: `https://`, `/path`, `mailto:` or `tel:`. Rejects javascript: and data:. */
export const safeLinkUrl = z.string().refine((v) => isSafeUrl(v, { allowMailTel: true }), {
  message: "URL inválida: use https://, /ruta, mailto: o tel:",
});

/**
 * Markdown text field: no raw HTML (`<tag`, `</`, `<!`) and every link/image/reference destination must pass isSafeUrl.
 * Rendering stays the storefront's job; this only guarantees the stored source cannot smuggle HTML or `javascript:` links.
 */
export const markdownText = (max: number) =>
  z.string().max(max).superRefine((value, ctx) => {
    if (/<[a-zA-Z/!?]/.test(value)) {
      ctx.addIssue({ code: "custom", message: "HTML no permitido: use solo Markdown" });
      return;
    }
    const dests: string[] = [];
    for (const m of value.matchAll(/\]\(\s*(<[^>]*>|[^)\s]*)[^)]*\)/g)) dests.push(m[1] ?? "");
    for (const m of value.matchAll(/^[ \t]{0,3}\[[^\]]*\]:[ \t]*(<[^>]*>|\S+)/gm)) dests.push(m[1] ?? "");
    for (const raw of dests) {
      const dest = raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw;
      if (!isSafeUrl(dest, { allowMailTel: true })) {
        ctx.addIssue({ code: "custom", message: "Enlace Markdown inválido: use https://, /ruta, mailto: o tel:" });
        return;
      }
    }
  });

export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color inválido (use #RRGGBB)");

export const handleSlug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Handle inválido (minúsculas, números y guiones)");

export const nodeId = z.string().regex(/^[a-z0-9-]{3,40}$/, "Id inválido (^[a-z0-9-]{3,40}$)");

export const text = (max = 300) => z.string().max(max);
