import { requireOpsIdentity } from "@/lib/ops/session";
import type { OpsSnapshot } from "@/lib/ops/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function GET(req: Request) {
  try {
    const identity = await requireOpsIdentity();
    if (identity instanceof Response) { identity.headers.set("cache-control", "private, no-store"); return identity; }
    const params = new URL(req.url).searchParams;
    const accountId = params.get("accountId");
    if ([...params.keys()].some(k => k !== "accountId") || params.getAll("accountId").length > 1 || (accountId !== null && !uuid.test(accountId))) return json({ error: "Invalid client selection." }, 400);
    const { data, error } = await identity.service.rpc("read_ops_console", { p_user_id: identity.userId, p_account_id: accountId });
    if (error?.code === "42501") return json({ error: "Operator read access is required for this selection." }, 403);
    if (error) return json({ error: "Couldn't read operator records. No empty or healthy state is inferred." }, 503);
    const snapshot = data as OpsSnapshot | null;
    if (!snapshot || !Array.isArray(snapshot.clients) || !Array.isArray(snapshot.runs) || !snapshot.checkedAt || (accountId && snapshot.selected?.accountId !== accountId) || (!accountId && snapshot.selected)) return json({ error: "Couldn't verify operator records." }, 503);
    return json(snapshot);
  } catch { return json({ error: "Operator records are temporarily unavailable." }, 503); }
}
