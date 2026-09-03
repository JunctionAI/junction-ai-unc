/* Durable (and in-memory) idempotency ledgers for ActionExecutor.

   claim() inserts status='started' BEFORE the platform is called. A unique-key clash
   is a duplicate — fail closed, do not send. complete() writes ok|failed after the
   reply. MemoryIdempotencyLedger is the same contract without a database (tests, demo). */

import { unwrap, type DbClient } from "../../lib/db/types";

export type LedgerClaim = "claimed" | "duplicate";

export interface LedgerComplete {
  ok: boolean;
  externalId?: string;
  error?: string;
}

export interface LedgerClaimMeta {
  accountId: string;
  runId: string;
  actionId: string;
}

export interface IdempotencyLedger {
  claim(key: string, meta: LedgerClaimMeta): Promise<LedgerClaim>;
  complete(key: string, result: LedgerComplete): Promise<void>;
  /** True when a row already exists (claimed, ok, or failed). */
  seen(key: string): Promise<boolean>;
}

export class MemoryIdempotencyLedger implements IdempotencyLedger {
  readonly entries = new Map<string, { ok: boolean; externalId?: string; error?: string; status: "started" | "ok" | "failed" }>();

  async claim(key: string, _meta: LedgerClaimMeta): Promise<LedgerClaim> {
    if (this.entries.has(key)) return "duplicate";
    this.entries.set(key, { ok: false, status: "started" });
    return "claimed";
  }

  async complete(key: string, result: LedgerComplete): Promise<void> {
    this.entries.set(key, { ok: result.ok, externalId: result.externalId, error: result.error, status: result.ok ? "ok" : "failed" });
  }

  async seen(key: string): Promise<boolean> {
    return this.entries.has(key);
  }

  /** Tests: same as complete. Kept so older call sites stay valid. */
  async record(key: string, result: { ok: boolean; externalId?: string }): Promise<void> {
    await this.complete(key, result);
  }
}

const UNIQUE_VIOLATION = "23505";

export class DbIdempotencyLedger implements IdempotencyLedger {
  constructor(private readonly db: DbClient) {}

  async claim(key: string, meta: LedgerClaimMeta): Promise<LedgerClaim> {
    const { error } = await this.db.from("action_ledger").insert({
      key,
      account_id: meta.accountId,
      run_id: meta.runId,
      action_id: meta.actionId,
      status: "started",
    });
    if (!error) return "claimed";
    if (error.code === UNIQUE_VIOLATION) return "duplicate";
    throw new Error(`action_ledger.claim: ${error.message}${error.code ? ` (${error.code})` : ""}`);
  }

  async complete(key: string, result: LedgerComplete): Promise<void> {
    await unwrap(
      "action_ledger.complete",
      this.db
        .from("action_ledger")
        .update({
          status: result.ok ? "ok" : "failed",
          external_id: result.externalId ?? null,
          error: result.error ? result.error.slice(0, 500) : null,
          finished_at: new Date().toISOString(),
        })
        .eq("key", key),
    );
  }

  async seen(key: string): Promise<boolean> {
    const row = await unwrap<{ key: string } | null>("action_ledger.seen", this.db.from("action_ledger").select("key").eq("key", key).maybeSingle());
    return !!row;
  }
}
