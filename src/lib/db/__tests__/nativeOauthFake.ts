import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Row } from "../types";
import type { FakeSupabase } from "./fakeSupabase";

/** Application fixture, not proof of PostgreSQL locking/permissions. The matching
 * migration must also pass the service-role rollback canary. */
export function installNativeOauthFake(db: FakeSupabase) {
  const digest = (state: unknown) => createHash("sha256").update(String(state)).digest("hex");
  const platforms = (p: unknown) => p === "google" ? ["ga4", "google_ads", "search_console"] : [p];
  const binding = (id: unknown) => {
    const c = db.rows("connectors").find(c => c.id === id);
    if (!c) return null;
    const secret = db.rows("connector_secrets").find(s => s.connector_id === id);
    const material = secret ? Object.fromEntries(Object.entries(secret).filter(([k]) => k !== "updated_at").sort(([a], [b]) => a.localeCompare(b))) : null;
    return structuredClone({ id: c.id, accountId: c.account_id, platform: c.platform, status: c.status,
      externalRef: c.external_ref, syncRef: c.sync_ref,
      secretDigest: material ? createHash("sha256").update(JSON.stringify(material)).digest("hex") : null });
  };
  const atomic = (fn: () => unknown) => {
    const before = structuredClone(db.tables);
    try { return fn(); } catch (e) {
      db.tables.clear(); for (const [name, rows] of before) db.tables.set(name, rows);
      throw e;
    }
  };
  const check = (args: Record<string, unknown>) => {
    const context = args.context_value as Row | null;
    if (!context || context.protocol !== "native_oauth_v1" || !args.actor || context.initiatedBy !== args.actor || !Array.isArray(context.targets)) return false;
    const a = db.rows("accounts").find(a => a.id === context.accountId);
    if (!a || a.context_generation !== context.contextGeneration || !db.rows("account_members").some(m => m.account_id === a.id && m.user_id === args.actor && m.role === "owner")) return false;
    if (!args.allow_expired && !(Date.parse(String(context.expiresAt)) > Date.parse(db.now()))) return false;
    const targets = context.targets as Row[];
    if (!isDeepStrictEqual(targets.map(t => t.platform).sort(), platforms(context.platform))) return false;
    return targets.every(t => {
      const c = db.rows("connectors").find(c => c.id === t.id);
      return !!c && c.account_id === a.id && c.pending_oauth_digest === digest(args.state_value) && isDeepStrictEqual(binding(t.id), t);
    });
  };
  db.rpcs.native_oauth_binding = args => binding(args.connector);
  db.rpcs.begin_native_connector_oauth = args => atomic(() => {
    const input = args.input as Row;
    const expiry = Date.parse(String(input.expires_at));
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(String(input.state)) || !input.platform || !(expiry > Date.parse(db.now())) || expiry > Date.parse(db.now()) + 605_000) throw new Error("Fresh native OAuth attempt required");
    const a = db.rows("accounts").find(a => a.id === input.account_id);
    if (!a || !db.rows("account_members").some(m => m.account_id === a.id && m.user_id === input.initiated_by && m.role === "owner")) throw new Error("Current initiating owner required");
    const targets = platforms(input.platform).map(platform => {
      const c = db.rows("connectors").find(c => c.account_id === a.id && c.platform === platform)
        ?? db.insertRow("connectors", { account_id: a.id, platform, status: "connecting" });
      db.updateRows("connectors", [c], { pending_oauth_digest: digest(input.state), status: c.status === "connected" ? "connected" : "connecting" });
      return binding(c.id);
    });
    const context = { protocol: "native_oauth_v1", accountId: a.id, initiatedBy: input.initiated_by,
      contextGeneration: a.context_generation, platform: input.platform, expiresAt: input.expires_at, targets };
    const { initiated_by: _actor, ...row } = input;
    void _actor;
    db.insertRow("oauth_states", { ...row, redirect_to: "/app", created_at: db.now(), auth_context: context });
    return structuredClone(context);
  });
  db.rpcs.check_native_connector_oauth = check;
  db.rpcs.finish_native_connector_oauth = args => atomic(() => {
    if (!check({ ...args, allow_expired: false })) return false;
    const targets = (args.context_value as Row).targets as Row[];
    const replacements = args.replacements as Row[];
    if (!Array.isArray(replacements) || !isDeepStrictEqual(replacements.map(r => r.connectorId).sort(), targets.map(t => t.id).sort())) throw new Error("Exact original targets required");
    for (const t of targets) {
      const r = replacements.find(r => r.connectorId === t.id)!;
      const s = r.sealed as Row;
      if (!s || !s.ciphertext || !s.iv || !s.tag || !Number.isInteger(s.keyVersion) || Number(s.keyVersion) < 1) throw new Error("Sealed credential required");
      db.upsertRow("connector_secrets", { connector_id: t.id, ciphertext: s.ciphertext, iv: s.iv, tag: s.tag, key_version: s.keyVersion, updated_at: db.now() }, "connector_id");
      const c = db.rows("connectors").find(c => c.id === t.id)!;
      const syncRef = Object.fromEntries(Object.entries(c.sync_ref as Row ?? {}).filter(([k]) => !["auth_provider", "provider_connection_id", "provider_integration"].includes(k)));
      db.updateRows("connectors", [c], { status: "connected", external_ref: r.externalRef ?? null, last_sync_at: null,
        last_sync_result: null, last_read_metrics: null, pending_oauth_digest: null, sync_ref: syncRef });
    }
    return true;
  });
  db.rpcs.fail_native_connector_oauth = args => atomic(() => {
    if (!check({ ...args, allow_expired: true })) return false;
    for (const t of (args.context_value as Row).targets as Row[]) {
      const c = db.rows("connectors").find(c => c.id === t.id)!;
      db.updateRows("connectors", [c], { pending_oauth_digest: null, status: c.status === "connecting" ? "error" : c.status,
        last_sync_result: c.status === "connecting" ? "error:oauth" : c.last_sync_result });
    }
    return true;
  });
  db.rpcs.record_connector_first_read = args => atomic(() => {
    const input = args.input as Row;
    const b = input.binding as Row;
    const a = db.rows("accounts").find(a => a.id === b.accountId);
    const c = db.rows("connectors").find(c => c.id === b.id);
    if (!a || a.automation_paused || a.context_generation !== input.contextGeneration || !c || c.account_id !== a.id ||
        c.platform !== b.platform || c.status !== "connected" || c.external_ref !== b.externalRef || !isDeepStrictEqual(c.sync_ref, b.syncRef)) return false;
    if (input.actor && !db.rows("account_members").some(m => m.account_id === a.id && m.user_id === input.actor && m.role === "owner")) return false;
    const metrics = input.metrics as Row[];
    if (!Array.isArray(metrics) || metrics.length > 20 || ![null, "ok", "empty", "error:first_read", "error:no_reader"].includes(input.result as string | null) || !input.description) throw new Error("Invalid first-read result");
    for (const m of metrics) {
      if (m.account_id !== a.id || m.context_generation !== a.context_generation || m.platform !== c.platform || input.result !== "ok") throw new Error("First-read metric identity mismatch");
      db.upsertRow("kpi_snapshots", m, "account_id,context_generation,metric_key,window_end");
    }
    if (input.result !== null) db.updateRows("connectors", [c], { last_sync_at: db.now(), last_sync_result: input.result, last_read_metrics: metrics.length });
    db.insertRow("receipts", { account_id: a.id, context_generation: a.context_generation, run_id: null, approval_id: null,
      kind: "notification", platform: c.platform, description: input.description, payload: input.payload, created_at: db.now() });
    return true;
  });
}
