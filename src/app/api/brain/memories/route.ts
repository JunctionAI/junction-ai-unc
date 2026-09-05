/* /api/brain/memories — "What Unc knows" (session-bound; RLS on memories is member_all, and
   every query still pins account_id so a stray id from another account is a no-op).

   GET                       → { memories: [{ id, kind, text, source, confidence, importance, tags, happensAt, createdAt }] }
   POST   { text, kind? }    → { memory }        founder-stated (source 'founder', confidence 1.0)
   PATCH  { id, text }       → { memory }        a new memory supersedes the old (history kept)
   DELETE { id }             → { ok: true }      "forget" — valid_to set, row kept
   or { fallback: true } in demo mode · 401 / 403 / 503 { error }. */

import { requireAccountSession } from "@/lib/db/session";
import { captureMemoryContext, contextChangedResponse, contextStillCurrent } from "@/lib/db/contextGeneration";
import { addFounderMemory, forgetMemory, isMemoryKind, listActiveMemories, reviseMemory, type MemoryRow } from "@/lib/intake/memoryWriter";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status: number) => Response.json(body, { status });

const wireMemory = (m: MemoryRow) => ({
  id: m.id,
  kind: m.kind,
  text: m.text,
  source: m.source,
  confidence: Number(m.confidence),
  importance: m.importance,
  tags: m.tags ?? [],
  happensAt: m.happens_at,
  createdAt: m.created_at,
});

async function readBody<T extends object>(req: Request): Promise<T | null> {
  try {
    const b = (await req.json()) as T;
    return b && typeof b === "object" ? b : null;
  } catch {
    return null;
  }
}

const MAX_TEXT = 1000;
const cleanText = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, MAX_TEXT) : null);

async function handleGET() {
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  const context = await captureMemoryContext(session.service, session.accountId);
  if (context instanceof Response) return context;
  try {
    const rows = await listActiveMemories(context.db, session.accountId);
    if (!await contextStillCurrent(session.service, session.accountId, context.generation)) return contextChangedResponse();
    return Response.json({ memories: rows.map(wireMemory), contextGeneration: context.generation }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "memory read failed" }, 500);
  }
}

async function handlePOST(req: Request) {
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  const body = await readBody<{ text?: unknown; kind?: unknown }>(req);
  if (!body) return json({ error: "invalid JSON body" }, 400);
  const text = cleanText(body.text);
  if (!text) return json({ error: "text required" }, 400);
  const kind = body.kind === undefined || body.kind === null ? "fact" : body.kind;
  if (!isMemoryKind(kind)) return json({ error: "unknown kind" }, 400);
  const context = await captureMemoryContext(session.service, session.accountId, req);
  if (context instanceof Response) return context;
  try {
    const memory = await addFounderMemory(context.db, session.accountId, text, kind);
    if (!await contextStillCurrent(session.service, session.accountId, context.generation)) return contextChangedResponse();
    if (!memory) return json({ error: "I already have that one, word for word.", code: "already_exists" }, 409);
    return json({ memory: wireMemory(memory) }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "memory write failed" }, 500);
  }
}

async function handlePATCH(req: Request) {
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  const body = await readBody<{ id?: unknown; text?: unknown }>(req);
  if (!body) return json({ error: "invalid JSON body" }, 400);
  const text = cleanText(body.text);
  if (typeof body.id !== "string" || !body.id || !text) return json({ error: "id and text required" }, 400);
  const context = await captureMemoryContext(session.service, session.accountId, req);
  if (context instanceof Response) return context;
  try {
    const memory = await reviseMemory(context.db, session.accountId, body.id, text);
    if (!await contextStillCurrent(session.service, session.accountId, context.generation)) return contextChangedResponse();
    if (!memory) return json({ error: "that memory isn't live on this account" }, 404);
    return json({ memory: wireMemory(memory) }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "memory update failed" }, 500);
  }
}

async function handleDELETE(req: Request) {
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  const body = await readBody<{ id?: unknown }>(req);
  if (!body || typeof body.id !== "string" || !body.id) return json({ error: "id required" }, 400);
  const context = await captureMemoryContext(session.service, session.accountId, req);
  if (context instanceof Response) return context;
  try {
    const done = await forgetMemory(context.db, session.accountId, body.id);
    if (!await contextStillCurrent(session.service, session.accountId, context.generation)) return contextChangedResponse();
    if (!done) return json({ error: "that memory isn't live on this account" }, 404);
    return json({ ok: true }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "forget failed" }, 500);
  }
}

export const GET = withErrorCapture("api/brain/memories", handleGET);
export const POST = withErrorCapture("api/brain/memories", handlePOST);
export const PATCH = withErrorCapture("api/brain/memories", handlePATCH);
export const DELETE = withErrorCapture("api/brain/memories", handleDELETE);
