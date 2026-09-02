/* System receipts — receipt rows that no routine run produced (a compliance webhook, a
   disconnect). Same table, same "every action leaves a receipt" rule; run_id stays null.
   Written with the service-role client (receipts are append-only for every client role). */

import { unwrap, type DbClient } from "./types";

export interface SystemReceiptInput {
  accountId: string;
  kind: "notification";
  platform?: string | null;
  description: string;
  /** What happened — ids and counts only, never credentials or personal data. */
  payload?: Record<string, unknown>;
  now: string;
}

export async function insertSystemReceipt(db: DbClient, r: SystemReceiptInput): Promise<string> {
  const row = await unwrap<{ id: string }>(
    "receipts.insert",
    db
      .from("receipts")
      .insert({ account_id: r.accountId, run_id: null, approval_id: null, kind: r.kind, platform: r.platform ?? null, description: r.description, payload: r.payload ?? {}, created_at: r.now })
      .select("id")
      .single(),
  );
  return row.id;
}
