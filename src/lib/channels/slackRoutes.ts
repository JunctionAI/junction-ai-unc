/** Server-only route provisioning. This stages a mapping; it never joins a room,
 * sends a message, enables a route, or changes the user's OAuth account link. */
import { z } from "zod";
import { unwrap, type DbClient, type Row } from "../db/types";
import { SLACK_API, type SlackTokenResolver } from "./adapters/slack";
import type { FetchLike } from "./types";

export const slackRouteInput = z.object({
  accountId: z.uuid(), actorId: z.uuid(), contextGeneration: z.number().int().nonnegative(),
  identityLinkId: z.uuid(), identityLinkVersion: z.number().int().nonnegative(),
  workspaceId: z.string().regex(/^T[A-Z0-9]{1,63}$/),
  conversationId: z.string().regex(/^[CG][A-Z0-9]{1,63}$/),
}).strict();
export type SlackRouteInput = z.infer<typeof slackRouteInput>;
export const SLACK_ROUTE_READ_SCOPES = ["channels:read", "groups:read"] as const;

const routeOrigin = z.object({ workspaceId: z.string().regex(/^T[A-Z0-9]{1,63}$/),
  conversationId: z.string().regex(/^[CG][A-Z0-9]{1,63}$/), externalId: z.string().regex(/^[UW][A-Z0-9]{1,63}$/) }).strict();
const routeCandidate = routeOrigin.extend({ routeId: z.uuid(), routeRevision: z.number().int().nonnegative(), accountId: z.uuid(),
  contextGeneration: z.number().int().nonnegative(), userId: z.uuid(), identityLinkId: z.uuid(),
  identityLinkVersion: z.number().int().nonnegative(), memberRole: z.enum(["owner", "member"]), botUserId: z.string().regex(/^[UW][A-Z0-9]{1,63}$/) }).strict();
export type SlackRouteCandidate = Readonly<z.infer<typeof routeCandidate>>;

/** Lookup is not a durable inbound grant. The caller must capture/recheck this
 * candidate's revisions inside the inbox transaction before executing anything. */
export async function resolveSlackRoute(db: DbClient, raw: z.infer<typeof routeOrigin>): Promise<SlackRouteCandidate | null> {
  const input = routeOrigin.parse(raw);
  const result = await unwrap<unknown>("slack_route.resolve", db.rpc("resolve_slack_conversation_route", { input }));
  if (result === null) return null;
  const candidate = routeCandidate.parse(result);
  if (candidate.workspaceId !== input.workspaceId || candidate.conversationId !== input.conversationId || candidate.externalId !== input.externalId)
    throw new Error("Slack route origin mismatch");
  return Object.freeze(candidate);
}

function record(v: unknown): Row {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Invalid Slack verification response");
  return v as Row;
}

async function readSlack(fetchFn: FetchLike, token: string, method: "auth.test" | "conversations.info", body: Row): Promise<Row> {
  let res: Response;
  try {
    // conversations.info requires query arguments: the live API rejects this
    // lookup's JSON POST with invalid_arguments. Keep credentials in headers.
    const query = new URLSearchParams(Object.entries(body).map(([key, value]) => [key, String(value)]));
    const channelRead = method === "conversations.info";
    res = await fetchFn(`${SLACK_API}/${method}${channelRead ? `?${query}` : ""}`, {
      method: channelRead ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(10_000), cache: "no-store",
      headers: { authorization: `Bearer ${token}`, ...(!channelRead ? { "content-type": "application/json; charset=utf-8" } : {}) },
      ...(!channelRead ? { body: JSON.stringify(body) } : {}),
    });
  } catch { throw new Error("Slack resource verification unavailable; no route staged"); }
  let result: Row;
  try { result = record(await res.json()); }
  catch { throw new Error("Invalid Slack verification response"); }
  if (!res.ok || result.ok !== true) {
    // Do not reflect provider bodies, request headers or arbitrary error strings.
    if (result.error === "missing_scope") throw new Error("Slack connection needs channel metadata read access; reconnect with channels:read/groups:read");
    throw new Error("Slack resource verification refused; no route staged");
  }
  return result;
}

export async function stageSlackRoute(deps: { db: DbClient; fetch: FetchLike; tokenFor: SlackTokenResolver; now: () => Date }, raw: SlackRouteInput) {
  const input = slackRouteInput.parse(raw);
  const checked = record(await unwrap("slack_route.preflight", deps.db.rpc("slack_route_preflight", { input })));
  for (const key of Object.keys(input) as (keyof SlackRouteInput)[])
    if (checked[key] !== input[key]) throw new Error("Slack route preflight identity mismatch");
  if (typeof checked.botUserId !== "string" || !/^[UW][A-Z0-9]{1,63}$/.test(checked.botUserId)
    || typeof checked.externalId !== "string" || !/^[UW][A-Z0-9]{1,63}$/.test(checked.externalId)) throw new Error("Verified Slack identity missing");
  const evidence = await verifySlackRouteResource(deps, { workspaceId: input.workspaceId, conversationId: input.conversationId, botUserId: String(checked.botUserId) });
  const route = record(await unwrap("slack_route.stage", deps.db.rpc("stage_slack_conversation_route", { input, evidence })));
  if (route.account_id !== input.accountId || route.context_generation !== input.contextGeneration || route.workspace_id !== input.workspaceId
    || route.conversation_id !== input.conversationId || route.owner_id !== input.actorId || route.identity_link_id !== input.identityLinkId
    || route.identity_link_version !== input.identityLinkVersion || route.bot_user_id !== checked.botUserId
    || route.state !== "staged" || typeof route.id !== "string" || !z.uuid().safeParse(route.id).success
    || !Number.isSafeInteger(route.revision) || Number(route.revision) < 0) throw new Error("Persisted Slack route mismatch; reconcile before retrying");
  return Object.freeze({ routeId: route.id, revision: Number(route.revision), accountId: input.accountId,
    workspaceId: input.workspaceId, conversationId: input.conversationId, state: "staged" as const, executedAction: "none" as const });
}

/** Read-only provider evidence; caller must recheck authority when saving. */
export async function verifySlackRouteResource(deps: { fetch: FetchLike; tokenFor: SlackTokenResolver; now: () => Date },
  input: { workspaceId: string; conversationId: string; botUserId: string }) {
  const token = await deps.tokenFor(input.workspaceId);
  if (!token) throw new Error("Slack workspace connection unavailable; reconnect required");
  const auth = await readSlack(deps.fetch, token, "auth.test", {});
  if (auth.team_id !== input.workspaceId || auth.user_id !== input.botUserId || typeof auth.bot_id !== "string" || !auth.bot_id)
    throw new Error("Slack token does not belong to the registered workspace bot");
  const info = await readSlack(deps.fetch, token, "conversations.info", { channel: input.conversationId, include_num_members: false });
  const conversation = record(info.channel);
  if (conversation.id !== input.conversationId || conversation.is_member !== true || conversation.is_archived !== false
    || conversation.is_shared !== false || conversation.is_im === true || conversation.is_mpim === true
    || conversation.is_ext_shared === true || conversation.is_org_shared === true)
    throw new Error("Slack route requires an unarchived, non-shared client channel containing the Junction bot");
  return { workspaceId: input.workspaceId, conversationId: input.conversationId, botUserId: input.botUserId,
    isMember: true, isArchived: false, isShared: false, verifiedAt: deps.now().toISOString() };
}
