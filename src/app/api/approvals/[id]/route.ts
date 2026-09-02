/* POST /api/approvals/<id> — Approve or Hold one pending approval.

   Body: { decision: "approved" | "held" }
   →     { approval: ApprovalView, run: { runId, status, summary, … }, receipts: ReceiptView[] }
   or    400 { error } | 401 | 403 | 404 (unknown, or not this account's) | 409 (already decided
         / run not resumable) | 503

   Same code path as the worker (src/worker/service.ts resumeApproval → engine resumeRun): the
   engine re-checks status + expiry, writes the taste_event, and continues or ends the run.
   With the shipped RefusingExecutor an approved mutating run ends failed-closed — the
   response says so honestly (run.status / run.error) and nothing is changed.

   DB configured → session-bound (the approval must belong to the caller's account; decided_by
   = the caller). Demo mode → MemoryStore, unbound (nothing survives a restart). */

import { decideApproval, DecideError, decideErrorStatus } from "@/lib/approvals/handlers";
import { isDbConfigured } from "@/lib/db/client";
import { requireAccountSession } from "@/lib/db/session";
import { getStore } from "@/lib/runtime/store";
import { defaultAccountsSource } from "@/worker/wiring";
import { summariseRun } from "../../routines/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const approvalId = (id || "").trim().slice(0, 128);
  if (!approvalId) return Response.json({ error: "approval id is required" }, { status: 400 });

  let body: { decision?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (body.decision !== "approved" && body.decision !== "held") return Response.json({ error: 'decision must be "approved" or "held"' }, { status: 400 });

  let accountId: string | null = null;
  let decidedBy: string | undefined;
  if (isDbConfigured()) {
    const session = await requireAccountSession();
    if (session instanceof Response) return session;
    accountId = session.accountId;
    decidedBy = session.userId;
  }

  try {
    const out = await decideApproval({ store: getStore(), accounts: defaultAccountsSource() }, { accountId, approvalId, decision: body.decision, decidedBy });
    return Response.json({ approval: out.approval, run: summariseRun(out.run), receipts: out.receipts });
  } catch (err) {
    if (err instanceof DecideError) return Response.json({ error: err.message, code: err.code }, { status: decideErrorStatus(err) });
    return Response.json({ error: err instanceof Error ? err.message : "decision failed" }, { status: 500 });
  }
}
