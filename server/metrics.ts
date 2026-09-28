export class Metrics {
  private readonly startedAt = Date.now();
  private readonly counters = new Map<string, number>();

  increment(name: string, value = 1) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
  }

  snapshot() {
    return {
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      counters: Object.fromEntries(this.counters.entries()),
    };
  }
}
