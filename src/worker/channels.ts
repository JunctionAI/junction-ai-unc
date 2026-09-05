/* Proactive outbound — the worker's channels tick (docs/CHANNELS.md).

   runChannelsTick(deps) — for every account with a verified channel link, push what is new
   since the look-back to the founder's linked channels, per link prefs, outside quiet hours:

     brief         a daily_briefs row (the morning brief)            ref brief:<id>
     draft_landed  the first draft receipt of a run ("What I drafted") ref draft:<run_id>
     approval      a pending approval a run created                    ref approval:<id>   (buttons)
     reminder      a pending approval lapsing within 2 hours            ref reminder:<id>   (buttons)

   Dedup is durable: outbound_messages.ref per link (alreadyPushed), so a restart never
   re-sends and a quiet-hours skip is simply picked up by the next tick. App-only accounts
   (no verified link) get nothing extra. Nothing here sends when no channel is configured.

   Registration: the loop (src/worker/loop.ts, owned elsewhere) calls this once per tick
   after the briefs — the two lines are in docs/CHANNELS.md §Worker. Relative imports only. */

import { readTimezone } from "../lib/brain/brief";
import { buildAdapters } from "../lib/channels/adapters/index";
import { approvalPayload, briefPayload, draftPayload } from "../lib/channels/approvals";
import { accountsWithLinks, verifiedLinks } from "../lib/channels/links";
import { pushToAccount, type AdapterRegistry, type OutboundDeps, type PushReport } from "../lib/channels/outbound";
import type { Env, FetchLike } from "../lib/channels/types";
import type { Keyring } from "../lib/connectors/crypto";
import { unwrap, type DbClient } from "../lib/db/types";
import { accountContextGeneration } from "../lib/db/contextGeneration";
import { assertRuntimeContext } from "../lib/db/runtimeContext";
import { assertSameRuntimeContext } from "../lib/runtime/contextFence";
import { ALL_SYSTEMS } from "../lib/platform/catalog";
import type { Store } from "../lib/runtime/store/interface";
import type { Receipt } from "../lib/runtime/types";
import type { Logger } from "./log";

export const CHANNELS_LOOKBACK_MS = 24 * 3_600_000;
export const REMINDER_WINDOW_MS = 2 * 3_600_000;

export interface ChannelsDeps {
  store: Store;
  /** Service-role client; null in demo mode → nothing runs. */
  db: DbClient | null;
  now?: () => Date;
  log?: Logger;
  env?: Env;
  fetch?: FetchLike;
  keyring?: Keyring | null;
  /** Tests inject fakes; production builds from env. */
  adapters?: AdapterRegistry;
}

export interface ChannelsTickReport {
  accounts: number;
  briefs: number;
  drafts: number;
  approvals: number;
  reminders: number;
  failed: number;
  queued: number;
  quiet: number;
  /** True when there is no database. */
  skipped: boolean;
}

const NAME_BY_ID = new Map(ALL_SYSTEMS.map((s) => [s.id, s.name]));

function tally(report: ChannelsTickReport, key: "briefs" | "drafts" | "approvals" | "reminders", r: PushReport) {
  if (r.sent + r.queued > 0) report[key] += 1;
  report.failed += r.failed;
  report.queued += r.queued;
  report.quiet += r.quiet;
}

/** The receipt that carries a run's approval preview, else its earliest draft. */
export function firstDraftPerRun(receipts: Receipt[]): Map<string, Receipt> {
  const byRun = new Map<string, Receipt[]>();
  for (const r of receipts) {
    if (r.kind !== "draft" || !r.runId) continue;
    (byRun.get(r.runId) ?? byRun.set(r.runId, []).get(r.runId)!).push(r);
  }
  const out = new Map<string, Receipt>();
  for (const [runId, list] of byRun) {
    const sorted = [...list].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    out.set(runId, sorted.find((r) => r.payload && typeof r.payload === "object" && "approvalPreview" in r.payload) ?? sorted[0]);
  }
  return out;
}

