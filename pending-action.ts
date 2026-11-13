import type { Action } from "./rotation";

export function pendingKey(projectId: string) {
  return `ioa-rang:${projectId}:pending:v1`;
}

export function loadPending(storage: Storage, key: string): Action | null {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  const action = JSON.parse(raw) as Action;
  if (!action || !["entry", "reset"].includes(action.kind) ||
    !Number.isInteger(action.hub) ||
    !(action.hub === 1 || action.hub === 2 || (action.kind === "reset" && action.hub === 0)) ||
    typeof action.requestId !== "string" || !/^[\w-]{11,99}$/.test(action.requestId)) {
    throw new Error("invalid_pending_action");
  }
  return { kind: action.kind, hub: action.hub, requestId: action.requestId };
}

export function savePending(storage: Storage, key: string, action: Action) {
  const encoded = JSON.stringify(action);
  storage.setItem(key, encoded);
  if (storage.getItem(key) !== encoded) throw new Error("pending_not_persisted");
}

export function clearPending(storage: Storage, key: string, requestId: string) {
  const stored = loadPending(storage, key);
  if (stored && stored.requestId !== requestId) throw new Error("pending_changed");
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error("pending_not_cleared");
}
