/* Onboarding answers → memories (pure), the wire coercion, and POST /api/unc/onboarding
   (session-bound; demo → { fallback: true }). */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { richState } from "@/lib/db/__tests__/fixtures";
import { clearLlmEnv, restoreLlmEnv } from "@/lib/llm/__tests__/env";
import { onboardingAnswersFromState } from "@/components/platform/useOnboardingMemories";
import { coerceOnboardingAnswers, onboardingMemories, onboardingSourceRef } from "../onboarding";
import { ACCT, brainDb } from "./helpers";

const sessionMock = vi.hoisted(() => ({ requireAccountSession: vi.fn() }));
vi.mock("@/lib/db/session", () => ({ requireAccountSession: sessionMock.requireAccountSession }));

import { POST } from "@/app/api/unc/onboarding/route";

// The route embeds through process.env when OPENAI_API_KEY is set — the dev shell may carry one.
beforeAll(() => clearLlmEnv());
afterAll(() => restoreLlmEnv());

const post = (body: unknown) => POST(new Request("http://unc.test/api/unc/onboarding", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));

describe("onboardingMemories", () => {
  it("turns the founder's answers into facts / constraints / a decision / relationships — nothing inferred", () => {
    const S = richState();
    const answers = onboardingAnswersFromState(S);
    const ms = onboardingMemories(ACCT, answers);
    expect(ms.every((m) => m.source === "onboarding" && m.sourceRef === onboardingSourceRef(ACCT) && m.confidence === 0.95)).toBe(true);
    expect(ms.map((m) => `${m.kind}|${m.importance}|${m.text}`)).toEqual([
      "fact|5|Governing goal: A$90,000 MRR by 2026-12-31.",
      "fact|4|Checkpoint goals (never sacrificed for the governing goal): 40k engaged followers; 80 qualified leads/mo.",
      "fact|4|Baseline when we started (stated at onboarding): A$41,000.",
      "constraint|5|Ad spend is capped at A$5,200 per month (about A$173 a day).",
      "constraint|5|The founder has 12 hours a week for marketing — plan their part inside that.",
      "preference|3|Reinvestment stance: aggressive.",
      "fact|4|Gross margin is about 55%.",
      "fact|4|Founder strengths: Video, Paid media, SEO.",
      "fact|3|Platforms already in use: TikTok, LinkedIn, Google (Search & Ads).",
      "decision|4|Agreed the plan at onboarding: Paid-led scale (beliefs: Buy learning fast + Brand before sales; broad breadth; pace Sprint · 2 weeks).",
      "relationship|3|Ana — Founder; approves Content, Sales.",
      "relationship|3|Ben — Marketing.",
      "fact|3|Website: https://example.com.",
      "fact|2|Social handles: @example https://tiktok.com/@example.",
    ]);
    expect(ms.find((m) => m.kind === "constraint")?.tags).toEqual(["budget", "guardrail"]);
  });

  it("unknowns yield nothing: a null baseline is not a memory, an empty team adds none", () => {
    const ms = onboardingMemories(ACCT, { goalTitle: "NZ$40,000 MRR", deadline: "", currency: "NZD", baselineNum: null, budgetMo: 1500, hoursWk: 4, strengths: [], platforms: [], posture: "" });
    expect(ms.map((m) => m.text)).toEqual(["Governing goal: NZ$40,000 MRR.", "Ad spend is capped at NZ$1,500 per month (about NZ$50 a day).", "The founder has 4 hours a week for marketing — plan their part inside that."]);
  });

  it("coerceOnboardingAnswers: goalTitle required, types enforced, arrays capped", () => {
    expect(coerceOnboardingAnswers(null)).toBeNull();
    expect(coerceOnboardingAnswers({ goalTitle: "" })).toBeNull();
    const a = coerceOnboardingAnswers({ goalTitle: "x", baselineNum: "28400", budgetMo: 1500, hoursWk: "4", strengths: ["Video", 3, null], team: [{ name: "Ana", role: 1, areas: ["Content"] }, "junk"] });
    expect(a).toMatchObject({ goalTitle: "x", baselineNum: null, budgetMo: 1500, strengths: ["Video"], team: [{ name: "Ana", role: "", areas: ["Content"] }], currency: "NZD" });
    expect(Number.isNaN(a!.hoursWk)).toBe(true);
    expect(onboardingMemories(ACCT, a!).some((m) => m.text.includes("hours a week"))).toBe(false); // NaN hours → no memory
  });
});

describe("POST /api/unc/onboarding", () => {
  it("demo mode passes the session's fallback through; bad bodies → 400", async () => {
    sessionMock.requireAccountSession.mockResolvedValue(Response.json({ fallback: true }));
    expect(await (await post({ answers: {} })).json()).toEqual({ fallback: true });
    const db = brainDb();
    sessionMock.requireAccountSession.mockResolvedValue({ userId: "u1", email: null, accountId: ACCT, db, service: db });
    expect((await post("{nope")).status).toBe(400);
    expect((await post({ answers: { deadline: "2026-12-31" } })).status).toBe(400);
  });

  it("writes the memories with the service-role client (idempotent on a second agree)", async () => {
    const db = brainDb();
    sessionMock.requireAccountSession.mockResolvedValue({ userId: "u1", email: null, accountId: ACCT, db, service: db });
    const answers = onboardingAnswersFromState(richState());
    const r1 = await (await post({ answers })).json();
    expect(r1).toEqual({ written: 14, merged: 0, failed: 0 });
    expect(db.rows("memories")).toHaveLength(14);
    const r2 = await (await post({ answers })).json();
    expect(r2).toEqual({ written: 0, merged: 14, failed: 0 });
    expect(db.rows("memories")).toHaveLength(14);
  });
});
