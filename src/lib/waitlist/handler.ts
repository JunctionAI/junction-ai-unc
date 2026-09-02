/* The waitlist request handler, with its dependencies injected so the route is one line and
   the tests drive it with fakes. Contract (src/app/api/waitlist/route.ts):

     POST { email, source? }
       400 { ok:false, error:"invalid_email" }   the only visitor-facing failure
       429 { ok:false, error:"rate_limited" }    >10 requests / minute from one IP
       200 { ok:true }                            always otherwise — even if every sink but the
                                                  file failed; the visitor did nothing wrong */

import { normalizeCountryHeader, normalizeEmail, normalizeSource, RateLimiter, recordWaitlist, type WaitlistSinks } from "./store";

export interface WaitlistDeps {
  sinks: WaitlistSinks;
  limiter: RateLimiter;
  now?: () => Date;
  log?: (msg: string) => void;
}

/** First hop of x-forwarded-for (Vercel sets it), else x-real-ip, else "unknown". */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0].trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function handleWaitlist(request: Request, deps: WaitlistDeps): Promise<Response> {
  const now = deps.now ? deps.now() : new Date();
  if (!deps.limiter.hit(clientIp(request), now.getTime())) return json({ ok: false, error: "rate_limited" }, 429);

  let body: { email?: unknown; source?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const email = normalizeEmail(body?.email);
  if (!email) return json({ ok: false, error: "invalid_email" }, 400);

  const result = await recordWaitlist(
    {
      email,
      country: normalizeCountryHeader(request.headers.get("x-vercel-ip-country")),
      source: normalizeSource(body?.source) ?? "landing",
      referrer: request.headers.get("referer")?.slice(0, 512) || null,
      createdAt: now.toISOString(),
    },
    deps.sinks,
    deps.log,
  );
  if (!result.stored) (deps.log ?? console.error)("[waitlist] every sink failed — signup not recorded");
  return json({ ok: true });
}
