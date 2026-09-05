import { requireOpsIdentity } from "@/lib/ops/session";
import { opsUuid, parseOpsRunWork } from "@/lib/ops/runWork";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
export async function GET(req: Request) {
  try {
    const identity = await requireOpsIdentity();
    if (identity instanceof Response) { identity.headers.set("cache-control", "private, no-store"); return identity; }
    const p = new URL(req.url).searchParams;
    const keys = ["accountId", "runId", "artifactAfter", "receiptAfter", "generation"];
    if ([...p.keys()].some(k => !keys.includes(k)) || keys.some(k => p.getAll(k).length > 1)) return json({ error: "Invalid run selection." }, 400);
    const account = opsUuid.safeParse(p.get("accountId")), run = opsUuid.safeParse(p.get("runId"));
    const artifact = opsUuid.nullable().safeParse(p.get("artifactAfter")), receipt = opsUuid.nullable().safeParse(p.get("receiptAfter"));
    const gen = p.get("generation");
    if (!account.success || !run.success || !artifact.success || !receipt.success
      || (gen !== null && (!/^\d+$/.test(gen) || !Number.isSafeInteger(Number(gen))))
      || ((artifact.data || receipt.data) && gen === null)) return json({ error: "Invalid run selection." }, 400);
    const generation = gen === null ? undefined : Number(gen);
    const { data, error } = await identity.service.rpc("read_ops_run_work", { p_user_id: identity.userId,
      p_account_id: account.data, p_run_id: run.data, p_artifact_after: artifact.data,
      p_receipt_after: receipt.data, p_generation: generation ?? null });
    if (error?.code === "42501") return json({ error: "Separate operator work-read access is required for this account." }, 403);
    if (error?.code === "22023") return json({ error: "Run context or page changed. Refresh from the first page." }, 409);
    if (error) return json({ error: "Couldn't read the saved work." }, 503);
    if (data === null) return json({ error: "Run not found in this account's current context." }, 404);
    const result = parseOpsRunWork(data, account.data, run.data, generation);
    if (!result) return json({ error: "Couldn't verify the saved work." }, 503);
    return json(result);
  } catch { return json({ error: "Saved work is temporarily unavailable." }, 503); }
}
