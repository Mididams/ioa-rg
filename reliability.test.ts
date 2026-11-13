// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { clearPending, loadPending, pendingKey, savePending } from "./pending-action";
import { parseReadTime, ServerClock } from "./server-clock";
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
  it("utilise readTime, pas la date de modification", () => {
    expect(parseReadTime([{ found: { updateTime: "2020-01-01T00:00:00Z" }, readTime: "2026-11-08T06:00:00Z" }])).toBe(Date.parse("2026-11-08T06:00:00Z"));
    expect(() => parseReadTime([{ error: "denied" }])).toThrow();
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
