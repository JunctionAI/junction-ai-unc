/* Playbooks — keyword ranking, the embedding → RPC path, the keyword fallback, and the prompt block. */

import { beforeEach, describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { embedText, keywordRank, queryTerms, recallPlaybooks, renderPlaybooksForPrompt, type Playbook } from "../playbooks";

let db: FakeSupabase;
const P = (id: string, domain: string, title: string, body: string, tags: string[] = []) => ({ id: `00000000-0000-4000-8000-0000000000${id}`, domain, title, body, tags, source: "content/playbooks/x.md" });

beforeEach(() => {
  db = new FakeSupabase();
  db.seed("playbooks", [
    P("a1", "email", "Welcome flow that converts", "Five to seven emails over fourteen days. The welcome series does most of the heavy lifting for new subscriber conversion.", ["flows", "welcome", "klaviyo"]),
    P("a2", "email", "Abandoned cart recovery", "Three emails beat one. Recover carts with a reminder, proof, then the only nudge.", ["flows", "cart"]),
    P("a3", "paid", "Meta creative testing", "Test concepts not variants. Kill on spend allocation, not ad-level ROAS. Scale winners plus twenty percent.", ["meta", "creative", "testing"]),
    P("a4", "seo", "Keyword tiers", "Start with buyer-intent long tail. Publish daily. Internal links compound.", ["keywords", "content"]),
  ]);
});

describe("keyword fallback", () => {
  it("queryTerms drops stop words and short tokens, stems trailing s", () => {
    expect(queryTerms("How should I fix my welcome emails?")).toEqual(["fix", "welcome", "email"]);
    expect(queryTerms("the and of")).toEqual([]);
  });
  it("ranks title > tags > body, scores normalised to the best hit, zero-score rows dropped", () => {
    const rows = db.rows("playbooks") as { id: string; domain: string; title: string; body: string; tags: string[] }[];
    const out = keywordRank("welcome flow emails", rows, 3);
    expect(out.map((p) => p.title)).toEqual(["Welcome flow that converts", "Abandoned cart recovery"]);
    expect(out[0]).toMatchObject({ domain: "email", score: 1, via: "keyword" });
    expect(out[1].score).toBeLessThan(1);
    expect(keywordRank("quantum physics", rows, 3)).toEqual([]);
  });
});

describe("recallPlaybooks", () => {
  it("with no embedder (no OPENAI_API_KEY) → keyword path, domain filter honoured", async () => {
    const out = await recallPlaybooks("creative testing on meta", ["paid"], 3, { db, embed: async () => null });
    expect(out.map((p) => p.title)).toEqual(["Meta creative testing"]);
    expect(db.lastCall("playbooks", "select").filters).toEqual([{ kind: "in", column: "domain", value: ["paid"] }]);
    // unknown domains are ignored rather than failing
    expect((await recallPlaybooks("keyword tiers", ["nope" as never], 3, { db, embed: async () => null })).map((p) => p.title)).toEqual(["Keyword tiers"]);
  });
  it("with an embedding → match_playbooks RPC, tags re-attached, similarity as score", async () => {
    const vec = Array.from({ length: 1536 }, () => 0.01);
    db.rpcs.match_playbooks = (args) => {
      expect(args.query_embedding).toEqual(vec);
      expect(args.match_count).toBe(2);
      expect(args.domains).toEqual(["email"]);
      return [{ id: `00000000-0000-4000-8000-0000000000a2`, domain: "email", title: "Abandoned cart recovery", body: "…", similarity: 0.8123 }];
    };
    const out = await recallPlaybooks("carts", ["email"], 2, { db, embed: async () => vec });
    expect(out).toEqual([{ id: `00000000-0000-4000-8000-0000000000a2`, domain: "email", title: "Abandoned cart recovery", body: "…", tags: ["flows", "cart"], score: 0.81, via: "embedding" }]);
  });
  it("RPC returning nothing (no embeddings stored yet) or failing → keyword fallback, never a throw", async () => {
    db.rpcs.match_playbooks = () => [];
    let out = await recallPlaybooks("welcome flow", null, 2, { db, embed: async () => [1] });
    expect(out[0]).toMatchObject({ title: "Welcome flow that converts", via: "keyword" });
    delete db.rpcs.match_playbooks; // unknown rpc → the fake throws
    out = await recallPlaybooks("welcome flow", null, 2, { db, embed: async () => [1] });
    expect(out[0].via).toBe("keyword");
  });
  it("no database or blank query → []", async () => {
    expect(await recallPlaybooks("welcome", null, 3, { db: null })).toEqual([]);
    expect(await recallPlaybooks("   ", null, 3, { db, embed: async () => null })).toEqual([]);
  });
});

describe("embedText", () => {
  it("null without a key; posts the OpenAI embeddings shape with a key; null on any failure", async () => {
    expect(await embedText("hi", {})).toBeNull();
    const calls: { url: string; body: Record<string, unknown>; auth: string | undefined }[] = [];
    const vec = Array.from({ length: 1536 }, (_, i) => i / 1536);
    const fetchOk = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)), auth: (init?.headers as Record<string, string>).authorization });
      return new Response(JSON.stringify({ data: [{ embedding: vec }] }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await embedText("hello", { OPENAI_API_KEY: "sk-test", OPENAI_BASE_URL: "https://x.test/v1/" }, fetchOk)).toEqual(vec);
    expect(calls[0]).toEqual({ url: "https://x.test/v1/embeddings", body: { model: "text-embedding-3-small", input: "hello", dimensions: 1536 }, auth: "Bearer sk-test" });
    const fetch500 = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    expect(await embedText("hello", { OPENAI_API_KEY: "sk-test" }, fetch500)).toBeNull();
    const fetchThrows = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    expect(await embedText("hello", { OPENAI_API_KEY: "sk-test" }, fetchThrows)).toBeNull();
  });
});

