/* Store — the runtime's persistence boundary.

   Designed so a Supabase adapter maps 1:1 onto supabase/migrations/0001_init.sql.
   Every method is account-scoped (RLS does the rest server-side).

   TABLE MAPPING
   ─────────────────────────────────────────────────────────────────────────
   RoutineStateRecord  → routine_states
     accountId         → account_id
     routineId         → routine_id
     enabled           → enabled
     version           → version            (the LIVE version number)
     draftSpec         → draft_spec (jsonb) (RoutineSpec | null; its .version = version + 1)
     liveSpec          → live_spec  (jsonb) (RoutineSpec | null; null = catalog default)
     updatedAt         → updated_at

   RunRecord           → routine_runs
     id                → id
     accountId         → account_id
     routineId         → routine_id
     version           → version
     mode              → mode   ('live' | 'dry_run')
     status            → status ('running' | 'waiting_approval' | 'done' | 'failed' | 'skipped')
     startedAt         → started_at
     finishedAt        → finished_at
     summary           → summary
     approvalId        → *needs column*  approval_id uuid references approvals(id)
     dedupKey          → *needs column*  dedup_key text          (index (account_id, dedup_key))
     specHash          → *needs column*  spec_hash text          (promote checks the dry run
                                                                  ran the exact draft)
     snapshot          → *needs column*  snapshot jsonb          (RunSnapshot: spec + ctx +
                                                                  nextNodeIndex, written when a
                                                                  gate pauses the run; cleared on
                                                                  finish)
     → these four columns are migration 0002 (not written by the runtime work).

   ApprovalRecord      → approvals
     id/accountId/runId/routineId → id/account_id/run_id/routine_id
     title/detail      → title/detail
     beforeState       → before_state
     afterState        → after_state
     reasoning         → reasoning
     status            → status ('pending' | 'approved' | 'held' | 'expired')
     expiresAt         → expires_at
     decidedAt         → decided_at
     decidedBy         → decided_by (uuid; the runtime treats it as an opaque string)
     createdAt         → created_at

   Receipt             → receipts
     id/accountId/runId/approvalId → id/account_id/run_id/approval_id
     kind              → kind ('read' | 'draft' | 'mutation' | 'notification')
     platform          → platform
     description       → description
     payload           → payload (jsonb)
     spend             → payload.spend   (the adapter folds it into payload as
                                          {amount, currency, period}; sumSpend reads it back
                                          with  (payload->'spend'->>'amount')::numeric)
     createdAt         → created_at

   TasteEvent          → taste_events
     id/accountId/approvalId/routineId → id/account_id/approval_id/routine_id
     action            → action ('approved' | 'held' | 'why_opened' | 'edited')
     context           → context (jsonb)
     createdAt         → created_at
   ───────────────────────────────────────────────────────────────────────── */

import type {
  ApprovalRecord,
  ApprovalStatus,
  Receipt,
  ReceiptKind,
  RoutineId,
  RoutineSpec,
  RunContext,
  RunMode,
  RunStatus,
  TasteEvent,
} from "../types";

export interface RoutineStateRecord {
  accountId: string;
  routineId: RoutineId;
  enabled: boolean;
  version: number;
  draftSpec: RoutineSpec | null;
  liveSpec: RoutineSpec | null;
  updatedAt: string;
}

/** Everything needed to resume a paused run without re-reading anything. */
export interface RunSnapshot {
  spec: RoutineSpec;
  ctx: RunContext;
  nextNodeIndex: number;
}

export interface RunRecord {
  id: string;
  accountId: string;
  routineId: RoutineId;
  version: number;
  mode: RunMode;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  summary?: string;
  approvalId?: string;
  dedupKey?: string;
  specHash?: string;
  snapshot?: RunSnapshot;
}

export interface ListRunsOptions {
  routineId?: RoutineId;
  mode?: RunMode;
  status?: RunStatus;
  version?: number;
  dedupKey?: string;
  /** ISO timestamp; only runs started at/after it. */
  since?: string;
  limit?: number;
}

export interface ListReceiptsOptions {
  runId?: string;
  kind?: ReceiptKind;
  since?: string;
  limit?: number;
}

export interface Store {
  // ----- routine_states -----
  getRoutineState(accountId: string, routineId: RoutineId): Promise<RoutineStateRecord | null>;
  putRoutineState(record: RoutineStateRecord): Promise<RoutineStateRecord>;

  // ----- routine_runs -----
  createRun(run: RunRecord): Promise<RunRecord>;
  getRun(runId: string): Promise<RunRecord | null>;
  updateRun(runId: string, patch: Partial<Omit<RunRecord, "id" | "accountId">>): Promise<RunRecord>;
  /** Newest first. */
  listRuns(accountId: string, opts?: ListRunsOptions): Promise<RunRecord[]>;

  // ----- approvals -----
  createApproval(approval: ApprovalRecord): Promise<ApprovalRecord>;
  getApproval(approvalId: string): Promise<ApprovalRecord | null>;
  updateApproval(
    approvalId: string,
    patch: Partial<Pick<ApprovalRecord, "status" | "decidedAt" | "decidedBy">>,
  ): Promise<ApprovalRecord>;
  listApprovals(accountId: string, status?: ApprovalStatus): Promise<ApprovalRecord[]>;

  // ----- receipts (append-only) -----
  appendReceipt(receipt: Receipt): Promise<Receipt>;
  /** Oldest first within a run; newest first across an account. */
  listReceipts(accountId: string, opts?: ListReceiptsOptions): Promise<Receipt[]>;
  /** Sum of mutation-receipt spend with since <= created_at <= until
      (inclusive both ends — a receipt stamped at exactly `now` counts). */
  sumSpend(accountId: string, since: string, until: string): Promise<number>;

  // ----- taste_events (append-only) -----
  appendTasteEvent(event: TasteEvent): Promise<TasteEvent>;
}
