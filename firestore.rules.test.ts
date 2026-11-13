import { readFile } from "node:fs/promises";
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, where, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch, type DocumentData, type Firestore } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initialRuntime, nextStateFor, recordAction } from "./rotation";

let env: RulesTestEnvironment;
// Never use a production project. This suite refuses to run without an emulator.
describe("Firestore sans authentification (émulateur uniquement)", () => {
  it("fournit une heure de lecture REST publique sans écriture ni authentification", async () => {
    const database = "projects/demo-ioa-rang/databases/(default)";
    const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/${database}/documents:batchGet`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documents: [`${database}/documents/runtime/current`], mask: { fieldPaths: ["seq"] } }),
    });
    expect(response.ok).toBe(true);
    const rows = await response.json();
    expect(Number.isFinite(Date.parse(rows[0].readTime))).toBe(true);
    expect((await getDoc(doc(db(), "runtime/current"))).data()?.seq).toBe(0);
  });
  it("ordonne deux postes simultanés sur des hubs différents et un réessai après rechargement", async () => {
    const one = action("request-two-posts-1", 1), two = action("request-two-posts-2", 2);
    await Promise.all([recordAction(db(), one), recordAction(db(), two)]);
    // Fresh client, same durable request ID: equivalent to a reloaded tab.
    await recordAction(db(), JSON.parse(JSON.stringify(one)));
    const state = (await getDoc(doc(db(), "runtime/current"))).data()!;
    expect(state).toMatchObject({ seq: 2, hub1Count: 1, hub2Count: 1 });
    expect([state.hub1LastSeq, state.hub2LastSeq].sort()).toEqual([1, 2]);
    expect((await getDocs(collection(db(), "events"))).size).toBe(2);
    expect(state.lastHub).toBe(state.hub1LastSeq === 2 ? 1 : 2);
  });
  beforeAll(async () => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Run npm run test:emulator; an emulator is required");
    env = await initializeTestEnvironment({ projectId: "demo-ioa-rang", firestore: { rules: await readFile("firestore.rules", "utf8") } });
  });
  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "runtime/current"), initialRuntime));
  });
  afterAll(async () => { await env?.cleanup(); });
  const db = () => env.unauthenticatedContext().firestore() as unknown as Firestore;
  const action = (id: string, hub = 1, kind: "entry" | "reset" = "entry") => ({ requestId: id, hub, kind });
  async function forged(eventPatch: DocumentData = {}, statePatch: DocumentData = {}, remove?: string) {
    const client = db(); const a = action("request-forged-001"); const at = serverTimestamp();
    const event = { ...a, seq: 1, at, ...eventPatch };
    const state = { ...nextStateFor(initialRuntime, a, 1, at), ...statePatch };
    if (remove) delete state[remove];
    const batch = writeBatch(client);
    batch.set(doc(client, "events", a.requestId), event);
    batch.update(doc(client, "runtime/current"), state);
    return batch.commit();
  }
  it("autorise uniquement les lectures attendues", async () => {
    const client = db();
    await assertSucceeds(getDoc(doc(client, "runtime/current")));
    await assertSucceeds(getDoc(doc(client, "events/missing-request")));
    await assertSucceeds(getDocs(query(collection(client, "events"), where("at", ">=", Timestamp.fromMillis(0)), where("at", "<", Timestamp.now()))));
    await assertFails(getDocs(collection(client, "runtime")));
    await assertFails(getDoc(doc(client, "private/secret")));
    await assertFails(setDoc(doc(client, "runtime/other"), initialRuntime));
    await assertFails(setDoc(doc(client, "runtime/current/nested/test"), { value: 1 }));
  });
  it("enregistre les deux hubs et les diffuse à un second poste", async () => {
    const observer = db();
    const received = new Promise<DocumentData>((resolve, reject) => {
      const stop = onSnapshot(doc(observer, "runtime/current"), (snap) => {
        if (snap.data()?.seq === 2) { stop(); resolve(snap.data()!); }
      }, reject);
    });
    await recordAction(db(), action("request-entry-hub1"));
    await recordAction(db(), action("request-entry-hub2", 2));
    expect(await received).toMatchObject({ seq: 2, hub1Count: 1, hub2Count: 1, hub1LastSeq: 1, hub2LastSeq: 2 });
  });
  it.each([0, 1, 2])("remet à zéro %i sans effacer chronos, rotation ni historique", async (hub) => {
    const client = db();
    await recordAction(client, action("request-before-hub1"));
    await recordAction(client, action("request-before-hub2", 2));
    const before = (await getDoc(doc(client, "runtime/current"))).data()!;
    await assertSucceeds(recordAction(client, action("request-reset-all", hub, "reset")));
    const after = (await getDoc(doc(client, "runtime/current"))).data()!;
    expect(after.hub1Count).toBe(hub === 2 ? 1 : 0);
    expect(after.hub2Count).toBe(hub === 1 ? 1 : 0);
    for (const key of ["hub1LastAt", "hub2LastAt", "hub1LastSeq", "hub2LastSeq"]) expect(after[key]).toEqual(before[key]);
    expect((await getDocs(collection(client, "events"))).docs.filter((d) => d.data().kind === "entry")).toHaveLength(2);
  });
  it("sérialise les entrées concurrentes sans perte", async () => {
    await Promise.all(Array.from({ length: 4 }, (_, i) => recordAction(db(), action(`request-concurrent-${i}`, i % 2 + 1))));
    expect((await getDoc(doc(db(), "runtime/current"))).data()).toMatchObject({ seq: 4, hub1Count: 2, hub2Count: 2 });
  });
  it("déduplique un réessai concurrent et tardif", async () => {
    const a = action("request-retry-same");
    await Promise.all([recordAction(db(), a), recordAction(db(), a)]);
    await recordAction(db(), action("request-other-next", 2));
    await recordAction(db(), a);
    expect((await getDoc(doc(db(), "runtime/current"))).data()?.seq).toBe(2);
    await expect(recordAction(db(), { ...a, hub: 2 })).rejects.toThrow("request_conflict");
  });
  it.each([
    ["hub 3", { hub: 3 }, { lastHub: 3 }],
    ["fraction", { seq: 1.5 }, { seq: 1.5 }],
    ["sequence sautée", { seq: 2 }, { seq: 2, hub1LastSeq: 2 }],
    ["identifiant différent", { requestId: "request-another-id" }, {}],
    ["identifiant trop long", { requestId: "x".repeat(100) }, {}],
    ["champ événement ajouté", { extra: true }, {}],
    ["champ état ajouté", {}, { extra: true }],
    ["compteur négatif", {}, { hub1Count: -1 }],
    ["compteur fractionnaire", {}, { hub1Count: 1.5 }],
    ["type incorrect", {}, { hub1Count: "1" }],
    ["incrément excessif", {}, { hub1Count: 100 }],
    ["autre hub altéré", {}, { hub2Count: 1 }],
    ["chrono autre hub altéré", {}, { hub2LastAt: serverTimestamp() }],
    ["reset injecté", {}, { globalResetAt: serverTimestamp() }],
    ["date falsifiée", { at: Timestamp.fromMillis(0) }, {}],
    ["action inconnue", { kind: "delete" }, { lastKind: "delete" }],
  ])("refuse une transaction : %s", async (_name, event, state) => { await assertFails(forged(event as DocumentData, state as DocumentData)); });
  it("refuse les champs requis absents", async () => {
    const client = db(); const batch = writeBatch(client); const a = action("request-missing-field");
    const state = nextStateFor(initialRuntime, a, 1, serverTimestamp()); delete state.hub1Count;
    batch.set(doc(client, "events", a.requestId), { ...a, seq: 1, at: serverTimestamp() });
    batch.set(doc(client, "runtime/current"), state);
    await assertFails(batch.commit());
  });
  it("refuse les écritures isolées et les événements modifiables", async () => {
    const client = db();
    await assertFails(updateDoc(doc(client, "runtime/current"), nextStateFor(initialRuntime, action("request-orphan-state"), 1, serverTimestamp())));
    await assertFails(setDoc(doc(client, "events/request-orphan-event"), { ...action("request-orphan-event"), seq: 1, at: serverTimestamp() }));
    await recordAction(client, action("request-immutable"));
    await assertFails(updateDoc(doc(client, "events/request-immutable"), { hub: 2 }));
    await assertFails(deleteDoc(doc(client, "events/request-immutable")));
    await assertFails(deleteDoc(doc(client, "runtime/current")));
  });
  it("interdit l'initialisation publique", async () => {
    await env.clearFirestore();
    await assertFails(setDoc(doc(db(), "runtime/current"), initialRuntime));
  });
});