describe("renderPlaybooksForPrompt", () => {
  const pb = (title: string, body: string, domain = "email", tags: string[] = []): Playbook => ({ id: title, domain: domain as Playbook["domain"], title, body, tags, score: 1, via: "keyword" });
  it("empty in → empty string; otherwise a header that says METHODS not numbers, one ## per card", () => {
    expect(renderPlaybooksForPrompt([])).toBe("");
    const out = renderPlaybooksForPrompt([pb("A", "Body a", "email", ["x", "y"]), pb("B", "Body b", "paid")]);
    expect(out.startsWith("JUNCTION PLAYBOOKS (how we work — methods to draw on, NOT a source of numbers")).toBe(true);
    expect(out).toContain("\n\n## A [email · x, y]\nBody a");
    expect(out).toContain("\n\n## B [paid]\nBody b");
  });
  it("caps per-card and whole-block size with an ellipsis rather than a silent drop", () => {
    const long = pb("Long", "word ".repeat(2000));
    const out = renderPlaybooksForPrompt([long, pb("Second", "short")], { perPlaybookChars: 100, maxChars: 280 });
    expect(out).toContain("…");
    expect(out.length).toBeLessThanOrEqual(280);
    expect(out).not.toContain("## Second"); // no room left — truncated, not appended
  });
});

describe("content/playbooks", () => {
  it("every card parses, has a valid domain and unique (domain,title), and covers the required domains", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const path = await import("node:path");
    const { parsePlaybookMarkdown, PLAYBOOK_DOMAINS } = await import("../playbooks");
    const root = path.resolve(__dirname, "../../../../content/playbooks");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = path.join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (n.endsWith(".md")) files.push(p);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThanOrEqual(15);
    const seen = new Set<string>();
    const domains = new Set<string>();
    for (const f of files) {
      const rel = path.relative(root, f);
      const pb = parsePlaybookMarkdown(readFileSync(f, "utf8"), rel);
      expect(rel.startsWith(`${pb.domain}/`), `${rel} lives in the wrong folder for domain ${pb.domain}`).toBe(true);
      const key = `${pb.domain}/${pb.title}`;
      expect(seen.has(key), `duplicate ${key}`).toBe(false);
      seen.add(key);
      domains.add(pb.domain);
      expect(pb.tags.length, rel).toBeGreaterThan(0);
      expect(pb.body.length, rel).toBeLessThan(6000);
      // Junction's methods only — no client-confidential names or client figures
      expect(pb.body, rel).not.toMatch(/\b(DBH|AVGAR|Avgar|Deep Blue|Home Invasion|Aerspan|Rory|Unity MMA)\b/);
    }
    for (const d of ["email", "paid", "seo", "content", "sales", "analytics", "strategy"]) expect(domains.has(d), `no playbooks in ${d}`).toBe(true);
    expect(PLAYBOOK_DOMAINS).toHaveLength(7);
  });
  it("parsePlaybookMarkdown rejects missing frontmatter, bad domains, short bodies", async () => {
    const { parsePlaybookMarkdown } = await import("../playbooks");
    expect(() => parsePlaybookMarkdown("no frontmatter", "x.md")).toThrow(/x\.md: missing frontmatter/);
    expect(() => parsePlaybookMarkdown(`---\ndomain: cooking\ntitle: T\n---\n${"a".repeat(300)}`, "x.md")).toThrow(/domain "cooking"/);
    expect(() => parsePlaybookMarkdown(`---\ndomain: email\ntitle: T\n---\nshort`, "x.md")).toThrow(/too short/);
    const ok = parsePlaybookMarkdown(`---\ndomain: email\ntitle: "Quoted title"\ntags: [A, b-c]\nsource: skills/X.md\n---\n${"body ".repeat(60)}`);
    expect(ok).toMatchObject({ domain: "email", title: "Quoted title", tags: ["a", "b-c"], source: "skills/X.md" });
  });
});
