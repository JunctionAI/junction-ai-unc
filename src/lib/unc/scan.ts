/* Business-profile scan — the onboarding promise "I'll scan these to understand your
   business, voice and market." Server-side only (imported by /api/unc/scan).

   What it does:
   1. Fetches the founder's website homepage (+ /about and /products|/collections when
      they resolve) — 5 s per page, ≤ ~60 KB per page, redirects followed manually (≤ 3)
      with every hop re-checked against the SSRF guard. HTML is reduced to plain text.
   2. Social URLs/handles are NOT scraped (platforms block it and it's fragile) — the
      platform + handle are recorded as sources only.
   3. One model call (the "business_scan" task — a fast-tier model by default, see
      docs/MODELS.md) turns the fetched text into a strict-JSON BusinessProfile. The
      prompt forbids invention: anything not in the text is null.

   Never throws to the caller: an unreachable site yields a `confidence: "low"` profile
   with a plain `note`. Provider keys are read by the model layer from process.env only,
   never logged. */

import { complete, resolveModel } from "../llm/router";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { classifyBusiness, isBusinessType, isSells, isStorefront, type BusinessType, type BusinessTypeSource, type Classification, type PlatformEvidence, type Sells, type Storefront } from "./businessType";
import { requestPinnedPage, type PinnedPageFetch } from "./pinnedPageFetch";
import type { PinnedAddress } from "../http/pinnedRequest";

export type Confidence = "low" | "medium" | "high";
export type { BusinessType, Sells, Storefront, PlatformEvidence } from "./businessType";

export interface BusinessProfile {
  name: string | null;
  oneLiner: string | null;
  category: string | null;
  products: string[];
  audience: string | null;
  voice: { tone: string | null; phrases: string[] };
  market: { region: string | null; competitorsMentioned: string[] };
  signals: string[];
  confidence: Confidence;
  /** URLs actually read + social handles recorded (never scraped). */
  sources: string[];
  /** Present when the scan degraded (site unreachable, thin text, analysis unavailable). */
  note?: string;
  /* ---- business type (2026-09-03, additive — absent on profiles scanned before; read as null) ----
     Inferred from the fetched HTML/text with evidence; null when unsure. The founder can override
     in onboarding step 4 (businessTypeSource "founder" then wins over every later scan). */
  businessType?: BusinessType | null;
  sells?: Sells | null;
  storefront?: Storefront | null;
  businessTypeSource?: BusinessTypeSource | null;
  /** What the classification rests on ("a Shopify storefront", "a book-a-call call to action"). */
  typeEvidence?: string[];
  /** Tools evidenced in the page source (pixels / scripts) — "I spotted this on your site". */
  platformsSpotted?: PlatformEvidence[];
}

/** The classification slice of a profile, with the founder's override respected. */
export function applyClassification(profile: BusinessProfile, c: Classification): BusinessProfile {
  const founder = profile.businessTypeSource === "founder";
  return {
    ...profile,
    businessType: founder ? profile.businessType : c.businessType,
    sells: founder ? (profile.sells ?? c.sells) : c.sells,
    storefront: c.storefront ?? (founder ? profile.storefront : null) ?? null,
    businessTypeSource: founder ? "founder" : c.businessType ? "scan" : null,
    typeEvidence: c.evidence,
    platformsSpotted: c.platformsSpotted,
  };
}

/** Keep the founder's own pick (and a storefront the scan already saw) when a newer scan lands. */
export function mergeFounderOverride(fresh: BusinessProfile, previous: BusinessProfile | null): BusinessProfile {
  if (!previous || previous.businessTypeSource !== "founder") return fresh;
  return { ...fresh, businessType: previous.businessType ?? fresh.businessType, sells: previous.sells ?? fresh.sells, businessTypeSource: "founder" };
}

export interface SocialHandle {
  platform: string;
  handle: string;
  url: string | null;
}

export interface ScanInput {
  website: string;
  socials: string;
  /** When known (signed-in founder): honours their model choice and attributes the ledger row. */
  accountId?: string | null;
}

/* Sonnet-class models think adaptively by default (thinking tokens count against max_tokens
   and are not returned), so the cap is generous and effort is pinned low for this extraction job. */
const MAX_PROFILE_TOKENS = 4000;
const PROFILE_EFFORT = "low" as const;
const PAGE_TIMEOUT_MS = 5000;
const PAGE_MAX_BYTES = 60_000;
const MAX_REDIRECTS = 3;
const PAGE_TEXT_CAP = 9000; // chars of text per page handed to the model
const TOTAL_TEXT_CAP = 24_000;
const USER_AGENT = "Mozilla/5.0 (compatible; JunctionUnc/1.0; +https://getjunction.ai)";

