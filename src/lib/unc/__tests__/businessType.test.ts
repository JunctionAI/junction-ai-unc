/* Business-type inference (src/lib/unc/businessType.ts) on four fixture sites — a Shopify store,
   an agency, a SaaS, a creator — plus the platform evidence read from the source, the "unsure"
   floor, and the model helpers the rest of the product reads. Pure: no network, no model. */

import { describe, expect, it } from "vitest";
import { AUDIENCE_WORD, BUSINESS_TYPE_CHIPS, classifyBusiness, hasStore, modelFromProfile, modelUnknown, SALE_WORD, spotPlatforms } from "../businessType";
import { applyClassification, htmlToText, mergeFounderOverride, type BusinessProfile } from "../scan";

const STORE_HTML = `<!doctype html><html><head><title>AVGAR Sport — Luxury women's golf</title>
<meta name="description" content="Luxury women's golf apparel. Free shipping over NZ$200.">
<link rel="stylesheet" href="https://cdn.shopify.com/s/files/1/0600/theme.css">
<script src="https://static.klaviyo.com/onsite/js/klaviyo.js?company_id=ABC"></script>
<script>!function(f,b,e,v,n,t,s){}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','123');</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-QMWSLKMWNJ"></script>
</head><body><nav><a href="/collections/all">Shop all</a><a href="/cart">Cart (0)</a></nav>
<h1>New arrivals</h1><div class="product"><h2>The Links Polo</h2><span>NZ$189.00</span><button>Add to cart</button></div>
<p>Free shipping on orders over NZ$200. 30-day returns policy.</p></body></html>`;

const AGENCY_HTML = `<!doctype html><html><head><title>Studio North | Brand studio for founders</title>
<meta name="description" content="We help founder-led brands find their voice.">
<script src="https://js.hs-scripts.com/12345.js"></script></head>
<body><nav><a href="/services">Our services</a><a href="/work">Case studies</a><a href="/contact">Book a call</a></nav>
<h1>A brand studio for founders</h1><p>We help founder-led businesses build brands people remember. Our clients include some of NZ's best small brands.</p>
<h2>Our services</h2><ul><li>Brand strategy</li><li>Identity design</li><li>Launch campaigns</li></ul>
<a href="/contact">Book a free consultation</a><p>Read our client stories and case studies.</p></body></html>`;

const SAAS_HTML = `<!doctype html><html><head><title>Ledgerly — Bookkeeping software for small teams</title>
<meta name="description" content="Bookkeeping software that closes your month in a day.">
<script async src="https://www.googletagmanager.com/gtag/js?id=AW-998877665"></script></head>
<body><nav><a href="/pricing">Pricing</a><a href="/login">Log in</a><a href="/signup">Start free trial</a></nav>
<h1>Close the books in a day</h1><p>Ledgerly is bookkeeping software for small teams. Integrations with Xero, Stripe and your bank. API and SDK for developers.</p>
<h2>Pricing plans</h2><p>Starter $29 per month · Team $79 per month, billed annually. Start your free trial — no card needed.</p>
<a href="/demo">Book a demo</a></body></html>`;

const CREATOR_HTML = `<!doctype html><html><head><title>The Long Game with Rory — podcast & newsletter</title>
<meta name="description" content="Weekly episodes on building a body of work. Join 12,000 readers.">
<script src="https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=X"></script></head>
<body><h1>The Long Game</h1><p>A weekly podcast and newsletter for people building a body of work. New episode every Tuesday — listen on Spotify or watch on YouTube.</p>
<p>Join 12,000+ subscribers. Subscribe to the newsletter.</p><a href="/sponsors">Partner with me — media kit</a><p>Members get the archive and a monthly call with the community.</p></body></html>`;

const pages = (html: string, url = "https://example.test/") => {
  const t = htmlToText(url, html);
  return [{ url, html, text: [t.title ?? "", t.description ?? "", t.text].join("\n") }];
};

