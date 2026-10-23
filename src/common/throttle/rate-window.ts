/**
 * Tiny in-memory fixed-window counter for limits that need a custom key (e.g. IP + cart) on top of the global throttler.
 * Per process: with several instances the effective limit is multiplied by the instance count (acceptable for an anti-guessing brake).
 * The map is pruned lazily and capped, so spraying random keys cannot grow memory without bound.
 */
export class RateWindow {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private static readonly MAX_KEYS = 50_000;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Counts one hit; returns false (and does not need to be undone) when the key already used its quota. */
  hit(key: string, now = Date.now()): boolean {
    if (this.hits.size >= RateWindow.MAX_KEYS) this.prune(now);
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    cur.count += 1;
    return cur.count <= this.limit;
  }

  /** Whole seconds (>= 1) until the key's window resets; 1 when the key has no window. For the Retry-After header. */
  retryAfterSeconds(key: string, now = Date.now()): number {
    const cur = this.hits.get(key);
    return cur && cur.resetAt > now ? Math.max(1, Math.ceil((cur.resetAt - now) / 1000)) : 1;
  }

  /**
   * Drop expired windows; if the map is still full, evict the OLDEST entries (Map keeps insertion order) instead of
   * clearing everything: an attacker spraying keys must not reset the counters of honest, currently limited visitors.
   */
  private prune(now: number): void {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
    let excess = this.hits.size - Math.floor(RateWindow.MAX_KEYS * 0.9);
    if (excess <= 0) return;
    for (const k of this.hits.keys()) {
      this.hits.delete(k);
      if (--excess <= 0) break;
    }
  }
}
