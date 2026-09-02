/* Business type — what kind of business this is, what it sells, and whether it runs a store.
   Pure and dependency-free: the scan (server) classifies from the fetched HTML/text, the
   onboarding step (client) lets the founder override, and routine availability / platform
   suggestions read the result. Nothing here assumes e-commerce: null means "not sure", and
   every consumer treats null as "don't hide, don't assume".

     classifyBusiness(pages)   deterministic, with the evidence lines it relied on
     spotPlatforms(html)       tools evidenced in the page source (pixels / scripts / hosts)
     hasStore(model)           true only when the evidence says a store exists
     modelFromProfile(p)       reads the three fields off any profile-shaped object */

export type BusinessType = "ecommerce" | "services" | "saas" | "local" | "creator" | "b2b" | "other";
export type Sells = "products" | "services" | "subscriptions" | "mixed";
export type Storefront = "shopify" | "woocommerce" | "other" | "none";

export interface BusinessModel {
  businessType: BusinessType | null;
  sells: Sells | null;
  storefront: Storefront | null;
}

/** Who set the business type: the founder's own pick always wins over the scan. */
export type BusinessTypeSource = "founder" | "scan";

export interface PlatformEvidence {
  /** Connector slug (connectors.platform): shopify · klaviyo · meta_ads · ga4 · google_ads · hubspot · gorgias · tiktok. */
  platform: string;
  evidence: string;
}

export interface Classification extends BusinessModel {
  /** Short factual lines: what in the source the call rests on. Empty when unsure. */
  evidence: string[];
  platformsSpotted: PlatformEvidence[];
}

export const BUSINESS_TYPES: BusinessType[] = ["ecommerce", "services", "saas", "local", "creator", "b2b", "other"];
export const isBusinessType = (v: unknown): v is BusinessType => typeof v === "string" && (BUSINESS_TYPES as string[]).includes(v);
export const isSells = (v: unknown): v is Sells => v === "products" || v === "services" || v === "subscriptions" || v === "mixed";
export const isStorefront = (v: unknown): v is Storefront => v === "shopify" || v === "woocommerce" || v === "other" || v === "none";

/** The onboarding chips (step 4, single select). Six — "other" is the honest fallback, not a chip. */
export const BUSINESS_TYPE_CHIPS: { key: BusinessType; label: string; hint: string }[] = [
  { key: "ecommerce", label: "Online store", hint: "you sell products through a cart" },
  { key: "services", label: "Services / agency", hint: "clients, enquiries, bookings" },
  { key: "saas", label: "Software / SaaS", hint: "subscriptions, trials, sign-ups" },
  { key: "local", label: "Local business", hint: "a place people visit or book" },
  { key: "creator", label: "Creator / media", hint: "audience, followers, sponsors" },
  { key: "b2b", label: "B2B / wholesale", hint: "accounts, quotes, demos" },
];

export const BUSINESS_TYPE_LABEL: Record<BusinessType, string> = {
  ecommerce: "Online store",
  services: "Services / agency",
  saas: "Software / SaaS",
  local: "Local business",
  creator: "Creator / media",
  b2b: "B2B / wholesale",
  other: "Other",
};

/** What each type sells by default (the founder can still say otherwise). */
export const DEFAULT_SELLS: Record<BusinessType, Sells> = {
  ecommerce: "products",
  services: "services",
  saas: "subscriptions",
  local: "services",
  creator: "mixed",
  b2b: "products",
  other: "mixed",
};

/** The word for "the people who pay" — customers is only right for a store. */
export const AUDIENCE_WORD: Record<BusinessType, string> = {
  ecommerce: "customers",
  services: "clients",
  saas: "users",
  local: "customers",
  creator: "audience",
  b2b: "accounts",
  other: "customers",
};

/** The word for "a sale" — orders is only right for a store. */
export const SALE_WORD: Record<BusinessType, string> = {
  ecommerce: "orders",
  services: "enquiries",
  saas: "sign-ups",
  local: "bookings",
  creator: "sponsors",
  b2b: "deals",
  other: "sales",
};

