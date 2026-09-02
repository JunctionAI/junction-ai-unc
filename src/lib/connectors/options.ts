/* Post-connect account pickers — the platforms where one login holds MANY things Unc could
   read (GA4 properties, Google Ads customers, Meta ad accounts). After the OAuth callback
   `connectors.external_ref` is null for these (Meta: unless the user manages exactly one),
   and ConnectorCredentialProvider honestly answers "nothing connected" until it is set.

     listAccountOptions(platform, token, deps)   → the founder's choices, id + label
     normaliseExternalRef(platform, raw)         → the stored form, or null when malformed

   Request shaping is real and testable (URL, bearer header, developer-token header, paging);
   the live response shapes are Google's / Meta's documented ones and are only verifiable
   against a real login. Tokens travel in headers only; failures carry codes. */

import type { Platform } from "@/lib/runtime/types";
import type { FetchLike } from "./oauth";

export const PICKER_PLATFORMS: Platform[] = ["ga4", "google_ads", "meta_ads"];

export const OPTIONS_TIMEOUT_MS = 10_000;
/** Google Ads API version the picker calls. Versions sunset ~12 months after release —
    only verifiable live; bump here when the first real customer list answers 404. */
export const GOOGLE_ADS_API_VERSION = "v22";
export const META_GRAPH_VERSION = "v21.0";
const MAX_PAGES = 5;

export interface AccountOption {
  /** The value stored on connectors.external_ref once chosen. */
  id: string;
  /** What the founder sees in the picker. */
  label: string;
}

export class OptionsError extends Error {
  constructor(readonly code: `http_${number}` | "timeout" | "network" | "malformed" | "developer_token_missing" | "no_picker") {
    super(`account options: ${code}`);
    this.name = "OptionsError";
  }
}

export interface OptionsDeps {
  fetch: FetchLike;
  /** Env-shaped map (GOOGLE_ADS_DEVELOPER_TOKEN for the Ads list). */
  env: Record<string, string | undefined>;
  timeoutMs?: number;
}

export function hasPicker(platform: string): platform is Platform {
  return (PICKER_PLATFORMS as string[]).includes(platform);
}

async function getJson(deps: OptionsDeps, url: string, headers: Record<string, string>): Promise<unknown> {
  let res: Response;
  try {
    res = await deps.fetch(url, { method: "GET", headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(deps.timeoutMs ?? OPTIONS_TIMEOUT_MS) });
  } catch (e) {
    throw new OptionsError(e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network");
  }
  if (!res.ok) throw new OptionsError(`http_${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new OptionsError("malformed");
  }
}

/** Google Ads customer ids read as 123-456-7890. */
export function formatCustomerId(digits: string): string {
  return digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : digits;
}

// ---------- per platform ----------

async function ga4Options(accessToken: string, deps: OptionsDeps): Promise<AccountOption[]> {
  const out: AccountOption[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const j = (await getJson(deps, url, { authorization: `Bearer ${accessToken}` })) as { accountSummaries?: { displayName?: string; propertySummaries?: { property?: string; displayName?: string }[] }[]; nextPageToken?: string } | null;
    if (!j || typeof j !== "object") throw new OptionsError("malformed");
    for (const acct of j.accountSummaries ?? []) {
      for (const p of acct.propertySummaries ?? []) {
        const id = normaliseExternalRef("ga4", p.property);
        if (!id) continue;
        const name = p.displayName || `Property ${id}`;
        out.push({ id, label: acct.displayName ? `${name} — ${acct.displayName} (${id})` : `${name} (${id})` });
      }
    }
    pageToken = typeof j.nextPageToken === "string" && j.nextPageToken ? j.nextPageToken : undefined;
    if (!pageToken) break;
  }
  return out;
}

async function googleAdsOptions(accessToken: string, deps: OptionsDeps): Promise<AccountOption[]> {
  const developerToken = (deps.env.GOOGLE_ADS_DEVELOPER_TOKEN || "").trim();
  if (!developerToken) throw new OptionsError("developer_token_missing");
  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers:listAccessibleCustomers`;
  const j = (await getJson(deps, url, { authorization: `Bearer ${accessToken}`, "developer-token": developerToken })) as { resourceNames?: unknown } | null;
  if (!j || typeof j !== "object" || (j.resourceNames !== undefined && !Array.isArray(j.resourceNames))) throw new OptionsError("malformed");
  const out: AccountOption[] = [];
  for (const rn of (j.resourceNames as unknown[]) ?? []) {
    const id = normaliseExternalRef("google_ads", rn);
    if (id) out.push({ id, label: `Customer ${formatCustomerId(id)}` });
  }
  return out;
}

async function metaOptions(accessToken: string, deps: OptionsDeps): Promise<AccountOption[]> {
  const out: AccountOption[] = [];
  let url: string | null = `https://graph.facebook.com/${META_GRAPH_VERSION}/me/adaccounts?fields=account_id,name,account_status&limit=100`;
  for (let page = 0; page < MAX_PAGES && url; page++) {
    const j = (await getJson(deps, url, { authorization: `Bearer ${accessToken}` })) as { data?: { account_id?: string; name?: string; account_status?: number }[]; paging?: { next?: string } } | null;
    if (!j || typeof j !== "object" || (j.data !== undefined && !Array.isArray(j.data))) throw new OptionsError("malformed");
    for (const a of j.data ?? []) {
      const id = normaliseExternalRef("meta_ads", a.account_id);
      if (!id) continue;
      const status = typeof a.account_status === "number" && a.account_status !== 1 ? " · inactive" : "";
      out.push({ id, label: `${a.name || "Ad account"} (${id})${status}` });
    }
    // paging.next is Meta's own URL and carries the token in its query; re-request our own shape instead.
    const next = j.paging?.next;
    url = null;
    if (typeof next === "string") {
      try {
        const after = new URL(next).searchParams.get("after");
        if (after) url = `https://graph.facebook.com/${META_GRAPH_VERSION}/me/adaccounts?fields=account_id,name,account_status&limit=100&after=${encodeURIComponent(after)}`;
      } catch {
        url = null;
      }
    }
  }
  return out;
}

/** The founder's choices for a picker platform. Throws OptionsError (codes only). */
export async function listAccountOptions(platform: Platform, accessToken: string, deps: OptionsDeps): Promise<AccountOption[]> {
  switch (platform) {
    case "ga4":
      return ga4Options(accessToken, deps);
    case "google_ads":
      return googleAdsOptions(accessToken, deps);
    case "meta_ads":
      return metaOptions(accessToken, deps);
    default:
      throw new OptionsError("no_picker");
  }
}

/** The stored form of an external ref for a picker platform, or null when the input isn't
    one. Accepts the API's resource-name forms and the human forms:
      ga4         "properties/123456" | "123456"                 → "123456"
      google_ads  "customers/1234567890" | "123-456-7890"        → "1234567890"
      meta_ads    "act_123" | "123"                              → "act_123" */
export function normaliseExternalRef(platform: string, raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > 64) return null;
  switch (platform) {
    case "ga4": {
      const m = /^(?:properties\/)?(\d{1,20})$/.exec(s);
      return m ? m[1] : null;
    }
    case "google_ads": {
      const m = /^(?:customers\/)?(\d{3}-?\d{3}-?\d{4})$/.exec(s);
      return m ? m[1].replace(/-/g, "") : null;
    }
    case "meta_ads": {
      const m = /^(?:act_)?(\d{1,20})$/.exec(s);
      return m ? `act_${m[1]}` : null;
    }
    default:
      return null;
  }
}
