import { requireAccountOwnerSession } from "@/lib/db/session";
import { captureArtifactContext } from "@/lib/artifacts/context";
import { keyringFromEnv } from "@/lib/connectors/crypto";
import { slackTokenResolver } from "@/lib/channels/secrets";
import { stageSlackRoute } from "@/lib/channels/slackRoutes";
import { confirmStagedRoute, readSlackRouteSetup, slackRouteStageRequest } from "@/lib/channels/slackRouteSetupClient";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
const failure = () => json({ error: "Slack setup not confirmed. Refresh to read what is saved before changing it again." }, 503);
async function handle(req: Request, save: boolean) {
  try {
    const session = await requireAccountOwnerSession();
    if (session instanceof Response) {
      session.headers.set("cache-control", "private, no-store"); return session.status === 200 ? failure() : session;
    }
    if (new URL(req.url).search) return json({ error: "Unexpected setup parameters." }, 400);
    const origin = req.headers.get("origin");
    if ((origin && origin !== new URL(req.url).origin) || req.headers.get("sec-fetch-site") === "cross-site")
      return json({ error: "Same-origin setup required." }, 403);
    const context = await captureArtifactContext(session.service, session.accountId, req);
    if (context instanceof Response) { context.headers.set("cache-control", "private, no-store"); return context; }
    const actor = req.headers.get("x-unc-actor-id");
    if ((save || actor !== null) && actor !== session.userId) return json({ error: "Account owner changed. Refresh." }, 409);
    const ctx = { ...context, actorId: session.userId };
    if (save) {
      if (req.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return json({ error: "JSON setup required." }, 415);
      const body = await req.text();
      if (body.length > 2048) return json({ error: "Setup request too large." }, 413);
      const parsed = slackRouteStageRequest.safeParse(JSON.parse(body));
      if (!parsed.success) return json({ error: "Choose an existing Slack identity and a valid channel ID." }, 400);
      await stageSlackRoute({ db: session.service, fetch, tokenFor: slackTokenResolver(session.service, keyringFromEnv()), now: () => new Date() }, { ...parsed.data, ...ctx });
      const result = await session.service.rpc("slack_route_owner_view", { input: ctx });
      if (result.error) return failure();
      const view = readSlackRouteSetup(result.data, ctx);
      confirmStagedRoute(view, parsed.data);
      return json(view);
    }
    const result = await session.service.rpc("slack_route_owner_view", { input: ctx });
    if (result.error) return json({ error: "Slack setup unavailable or account changed. Refresh." }, result.error.code === "42501" ? 403 : result.error.code === "PT409" ? 409 : 503);
    return json(readSlackRouteSetup(result.data, ctx));
  } catch (err) {
    if (err instanceof SyntaxError) return json({ error: "Invalid setup JSON." }, 400);
    if (err instanceof Error && err.message === "Slack connection needs channel metadata read access; reconnect with channels:read/groups:read")
      return json({ code: "slack_metadata_scope_required", error: "Slack channel metadata scope required." }, 409);
    return failure();
  }
}
export const GET = (req: Request) => handle(req, false);
export const POST = (req: Request) => handle(req, true);
