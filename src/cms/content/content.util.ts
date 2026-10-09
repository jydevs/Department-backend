import { createHash } from "node:crypto";

/** Deterministic JSON (sorted keys) so equal jsonb documents compare equal regardless of key order. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .filter((k) => obj[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function sameDocument(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/** Top-level keys whose value differs (audit diffs never carry the whole document). */
export function changedKeys(before: Record<string, unknown> | null, after: Record<string, unknown>): string[] {
  const prev = before ?? {};
  const keys = new Set([...Object.keys(prev), ...Object.keys(after)]);
  return [...keys].filter((k) => !sameDocument(prev[k], after[k])).sort();
}

/** `If-Match: "3"` / `W/"3"` / `3` → 3 */
export function parseIfMatch(header: string | undefined): number | undefined {
  if (!header) return undefined;
  const m = /^\s*(?:W\/)?"?(\d{1,9})"?\s*$/.exec(header);
  return m ? Number(m[1]) : undefined;
}

export function weakEtag(...parts: string[]): string {
  return `W/"${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24)}"`;
}

export function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  const strip = (s: string) => s.trim().replace(/^W\//, "");
  const target = strip(etag);
  return header.split(",").some((c) => c.trim() === "*" || strip(c) === target);
}

export function isUniqueViolation(err: unknown): boolean {
  return (err as { driverError?: { code?: string } })?.driverError?.code === "23505";
}