/** True only when the evidence says a store exists (a storefront, or products for sale). Unknown ⇒ false. */
export function hasStore(m: BusinessModel | null | undefined): boolean {
  if (!m) return false;
  if (m.storefront && m.storefront !== "none") return true;
  if (m.storefront === "none") return m.sells === "products" || m.sells === "mixed" ? m.businessType === "ecommerce" : false;
  return m.businessType === "ecommerce" || m.sells === "products";
}

/** True when nothing is known — consumers must not hide or assume anything then. */
export const modelUnknown = (m: BusinessModel | null | undefined): boolean => !m || (!m.businessType && !m.sells && !m.storefront);

/** Reads the three fields off any profile-shaped object (business_profiles.profile jsonb). */
export function modelFromProfile(p: unknown): BusinessModel {
  if (!p || typeof p !== "object") return { businessType: null, sells: null, storefront: null };
  const r = p as Record<string, unknown>;
  return {
    businessType: isBusinessType(r.businessType) ? r.businessType : null,
    sells: isSells(r.sells) ? r.sells : null,
    storefront: isStorefront(r.storefront) ? r.storefront : null,
  };
}

// ---------- platform evidence in the source ----------

const PLATFORM_SIGNS: { platform: string; re: RegExp; evidence: string }[] = [
  { platform: "shopify", re: /cdn\.shopify\.com|myshopify\.com|Shopify\.theme|\/cdn\/shop\//i, evidence: "Shopify storefront scripts on the site" },
  { platform: "klaviyo", re: /klaviyo\.com\/onsite|static\.klaviyo\.com|_learnq|klaviyo\.js/i, evidence: "a Klaviyo signup script on the site" },
  { platform: "meta_ads", re: /connect\.facebook\.net\/[a-z_]+\/fbevents\.js|\bfbq\s*\(/i, evidence: "a Meta pixel on the site" },
  { platform: "ga4", re: /googletagmanager\.com\/gtag\/js\?id=G-|gtag\s*\(\s*['"]config['"]\s*,\s*['"]G-/i, evidence: "a Google Analytics 4 tag on the site" },
  { platform: "google_ads", re: /googletagmanager\.com\/gtag\/js\?id=AW-|['"]AW-\d{6,}['"]/i, evidence: "a Google Ads conversion tag on the site" },
  { platform: "hubspot", re: /js\.hs-scripts\.com|js\.hsforms\.net|hubspot\.com\/.*forms/i, evidence: "HubSpot forms or tracking on the site" },
  { platform: "gorgias", re: /gorgias\.chat|config\.gorgias\.chat|gorgias-chat/i, evidence: "Gorgias chat on the site" },
  { platform: "tiktok", re: /analytics\.tiktok\.com\/i18n\/pixel/i, evidence: "a TikTok pixel on the site" },
];

/** Tools evidenced in the raw page source, once each, in a stable order. */
export function spotPlatforms(html: string): PlatformEvidence[] {
  const out: PlatformEvidence[] = [];
  for (const s of PLATFORM_SIGNS) if (s.re.test(html) && !out.some((o) => o.platform === s.platform)) out.push({ platform: s.platform, evidence: s.evidence });
  return out;
}

// ---------- the classifier ----------

export interface ClassifyPage {
  url: string;
  html: string;
  /** Plain text of the page (title + body); the scan hands its reduced text. */
  text: string;
}

interface Sign {
  re: RegExp;
  weight: number;
  evidence: string;
}

const STORE_SIGNS: Sign[] = [
  { re: /add to cart|add to bag|add to basket/i, weight: 3, evidence: "an add-to-cart control" },
  { re: /\/cart\b|\/checkout\b|view cart|your cart|shopping cart/i, weight: 2, evidence: "a cart / checkout on the site" },
  { re: /free shipping|ships? (worldwide|internationally|nationwide)|shipping policy|returns? policy/i, weight: 2, evidence: "shipping and returns copy" },
  { re: /\/collections\/|\/products\/|shop all|shop now|new arrivals|best ?sellers|sold out/i, weight: 2, evidence: "collections / product pages" },
  { re: /\b(?:NZ\$|A\$|US\$|\$|£|€)\s?\d[\d,]*(?:\.\d\d)?\b/, weight: 1, evidence: "prices on the page" },
];

const SERVICES_SIGNS: Sign[] = [
  { re: /our services|services we offer|what we do|how we work|our process/i, weight: 3, evidence: "a services section" },
  { re: /book a (?:call|consult|consultation|discovery)|free consultation|get a quote|request a quote|request a proposal|enquire now|enquiry|inquire now/i, weight: 3, evidence: "a book-a-call / quote call to action" },
  { re: /our clients|clients we've worked with|client stories|case stud(?:y|ies)|testimonials/i, weight: 2, evidence: "client case studies" },
  { re: /\bagency\b|consultanc(?:y|ies)|consulting|studio\b/i, weight: 2, evidence: "the site calls itself an agency / studio / consultancy" },
  { re: /we help|we work with|we partner with|done[- ]for[- ]you/i, weight: 1, evidence: "we-help-you framing" },
];

const SAAS_SIGNS: Sign[] = [
  { re: /start (?:your )?free trial|free trial|try (?:it )?free|start for free|get started free/i, weight: 3, evidence: "a free-trial offer" },
  { re: /\/pricing\b|pricing plans|per month|\/mo\b|per seat|per user|billed (?:monthly|annually)/i, weight: 2, evidence: "per-month pricing plans" },
  { re: /sign up|log ?in|create (?:an|your) account|dashboard|integrations?|\bAPI\b|\bSDK\b/i, weight: 1, evidence: "sign-up / login / integrations" },
  { re: /\bsoftware\b|\bplatform\b|\bapp\b|\bSaaS\b|workflow|automat(?:e|ion)/i, weight: 1, evidence: "software / platform language" },
  { re: /request a demo|book a demo|see it in action/i, weight: 2, evidence: "a demo request" },
];

const LOCAL_SIGNS: Sign[] = [
  { re: /opening hours|open(?:ing)? (?:times|hours)|hours:|mon(?:day)?\s*[-–]\s*fri(?:day)?/i, weight: 3, evidence: "opening hours" },
  { re: /visit us|find us|directions|get directions|our location|come (?:and )?see us/i, weight: 3, evidence: "visit-us / directions" },
  { re: /book (?:now|online|an appointment|a table|a session)|make a booking|reserve/i, weight: 2, evidence: "online booking" },
  { re: /\b(?:call|phone|ph)\s*:?\s*(?:\+?\d[\d\s()-]{7,})/i, weight: 1, evidence: "a phone number to call" },
  { re: /\b(?:\d{1,5}\s+[A-Z][a-z]+\s+(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Place|Pl|Way|Terrace|Tce|Parade|Crescent))\b/, weight: 2, evidence: "a street address" },
];

const CREATOR_SIGNS: Sign[] = [
  { re: /subscribe to (?:my|the) (?:channel|newsletter|podcast)|new (?:episode|video) every|latest (?:episode|video)|listen on|watch on youtube/i, weight: 3, evidence: "episodes / a channel to subscribe to" },
  { re: /\bpodcast\b|\bepisodes?\b|\bnewsletter\b|\bsubstack\b|\bpatreon\b|\bmembers?hip\b/i, weight: 2, evidence: "podcast / newsletter / membership" },
  { re: /\bsponsors?(?:hip)?\b|partner with me|work with me|media kit/i, weight: 2, evidence: "sponsorship / media kit" },
  { re: /\bfollowers\b|\bsubscribers\b|\baudience\b|my community|join \d[\d,]*\+? (?:readers|listeners|subscribers)/i, weight: 2, evidence: "audience / subscriber counts" },
  { re: /\bcreator\b|content creator|youtuber|\bvlog\b|\bstreamer\b/i, weight: 2, evidence: "creator language" },
];

const B2B_SIGNS: Sign[] = [
  { re: /\bwholesale\b|\btrade (?:customers|pricing|account)\b|\bdistributors?\b|\bresellers?\b|\bstockists?\b/i, weight: 3, evidence: "wholesale / trade" },
  { re: /\benterprise\b|procurement|\bRFQ\b|request for quote|purchase orders?|\bMOQ\b|minimum order/i, weight: 3, evidence: "enterprise / procurement terms" },
  { re: /for businesses|for teams|for enterprises|\bB2B\b|business customers/i, weight: 2, evidence: "for-businesses framing" },
  { re: /request a demo|book a demo|talk to sales|contact sales/i, weight: 2, evidence: "talk-to-sales" },
];

const STOREFRONT_SIGNS: { storefront: Storefront; re: RegExp; evidence: string }[] = [
  { storefront: "shopify", re: /cdn\.shopify\.com|myshopify\.com|Shopify\.theme|\/cdn\/shop\/|shopify-section/i, evidence: "a Shopify storefront" },
  { storefront: "woocommerce", re: /woocommerce|wp-content\/plugins\/woocommerce|wc-ajax/i, evidence: "a WooCommerce storefront" },
  { storefront: "other", re: /bigcommerce|squarespace-commerce|sqs-add-to-cart|wixstores|wix-ecom|magento|prestashop|snipcart|ecwid|\/checkout\b|add to cart|add to bag/i, evidence: "a storefront (not Shopify or WooCommerce)" },
];

function score(signs: Sign[], src: string): { total: number; evidence: string[] } {
  let total = 0;
  const evidence: string[] = [];
  for (const s of signs) {
    if (s.re.test(src)) {
      total += s.weight;
      evidence.push(s.evidence);
    }
  }
  return { total, evidence };
}

const MIN_SCORE = 3;
const MIN_MARGIN = 1;

/** Deterministic classification from the fetched pages. Never guesses: below the evidence
    floor every field is null and `evidence` is empty. The storefront read (scripts / hosts in
    the raw HTML) is the strongest signal — a store is a store whatever the copy says. */
export function classifyBusiness(pages: ClassifyPage[]): Classification {
  const none: Classification = { businessType: null, sells: null, storefront: null, evidence: [], platformsSpotted: [] };
  if (!pages.length) return none;
  const html = pages.map((p) => p.html).join("\n");
  const text = pages.map((p) => p.text).join("\n");
  const src = `${text}\n${html}`;

  const platformsSpotted = spotPlatforms(html);
  const sf = STOREFRONT_SIGNS.find((s) => s.re.test(html));
  const store = score(STORE_SIGNS, src);
  const storefront: Storefront | null = sf ? sf.storefront : store.total >= MIN_SCORE ? "other" : null;

  const scored = (type: BusinessType, r: { total: number; evidence: string[] }) => ({ type, total: r.total, evidence: r.evidence });
  const scores = [
    scored("ecommerce", { ...store, total: store.total + (sf ? 4 : 0) }),
    scored("services", score(SERVICES_SIGNS, src)),
    scored("saas", score(SAAS_SIGNS, src)),
    scored("local", score(LOCAL_SIGNS, src)),
    scored("creator", score(CREATOR_SIGNS, src)),
    scored("b2b", score(B2B_SIGNS, src)),
  ].sort((a, b) => b.total - a.total);
  const [best, second] = scores;
  const confident = best.total >= MIN_SCORE && best.total - second.total >= MIN_MARGIN;

  if (!confident) {
    // A storefront alone is still worth saying (the founder may sell products beside a service).
    if (sf) return { businessType: null, sells: null, storefront, evidence: [sf.evidence], platformsSpotted };
    return { ...none, platformsSpotted };
  }

  const evidence = [...(sf ? [sf.evidence] : []), ...best.evidence.slice(0, 3)];
  const sells: Sells = best.type === "ecommerce" ? "products" : sf || store.total >= MIN_SCORE ? "mixed" : DEFAULT_SELLS[best.type];
  const finalStorefront: Storefront | null = storefront ?? (best.type === "ecommerce" ? "other" : best.total >= MIN_SCORE + 2 ? "none" : null);
  return { businessType: best.type, sells, storefront: finalStorefront, evidence, platformsSpotted };
}
