/* POST /api/unc/niche-brief — owner-only "How I read your market": one model call after the scan.

   Body: { profile?: BusinessProfile }   the scan's profile (from the client's onboarding state);
                                         absent → business_profiles.profile for the account
   →     { brief, author: "model" | "deterministic", stored: { written, failed } | null }
   or    { fallback: true }              demo mode (no database)
   or    401 | 403 | 503 { error }

   GET  /api/unc/niche-brief             the stored brief, reassembled from the niche memories
   →     { brief: NicheBrief | null }

   The brief lands as memories (kind fact · source scan · tags ["niche", …]) and steers the industry
   presets (src/lib/runtime/presets). Never blocking: a model failure still stores the band. */

import { generateNicheBrief, readNicheBrief, type ProfileLike } from "@/lib/brain/nicheBrief";
import { requireAccountOwnerSession, requireAccountSession } from "@/lib/db/session";
import { captureMemoryContext, contextChangedResponse, contextStillCurrent } from "@/lib/db/contextGeneration";
import { unwrap } from "@/lib/db/types";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PROFILE_CHARS = 20_000;

function coerceProfile(raw: unknown): ProfileLike | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (JSON.stringify(raw).length > MAX_PROFILE_CHARS) return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max = 300) => (typeof v === "string" ? v.slice(0, max) : null);
  const list = (v: unknown, max = 20) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max).map((x) => x.slice(0, 200)) : []);
  const market = r.market && typeof r.market === "object" ? (r.market as Record<string, unknown>) : null;
  return {
    name: str(r.name),
    oneLiner: str(r.oneLiner, 400),
    category: str(r.category),
    products: list(r.products),
    audience: str(r.audience, 400),
    market: market ? { region: str(market.region), competitorsMentioned: list(market.competitorsMentioned, 10) } : null,
    signals: list(r.signals),
    businessType: str(r.businessType, 40),
    sells: str(r.sells, 40),
    storefront: str(r.storefront, 40),
  };
}

async function handleGET() {
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  const context = await captureMemoryContext(session.service, session.accountId);
  if (context instanceof Response) return context;
  try {
    const brief = await readNicheBrief(context.db, session.accountId);
    if (!await contextStillCurrent(session.service, session.accountId, context.generation)) return contextChangedResponse();
    return Response.json({ brief }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "couldn't read the brief" }, { status: 500 });
  }
}

async function handlePOST(req: Request) {
  const session = await requireAccountOwnerSession();
  if (session instanceof Response) return session;
  const context = await captureMemoryContext(session.service, session.accountId, req);
  if (context instanceof Response) return context;
  let body: { profile?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  let profile = coerceProfile(body.profile);
  if (!profile) {
    const row = await unwrap<{ profile: unknown } | null>("business_profiles.select", session.service.from("business_profiles").select("profile").eq("account_id", session.accountId).maybeSingle());
    profile = coerceProfile(row?.profile ?? null);
  }
  const [account, resources] = await Promise.all([
    unwrap<{ currency: string | null } | null>("accounts.select", session.service.from("accounts").select("currency").eq("id", session.accountId).maybeSingle()),
    unwrap<{ budget_monthly: number | string | null } | null>("resource_profiles.select", session.service.from("resource_profiles").select("budget_monthly").eq("account_id", session.accountId).maybeSingle()),
  ]);
  const budget = Number(resources?.budget_monthly ?? NaN);
  const r = await generateNicheBrief({ accountId: session.accountId, profile, db: context.db }, { extra: { currency: account?.currency ?? "NZD", budgetMonthly: Number.isFinite(budget) && budget > 0 ? budget : null } });
  if (!await contextStillCurrent(session.service, session.accountId, context.generation)) return contextChangedResponse();
  return Response.json(r);
}

export const GET = withErrorCapture("api/unc/niche-brief", handleGET);
export const POST = withErrorCapture("api/unc/niche-brief", handlePOST);
