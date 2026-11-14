// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearPending, loadPending, pendingKey, savePending } from "./pending-action";
import { parseServerDate, ServerClock } from "./server-clock";
import { readServerTime } from "./firebase";
import { dailyWindow } from "./App.tsx";

describe("Journal de l'onglet", () => {
  const key = pendingKey("demo-ioa-rang");
  const action = { kind: "entry" as const, hub: 1, requestId: "request-reload-123" };
  beforeEach(() => sessionStorage.clear());
  it("conserve exactement l'action et isole émulation et production", () => {
    savePending(sessionStorage, key, action);
    expect(loadPending(sessionStorage, key)).toEqual(action);
    expect(loadPending(sessionStorage, pendingKey("ioa-rang"))).toBeNull();
  });
  it("ne supprime pas une autre action", () => {
    savePending(sessionStorage, key, action);
    expect(() => clearPending(sessionStorage, key, "another-request")).toThrow();
    expect(loadPending(sessionStorage, key)).toEqual(action);
  });
  it("ne remplace pas silencieusement une action illisible", () => {
    sessionStorage.setItem(key, '{"kind":"entry","hub":3}');
    expect(() => loadPending(sessionStorage, key)).toThrow();
    expect(sessionStorage.getItem(key)).not.toBeNull();
  });
});

describe("Horloge serveur", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("utilise la date HTTP actuelle même si readTime est en retard de 64 secondes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { readTime: "2026-11-14T16:36:31.804062Z" },
    ]), { headers: { date: "Sat, 14 Nov 2026 16:37:35 GMT" } })));
    expect(await readServerTime()).toBe(Date.parse("2026-11-14T16:37:35.500Z"));
  });
  it("refuse une date HTTP absente plutôt que de revenir à readTime", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { readTime: "2026-11-14T16:36:31.804062Z" },
    ]))));
    await expect(readServerTime()).rejects.toThrow("server_time_missing");
    expect(() => parseServerDate("invalid")).toThrow();
  });
  it("retrouve le même temps après rechargement malgré une version de lecture inchangée", async () => {
    const body = JSON.stringify([{ readTime: "2026-11-14T16:36:31.804062Z" }]);
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(body, { headers: { date: "Sat, 14 Nov 2026 16:37:35 GMT" } }))
      .mockResolvedValueOnce(new Response(body, { headers: { date: "Sat, 14 Nov 2026 16:38:05 GMT" } })));
    let mono = 0;
    const first = new ServerClock(() => mono);
    first.calibrate(await readServerTime(), 0, 0);
    mono = 30000;
    const reloaded = new ServerClock(() => 0);
    reloaded.calibrate(await readServerTime(), 0, 0);
    expect(reloaded.now()).toBe(first.now());
  });
  it("avance avec le temps monotone et bascule à 7 h", () => {
    let mono = 100;
    const clock = new ServerClock(() => mono);
    const before = Date.parse("2026-11-08T05:59:59Z");
    clock.calibrate(before, 100, 100);
    expect(dailyWindow(clock.now()!).startAt).toBe(Date.parse("2026-11-07T06:00:00Z"));
    mono += 1000;
    expect(dailyWindow(clock.now()!).startAt).toBe(Date.parse("2026-11-08T06:00:00Z"));
  });
  it("refuse un aller-retour trop lent et expire après dix minutes", () => {
    let mono = 0;
    const clock = new ServerClock(() => mono);
    expect(() => clock.calibrate(10000, 0, 2001)).toThrow();
    expect(clock.now()).toBeNull();
    clock.calibrate(10000, 0, 0);
    mono = 600001;
    expect(clock.now()).toBeNull();
  });
});
