import { normalizeIp } from "../net/ip";

/**
 * Login failure accounting per (account, IP), so a stranger cannot lock the owner out of their own account.
 *
 *  - Pair lock: PAIR_MAX_FAILS failures of one account from ONE IP lock that pair for PAIR_LOCK_MS. Other IPs are unaffected.
 *  - Global brake: GLOBAL_THRESHOLD failures on one account within GLOBAL_WINDOW_MS (any IP) start an increasing back-off
 *    (BACKOFF_BASE_MS doubling every GLOBAL_STEP further failures, capped at BACKOFF_MAX_MS) for IPs that have NOT logged in
 *    successfully to that account in the last KNOWN_IP_MS. It never becomes a hard lock, and the owner's usual IPs are exempt.
 *
 * Callers answer INVALID_CREDENTIALS in every blocked case (no oracle) and do not record failures while blocked
 * (an attacker cannot extend a lock by hammering it).
 *
 * IPs are normalised with normalizeIp (IPv6 -> /64, ::ffff:a.b.c.d -> a.b.c.d), the same key the throttler uses.
 *
 * Known limitation: the global brake is evaluated with a read (SUM of recent failures) before the attempt, so a burst of
 * truly parallel requests can slip a few attempts past the threshold. The per-IP throttler (5 logins/min) bounds it and the
 * per-(account, IP) lock is a single atomic upsert, so the cost is a handful of extra guesses, not an unlimited oracle.
 */
export type LoginScope = "staff" | "customer";

/** Why an attempt is refused: "pair" = this (account, IP) is locked; "global" = the account-wide back-off against an IP that is not known. */
export type LoginBlock = "pair" | "global";

interface QueryRunnerLike {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

export const PAIR_MAX_FAILS = 5;
export const PAIR_LOCK_MS = 15 * 60 * 1000;
export const GLOBAL_THRESHOLD = 30;
export const GLOBAL_STEP = 5;
export const GLOBAL_WINDOW_MS = 15 * 60 * 1000;
export const BACKOFF_BASE_MS = 30 * 1000;
export const BACKOFF_MAX_MS = 15 * 60 * 1000;
export const KNOWN_IP_MS = 30 * 24 * 60 * 60 * 1000;
export const LOGIN_ATTEMPTS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const normIp = normalizeIp;

/** Back-off (ms) owed after `failures` recent failures on the account; 0 below the threshold. */
export function backoffMs(failures: number): number {
  if (failures < GLOBAL_THRESHOLD) return 0;
  const exp = Math.floor((failures - GLOBAL_THRESHOLD) / GLOBAL_STEP);
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(exp, 20));
}

/** true = this attempt must be refused (pair locked, or global back-off against an unknown IP). Read-only. */
export async function isLoginBlocked(runner: QueryRunnerLike, scope: LoginScope, accountId: string, ip: string | undefined, now: Date): Promise<boolean> {
  return (await loginBlock(runner, scope, accountId, ip, now)) !== null;
}

/** Like isLoginBlocked but says WHICH brake applies, so staff login can let a holder of password + 2FA through the global one. */
export async function loginBlock(runner: QueryRunnerLike, scope: LoginScope, accountId: string, ip: string | undefined, now: Date): Promise<LoginBlock | null> {
  const rows = (await runner.query(
    `SELECT
       (SELECT locked_until FROM login_attempts WHERE scope = $1 AND account_id = $2 AND ip = $3) AS pair_locked_until,
       (SELECT last_success_at FROM login_attempts WHERE scope = $1 AND account_id = $2 AND ip = $3) AS pair_last_success_at,
       COALESCE(SUM(fail_count) FILTER (WHERE last_failure_at > $4), 0)::int AS recent_failures,
       MAX(last_failure_at) FILTER (WHERE last_failure_at > $4) AS last_failure_at
     FROM login_attempts WHERE scope = $1 AND account_id = $2`,
    [scope, accountId, normIp(ip), new Date(now.getTime() - GLOBAL_WINDOW_MS)],
  )) as Array<{ pair_locked_until: Date | null; pair_last_success_at: Date | null; recent_failures: number; last_failure_at: Date | null }>;
  const r = rows[0];
  if (!r) return null;
  if (r.pair_locked_until && new Date(r.pair_locked_until) > now) return "pair";
  const wait = backoffMs(r.recent_failures);
  if (wait > 0 && r.last_failure_at) {
    const known = r.pair_last_success_at && now.getTime() - new Date(r.pair_last_success_at).getTime() < KNOWN_IP_MS;
    if (!known && now.getTime() < new Date(r.last_failure_at).getTime() + wait) return "global";
  }
  return null;
}

/** Counts one failure for (account, IP) in a single atomic upsert (parallel guesses cannot undercount). */
export async function recordLoginFailure(runner: QueryRunnerLike, scope: LoginScope, accountId: string, ip: string | undefined, now: Date): Promise<void> {
  const next =
    "CASE WHEN login_attempts.last_failure_at IS NULL OR login_attempts.last_failure_at <= $5 OR (login_attempts.locked_until IS NOT NULL AND login_attempts.locked_until <= $4) THEN 1 ELSE login_attempts.fail_count + 1 END";
  await runner.query(
    `INSERT INTO login_attempts (scope, account_id, ip, fail_count, last_failure_at, locked_until, updated_at)
     VALUES ($1, $2, $3, 1, $4, NULL, $4)
     ON CONFLICT (scope, account_id, ip) DO UPDATE SET
       fail_count = ${next},
       locked_until = CASE WHEN (${next}) >= ${PAIR_MAX_FAILS} THEN $6::timestamptz ELSE NULL END,
       last_failure_at = $4,
       updated_at = $4`,
    [scope, accountId, normIp(ip), now, new Date(now.getTime() - GLOBAL_WINDOW_MS), new Date(now.getTime() + PAIR_LOCK_MS)],
  );
}

/** A successful login clears the pair's failures and remembers the IP as known. */
export async function recordLoginSuccess(runner: QueryRunnerLike, scope: LoginScope, accountId: string, ip: string | undefined, now: Date): Promise<void> {
  await runner.query(
    `INSERT INTO login_attempts (scope, account_id, ip, fail_count, last_failure_at, locked_until, last_success_at, updated_at)
     VALUES ($1, $2, $3, 0, NULL, NULL, $4, $4)
     ON CONFLICT (scope, account_id, ip) DO UPDATE SET
       fail_count = 0, last_failure_at = NULL, locked_until = NULL, last_success_at = $4, updated_at = $4`,
    [scope, accountId, normIp(ip), now],
  );
}

/** Password reset / change: forget every failure of the account (known IPs are kept). */
export async function clearLoginFailures(runner: QueryRunnerLike, scope: LoginScope, accountId: string): Promise<void> {
  await runner.query(
    "UPDATE login_attempts SET fail_count = 0, last_failure_at = NULL, locked_until = NULL WHERE scope = $1 AND account_id = $2",
    [scope, accountId],
  );
}
