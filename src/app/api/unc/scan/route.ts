/* POST /api/unc/scan — the onboarding business-profile scan.

   Body: { website: string, socials: string }
   →     { profile: BusinessProfile }   (see src/lib/unc/scan.ts)
   or    { fallback: true }             (no model provider configured, or an internal failure)
   or    400 { error }                  (bad body, or the SSRF guard rejected the URL)

   SSRF guard: http(s) only; localhost / IP literals / private + link-local ranges
   (incl. DNS that resolves to them) are rejected here and again on every redirect hop
   inside scanBusiness (≤ 3 redirects). Model: the "business_scan" task through
   src/lib/llm/router.ts (fast tier by default). Keys never reach the client. */

import { afterScan } from "@/lib/brain/hooks";
import { optionalAccountContext } from "@/lib/llm/accountContext";
import { resolveModel } from "@/lib/llm/router";
import { isSafeUrl, scanBusiness } from "@/lib/unc/scan";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";

const MAX_WEBSITE_CHARS = 2048;
const MAX_SOCIALS_CHARS = 1000;

const fallback = () => Response.json({ fallback: true });

async function handlePOST(req: Request) {
  if (!resolveModel("business_scan")) return fallback();

  let body: { website?: unknown; socials?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const website = typeof body.website === "string" ? body.website.trim().slice(0, MAX_WEBSITE_CHARS) : "";
  const socials = typeof body.socials === "string" ? body.socials.trim().slice(0, MAX_SOCIALS_CHARS) : "";
  if (!website && !socials) return Response.json({ error: "nothing to scan" }, { status: 400 });

  if (website) {
    const check = await isSafeUrl(website);
    if (!check.ok) return Response.json({ error: check.reason }, { status: 400 });
  }

  try {
    const account = await optionalAccountContext();
    const profile = await scanBusiness({ website, socials, accountId: account?.accountId ?? null });
    if (account?.db && profile.confidence !== "low") {
      // Client Brain: the profile's facts become memories (source "scan"); fire-and-forget, accounts mode only.
      void afterScan({ accountId: account.accountId, profile, sourceRef: website || null }, { db: account.db }).catch(() => {});
    }
    return Response.json({ profile });
  } catch {
    // scanBusiness never throws by contract; this is belt-and-braces.
    return fallback();
  }
}

export const POST = withErrorCapture("api/unc/scan", handlePOST);
