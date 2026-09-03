/* A tiny fetch-compatible transport for the n8n webhook boundary.

   The URL keeps the registered hostname, but the socket connects to the exact public address
   that urlSecurity already approved. That closes the DNS validation/use gap while retaining the
   original Host header and (for HTTPS) SNI/certificate hostname. Node's request APIs do not
   follow redirects; the bridge still rejects every 3xx response explicitly. */

import { request as httpRequest, type IncomingMessage, type RequestOptions as HttpRequestOptions } from "node:http";
import { request as httpsRequest, type RequestOptions as HttpsRequestOptions } from "node:https";
import { pinnedNodeRequestOptions } from "../../lib/http/pinnedRequest";
export { pinnedNodeRequestOptions, type PinnedNodeRequestOptions } from "../../lib/http/pinnedRequest";
import type { PinnedWebhookAddress } from "../../lib/n8n/urlSecurity";

export interface WebhookResponse {
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
}

export const MAX_N8N_RESPONSE_BYTES = 1_048_576;

/** Fetch-compatible test seam; the third argument exposes the address the real transport pins. */
export type WebhookFetch = (
  input: string | URL | Request,
  init: RequestInit,
  pin: PinnedWebhookAddress | null,
) => Promise<WebhookResponse>;

export function collectWebhookResponse(res: IncomingMessage, resolve: (value: WebhookResponse) => void, reject: (reason?: unknown) => void): void {
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  let settled = false;
  const fail = (reason: unknown) => {
    if (settled) return;
    settled = true;
    reject(reason);
  };
  const declaredBytes = Number(res.headers["content-length"]);
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_N8N_RESPONSE_BYTES) {
    fail(new Error(`n8n webhook response exceeded ${MAX_N8N_RESPONSE_BYTES} bytes`));
    res.destroy();
    return;
  }
  res.on("data", (chunk: Buffer | string) => {
    if (settled) return;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += bytes.length;
    if (receivedBytes > MAX_N8N_RESPONSE_BYTES) {
      fail(new Error(`n8n webhook response exceeded ${MAX_N8N_RESPONSE_BYTES} bytes`));
      res.destroy();
      return;
    }
    chunks.push(bytes);
  });
  res.once("error", fail);
  res.once("end", () => {
    if (settled) return;
    const status = res.statusCode;
    if (status === undefined) {
      fail(new Error("n8n webhook response had no status"));
      return;
    }
    settled = true;
    const bytes = Buffer.concat(chunks);
    resolve({
      status,
      ok: status >= 200 && status < 300,
      json: async () => JSON.parse(bytes.toString("utf8")) as unknown,
    });
  });
}

/** Production transport. A null pin is possible only for explicitly allowed test/dev targets. */
export const pinnedWebhookFetch: WebhookFetch = async (input, init, pin) => {
  if (!pin) return fetch(input, init);
  const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
  const options = pinnedNodeRequestOptions(url, pin, init);
  const body = init.body;
  if (body !== undefined && body !== null && typeof body !== "string" && !Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
    throw new TypeError("unsupported n8n webhook body");
  }
  return new Promise<WebhookResponse>((resolve, reject) => {
    const onResponse = (res: IncomingMessage) => collectWebhookResponse(res, resolve, reject);
    const req = options.protocol === "https:"
      ? httpsRequest(options as HttpsRequestOptions, onResponse)
      : httpRequest(options as HttpRequestOptions, onResponse);
    req.once("error", reject);
    req.end(body ?? undefined);
  });
};
