/* The waitlist request handler, with its dependencies injected so the route is one line and
   the tests drive it with fakes. Contract (src/app/api/waitlist/route.ts):

     POST { email, source? }
       400 { ok:false, error:"invalid_email" }
       429 { ok:false, error:"rate_limited" }    >10 requests / minute from one IP
       503 { ok:false, error:"storage_unavailable" } no confirmed durable record
       200 { ok:true }                            confirmed database record only */

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

/** Keep page attribution without query tokens, fragments or URL credentials. */
export function safeReferrer(raw: string | null): string | null {
  try {
    const url = new URL(raw ?? "");
    return ["https:", "http:"].includes(url.protocol) ? `${url.origin}${url.pathname}`.slice(0, 512) : null;
  } catch { return null; }
}

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
      referrer: safeReferrer(request.headers.get("referer")),
      createdAt: now.toISOString(),
    },
    // A notification or an ephemeral serverless file is not a durable signup.
    { db: deps.sinks.db, email: null, file: null },
    deps.log,
  );
  if (result.stored !== "db") {
    (deps.log ?? console.error)("[waitlist] database did not confirm signup");
    return json({ ok: false, error: "storage_unavailable" }, 503);
  }
  return json({ ok: true });
}
