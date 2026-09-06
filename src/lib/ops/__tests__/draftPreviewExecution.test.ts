import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "@/lib/db/types";
import type { AccountsSource } from "@/worker/accounts";
import { adapters as runtimeAdapters, FakeProducer } from "@/lib/runtime/__tests__/helpers";
import { executeOpsDraftPreview } from "../draftPreview";

const U = "00000000-0000-4000-8000-000000000001";
const A = "00000000-0000-4000-8000-000000000002";
const R = "00000000-0000-4000-8000-000000000003";
const NOW = "2026-09-06T02:00:00.000Z";
const producer = new FakeProducer({ artifact: {
  kind: "email", title: "Newsletter draft: clogs", body: "Complete reviewed copy and build brief. PASS",
  items: [{ title: "Clogs are here", body: "Preview and complete body.", meta: { mode: "visual_drop" } }],
  evidence: [{ source: "input:newsletter_source_ref", ref: "slack:C0BRASET44B:1788245792.999599" }],
} });
const runtime = runtimeAdapters({ producer });
const build = vi.fn((deps: unknown) => { void deps; return runtime.adapters; });
vi.mock("@/worker/service", async (original) => {
  const actual = await original<typeof import("@/worker/service")>();
  return { ...actual, buildAdapters: (...args: unknown[]) => build(args[0]) };
});

const body = { accountId: A, contextGeneration: 7, requestId: R, routineId: "D05-W08", inputs: {
  newsletter_mode: "visual_drop",
  newsletter_brief: "Use the approved clog launch copy and propose the missing subject and preview.",
  newsletter_source_ref: "slack:C0BRASET44B:1788245792.999599",
  about_the_business: "Home Invasion and the Call Me If You Get Clogs product.",
} };
const rpc = vi.fn();
const db = { rpc } as unknown as DbClient;
const accounts: AccountsSource = { listAccounts: async () => [], getAccount: async () => ({
  account: { accountId: A, contextGeneration: 7, currency: "NZD", budgetMonthly: 0, approver: "Tom" },
  automationPaused: true, vars: { website: "https://www.home1nvasion.com" },
}) };

beforeEach(() => {
  rpc.mockReset(); build.mockClear(); producer.calls.length = 0;
  rpc.mockResolvedValue({ data: { requestId: R, accountId: A, contextGeneration: 7, routineId: "D05-W08", requestedAt: NOW, automationPaused: true }, error: null });
});

describe("operator draft preview execution", () => {
  it("creates one durable dry-run artifact for a paused client and replays without producing twice", async () => {
    const first = await executeOpsDraftPreview(db, U, body, { db, store: runtime.store, accounts, producer });
    expect(first).toMatchObject({ runId: R, routineId: "D05-W08", status: "done", artifact: { title: "Newsletter draft: clogs" } });
    expect(producer.calls).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith("authorize_ops_draft_preview", expect.objectContaining({
      p_user_id: U, p_account_id: A, p_context_generation: 7, p_request_id: R, p_routine_id: "D05-W08",
    }));
    const replay = await executeOpsDraftPreview(db, U, body, { db, store: runtime.store, accounts, producer });
    expect(replay.runId).toBe(R);
    expect(producer.calls).toHaveLength(1);
  });
  it.each([["42501", 403], ["40001", 409], ["22023", 400], ["XX000", 503]] as const)("maps %s authorization refusal to %s before producing", async (code, status) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: "PRIVATE" } });
    await expect(executeOpsDraftPreview(db, U, { ...body, requestId: crypto.randomUUID() }, { db, store: runtime.store, accounts, producer }))
      .rejects.toMatchObject({ status });
    expect(producer.calls).toHaveLength(0);
  });
});
