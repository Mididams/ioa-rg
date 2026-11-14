// Firestore readTime is a snapshot version, not a wall clock: it can lag by
// tens of seconds even on a fresh response. Use Google's HTTP Date instead.
// Firestore exposes Date to browser clients through CORS.
export function parseServerDate(date: string | null): number {
  const time = Date.parse(date ?? "");
  if (!Number.isFinite(time)) throw new Error("server_time_missing");
  // HTTP Date has one-second resolution; use the middle of that second.
  return time + 500;
}

export class ServerClock {
  private anchor: { server: number; monotonic: number } | null = null;
  constructor(private monotonic = () => performance.now()) {}
  calibrate(server: number, started: number, ended: number) {
    if (!Number.isFinite(server) || ended < started || ended - started > 2000) {
      throw new Error("server_time_uncertain");
    }
    // Midpoint estimate: allow half the round-trip plus HTTP Date's 500 ms
    // rounding uncertainty. Never use the workstation wall clock here.
    this.anchor = { server: server + (ended - started) / 2, monotonic: ended };
  }
  now(): number | null {
    if (!this.anchor) return null;
    const elapsed = this.monotonic() - this.anchor.monotonic;
    if (elapsed < 0 || elapsed > 10 * 60_000) return null;
    return this.anchor.server + elapsed;
  }
  invalidate() { this.anchor = null; }
}
