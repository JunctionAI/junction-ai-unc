import { artifactHeaders } from "../artifacts/client";
import type { AgentContext } from "../agents/client";

export type ManualJournal = {
  requestId: string;
  path: string;
  accountId: string;
  contextGeneration: number;
  actorId: string;
  routineId: string;
};
export const MANUAL_JOURNAL_EVENT = "unc-manual-journal";
const purposeFor = (path: string) => ({
  "/api/routines/run": "run",
  "/api/routines/params": "validate",
  "/api/routines/resume-input": "input",
}[path]);
export const manualJournalKey = (ctx: AgentContext, routineId: string, purpose: string) =>
  `unc:manual:v2:${encodeURIComponent(ctx.actorId ?? "")}:${encodeURIComponent(ctx.accountId)}:${ctx.contextGeneration}:${routineId}:${purpose}`;
const notify = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event(MANUAL_JOURNAL_EVENT)); };
export function clearManualJournal(key: string) { sessionStorage.removeItem(key); notify(); }

export function loadManualJournal(key: string): ManualJournal | null {
  const value = sessionStorage.getItem(key);
  if (!value) return null;
  if (value.length > 2048) throw new Error("Saved request exceeds the recovery limit. Inspect account run history before starting another request.");
  const r = JSON.parse(value) as ManualJournal;
  if (!r || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(r.requestId) ||
    !purposeFor(r.path) || typeof r.actorId !== "string" || !r.actorId ||
    typeof r.accountId !== "string" || !r.accountId || !Number.isSafeInteger(r.contextGeneration) || r.contextGeneration < 0 ||
    typeof r.routineId !== "string" || !/^D\d{2}-W\d{2}$/.test(r.routineId) ||
    Object.keys(r).some(k => !["requestId", "path", "accountId", "contextGeneration", "actorId", "routineId"].includes(k)) ||
    manualJournalKey(r, r.routineId, purposeFor(r.path)!) !== key)
    throw new Error("Saved request cannot be read. Inspect account run history before starting another request.");
  return r;
}

/** Never silently abandon an older, actor-unbound reservation. V1 was staged only. */
export function assertNoLegacyJournal(ctx: AgentContext, routineId: string, purpose: string) {
  if (sessionStorage.getItem(`unc:manual:v1:${ctx.accountId}:${ctx.contextGeneration}:${routineId}:${purpose}`))
    throw new Error("An older saved request needs account-owner reconciliation before another request can start.");
}

/** Persist identity only before the first POST. Answers stay in memory, then on the server. */
export function saveManualJournal(key: string, ctx: AgentContext, routineId: string, path: string, body: Record<string, unknown>): ManualJournal {
  const purpose = purposeFor(path);
  assertNoLegacyJournal(ctx, routineId, purpose ?? "");
  if (loadManualJournal(key)) throw new Error("Check the original request before starting another one.");
  const r: ManualJournal = { accountId: ctx.accountId, contextGeneration: ctx.contextGeneration, actorId: ctx.actorId ?? "",
    routineId, path, requestId: crypto.randomUUID() };
  const serialized = JSON.stringify(r);
  if (!r.actorId || !r.accountId || !Number.isSafeInteger(r.contextGeneration) || r.contextGeneration < 0 ||
    !/^D\d{2}-W\d{2}$/.test(routineId) || !purpose || manualJournalKey(ctx, routineId, purpose) !== key || serialized.length > 2048 ||
    new TextEncoder().encode(JSON.stringify(body)).length > 16384)
    throw new Error("Request cannot be safely saved for recovery.");
  sessionStorage.setItem(key, serialized); notify(); return r;
}

/** Initial body is never recovered from storage. Later POSTs identify a server-held request. */
export async function sendManualJournal(journal: ManualJournal, inspect = false, cancel = false, initialBody?: Record<string, unknown>) {
  if (inspect && cancel || initialBody && (inspect || cancel)) throw new Error("Choose one recovery action.");
  const recovery = { action: cancel ? "cancel" : "continue", requestId: journal.requestId, routineId: journal.routineId, purpose: purposeFor(journal.path) };
  const res = await fetch(inspect ? `/api/routines/request?requestId=${encodeURIComponent(journal.requestId)}` : initialBody ? journal.path : "/api/routines/request", {
    method: inspect ? "GET" : "POST", cache: "no-store",
    headers: { "content-type": "application/json", ...artifactHeaders(journal.accountId, journal.contextGeneration), "x-unc-actor-id": journal.actorId },
    ...(inspect ? {} : { body: JSON.stringify(initialBody ? { ...initialBody, requestId: journal.requestId } : recovery) }),
  });
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  const run = body.run as { routineId?: string; status?: string } | undefined;
  if (!res.ok || body.accountId !== journal.accountId || body.contextGeneration !== journal.contextGeneration || body.actorId !== journal.actorId ||
    body.requestId !== journal.requestId || (run?.routineId ?? body.routineId) !== journal.routineId ||
    (body.phase === "cancelled" ? body.run !== null || body.purpose !== purposeFor(journal.path) : !run?.status || !["prepared", "claimed"].includes(String(body.phase))) ||
    cancel && body.phase !== "cancelled")
    throw new Error("Outcome not confirmed. Check this original request; no automatic retry was sent.");
  return body;
}
