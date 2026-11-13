// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { dailyWindow, emptyHubs, nextStateFor } from "./App.tsx";

describe("Rangueil : deux hubs", () => {
  it("initialise uniquement les Hubs 1 et 2", () => {
    expect(emptyHubs().map((hub) => hub.hub)).toEqual([1, 2]);
  });

  it("met à jour le compteur du hub choisi sans toucher à l'autre", () => {
    const current = {
      seq: 3, lastRequestId: "old-request", lastKind: "entry", lastHub: 2, lastAt: null,
      globalResetAt: null,
      hub1Count: 1, hub1LastSeq: 1, hub1LastAt: null, hub1ResetAt: null,
      hub2Count: 2, hub2LastSeq: 3, hub2LastAt: null, hub2ResetAt: null,
    };
    const next = nextStateFor(current, { kind: "entry", hub: 1, requestId: "new-request" }, 4, "server-time");
    expect(next.hub1Count).toBe(2);
    expect(next.hub2Count).toBe(2);
    expect(next.hub1LastSeq).toBe(4);
  });

  it("bascule la fenêtre quotidienne à 7 h Europe/Paris", () => {
    const before = dailyWindow(Date.parse("2026-11-08T05:59:59Z"));
    const after = dailyWindow(Date.parse("2026-11-08T06:00:00Z"));
    expect(before.startAt).toBe(Date.parse("2026-11-07T06:00:00Z"));
    expect(after.startAt).toBe(Date.parse("2026-11-08T06:00:00Z"));
  });

  it("conserve une journée de 25 heures lors du changement d'heure", () => {
    const start = dailyWindow(Date.parse("2026-10-25T04:00:00Z"));
    expect(start.endAt - start.startAt).toBe(25 * 60 * 60 * 1000);
  });
});

describe("Paris : passage a l heure d ete", () => {
  it("calcule une fenetre de 23 heures", () => {
    const day = dailyWindow(Date.parse("2026-03-29T04:00:00Z"));
    expect(day.endAt - day.startAt).toBe(23 * 3600000);
    const following = dailyWindow(day.endAt);
    expect(dailyWindow(following.startAt - 1).startAt).toBe(day.startAt);
  });
});
