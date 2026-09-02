/* `--probe <platform>` — one certified read for one account, printed so the founder's first
   real connection can be checked in thirty seconds:

     node dist/worker/worker/main.js --probe shopify --account <uuid> [--resource orders] [--window 7d]

   Goes through the same credential provider + reader the routines use (real sealed token
   when the DB + CONNECTOR_SECRET_KEY are configured, fixture markers otherwise) and prints
   the shaped result: credential kind (never the value), metrics, the columns, two sample
   rows with emails / long strings / anything token-shaped redacted, provenance or the
   honest "couldn't ask" reason. Exit 0 on ok, 1 on failure. */

import type { Platform, ReadQuery } from "../lib/runtime/types";
import { describeCredential, type CredentialProvider } from "./credentials";
import { READERS } from "./providers/connectorReader";
import type { ReaderOptions, Row } from "./readers/types";

export const PROBE_DEFAULTS: Partial<Record<Platform, ReadQuery>> = {
  shopify: { resource: "orders", window: "7d" },
  klaviyo: { resource: "metrics", window: "28d", filter: { metric: "Placed Order", attributed: true } },
  meta_ads: { resource: "insights", window: "7d", fields: ["spend", "purchases", "purchase_value", "roas"] },
  ga4: { resource: "report", window: "7d", fields: ["sessions", "conversions"] },
  google_ads: { resource: "campaigns", window: "7d" },
  hubspot: { resource: "deals", window: "28d", limit: 50 },
};

export interface ProbeArgs {
  platform: string;
  accountId: string;
  resource?: string | null;
  window?: string | null;
}

export interface ProbeReport {
  platform: string;
  accountId: string;
  query: ReadQuery;
  credential: string;
  ok: boolean;
  count?: number;
  metrics?: Record<string, unknown>;
  columns?: string[];
  sample?: Row[];
  provenance?: Record<string, unknown>;
  reason?: string;
}

export interface ProbeDeps {
  credentials: CredentialProvider;
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

const TOKENISH = /^(shpat_|shpca_|pk_|pat-|EAA|ya29\.|1\/\/)/;

/** Row values safe to print: emails masked, long strings cut, token-shaped strings dropped. */
export function redactValue(v: unknown): unknown {
  if (typeof v === "string") {
    if (TOKENISH.test(v) || /^[A-Za-z0-9_-]{40,}$/.test(v)) return "[redacted]";
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return "[email]";
    return v.length > 80 ? `${v.slice(0, 77)}…` : v;
  }
  if (Array.isArray(v)) return `[${v.length} items]`;
  if (v && typeof v === "object") return "{…}";
  return v;
}

export function redactRow(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[k] = /email|phone|address|name$/i.test(k) && typeof v === "string" ? "[redacted]" : redactValue(v);
  return out;
}

export function probeQuery(platform: Platform, args: Pick<ProbeArgs, "resource" | "window">): ReadQuery {
  const base = PROBE_DEFAULTS[platform] ?? { resource: "report", window: "7d" };
  return { ...base, ...(args.resource ? { resource: args.resource } : {}), ...(args.window ? { window: args.window } : {}) };
}

export async function runProbe(deps: ProbeDeps, args: ProbeArgs): Promise<ProbeReport> {
  const platform = args.platform as Platform;
  const reader = READERS[platform];
  const query = probeQuery(platform, args);
  const base: ProbeReport = { platform, accountId: args.accountId, query, credential: "none", ok: false };
  if (!reader) return { ...base, reason: `no reader for platform "${args.platform}" (readers: ${Object.keys(READERS).join(", ")})` };
  const creds = await deps.credentials.get(args.accountId, platform);
  base.credential = describeCredential(creds);
  if (!creds) return { ...base, reason: "nothing connected for this account + platform (no connected row with a usable token / external ref)" };
  const opts: ReaderOptions = { fetch: deps.fetch, now: deps.now, timeoutMs: deps.timeoutMs };
  const res = await reader(query, creds, opts);
  if (!res.ok) return { ...base, reason: res.reason };
  const columns = [...new Set(res.rows.flatMap((r) => Object.keys(r)))];
  return { ...base, ok: true, count: res.count, metrics: res.metrics, columns, sample: res.rows.slice(0, 2).map(redactRow), provenance: { ...res.provenance } };
}

export function formatProbe(r: ProbeReport): string {
  return JSON.stringify(r, null, 2);
}
