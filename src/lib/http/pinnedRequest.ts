/* Shared Node HTTP(S) socket descriptor for SSRF-safe outbound requests.

   Callers validate a hostname once, pass the exact approved address here, and keep the
   registered/original hostname in Host + TLS SNI. `hostname` is therefore always the socket
   destination; Node never performs a second DNS lookup for the request. Redirect policy and
   response bounds belong to the caller because webhook JSON and scanned HTML have different
   contracts. */

import { isIP } from "node:net";

export interface PinnedAddress {
  address: string;
  family: 4 | 6;
}

export interface PinnedNodeRequestOptions {
  protocol: "http:" | "https:";
  hostname: string;
  family: 4 | 6;
  port: string | undefined;
  path: string;
  method: string;
  headers: Record<string, string>;
  signal: AbortSignal | undefined;
  servername?: string;
  rejectUnauthorized?: true;
}

function originalHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "").split("%")[0];
}

/** Build request options that connect to `pin.address` without losing the original Host/SNI. */
export function pinnedNodeRequestOptions(url: URL, pin: PinnedAddress, init: RequestInit): PinnedNodeRequestOptions {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError("unsupported pinned-request protocol");
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, key) => {
    headers[key] = value;
  });
  headers.host = url.host;
  const hostname = originalHostname(url);
  return {
    protocol: url.protocol,
    hostname: pin.address,
    family: pin.family,
    port: url.port || undefined,
    path: `${url.pathname}${url.search}`,
    method: init.method ?? "GET",
    headers,
    signal: init.signal ?? undefined,
    ...(url.protocol === "https:" ? { rejectUnauthorized: true, ...(!isIP(hostname) ? { servername: hostname } : {}) } : {}),
  };
}
