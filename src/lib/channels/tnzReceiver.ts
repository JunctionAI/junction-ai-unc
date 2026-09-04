import { parseTnzInbound, tnzConfig, TNZ_MAX_BODY_BYTES, verifyTnzWebhook } from "./adapters/tnz";
import type { Env, InboundEvent } from "./types";

/** No body/token logging. Authenticate before reading; acknowledge only durable storage. */
export async function receiveTnz(req: Request, deps: { env: Env; now: Date; save: (events: InboundEvent[]) => Promise<void>; wake: () => void }): Promise<Response> {
  const config = tnzConfig(deps.env);
  if (!config) return new Response("SMS unavailable", { status: 503 });
  if (!verifyTnzWebhook(config, req.headers, deps.now)) return new Response("Unauthorized", { status: 401 });
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return new Response("JSON required", { status: 415 });
  const reader = req.body?.getReader();
  if (!reader) return new Response("Body required", { status: 400 });
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > TNZ_MAX_BODY_BYTES) { await reader.cancel(); return new Response("Body too large", { status: 413 }); }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const event = parseTnzInbound(body, config);
    if (!event) return new Response("Not an allowed pilot SMS", { status: 400 });
    try { await deps.save([event]); }
    catch { return new Response("Storage unavailable; retry this event", { status: 503 }); }
    // Worker provides recovery if the immediate wake cannot be scheduled.
    try { deps.wake(); } catch { /* already durably queued */ }
    return new Response("200 OK", { status: 200 });
  } catch { return new Response("Invalid body", { status: 400 }); }
  finally { reader.releaseLock(); }
}
