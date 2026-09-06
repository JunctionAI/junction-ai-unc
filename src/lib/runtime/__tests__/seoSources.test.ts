import { expect, it, vi } from "vitest";
import { readSeoSiteSources } from "../seoSources";
import { htmlToText, safeFetchPage } from "../../unc/scan";

const scope = { accountId: "a", contextGeneration: 1, market: "US" as const, cycleId: "c" };
it("never turns an unfinished script into page evidence", () => {
  expect(htmlToText("https://example.com", '<title>Store</title><script>window.fake="invented product claim"').text).not.toContain("invented");
});
it("rejects unbounded source fetch sizes before making a request", async () => {
  const request = vi.fn();
  expect(await safeFetchPage("https://example.com", { maxBytes: 1_000_001, request })).toBeNull();
  expect(request).not.toHaveBeenCalled();
});
it("reads only bounded same-origin linked pages and prefers main content", async () => {
  const text = "Observed product material and useful details. ".repeat(10);
  const fetchPage = vi.fn(async (url: string) => ({ url, html: `<title>Product</title><nav>junk</nav><main>${text}</main><a href="/products/travel">product</a><a href="https://foreign.test/products/x">foreign</a>` }));
  const sources = await readSeoSiteSources(scope, "https://example.com/", "2026-09-06T04:00:00Z", fetchPage);
  expect(fetchPage).toHaveBeenCalledTimes(2);
  expect(sources.productFacts[0].text).not.toContain("junk");
  expect(sources.productFacts[0].accountId).toBe("a");
  expect(sources.pages).toHaveLength(2);
});
it("refuses a redirect off the verified website", async () => {
  await expect(readSeoSiteSources(scope, "https://example.com", "2026-09-06T04:00:00Z",
    async () => ({ url: "https://other.test", html: "" }))).rejects.toThrow("origin");
});
