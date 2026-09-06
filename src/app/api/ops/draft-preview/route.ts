import { requireOpsIdentity } from "@/lib/ops/session";
import { executeOpsDraftPreview, OpsDraftPreviewError, opsDraftPreviewBody } from "@/lib/ops/draftPreview";
import { getStore } from "@/lib/runtime/store";
import { defaultAccountsSource } from "@/worker/wiring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

export async function POST(req: Request) {
  try {
    const identity = await requireOpsIdentity();
    if (identity instanceof Response) { identity.headers.set("cache-control", "private, no-store"); return identity; }
    if (new URL(req.url).search) return json({ error: "Unexpected preview parameters." }, 400);
    const origin = req.headers.get("origin");
    if ((origin && origin !== new URL(req.url).origin) || req.headers.get("sec-fetch-site") === "cross-site")
      return json({ error: "Same-origin preview required." }, 403);
    if (req.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
      return json({ error: "JSON preview required." }, 415);
    const raw = await req.text();
    if (raw.length > 16_000) return json({ error: "Preview request is too large." }, 413);
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return json({ error: "Invalid JSON." }, 400); }
    const parsed = opsDraftPreviewBody.safeParse(value);
    if (!parsed.success) return json({ error: "Invalid preview request." }, 400);
    const result = await executeOpsDraftPreview(identity.service, identity.userId, parsed.data,
      { db: identity.service, store: getStore(), accounts: defaultAccountsSource() });
    return json(result, result.status === "running" ? 202 : 200);
  } catch (error) {
    return json({ error: error instanceof OpsDraftPreviewError ? error.message : "Draft preview failed closed. Inspect the original request before retrying." },
      error instanceof OpsDraftPreviewError ? error.status : 503);
  }
}
