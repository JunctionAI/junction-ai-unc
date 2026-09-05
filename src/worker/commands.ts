/** Durable command consumer. No Next imports; also used by the standalone worker. */
import { dispatchDeps, commandOwner } from "../lib/commands/deps";
import { processCommand, reconcileCommand } from "../lib/commands/process";
import { commandsEnabled, type RoutineCommand } from "../lib/commands/types";
import { DbCommandQueue } from "../lib/commands/queue";
import { unwrap, type DbClient, type Row } from "../lib/db/types";
import { runRoutine, type Adapters } from "../lib/runtime/engine";
import type { N8nWorkflow, RoutineSpec } from "../lib/runtime/types";
import type { Store } from "../lib/runtime/store/interface";
import { rowToLink } from "../lib/channels/links";
import { buildAdapters as channelAdapters } from "../lib/channels/adapters";
import { sendOnLink, type AdapterRegistry } from "../lib/channels/outbound";
import { keyringFromEnv } from "../lib/connectors/crypto";
import { resolveAccount, type ServiceDeps } from "./service";
import { drainInboundEvents } from "../lib/channels/inbox";
import { handleInbound } from "../lib/channels/inbound";
import { messagingDisabled } from "../lib/channels/releaseGate";
import { assertRuntimeContext } from "../lib/db/runtimeContext";
import { assertSameRuntimeContext, RuntimeContextError } from "../lib/runtime/contextFence";
import { freezeCommandActor } from "../lib/commands/binding";
import { assertCommandSelection } from "../lib/commands/selectionGuard";
import { digest } from "../lib/commands/queue";
import { workflowFingerprint } from "../lib/commands/releaseScope";

export async function executeRoutineCommand(deps: ServiceDeps, adapters: Adapters, c: RoutineCommand, spec: RoutineSpec, workflow: N8nWorkflow | null) {
  c = Object.freeze({ ...c, actor: freezeCommandActor(c.actor) });
  spec = structuredClone(spec);
  workflow = workflow ? structuredClone(workflow) : null;
  const identity = Object.freeze({ accountId: c.actor.accountId, contextGeneration: c.contextGeneration });
  if (deps.db) await assertRuntimeContext(deps.db, identity);
  if (deps.db) {
    if (digest(spec) !== c.specHash || workflowFingerprint(workflow) !== c.workflowHash || spec.id !== c.routineId || spec.version !== c.version)
      throw new Error("Command execution differs from the queued selection.");
    await assertCommandSelection(deps.db, deps.store, c);
  }
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
    assertContext: async current => {
      assertSameRuntimeContext(identity, current);
      await adapters.assertContext?.(current);
      if (deps.db) await assertCommandSelection(deps.db, deps.store, c);
    },
    // A selected external workflow never silently falls back to a different implementation.
    ...(workflow ? { producer: undefined } : {}),
  }, { mode: "dry_run", runId: c.id });
  return result;
}

export async function notifyCommand(db: DbClient, c: RoutineCommand, injected?: { adapters: AdapterRegistry; now: () => Date }): Promise<void> {
  c = Object.freeze({ ...c, actor: freezeCommandActor(c.actor) });
  const identity = Object.freeze({ accountId: c.actor.accountId, contextGeneration: c.contextGeneration });
  const guard = () => assertRuntimeContext(db, identity);
  await guard();
  if (messagingDisabled(process.env) || c.actor.channel === "app" || !c.actor.linkId || !await commandOwner(db, c.actor)) return;
  const prepared = await unwrap<{ operation: Row; link: Row } | null>("commands.prepare_notification",
    db.rpc("prepare_command_notification", { command_id: c.id, expected_revision: c.notificationRevision ?? 0 }));
  if (!prepared) return;
  const link = rowToLink(prepared.link);
  const operation = prepared.operation;
  if (operation.account_id !== identity.accountId || operation.context_generation !== identity.contextGeneration ||
    link.id !== c.actor.linkId || link.userId !== c.actor.userId ||
    link.bindingVersion !== c.actor.channelBinding?.bindingVersion) throw new Error("Notification identity mismatch");
  await guard();
  const adapters = injected?.adapters ?? channelAdapters({ db, env: process.env, fetch: (url, init) => fetch(url, init), keyring: keyringFromEnv(process.env) });
  // The immutable prepared result, not this polling caller's stale reply, owns the send.
  // Its source revision is checked again atomically by the outbox claim.
  await sendOnLink({ db, adapters, now: injected?.now ?? (() => new Date()), guard }, link, "reply",
    operation.payload as unknown as import("../lib/channels/types").OutboundPayload,
    { contextGeneration: identity.contextGeneration, ref: String(operation.ref), appendToThread: true });
  // Delivery truth stays in the outbox, including queued/uncertain. Never write a
  // stale command row after provider I/O or call a queued message sent.
}

export async function runCommandsTick(deps: ServiceDeps, adapters: Adapters, maxMs = 20_000): Promise<void> {
  if (!deps.db) return;
  const start = Date.now();
  const db = deps.db;
  const channels = channelAdapters({ db, env: process.env, fetch: (url, init) => fetch(url, init), keyring: keyringFromEnv(process.env) });
  if (!messagingDisabled(process.env) && Object.values(channels).some(adapter => adapter?.configured))
    await drainInboundEvents(db, (message) => handleInbound({ db, store: deps.store, accounts: deps.accounts, adapters: channels, now: deps.now ?? (() => new Date()) }, message), Math.floor(maxMs / 2));
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
