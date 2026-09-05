/** Browser-safe wire contract. No provider or credential imports. */
import { z } from "zod";
import type { AgentContext } from "../agents/client";
import { artifactHeaders } from "../artifacts/client";
const version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const workspace = z.string().regex(/^T[A-Z0-9]{1,63}$/);
export const slackRoomId = z.string().regex(/^[CG][A-Z0-9]{1,63}$/);
export const slackRouteStageRequest = z.object({ identityLinkId: z.uuid(), identityLinkVersion: version,
  workspaceId: workspace, conversationId: slackRoomId }).strict();
export type SlackRouteStageRequest = z.infer<typeof slackRouteStageRequest>;
export const slackRouteTransitionRequest = z.object({ routeId: z.uuid(), revision: version,
  action: z.enum(["activate", "pause", "revoke"]) }).strict();
export type SlackRouteTransitionRequest = z.infer<typeof slackRouteTransitionRequest>;
export const slackRouteSetupView = z.object({
  accountId: z.uuid(), actorId: z.uuid(), contextGeneration: version, paused: z.boolean(),
  identities: z.array(z.object({ identityLinkId: z.uuid(), identityLinkVersion: version, workspaceId: workspace,
    workspaceName: z.string().max(200), botUserId: z.string().regex(/^[UW][A-Z0-9]{1,63}$/), credentialStored: z.boolean() }).strict()),
  routes: z.array(z.object({ routeId: z.uuid(), revision: version, workspaceId: workspace, conversationId: slackRoomId,
    identityLinkId: z.uuid().nullable(), identityLinkVersion: version, state: z.enum(["staged", "active", "revoked"]),
    verifiedAt: z.string().datetime({ offset: true }), bindingCurrent: z.boolean() }).strict()),
  activationAvailable: z.literal(false), executedAction: z.literal("none"),
}).strict();
export type SlackRouteSetupView = z.infer<typeof slackRouteSetupView>;
export function readSlackRouteSetup(value: unknown, ctx: AgentContext): SlackRouteSetupView {
  const view = slackRouteSetupView.parse(value);
  if (view.accountId !== ctx.accountId || view.contextGeneration !== ctx.contextGeneration || (ctx.actorId && view.actorId !== ctx.actorId))
    throw Error("Slack setup identity changed");
  if (new Set(view.routes.map(r => r.routeId)).size !== view.routes.length || new Set(view.identities.map(i => i.identityLinkId)).size !== view.identities.length)
    throw Error("Ambiguous Slack setup readback");
  return view;
}
export function confirmStagedRoute(view: SlackRouteSetupView, save: SlackRouteStageRequest) {
  const matches = view.routes.filter(r => r.workspaceId === save.workspaceId && r.conversationId === save.conversationId && r.state !== "revoked");
  if (matches.length !== 1 || matches[0].state !== "staged" || !matches[0].bindingCurrent
    || matches[0].identityLinkId !== save.identityLinkId || matches[0].identityLinkVersion !== save.identityLinkVersion)
    throw Error("Saved Slack mapping not confirmed; refresh before changing it again");
}
export function confirmRouteTransition(view: SlackRouteSetupView, change: SlackRouteTransitionRequest) {
  const route = view.routes.find(r => r.routeId === change.routeId);
  const target = change.action === "activate" ? "active" : change.action === "pause" ? "staged" : "revoked";
  if (!route || route.state !== target || (route.revision !== change.revision + 1 && !(change.action !== "activate" && route.revision === change.revision))
    || (change.action === "activate" && (!route.bindingCurrent || view.paused))) throw Error("Route change not confirmed; refresh before retrying");
}
export async function slackRouteTransition(ctx: AgentContext, change: SlackRouteTransitionRequest,
  fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<SlackRouteSetupView> {
  if (!ctx.actorId) throw Error("Read the current owner setup before changing a channel");
  slackRouteTransitionRequest.parse(change);
  const res = await fetcher("/api/channels/slack/routes", { method: "PATCH", cache: "no-store", signal,
    headers: { ...artifactHeaders(ctx.accountId, ctx.contextGeneration), "x-unc-actor-id": ctx.actorId, "content-type": "application/json" },
    body: JSON.stringify(change) });
  if (!res.ok) throw Error("Route change not confirmed. Refresh before making another change.");
  const view = readSlackRouteSetup(await res.json(), ctx); confirmRouteTransition(view, change); return view;
}
export async function slackRouteSetupRequest(ctx: AgentContext, save?: SlackRouteStageRequest,
  fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<SlackRouteSetupView> {
  if (save && !ctx.actorId) throw Error("Read the current owner setup before staging a channel");
  if (save) slackRouteStageRequest.parse(save);
  const res = await fetcher("/api/channels/slack/routes", { method: save ? "POST" : "GET", cache: "no-store", signal,
    headers: { ...artifactHeaders(ctx.accountId, ctx.contextGeneration), ...(ctx.actorId ? { "x-unc-actor-id": ctx.actorId } : {}),
      ...(save ? { "content-type": "application/json" } : {}) }, ...(save ? { body: JSON.stringify(save) } : {}) });
  if (!res.ok) {
    // Only these local error codes affect copy; never display arbitrary server/provider bodies.
    const body = await res.json().catch(() => null);
    if (body?.code === "slack_metadata_scope_required") throw Error("Slack needs channel metadata read access. Ask Junction to review the existing installation’s scopes.");
    if (body?.code === "owner_only" || res.status === 403) throw Error("The current account owner must set up this channel.");
    throw Error("Slack setup not confirmed. Refresh before making another change.");
  }
  const view = readSlackRouteSetup(await res.json(), ctx);
  if (save) confirmStagedRoute(view, save);
  return view;
}
