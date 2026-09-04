/* /api/channels/links — the founder's linked channels (session-bound).

   GET                        → { links: [...], channels: [{channel, configured, botUsername?, number?}] }
   POST   { channel }         → { linkId, code, expiresAt, instruction: { url, text } }   issue a one-time link code
   PATCH  { linkId, prefs }   → { link }                                                   brief / approvals / drafts / quiet_hours
   DELETE { linkId }          → { ok: true }                                               unlink (Slack: the workspace token goes too)
   or { fallback: true } in demo mode · 401 / 403 / 503 { error }.

   Codes are issued under the service role (members only read channel_links); the session
   proves the account. Instructions never carry a token — only the bot's username / number. */

import { CHANNEL_LABEL, isChannel } from "@/lib/channels/types";
import { instructionFor } from "@/lib/channels/instructions";
import { getLink, issueLinkCode, listLinks, normalisePrefs, unlink, updatePrefs } from "@/lib/channels/links";
import { deleteChannelSecret } from "@/lib/channels/secrets";
import { channelAvailability } from "@/lib/channels/server";
import { requireAccountOwnerSession, requireAccountSession } from "@/lib/db/session";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status: number) => Response.json(body, { status });

const wireLink = (l: Awaited<ReturnType<typeof listLinks>>[number]) => ({
  id: l.id,
  channel: l.channel,
  label: CHANNEL_LABEL[l.channel],
  verified: !!l.verifiedAt,
  handle: l.handle,
  displayName: l.displayName,
  verifiedAt: l.verifiedAt,
  codeExpiresAt: l.linkCodeExpiresAt,
  prefs: l.prefs,
  lastInboundAt: l.lastInboundAt,
  workspace: typeof l.meta.team_name === "string" ? l.meta.team_name : null,
});

async function handleGET() {
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  try {
    const links = await listLinks(session.db, session.accountId);
    const channels = channelAvailability().map(({ pilotAccountId, ...c }) => pilotAccountId && pilotAccountId !== session.accountId ? { ...c, configured: false, number: null, setupNote: "SMS is not enabled for this business yet." } : c);
    return json({ links: links.map(wireLink), channels }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "listing failed" }, 500);
  }
}

async function readBody<T extends object>(req: Request): Promise<T | null> {
  try {
    const b = (await req.json()) as T;
    return b && typeof b === "object" ? b : null;
  } catch {
    return null;
  }
}

async function handlePOST(req: Request) {
  const session = await requireAccountOwnerSession();
  if (session instanceof Response) return session;
  const body = await readBody<{ channel?: unknown }>(req);
  if (!body || !isChannel(body.channel)) return json({ error: "channel must be one of telegram | whatsapp | slack | sms" }, 400);
  const avail = channelAvailability();
  const a = avail.find((x) => x.channel === body.channel);
  if (a?.pilotAccountId && a.pilotAccountId !== session.accountId) return json({ error: "SMS is not enabled for this business yet." }, 403);
  if (!a?.configured) return json({ fallback: true, reason: "not_configured", channel: body.channel }, 200);
  if (body.channel === "slack") return json({ linkId: null, code: null, expiresAt: null, instruction: instructionFor("slack", "", avail) }, 200);
  try {
    const issued = await issueLinkCode(session.service, { accountId: session.accountId, userId: session.userId, channel: body.channel, now: new Date() });
    return json({ linkId: issued.linkId, code: issued.code, expiresAt: issued.expiresAt, instruction: instructionFor(body.channel, issued.code, avail) }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "could not issue a code" }, 500);
  }
}

async function handlePATCH(req: Request) {
  const session = await requireAccountOwnerSession();
  if (session instanceof Response) return session;
  const body = await readBody<{ linkId?: unknown; prefs?: unknown }>(req);
  if (!body || typeof body.linkId !== "string" || !body.prefs || typeof body.prefs !== "object") return json({ error: "linkId and prefs required" }, 400);
  try {
    const current = await getLink(session.service, body.linkId);
    if (!current || current.accountId !== session.accountId) return json({ error: "link not found" }, 404);
    const patch = body.prefs as Record<string, unknown>;
    const merged = normalisePrefs({ ...current.prefs, ...patch, quiet_hours: "quiet_hours" in patch ? patch.quiet_hours : current.prefs.quiet_hours });
    const link = await updatePrefs(session.service, session.accountId, body.linkId, merged);
    return json({ link: link ? wireLink(link) : null }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "update failed" }, 500);
  }
}

async function handleDELETE(req: Request) {
  const session = await requireAccountOwnerSession();
  if (session instanceof Response) return session;
  const body = await readBody<{ linkId?: unknown }>(req);
  if (!body || typeof body.linkId !== "string") return json({ error: "linkId required" }, 400);
  try {
    const link = await getLink(session.service, body.linkId);
    if (!link || link.accountId !== session.accountId) return json({ error: "link not found" }, 404);
    const ok = await unlink(session.service, session.accountId, body.linkId);
    if (ok && link.channel === "slack" && typeof link.meta.team_id === "string") {
      const others = (await listLinks(session.service, session.accountId)).some((l) => l.channel === "slack" && l.meta.team_id === link.meta.team_id);
      if (!others) await deleteChannelSecret(session.service, "slack", link.meta.team_id);
    }
    return json({ ok }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "unlink failed" }, 500);
  }
}

export const GET = withErrorCapture("api/channels/links", handleGET);
export const POST = withErrorCapture("api/channels/links", handlePOST);
export const PATCH = withErrorCapture("api/channels/links", handlePATCH);
export const DELETE = withErrorCapture("api/channels/links", handleDELETE);
