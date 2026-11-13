import { pathToFileURL } from "node:url";

export const target = "projects/ioa-rang/databases/(default)";
export const initialRuntime = Object.freeze({
  seq: 0, lastRequestId: "initial", lastKind: null, lastHub: null, lastAt: null, globalResetAt: null,
  hub1Count: 0, hub1LastSeq: null, hub1LastAt: null, hub1ResetAt: null,
  hub2Count: 0, hub2LastSeq: null, hub2LastAt: null, hub2ResetAt: null,
});
export const documentBody = { fields: Object.fromEntries(Object.entries(initialRuntime).map(([key, value]) => [key,
  value === null ? { nullValue: null } : typeof value === "number" ? { integerValue: String(value) } : { stringValue: value },
])) };

export function modeFor(args) {
  if (!args.length || (args.length === 1 && args[0] === "--dry-run")) return "preview";
  if (args.length === 1 && args[0] === "--check") return "check";
  if (args.length === 2 && args.includes("--apply") && args.includes("--confirm=ioa-rang")) return "apply";
  throw new Error("Usage: node scripts/initialize-runtime.mjs [--dry-run | --check | --apply --confirm=ioa-rang]");
}

export async function initialize({ mode = "preview", token = "", fetchImpl = fetch, log = console.log }) {
  if (!["preview", "check", "apply"].includes(mode)) throw new Error("Unknown mode");
  log(JSON.stringify({ mode, document: `${target}/documents/runtime/current`, values: initialRuntime }, null, 2));
  if (mode === "preview") return; // No network, credentials or writes by default.
  if (!token.trim() || /\s/.test(token.trim())) throw new Error("A single OAuth access token is required on stdin");
  const base = `https://firestore.googleapis.com/v1/${target}`;
  const headers = { Authorization: `Bearer ${token.trim()}`, "Content-Type": "application/json" };
  const request = (url, options = {}) => fetchImpl(url, { ...options, headers, redirect: "error", signal: AbortSignal.timeout(15000) });
  // Verify the database itself first: a missing database is not an empty database.
  const database = await request(base);
  if (!database.ok) throw new Error(`Database verification failed (HTTP ${database.status}); no write attempted`);
  const metadata = await database.json();
  if (metadata.name !== target || metadata.type !== "FIRESTORE_NATIVE" || metadata.databaseEdition !== "STANDARD") {
    throw new Error("Unexpected database identity/type/edition; no write attempted");
  }
  const existing = await request(`${base}/documents/runtime/current`);
  if (existing.ok) throw new Error("runtime/current already exists; refusing to overwrite it");
  if (existing.status !== 404) throw new Error(`Document check failed (HTTP ${existing.status}); no write attempted`);
  const events = await request(`${base}/documents/events?pageSize=1`);
  if (!events.ok) throw new Error(`History check failed (HTTP ${events.status}); no write attempted`);
  const history = await events.json();
  if (history.documents?.length || history.nextPageToken) throw new Error("Existing event history detected; initialization refused");
  if (mode === "check") { log("Checks passed; no write performed."); return; }
  // createDocument is atomic: even if another process creates the document after
  // our checks, Firestore refuses this POST. Never use set/update/PATCH here.
  let created;
  try {
    created = await request(`${base}/documents/runtime?documentId=current`, { method: "POST", body: JSON.stringify(documentBody) });
  } catch {
    throw new Error("Creation outcome uncertain. No automatic retry. Inspect runtime/current before continuing.");
  }
  if (created.status === 409) throw new Error("Concurrent creation detected; existing document was not overwritten");
  if (!created.ok) throw new Error(`Creation not confirmed (HTTP ${created.status}); inspect runtime/current before retrying`);
  // An error here must not lead to a reset or a replacement write.
  const verified = await request(`${base}/documents/runtime/current`);
  if (!verified.ok) throw new Error("Creation acknowledged, but readback failed; inspect the document, do not reset it");
  const actual = await verified.json();
  const sameFields = Object.keys(actual.fields ?? {}).length === Object.keys(documentBody.fields).length &&
    Object.entries(documentBody.fields).every(([key, value]) => JSON.stringify(actual.fields[key]) === JSON.stringify(value));
  if (actual.name !== `${target}/documents/runtime/current` || !sameFields) {
    throw new Error("Document created but readback differs (possibly already used); no corrective write performed");
  }
  log("Created and verified ioa-rang/(default)/runtime/current. No other document written.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const mode = modeFor(process.argv.slice(2));
    if (mode !== "preview" && process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Unset FIRESTORE_EMULATOR_HOST before production checks");
    let token = "";
    if (mode !== "preview") {
      if (process.stdin.isTTY) throw new Error("Pipe an OAuth access token on stdin; do not put it in arguments or files");
      for await (const chunk of process.stdin) token += chunk;
    }
    await initialize({ mode, token });
  } catch (error) {
    // Never dump HTTP headers, credentials, or full error objects.
    console.error(error instanceof Error ? error.message : "Initialization failed");
    process.exitCode = 1;
  }
}
