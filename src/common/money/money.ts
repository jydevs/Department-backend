import type { ValueTransformer } from "typeorm";

/**
 * Money is ALWAYS an integer number of minor units (COP has no cents in practice, but we keep the
 * convention: 1 COP = 1 unit) held in a Postgres `bigint`. Never a float, never a decimal string in domain code.
 * pg returns bigint as string, so columns use this transformer:
 *
 *   @Column({ type: "bigint", transformer: moneyTransformer }) totalAmount!: number;
 */
export const moneyTransformer: ValueTransformer = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => {
    if (v == null) return v;
    const n = Number(v);
    if (!Number.isSafeInteger(n)) throw new Error(`Money value out of safe range: ${v}`);
    return n;
  },
};

export type Currency = "COP" | "USD";

export interface Money {
  amount: number; // integer minor units
  currency: Currency;
}

export const money = (amount: number, currency: Currency = "COP"): Money => {
  if (!Number.isSafeInteger(amount)) throw new Error("Money amount must be a safe integer");
  return { amount, currency };
};
