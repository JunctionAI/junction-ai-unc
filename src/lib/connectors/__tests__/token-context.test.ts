import { beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "@/lib/db/types";
import type { RunContext } from "@/lib/runtime/types";
import { WorkerConnectorReader } from "@/worker/providers/connectorReader";
import { seal } from "../crypto";
import { getAccessToken, ConnectorCredentialProvider, type TokenDeps } from "../tokens";
import { putSecret, upsertConnector } from "../store";
import { FAKE_ENV, KEYRING, NOW, json, seededDb, stubFetch } from "./helpers";

let f: ReturnType<typeof seededDb>;
let id: string;
let time: number;
beforeEach(async () => {
  f = seededDb(); time = NOW.getTime(); f.db.now = () => new Date(time).toISOString();
  id = await upsertConnector(f.db, f.accountId, "ga4", { status: "connected", external_ref: "asset-a" });
  await replaceSecret("original", 120_000);
});
async function replaceSecret(token: string, lifetime = 3600_000) {
  await putSecret(f.db, id, seal(JSON.stringify({ accessToken: token, refreshToken: `refresh-${token}`, expiresAt: new Date(time + lifetime).toISOString(), obtainedAt: NOW.toISOString() }), KEYRING, id), f.db.now());
}
function deps(db: DbClient = f.db) {
  const s = stubFetch();
  return { ...s, db, keyring: KEYRING, env: { ...FAKE_ENV, CONNECTOR_REFRESH_LEASES_ENABLED: "false" }, now: () => new Date(time),
    expectedContext: { accountId: f.accountId, contextGeneration: 0 }, expectedOwner: f.userId } satisfies TokenDeps;
}
function independentClient(): DbClient { return { from: f.db.from.bind(f.db), rpc: f.db.rpc.bind(f.db) }; }
const saved = () => structuredClone({ rows: f.db.rows("connectors"), secrets: f.db.rows("connector_secrets") });
async function change(mode: string) {
  if (mode === "reset") f.db.rows("accounts")[0].context_generation = 1;
  if (mode === "pause") f.db.rows("accounts")[0].automation_paused = true;
  if (mode === "owner") f.db.rows("account_members")[0].role = "member";
  if (mode === "disconnect") f.db.rows("connectors")[0].status = "disconnected";
  if (mode === "provider") f.db.rows("connectors")[0].sync_ref = { auth_provider: "nango", provider_connection_id: "new" };
  if (mode === "secret") await replaceSecret("new-login");
  if (mode === "asset") f.db.rows("connectors")[0].external_ref = "asset-b";
}

describe("credential outcome fencing", () => {
  it.each(["reset", "pause", "owner", "disconnect", "provider", "secret"])("a late refresh success cannot overwrite %s", async mode => {
    const d = deps(); let before: ReturnType<typeof saved>;
    d.routes.push(async () => { await change(mode); before = saved(); return json({ access_token: "old-request-result", expires_in: 3600 }); });
    await expect(getAccessToken(id, d)).rejects.toMatchObject({ code: "context_changed" });
    expect(saved()).toEqual(before!);
  });
  it.each(["reset", "pause", "owner", "disconnect", "provider", "secret"])("a late invalid_grant cannot downgrade %s", async mode => {
    const d = deps(); let before: ReturnType<typeof saved>;
    d.routes.push(async () => { await change(mode); before = saved(); return json({ error: "invalid_grant" }, 400); });
    await expect(getAccessToken(id, d)).rejects.toMatchObject({ code: "context_changed" });
    expect(saved()).toEqual(before!);
  });
  it("selection change preserves a legitimate grant refresh but refuses to rebase the old asset read", async () => {
    const d = deps();
    d.routes.push(async () => { await change("asset"); return json({ access_token: "refreshed", refresh_token: "rotated", expires_in: 3600 }); });
    await expect(getAccessToken(id, d)).rejects.toMatchObject({ code: "context_changed" });
    expect(f.db.rows("connector_refresh_attempts")[0].status).toBe("succeeded");
    expect(f.db.rows("connectors")[0].external_ref).toBe("asset-b");
    expect(await getAccessToken(id, d)).toMatchObject({ accessToken: "refreshed", externalRef: "asset-b" });
    expect(d.calls).toHaveLength(1);
  });
  it("a new login does not join the older in-flight token promise", async () => {
    const old = deps(); let release!: () => void; let entered!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    old.routes.push(async () => { entered(); await waiting; return json({ access_token: "old-result", expires_in: 3600 }); });
    const pending = getAccessToken(id, old).catch(e => e);
    await started; await replaceSecret("new-login");
    expect(await getAccessToken(id, deps())).toMatchObject({ accessToken: "new-login" });
    release(); expect(await pending).toMatchObject({ code: "context_changed" });
    expect(await getAccessToken(id, deps())).toMatchObject({ accessToken: "new-login" });
  });
  it("independent clients share the mandatory lease even with the old rollout flag false", async () => {
    const first = deps(); const second = deps(independentClient()); let release!: () => void; let entered!: () => void;
    const waiting = new Promise<void>(r => { release = r; }); const started = new Promise<void>(r => { entered = r; });
    first.routes.push(async () => { entered(); await waiting; return json({ access_token: "refreshed", expires_in: 3600 }); });
    const p = getAccessToken(id, first); await started;
    await expect(getAccessToken(id, second)).rejects.toMatchObject({ code: "temporarily_unavailable" });
    expect(second.calls).toHaveLength(0); release(); await p;
    expect(await getAccessToken(id, second)).toMatchObject({ accessToken: "refreshed" }); expect(second.calls).toHaveLength(0);
  });
  it("rejects an old run generation before opening or refreshing the current grant", async () => {
    f.db.rows("accounts")[0].context_generation = 1;
    const d = deps(); await expect(getAccessToken(id, d)).rejects.toMatchObject({ code: "context_changed" });
    expect(d.calls).toHaveLength(0); expect(f.db.rows("connector_refresh_attempts")).toHaveLength(0);
  });
});

describe("refresh restart and uncertainty", () => {
  it.each(["network", "malformed", "unknown_400"])("%s cannot auto-replay after the lease expires", async mode => {
    const d = deps(); d.routes.push(() => {
      if (mode === "network") throw new Error("synthetic dropped response");
      return mode === "malformed" ? json({ access_token: null }) : json({ error: "unknown" }, 400);
    });
    await expect(getAccessToken(id, d)).rejects.toMatchObject({ code: "temporarily_unavailable" });
    expect(f.db.rows("connector_refresh_attempts")[0]).toMatchObject({ status: "uncertain", attempts: 1 });
    time += 120_000;
    const restarted = deps(independentClient());
    await expect(getAccessToken(id, restarted)).rejects.toMatchObject({ code: "temporarily_unavailable" });
    expect(restarted.calls).toHaveLength(0); expect(f.db.rows("connectors")[0].status).toBe("connected");
  });
  it("a lost attempt-claim response does not permit a POST after restart", async () => {
    const original = f.db.rpcs.begin_connector_refresh;
    f.db.rpcs.begin_connector_refresh = args => { original(args); throw new Error("claim response lost"); };
    const d = deps(); await expect(getAccessToken(id, d)).rejects.toThrow("claim response lost"); expect(d.calls).toHaveLength(0);
    f.db.rpcs.begin_connector_refresh = original; time += 120_000;
    const restarted = deps(independentClient()); await expect(getAccessToken(id, restarted)).rejects.toMatchObject({ code: "temporarily_unavailable" });
    expect(restarted.calls).toHaveLength(0); expect(f.db.rows("connector_refresh_attempts")[0].status).toBe("pending");
  });
  it("a lost successful commit is recovered by a fresh read, without another refresh POST", async () => {
    const original = f.db.rpcs.settle_connector_token;
    f.db.rpcs.settle_connector_token = args => { const result = original(args); throw new Error(result ? "response lost after commit" : "refused"); };
    const d = deps(); d.routes.push(() => json({ access_token: "refreshed", expires_in: 3600 }));
    await expect(getAccessToken(id, d)).rejects.toThrow("response lost after commit");
    f.db.rpcs.settle_connector_token = original;
    const restarted = deps(independentClient());
    expect(await getAccessToken(id, restarted)).toMatchObject({ accessToken: "refreshed" }); expect(restarted.calls).toHaveLength(0);
    expect(f.db.rows("connector_refresh_attempts")[0].status).toBe("succeeded");
  });
  it("classified temporary errors have a cooldown and at most three attempts for the captured grant", async () => {
    const d = deps(); d.routes.push(() => json({ error: "server_error" }, 503));
    for (let i = 0; i < 3; i++) {
      await expect(getAccessToken(id, d)).rejects.toMatchObject({ code: "temporarily_unavailable" });
      expect(d.calls).toHaveLength(i + 1);
      await expect(getAccessToken(id, d)).rejects.toMatchObject({ code: "temporarily_unavailable" });
      expect(d.calls).toHaveLength(i + 1); time += 31_000;
    }
    time += 3600_000;
    await expect(getAccessToken(id, d)).rejects.toMatchObject({ code: "temporarily_unavailable" }); expect(d.calls).toHaveLength(3);
    expect(f.db.rows("connectors")[0].status).toBe("connected");
  });
});

describe("captured credentials throughout a provider read", () => {
  it.each(["reset", "pause", "owner", "disconnect", "secret", "asset"])("stops paging after %s without accepting the first response", async mode => {
    await replaceSecret("valid"); const d = deps(); let requests = 0;
    const provider = new ConnectorCredentialProvider(d);
    const reader = new WorkerConnectorReader({ credentials: provider,
      fetch: (async () => { requests++; await change(mode); return json({ data: [] }); }) as typeof fetch,
      readers: { ga4: async (_query, _credential, options) => {
        await options!.fetch!("https://synthetic.test/page1");
        await options!.fetch!("https://synthetic.test/page2");
        return { ok: true, rows: [], metrics: {}, count: 0, provenance: { platform: "ga4", fetchedAt: NOW.toISOString(), source: "live" } };
      } },
    });
    await expect(reader.read("ga4", { resource: "sessions" }, { account: { accountId: f.accountId, contextGeneration: 0 } } as RunContext)).rejects.toMatchObject({ code: "context_changed" });
    expect(requests).toBe(1);
  });
  it("does not use a token that expires after credential acquisition", async () => {
    await replaceSecret("valid", 3600_000); const provider = new ConnectorCredentialProvider(deps());
    const credential = await provider.get(f.accountId, "ga4", { accountId: f.accountId, contextGeneration: 0 });
    time += 3600_000; await expect(provider.validate(credential!)).rejects.toMatchObject({ code: "temporarily_unavailable" });
  });
});
