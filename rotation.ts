import { getDocFromServer, doc, runTransaction, serverTimestamp, type DocumentData, type Firestore } from "firebase/firestore";
export type Action = { kind: "entry" | "reset"; hub: number; requestId: string };
export const initialRuntime = {
  seq: 0, lastRequestId: "initial", lastKind: null, lastHub: null, lastAt: null, globalResetAt: null,
  hub1Count: 0, hub1LastSeq: null, hub1LastAt: null, hub1ResetAt: null,
  hub2Count: 0, hub2LastSeq: null, hub2LastAt: null, hub2ResetAt: null,
};
export async function recordAction(db: Firestore, action: Action) {
  if (!([1, 2].includes(action.hub) || (action.kind === "reset" && action.hub === 0))) throw new Error("invalid_hub");
  const runtimeRef = doc(db, "runtime/current");
  const eventRef = doc(db, "events", action.requestId);
  // Some concurrent commits surface a rule denial before the SDK retries a stale read.
  // Retry only when a server read proves that the shared sequence advanced.
  for (let attempt = 0; ; attempt++) {
    let readSeq: number | undefined;
    try { return await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(runtimeRef);
    const event = await transaction.get(eventRef);
    if (event.exists()) {
      if (event.data().kind !== action.kind || event.data().hub !== action.hub) throw new Error("request_conflict");
      return;
    }
    if (!snapshot.exists()) throw new Error("runtime_missing");
    const current = snapshot.data();
    readSeq = current.seq;
    const seq = current.seq + 1;
    const at = serverTimestamp();
    transaction.set(eventRef, { ...action, seq, at });
    transaction.update(runtimeRef, nextStateFor(current, action, seq, at));
    });
    } catch (error) {
      if (attempt >= 4 || readSeq === undefined || (error as { code?: string }).code !== "permission-denied") throw error;
      const latest = await getDocFromServer(runtimeRef);
      if (!latest.exists() || latest.data().seq <= readSeq) throw error;
    }
  }
}
export function nextStateFor(current: DocumentData, action: Action, seq: number, at: unknown) { const next: DocumentData = { ...current, seq, lastRequestId: action.requestId, lastKind: action.kind, lastHub: action.hub, lastAt: at }; if (action.kind === "entry") { next[`hub${action.hub}Count`] += 1; next[`hub${action.hub}LastSeq`] = seq; next[`hub${action.hub}LastAt`] = at; } else if (action.hub === 0) { next.hub1Count = 0; next.hub2Count = 0; next.globalResetAt = at; next.hub1ResetAt = at; next.hub2ResetAt = at; } else { next[`hub${action.hub}Count`] = 0; next[`hub${action.hub}ResetAt`] = at; } return next; }
