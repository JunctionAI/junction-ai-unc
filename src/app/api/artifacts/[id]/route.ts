/* GET  /api/artifacts/<id>            → { artifact: ArtifactView }
   POST /api/artifacts/<id>            the founder's decision on a draft
     { action: "approve" | "hold" | "edit" | "why" | "use", reason?, editedBody? }
       → { artifact, memory }          status + taste_event (+ a memory with the service role)
     { action: "send", channel: "telegram" | "whatsapp" | "slack" | "sms" | "email" }
       → { sent: { channel, status }[] }  the draft as a message on the founder's own linked
                                          channel — to THEM, never outward
   or 400 | 401 | 403 | 404 (unknown, or not this account's) | 503

   DB configured → session-bound; demo mode → MemoryStore, unbound. */

import { ArtifactError, decideArtifact, getArtifactForAccount } from "@/lib/artifacts/handlers";
import { markdownToPlain } from "@/lib/artifacts/markdown";
import { verifiedLinks } from "@/lib/channels/links";
import { sendOnLink } from "@/lib/channels/outbound";
import { channelLog, envAdapters, serviceDbOrNull } from "@/lib/channels/server";
import { isChannel } from "@/lib/channels/types";
import { isDbConfigured } from "@/lib/db/client";
import { requireAccountOwnerSession, requireAccountSession } from "@/lib/db/session";
import type { DbClient } from "@/lib/db/types";
import { getStore } from "@/lib/runtime/store";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = new Set(["approve", "hold", "edit", "why", "use"]);
const MESSAGE_MAX = 3800;

async function bind(ownerOnly = false): Promise<{ accountId: string | null; decidedBy?: string; db: DbClient | null } | Response> {
  if (!isDbConfigured()) return { accountId: null, db: null };
  const session = ownerOnly ? await requireAccountOwnerSession() : await requireAccountSession();
  if (session instanceof Response) return session;
  return { accountId: session.accountId, decidedBy: session.userId, db: session.service };
}

async function handleGET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await bind();
  if (b instanceof Response) return b;
  const artifact = await getArtifactForAccount({ store: getStore() }, b.accountId, (id || "").trim().slice(0, 128));
  if (!artifact) return Response.json({ error: `artifact ${id} not found` }, { status: 404 });
  return Response.json({ artifact }, { headers: { "cache-control": "no-store" } });
}

async function handlePOST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const artifactId = (id || "").trim().slice(0, 128);
  if (!artifactId) return Response.json({ error: "artifact id is required" }, { status: 400 });
  let body: { action?: unknown; reason?: unknown; editedBody?: unknown; channel?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const b = await bind(true);
  if (b instanceof Response) return b;
  const store = getStore();

  if (body.action === "send") {
    if (!isChannel(body.channel)) return Response.json({ error: "channel must be one of telegram, whatsapp, slack, sms, email" }, { status: 400 });
    const db = b.db ?? serviceDbOrNull();
    if (!db || !b.accountId) return Response.json({ error: "channels need an account and a database" }, { status: 503 });
    const artifact = await getArtifactForAccount({ store }, b.accountId, artifactId);
    if (!artifact) return Response.json({ error: `artifact ${artifactId} not found` }, { status: 404 });
    const links = (await verifiedLinks(db, b.accountId)).filter((l) => l.channel === body.channel);
    if (!links.length) return Response.json({ error: `no verified ${body.channel} link on this account` }, { status: 404 });
    const text = `${artifact.title}\n\n${markdownToPlain(artifact.editedBody ?? artifact.body)}${artifact.items.length ? `\n\n${artifact.items.map((it, i) => `${i + 1}. ${it.title}\n${markdownToPlain(it.body)}`).join("\n\n")}` : ""}`.slice(0, MESSAGE_MAX);
    const deps = { db, adapters: envAdapters(db), now: () => new Date(), log: channelLog };
    const sent: { channel: string; status: string }[] = [];
    for (const link of links) {
      const out = await sendOnLink(deps, link, "draft_landed", { text }, { ref: `artifact:${artifact.id}:${Date.now()}`, appendToThread: true });
      sent.push({ channel: link.channel, status: out.status });
    }
    return Response.json({ sent });
  }

  if (typeof body.action !== "string" || !ACTIONS.has(body.action)) return Response.json({ error: "action must be approve, hold, edit, why, use or send" }, { status: 400 });
  try {
    const out = await decideArtifact({ store, db: b.db }, { accountId: b.accountId, artifactId, action: body.action as "approve", reason: typeof body.reason === "string" ? body.reason : undefined, editedBody: typeof body.editedBody === "string" ? body.editedBody : undefined, decidedBy: b.decidedBy });
    return Response.json(out);
  } catch (err) {
    if (err instanceof ArtifactError) return Response.json({ error: err.message, code: err.code }, { status: err.code === "not_found" ? 404 : err.code === "conflict" ? 409 : 400 });
    return Response.json({ error: err instanceof Error ? err.message : "decision failed" }, { status: 500 });
  }
}

export const GET = withErrorCapture("api/artifacts/[id]", handleGET);
export const POST = withErrorCapture("api/artifacts/[id]", handlePOST);