/* ------------------------------------------------------------------ */
/* SSRF guard                                                          */
/* ------------------------------------------------------------------ */

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };
export type HostLookup = (hostname: string, options: { all: true }) => Promise<{ address: string; family: number }[]>;
export type ResolvedUrlCheck = { ok: true; url: URL; pin: PinnedAddress } | { ok: false; reason: string };

/** "avgarsport.com" → "https://avgarsport.com" (scheme added only when missing). */
export function normalizeWebsite(raw: string): string {
  const t = (raw || "").trim();
  if (!t) return "";
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`;
}

function isPrivateV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a, b] = p;
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    a >= 224 // multicast / reserved / broadcast
  );
}

function isPrivateV6(ip: string): boolean {
  const l = ip.toLowerCase();
  if (l === "::" || l === "::1") return true;
  if (l.startsWith("fc") || l.startsWith("fd")) return true; // ULA fc00::/7
  if (/^fe[89ab]/.test(l)) return true; // link-local fe80::/10
  const mapped = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);
  const hexMapped = l.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/); // ::ffff:7f00:1 form
  if (hexMapped) {
    const a = parseInt(hexMapped[1], 16), b = parseInt(hexMapped[2], 16);
    return isPrivateV4(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`);
  }
  return false;
}

/** Post-DNS guard: true for loopback, RFC1918, link-local/metadata, CGNAT, ULA, mapped-v4 and non-IP strings. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) return isPrivateV6(ip);
  return true; // not an IP at all — treat as unsafe
}

/** Syntax-level guard: http(s) only, no credentials, no localhost/IP literals/intranet names. */
export function checkUrlSyntax(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(normalizeWebsite(raw));
  } catch {
    return { ok: false, reason: "That doesn't look like a web address I can read." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "I can only scan http(s) addresses." };
  if (url.username || url.password) return { ok: false, reason: "I can't scan addresses that carry credentials." };
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return { ok: false, reason: "That address has no host." };
  if (isIP(host) !== 0) return { ok: false, reason: "I scan domain names, not IP addresses." };
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa") || !host.includes(".")) {
    return { ok: false, reason: "I can only scan public websites." };
  }
  return { ok: true, url };
}

/** Full request-time guard. Every answer must be public; the selected answer is the socket pin. */
export async function resolveSafeUrl(raw: string, lookupImpl: HostLookup = lookup as HostLookup): Promise<ResolvedUrlCheck> {
  const syn = checkUrlSyntax(raw);
  if (!syn.ok) return syn;
  try {
    const addrs = await lookupImpl(syn.url.hostname, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) return { ok: false, reason: "I can only scan public websites." };
    const address = addrs[0].address.split("%")[0];
    const family = isIP(address);
    if (family !== 4 && family !== 6) return { ok: false, reason: "I can only scan public websites." };
    return { ...syn, pin: { address, family } };
  } catch {
    return { ok: false, reason: "I couldn't find that site — check the address." };
  }
}

/** Public validation API used by the route before scanning; it deliberately does not expose the pin. */
export async function isSafeUrl(raw: string): Promise<UrlCheck> {
  const resolved = await resolveSafeUrl(raw);
  return resolved.ok ? { ok: true, url: resolved.url } : resolved;
}

/* ------------------------------------------------------------------ */
/* Fetching + HTML → text                                              */
/* ------------------------------------------------------------------ */

export interface FetchedPage {
  url: string;
  html: string;
}

export interface SafeFetchPageDeps {
  lookup?: HostLookup;
  request?: PinnedPageFetch;
  /** Bounded larger reads for script-heavy storefronts; default onboarding cap unchanged. */
  maxBytes?: number;
}

/** Resolve, pin and fetch one page; every redirect is a new validated/pinned hop. */
export async function safeFetchPage(startUrl: string, deps: SafeFetchPageDeps = {}): Promise<FetchedPage | null> {
  const maxBytes = deps.maxBytes ?? PAGE_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1_000_000) return null;
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const check = await resolveSafeUrl(current, deps.lookup);
    if (!check.ok) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PAGE_TIMEOUT_MS);
    try {
      const res = await (deps.request ?? requestPinnedPage)(check.url, check.pin, {
        signal: ctrl.signal,
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "Accept-Language": "en", "Accept-Encoding": "identity" },
        maxBytes,
      });
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get("location");
        if (!loc) return null;
        current = new URL(loc, check.url).toString();
        continue;
      }
      if (res.status !== 200) return null;
      const type = (res.headers.get("content-type") || "").toLowerCase();
      if (!type.includes("text/html") && !type.includes("xhtml") && !type.includes("text/plain")) return null;
      return { url: check.url.toString(), html: res.body };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null; // too many redirects
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", copy: "©", reg: "®", trade: "™" };

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

