import { requireAccountOwnerSession } from "@/lib/db/session";
import { captureArtifactContext } from "@/lib/artifacts/context";
import { calendarPreferencesSave, readCalendarPreferences } from "@/lib/n8n/calendarPreferencesClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
const failure = () => json({ error: "Couldn’t confirm calendar settings. Refresh to check what is saved before changing them again." }, 503);
async function handle(req: Request, save: boolean) {
  try {
    const session = await requireAccountOwnerSession(req);
    if (session instanceof Response) {
      session.headers.set("cache-control", "private, no-store"); return session.status === 200 ? failure() : session;
    }
    const context = await captureArtifactContext(session.service, session.accountId, req);
    if (context instanceof Response) { context.headers.set("cache-control", "private, no-store"); return context; }
    if (req.headers.get("x-unc-actor-id") !== session.userId) return json({ error: "Account owner changed. Refresh." }, 409);
    if (new URL(req.url).search) return json({ error: "Unexpected calendar settings parameters." }, 400);
    const parsed = save ? calendarPreferencesSave.safeParse(await req.json().catch(() => null)) : null;
    if (parsed && !parsed.success) return json({ error: "Choose a valid timezone and refresh the saved settings." }, 400);
    const ctx = { ...context, actorId: session.userId };
    const result = await session.service.rpc("calendar_customer_preferences", { input: {
      ...ctx, operation: save ? "save" : "read", ...(parsed?.success ? parsed.data : {}),
    } });
    if (result.error) return json({ error: "Calendar settings changed, are bound to a reviewed workflow, or have outstanding work. Refresh; contact Junction if a bound timezone needs changing." },
      result.error.code === "42501" ? 403 : result.error.code === "PT409" ? 409 : ["22023", "22007", "22008"].includes(result.error.code ?? "") ? 400 : 503);
    const view = readCalendarPreferences(result.data, ctx);
    if (parsed?.success && (view.timezone !== parsed.data.timezone || !view.updatedAt || view.updatedAt === parsed.data.expectedUpdatedAt)) return failure();
    return json(view);
  } catch { return failure(); }
}
export const GET = (req: Request) => handle(req, false);
export const POST = (req: Request) => handle(req, true);
