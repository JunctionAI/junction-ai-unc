/* applyIntake against the schema-checked fake: the memory mapping, the merge rules (never
   overwrite non-null with null, goal only when none), connector hints, the audit row and
   idempotent replay. */

import { beforeEach, describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { applyIntake, memoriesFromIntake } from "../apply";
import { listActiveMemories } from "../memoryWriter";
import type { IntakePayload } from "../schema";

const ACCT = "00000000-0000-4000-8000-00000000acc1";
const KEY = "00000000-0000-4000-8000-00000000ke71";
const NOW = new Date("2026-09-02T09:00:00.000Z");
let db: FakeSupabase;

const FULL: IntakePayload = {
  business: { name: "Acme Co", website: "https://acme.test", socials: ["@acme"], category: "Supplements", products: ["Omega", "Zinc"], voice_notes: "plain, no hype", market: "NZ + AU" },
  goal: { title: "NZ$60,000 MRR", baseline: 28400, deadline: "2026-12-31", currency: "NZD" },
  resources: { budget_monthly: 3600, hours_weekly: 8, team: [{ name: "Ana", role: "Founder" }] },
  platforms: [{ platform: "shopify", external_ref: "acme.myshopify.com" }, { platform: "klaviyo" }],
  contacts: [{ name: "Sam", role: "Ops", email: "sam@acme.test" }],
  facts: ["Ships from Auckland"],
  preferences: ["Short replies"],
  constraints: ["Never discount the flagship"],
  events: [{ text: "Black Friday launch", at: "2026-11-27" }],
  notes: "Founder is time-poor.",
};

beforeEach(() => {
  db = new FakeSupabase();
  db.now = () => NOW.toISOString();
  db.seed("accounts", [{ id: ACCT, name: "Acme Co", currency: "NZD" }]);
  db.seed("intake_keys", [{ id: KEY, account_id: ACCT, key_hash: "a".repeat(64) }]);
});

describe("memoriesFromIntake (pure mapping)", () => {
  it("maps every field to a kind with the right confidence", () => {
    const m = memoriesFromIntake(FULL, "evt-1");
    const by = (kind: string) => m.filter((x) => x.kind === kind);
    expect(by("fact").map((x) => x.text)).toEqual([
      "The business is called Acme Co.",
      "Website: https://acme.test",
      "Social accounts: @acme",
      "Category: Supplements",
      "Products: Omega, Zinc",
      "Market: NZ + AU",
      "Monthly growth budget: 3600 NZD",
      "Founder hours available per week: 8",
      "Uses shopify (acme.myshopify.com).",
      "Uses klaviyo.",
      "Ships from Auckland",
      "Founder is time-poor.",
    ]);
    expect(by("preference").map((x) => [x.text, x.confidence])).toEqual([
      ["Voice notes from the founder: plain, no hype", 0.6],
      ["Short replies", 0.6],
    ]);
    expect(by("constraint")).toMatchObject([{ text: "Never discount the flagship", confidence: 0.6, importance: 4 }]);
    expect(by("decision")).toMatchObject([{ text: "Goal: NZ$60,000 MRR · baseline 28400 NZD · by 2026-12-31", confidence: 0.9, importance: 5 }]);
    expect(by("relationship").map((x) => x.text)).toEqual(["Ana — Founder is on the team.", "Sam — Ops (sam@acme.test)"]);
    expect(by("event")).toMatchObject([{ text: "Black Friday launch", happens_at: "2026-11-27", confidence: 0.6 }]);
    // structured = 0.9, free text = 0.6, everything from intake with the event ref
    expect(m.every((x) => x.source === "intake" && x.source_ref === "evt-1")).toBe(true);
    expect(m.filter((x) => x.confidence === 0.9).length).toBe(13);
  });
});

describe("applyIntake", () => {
  it("writes memories, profile, goal, resources, team, connectors and the audit row", async () => {
    const out = await applyIntake(db, ACCT, FULL, { keyId: KEY, now: NOW });
    expect(out.replayed).toBe(false);
    expect(out.written).toEqual({ memories: 19, memories_skipped: 0, profile_fields: 6, goal: 1, resource_fields: 5, team_members: 2, connectors: 2 });
    expect(out.warnings).toEqual([]);

    const mems = db.rows("memories");
    expect(mems).toHaveLength(19);
    expect(mems.every((r) => r.source === "intake" && r.valid_to === null && r.source_ref === out.event_id)).toBe(true);

    expect(db.rows("business_profiles")[0]).toMatchObject({ account_id: ACCT, scan_status: "pending", profile: { name: "Acme Co", category: "Supplements", products: ["Omega", "Zinc"], market: { region: "NZ + AU" }, voice: { tone: "plain, no hype", phrases: [] }, sources: ["https://acme.test", "@acme"] } });
    expect(db.rows("goals")).toMatchObject([{ account_id: ACCT, category: "revenue", tier: "governing", title: "NZ$60,000 MRR", baseline: 28400, deadline: "2026-12-31" }]);
    expect(db.rows("resource_profiles")[0]).toMatchObject({ account_id: ACCT, budget_monthly: 3600, hours_weekly: 8, website: "https://acme.test", socials: ["@acme"], known_platforms: ["shopify", "klaviyo"] });
    expect(db.rows("team_members").map((t) => [t.position, t.name, t.role])).toEqual([
      [0, "Ana", "Founder"],
      [1, "Sam", "Ops"],
    ]);
    expect(db.rows("connectors").map((c) => [c.platform, c.status, c.external_ref])).toEqual([
      ["shopify", "disconnected", "acme.myshopify.com"],
      ["klaviyo", "disconnected", null],
    ]);
    const ev = db.rows("intake_events")[0];
    expect(ev).toMatchObject({ account_id: ACCT, key_id: KEY, payload: FULL, outcome: { status: "done", written: out.written, warnings: [] } });
    expect(ev.id).toBe(out.event_id);
  });

  it("never overwrites what is already there with nulls; an existing goal is left alone; identical memories are skipped", async () => {
    db.seed("goals", [{ id: "00000000-0000-4000-8000-00000000g0a1", account_id: ACCT, category: "brand", tier: "governing", title: "25k followers" }]);
    db.seed("business_profiles", [{ account_id: ACCT, scan_status: "done", profile: { name: "Acme (scanned)", oneLiner: "Marine supplements", products: ["Omega"], market: { region: "NZ", competitorsMentioned: ["X"] } } }]);
    db.seed("resource_profiles", [{ account_id: ACCT, budget_monthly: 1000, hours_weekly: 4, website: "https://old.acme.test", socials: ["@old"], known_platforms: ["ga4"] }]);
    db.seed("connectors", [{ id: "00000000-0000-4000-8000-00000000c0a1", account_id: ACCT, platform: "shopify", status: "connected", external_ref: null }]);
    db.seed("memories", [{ id: "00000000-0000-4000-8000-00000000m0a1", account_id: ACCT, kind: "fact", text: "Ships from Auckland", source: "chat", confidence: 0.7, importance: 3, tags: [], valid_from: NOW.toISOString() }]);

    const out = await applyIntake(db, ACCT, { business: { name: "Acme Co", products: ["Zinc"], market: "NZ + AU" }, goal: { title: "NZ$60,000 MRR" }, resources: { hours_weekly: 8 }, platforms: [{ platform: "shopify", external_ref: "acme.myshopify.com" }], facts: ["Ships from Auckland", "Founded 2019"] }, { keyId: KEY, now: NOW });
    expect(out.written).toMatchObject({ goal: 0, connectors: 1, memories_skipped: 1 });
    expect(out.warnings).toEqual(["goal: the account already has a goal — left as the founder set it (recorded as a memory only)", "memories: 1 already known (identical text) — skipped"]);

    const prof = db.rows("business_profiles")[0];
    expect(prof.scan_status).toBe("done"); // untouched
    expect(prof.profile).toEqual({ name: "Acme Co", oneLiner: "Marine supplements", products: ["Omega", "Zinc"], market: { region: "NZ + AU", competitorsMentioned: ["X"] } });
    expect(db.rows("goals")).toHaveLength(1);
    expect(db.rows("resource_profiles")[0]).toMatchObject({ budget_monthly: 1000, hours_weekly: 8, website: "https://old.acme.test", socials: ["@old"], known_platforms: ["ga4", "shopify"] });
    const conn = db.rows("connectors")[0];
    expect(conn.status).toBe("connected"); // status never touched
    expect(conn.external_ref).toBe("acme.myshopify.com"); // only the missing hint filled
    const live = await listActiveMemories(db, ACCT);
    expect(live.filter((m) => m.text === "Ships from Auckland")).toHaveLength(1);
    expect(live.some((m) => m.text === "Founded 2019" && m.source === "intake")).toBe(true);
  });

  it("Idempotency-Key replay returns the first outcome and writes nothing twice", async () => {
    const a = await applyIntake(db, ACCT, { facts: ["One"] }, { keyId: KEY, now: NOW, idempotencyKeyHash: "h1" });
    const b = await applyIntake(db, ACCT, { facts: ["One", "Two"] }, { keyId: KEY, now: NOW, idempotencyKeyHash: "h1" });
    expect(b).toEqual({ ...a, replayed: true });
    expect(db.rows("memories")).toHaveLength(1);
    expect(db.rows("intake_events")).toHaveLength(1);
    expect(db.rows("intake_events")[0].outcome).toMatchObject({ idempotency_key_hash: "h1" });
    // a different key on the same account writes again
    const c = await applyIntake(db, ACCT, { facts: ["Two"] }, { keyId: KEY, now: NOW, idempotencyKeyHash: "h2" });
    expect(c.replayed).toBe(false);
    expect(db.rows("memories")).toHaveLength(2);
  });
});
