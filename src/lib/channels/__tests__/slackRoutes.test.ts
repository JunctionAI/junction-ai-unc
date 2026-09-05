import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "../../db/types";
import { resolveSlackRoute, stageSlackRoute, type SlackRouteInput } from "../slackRoutes";

const input: SlackRouteInput = { accountId: "11111111-1111-4111-8111-111111111111", actorId: "22222222-2222-4222-8222-222222222222",
  contextGeneration: 0, identityLinkId: "33333333-3333-4333-8333-333333333333", identityLinkVersion: 2, workspaceId: "T1", conversationId: "C1" };
function setup() {
  const checked = { ...input, externalId: "U1", botUserId: "UBOT" };
  const saved = { id: "44444444-4444-4444-8444-444444444444", revision: 0, account_id: input.accountId,
    owner_id: input.actorId, context_generation: 0, workspace_id: "T1", conversation_id: "C1", bot_user_id: "UBOT",
    identity_link_id: input.identityLinkId, identity_link_version: 2, state: "staged" };
  const rpc = vi.fn(async (fn: string) => ({ data: fn === "slack_route_preflight" ? checked : saved, error: null as { message: string; code: string } | null }));
  const auth = { ok: true, team_id: "T1", user_id: "UBOT", bot_id: "B1" };
  const info = { ok: true, channel: { id: "C1", is_member: true, is_archived: false, is_shared: false } as Record<string, unknown> };
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("auth.test")) return Response.json(auth);
    const request = new URL(url);
    // Match the real Slack rejection, not just a canned successful response.
    if (options?.method !== "GET" || options.body !== undefined || request.searchParams.get("channel") !== "C1"
      || request.searchParams.get("include_num_members") !== "false")
      return Response.json({ ok: false, error: "invalid_arguments" });
    return Response.json(info);
  });
  const tokenFor = vi.fn(async () => "synthetic-token-never-log");
  const deps = { db: { rpc } as unknown as DbClient, fetch, tokenFor, now: () => new Date("2026-09-06T00:00:00.000Z") };
  return { deps, checked, saved, rpc, auth, info, fetch, tokenFor };
}

