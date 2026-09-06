import { requireOpsIdentity } from "@/lib/ops/session";
import { readSourceBindings, sourceBindingWriteSchema, writeSourceBinding } from "@/lib/ops/sourceBindings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function identity() {
  const result = await requireOpsIdentity();
  if (result instanceof Response) result.headers.set("cache-control", "private, no-store");
  return result;
}

export async function GET(req: Request) {
  try {
    const operator = await identity(); if (operator instanceof Response) return operator;
    const params = new URL(req.url).searchParams, accountId = params.get("accountId");
    if ([...params.keys()].some(key => key !== "accountId") || params.getAll("accountId").length !== 1 || !accountId || !uuid.test(accountId))
      return json({ error: "Exact client selection required." }, 400);
    const result = await readSourceBindings(operator.service, operator.userId, accountId.toLowerCase());
    if (result.error?.code === "42501") return json({ error: "Operator read access is required for this client." }, 403);
    if (result.error || !result.data) return json({ error: "Client source bindings could not be verified." }, 503);
    return json({ accountId: accountId.toLowerCase(), bindings: result.data });
  } catch { return json({ error: "Client source bindings are temporarily unavailable." }, 503); }
}

export async function POST(req: Request) {
  try {
    const operator = await identity(); if (operator instanceof Response) return operator;
    if (new URL(req.url).search) return json({ error: "Unexpected source parameters." }, 400);
    const origin = req.headers.get("origin");
    if ((origin && origin !== new URL(req.url).origin) || req.headers.get("sec-fetch-site") === "cross-site")
      return json({ error: "Same-origin setup required." }, 403);
    if (req.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return json({ error: "JSON setup required." }, 415);
    const raw = await req.text(); if (raw.length > 4096) return json({ error: "Source binding request too large." }, 413);
    const parsed = sourceBindingWriteSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return json({ error: "Valid client source identity and evidence are required." }, 400);
    const result = await writeSourceBinding(operator.service, operator.userId, parsed.data);
    if (result.error?.code === "42501") return json({ error: "Source-binding authority is required for this client." }, 403);
    if (result.error?.code === "PT409" || result.error?.code === "40001" || result.error?.code === "23505")
      return json({ error: "Client or source identity changed. Refresh before trying again." }, 409);
    if (result.error || !result.data) return json({ error: "Source binding was not confirmed." }, 503);
    return json({ binding: result.data });
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: "Invalid source binding JSON." }, 400);
    return json({ error: "Source binding was not confirmed." }, 503);
  }
}
