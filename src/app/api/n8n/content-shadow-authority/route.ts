import { withErrorCapture } from "@/lib/observability/errors";
import { proxyDeps } from "@/lib/n8n/routeDeps";
import { contentShadowAuthority } from "@/lib/n8n/shadowAuthority";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlePOST = withErrorCapture("api/n8n/content-shadow-authority", (req: Request) =>
  contentShadowAuthority(proxyDeps(), req, undefined));

export async function POST(req: Request) {
  const response = await handlePOST(req);
  response.headers.set("cache-control", "no-store");
  response.headers.set("vary", "Authorization");
  return response;
}

export async function GET() {
  return Response.json({ ok: false, error: "Content authority requires POST" }, {
    status: 405, headers: { allow: "POST", "cache-control": "no-store", vary: "Authorization" },
  });
}
