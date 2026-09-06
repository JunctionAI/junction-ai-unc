import { safeFetchPage, htmlToText, type FetchedPage } from "../unc/scan";
import type { SeoDraftInput } from "./seoDraft";
import type { SeoPackageScope } from "./seoPackage";

/** A bounded public-page read, not a claim of complete site inventory or CMS access. */
export async function readSeoSiteSources(
  scope: SeoPackageScope,
  website: string,
  now: string,
  fetchPage: (url: string) => Promise<FetchedPage | null> = url => safeFetchPage(url, { maxBytes: 1_000_000 }),
): Promise<Pick<SeoDraftInput, "pages" | "productFacts">> {
  const root = new URL(website);
  if (root.protocol !== "https:" || root.username || root.password || !Number.isFinite(Date.parse(now)))
    throw new Error("Invalid website source");
  const home = await fetchPage(root.toString());
  if (!home || new URL(home.url).origin !== root.origin) throw new Error("Could not read the verified website origin");
  const links = [...home.html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].flatMap(match => {
    try {
      const url = new URL(match[1], root);
      if (url.origin !== root.origin || !/^\/(products|pages|blogs)\//.test(url.pathname)) return [];
      url.search = ""; url.hash = "";
      return [url.toString()];
    } catch { return []; }
  });
  const unique = [...new Set(links)].sort((a, b) => Number(/travel/i.test(b)) - Number(/travel/i.test(a))).slice(0, 5);
  const fetched = [home, ...await Promise.all(unique.map(url => fetchPage(url)))].filter((p): p is FetchedPage => !!p && new URL(p.url).origin === root.origin);
  const pages: SeoDraftInput["pages"] = [], productFacts: SeoDraftInput["productFacts"] = [];
  const seen = new Set<string>();
  for (const page of fetched) {
    if (seen.has(page.url)) continue;
    seen.add(page.url);
    const meta = htmlToText(page.url, page.html);
    // Prefer the main content so a country selector cannot exhaust the evidence budget.
    const main = page.html.match(/<main\b[^>]*>([\s\S]*?)(?:<\/main>|$)/i)?.[1];
    const content = main ? htmlToText(page.url, main).text : "";
    if (!meta.title || content.trim().length < 100) continue;
    const evidence = { accountId: scope.accountId, contextGeneration: scope.contextGeneration, observedAt: now,
      validUntil: new Date(Date.parse(now) + 86400000).toISOString() };
    pages.push({ ...evidence, evidenceId: `page:${pages.length}`, url: page.url, title: meta.title, description: meta.description ?? "", content: content.slice(0,4500) });
    // Public product prose is source material, not independently certified claims or prices.
    if (new URL(page.url).pathname.startsWith("/products/")) productFacts.push({ ...evidence,
      evidenceId: `product:${productFacts.length}`, sourceUrl: page.url, text: content.slice(0, 4500) });
  }
  if (!pages.length || !productFacts.length) throw new Error("The public website did not provide usable page and product text");
  return { pages, productFacts };
}
