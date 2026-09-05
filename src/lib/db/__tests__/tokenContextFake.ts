import { isDeepStrictEqual } from "node:util";
import type { Row } from "../types";
import type { FakeSupabase } from "./fakeSupabase";

/** Application fixture only; PostgreSQL role/locking/rollback proof is separate. */
export function installTokenContextFake(db: FakeSupabase) {
  const binding = (id: unknown) => db.rpcs.native_oauth_binding({ connector: id }) as Row | null;
  const current = (captured: Row, grantOnly = false) => {
    const a = db.rows("accounts").find(a => a.id === captured.accountId);
    const b = captured.binding as Row;
    const withoutAsset = (value: Row | null) => value && Object.fromEntries(Object.entries(value).filter(([k]) => k !== "externalRef"));
    const actual = binding(b.id);
    return !!a && a.context_generation === captured.contextGeneration && b.accountId === a.id &&
      !(captured.enforcePause && a.automation_paused) &&
      (!captured.actor || db.rows("account_members").some(m => m.account_id === a.id && m.user_id === captured.actor && m.role === "owner")) &&
      isDeepStrictEqual(grantOnly ? withoutAsset(actual) : actual, grantOnly ? withoutAsset(b) : b);
  };
  const lease = (context: Row, holder: unknown) => db.rows("backend_leases").some(l =>
    l.lease_key === `connector:${(context.binding as Row).id}` && l.holder === holder && Date.parse(String(l.expires_at)) > Date.parse(db.now()));
  const attempt = (context: Row) => db.rows("connector_refresh_attempts").find(r => r.connector_id === (context.binding as Row).id &&
    r.context_generation === context.contextGeneration && r.secret_digest === (context.binding as Row).secretDigest);
  const atomic = (fn: () => unknown) => {
    const before = structuredClone(db.tables);
    try { return fn(); } catch (e) { db.tables.clear(); for (const [k, v] of before) db.tables.set(k, v); throw e; }
  };
  db.rpcs.claim_backend_lease = args => {
    const existing = db.rows("backend_leases").find(l => l.lease_key === args.p_key);
    if (existing && Date.parse(String(existing.expires_at)) >= Date.parse(db.now())) return false;
    db.upsertRow("backend_leases", { lease_key: args.p_key, holder: args.p_holder, expires_at: new Date(Date.parse(db.now()) + Number(args.p_seconds ?? 30) * 1000).toISOString() }, "lease_key");
    return true;
  };
  db.rpcs.capture_connector_token = args => {
    const a = db.rows("accounts").find(a => a.id === args.p_account);
    const c = db.rows("connectors").find(c => c.id === args.p_connector);
    if (!a || (args.p_generation != null && (args.p_generation !== a.context_generation || a.automation_paused)) || !c || c.account_id !== a.id || c.platform !== args.p_platform || c.status !== "connected") return null;
    if (args.p_actor && !db.rows("account_members").some(m => m.account_id === a.id && m.user_id === args.p_actor && m.role === "owner")) return null;
    const s = db.rows("connector_secrets").find(s => s.connector_id === c.id);
    return structuredClone({ context: { accountId: a.id, contextGeneration: a.context_generation, enforcePause: args.p_generation != null, actor: args.p_actor ?? null, binding: binding(c.id) }, row: c,
      sealed: s ? { ciphertext: s.ciphertext, iv: s.iv, tag: s.tag, keyVersion: s.key_version } : null });
  };
  db.rpcs.check_connector_token_context = args => current(args.captured as Row, args.grant_only === true);
  db.rpcs.connector_recovery_state = args => {
    if (!db.rows("account_members").some(m => m.account_id === args.p_account && m.user_id === args.p_actor)) return null;
    const a = db.rows("accounts").find(a => a.id === args.p_account);
    return db.rows("connectors").filter(c => c.account_id === args.p_account && c.status === "connected").flatMap(c => {
      const context = { binding: binding(c.id), contextGeneration: a?.context_generation };
      const r = attempt(context);
      if (!r || !["pending", "retryable", "uncertain"].includes(String(r.status))) return [];
      return [{ connectorId: c.id, status: r.status === "retryable" && Number(r.attempts) >= 3 ? "exhausted" : r.status === "pending" && !lease(context, r.holder) ? "uncertain" : r.status,
        attempts: r.attempts, retryAt: r.retry_at ?? null }];
    });
  };
  db.rpcs.begin_connector_refresh = args => atomic(() => {
    const input = args.input as Row; const context = input.context as Row;
    if (!lease(context, input.holder) || !current(context)) return false;
    const old = attempt(context);
    if (old && (old.status !== "retryable" || Number(old.attempts) >= 3 || Date.parse(String(old.retry_at)) > Date.parse(db.now()))) return false;
    db.upsertRow("connector_refresh_attempts", { connector_id: (context.binding as Row).id, context_generation: context.contextGeneration,
      secret_digest: (context.binding as Row).secretDigest, holder: input.holder, status: "pending", attempts: Number(old?.attempts ?? 0) + 1, retry_at: null, updated_at: db.now() }, "connector_id,context_generation,secret_digest");
    return true;
  });
  db.rpcs.settle_connector_token = args => atomic(() => {
    const input = args.input as Row; const context = input.context as Row;
    if (!["success", "reconnect", "temporary", "configuration"].includes(String(input.kind))) throw new Error("Invalid token outcome");
    if ((input.holder && !lease(context, input.holder)) || !current(context, true)) return null;
    const pending = attempt(context);
    if (input.refreshAttempt && (!pending || pending.holder !== input.holder || pending.status !== "pending")) return null;
    const c = db.rows("connectors").find(c => c.id === (context.binding as Row).id)!;
    const s = input.sealed as Row | undefined;
    if (input.refreshAttempt && input.kind === "success" && !s) throw new Error("Refreshed token must be saved");
    if (s) {
      if (input.kind !== "success" || !input.holder || !s.ciphertext || !s.iv || !s.tag || Number(s.keyVersion) < 1) throw new Error("Leased sealed replacement required");
      const old = db.rows("connector_secrets").find(r => r.connector_id === c.id);
      if (!old) throw new Error("Original sealed token missing");
      db.updateRows("connector_secrets", [old], { ciphertext: s.ciphertext, iv: s.iv, tag: s.tag, key_version: s.keyVersion, updated_at: db.now() });
    }
    if (input.kind === "success") { if (String(c.last_sync_result ?? "").startsWith("error:auth_")) db.updateRows("connectors", [c], { last_sync_result: null }); }
    else if (input.kind === "reconnect") db.updateRows("connectors", [c], { status: "needs_reconnect", last_sync_result: `error:${input.code}` });
    else db.updateRows("connectors", [c], { last_sync_result: input.kind === "temporary" ? "error:auth_temporarily_unavailable" : "error:auth_configuration_error" });
    if (input.refreshAttempt) {
      const retry = input.kind === "configuration" || (input.kind === "temporary" && input.retryable === true);
      db.updateRows("connector_refresh_attempts", [pending!], { status: input.kind === "success" ? "succeeded" : input.kind === "reconnect" ? "rejected" : retry ? "retryable" : "uncertain",
        retry_at: retry ? new Date(Date.parse(db.now()) + 30_000).toISOString() : null, updated_at: db.now() });
    }
    return structuredClone({ ...context, binding: binding(c.id) });
  });
}
