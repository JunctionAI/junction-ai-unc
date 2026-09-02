/* The extractor's validator over adversarial model output, the deterministic paths, and the
   no-model no-op. The founder's turns are the only evidence a transcript offers. */

import { describe, expect, it } from "vitest";
import { approvalMemory, candidatesFrom, contentWords, extractJson, extractMemories, profileMemories, renderTranscript, reviewChangeLessons, stem, traceOverlap, validateCandidate, type TranscriptTurn } from "../extract";
import { listMemories } from "../memory";
import { ACCT, brainDb, clock, scriptedLlm } from "./helpers";

const TRANSCRIPT: TranscriptTurn[] = [
  { role: "assistant", content: "I'd suggest we launch a 25% off welcome offer on email and shift NZ$40 a day into Meta retargeting." },
  { role: "user", content: "No — we never discount below 15%, our margin is only 42%. Also the Black Friday drop is on 27 November 2026 and my sister Mia runs our packaging. Try the email idea without the discount." },
  { role: "assistant", content: "Understood. I'll draft a no-discount welcome flow and hold the Meta move for your okay." },
];

describe("traceability", () => {
  it("stems lightly and drops stopwords", () => {
    expect(stem("discounts")).toBe("discount");
    expect(stem("shipping")).toBe("ship");
    expect(stem("decided")).toBe("decid");
    expect(stem("15%")).toBe("15%");
    expect(contentWords("We never discount below 15% on the site")).toEqual(["never", "discount", "below", "15%", "site"]);
  });

  it("overlap is the share of the candidate's content words found in the source", () => {
    const src = "we never discount below 15%, our margin is only 42%";
    expect(traceOverlap("Never discounts below 15%", src)).toBe(1);
    expect(traceOverlap("Gross margin is 42%", src)).toBeCloseTo(2 / 3);
    expect(traceOverlap("Launch a TikTok channel in March", src)).toBe(0);
  });
});