interface PageText {
  url: string;
  title: string | null;
  description: string | null;
  text: string;
}

/** Strip scripts/styles/tags; keep title + meta description; collapse whitespace. */
export function htmlToText(url: string, html: string): PageText {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? null;
  const metaDesc =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1] ??
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)?.[1] ??
    null;
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    // A bounded HTTP response can end inside a script/style/head. Never turn its
    // unfinished contents into business evidence after stripping the opening tag.
    .replace(/<(script|style|noscript|svg|template|iframe|head)\b[^>]*>[\s\S]*$/gi, " ")
    .replace(/<(br|p|div|li|h[1-6]|tr|section|article|header|footer|nav|ul|ol|table)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const clean = (s: string) => decodeEntities(s).replace(/[ \t\r\f\v]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  const text = clean(body)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 1)
    .join("\n")
    .slice(0, PAGE_TEXT_CAP);
  return { url, title: title ? clean(title) : null, description: metaDesc ? clean(metaDesc) : null, text };
}

/* ------------------------------------------------------------------ */
/* Socials — recorded, never scraped                                   */
/* ------------------------------------------------------------------ */

const PLATFORM_HOSTS: [RegExp, string][] = [
  [/instagram\.com$/, "Instagram"],
  [/tiktok\.com$/, "TikTok"],
  [/linkedin\.com$/, "LinkedIn"],
  [/facebook\.com$|fb\.com$/, "Facebook"],
  [/youtube\.com$|youtu\.be$/, "YouTube"],
  [/twitter\.com$|x\.com$/, "X"],
  [/pinterest\.(com|co\.nz|com\.au)$/, "Pinterest"],
  [/threads\.net$/, "Threads"],
];

export function parseSocials(raw: string): SocialHandle[] {
  const out: SocialHandle[] = [];
  for (const tok of (raw || "").split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean)) {
    if (/^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/|$)/i.test(tok)) {
      try {
        const u = new URL(/^https?:\/\//i.test(tok) ? tok : `https://${tok}`);
        const host = u.hostname.replace(/^www\./, "").toLowerCase();
        const platform = PLATFORM_HOSTS.find(([re]) => re.test(host))?.[1] ?? host;
        const seg = u.pathname.split("/").filter(Boolean).filter((s) => !/^(in|company|channel|c|user|@?)$/i.test(s)).pop() ?? "";
        out.push({ platform, handle: seg.replace(/^@/, "") || host, url: u.toString() });
        continue;
      } catch {
        /* fall through to handle form */
      }
    }
    const m = tok.match(/^(?:(instagram|ig|tiktok|tt|linkedin|li|facebook|fb|youtube|yt|x|twitter|pinterest|threads)[:/])?@?([\w.-]{2,})$/i);
    if (m) {
      const p = (m[1] || "").toLowerCase();
      const platform = p ? ({ ig: "Instagram", instagram: "Instagram", tt: "TikTok", tiktok: "TikTok", li: "LinkedIn", linkedin: "LinkedIn", fb: "Facebook", facebook: "Facebook", yt: "YouTube", youtube: "YouTube", x: "X", twitter: "X", pinterest: "Pinterest", threads: "Threads" } as Record<string, string>)[p] ?? p : "unspecified";
      out.push({ platform, handle: m[2], url: null });
    }
  }
  return out.slice(0, 12);
}

/* ------------------------------------------------------------------ */
/* Profile assembly                                                    */
/* ------------------------------------------------------------------ */

const emptyProfile = (sources: string[], confidence: Confidence, note?: string): BusinessProfile => ({
  name: null,
  oneLiner: null,
  category: null,
  products: [],
  audience: null,
  voice: { tone: null, phrases: [] },
  market: { region: null, competitorsMentioned: [] },
  signals: [],
  confidence,
  sources,
  businessType: null,
  sells: null,
  storefront: null,
  businessTypeSource: null,
  typeEvidence: [],
  platformsSpotted: [],
  ...(note ? { note } : {}),
});

const str = (v: unknown, max = 300): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const strList = (v: unknown, max = 12, each = 120): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim().slice(0, each)).slice(0, max) : [];

