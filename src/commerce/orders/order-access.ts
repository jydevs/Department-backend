import { createHash } from "node:crypto";
import { safeEqual } from "../payments/safe-equal";
import { orderLinkToken } from "./order-mail";

const sha256Hex = (value: string): string => createHash("sha256").update(value).digest("hex");

/**
 * Constant-time check of a public order credential: the checkout `accessToken` (compared by hash) or the stateless
 * e-mail link token. Both are always evaluated so timing does not reveal which one matched.
 */
export function orderTokenMatches(
  order: { id: string; accessTokenHash: string } | null | undefined,
  token: string,
  secret: string | undefined,
): boolean {
  const expectedHash = order?.accessTokenHash ?? sha256Hex("no-such-order");
  const byAccessToken = safeEqual(sha256Hex(token), expectedHash);
  const byLinkToken = safeEqual(sha256Hex(token), sha256Hex(orderLinkToken(secret, order?.id ?? "no-such-order")));
  return !!order && (byAccessToken || byLinkToken);
}
