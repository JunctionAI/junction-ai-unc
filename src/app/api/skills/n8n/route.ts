/* /api/skills/n8n — the skills registry: which source serves each routine's produce step.

   GET                                    → { routines: SkillRow[], owner, admin, secretConfigured, dataBaseUrl,
                                              budget: { spentUsd, capUsd, ok }, accounts?: [{ accountId, name, spentUsd, capUsd, ok }] (admin) }
   POST  { routineId, webhookUrl, global? } → { workflow }        register / replace (owner; global = admin only)
   PATCH { id, active?, webhookUrl? }       → { workflow }        pause / resume / change the URL (owner; global rows = admin)
   or    { fallback: true } demo mode · 400 · 401 / 403 / 503 { error } (the requireAccountSession contract)

   n8n_workflows is service-role only (0013): reads and writes go through the store's service
   client; the session decides whose rows. Admin = UNC_ADMIN_EMAILS (comma list). */

import { requireAccountSession, type AccountSession } from "@/lib/db/session";
import { unwrap } from "@/lib/db/types";
import { checkBudget, spendByAccount, accountCap } from "@/lib/llm/budget";
import { dataBaseUrl } from "@/lib/n8n/dataToken";
import { isAccountOwner, isAdminEmail, listSkills, patchWorkflow, registerWorkflow, webhookUrlProblem } from "@/lib/n8n/registry";
import { withErrorCapture } from "@/lib/observability/errors";
import { getStore } from "@/lib/runtime/store";
import { ROUTINE_ID_RE } from "@/lib/runtime/validate";
import { N8N_SECRET_ENV } from "@/worker/providers/n8n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function who(session: AccountSession) {
  const [owner, admin] = [await isAccountOwner(session.db, session.accountId, session.userId), isAdminEmail(session.email)];
  return { owner, admin };
}

async function handleGET(req: Request) {
  const session = await requireAccountSession(req);
  if (session instanceof Response) return session;
  const { owner, admin } = await who(session);
  const store = getStore();
  const now = new Date();
  const routines = await listSkills(store, session.accountId);
  const budget = await checkBudget(session.service, session.accountId, { cached: false, now: () => now });
  const out: Record<string, unknown> = { routines, owner, admin, secretConfigured: !!(process.env[N8N_SECRET_ENV] ?? "").trim(), dataBaseUrl: dataBaseUrl(process.env), budget: { spentUsd: budget.spentUsd, capUsd: budget.capUsd, ok: budget.ok, capSource: budget.capSource } };
  if (admin) {
    const [spend, accounts] = await Promise.all([spendByAccount(session.service, now), unwrap<{ id: string; name: string }[]>("accounts.select", session.service.from("accounts").select("id, name"))]);
    out.accounts = await Promise.all(
      accounts.map(async (a) => {
        const cap = await accountCap(session.service, a.id);
        const spentUsd = Math.round((spend.get(a.id) ?? 0) * 1e4) / 1e4;
        return { accountId: a.id, name: a.name || a.id.slice(0, 8), spentUsd, capUsd: cap.cap, capSource: cap.source, ok: spentUsd < cap.cap };
      }),
    );
  }
  return json(out);
}

async function handlePOST(req: Request) {
  const session = await requireAccountSession(req);
  if (session instanceof Response) return session;
  const { owner, admin } = await who(session);
  if (!owner && !admin) return json({ error: "only the account owner can register a workflow", code: "owner_only" }, 403);
  let body: { routineId?: unknown; webhookUrl?: unknown; global?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const routineId = typeof body.routineId === "string" ? body.routineId.trim() : "";
  if (!ROUTINE_ID_RE.test(routineId)) return json({ error: "routineId must look like D0x-W0y" }, 400);
  const problem = webhookUrlProblem(body.webhookUrl);
  if (problem) return json({ error: problem }, 400);
  const global = body.global === true;
  if (global && !admin) return json({ error: "only an admin can register a workflow for every account", code: "admin_only" }, 403);
  try {
    const workflow = await registerWorkflow(getStore(), { accountId: session.accountId, routineId, webhookUrl: body.webhookUrl as string, global });
    return json({ workflow });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "register failed" }, 400);
  }
}

async function handlePATCH(req: Request) {
  const session = await requireAccountSession(req);
  if (session instanceof Response) return session;
  const { owner, admin } = await who(session);
  if (!owner && !admin) return json({ error: "only the account owner can change a workflow", code: "owner_only" }, 403);
  let body: { id?: unknown; active?: unknown; webhookUrl?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const id = typeof body.id === "string" ? body.id.trim().slice(0, 128) : "";
  if (!id) return json({ error: "id is required" }, 400);
  if (body.active !== undefined && typeof body.active !== "boolean") return json({ error: "active must be a boolean" }, 400);
  if (body.webhookUrl !== undefined) {
    const problem = webhookUrlProblem(body.webhookUrl);
    if (problem) return json({ error: problem }, 400);
  }
  const out = await patchWorkflow(getStore(), { id, active: body.active as boolean | undefined, webhookUrl: body.webhookUrl as string | undefined }, { accountId: session.accountId, admin });
  if (!out.ok) return json({ error: out.error }, out.status);
  return json({ workflow: out.workflow });
}

export const GET = withErrorCapture("api/skills/n8n", handleGET);
export const POST = withErrorCapture("api/skills/n8n", handlePOST);
export const PATCH = withErrorCapture("api/skills/n8n", handlePATCH);
