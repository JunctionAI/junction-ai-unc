/* POST /api/waitlist — join the waitlist from the landing page. Contract + logic live in
   src/lib/waitlist/handler.ts (rate limit, validation, the db → Resend → file cascade). */

import { handleWaitlist } from "@/lib/waitlist/handler";
import { defaultSinks } from "@/lib/waitlist/sinks";
import { RateLimiter } from "@/lib/waitlist/store";

export const runtime = "nodejs";

/** 10 / minute / IP, per server instance. */
const limiter = new RateLimiter(10, 60_000);

export async function POST(request: Request) {
  return handleWaitlist(request, { sinks: defaultSinks(), limiter });
}
