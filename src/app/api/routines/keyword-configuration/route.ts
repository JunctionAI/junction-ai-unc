import { requireAccountOwnerSession } from "@/lib/db/session";
import { captureArtifactContext } from "@/lib/artifacts/context";
import { keywordConfigurationSave, readKeywordConfiguration } from "@/lib/n8n/keywordConfiguration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "private, no-store" } });
const failure = () => json({ error: "Couldn’t verify keyword settings. Refresh to check what is saved." }, 503);
const conflict = (code: string | undefined) => code === "PT409" || code === "40001";
const privateResponse = (r: Response) => { r.headers.set("cache-control", "private, no-store"); return r; };

async function handle(req: Request, save: boolean) {
  try {
    const session = await requireAccountOwnerSession(req);
    if (session instanceof Response) return session.status === 200 ? failure() : privateResponse(session);
    const ctx = await captureArtifactContext(session.service, session.accountId, req);
    if (ctx instanceof Response) return privateResponse(ctx);
    if (new URL(req.url).search) return json({ error: "Unexpected keyword settings parameters." }, 400);
    const input = { ...ctx, actorId: session.userId };
    const parsed = save ? keywordConfigurationSave.safeParse(await req.json().catch(() => null)) : null;
    if (parsed && !parsed.success) return json({ error: "Choose a market and refresh the saved settings." }, 400);
    const call = async (fields: Record<string, unknown>) => session.service.rpc("keyword_customer_configuration", { input: { ...input, ...fields } });
    const result = await call({ operation: "read" });
    if (result.error) return json({ error: "Keyword setup is unavailable for this account or its settings changed." }, result.error.code === "42501" ? 403 : conflict(result.error.code) ? 409 : 503);
    const current = readKeywordConfiguration(result.data, input);
    if (!save) return json(current.view);
    if (!parsed?.success) return failure();
    const candidate = current.candidates.find(c => c.market === parsed.data.market);
    if (!candidate) return json({ error: "This market does not have a verified setup yet." }, 409);
    const saved = await call({ operation: "save", market: parsed.data.market, spec: candidate.spec,
      expectedVersion: parsed.data.version, expectedUpdatedAt: parsed.data.stateUpdatedAt });
    if (saved.error) return json({ error: "Settings changed or work is outstanding. Turn the routine off, resolve any draft or pending request, then refresh." },
      saved.error.code === "42501" ? 403 : conflict(saved.error.code) ? 409 : 503);
    const confirmed = readKeywordConfiguration(saved.data, input).view;
    if (confirmed.market !== parsed.data.market || confirmed.enabled || confirmed.hasDraft || confirmed.version !== 2) return failure();
    return json(confirmed);
  } catch { return failure(); }
}
export const GET = (req: Request) => handle(req, false);
export const POST = (req: Request) => handle(req, true);
