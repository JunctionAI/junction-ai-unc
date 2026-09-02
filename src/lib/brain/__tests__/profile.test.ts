/* account_profiles: get/update merge semantics, decision style from a taste-ledger fixture,
   and the prompt block. */

import { describe, expect, it } from "vitest";
import { ALL_SYSTEMS } from "@/lib/platform/catalog";
import type { ApprovalRecord, TasteEvent } from "@/lib/runtime/types";
import { deriveDecisionStyle, getProfile, refreshDecisionStyle, renderProfileForPrompt, riskAppetite, updateProfile } from "../profile";
import { ACCT, brainDb, clock } from "./helpers";

const R1 = ALL_SYSTEMS[0].id;
const R2 = ALL_SYSTEMS.find((s) => s.cat !== ALL_SYSTEMS[0].cat)!.id;
const CAT1 = ALL_SYSTEMS[0].cat;
const CAT2 = ALL_SYSTEMS.find((s) => s.id === R2)!.cat;

const ev = (action: TasteEvent["action"], routineId: string, i: number): TasteEvent => ({ id: `t${i}`, accountId: ACCT, routineId, action, context: {}, createdAt: `2026-08-2${i}T00:00:00.000Z` });
const ap = (status: ApprovalRecord["status"], routineId: string, createdAt: string, decidedAt?: string, i = 0): ApprovalRecord => ({ id: `a${routineId}${i}`, accountId: ACCT, runId: `r${i}`, routineId, title: "t", status, expiresAt: "2026-12-31T00:00:00.000Z", createdAt, decidedAt });

/** Ten decisions: 7 approved, 3 held (two on CAT1, one on CAT2); plus why_opened/edited noise. */
const LEDGER: TasteEvent[] = [
  ev("approved", R1, 0),
  ev("approved", R1, 1),
  ev("held", R1, 2),
  ev("why_opened", R1, 3),
  ev("approved", R2, 4),
  ev("held", R2, 5),
  ev("edited", R2, 6),
  ev("approved", R2, 7),
  ev("approved", R1, 8),
  ev("held", R1, 9),
  ev("approved", R2, 1),
  ev("approved", R1, 2),
];
const APPROVALS: ApprovalRecord[] = [
  ap("approved", R1, "2026-08-20T09:00:00.000Z", "2026-08-20T10:00:00.000Z", 1), // 1h
  ap("held", R1, "2026-08-21T09:00:00.000Z", "2026-08-21T21:00:00.000Z", 2), // 12h
  ap("approved", R2, "2026-08-22T09:00:00.000Z", "2026-08-23T09:00:00.000Z", 3), // 24h
  ap("pending", R2, "2026-08-24T09:00:00.000Z", undefined, 4),
];

describe("deriveDecisionStyle", () => {
  it("from the taste ledger: approval rate, holds by routine category, median hours from approvals, appetite", () => {
    const d = deriveDecisionStyle(LEDGER, APPROVALS);
    expect(d).toEqual({ approval_rate: 0.7, median_decision_hours: 12, holds_by_kind: { [CAT1]: 2, [CAT2]: 1 }, risk_appetite: "medium", decisions: 10 });
  });

  it("falls back to approval rows when the ledger has no decisions; unknown routines keep their id", () => {
    const d = deriveDecisionStyle([ev("why_opened", R1, 0)], [...APPROVALS, ap("held", "ZZ-99", "2026-08-25T09:00:00.000Z", undefined, 5)]);
    expect(d).toMatchObject({ approval_rate: 0.5, decisions: 4, holds_by_kind: { [CAT1]: 1, "ZZ-99": 1 } });
  });

  it("nothing decided → nulls and a medium (unknown) appetite; thresholds at 0.8 / 0.5 once there are 3+ decisions", () => {
    expect(deriveDecisionStyle([], [])).toEqual({ approval_rate: null, median_decision_hours: null, holds_by_kind: {}, risk_appetite: "medium", decisions: 0 });
    expect(riskAppetite(1, 2)).toBe("medium");
    expect(riskAppetite(0.8, 3)).toBe("high");
    expect(riskAppetite(0.79, 3)).toBe("medium");
    expect(riskAppetite(0.49, 3)).toBe("low");
    expect(deriveDecisionStyle([ev("held", R1, 0), ev("held", R1, 1), ev("held", R2, 2)], []).risk_appetite).toBe("low");
  });
});

