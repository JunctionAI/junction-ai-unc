import { describe, expect, it } from "vitest";
import { allowedNumbersFrom, findBannedPhrases, findUnsupportedNumbers, parseArtifactReply, validateArtifactObject } from "../validate";
import { firstLines, markdownToPlain, parseInline, parseMarkdown } from "../markdown";

const GOOD = { kind: "post_set", title: "3 founder posts: shipping from Auckland", body: "Three posts drafted from the site profile and 3 customer questions.", items: [{ title: "Does it ship to AU?", body: "Yes. Here is what it costs us.", meta: { angle: "question" } }], evidence: [{ source: "site_profile", ref: "ships from Auckland" }] };
const allowed = allowedNumbersFrom([{ name: "Acme", products: ["Omega 3"], signals: ["Founded in 2019"] }, ["[fact] 40% of orders are repeat"]], { now: new Date("2026-09-03T00:00:00Z") });

describe("parseArtifactReply", () => {
  it("accepts a clean object (also fenced), normalises items, keeps evidence", () => {
    const r = parseArtifactReply(`\`\`\`json\n${JSON.stringify(GOOD)}\n\`\`\``, { kind: "post_set", maxItems: 3, allowedNumbers: allowed });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.artifact.items).toHaveLength(1);
      expect(r.artifact.items![0]).toEqual({ title: "Does it ship to AU?", body: "Yes. Here is what it costs us.", meta: { angle: "question" } });
      expect(r.artifact.evidence).toEqual([{ source: "site_profile", ref: "ships from Auckland" }]);
    }
  });

  it("rejects: not JSON, wrong kind, missing title, empty body, too many items, a list kind with no items", () => {
    expect(parseArtifactReply("", { kind: "post_set" })).toEqual({ ok: false, reason: "empty reply" });
    expect(parseArtifactReply("just prose", { kind: "post_set" })).toEqual({ ok: false, reason: "reply is not valid JSON" });
    expect(parseArtifactReply(JSON.stringify({ ...GOOD, kind: "email" }), { kind: "post_set" })).toEqual({ ok: false, reason: 'kind "email" is not the expected "post_set"' });
    expect(parseArtifactReply(JSON.stringify({ ...GOOD, title: "" }), { kind: "post_set" })).toEqual({ ok: false, reason: "title missing" });
    expect(parseArtifactReply(JSON.stringify({ ...GOOD, body: "   " }), { kind: "post_set" })).toEqual({ ok: false, reason: "body missing" });
    expect(parseArtifactReply(JSON.stringify({ ...GOOD, items: [GOOD.items[0], GOOD.items[0]] }), { kind: "post_set", maxItems: 1 })).toEqual({ ok: false, reason: "2 items, more than the 1 allowed" });
    expect(parseArtifactReply(JSON.stringify({ ...GOOD, items: [] }), { kind: "post_set" })).toEqual({ ok: false, reason: "a post_set needs at least one item" });
    expect(parseArtifactReply(JSON.stringify({ kind: "generic", title: "t", body: "short" }), { kind: "generic" })).toEqual({ ok: false, reason: "body is too short (5 chars)" });
  });

  it("rejects an invented number anywhere in the text, accepts numbers from the evidence, counts, the year and k-suffixes", () => {
    const bad = parseArtifactReply(JSON.stringify({ ...GOOD, items: [{ title: "We serve 1,200 customers", body: "x" }] }), { kind: "post_set", allowedNumbers: allowed });
    expect(bad).toEqual({ ok: false, reason: "numbers not in the evidence: 1,200" });
    const ok = parseArtifactReply(JSON.stringify({ ...GOOD, body: "Founded in 2019; 40% repeat; 3 posts for 2026.", items: [{ title: "Omega 3", body: "Ships in 2 days." }] }), { kind: "post_set", allowedNumbers: allowed });
    expect(ok.ok).toBe(true);
    expect(findUnsupportedNumbers("we did 60k last month and 40% repeat", allowed)).toEqual(["60k"]);
    expect(findUnsupportedNumbers("40,000 customers", allowedNumbersFrom([{ baseline: 40000 }]))).toEqual([]);
  });

  it("rejects banned phrases; skips the numbers check when allowedNumbers is null (n8n)", () => {
    expect(parseArtifactReply(JSON.stringify({ ...GOOD, body: "This will 10x your sales overnight." }), { kind: "post_set" })).toEqual({ ok: false, reason: "banned phrase: 10x" });
    expect(findBannedPhrases("A set-and-forget, game-changer of a hustle")).toEqual(["set-and-forget", "game-changer", "hustle"]);
    expect(validateArtifactObject({ ...GOOD, body: "We shipped 9,999 orders." }, { kind: "post_set", allowedNumbers: null }).ok).toBe(true);
  });
});

describe("markdown", () => {
  it("parses headings, paragraphs, lists, quotes, rules and inline runs", () => {
    const blocks = parseMarkdown("# Title\n\nA **bold** line with *em* and `code`.\n\n- one\n- two\n  wrapped\n\n1. first\n2. second\n\n> quoted\n\n---\n");
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "list", "list", "quote", "rule"]);
    expect(parseInline("A **bold** line with *em* and `code`.")).toEqual([
      { kind: "text", text: "A " },
      { kind: "bold", text: "bold" },
      { kind: "text", text: " line with " },
      { kind: "em", text: "em" },
      { kind: "text", text: " and " },
      { kind: "code", text: "code" },
      { kind: "text", text: "." },
    ]);
    const list = blocks[2];
    expect(list.type === "list" && list.items.map((i) => i.map((r) => r.text).join(""))).toEqual(["one", "two wrapped"]);
    expect(markdownToPlain("# T\n\n- a\n- b")).toBe("T\n\n• a\n• b");
    expect(firstLines("# Heading\n\n**Bold** start of body\nmore", 2)).toBe("Heading · Bold start of body");
  });
});
