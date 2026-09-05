/* GET /api/approvals — what needs the founder, and what Unc did lately.

   →  { approvals: ApprovalView[], receipts: ReceiptView[] (10 newest), drafts: DraftView[] }
   or { fallback: true }        demo mode (no database) — the UI keeps its demo cards
   or 401 { error } | 403 { error } | 503 { error }

   Session-bound (src/lib/db/session.ts): the listing is always the caller's own account.
   Store = src/lib/runtime/store getStore() (SupabaseStore with the service role). */

import { listApprovalsForAccount } from "@/lib/approvals/handlers";
import { requireAccountSession } from "@/lib/db/session";
import { getStore } from "@/lib/runtime/store";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: Request) {
  const session = await requireAccountSession(req);
  if (session instanceof Response) return session;
  try {
    const listing = await listApprovalsForAccount({ store: getStore() }, session.accountId);
    return Response.json(listing);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "listing failed" }, { status: 500 });
  }
}

export const GET = withErrorCapture("api/approvals", handleGET);