describe("classifyBusiness — four fixture sites", () => {
  it("a Shopify store: ecommerce, sells products, storefront shopify, with the evidence", () => {
    const c = classifyBusiness(pages(STORE_HTML));
    expect(c).toMatchObject({ businessType: "ecommerce", sells: "products", storefront: "shopify" });
    expect(c.evidence).toContain("an add-to-cart control");
    expect(c.platformsSpotted.map((p) => p.platform)).toEqual(["shopify", "klaviyo", "meta_ads", "ga4"]);
  });

  it("an agency: services, sells services, no storefront — never a store", () => {
    const c = classifyBusiness(pages(AGENCY_HTML));
    expect(c).toMatchObject({ businessType: "services", sells: "services", storefront: "none" });
    expect(c.evidence).toContain("a book-a-call / quote call to action");
    expect(c.platformsSpotted).toEqual([{ platform: "hubspot", evidence: "HubSpot forms or tracking on the site" }]);
    expect(hasStore(c)).toBe(false);
  });

  it("a SaaS: subscriptions, no storefront, a Google Ads tag spotted", () => {
    const c = classifyBusiness(pages(SAAS_HTML));
    expect(c).toMatchObject({ businessType: "saas", sells: "subscriptions", storefront: "none" });
    expect(c.evidence).toContain("a free-trial offer");
    expect(c.platformsSpotted.map((p) => p.platform)).toEqual(["google_ads"]);
  });

  it("a creator: mixed, no storefront, a TikTok pixel spotted", () => {
    const c = classifyBusiness(pages(CREATOR_HTML));
    expect(c).toMatchObject({ businessType: "creator", sells: "mixed", storefront: "none" });
    expect(c.evidence).toContain("episodes / a channel to subscribe to");
    expect(c.platformsSpotted.map((p) => p.platform)).toEqual(["tiktok"]);
  });

  it("thin or ambiguous text: every field null, no evidence — never a guess", () => {
    expect(classifyBusiness([])).toEqual({ businessType: null, sells: null, storefront: null, evidence: [], platformsSpotted: [] });
    const thin = classifyBusiness(pages("<html><head><title>Hello</title></head><body><p>Welcome to our website. Contact us.</p></body></html>"));
    expect(thin).toMatchObject({ businessType: null, sells: null, storefront: null, evidence: [] });
    expect(modelUnknown(thin)).toBe(true);
  });

  it("storefront scripts alone (no copy to read) are a store: a Shopify storefront is the strongest signal there is", () => {
    const c = classifyBusiness(pages('<html><head><script src="https://cdn.shopify.com/s/x.js"></script></head><body><p>Hello world</p></body></html>'));
    expect(c).toMatchObject({ businessType: "ecommerce", sells: "products", storefront: "shopify", evidence: ["a Shopify storefront"] });
    expect(hasStore(c)).toBe(true);
  });
  it("a services site with a small WooCommerce shop beside it: services, sells mixed, storefront woocommerce — the store is not hidden", () => {
    const c = classifyBusiness(pages(AGENCY_HTML.replace("</head>", '<script src="/wp-content/plugins/woocommerce/assets/js/frontend.js"></script></head>')));
    expect(c).toMatchObject({ businessType: "services", sells: "mixed", storefront: "woocommerce" });
    expect(c.evidence[0]).toBe("a WooCommerce storefront");
    expect(hasStore(c)).toBe(true);
  });
});

describe("spotPlatforms + the model helpers", () => {
  it("reads pixels and scripts once each, in a stable order", () => {
    expect(spotPlatforms(STORE_HTML + STORE_HTML).map((p) => p.platform)).toEqual(["shopify", "klaviyo", "meta_ads", "ga4"]);
    expect(spotPlatforms("<p>nothing</p>")).toEqual([]);
    expect(spotPlatforms('<script src="https://config.gorgias.chat/x.js"></script>')).toEqual([{ platform: "gorgias", evidence: "Gorgias chat on the site" }]);
  });

  it("hasStore: only on evidence; unknown is never a store; a founder who says ecommerce is", () => {
    expect(hasStore(null)).toBe(false);
    expect(hasStore({ businessType: null, sells: null, storefront: null })).toBe(false);
    expect(hasStore({ businessType: "services", sells: "services", storefront: "none" })).toBe(false);
    expect(hasStore({ businessType: "ecommerce", sells: "products", storefront: null })).toBe(true);
    expect(hasStore({ businessType: "services", sells: "mixed", storefront: "woocommerce" })).toBe(true);
    expect(hasStore({ businessType: "creator", sells: "mixed", storefront: "none" })).toBe(false);
  });

  it("modelFromProfile tolerates anything (old profiles, junk) and reads the three fields", () => {
    expect(modelFromProfile(null)).toEqual({ businessType: null, sells: null, storefront: null });
    expect(modelFromProfile({ name: "x" })).toEqual({ businessType: null, sells: null, storefront: null });
    expect(modelFromProfile({ businessType: "saas", sells: "nope", storefront: "none" })).toEqual({ businessType: "saas", sells: null, storefront: "none" });
  });

  it("six chips, no 'other' chip; the words follow the model", () => {
    expect(BUSINESS_TYPE_CHIPS.map((c) => c.key)).toEqual(["ecommerce", "services", "saas", "local", "creator", "b2b"]);
    expect(AUDIENCE_WORD.services).toBe("clients");
    expect(SALE_WORD.local).toBe("bookings");
    expect(AUDIENCE_WORD.creator).toBe("audience");
  });
});

describe("the profile keeps the founder's pick", () => {
  const base: BusinessProfile = { name: "Studio North", oneLiner: null, category: null, products: [], audience: null, voice: { tone: null, phrases: [] }, market: { region: null, competitorsMentioned: [] }, signals: [], confidence: "high", sources: [] };
  it("applyClassification writes the scan's call; a founder pick wins over it", () => {
    const scanned = applyClassification(base, classifyBusiness(pages(AGENCY_HTML)));
    expect(scanned).toMatchObject({ businessType: "services", businessTypeSource: "scan", storefront: "none" });
    const founder = applyClassification({ ...base, businessType: "b2b", sells: "products", businessTypeSource: "founder" }, classifyBusiness(pages(AGENCY_HTML)));
    expect(founder).toMatchObject({ businessType: "b2b", sells: "products", businessTypeSource: "founder", storefront: "none" });
    expect(founder.typeEvidence).toContain("a services section");
  });
  it("mergeFounderOverride: a newer scan never overrides what the founder said", () => {
    const fresh = applyClassification(base, classifyBusiness(pages(STORE_HTML)));
    expect(mergeFounderOverride(fresh, null).businessType).toBe("ecommerce");
    expect(mergeFounderOverride(fresh, { ...base, businessType: "local", businessTypeSource: "founder" })).toMatchObject({ businessType: "local", businessTypeSource: "founder", storefront: "shopify" });
  });
});
