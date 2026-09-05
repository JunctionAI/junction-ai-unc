/** Server-owned, exact-route cutover. Never changes Slack listeners or sends. */
import { z } from "zod";
import { unwrap, type DbClient, type Row } from "../db/types";
import { readSlackRouteSetup, slackRouteTransitionRequest, type SlackRouteTransitionRequest } from "./slackRouteSetupClient";
import { verifySlackRouteResource } from "./slackRoutes";
import type { SlackTokenResolver } from "./adapters/slack";
import type { FetchLike } from "./types";
const version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const authority = z.object({ accountId: z.uuid(), actorId: z.uuid(), contextGeneration: version }).strict();
const approvalSchema = authority.extend({ routeId: z.uuid(), revision: version, workspaceId: z.string().regex(/^T[A-Z0-9]{1,63}$/),
  conversationId: z.string().regex(/^[CG][A-Z0-9]{1,63}$/), botUserId: z.string().regex(/^U[A-Z0-9]{1,63}$/),
  expiresAt: z.string().datetime({ offset: true }), reference: z.string().trim().min(1).max(200), previousResponderStopped: z.literal(true) }).strict();
type Context = z.infer<typeof authority>;
export function slackCutoverApproval(env: Record<string, string | undefined>, ctx: Context, change: SlackRouteTransitionRequest, now: Date) {
  // Route activation must never require opening the global messaging gate.
  if (env.UNC_SLACK_ROUTE_ACTIVATION_ENABLED !== "true" || !env.UNC_SLACK_ROUTE_ACTIVATION_SCOPE) throw Error("Slack cutover is not released");
  let raw: unknown;
  try { raw = JSON.parse(env.UNC_SLACK_ROUTE_ACTIVATION_SCOPE); } catch { throw Error("Invalid Slack cutover scope"); }
  const approval = approvalSchema.parse(raw), expiry = Date.parse(approval.expiresAt);
  if (approval.accountId !== ctx.accountId || approval.actorId !== ctx.actorId || approval.contextGeneration !== ctx.contextGeneration
    || approval.routeId !== change.routeId || approval.revision !== change.revision || change.action !== "activate"
    || expiry <= now.getTime() || expiry > now.getTime() + 3600000) throw Error("Exact unexpired Slack cutover scope required");
  return approval;
}
export async function transitionSlackRoute(deps: { db: DbClient; fetch: FetchLike; tokenFor: SlackTokenResolver;
  now: () => Date; env: Record<string, string | undefined> }, rawContext: Context, rawChange: SlackRouteTransitionRequest) {
  const ctx = authority.parse(rawContext), change = slackRouteTransitionRequest.parse(rawChange);
  // An off gate refuses activation before any provider or credential access.
  const approval = change.action === "activate" ? slackCutoverApproval(deps.env, ctx, change, deps.now()) : null;
  let evidence: Row | null = null;
  if (approval) {
    const view = readSlackRouteSetup(await unwrap("slack.lifecycle.view", deps.db.rpc("slack_route_owner_view", { input: ctx })), ctx);
    const route = view.routes.find(r => r.routeId === change.routeId);
    const identity = view.identities.find(i => i.identityLinkId === route?.identityLinkId);
    if (!route || view.paused || route.state !== "staged" || !route.bindingCurrent || route.revision !== change.revision
      || !identity?.credentialStored || identity.identityLinkVersion !== route.identityLinkVersion
      || approval.workspaceId !== route.workspaceId || approval.conversationId !== route.conversationId
      || approval.botUserId !== identity.botUserId) throw Error("Current staged route and Slack grant required");
    const credential = await unwrap<{ updated_at: string } | null>("slack.lifecycle.credential", deps.db.from("channel_secrets")
      .select("updated_at").eq("channel", "slack").eq("scope_id", route.workspaceId).maybeSingle());
    if (!credential?.updated_at) throw Error("Slack grant unavailable");
    evidence = { ...await verifySlackRouteResource(deps, { workspaceId: route.workspaceId, conversationId: route.conversationId,
      botUserId: identity.botUserId }), credentialUpdatedAt: credential.updated_at };
  }
  const row = await unwrap<Row>("slack.lifecycle.transition", deps.db.rpc("transition_slack_conversation_route", {
    input: { ...ctx, ...change }, evidence, approval,
  }));
  const expected = change.action === "activate" ? "active" : change.action === "pause" ? "staged" : "revoked";
  if (!row || row.id !== change.routeId || row.account_id !== ctx.accountId || row.state !== expected
    || (row.revision !== change.revision + 1 && !(change.action !== "activate" && row.revision === change.revision)))
    throw Error("Slack transition save unconfirmed; reconcile before retrying");
}
