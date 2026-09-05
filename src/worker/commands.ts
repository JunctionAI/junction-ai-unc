/** Durable command consumer. No Next imports; also used by the standalone worker. */
import { dispatchDeps, commandOwner } from "../lib/commands/deps";
import { processCommand, reconcileCommand } from "../lib/commands/process";
import { commandsEnabled, type RoutineCommand } from "../lib/commands/types";
import { DbCommandQueue } from "../lib/commands/queue";
import { unwrap, type DbClient } from "../lib/db/types";
import { runRoutine, type Adapters } from "../lib/runtime/engine";
import type { N8nWorkflow, RoutineSpec } from "../lib/runtime/types";
import type { Store } from "../lib/runtime/store/interface";
import { getLink } from "../lib/channels/links";
import { buildAdapters as channelAdapters } from "../lib/channels/adapters";
import { sendOnLink } from "../lib/channels/outbound";
import { keyringFromEnv } from "../lib/connectors/crypto";
import { resolveAccount, type ServiceDeps } from "./service";
import { drainInboundEvents } from "../lib/channels/inbox";
import { handleInbound } from "../lib/channels/inbound";
import { tnzConfig } from "../lib/channels/adapters/tnz";
import { assertRuntimeContext } from "../lib/db/runtimeContext";
import { assertSameRuntimeContext, RuntimeContextError } from "../lib/runtime/contextFence";

export async function executeRoutineCommand(deps: ServiceDeps, adapters: Adapters, c: RoutineCommand, spec: RoutineSpec, workflow: N8nWorkflow | null) {
  c = Object.freeze({ ...c, actor: Object.freeze({ ...c.actor }) });
  const identity = Object.freeze({ accountId: c.actor.accountId, contextGeneration: c.contextGeneration });
  if (deps.db) await assertRuntimeContext(deps.db, identity);
  const account = await resolveAccount(deps, c.actor.accountId);
  assertSameRuntimeContext(identity, account.account);
  if (deps.db) await assertRuntimeContext(deps.db, identity);
  // Freeze selection for the whole run. Methods remain bound to the original Store instance.
  const pinned = new Proxy(deps.store, { get(target, key) {
    if (key === "findN8nWorkflow") return async (accountId: string, routineId: string) => accountId === c.actor.accountId && routineId === c.routineId ? workflow : null;
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } }) as Store;
  const result = await runRoutine(spec, { account: account.account, triggeredBy: "manual", vars: account.vars ?? {}, inputs: { request: c.request } }, {
    ...adapters, store: pinned,
    // A selected external workflow never silently falls back to a different implementation.
    ...(workflow ? { producer: undefined } : {}),
  }, { mode: "dry_run", runId: c.id });
  return result;
}

export async function notifyCommand(db: DbClient, c: RoutineCommand): Promise<void> {
  c = Object.freeze({ ...c, actor: Object.freeze({ ...c.actor }) });
  const identity = Object.freeze({ accountId: c.actor.accountId, contextGeneration: c.contextGeneration });
  const guard = () => assertRuntimeContext(db, identity);
  await guard();
  if (c.actor.channel === "app" || !c.actor.linkId || !await commandOwner(db, c.actor)) return;
  const link = await getLink(db, c.actor.linkId);
  if (!link || link.accountId !== c.actor.accountId) return;
  await guard();
  // Claim BEFORE network I/O. Ambiguous delivery is not automatically repeated.
  const claim = await unwrap<{ id: string } | null>("commands.notify_claim", db.from("routine_commands").update({ notification_status: "claimed" }).eq("id", c.id).eq("account_id", identity.accountId).eq("context_generation", identity.contextGeneration).eq("notification_status", "pending").select("id").maybeSingle());
  if (!claim) return;
  let status = "failed";
  try {
    await guard();
    const adapters = channelAdapters({ db, env: process.env, fetch: (url, init) => fetch(url, init), keyring: keyringFromEnv(process.env) });
    const out = await sendOnLink({ db, adapters, now: () => new Date() }, link, "reply", { text: `${c.reply} Request ${c.id.slice(0, 8)}.` }, { ref: `command:${c.id}`, appendToThread: true });
    if (out.status === "sent" || out.status === "queued") status = "sent";
  } finally {
    await guard();
    await unwrap("commands.notify_finish", db.from("routine_commands").update({ notification_status: status }).eq("id", c.id).eq("account_id", identity.accountId).eq("context_generation", identity.contextGeneration).eq("notification_status", "claimed"));
  }
}

export async function runCommandsTick(deps: ServiceDeps, adapters: Adapters, maxMs = 20_000): Promise<void> {
  if ((!commandsEnabled() && !tnzConfig(process.env)) || !deps.db) return;
  const start = Date.now();
  const db = deps.db;
  const channels = channelAdapters({ db, env: process.env, fetch: (url, init) => fetch(url, init), keyring: keyringFromEnv(process.env) });
  await drainInboundEvents(db, (event) => handleInbound({ db, store: deps.store, accounts: deps.accounts, adapters: channels, now: deps.now ?? (() => new Date()) }, event), Math.floor(maxMs / 2));
  if (!commandsEnabled()) return;
  const queue = new DbCommandQueue(db);
  // Callbacks or founder input can change a previously waiting run between ticks.
  for (const status of ["running", "waiting", "uncertain"] as const) {
    for (const c of await queue.list(status, 20)) await reconcileCommand(dispatchDeps(db, deps.store, c.actor.accountId), c);
  }
  for (const c of await queue.list("queued", 10)) {
    if (Date.now() - start >= maxMs) break;
    const base = dispatchDeps(db, deps.store, c.actor.accountId);
    await processCommand({ ...base, execute: (command, spec, workflow) => executeRoutineCommand(deps, adapters, command, spec, workflow) }, c);
  }
  // Query pending notifications, not the oldest already-notified terminal rows.
  for (const c of await queue.notifications(20)) {
    if (c.status !== "waiting" || (c.runId && (await deps.store.getRun(c.runId))?.status !== "running")) {
      try { await notifyCommand(db, c); }
      catch (error) { if (!(error instanceof RuntimeContextError) || error.code === "context_unavailable") throw error; }
    }
  }
}
