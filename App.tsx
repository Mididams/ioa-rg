import React, { useEffect, useRef, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  Timestamp,
  where,
  type DocumentData,
} from "firebase/firestore";
import { db, projectId, readServerTime } from "./firebase";
import { recordAction, type Action } from "./rotation";
import { clearPending, loadPending, pendingKey, savePending } from "./pending-action";
import { ServerClock } from "./server-clock";
export { nextStateFor } from "./rotation";

type ActionKind = "entry" | "reset";
type HubNumber = 1 | 2;
type Hub = { hub: HubNumber; lastSeq: number | null; lastAt: number | null; count: number; resetAt: number | null };
type CurrentState = { seq: number; lastRequestId: string; lastKind: ActionKind | null; lastHub: number | null; lastAt: number | null; globalResetAt: number | null; hubs: [Hub, Hub] };
type Daily = { startAt: number; endAt: number; count: number; previousCount: number };

const runtimeRef = doc(db, "runtime", "current");
const eventsRef = collection(db, "events");

export default function Home() {
  const [state, setState] = useState<CurrentState | null>(null);
  const [daily, setDaily] = useState<Daily>(() => dailyWindow(Date.now()));
  const [dailyEvents, setDailyEvents] = useState<DocumentData[]>([]);
  const [busy, setBusy] = useState(false);
  const [stickerClicks, setStickerClicks] = useState({ 1: 0, 2: 0 });
  const [restored] = useState(() => {
    try { return { action: loadPending(sessionStorage, pendingKey(projectId)), error: false }; }
    catch { return { action: null, error: true }; }
  });
  const [notice, setNotice] = useState(restored.action ? "Une action reste à vérifier après rechargement. Réessayez avec son identifiant conservé." : "");
  const [storageError, setStorageError] = useState(restored.error);
  const [reset, setReset] = useState<0 | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [clockReady, setClockReady] = useState(false);
  const pending = useRef<Action | null>(restored.action);

  const lock = useRef(false);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [eventsReady, setEventsReady] = useState(false);
  const [previousReady, setPreviousReady] = useState(false);
  const online = runtimeReady && eventsReady && previousReady && clockReady && !storageError;

  useEffect(() => onSnapshot(runtimeRef, { includeMetadataChanges: true }, (snapshot) => {
    setRuntimeReady(snapshot.exists() && !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites);
    if (!snapshot.exists()) { setNotice("État Rangueil non initialisé."); return; }
    if (!snapshot.metadata.hasPendingWrites) {
      const confirmed = readState(snapshot.data());
      setState(confirmed);
    }
  }, () => setRuntimeReady(false)), []);

  useEffect(() => {
    const source = new ServerClock();
    let stopped = false;
    let refreshing = false;
    let nextRefresh = 0;
    let previousWall = Date.now();
    let previousMono = performance.now();
    const publishTime = () => {
      const current = source.now();
      setNow(current); setClockReady(current !== null);
      if (current !== null) setDaily((value) => value.startAt === dailyWindow(current).startAt ? value : dailyWindow(current));
    };
    const refresh = async () => {
      if (refreshing || stopped) return;
      refreshing = true;
      const started = performance.now();
      try {
        const server = await readServerTime();
        if (stopped) return;
        source.calibrate(server, started, performance.now());
        nextRefresh = performance.now() + 5 * 60_000;
      } catch { nextRefresh = performance.now() + 60_000; }
      finally { refreshing = false; if (!stopped) publishTime(); }
    };
    void refresh();
    const clock = setInterval(() => {
      const wall = Date.now(), mono = performance.now();
      // Also detects sleep on browsers whose monotonic clock pauses while suspended.
      if (Math.abs((wall - previousWall) - (mono - previousMono)) > 2000) {
        source.invalidate(); nextRefresh = 0;
      }
      previousWall = wall; previousMono = mono;
      publishTime();
      if (mono >= nextRefresh) void refresh();
    }, 1000);
    const resume = () => {
      if (document.visibilityState === "visible") { source.invalidate(); publishTime(); void refresh(); }
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => { stopped = true; clearInterval(clock); document.removeEventListener("visibilitychange", resume); window.removeEventListener("online", resume); };
  }, []);

  useEffect(() => {
    if (!clockReady) { setEventsReady(false); setPreviousReady(false); return; }
    let stopped = false;
    setEventsReady(false); setPreviousReady(false); setDailyEvents([]);
    // Calendar boundaries, not minus 24 hours: Paris days can last 23 or 25 hours.
    const previous = dailyWindow(daily.startAt - 1);
    const unsubscribePrevious = onSnapshot(eventsBetween(previous.startAt, daily.startAt),
      { includeMetadataChanges: true }, (snapshot) => {
        if (stopped || snapshot.metadata.hasPendingWrites) return;
        setPreviousReady(!snapshot.metadata.fromCache);
        setDaily((value) => ({ ...value, previousCount: countEntries(snapshot.docs.map((item) => item.data())) }));
      }, () => setPreviousReady(false));
    const unsubscribe = onSnapshot(eventsBetween(daily.startAt, daily.endAt),
      { includeMetadataChanges: true }, (snapshot) => {
        if (stopped || snapshot.metadata.hasPendingWrites) return;
        const events = snapshot.docs.map((item) => item.data());
        setDailyEvents(events);
        setEventsReady(!snapshot.metadata.fromCache);
        setDaily((value) => ({ ...value, count: countEntries(events) }));
      }, () => setEventsReady(false));
    return () => { stopped = true; unsubscribe(); unsubscribePrevious(); };
  }, [daily.startAt, daily.endAt, clockReady]);

  const hubs = state?.hubs ?? emptyHubs();
  const queue = [...hubs].sort((a, b) => a.lastSeq === null && b.lastSeq === null ? a.hub - b.hub : a.lastSeq === null ? -1 : b.lastSeq === null ? 1 : a.lastSeq - b.lastSeq);
  const order = [...hubs].sort((a, b) => (a.lastSeq ?? -a.hub) - (b.lastSeq ?? -b.hub));
  const next = queue[0];
  const last = order[1]?.lastSeq === null ? null : order[1];
  const total = hubs.reduce((sum, hub) => sum + hub.count, 0);

  async function act(kind: ActionKind, hub: number) {
    if (lock.current || storageError || (!online && !pending.current)) return;
    lock.current = true;
    setBusy(true); setNotice("");
    try {
      const action = pending.current ?? { kind, hub, requestId: crypto.randomUUID() };
      // Persist before any network write. Fail closed when storage is unavailable.
      try { savePending(sessionStorage, pendingKey(projectId), action); }
      catch { setStorageError(true); throw new Error("storage_unavailable"); }
      pending.current = action;
      await withTimeout(recordAction(db, action), 10_000);
      try { clearPending(sessionStorage, pendingKey(projectId), action.requestId); }
      catch { setStorageError(true); throw new Error("storage_unavailable"); }
      pending.current = null; setReset(null);
      setNotice(action.kind === "entry" ? `Entrée enregistrée dans le Hub ${action.hub}.` : `Compteur${action.hub ? ` du Hub ${action.hub}` : "s"} remis à zéro.`);
    } catch {
      setReset(null);
      setNotice("Enregistrement non confirmé. Vérifiez la connexion puis réessayez : le même identifiant évitera un doublon.");
    } finally { lock.current = false; setBusy(false); }
  }

  function requestEntry(hub: HubNumber) {
    if (lock.current || !online || pending.current !== null) return;
    if (hub !== next.hub && !window.confirm(`La prochaine entrée devrait être Hub ${next.hub}. Valider quand même une entrée dans le Hub ${hub} ?`)) return;
    setStickerClicks((clicks) => ({ ...clicks, [hub]: clicks[hub] + 1 }));
    void act("entry", hub);
  }

  return (
    <>
      <header>
        <div className="brand">
          <span className="logo">+</span>
          <div>
            IOA <strong>Rangueil</strong>
            <small>URGENCES · ORIENTATION</small>
          </div>
        </div>
        <div className={"connection " + (online ? "ok" : "")}>
          <i />
          {online
            ? "Synchronisé · temps réel"
            : "Connexion en cours / interrompue"}
        </div>
      </header>
      <main>
      {storageError && <p role="alert">Stockage de session indisponible ou action sauvegardée illisible. Aucun nouvel enregistrement ne sera envoyé. Rétablissez le stockage puis rechargez la page.</p>}
      {!clockReady && <p role="status">Heure serveur en cours de vérification. Chronomètres et journée en attente.</p>}
        <div className="heading">
          <div>
            <div className="eyebrow">TABLEAU DE ROTATION</div>
            <h1>Une entrée. Un hub.</h1>
            <p>Cliquez sur le hub qui vient de recevoir une entrée.</p>
          </div>
          <div className="date">
            {now === null ? "—" : new Date(now).toLocaleDateString("fr-FR", {
              day: "numeric",
              month: "long",
              year: "numeric",
              timeZone: "Europe/Paris",
            })}
            <strong>
              {now === null ? "—" : new Date(now).toLocaleTimeString("fr-FR", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Europe/Paris",
              })}
            </strong>
          </div>
        </div>
        <section className="summary">
          <div className="next-icon">↗</div>
          <div>
            <small>PROCHAINE ENTRÉE</small>
            <strong>{state ? "Hub " + next.hub : "Chargement…"}</strong>
          </div>
          <div className="summary-detail">
            {last ? <>
              <small>DERNIÈRE ENTRÉE</small>
              <strong>Hub {last.hub}</strong>
            </> : "Première rotation : Hub 1 → Hub 2"}
          </div>
          <div className="totals">
            <div className="total">
            <strong>{state ? total : "—"}</strong>
            <span>
              {total > 1 ? "entrées" : "entrée"} depuis la réinitialisation
              <ResetDate at={state?.globalResetAt} />
            </span>
            </div>
            <div className="daily-total">
              {eventsReady ? <>
                Entrées depuis le {new Date(daily.startAt).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })} à 7h : <strong>{daily.count}</strong>
              </> : "Compteur quotidien en cours de chargement…"}
            </div>
            <div className="daily-total">
              Total entrées hier (7h - 7h) : <strong>{previousReady ? daily.previousCount : "—"}</strong>.
            </div>
          </div>
        </section>
        <section className="cards" aria-label="Enregistrer une entrée">
          {hubs.map((h) => {
            const rank = queue.findIndex((x) => x.hub === h.hub);
            const color = !state
              ? "neutral"
              : rank === 0
                ? "green"
                : h.hub === last?.hub
                  ? "red"
                  : "yellow";
            const label = !state
              ? "Chargement"
              : rank === 0
                ? "Prochain à prendre"
                : h.hub === last?.hub
                  ? "Dernière entrée"
                  : "En attente";
            return (
              <article key={h.hub} className={"card " + color}>
                <span
                  key={`sticker-${stickerClicks[h.hub]}`}
                  className={`hub-sticker hub-sticker--${h.hub}${stickerClicks[h.hub] ? " hub-sticker--placing" : ""}`}
                  aria-hidden="true"
                />
                <button
                  className="hub-action"
                  onClick={() => requestEntry(h.hub)}
                  disabled={!online || busy || pending.current !== null}
                  aria-label={"Enregistrer une entrée dans le Hub " + h.hub}
                >
                  <div className="card-top">
                    <span className="badge">
                      <i />
                      {label}
                    </span>
                    <span className="arrow">↗</span>
                  </div>
                  <h2>Hub {h.hub}</h2>
                  <div className="timer">{elapsed(h.lastAt, now)}</div>
                  <p>{busy && pending.current?.kind === "entry" && pending.current.hub === h.hub ? "Enregistrement en cours…" : "depuis la dernière entrée"}</p>
                  <div className="card-bottom">
                    <span>
                      <strong>{state ? h.count : "—"}</strong> {h.count > 1 ? "entrées" : "entrée"} depuis la réinitialisation
                      <ResetDate at={h.resetAt} />
                    </span>
                    <span className="add">+ 1 entrée</span>
                  </div>
                  <div className="hub-daily">
                    {eventsReady
                      ? <><strong>{dailyEvents.filter((event) => event.kind === "entry" && event.hub === h.hub).length}</strong>{` entrées depuis le ${formatDate(daily.startAt)} à 7h`}</>
                      : "Compteur quotidien en cours de chargement…"}
                  </div>
                </button>
              </article>
            );
          })}
        </section>
        <div className="legend">
          <span>
            <i className="dot green-dot" />
            Prochain hub
          </span>
          <span>
            <i className="dot yellow-dot" />
            En attente
          </span>
          <span>
            <i className="dot red-dot" />
            Dernier hub
          </span>
          <small>
            Chaque clic enregistre une entrée et actualise la rotation.
          </small>
        </div>
        <div className="notice" role="status">
          {notice}
          {pending.current && (
            <button
              disabled={busy}
              onClick={() => act(pending.current!.kind, pending.current!.hub)}
            >
              Réessayer l’enregistrement
            </button>
          )}
        </div>
        <section className="bottom">
          <div>
            <h3>Les entrées sont partagées entre tous les postes utilisant ce
              lien. Aucun renseignement patient n’est demandé.</h3>
          </div>
        </section>
        <section className="counter-help" aria-label="Fonctionnement des compteurs">
          <button
            className="reset-all"
            disabled={!online || busy || pending.current !== null}
            onClick={() => setReset(0)}
          >
            ↺ &nbsp; Réinitialiser tous les compteurs
          </button>
          <p>
            La réinitialisation des compteurs d’entrées est manuelle, à l’initiative des IOA (7 h / 19 h, par exemple).<br />
            Elle garde en mémoire la dernière entrée de chaque hub et les chronos. Seul le nombre d’entrées est remis à zéro.<br />
            Les compteurs des 24 h, de 7 h à 7 h, sont automatiques et ne sont pas affectés par la réinitialisation manuelle.
          </p>
        </section>
        <footer>
          <span>
            IOA Rangueil <b> / </b> Coordination des hubs
          </span>
          <nav className="legal-links" aria-label="Informations légales">
            <a href="./documents/mentions-legales.pdf" target="_blank" rel="noopener noreferrer" aria-label="Mentions légales (PDF, nouvel onglet)">
              Mentions légales
            </a>
            <a href="./documents/politique-confidentialite.pdf" target="_blank" rel="noopener noreferrer" aria-label="Politique de confidentialité (PDF, nouvel onglet)">
              Politique de confidentialité
            </a>
          </nav>
        </footer>
      </main>
      {reset !== null && (
        <div className="overlay">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-title"
            className="modal"
            onKeyDown={(e) => {
              if (e.key === "Escape" && !busy) setReset(null);
            }}
          >
            <span className="modal-icon">↺</span>
            <h2 id="reset-title">
              Réinitialiser tous les compteurs ?
            </h2>
            <p>
              La remise à zéro s’appliquera à tous les postes. Les chronomètres
              et l’ordre de rotation seront conservés. Les compteurs quotidiens et le total de la veille ne seront pas modifiés.
            </p>
            <div>
              <button autoFocus disabled={busy} onClick={() => setReset(null)}>
                Annuler
              </button>
              <button
                className="confirm"
                disabled={busy || pending.current !== null}
                onClick={() => act("reset", reset)}
              >
                {busy ? "Enregistrement…" : "Confirmer la remise à zéro"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export function emptyHubs(): [Hub, Hub] { return [1, 2].map((hub) => ({ hub: hub as HubNumber, lastSeq: null, lastAt: null, count: 0, resetAt: null })) as [Hub, Hub]; }
function readState(data: DocumentData): CurrentState { const toMillis = (value: unknown) => value instanceof Timestamp ? value.toMillis() : null; return { seq: data.seq, lastRequestId: data.lastRequestId, lastKind: data.lastKind ?? null, lastHub: data.lastHub ?? null, lastAt: toMillis(data.lastAt), globalResetAt: toMillis(data.globalResetAt), hubs: [1, 2].map((hub) => ({ hub: hub as HubNumber, count: data[`hub${hub}Count`], lastSeq: data[`hub${hub}LastSeq`] ?? null, lastAt: toMillis(data[`hub${hub}LastAt`]), resetAt: toMillis(data[`hub${hub}ResetAt`]) })) as [Hub, Hub] }; }
function eventsBetween(startAt: number, endAt: number) { return query(eventsRef, where("at", ">=", Timestamp.fromMillis(startAt)), where("at", "<", Timestamp.fromMillis(endAt))); }
function countEntries(events: DocumentData[]) { return events.filter((event) => event.kind === "entry").length; }
function formatDate(at: number | null | undefined) { return at === null || at === undefined ? "—" : new Date(at).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }); }
function elapsed(at: number | null, now: number | null) { if (at === null || now === null) return "— — : — —"; const seconds = Math.max(0, Math.floor((now - at) / 1000)); return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((x) => String(x).padStart(2, "0")).join(":"); }
function parisParts(date: Date) { return Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)])) as { year: number; month: number; day: number }; }
function parisBoundary(year: number, month: number, day: number) { const guess = Date.UTC(year, month - 1, day, 7); const zone = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", timeZoneName: "longOffset" }).formatToParts(new Date(guess)).find((part) => part.type === "timeZoneName")?.value ?? "GMT+01:00"; const match = zone.match(/GMT([+-])(\d\d):?(\d\d)/); const offset = match ? (Number(match[2]) * 60 + Number(match[3])) * (match[1] === "+" ? 1 : -1) : 60; return guess - offset * 60_000; }
export function dailyWindow(now: number): Daily { const parts = parisParts(new Date(now)); let year = parts.year; let month = parts.month; let day = parts.day; let start = parisBoundary(year, month, day); if (now < start) { const previous = new Date(Date.UTC(year, month - 1, day) - 86_400_000); year = previous.getUTCFullYear(); month = previous.getUTCMonth() + 1; day = previous.getUTCDate(); start = parisBoundary(year, month, day); } const next = new Date(Date.UTC(year, month - 1, day) + 86_400_000); const end = parisBoundary(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()); return { startAt: start, endAt: end, count: 0, previousCount: 0 }; }
export async function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

function ResetDate({ at }: { at: number | null | undefined }) {
  if (at === undefined) return <span className="reset-date">Date en cours de chargement…</span>;
  if (at === null) return <span className="reset-date">Aucune réinitialisation manuelle</span>;
  return <> le<span className="reset-date">{formatDate(at)} à {new Date(at).toLocaleTimeString("fr-FR", {
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris",
  })}</span></>;
}