function coerceProfile(raw: unknown, sources: string[]): BusinessProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const voice = (r.voice && typeof r.voice === "object" ? r.voice : {}) as Record<string, unknown>;
  const market = (r.market && typeof r.market === "object" ? r.market : {}) as Record<string, unknown>;
  const conf = r.confidence === "high" || r.confidence === "medium" ? r.confidence : "low";
  return {
    name: str(r.name, 120),
    oneLiner: str(r.oneLiner, 240),
    category: str(r.category, 120),
    products: strList(r.products),
    audience: str(r.audience, 240),
    voice: { tone: str(voice.tone, 160), phrases: strList(voice.phrases, 8, 80) },
    market: { region: str(market.region, 120), competitorsMentioned: strList(market.competitorsMentioned, 8, 80) },
    signals: strList(r.signals, 10, 160),
    confidence: conf,
    sources,
    // The model may name the type from the text; the deterministic classifier (applyClassification) overrides it when it has evidence.
    businessType: isBusinessType(r.businessType) ? r.businessType : null,
    sells: isSells(r.sells) ? r.sells : null,
    storefront: isStorefront(r.storefront) ? r.storefront : null,
    businessTypeSource: isBusinessType(r.businessType) ? "scan" : null,
    typeEvidence: [],
    platformsSpotted: [],
  };
}

/** The classifier's call wins where it has evidence; the model's reading fills what it left null. */
function combineClassification(profile: BusinessProfile, c: Classification): BusinessProfile {
  const merged = applyClassification(profile, c);
  return {
    ...merged,
    businessType: merged.businessType ?? profile.businessType ?? null,
    sells: merged.sells ?? profile.sells ?? null,
    storefront: merged.storefront ?? profile.storefront ?? null,
    businessTypeSource: merged.businessType ? (merged.businessTypeSource ?? "scan") : null,
  };
}

function extractJson(text: string): unknown {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
}

const SCAN_SYSTEM = `You read a small business's website text on behalf of Unc, the Junction growth operator, and return a business profile as strict JSON.

Rules (absolute):
- Use ONLY facts explicitly present in the SOURCE TEXT. Never invent, never fill gaps from general knowledge, never guess at a brand you think you recognise. If something is not in the text, the field is null (or an empty array for lists).
- Quote the brand's own words for voice.phrases — short verbatim phrases (≤ 8 words each, ≤ 6 phrases). Do not paraphrase them.
- Product names come from the text as written. Competitors only if the text names them.
- signals: short factual observations about the marketing surface that the text evidences (e.g. "runs a newsletter signup", "lists 4 product lines", "prices shown in NZD", "ships internationally"). No advice, no judgement.
- confidence: "high" if the homepage plus another page clearly describe what the business sells and to whom; "medium" if one page is clear; "low" if the text is thin, blocked, or ambiguous.
- businessType: what kind of business the text evidences — "ecommerce" (sells products through a cart), "services" (an agency, consultancy, studio or practice selling its work), "saas" (software sold as a subscription), "local" (a place people visit or book), "creator" (an audience-led media business), "b2b" (wholesale, trade or enterprise accounts), "other". null when the text does not make it clear. Never assume a store: only "ecommerce" when the text shows a cart, checkout, shipping or product listings.
- sells: "products" | "services" | "subscriptions" | "mixed" | null. storefront: "shopify" | "woocommerce" | "other" | "none" | null — only from explicit evidence.
- Output ONLY a JSON object with exactly these keys:
{"name": string|null, "oneLiner": string|null, "category": string|null, "products": string[], "audience": string|null, "voice": {"tone": string|null, "phrases": string[]}, "market": {"region": string|null, "competitorsMentioned": string[]}, "signals": string[], "confidence": "low"|"medium"|"high", "businessType": string|null, "sells": string|null, "storefront": string|null}
- oneLiner: one plain sentence, ≤ 25 words, describing what the business does, from the text. No markdown, no commentary.`;

function buildScanUserMessage(pages: PageText[], socials: SocialHandle[]): string {
  const parts: string[] = [];
  let used = 0;
  for (const p of pages) {
    const block = [`### PAGE ${p.url}`, p.title ? `title: ${p.title}` : "", p.description ? `meta description: ${p.description}` : "", p.text].filter(Boolean).join("\n");
    const room = Math.max(0, TOTAL_TEXT_CAP - used);
    if (!room) break;
    const slice = block.slice(0, room);
    used += slice.length;
    parts.push(slice);
  }
  if (socials.length) parts.push(`### SOCIAL HANDLES (recorded only — not read; do not infer anything from them)\n${socials.map((s) => `${s.platform}: @${s.handle}`).join("\n")}`);
  return `SOURCE TEXT\n\n${parts.join("\n\n")}\n\nReturn the JSON profile now.`;
}

/** Heuristic profile from title/meta only — used when the model is unavailable. The business
    type still comes from the deterministic classifier, so a services site never reads as a store
    just because the model was off. */
