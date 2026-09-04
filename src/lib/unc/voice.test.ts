import { describe, expect, it } from "vitest";
import { APPROVAL_ASK_RULE, buildUncSystemPrompt } from "./prompt";
import { CONVERSATIONAL_VOICE, SMS_VOICE } from "./voice";

describe("SMS voice", () => {
  it("opts SMS into friendly lowercase prose without the no-emoji contradiction", () => {
    const prompt = buildUncSystemPrompt({}, "corner", "sms");
    expect(prompt).toContain(SMS_VOICE);
    expect(prompt).toContain("lowercase conversational prose");
    expect(prompt).toContain("0–1 emoji");
    expect(prompt).not.toContain("no emojis");
    expect(prompt).not.toContain("Setting: the in-app chat");
  });

  it("retains authority and truth constraints and uses actionable SMS approval guidance", () => {
    const prompt = buildUncSystemPrompt({}, "corner", "sms");
    expect(prompt).toContain("This text-only reply does not execute work");
    expect(prompt).toContain("No invented numbers");
    expect(prompt).toContain("Nothing publishes, sends, or spends without their explicit okay");
    expect(prompt).toContain("YES <id>, HOLD <id> or WHY <id>");
    expect(prompt).toContain("Never invent a code");
    expect(prompt).not.toContain(APPROVAL_ASK_RULE);
  });

  it("does not lowercase URLs, codes or account facts", () => {
    const facts = { url: "https://example.com/DraftAbC", code: "UNC-AB12CD", currency: "NZD", routineId: "D01-W01" };
    const prompt = buildUncSystemPrompt(facts, "corner", "sms");
    expect(prompt).toContain(JSON.stringify(facts));
    expect(prompt).toContain("exactly as supplied");
  });

  it("shares the personality with app chat but never lets context choose the channel", () => {
    const prompt = buildUncSystemPrompt({ voice: "sms" }, "corner");
    expect(prompt).not.toContain(SMS_VOICE);
    expect(prompt).toContain(CONVERSATIONAL_VOICE);
    expect(prompt).not.toContain("no emojis");
    expect(prompt).toContain(APPROVAL_ASK_RULE);
  });
});
