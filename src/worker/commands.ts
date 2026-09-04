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

export async function executeRoutineCommand(deps: ServiceDeps, adapters: Adapters, c: RoutineCommand, spec: RoutineSpec, workflow: N8nWorkflow | null) {
  const account = await resolveAccount(deps, c.actor.accountId);
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

async function notify(db: DbClient, c: RoutineCommand): Promise<void> {
  if (c.actor.channel === "app" || !c.actor.linkId || !await commandOwner(db, c.actor)) return;
  const link = await getLink(db, c.actor.linkId);
  if (!link || link.accountId !== c.actor.accountId) return;
  // Claim BEFORE network I/O. Ambiguous delivery is not automatically repeated.
  const claim = await unwrap<{ id: string } | null>("commands.notify_claim", db.from("routine_commands").update({ notification_status: "claimed" }).eq("id", c.id).eq("account_id", c.actor.accountId).eq("notification_status", "pending").select("id").maybeSingle());
  if (!claim) return;
  let status = "failed";
  try {
    const adapters = channelAdapters({ db, env: process.env, fetch: (url, init) => fetch(url, init), keyring: keyringFromEnv(process.env) });
    const out = await sendOnLink({ db, adapters, now: () => new Date() }, link, "reply", { text: `${c.reply} Request ${c.id.slice(0, 8)}.` }, { ref: `command:${c.id}`, appendToThread: true });
    if (out.status === "sent" || out.status === "queued") status = "sent";
  } finally {
    await unwrap("commands.notify_finish", db.from("routine_commands").update({ notification_status: status }).eq("id", c.id).eq("account_id", c.actor.accountId).eq("notification_status", "claimed"));
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
  const pending = await unwrap<{ id: string; account_id: string }[]>("commands.notifications", db.from("routine_commands").select("id, account_id").in("channel", ["slack", "sms", "telegram", "whatsapp", "email"]).in("status", ["done", "blocked", "failed", "uncertain", "waiting"]).eq("notification_status", "pending").order("updated_at").limit(20));
  for (const row of pending) {
    const c = await queue.get(row.account_id, row.id);
    if (c && (c.status !== "waiting" || (c.runId && (await deps.store.getRun(c.runId))?.status !== "running"))) await notify(db, c);
  }
}
