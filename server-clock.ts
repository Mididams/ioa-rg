// Do not derive current server time from a document's last modification date.
// batchGet supplies readTime even when the document has not changed for days.
export function parseReadTime(payload: unknown): number {
  const rows = Array.isArray(payload) ? payload : [payload];
  const row = rows.find((value) => value && typeof value.readTime === "string");
  const time = Date.parse(row?.readTime ?? "");
  if (!Number.isFinite(time)) throw new Error("server_time_missing");
  return time;
}

export class ServerClock {
  private anchor: { server: number; monotonic: number } | null = null;
  constructor(private monotonic = () => performance.now()) {}
  calibrate(server: number, started: number, ended: number) {
    if (!Number.isFinite(server) || ended < started || ended - started > 2000) {
      throw new Error("server_time_uncertain");
    }
    // Midpoint estimate; error bounded approximately by half the round-trip.
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