describe("getProfile / updateProfile", () => {
  it("null before any write; upsert merges each jsonb block shallowly; founder_notes replaces (null clears)", async () => {
    const db = brainDb();
    const clk = clock();
    expect(await getProfile(db, ACCT)).toBeNull();
    const p1 = await updateProfile(db, ACCT, { tone: { formality: "casual", length: "short" }, cadence: { timezone: "Pacific/Auckland" }, founderNotes: "  Don't email me before 9am.  " }, { now: clk.now });
    expect(p1).toMatchObject({ accountId: ACCT, tone: { formality: "casual", length: "short" }, cadence: { timezone: "Pacific/Auckland" }, founderNotes: "Don't email me before 9am." });
    const p2 = await updateProfile(db, ACCT, { tone: { length: "medium" }, channels: { whatsapp: true } }, { now: clk.now });
    expect(p2.tone).toEqual({ formality: "casual", length: "medium" });
    expect(p2.cadence).toEqual({ timezone: "Pacific/Auckland" });
    expect(p2.channels).toEqual({ whatsapp: true });
    expect(p2.founderNotes).toBe("Don't email me before 9am."); // untouched when the patch omits it
    expect(db.rows("account_profiles")).toHaveLength(1);
    expect(db.lastCall("account_profiles", "upsert").onConflict).toBe("account_id");
    const p3 = await updateProfile(db, ACCT, { founderNotes: null }, { now: clk.now });
    expect(p3.founderNotes).toBeNull();
    expect((await getProfile(db, ACCT))?.tone).toEqual({ formality: "casual", length: "medium" });
  });

  it("refreshDecisionStyle reads the store and writes decision_style", async () => {
    const db = brainDb();
    const store = {
      listTasteEvents: async () => LEDGER,
      listApprovals: async (_a: string, status?: ApprovalRecord["status"]) => APPROVALS.filter((x) => x.status === status),
    };
    const d = await refreshDecisionStyle(db, store, ACCT);
    expect(d.approval_rate).toBe(0.7);
    expect((await getProfile(db, ACCT))?.decisionStyle).toEqual(d);
  });
});

describe("renderProfileForPrompt", () => {
  it("is empty for no profile / an empty profile, and otherwise a short block with the founder's notes verbatim", () => {
    expect(renderProfileForPrompt(null)).toBe("");
    expect(renderProfileForPrompt({ accountId: ACCT, tone: {}, decisionStyle: {}, cadence: {}, channels: {}, founderNotes: null, updatedAt: "" })).toBe("");
    const text = renderProfileForPrompt({
      accountId: ACCT,
      tone: { formality: "casual", length: "short", humour: "dry", directness: "blunt" },
      decisionStyle: deriveDecisionStyle(LEDGER, APPROVALS),
      cadence: { brief_time_local: "07:30", timezone: "Pacific/Auckland", quiet_days: ["Sunday"] },
      channels: { email: true, whatsapp: "+64 21 000 0000", slack: false },
      founderNotes: "Don't email me before 9am. I decide fast if you show the number.",
      updatedAt: "",
    });
    expect(text).toBe(
      [
        "Tone: casual register, short replies, blunt feedback, dry humour is welcome.",
        `Decisions: approves 70% of proposals (10 decisions so far); usually decides within 12h; holds mostly on ${CAT1} (2), ${CAT2} (1); risk appetite medium.`,
        "Cadence: daily brief at 07:30 Pacific/Auckland; quiet on Sunday.",
        "Reach them on email, whatsapp (+64 21 000 0000).",
        'In their own words: "Don\'t email me before 9am. I decide fast if you show the number."',
      ].join("\n"),
    );
    expect(renderProfileForPrompt({ accountId: ACCT, tone: { humour: "none" }, decisionStyle: { median_decision_hours: 0.4 }, cadence: { timezone: "UTC" }, channels: {}, founderNotes: null, updatedAt: "" })).toBe("Tone: no jokes.\nDecisions: usually decides within the hour.\nCadence: timezone UTC.");
  });
});
