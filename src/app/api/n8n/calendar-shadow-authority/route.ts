import { withErrorCapture } from "@/lib/observability/errors";
import { proxyDeps } from "@/lib/n8n/routeDeps";
import { calendarShadowAuthority } from "@/lib/n8n/shadowAuthority";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlePOST = withErrorCapture("api/n8n/calendar-shadow-authority", (req: Request) =>
  calendarShadowAuthority(proxyDeps(), req, process.env.N8N_CALENDAR_SHADOW_RECEIVER_URL));

export async function POST(req: Request) {
  const response = await handlePOST(req);
  response.headers.set("cache-control", "no-store");
  response.headers.set("vary", "Authorization");
  return response;
}

export async function GET() {
  return Response.json({ ok: false, error: "Calendar authority requires POST" }, {
    status: 405, headers: { allow: "POST", "cache-control": "no-store", vary: "Authorization" },
  });
}
