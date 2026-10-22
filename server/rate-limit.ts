export class FixedWindowRateLimit {
  private readonly buckets = new Map<string, { count: number; until: number }>();
  constructor(
    private readonly limit = 35,
    private readonly windowMs = 60_000,
    private readonly now = Date.now,
  ) {}
  allow(key: string) {
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.until <= now) {
      bucket = { count: 0, until: now + this.windowMs };
      this.buckets.set(key, bucket);
    }
    return ++bucket.count <= this.limit;
  }
  cleanup() {
    const now = this.now();
    for (const [key, bucket] of this.buckets) if (bucket.until <= now) this.buckets.delete(key);
  }
}
