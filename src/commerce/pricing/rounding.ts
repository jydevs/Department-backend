/**
 * Half-up rounding for COP amounts. `Math.round` rounds negative halves toward +infinity and
 * float noise (0.1 + 0.2) makes it unreliable for fractions, so amounts are rounded explicitly.
 * Half-up here means: exactly .5 goes away from zero.
 */
export function roundHalfUp(n: number): number {
  if (!Number.isFinite(n)) throw new Error("roundHalfUp: value must be finite");
  const abs = Math.abs(n);
  const floor = Math.floor(abs);
  const rounded = abs - floor >= 0.5 ? floor + 1 : floor;
  return n < 0 ? -rounded : rounded;
}

/**
 * Exact `round(numerator / denominator)` half-up over non-negative safe integers (no float division),
 * so `subtotal * percent / 100` never drifts.
 */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator < 0 || denominator <= 0) {
    throw new Error("divRoundHalfUp: expected non-negative safe integers and a positive denominator");
  }
  const remainder = numerator % denominator;
  const quotient = (numerator - remainder) / denominator;
  return remainder * 2 >= denominator ? quotient + 1 : quotient;
}
