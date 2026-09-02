/* Approvals — the product loop's read side and its decision side, as two handlers the API
   routes wrap:

     listApprovalsForAccount(deps, accountId)
       → the account's pending, unexpired approvals (joined to the routine catalog for the
         name/category the card shows), the 10 most recent receipts, and the latest dry-run
         drafts ("What I drafted" — founders on the read-only launch wave never see an
         approval, so this is how Unc's daily work reaches Home).

     decideApproval(deps, { accountId, approvalId, decision, decidedBy })
       → the SAME resume path the worker uses (src/worker/service.ts resumeApproval → engine
         resumeRun), which re-checks status + expiry, writes the taste_event, and continues
         or ends the run. Returns the updated approval and every receipt the resume produced.

   Store-agnostic: MemoryStore in demo mode, SupabaseStore with the service role otherwise.
   Nothing here reads process.env. */

import { ALL_SYSTEMS } from "@/lib/platform/catalog";
import type { Store } from "@/lib/runtime/store/interface";
import type { ApprovalRecord, Receipt, ReceiptKind, RunResult } from "@/lib/runtime/types";
import { resumeApproval, type ServiceDeps } from "@/worker/service";

export interface ApprovalView {
  id: string;
  runId: string;
  routineId: string;
  routineName: string;
  category: string;
  title: string;
  detail: string;
  before: string;
  after: string;
  reasoning: string;
  status: ApprovalRecord["status"];
  expiresAt: string;
  createdAt: string;
  decidedAt: string | null;
}

export interface ReceiptView {
  id: string;
  runId: string;
  approvalId: string | null;
  kind: ReceiptKind;
  platform: string | null;
  description: string;
  createdAt: string;
}

/** One dry-run's drafted output, with the routine it came from. `title`/`detail` are the
    gate preview the run would have asked about (what the approval card would have said);
    `description` is the receipt line itself. */
export interface DraftView {
  runId: string;
  routineId: string;
  routineName: string;
  title: string;
  detail: string;
  description: string;
  createdAt: string;
  status: string;
}

export interface ApprovalsListing {
  approvals: ApprovalView[];
  receipts: ReceiptView[];
  drafts: DraftView[];
}

export interface ApprovalsDeps {
  store: Store;
  now?: () => Date;
}

export const RECENT_RECEIPTS = 10;
export const RECENT_DRAFT_RUNS = 5;

const catalogById = new Map(ALL_SYSTEMS.map((s) => [s.id, s]));

export function approvalView(a: ApprovalRecord): ApprovalView {
  const def = catalogById.get(a.routineId);
  return {
    id: a.id,
    runId: a.runId,
    routineId: a.routineId,
    routineName: def?.name ?? a.routineId,
    category: def?.cat ?? "",
    title: a.title,
    detail: a.detail ?? "",
    before: a.beforeState ?? "",
    after: a.afterState ?? "",
    reasoning: a.reasoning ?? "",
    status: a.status,
    expiresAt: a.expiresAt,
    createdAt: a.createdAt,
    decidedAt: a.decidedAt ?? null,
  };
}

export function receiptView(r: Receipt): ReceiptView {
  return { id: r.id, runId: r.runId, approvalId: r.approvalId ?? null, kind: r.kind, platform: r.platform ?? null, description: r.description, createdAt: r.createdAt };
}

/** Pending approvals that a run created (rows with no run — the Phase-2 demo cards persisted
    under client_key — are not the runtime's) and that haven't lapsed. Newest first. */
export async function listPendingApprovals(deps: ApprovalsDeps, accountId: string): Promise<ApprovalView[]> {
  const nowIso = (deps.now ?? (() => new Date()))().toISOString();
  const rows = await deps.store.listApprovals(accountId, "pending");
  return rows.filter((a) => !!a.runId && a.expiresAt >= nowIso).map(approvalView);
}

