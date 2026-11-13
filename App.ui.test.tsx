// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase/firestore";
import App, { dailyWindow } from "./App.tsx";
import { initialRuntime } from "./rotation";
import { loadPending, pendingKey } from "./pending-action";

const mocks = vi.hoisted(() => ({ record: vi.fn(), readTime: vi.fn(), listeners: [] as { target: any; callback: any; error: any; stop: ReturnType<typeof vi.fn> }[] }));
vi.mock("./firebase", () => ({ db: {}, projectId: "demo-ioa-rang", readServerTime: mocks.readTime }));
vi.mock("./rotation", async (original) => ({ ...await original<typeof import("./rotation")>(), recordAction: mocks.record }));
vi.mock("firebase/firestore", async (original) => ({
  ...await original<typeof import("firebase/firestore")>(),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join("/") }),
  collection: (_db: unknown, path: string) => ({ path }),
  query: (ref: unknown, ...filters: unknown[]) => ({ ref, filters }),
  onSnapshot: (target: unknown, _options: unknown, callback: unknown, error: unknown) => {
    const stop = vi.fn(); mocks.listeners.push({ target, callback, error, stop }); return stop;
  },
}));
const time = Date.parse("2026-11-08T08:00:00Z");
const snapshot = (data: object, fromCache = false) => ({ exists: () => true, data: () => data, metadata: { fromCache, hasPendingWrites: false } });
const events = (data: object[]) => ({ docs: data.map((value) => ({ data: () => value })), metadata: { fromCache: false, hasPendingWrites: false } });
async function mount() {
  await act(async () => { render(<App />); });
  await act(async () => {
    mocks.listeners[0].callback(snapshot(initialRuntime));
    mocks.listeners[1].callback(events([{ kind: "entry", hub: 2 }]));
    mocks.listeners[2].callback(events([{ kind: "entry", hub: 1 }]));
  });
}
beforeEach(() => { sessionStorage.clear(); mocks.readTime.mockReset().mockImplementation(async () => Date.now()); vi.useFakeTimers(); vi.setSystemTime(time); mocks.listeners.length = 0; mocks.record.mockReset().mockResolvedValue(undefined); });
afterEach(() => { cleanup(); sessionStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe("Interface Rangueil", () => {
  it("restaure l'action après rechargement et efface son identifiant uniquement après confirmation", async () => {
    await mount(); mocks.record.mockRejectedValueOnce(new Error("uncertain"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Enregistrer une entrée dans le Hub 1" })));
    const saved = loadPending(sessionStorage, pendingKey("demo-ioa-rang"));
    expect(saved).toEqual(mocks.record.mock.calls[0][1]);
    cleanup(); mocks.listeners.length = 0;
    await mount();
    expect(screen.getByText(/Une action reste à vérifier/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Enregistrer une entrée dans le Hub 2" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Réessayer l’enregistrement" })));
    expect(mocks.record.mock.calls[1][1]).toEqual(saved);
    expect(loadPending(sessionStorage, pendingKey("demo-ioa-rang"))).toBeNull();
  });
  it("n'envoie rien si la sauvegarde locale échoue", async () => {
    await mount();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Enregistrer une entrée dans le Hub 1" })));
    expect(mocks.record).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Stockage");
  });
  it("utilise le jour et les chronos serveur malgré un poste décalé de deux jours", async () => {
    vi.setSystemTime(time + 2 * 86400000);
    mocks.readTime.mockResolvedValue(time);
    await mount();
    await act(async () => mocks.listeners[0].callback(snapshot({ ...initialRuntime, hub1LastAt: Timestamp.fromMillis(time - 60000) })));
    expect(screen.getByText("00:01:00")).toBeTruthy();
    expect(screen.getByText((_, element) => element?.className === "hub-daily" && element.textContent === "1 entrées depuis le 08/11/2026 à 7h")).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(screen.getByText("00:01:01")).toBeTruthy();
  });
  it("masque les temps et bloque les nouvelles actions sans heure serveur", async () => {
    mocks.readTime.mockRejectedValue(new Error("offline"));
    await act(async () => { render(<App />); });
    await act(async () => mocks.listeners[0].callback(snapshot(initialRuntime)));
    expect(screen.getByText(/Heure serveur en cours/)).toBeTruthy();
    expect(mocks.listeners).toHaveLength(1);
    expect((screen.getByRole("button", { name: "Enregistrer une entrée dans le Hub 1" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("affiche deux hubs, la rotation et les totaux quotidiens", async () => {
    await mount();
    expect(document.querySelectorAll(".card")).toHaveLength(2);
    expect(screen.getByText("Prochain à prendre").closest("article")?.textContent).toContain("Hub 1");
    expect(screen.getByText((_, element) => element?.className === "hub-daily" && element.textContent === "1 entrées depuis le 08/11/2026 à 7h")).toBeTruthy();
    expect(screen.queryByText("Hub 3")).toBeNull();
    expect(screen.getByText("Rangueil")).toBeTruthy();
  });
  it("annule une entrée hors rotation sans écriture", async () => {
    await mount(); const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer une entrée dans le Hub 2" }));
    expect(confirm).toHaveBeenCalledOnce(); expect(mocks.record).not.toHaveBeenCalled();
  });
  it("confirme une entrée hors rotation", async () => {
    await mount(); vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Enregistrer une entrée dans le Hub 2" })));
    expect(mocks.record.mock.calls[0][1]).toMatchObject({ kind: "entry", hub: 2 });
  });
  it("réessaie après erreur avec le même identifiant, même hors ligne", async () => {
    await mount(); mocks.record.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: /Réinitialiser tous les compteurs/ }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Confirmer la remise à zéro" })));
    await act(async () => mocks.listeners[0].error(new Error("offline")));
    expect((screen.getByRole("button", { name: "Enregistrer une entrée dans le Hub 1" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Réessayer l’enregistrement" })));
    expect(mocks.record.mock.calls[1][1]).toEqual(mocks.record.mock.calls[0][1]);
    expect(screen.getByText("Compteurs remis à zéro.")).toBeTruthy();
  });
  it("conserve chronos et compteurs du jour après reset synchronisé", async () => {
    await mount(); const lastAt = Timestamp.fromMillis(time - 60000);
    await act(async () => mocks.listeners[0].callback(snapshot({ ...initialRuntime, hub1Count: 4, hub1LastAt: lastAt, hub1LastSeq: 1 })));
    expect(screen.getByText("00:01:00")).toBeTruthy();
    await act(async () => mocks.listeners[0].callback(snapshot({ ...initialRuntime, hub1LastAt: lastAt, hub1LastSeq: 1, globalResetAt: Timestamp.fromMillis(time) })));
    expect(screen.getByText("00:01:00")).toBeTruthy();
    expect(screen.getByText((_, element) => element?.className === "hub-daily" && element.textContent === "1 entrées depuis le 08/11/2026 à 7h")).toBeTruthy();
  });
  it("désactive les actions quand seul le cache est disponible", async () => {
    await mount(); await act(async () => mocks.listeners[0].callback(snapshot(initialRuntime, true)));
    expect((screen.getByRole("button", { name: "Enregistrer une entrée dans le Hub 1" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("change de journée à 7h et détache les anciens abonnements", async () => {
    vi.setSystemTime(Date.parse("2026-10-25T05:59:59Z")); await mount();
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(mocks.listeners[1].stop).toHaveBeenCalledOnce(); expect(mocks.listeners[2].stop).toHaveBeenCalledOnce();
    expect(mocks.listeners).toHaveLength(5);
    const current = dailyWindow(Date.now()); const previous = dailyWindow(current.startAt - 1);
    expect(current.startAt - previous.startAt).toBe(25 * 3600000);
  });
  it("rend possible le réessai après expiration sans lancer une autre action", async () => {
    await mount(); mocks.record.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Enregistrer une entrée dans le Hub 1" })));
    await act(async () => vi.advanceTimersByTimeAsync(10001));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Réessayer l’enregistrement" })));
    expect(mocks.record.mock.calls[1][1]).toEqual(mocks.record.mock.calls[0][1]);
  });
});

