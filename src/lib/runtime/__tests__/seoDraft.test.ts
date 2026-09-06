import { expect, it, vi } from "vitest";
import { produceSeoDraft, type SeoDraftInput } from "../seoDraft";
import type { Artifact } from "../types";

function fixture() {
  const scope = { accountId: "a", contextGeneration: 1, market: "US" as const, cycleId: "c" };
  const source = { accountId: "a", contextGeneration: 1, observedAt: "2026-09-06T01:00:00Z", validUntil: "2026-09-07T01:00:00Z" };
  const input: SeoDraftInput = { ...scope, now: "2026-09-06T02:00:00Z", prepareArticles: true, preparePageEdits: true,
    keywords: [{ contextGeneration: 1, market: "US", artifact: { id: "k", runId: "r", accountId: "a", kind: "keyword_list", status: "draft", createdAt: "2026-09-06T01:00:00Z", items: [{ title: "golf travel bag", body: "A search hypothesis" }] } as Artifact }],
    pages: [{ ...source, evidenceId: "page", url: "https://example.com/product", title: "Travel case", description: "A case for golf travel", content: "Product details" }, { ...source, evidenceId: "guide", url: "https://example.com/blogs/guide", title: "Guide", description: "Guide", content: "Choosing a case" }],
    productFacts: [{ ...source, evidenceId: "fact", sourceUrl: "https://example.com/product", text: "A case for golf travel. Check the product details before choosing." }] };
  const reply = { summary: "A draft buying guide and a clearer product description are ready for review.",
    articles: [{ intent: "choosing", targetUrl: "https://example.com/blogs/guide", title: "Choosing a golf travel case", body: "Choosing a travel case starts with checking how you plan to use it. Read the product details and compare them with your own equipment before deciding. ".repeat(9), evidenceRefs: ["artifact:k:0", "fact"], internalLinks: [{ url: "https://example.com/product", anchor: "View the travel case" }] }],
    pageEdits: [{ url: "https://example.com/product", title: "Golf travel case", description: "Explore a case for golf travel and review the product details before choosing.", rationale: "A clearer description names the product category directly.", evidenceRefs: ["artifact:k:0", "page"] }] };
  const model = vi.fn(async () => JSON.stringify(reply));
  return { input, reply, model };
}
it("produces actual draft prose and existing-page edits, with no publishing", async () => {
  const { input, model } = fixture(); const result = await produceSeoDraft(input, model);
  expect(result).toHaveProperty("artifact");
  if ("artifact" in result) { expect(result.artifact.items).toHaveLength(2); expect(result.artifact.meta?.publishEnabled).toBe(false); }
  expect(model).toHaveBeenCalledTimes(1);
});
it("accepts a whole JSON fence without another model call", async () => {
  const { input, reply } = fixture();
  expect(await produceSeoDraft(input, async () => "```json\n" + JSON.stringify(reply) + "\n```")).toHaveProperty("artifact");
});
it.each(["missing", "foreign", "expired"])("refuses %s evidence before spending", async kind => {
  const { input, model } = fixture();
  if (kind === "missing") input.productFacts = [];
  if (kind === "foreign") input.productFacts[0].accountId = "other";
  if (kind === "expired") input.pages[0].validUntil = input.now;
  expect(await produceSeoDraft(input,model)).toHaveProperty("needs"); expect(model).not.toHaveBeenCalled();
});
it.each(["link", "reference", "duplicate", "off", "outline"])("rejects invalid output: %s", async kind => {
  const { input, reply, model } = fixture();
  if (kind === "link") reply.articles[0].internalLinks[0].url = "https://evil.test";
  if (kind === "reference") reply.articles[0].evidenceRefs = ["made-up"];
  if (kind === "duplicate") reply.articles.push(reply.articles[0]);
  if (kind === "off") input.prepareArticles = false;
  if (kind === "outline") reply.articles[0].body = "Write a buying guide.";
  expect(await produceSeoDraft(input,model)).toHaveProperty("needs");
});
