/* POST /api/unc/scan — the onboarding business-profile scan.

   Body: { website: string, socials: string }
   →     { profile: BusinessProfile }   (see src/lib/unc/scan.ts)
   or    { fallback: true }             (no ANTHROPIC_API_KEY, or an internal failure)
   or    400 { error }                  (bad body, or the SSRF guard rejected the URL)

   SSRF guard: http(s) only; localhost / IP literals / private + link-local ranges
   (incl. DNS that resolves to them) are rejected here and again on every redirect hop
   inside scanBusiness (≤ 3 redirects). The key never reaches the client and is never
   logged. */

import { isSafeUrl, scanBusiness } from "@/lib/unc/scan";

export const runtime = "nodejs";

const MAX_WEBSITE_CHARS = 2048;
const MAX_SOCIALS_CHARS = 1000;

const fallback = () => Response.json({ fallback: true });

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) return fallback();

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
    const profile = await scanBusiness({ website, socials });
    return Response.json({ profile });
  } catch {
    // scanBusiness never throws by contract; this is belt-and-braces.
    return fallback();
  }
}
