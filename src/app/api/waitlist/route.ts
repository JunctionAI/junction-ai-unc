/* POST /api/waitlist — join the waitlist from the landing page. Contract + logic live in
   src/lib/waitlist/handler.ts (rate limit, validation, confirmed database storage). */

import { handleWaitlist } from "@/lib/waitlist/handler";
import { defaultSinks } from "@/lib/waitlist/sinks";
import { RateLimiter } from "@/lib/waitlist/store";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";

/** 10 / minute / IP, per server instance. */
const limiter = new RateLimiter(10, 60_000);

async function handlePOST(request: Request) {
  return handleWaitlist(request, { sinks: defaultSinks(), limiter });
}

export const POST = withErrorCapture("api/waitlist", handlePOST);