/** The latest dry-run drafts: the newest finished dry runs, each represented by the draft
    receipt that carries its approval preview ("Would ask …" — what the founder would have
    been asked), else its last draft receipt. Newest run first; runs that drafted nothing are
    skipped. */
export async function listRecentDrafts(deps: ApprovalsDeps, accountId: string, limit = RECENT_DRAFT_RUNS): Promise<DraftView[]> {
  const runs = await deps.store.listRuns(accountId, { mode: "dry_run", limit: limit * 3 });
  const out: DraftView[] = [];
  for (const run of runs) {
    if (run.status === "running") continue;
    const receipts = await deps.store.listReceipts(accountId, { runId: run.id, kind: "draft" });
    const preview = receipts.find((r) => r.payload && typeof r.payload === "object" && "approvalPreview" in r.payload);
    const pick = preview ?? receipts[receipts.length - 1];
    if (!pick) continue;
    const ap = (preview?.payload.approvalPreview ?? {}) as { title?: unknown; detail?: unknown };
    const def = catalogById.get(run.routineId);
    out.push({
      runId: run.id,
      routineId: run.routineId,
      routineName: def?.name ?? run.routineId,
      title: typeof ap.title === "string" && ap.title ? ap.title : pick.description,
      detail: typeof ap.detail === "string" ? ap.detail : "",
      description: pick.description,
      createdAt: pick.createdAt,
      status: run.status,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export async function listApprovalsForAccount(deps: ApprovalsDeps, accountId: string): Promise<ApprovalsListing> {
  const [approvals, receipts, drafts] = await Promise.all([
    listPendingApprovals(deps, accountId),
    deps.store.listReceipts(accountId, { limit: RECENT_RECEIPTS }),
    listRecentDrafts(deps, accountId),
  ]);
  return { approvals, receipts: receipts.map(receiptView), drafts };
}

// ---------- decide ----------

export type DecideErrorCode = "not_found" | "already_decided" | "not_resumable";

export class DecideError extends Error {
  constructor(
    readonly code: DecideErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DecideError";
  }
}

export interface DecideInput {
  /** When set, the approval must belong to this account (a session-bound route passes the
      founder's account; demo mode passes null). Mismatch reads as not found — never a hint. */
  accountId: string | null;
  approvalId: string;
  decision: "approved" | "held";
  decidedBy?: string;
}

export interface DecideOutcome {
  approval: ApprovalView;
  run: RunResult;
  receipts: ReceiptView[];
}

export function decideErrorStatus(err: DecideError): number {
  switch (err.code) {
    case "not_found":
      return 404;
    case "already_decided":
    case "not_resumable":
      return 409;
  }
}

/** Decide a pending approval through the worker's resume path (engine resumeRun). */
export async function decideApproval(deps: ServiceDeps, input: DecideInput): Promise<DecideOutcome> {
  const approval = await deps.store.getApproval(input.approvalId);
  if (!approval || (input.accountId && approval.accountId !== input.accountId)) throw new DecideError("not_found", `approval ${input.approvalId} not found`);
  if (approval.status !== "pending") throw new DecideError("already_decided", `approval ${approval.id} already ${approval.status}`);
  if (!approval.runId) throw new DecideError("not_resumable", `approval ${approval.id} has no run to resume`);
  let run: RunResult;
  try {
    run = await resumeApproval(deps, { runId: approval.runId, decision: input.decision, decidedBy: input.decidedBy });
  } catch (err) {
    const message = err instanceof Error ? err.message : "resume failed";
    if (/not found/.test(message)) throw new DecideError("not_found", message);
    if (/already/.test(message)) throw new DecideError("already_decided", message);
    if (/not waiting_approval|no resumable snapshot/.test(message)) throw new DecideError("not_resumable", message);
    throw err;
  }
  const updated = run.approval ?? (await deps.store.getApproval(approval.id)) ?? approval;
  return { approval: approvalView(updated), run, receipts: run.receipts.map(receiptView) };
}
