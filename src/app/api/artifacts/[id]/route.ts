/* Captured-context artifact reads, owner decisions and durable founder-only copies. */
import { ArtifactError, decideArtifact, getArtifactForAccount } from "@/lib/artifacts/handlers";
import { captureArtifactContext, artifactFailure } from "@/lib/artifacts/context";
import { sendArtifact } from "@/lib/artifacts/delivery";
import { channelLog, envAdapters } from "@/lib/channels/server";
import { isChannel } from "@/lib/channels/types";
import { isDbConfigured } from "@/lib/db/client";
import { requireAccountOwnerSession, requireAccountSession } from "@/lib/db/session";
import { assertRuntimeContext } from "@/lib/db/runtimeContext";
import type { DbClient } from "@/lib/db/types";
import { getStore } from "@/lib/runtime/store";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const ACTIONS = new Set(["approve", "hold", "edit", "why", "use"]);
const headers = { "cache-control": "no-store" };

async function bind(req: Request, ownerOnly = false): Promise<{ accountId: string | null; contextGeneration?: number; decidedBy?: string; db: DbClient | null } | Response> {
  if (!isDbConfigured()) return { accountId: null, db: null };
  const session = ownerOnly ? await requireAccountOwnerSession(req) : await requireAccountSession(req);
  if (session instanceof Response) return session;
  const identity = await captureArtifactContext(session.service, session.accountId, req);
  if (identity instanceof Response) return identity;
  return { ...identity, decidedBy: session.userId, db: session.service };
}

async function handleGET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const b = await bind(req);
    if (b instanceof Response) return b;
    const artifact = await getArtifactForAccount({ store: getStore(), contextGeneration: b.contextGeneration }, b.accountId, id);
    if (b.db && b.accountId) await assertRuntimeContext(b.db, { accountId: b.accountId, contextGeneration: b.contextGeneration }, { allowPaused: true });
    if (!artifact) return Response.json({ error: "Draft not found in this business context." }, { status: 404, headers });
    return Response.json({ artifact }, { headers });
  } catch (err) { return artifactFailure(err); }
}

async function handlePOST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { action?: unknown; reason?: unknown; editedBody?: unknown; channel?: unknown; expectedRevision?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid JSON body" }, { status: 400 }); }
  if (!body || typeof body !== "object") return Response.json({ error: "invalid JSON body" }, { status: 400 });
  try {
    const b = await bind(req, true);
    if (b instanceof Response) return b;
    const store = getStore();
    const deps = { store, db: b.db, contextGeneration: b.contextGeneration };
    if (b.db && (!Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 0))
      return Response.json({ error: "Draft revision required. Reload this draft." }, { status: 409 });
    if (body.action === "send") {
      if (!isChannel(body.channel)) return Response.json({ error: "Unsupported channel." }, { status: 400 });
      if (!b.db || !b.accountId || !b.decidedBy || b.contextGeneration === undefined)
        return Response.json({ error: "channels need an account and a database" }, { status: 503 });
      const artifact = await getArtifactForAccount(deps, b.accountId, id);
      if (!artifact) return Response.json({ error: "Draft not found in this business context." }, { status: 404 });
      const out = await sendArtifact({ db: b.db, adapters: envAdapters(b.db), now: () => new Date(), log: channelLog }, {
        accountId: b.accountId, contextGeneration: b.contextGeneration, userId: b.decidedBy,
        artifact, expectedRevision: body.expectedRevision as number, channel: body.channel,
      });
      return Response.json(out, { headers });
    }
    if (typeof body.action !== "string" || !ACTIONS.has(body.action))
      return Response.json({ error: "action must be approve, hold, edit, why, use or send" }, { status: 400 });
    const out = await decideArtifact(deps, {
      accountId: b.accountId, artifactId: id, action: body.action as "approve", expectedRevision: body.expectedRevision as number | undefined,
      reason: typeof body.reason === "string" ? body.reason : undefined, editedBody: typeof body.editedBody === "string" ? body.editedBody : undefined,
      decidedBy: b.decidedBy,
    });
    return Response.json(out, { headers });
  } catch (err) {
    if (err instanceof ArtifactError) return Response.json({ error: err.message, code: err.code },
      { status: err.code === "not_found" ? 404 : err.code === "conflict" ? 409 : err.code === "unavailable" ? 503 : 400, headers });
    return artifactFailure(err);
  }
}

export const GET = withErrorCapture("api/artifacts/[id]", handleGET);
export const POST = withErrorCapture("api/artifacts/[id]", handlePOST);