function heuristicProfile(pages: PageText[], sources: string[], note: string, classification: Classification): BusinessProfile {
  const home = pages[0];
  const p = emptyProfile(sources, "low", note);
  p.name = home?.title ? home.title.split(/[|–—-]/)[0].trim().slice(0, 120) || null : null;
  p.oneLiner = home?.description ?? null;
  return applyClassification(p, classification);
}

/** Fetched pages with both the raw HTML (for the classifier: scripts, pixels, storefront hosts)
    and the reduced text (for the model). Pages with nothing readable are dropped. */
async function fetchCandidatePages(website: string): Promise<{ pages: PageText[]; raw: FetchedPage[] }> {
  const base = new URL(normalizeWebsite(website));
  const at = (path: string) => new URL(path, base).toString();
  const home = safeFetchPage(base.toString());
  const aboutC = ["/about", "/pages/about", "/pages/about-us", "/about-us"].map((p) => safeFetchPage(at(p)));
  const prodC = ["/products", "/collections", "/collections/all", "/shop", "/services", "/pricing"].map((p) => safeFetchPage(at(p)));
  const [h, abouts, prods] = await Promise.all([home, Promise.all(aboutC), Promise.all(prodC)]);
  const fetched: FetchedPage[] = [];
  if (h) fetched.push(h);
  const firstDistinct = (list: (FetchedPage | null)[]) => list.find((p): p is FetchedPage => !!p && !fetched.some((q) => q.url === p.url));
  const about = firstDistinct(abouts);
  if (about) fetched.push(about);
  const prod = firstDistinct(prods);
  if (prod) fetched.push(prod);
  const pages: PageText[] = [];
  const raw: FetchedPage[] = [];
  for (const f of fetched) {
    const t = htmlToText(f.url, f.html);
    if (t.text.length > 40 || t.title || t.description) {
      pages.push(t);
      raw.push(f);
    }
  }
  return { pages, raw };
}

/** The deterministic classification of fetched pages (exported for the route + tests). */
export function classifyPages(pages: PageText[], raw: FetchedPage[]): Classification {
  return classifyBusiness(pages.map((p, i) => ({ url: p.url, html: raw[i]?.html ?? "", text: [p.title ?? "", p.description ?? "", p.text].join("\n") })));
}

/** The scan. Never throws — every failure path returns a low-confidence profile with a note. */
export async function scanBusiness(input: ScanInput): Promise<BusinessProfile> {
  const website = (input.website || "").trim();
  const socials = parseSocials(input.socials || "");
  const socialSources = socials.map((s) => (s.url ? s.url : `${s.platform}:@${s.handle}`));

  let pages: PageText[] = [];
  let raw: FetchedPage[] = [];
  if (website) {
    try {
      ({ pages, raw } = await fetchCandidatePages(website));
    } catch {
      pages = [];
      raw = [];
    }
  }
  const sources = [...pages.map((p) => p.url), ...socialSources];
  const classification = classifyPages(pages, raw);

  if (!pages.length) {
    const note = website
      ? `I couldn't reach ${website.replace(/^https?:\/\//, "")} just now — I'll use what you've told me and try the site again tonight.`
      : socials.length
        ? "No website to read yet — I've kept your handles and I'll use what you've told me."
        : "Nothing to scan yet — I'll use what you've told me.";
    return emptyProfile(sources, "low", note);
  }

  if (!resolveModel("business_scan")) {
    return heuristicProfile(pages, sources, "I read the site but couldn't analyse it yet — I'll use what you've told me for now.", classification);
  }

  try {
    const response = await complete(
      "business_scan",
      { system: SCAN_SYSTEM, messages: [{ role: "user", content: buildScanUserMessage(pages, socials) }], maxTokens: MAX_PROFILE_TOKENS, effort: PROFILE_EFFORT, jsonMode: true },
      { accountId: input.accountId ?? null },
    );
    if (!response) throw new Error("no provider");
    if (response.stopReason === "refusal") throw new Error("refused");
    if (response.stopReason === "error") throw new Error(response.errorCode ?? "error");
    const profile = coerceProfile(extractJson(response.text), sources);
    if (!profile) throw new Error("unparseable");
    if (profile.confidence === "low" && !profile.note) profile.note = "I could only read a little of the site — I'll lean on what you've told me and look again tonight.";
    return combineClassification(profile, classification);
  } catch {
    // Provider errors never reach the client (and nothing key-shaped is surfaced).
    return heuristicProfile(pages, sources, "I read the site but couldn't finish analysing it — I'll use what you've told me and look again tonight.", classification);
  }
}
