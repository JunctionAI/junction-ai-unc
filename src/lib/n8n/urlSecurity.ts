/* Webhook URL boundary for the n8n bridge.

   Registration performs a synchronous syntax/host check. Immediately before a request the
   bridge also resolves the hostname and rejects any private, loopback, link-local, metadata,
   multicast or reserved destination. The approved answer is carried into the transport as the
   socket address, so the connection cannot re-resolve the hostname. Redirects are handled by the
   bridge itself and are never followed. Local n8n is available only in tests, or in development
   when the explicit N8N_ALLOW_PRIVATE_DEV=1 switch is present; production ignores that switch. */

import { lookup as nodeLookup } from "node:dns/promises";
import { isIP } from "node:net";

export const N8N_ALLOW_PRIVATE_DEV_ENV = "N8N_ALLOW_PRIVATE_DEV";

export type HostLookup = (hostname: string, options: { all: true }) => Promise<{ address: string; family: number }[]>;

function runtimeMode(env: Record<string, string | undefined>): string {
  return (env.NODE_ENV ?? process.env.NODE_ENV ?? "production").trim().toLowerCase();
}

/** Tests are isolated by NODE_ENV. A developer must also opt in explicitly; production cannot. */
export function allowsPrivateWebhookTarget(env: Record<string, string | undefined>): boolean {
  const mode = runtimeMode(env);
  return mode === "test" || (mode === "development" && env[N8N_ALLOW_PRIVATE_DEV_ENV]?.trim() === "1");
}

function privateV4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function privateV6(address: string): boolean {
  const lower = address.toLowerCase().split("%")[0];
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(lower)) return true;
  const dottedMapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dottedMapped) return privateV4(dottedMapped[1]);
  const hexMapped = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const high = Number.parseInt(hexMapped[1], 16);
    const low = Number.parseInt(hexMapped[2], 16);
    return privateV4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return false;
}

/** Unknown/non-IP strings are unsafe at this post-DNS boundary. */
export function isPrivateWebhookAddress(address: string): boolean {
  const family = isIP(address.split("%")[0]);
  if (family === 4) return privateV4(address);
  if (family === 6) return privateV6(address);
  return true;
}

export function isLocalWebhookHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!host) return true;
  if (isIP(host)) return isPrivateWebhookAddress(host);
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa") ||
    host.endsWith(".lan") ||
    !host.includes(".")
  );
}

export type WebhookUrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

export interface PinnedWebhookAddress {
  address: string;
  family: 4 | 6;
}

/** A null pin exists only for the explicitly allowed test/private-development boundary. */
export type WebhookTargetCheck = { ok: true; url: URL; pin: PinnedWebhookAddress | null } | { ok: false; reason: string };

/** Registration-time check. DNS is deliberately deferred to the request-time guard. */
export function checkWebhookUrl(url: unknown, env: Record<string, string | undefined>, maxLength: number): WebhookUrlCheck {
  if (typeof url !== "string" || !url.trim()) return { ok: false, reason: "webhookUrl is required" };
  const raw = url.trim();
  if (raw.length > maxLength) return { ok: false, reason: `webhookUrl is too long (${maxLength} chars)` };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "webhookUrl must be an absolute URL" };
  }
  if (parsed.username || parsed.password) return { ok: false, reason: "webhookUrl must not carry credentials" };
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { ok: false, reason: "webhookUrl must be https" };
  const mode = runtimeMode(env);
  const localTarget = isLocalWebhookHost(parsed.hostname);
  if (parsed.protocol === "http:" && !((mode === "test" && localTarget) || (mode === "development" && env.N8N_ALLOW_HTTP?.trim() === "1"))) {
    return { ok: false, reason: "webhookUrl must be https" };
  }
  if (localTarget && !allowsPrivateWebhookTarget(env)) {
    return { ok: false, reason: "webhookUrl must resolve to a public host (localhost and private network targets are blocked)" };
  }
  return { ok: true, url: parsed };
}

/** Request-time SSRF check. Every resolved address must be public. */
export async function checkWebhookTarget(
  url: string,
  env: Record<string, string | undefined>,
  options: { maxLength: number; lookup?: HostLookup },
): Promise<WebhookTargetCheck> {
  const syntax = checkWebhookUrl(url, env, options.maxLength);
  if (!syntax.ok) return syntax;
  if (isLocalWebhookHost(syntax.url.hostname)) return { ...syntax, pin: null }; // allowed only by the explicit non-prod boundary above

  const literal = syntax.url.hostname.replace(/^\[|\]$/g, "").split("%")[0];
  const literalFamily = isIP(literal);
  if (literalFamily === 4 || literalFamily === 6) return { ...syntax, pin: { address: literal, family: literalFamily } };

  if (runtimeMode(env) === "test" && !options.lookup) return { ...syntax, pin: null }; // synthetic .test hosts never touch DNS
  try {
    const addresses = await (options.lookup ?? (nodeLookup as HostLookup))(syntax.url.hostname, { all: true });
    if (!addresses.length || addresses.some((entry) => isPrivateWebhookAddress(entry.address))) {
      return { ok: false, reason: "n8n webhook resolved to a private or non-routable address" };
    }
    const selected = addresses[0];
    const address = selected.address.split("%")[0];
    const family = isIP(address);
    if (family !== 4 && family !== 6) return { ok: false, reason: "n8n webhook resolved to a private or non-routable address" };
    return { ...syntax, pin: { address, family } };
  } catch {
    return { ok: false, reason: "n8n webhook hostname could not be resolved safely" };
  }
}
