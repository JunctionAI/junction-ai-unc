import "jsr:@supabase/functions-js/edge-runtime.d.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const MAX_BODY = 2048;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_KINDS = new Set(["public.client_accounts", "junction.client_orgs"]);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

async function sameSecret(supplied: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(supplied)), crypto.subtle.digest("SHA-256", enc.encode(expected))]);
  const aa = new Uint8Array(a), bb = new Uint8Array(b);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") return json({ error: "POST required." }, 405);
    if (req.headers.get("origin") || req.headers.get("sec-fetch-site")) return json({ error: "Server-to-server access only." }, 403);
    if (req.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return json({ error: "JSON required." }, 415);
    const expected = Deno.env.get("MISSION_CONTROL_SOURCE_TOKEN") ?? "";
    const auth = req.headers.get("authorization") ?? "";
    const supplied = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!expected || !supplied || !(await sameSecret(supplied, expected))) return json({ error: "Unauthorized." }, 401);
    const length = Number(req.headers.get("content-length") ?? 0);
    if (!Number.isFinite(length) || length < 0 || length > MAX_BODY) return json({ error: "Request too large." }, 413);
    const raw = await req.text();
    if (raw.length > MAX_BODY) return json({ error: "Request too large." }, 413);
    const body = JSON.parse(raw) as Record<string, unknown>;
    const keys = Object.keys(body).sort();
    if (keys.join(",") !== "accountId,limit,sourceKey,sourceKind,sourceProject" ||
      typeof body.accountId !== "string" || !UUID.test(body.accountId) ||
      body.sourceProject !== "ebcatvidixdjjwmmades" || typeof body.sourceKind !== "string" || !SOURCE_KINDS.has(body.sourceKind) ||
      typeof body.sourceKey !== "string" || !body.sourceKey || body.sourceKey.length > 200 || /\s/.test(body.sourceKey) ||
      !Number.isSafeInteger(body.limit) || Number(body.limit) < 1 || Number(body.limit) > 500)
      return json({ error: "Invalid source request." }, 400);

    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Record<string, string>;
    const apiKey = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const base = Deno.env.get("SUPABASE_URL") ?? "";
    if (!apiKey || !base) return json({ error: "Source database unavailable." }, 503);
    const response = await fetch(`${base}/rest/v1/rpc/read_unc_source_email_campaigns`, {
      method: "POST",
      headers: { apikey: apiKey, "content-type": "application/json" },
      body: JSON.stringify({ p_account_id: body.accountId, p_source_project: body.sourceProject,
        p_source_kind: body.sourceKind, p_source_key: body.sourceKey, p_limit: body.limit }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return json({ error: response.status === 403 ? "Source read not granted." : "Source read failed." }, response.status === 403 ? 403 : 503);
    const data = await response.json() as Record<string, unknown>;
    return json({ ...data, bridgeFetchedAt: new Date().toISOString(), bridgeDeploymentId: Deno.env.get("DENO_DEPLOYMENT_ID") ?? null });
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: "Invalid JSON." }, 400);
    return json({ error: "Source read failed." }, 503);
  }
});
