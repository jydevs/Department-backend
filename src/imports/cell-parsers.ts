import sanitizeHtml from "sanitize-html";
import { ImportRowException } from "./imports.types";

export const HANDLE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL_RE = /^[^\s@,;<>()"']+@[^\s@,;<>()"']+\.[^\s@,;<>()"']+$/;
const MAX_MONEY = 1e10;

/** Spreadsheet exports prefix risky cells with an apostrophe (e.g. `'+57300...`): drop it. */
export const cell = (raw: string | undefined): string => (raw ?? "").replace(/^'(?=[=+\-@])/, "").trim();

/** COP integers only: digits with an optional `.0`/`.00` tail. Rejects negatives, NaN, exponents, thousands separators. */
export function parseMoney(raw: string, column: string): number {
  const text = cell(raw);
  if (!/^\d{1,11}(\.0{1,2})?$/.test(text)) throw new ImportRowException("INVALID_PRICE", `${column}: expected whole COP digits (e.g. 189000 or 189000.00)`);
  const value = Number.parseInt(text, 10);
  if (!Number.isSafeInteger(value) || value > MAX_MONEY) throw new ImportRowException("INVALID_PRICE", `${column}: value is too large`);
  return value;
}

export function parseNonNegativeInt(raw: string, column: string, max: number): number {
  const text = cell(raw);
  if (!/^\d{1,10}$/.test(text)) throw new ImportRowException("INVALID_NUMBER", `${column}: expected a non-negative whole number`);
  const value = Number.parseInt(text, 10);
  if (value > max) throw new ImportRowException("INVALID_NUMBER", `${column}: value is too large`);
  return value;
}

export function parseBool(raw: string): boolean | null {
  const text = cell(raw).toLowerCase();
  if (["true", "yes", "y", "1", "active"].includes(text)) return true;
  if (["false", "no", "n", "0", "draft", "archived"].includes(text)) return false;
  return null;
}

export function parseHttpsUrl(raw: string, column: string): string {
  const text = cell(raw);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new ImportRowException("INVALID_URL", `${column}: not a valid URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password) throw new ImportRowException("INVALID_URL", `${column}: only https:// URLs are accepted`);
  if (text.length > 2000) throw new ImportRowException("INVALID_URL", `${column}: URL is too long`);
  return url.toString();
}

export function parseTags(raw: string): string[] {
  const tags = [
    ...new Set(
      cell(raw)
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
    ),
  ];
  if (tags.length > 50) throw new ImportRowException("INVALID_TAGS", "Tags: at most 50 tags per product");
  if (tags.some((t) => t.length > 50)) throw new ImportRowException("INVALID_TAGS", "Tags: each tag must be 50 characters or fewer");
  return tags;
}

export function normalizeEmail(raw: string): string {
  const email = cell(raw).toLowerCase();
  if (email.length === 0 || email.length > 255 || !EMAIL_RE.test(email)) throw new ImportRowException("INVALID_EMAIL", "Email: missing or not a valid address");
  return email;
}

/** Digits with optional leading `+`, 7-15 digits; spaces, dashes, dots and parentheses are ignored. Null when empty. */
export function normalizePhone(raw: string, column: string): string | null {
  const text = cell(raw).replace(/[\s().-]/g, "");
  if (text === "") return null;
  if (!/^\+?\d{7,15}$/.test(text)) throw new ImportRowException("INVALID_PHONE", `${column}: not a valid phone number`);
  return text;
}

/** Same as `normalizePhone` but yields null instead of throwing (optional address data is skipped, not an error). */
export function tryNormalizePhone(raw: string): string | null {
  try {
    return normalizePhone(raw, "Phone");
  } catch {
    return null;
  }
}

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "em", "ul", "ol", "li", "h2", "h3", "h4", "a", "img"],
  allowedAttributes: { a: ["href", "rel"], img: ["src", "alt"] },
  allowedSchemes: [],
  allowedSchemesByTag: { a: ["https", "mailto", "tel"], img: ["https"] },
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: { a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }, true) },
};

/** `Body (HTML)` whitelist sanitiser: scripts, styles, event handlers and non-https links/images are dropped. */
export function sanitizeBody(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS).trim();
}
