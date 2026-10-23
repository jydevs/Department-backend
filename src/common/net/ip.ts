import { isIPv4, isIPv6 } from "node:net";

/**
 * Canonical key for an IP address used by every per-IP brake (login_attempts and the throttler), so the same client
 * always lands in the same bucket:
 *  - `::ffff:a.b.c.d` (IPv4-mapped, what dual-stack sockets report) becomes plain `a.b.c.d`;
 *  - IPv6 is collapsed to its /64 prefix (`2001:db8:1:2::/64`): one subscriber owns a whole /64, so rotating the
 *    low 64 bits would otherwise give an attacker 2^64 fresh "IPs" and bypass the per-IP lock and limits;
 *  - anything that is not an IP (a bogus X-Visitor-Ip, "unknown") is kept as is, truncated to 64 characters.
 */
export function normalizeIp(ip: string | undefined | null): string {
  if (!ip) return "unknown";
  let raw = ip.trim();
  const zone = raw.indexOf("%");
  if (zone >= 0) raw = raw.slice(0, zone);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(raw);
  if (mapped && isIPv4(mapped[1]!)) return mapped[1]!;
  if (isIPv4(raw)) return raw;
  if (!isIPv6(raw)) return raw.length > 0 ? raw.slice(0, 64) : "unknown";

  const groups = expandIpv6(raw);
  if (!groups) return raw.slice(0, 64);
  // ::ffff:0:0/96 written in hex (::ffff:102:304) is the same IPv4-mapped address
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return `${groups[6]! >> 8}.${groups[6]! & 255}.${groups[7]! >> 8}.${groups[7]! & 255}`;
  }
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
}

/** Eight 16-bit groups of a valid IPv6 literal (handles `::` and a trailing dotted IPv4), or null. */
function expandIpv6(ip: string): number[] | null {
  let text = ip;
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number];
    text = text.slice(0, v4.index) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const parts = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  const groups = parts.map((p) => parseInt(p, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}
