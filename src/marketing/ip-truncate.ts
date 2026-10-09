import { isIPv4, isIPv6 } from "node:net";

/** Privacy: keep only the network (/24 for IPv4, /48 for IPv6). Unparseable input yields null. */
export function truncateIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  let value = ip.trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(value);
  if (mapped?.[1]) value = mapped[1];
  if (isIPv4(value)) {
    const [a, b, c] = value.split(".");
    return `${a}.${b}.${c}.0`;
  }
  if (isIPv6(value)) {
    const zone = value.indexOf("%");
    if (zone >= 0) value = value.slice(0, zone);
    const groups = expandIpv6(value);
    if (!groups) return null;
    return `${groups.slice(0, 3).join(":")}::`;
  }
  return null;
}

function expandIpv6(value: string): string[] | null {
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (head.some((g) => g.includes(".")) || tail.some((g) => g.includes("."))) return null; // embedded IPv4 in a non-mapped address
  const missing = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (missing < 0) return null;
  const all = [...head, ...Array<string>(missing).fill("0"), ...tail];
  if (all.length !== 8) return null;
  return all.map((g) => (parseInt(g, 16) || 0).toString(16));
}
