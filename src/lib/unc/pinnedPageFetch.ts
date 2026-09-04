/* DNS-pinned page transport for the onboarding scanner.

   The scanner resolves and validates one hostname per redirect hop, then gives this transport
   the approved address. The socket connects to that address while Host and TLS SNI remain the
   original website hostname. Node's request APIs do not follow redirects. Only a bounded body
   from a successful HTML/text response is retained. */

import { request as httpRequest, type IncomingMessage, type RequestOptions as HttpRequestOptions } from "node:http";
import { request as httpsRequest, type RequestOptions as HttpsRequestOptions } from "node:https";
import { pinnedNodeRequestOptions, type PinnedAddress } from "../http/pinnedRequest";

export interface PinnedPageResponse {
  status: number;
  headers: Headers;
  body: string;
}

export interface PinnedPageRequestInit {
  signal?: AbortSignal;
  headers?: HeadersInit;
  maxBytes: number;
}

export type PinnedPageFetch = (url: URL, pin: PinnedAddress, init: PinnedPageRequestInit) => Promise<PinnedPageResponse>;

function responseHeaders(res: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, raw] of Object.entries(res.headers)) {
    if (Array.isArray(raw)) for (const value of raw) headers.append(name, value);
    else if (raw !== undefined) headers.set(name, String(raw));
  }
  return headers;
}

function readablePageType(headers: Headers): boolean {
  const type = (headers.get("content-type") ?? "").toLowerCase();
  return type.includes("text/html") || type.includes("xhtml") || type.includes("text/plain");
}

/** Collect one Node response without ever retaining more than `maxBytes`. */
export function collectPinnedPageResponse(
  res: IncomingMessage,
  maxBytes: number,
  resolve: (value: PinnedPageResponse) => void,
  reject: (reason?: unknown) => void,
): void {
  const status = res.statusCode;
  if (status === undefined) {
    reject(new Error("website response had no status"));
    res.destroy();
    return;
  }
  const headers = responseHeaders(res);
  const chunks: Buffer[] = [];
  let received = 0;
  let settled = false;
  const fail = (reason: unknown) => {
    if (settled) return;
    settled = true;
    reject(reason);
  };
  const finish = () => {
    if (settled) return;
    settled = true;
    resolve({ status, headers, body: Buffer.concat(chunks, received).toString("utf8") });
  };

  // Redirects and rejected responses need headers only; do not consume an attacker-sized body.
  if (status !== 200 || !readablePageType(headers)) {
    finish();
    res.destroy();
    return;
  }
  res.on("data", (chunk: Buffer | string) => {
    if (settled) return;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const take = Math.min(bytes.length, maxBytes - received);
    if (take > 0) {
      chunks.push(bytes.subarray(0, take));
      received += take;
    }
    if (received >= maxBytes) {
      finish();
      res.destroy();
    }
  });
  res.once("error", fail);
  res.once("aborted", () => fail(new Error("website response aborted")));
  res.once("end", finish);
}

/** GET a single already-validated hop. The returned body never exceeds `maxBytes`. */
export const requestPinnedPage: PinnedPageFetch = async (url, pin, init) => {
  if (!Number.isInteger(init.maxBytes) || init.maxBytes <= 0) throw new TypeError("maxBytes must be a positive integer");
  const options = pinnedNodeRequestOptions(url, pin, { method: "GET", headers: init.headers, signal: init.signal });
  return new Promise<PinnedPageResponse>((resolve, reject) => {
    let settled = false;
    const fail = (reason: unknown) => {
      if (settled) return;
      settled = true;
      reject(reason);
    };
    const onResponse = (res: IncomingMessage) => collectPinnedPageResponse(res, init.maxBytes, (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    }, fail);
    const req = options.protocol === "https:"
      ? httpsRequest(options as HttpsRequestOptions, onResponse)
      : httpRequest(options as HttpRequestOptions, onResponse);
    req.once("error", fail);
    req.end();
  });
};
