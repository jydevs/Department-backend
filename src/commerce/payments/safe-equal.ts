import { timingSafeEqual } from "node:crypto";

/** Constant-time string comparison (length is not secret: hex digests have a fixed size). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
