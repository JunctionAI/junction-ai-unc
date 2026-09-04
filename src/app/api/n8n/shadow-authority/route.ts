import { withErrorCapture } from "@/lib/observability/errors";
import { proxyDeps } from "@/lib/n8n/routeDeps";
import { shadowAuthority } from "@/lib/n8n/shadowAuthority";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handleGET = withErrorCapture("api/n8n/shadow-authority", (req: Request) =>
  shadowAuthority(proxyDeps(), req, process.env.N8N_SHADOW_RECEIVER_URL));

export async function GET(req: Request) {
  const response = await handleGET(req);
  response.headers.set("cache-control", "no-store");
  response.headers.set("vary", "Authorization");
  return response;
}