export async function runChannelsTick(deps: ChannelsDeps, opts: { accountId?: string; lookbackMs?: number } = {}): Promise<ChannelsTickReport> {
  const report: ChannelsTickReport = { accounts: 0, briefs: 0, drafts: 0, approvals: 0, reminders: 0, failed: 0, queued: 0, quiet: 0, skipped: false };
  if (!deps.db) {
    report.skipped = true;
    return report;
  }
  const db = deps.db;
  const now = deps.now ?? (() => new Date());
  const log = (event: string, fields: Record<string, unknown>) => deps.log?.info(event, fields);
  const adapters = deps.adapters ?? buildAdapters({ env: deps.env ?? process.env, fetch: deps.fetch ?? ((input, init) => fetch(input, init)), db, keyring: deps.keyring ?? null });
  const out: OutboundDeps = { db, adapters, now, log };
  const lookback = opts.lookbackMs ?? CHANNELS_LOOKBACK_MS;
  const ids = opts.accountId ? [opts.accountId] : await accountsWithLinks(db);

  for (const accountId of ids) {
    const links = await verifiedLinks(db, accountId);
    if (!links.length) continue;
    report.accounts++;
    let contextGeneration: number;
    try {
      contextGeneration = await accountContextGeneration(db, accountId);
      await assertRuntimeContext(db, { accountId, contextGeneration });
    } catch {
      report.failed++;
      log("channels.context_unavailable", { accountId });
      continue;
    }
    const identity = { accountId, contextGeneration };
    const guard = () => assertRuntimeContext(db, identity);
    const at = now();
    const since = new Date(at.getTime() - lookback).toISOString();
    let timezone: string | null = null;
    try {
      timezone = await readTimezone(db, accountId);
    } catch (err) {
      log("channels.timezone_failed", { accountId, error: err instanceof Error ? err.message : String(err) });
    }
    const push = (kind: "brief" | "draft_landed" | "approval" | "reminder", ref: string, payload: { text: string; buttons?: { id: string; label: string }[] }, allowTemplate = false) =>
      pushToAccount({ ...out, guard }, { accountId, contextGeneration, kind, ref, payload, links, timezone, allowTemplate });

    try {
      // the morning brief
      const briefs = await unwrap<{ id: string; body: string; items: unknown; created_at: string }[]>("daily_briefs.select", db.from("daily_briefs").select("id, body, items, created_at").eq("account_id", accountId).eq("context_generation", contextGeneration).gte("created_at", since).order("created_at", { ascending: true }));
      await guard();
      for (const b of briefs) tally(report, "briefs", await push("brief", `brief:${b.id}`, briefPayload({ body: b.body, items: Array.isArray(b.items) ? (b.items as { kind: string; text: string }[]) : [] }), true));

      // drafts that landed
      const receipts = await deps.store.listReceipts(accountId, { kind: "draft", since, limit: 200, contextGeneration });
      await guard();
      for (const [runId, r] of firstDraftPerRun(receipts)) {
        const run = await deps.store.getRun(runId);
        if (!run) continue;
        assertSameRuntimeContext(identity, run);
        const preview = ((r.payload as { approvalPreview?: { title?: unknown; detail?: unknown } } | undefined)?.approvalPreview ?? {}) as { title?: unknown; detail?: unknown };
        tally(report, "drafts", await push("draft_landed", `draft:${runId}`, draftPayload({ title: typeof preview.title === "string" && preview.title ? preview.title : r.description, detail: typeof preview.detail === "string" ? preview.detail : null, routineName: run ? (NAME_BY_ID.get(run.routineId) ?? run.routineId) : null })));
      }

      // decisions waiting, and the ones about to lapse
      const pending = (await deps.store.listApprovals(accountId, "pending", contextGeneration)).filter((a) => !!a.runId && a.expiresAt > at.toISOString());
      await guard();
      for (const a of pending) {
        const routineName = NAME_BY_ID.get(a.routineId) ?? null;
        if (a.createdAt >= since) tally(report, "approvals", await push("approval", `approval:${a.id}`, approvalPayload(a, { routineName, now: at })));
        const left = new Date(a.expiresAt).getTime() - at.getTime();
        if (left > 0 && left <= REMINDER_WINDOW_MS) tally(report, "reminders", await push("reminder", `reminder:${a.id}`, approvalPayload(a, { routineName, now: at, reminder: true })));
      }
    } catch (err) {
      report.failed++;
      deps.log?.warn("channels.tick_account_failed", { accountId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  log("channels.tick", { accounts: report.accounts, briefs: report.briefs, drafts: report.drafts, approvals: report.approvals, reminders: report.reminders, failed: report.failed, queued: report.queued, quiet: report.quiet });
  return report;
}