describe("Slack route staging (provider/RPC fixtures, SQL independently verified)", () => {
  it("returns only a strictly validated original-origin candidate; a database failure is not an absent route", async () => {
    const f = setup();
    const candidate = { workspaceId: "T1", conversationId: "C1", externalId: "U1", routeId: f.saved.id, routeRevision: 1,
      accountId: input.accountId, contextGeneration: 0, userId: input.actorId, identityLinkId: input.identityLinkId,
      identityLinkVersion: 2, memberRole: "owner", botUserId: "UBOT" };
    const rpc = vi.fn(async () => ({ data: candidate as unknown, error: null as { message: string } | null }));
    const db = { rpc } as unknown as DbClient;
    const origin = { workspaceId: "T1", conversationId: "C1", externalId: "U1" };
    expect(await resolveSlackRoute(db, origin)).toEqual(candidate);
    rpc.mockResolvedValue({ data: { ...candidate, conversationId: "COTHER" }, error: null });
    await expect(resolveSlackRoute(db, origin)).rejects.toThrow("origin mismatch");
    rpc.mockResolvedValue({ data: null, error: null });expect(await resolveSlackRoute(db, origin)).toBeNull();
    rpc.mockResolvedValue({ data: null, error: { message: "database unavailable" } });
    await expect(resolveSlackRoute(db, origin)).rejects.toThrow("database unavailable");
  });
  it("checks authority before token access, verifies the workspace bot and exact room, then stages only", async () => {
    const f = setup();
    expect(await stageSlackRoute(f.deps, input)).toMatchObject({ state: "staged", accountId: input.accountId, conversationId: "C1", executedAction: "none" });
    expect(f.rpc.mock.calls.map(c => c[0])).toEqual(["slack_route_preflight", "stage_slack_conversation_route"]);
    expect(f.rpc.mock.invocationCallOrder[0]).toBeLessThan(f.tokenFor.mock.invocationCallOrder[0]);
    expect(f.fetch.mock.calls.map(c => c[0])).toEqual(["https://slack.com/api/auth.test", "https://slack.com/api/conversations.info?channel=C1&include_num_members=false"]);
    expect(f.fetch.mock.calls[1][1]).toMatchObject({ method: "GET", cache: "no-store", redirect: "error", headers: { authorization: "Bearer synthetic-token-never-log" } });
    expect(f.fetch.mock.calls[1][1]).not.toHaveProperty("body");
    expect(f.fetch.mock.calls[1][0]).not.toContain("synthetic-token");
    expect(f.rpc).toHaveBeenLastCalledWith("stage_slack_conversation_route", { input, evidence: {
      workspaceId: "T1", conversationId: "C1", botUserId: "UBOT", isMember: true, isArchived: false, isShared: false, verifiedAt: "2026-09-06T00:00:00.000Z",
    } });
    expect(JSON.stringify(f.rpc.mock.calls)).not.toContain("synthetic-token");
  });
  it("refuses foreign-owner preflight before any provider or token access", async () => {
    const f = setup();
    f.rpc.mockResolvedValue({ data: f.checked, error: { message: "Account owner required", code: "42501" } });
    await expect(stageSlackRoute(f.deps, input)).rejects.toThrow("Account owner required");
    expect(f.tokenFor).not.toHaveBeenCalled();expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each(["accountId", "actorId", "identityLinkId", "identityLinkVersion", "contextGeneration", "workspaceId", "conversationId"])("refuses a changed %s preflight before accessing credentials", async key => {
    const f = setup();Object.assign(f.checked, { [key]: "other" });
    await expect(stageSlackRoute(f.deps, input)).rejects.toThrow("identity mismatch");expect(f.tokenFor).not.toHaveBeenCalled();
  });
  it.each([{ team_id: "T2" }, { user_id: "UOTHER" }, { bot_id: undefined }])("rejects wrong token identity %j before reading the channel", async patch => {
    const f = setup();Object.assign(f.auth, patch);
    await expect(stageSlackRoute(f.deps, input)).rejects.toThrow("registered workspace bot");
    expect(f.fetch).toHaveBeenCalledTimes(1);expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([{ id: "COTHER" }, { is_member: false }, { is_member: undefined }, { is_archived: true }, { is_archived: undefined },
    { is_shared: true }, { is_shared: undefined }, { is_ext_shared: true }, { is_org_shared: true }, { is_im: true }, { is_mpim: true }])("refuses an unsuitable or unproven conversation %j", async patch => {
    const f = setup();Object.assign(f.info.channel, patch);
    await expect(stageSlackRoute(f.deps, input)).rejects.toThrow("client channel");expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it("reports missing metadata scopes without copying provider bodies or tokens", async () => {
    const f = setup();f.fetch.mockImplementation(async () => Response.json({ ok: false, error: "missing_scope", detail: "synthetic-token-never-log" }));
    await expect(stageSlackRoute(f.deps, input)).rejects.toThrow("channels:read/groups:read");expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it("sanitizes network errors and never stages on ambiguous resource reads", async () => {
    const f = setup();f.fetch.mockRejectedValue(new Error("Bearer synthetic-token-never-log"));
    await expect(stageSlackRoute(f.deps, input)).rejects.toThrow("Slack resource verification unavailable; no route staged");
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it("fails if authority changed during the provider read, without retrying registration", async () => {
    const f = setup();f.rpc.mockImplementation(async fn => ({ data: f.checked, error: fn === "slack_route_preflight" ? null : { message: "Verified Slack identity required", code: "42501" } }));
    await expect(stageSlackRoute(f.deps, input)).rejects.toThrow("Verified Slack identity required");expect(f.rpc).toHaveBeenCalledTimes(2);
  });
  it.each([{ account_id: "foreign" }, { state: "active" }, { conversation_id: "C2" }, { revision: -1 }, { identity_link_version: 9 }])("detects mismatched persisted route %j", async patch => {
    const f = setup();Object.assign(f.saved, patch);
    await expect(stageSlackRoute(f.deps, input)).rejects.toThrow("reconcile before retrying");expect(f.rpc).toHaveBeenCalledTimes(2);
  });
  it("does not accept a DM or user-supplied extra authority flags", async () => {
    const f = setup();
    await expect(stageSlackRoute(f.deps, { ...input, conversationId: "D1" })).rejects.toThrow();
    await expect(stageSlackRoute(f.deps, { ...input, enabled: true } as SlackRouteInput)).rejects.toThrow();
    expect(f.rpc).not.toHaveBeenCalled();expect(f.fetch).not.toHaveBeenCalled();
  });
});
