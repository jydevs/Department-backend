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

  private prune(now: number): void {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
    if (this.hits.size >= RateWindow.MAX_KEYS) this.hits.clear();
  }
}