describe("validateCandidate — adversarial model output", () => {
  const evidence = renderTranscript(TRANSCRIPT).founderText;

  it("accepts a constraint the founder stated, phrased as a durable rule", () => {
    const v = validateCandidate({ kind: "constraint", text: "Never discounts below 15%.", confidence: 0.9, importance: 5, tags: ["pricing"] }, evidence);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.candidate).toMatchObject({ kind: "constraint", text: "Never discounts below 15%.", confidence: 0.9, importance: 5, tags: ["pricing"] });
  });

  it("rejects an invented fact (nothing in the founder's words supports it)", () => {
    const v = validateCandidate({ kind: "fact", text: "The business sells premium dog food in Australia.", confidence: 0.9, importance: 4 }, evidence);
    expect(v).toEqual({ ok: false, rejected: { text: "The business sells premium dog food in Australia.", reason: "untraceable" } });
  });

  it("rejects Unc's own suggestion presented as a decision — the founder never said it", () => {
    const v = validateCandidate({ kind: "decision", text: "Shift NZ$40 a day into Meta retargeting.", confidence: 0.8, importance: 4 }, evidence);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.rejected.reason).toBe("untraceable");
    // …and a fake quote that isn't in the founder's words doesn't rescue it
    const q = validateCandidate({ kind: "decision", text: "Shift NZ$40 a day into Meta retargeting.", quote: "shift NZ$40 a day into Meta retargeting" }, evidence);
    expect(q.ok).toBe(false);
  });

  it("a verbatim founder quote rescues a paraphrase that scores under the overlap bar", () => {
    const v = validateCandidate({ kind: "relationship", text: "Packaging is handled by a family member.", quote: "my sister Mia runs our packaging" }, evidence);
    expect(v.ok).toBe(true);
    const short = validateCandidate({ kind: "relationship", text: "Packaging is handled by a family member.", quote: "Mia" }, evidence);
    expect(short.ok).toBe(false); // too short to count as a quote
  });

  it("parses event dates to ISO and rejects events without a real date", () => {
    const ok = validateCandidate({ kind: "event", text: "Black Friday drop", happens_at: "2026-11-27" }, evidence);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.candidate.happens_at).toBe("2026-11-27T00:00:00.000Z");
    const full = validateCandidate({ kind: "event", text: "Black Friday drop", happens_at: "2026-11-27T10:00:00+13:00" }, evidence);
    if (full.ok) expect(full.candidate.happens_at).toBe("2026-11-26T21:00:00.000Z");
    expect(validateCandidate({ kind: "event", text: "Black Friday drop" }, evidence)).toMatchObject({ ok: false, rejected: { reason: "event_without_date" } });
    expect(validateCandidate({ kind: "event", text: "Black Friday drop", happens_at: "late November" }, evidence)).toMatchObject({ ok: false, rejected: { reason: "bad_date" } });
    expect(validateCandidate({ kind: "event", text: "Black Friday drop", happens_at: "2026-13-45" }, evidence)).toMatchObject({ ok: false, rejected: { reason: "bad_date" } });
  });

  it("rejects unknown kinds, junk shapes and out-of-range text; clamps numbers", () => {
    expect(validateCandidate("nope", evidence)).toMatchObject({ ok: false, rejected: { reason: "not_object" } });
    expect(validateCandidate({ kind: "vibe", text: "Never discounts below 15%" }, evidence)).toMatchObject({ ok: false, rejected: { reason: "bad_kind" } });
    expect(validateCandidate({ kind: "fact", text: "15%" }, evidence)).toMatchObject({ ok: false, rejected: { reason: "bad_text" } });
    expect(validateCandidate({ kind: "fact", text: "margin ".repeat(60) }, evidence)).toMatchObject({ ok: false, rejected: { reason: "bad_text" } });
    const v = validateCandidate({ kind: "fact", text: "Margin is only 42%.", confidence: 9, importance: -2, tags: ["a", 1, "b", "c", "d", "e", "f"] }, evidence);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.candidate).toMatchObject({ confidence: 1, importance: 1, tags: ["a", "b", "c", "d", "e"] });
  });

  it("extractJson tolerates fences and prose around the object; candidatesFrom reads both shapes", () => {
    expect(extractJson('```json\n{"memories":[]}\n```')).toEqual({ memories: [] });
    expect(extractJson('Here you go: {"memories":[{"kind":"fact","text":"x"}]} — done')).toEqual({ memories: [{ kind: "fact", text: "x" }] });
    expect(extractJson("nothing here")).toBeNull();
    expect(candidatesFrom([{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(candidatesFrom({ memories: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    expect(candidatesFrom({ other: 1 })).toEqual([]);
  });
});

describe("extractMemories", () => {
  it("transcript → the model's candidates, validated, persisted (the suggestion drops, the founder's facts land)", async () => {
    const db = brainDb();
    const llm = scriptedLlm({
      memories: [
        { kind: "constraint", text: "Never discounts below 15%.", confidence: 0.95, importance: 5, tags: ["pricing"], quote: "we never discount below 15%" },
        { kind: "fact", text: "Gross margin is only 42%.", confidence: 0.9, importance: 4 },
        { kind: "event", text: "Black Friday drop.", happens_at: "2026-11-27", importance: 4 },
        { kind: "relationship", text: "Mia (the founder's sister) runs packaging.", importance: 3 },
        { kind: "decision", text: "Shift NZ$40 a day into Meta retargeting.", importance: 4 }, // Unc's idea — must not become a memory
        { kind: "fact", text: "The brand sells premium dog food.", importance: 3 }, // invented
        { kind: "event", text: "Christmas campaign." }, // no date
      ],
    });
    const r = await extractMemories(db, { accountId: ACCT, source: "chat", sourceRef: "chat:corner:2026-09-02", transcript: TRANSCRIPT }, { llm, embed: null, now: clock().now });
    expect(r.author).toBe("llm");
    expect(r.candidates).toBe(7);
    expect(r.accepted.map((m) => m.kind).sort()).toEqual(["constraint", "event", "fact", "relationship"]);
    expect(r.rejected.map((x) => x.reason)).toEqual(["untraceable", "untraceable", "event_without_date"]);
    expect(r.accepted.find((m) => m.kind === "event")?.happensAt).toBe("2026-11-27T00:00:00.000Z");
    expect(db.rows("memories").every((row) => row.source === "chat" && row.source_ref === "chat:corner:2026-09-02")).toBe(true);
    // the prompt carried both roles labelled, and today's date for relative-date resolution
    expect(llm.prompts[0].user).toContain("FOUNDER: No — we never discount");
    expect(llm.prompts[0].user).toContain("UNC (assistant): I'd suggest");
    expect(llm.prompts[0].user).toContain("TODAY: 2026-09-02");
    expect(llm.prompts[0].system).toContain("NEVER record the assistant's (Unc's) suggestions");
  });

  it("running the same transcript twice merges instead of duplicating", async () => {
    const db = brainDb();
    const reply = { memories: [{ kind: "constraint", text: "Never discounts below 15%.", confidence: 0.9, importance: 5 }] };
    await extractMemories(db, { accountId: ACCT, source: "chat", transcript: TRANSCRIPT }, { llm: scriptedLlm(reply), embed: null });
    const r2 = await extractMemories(db, { accountId: ACCT, source: "chat", transcript: TRANSCRIPT }, { llm: scriptedLlm(reply), embed: null });
    expect(r2.merged).toBe(1);
    expect(db.rows("memories")).toHaveLength(1);
  });

  it("no model configured → transcript is a deterministic no-op; a model failure is swallowed the same way", async () => {
    const db = brainDb();
    const none = await extractMemories(db, { accountId: ACCT, source: "chat", transcript: TRANSCRIPT }, { llm: null, embed: null });
    expect(none).toEqual({ author: "none", candidates: 0, accepted: [], merged: 0, rejected: [] });
    const notConfigured = await extractMemories(db, { accountId: ACCT, source: "chat", transcript: TRANSCRIPT }, { llm: scriptedLlm(null), embed: null });
    expect(notConfigured.author).toBe("none");
    const logs: string[] = [];
    const failing = { complete: async () => Promise.reject(new Error("refusal")) };
    const failed = await extractMemories(db, { accountId: ACCT, source: "chat", transcript: TRANSCRIPT }, { llm: failing, embed: null, log: (e) => logs.push(e) });
    expect(failed.author).toBe("none");
    expect(logs).toContain("brain.extract_llm_failed");
    expect(db.rows("memories")).toHaveLength(0);
    // unparseable model text → nothing accepted, nothing thrown
    const junk = await extractMemories(db, { accountId: ACCT, source: "chat", transcript: TRANSCRIPT }, { llm: scriptedLlm("I cannot help with that."), embed: null });
    expect(junk).toMatchObject({ author: "llm", candidates: 0, accepted: [] });
  });

  it("a transcript with no founder turn yields nothing (and never calls the model)", async () => {
    const db = brainDb();
    const llm = scriptedLlm({ memories: [] });
    const r = await extractMemories(db, { accountId: ACCT, source: "chat", transcript: [{ role: "assistant", content: "Morning. One decision is waiting." }] }, { llm, embed: null });
    expect(r.author).toBe("none");
    expect(llm.prompts).toHaveLength(0);
  });

  it("scan profile → deterministic facts (no model call), confidence from the scan's own", async () => {
    const db = brainDb();
    const llm = scriptedLlm({ memories: [] });
    const profile = { name: "Example Co", oneLiner: "Sells examples", category: "DTC", products: ["Widget", "Gadget"], audience: "Founders", voice: { tone: "warm", phrases: ["kia ora"] }, market: { region: "AU", competitorsMentioned: ["Acme"] }, signals: ["fast shipping"], confidence: "medium" as const, sources: ["https://example.com"] };
    const r = await extractMemories(db, { accountId: ACCT, source: "scan", sourceRef: "https://example.com", profile }, { llm, embed: null });
    expect(llm.prompts).toHaveLength(0);
    expect(r.author).toBe("deterministic");
    expect(r.accepted.map((m) => `${m.kind}: ${m.text}`)).toEqual([
      "fact: Example Co: Sells examples",
      "fact: Business category: DTC.",
      "fact: Products on the site: Widget, Gadget.",
      "fact: Audience the site speaks to: Founders.",
      'preference: Brand voice: warm; phrases they use: "kia ora".',
      "fact: Primary market region: AU.",
      "relationship: Competitors the site mentions: Acme.",
      "fact: Signals on the site: fast shipping.",
    ]);
    expect(r.accepted.every((m) => m.confidence === 0.7 && m.source === "scan")).toBe(true);
    expect(profileMemories(ACCT, { confidence: "low" }, null)).toEqual([]); // nothing known → nothing remembered
  });

  it("approval → one decision memory; holds weigh more", () => {
    const held = approvalMemory(ACCT, { id: "ap1", title: "Move NZ$20/day to retargeting", detail: "ROAS 3.1 on the retargeting set", routineId: "D02-W01", routineName: "Daily paid decisioning", decision: "held" }, "approval:ap1");
    expect(held).toMatchObject({ kind: "decision", source: "receipt", importance: 4, confidence: 0.95, tags: ["approval", "held", "d02-w01"] });
    expect(held.text).toBe('Held: "Move NZ$20/day to retargeting" (Daily paid decisioning) — ROAS 3.1 on the retargeting set');
    expect(approvalMemory(ACCT, { title: "Send the welcome email", decision: "approved" }, null)).toMatchObject({ importance: 3, text: 'Approved: "Send the welcome email" (a routine)' });
  });

  it("review → model lessons when configured, else each change's why becomes a lesson", async () => {
    const db = brainDb();
    const review = { id: "rv1", weekStart: "2026-08-31", body: "What worked: the welcome flow held a 41% open rate. What I'm changing: pausing the TikTok routine — 0 views on 4 posts. One ask: can you okay the price test?", changes: [{ action: "disable", routineId: "D03-W02", why: "0 views on 4 posts this week" }] };
    const det = await extractMemories(db, { accountId: ACCT, source: "self_review", sourceRef: "self_review:rv1", review }, { llm: null, embed: null });
    expect(det.author).toBe("deterministic");
    expect(det.accepted.map((m) => m.text)).toEqual(["disable D03-W02: 0 views on 4 posts this week"]);
    expect(reviewChangeLessons(ACCT, { body: "x", changes: [] }, null)).toEqual([]);

    const db2 = brainDb();
    const llm = scriptedLlm({ memories: [{ kind: "lesson", text: "The welcome flow holds a 41% open rate.", importance: 3 }, { kind: "lesson", text: "TikTok got 0 views on 4 posts; paused.", importance: 3 }, { kind: "fact", text: "The founder loves Pinterest.", importance: 2 }] });
    const live = await extractMemories(db2, { accountId: ACCT, source: "self_review", review }, { llm, embed: null });
    expect(live.author).toBe("llm");
    expect(live.accepted.map((m) => m.kind)).toEqual(["lesson", "lesson"]);
    expect(live.rejected).toEqual([{ text: "The founder loves Pinterest.", reason: "untraceable" }]);
    expect((await listMemories(db2, ACCT)).every((m) => m.source === "self_review")).toBe(true);
  });
});
