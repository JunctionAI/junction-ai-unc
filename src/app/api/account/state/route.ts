/* Atomic, session-bound account persistence. Provider/control tables are out of scope. */
import { requireAccountOwnerSession, requireAccountSession } from "@/lib/db/session";
import { rowsToState, type LoadedRows } from "@/lib/db/mapping";
import { accountInitialState } from "@/lib/platform/state";
import { STATE_SAVE_MAX_BYTES } from "@/lib/db/stateSave";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECTIONS = new Set(["account", "goals", "resourceProfile", "teamMembers", "plan", "businessProfile", "chatMessages", "stateMeta"]);

async function handleGET(req: Request) {
  const session = await requireAccountSession(req);
  if (session instanceof Response) return session;
  const { data, error } = await session.service.rpc("load_account_state_snapshot", { p_account_id: session.accountId });
  if (error) return json({ error: "Couldn't load the account. Please try again." }, 503);
  if (!object(data) || !object(data.account) || data.account.id !== session.accountId) return json({ error: "Account unavailable." }, 404);
  const rows = data as unknown as LoadedRows;
  const meta = data.stateMeta;
  const revision = object(meta) ? meta.revision : 0;
  if (!Number.isSafeInteger(revision) || (revision as number) < 0) return json({ error: "Account revision unavailable." }, 503);
  return json({ accountId: session.accountId, role: session.role, name: rows.account?.name ?? "", revision,
    state: rowsToState(rows, accountInitialState(rows.account?.currency ?? "USD")) });
}

async function handlePUT(req: Request) {
  const session = await requireAccountOwnerSession(req);
  if (session instanceof Response) return session;
  if (req.headers.get("x-unc-account-save") !== "1" || !req.headers.get("content-type")?.startsWith("application/json"))
    return json({ error: "JSON account save required." }, 415);
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return json({ error: "Cross-origin save denied." }, 403);
  let body: unknown;
  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > STATE_SAVE_MAX_BYTES) return json({ error: "Account draft too large." }, 413);
    body = JSON.parse(raw);
  } catch { return json({ error: "Invalid account draft." }, 400); }
  if (!object(body) || body.accountId !== session.accountId) return json({ error: "Account does not match the session." }, 403);
  const rows = body.rows;
  if (!Number.isSafeInteger(body.revision) || (body.revision as number) < 0 || typeof body.saveId !== "string" || !UUID.test(body.saveId)
    || !object(rows) || Object.keys(rows).some(key => !SECTIONS.has(key))
    || !["account", "resourceProfile", "plan", "businessProfile", "stateMeta"].every(key => object(rows[key]))
    || !["goals", "teamMembers", "chatMessages"].every(key => Array.isArray(rows[key]))
    || (rows.account as Record<string, unknown>).id !== session.accountId)
    return json({ error: "Invalid account draft." }, 400);
  const resource = rows.resourceProfile as Record<string, unknown>;
  const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
  if ((resource.budget_monthly !== null && !finite(resource.budget_monthly)) || (resource.hours_weekly !== null && !finite(resource.hours_weekly))
    || (resource.gross_margin_pct !== null && !finite(resource.gross_margin_pct))
    || (rows.goals as unknown[]).some(goal => !object(goal) || (goal.baseline !== null && !finite(goal.baseline))))
    return json({ error: "Account numbers must be finite numbers or explicit unknowns." }, 400);
  const { data, error } = await session.service.rpc("save_account_state_atomic", {
    p_account_id: session.accountId, p_user_id: session.userId, p_expected_revision: body.revision, p_save_id: body.saveId, p_rows: rows,
  });
  if (error) return json({ error: "Couldn't save the account. No partial changes were saved." }, /^(22|23)/.test(error.code ?? "") ? 400 : 503);
  if (!object(data) || data.ok !== true) {
    const code = object(data) ? data.code : "save_unavailable";
    return json({ error: "Account save rejected.", code }, code === "state_conflict" || code === "save_id_conflict" ? 409 : code === "owner_only" ? 403 : code === "invalid_state" ? 400 : 503);
  }
  return json({ ok: true, accountId: session.accountId, revision: data.revision, replayed: data.replayed });
}

export const GET = withErrorCapture("api/account/state", handleGET);
export const PUT = withErrorCapture("api/account/state", handlePUT);
