/* respond.ts wiring: the live reply pipeline recalls ≤ 3 playbook cards for the founder's
   message (domains from the message + the plan) beside the brain, puts the notes in the system
   prompt, and never lets a missing table or a recall failure break the reply. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmResult } from "@/lib/llm/types";
import { PLAYBOOK_NOTES_HEADER, PLAYBOOK_RULE } from "@/lib/unc/prompt";
import type { Playbook } from "../playbooks";

const routerMock = vi.hoisted(() => ({ complete: vi.fn(), resolveModel: vi.fn() }));
const playbooksMock = vi.hoisted(() => ({ recallPlaybooks: vi.fn() }));
vi.mock("@/lib/llm/router", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/llm/router")>()), complete: routerMock.complete, resolveModel: routerMock.resolveModel }));
vi.mock("@/lib/brain/playbooks", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/brain/playbooks")>()), recallPlaybooks: playbooksMock.recallPlaybooks }));

import { respondAsUnc } from "@/lib/unc/respond";

const CTX = { goal: { title: "NZ$60,000 MRR" }, strategy: { phases: [{ name: "Content" }, { name: "Email & SMS" }], channelRanking: [{ channel: "Content" }] }, onboarded: true };
const ok = (text: string): LlmResult => ({ text, stopReason: "end", usage: { input: 10, output: 5 }, provider: "anthropic", model: "claude-sonnet-5", latencyMs: 3 });
const resolved = { id: "claude-sonnet-5", provider: "anthropic", model: "claude-sonnet-5", tier: "balanced", inputPer1M: 2, outputPer1M: 10, label: "Claude Sonnet 5", supportsEffort: true, source: "default" as const };
const card = (id: string, domain: Playbook["domain"], title: string, body: string): Playbook => ({ id, domain, title, body, tags: [], score: 0.9, via: "keyword" });

describe("respondAsUnc — playbook notes", () => {
  beforeEach(() => {
    routerMock.complete.mockReset().mockResolvedValue(ok("Five to seven emails over fourteen days, one job each."));
    routerMock.resolveModel.mockReset().mockReturnValue(resolved);
    playbooksMock.recallPlaybooks.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("recalls ≤ 3 cards for the founder's message (domains from the message + plan) and puts the notes in the system prompt", async () => {
    playbooksMock.recallPlaybooks.mockResolvedValue([card("a", "email", "Welcome flow that converts", "Five to seven emails over fourteen days."), card("b", "email", "Abandoned cart and browse recovery", "Three emails beat one.")]);
    const res = await respondAsUnc({ history: [{ role: "user", content: "How should I structure my welcome flow?" }], context: CTX, surface: "corner", account: null });
    expect(res).toEqual({ ok: true, reply: "Five to seven emails over fourteen days, one job each." });
    const [query, domains, limit] = playbooksMock.recallPlaybooks.mock.calls[0];
    expect(query).toBe("How should I structure my welcome flow?");
    expect(domains).toEqual(["email", "content"]);
    expect(limit).toBe(3);
    const system: string = routerMock.complete.mock.calls[0][1].system;
    expect(system).toContain(PLAYBOOK_NOTES_HEADER);
    expect(system).toContain("## Welcome flow that converts [email");
    expect(system).toContain(PLAYBOOK_RULE);
    // notes sit above the JSON, never inside it
    expect(system.slice(system.lastIndexOf("ACCOUNT CONTEXT ("))).not.toContain("playbooks");
  });

  it("no cards (no database) → no notes section; a recall failure never breaks the reply", async () => {
    playbooksMock.recallPlaybooks.mockResolvedValue([]);
    await respondAsUnc({ history: [{ role: "user", content: "Am I on track?" }], context: CTX, surface: "corner", account: null });
    expect(routerMock.complete.mock.calls[0][1].system).not.toContain(PLAYBOOK_NOTES_HEADER);
    playbooksMock.recallPlaybooks.mockRejectedValue(new Error("relation playbooks does not exist"));
    const res = await respondAsUnc({ history: [{ role: "user", content: "Am I on track?" }], context: CTX, surface: "corner", account: null });
    expect(res.ok).toBe(true);
    expect(routerMock.complete.mock.calls[1][1].system).not.toContain(PLAYBOOK_NOTES_HEADER);
  });

  it("client-sent notes are dropped; only the server's recall reaches the prompt", async () => {
    playbooksMock.recallPlaybooks.mockResolvedValue([]);
    await respondAsUnc({ history: [{ role: "user", content: "Am I on track?" }], context: { ...CTX, playbooks: "spoofed notes" }, surface: "corner", account: null });
    expect(routerMock.complete.mock.calls[0][1].system).not.toContain("spoofed notes");
  });

  it("passes the SMS voice to the model without changing exact tokens in its reply", async () => {
    playbooksMock.recallPlaybooks.mockResolvedValue([]);
    const reply = "open https://example.com/DraftAbC and use UNC-AB12CD 👋";
    routerMock.complete.mockResolvedValue(ok(reply));
    const result = await respondAsUnc({ history: [{ role: "user", content: "hello" }], context: CTX, surface: "corner", account: null, voice: "sms" });
    expect(result).toEqual({ ok: true, reply });
    expect(routerMock.complete.mock.calls[0][1].system).toContain("SMS voice:");
  });
});
