/* SupabaseStore ↔ migration 0013: artifacts round-trip and n8n_workflows lookup on the
   schema-checked fake, deep-equal to MemoryStore. */

import { describe, expect, it } from "vitest";
import { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import { MemoryStore } from "../store/memory";
import { SupabaseStore } from "../store/supabase";
import type { Artifact } from "../types";

const ACCT = "00000000-0000-4000-8000-00000000aaaa";
const RUN = "00000000-0000-4000-8000-00000000bbbb";
const artifact = (id: string, over: Partial<Artifact> = {}): Artifact => ({
  id,
  accountId: ACCT,
  runId: RUN,
  routineId: "D01-W01",
  kind: "post_set",
  title: "3 posts",
  body: "Body **md**",
  items: [{ title: "a", body: "b", meta: { angle: "question" } }],
  meta: { via: "producer" },
  evidence: [{ source: "site_profile", ref: "x" }],
  status: "draft",
  createdAt: "2026-09-03T07:00:00.000Z",
  ...over,
});

function fake() {
  const db = new FakeSupabase();
  db.seed("accounts", [{ id: ACCT, name: "A", currency: "NZD" }]);
  db.seed("routine_runs", [{ id: RUN, account_id: ACCT, routine_id: "D01-W01", version: 1, mode: "dry_run", status: "waiting_input", started_at: "2026-09-03T07:00:00.000Z" }]);
  return db;
}

describe("artifacts on both stores", () => {
  it.each([
    ["MemoryStore", () => new MemoryStore()],
    ["SupabaseStore", () => new SupabaseStore(fake())],
  ])("%s: put / get / update / list", async (_name, make) => {
    const store = make();
    const a1 = artifact("00000000-0000-4000-8000-000000000001");
    const a2 = artifact("00000000-0000-4000-8000-000000000002", { routineId: "D05-W02", kind: "email", createdAt: "2026-09-03T08:00:00.000Z" });
    expect(await store.putArtifact(a1)).toEqual(a1);
    await store.putArtifact(a2);
    expect(await store.getArtifact(a1.id)).toEqual(a1);
    expect(await store.getArtifact("00000000-0000-4000-8000-0000000000ff")).toBeNull();
    expect((await store.listArtifacts(ACCT)).map((a) => a.id)).toEqual([a2.id, a1.id]);
    expect((await store.listArtifacts(ACCT, { routineId: "D05-W02" })).map((a) => a.id)).toEqual([a2.id]);
    expect((await store.listArtifacts(ACCT, { runId: RUN, limit: 1 })).map((a) => a.id)).toEqual([a2.id]);
    const edited = await store.updateArtifact(a1.id, { status: "edited", editedBody: "mine" });
    expect(edited).toEqual({ ...a1, status: "edited", editedBody: "mine" });
    await expect(store.updateArtifact(a1.id, { status: "approved" }, "draft")).rejects.toThrow(/changed from draft to edited/);
    expect((await store.getArtifact(a1.id))!.status).toBe("edited");
    expect((await store.listArtifacts(ACCT, { status: "edited" })).map((a) => a.id)).toEqual([a1.id]);
    await expect(store.updateArtifact("00000000-0000-4000-8000-0000000000ff", { status: "held" })).rejects.toThrow();
  });

  it("the fake rejects an unknown artifact status and accepts waiting_input on routine_runs", async () => {
    const db = fake();
    const store = new SupabaseStore(db);
    await expect(store.putArtifact(artifact("00000000-0000-4000-8000-000000000003", { status: "shipped" as Artifact["status"] }))).rejects.toThrow(/violates check/);
    expect((await store.getRun(RUN))!.status).toBe("waiting_input");
    await store.updateRun(RUN, { status: "waiting_input", snapshot: { spec: { id: "D01-W01", version: 1, name: "x", wave: 1, mutates: false, nodes: [] }, ctx: {} as never, nextNodeIndex: 2, needs: [{ input: "about_the_business", why: "y" }] } });
    expect((await store.getRun(RUN))!.snapshot?.needs).toEqual([{ input: "about_the_business", why: "y" }]);
  });

  it.each([
    ["MemoryStore", () => new MemoryStore()],
    ["SupabaseStore", () => new SupabaseStore(fake())],
  ])("%s: findN8nWorkflow — the account's own active row first, then global, never inactive", async (_name, make) => {
    const store = make();
    expect(await store.findN8nWorkflow(ACCT, "D01-W01")).toBeNull();
    await store.putN8nWorkflow({ id: "00000000-0000-4000-8000-000000000010", accountId: null, routineId: "D01-W01", webhookUrl: "https://n8n.test/global", active: true });
    expect((await store.findN8nWorkflow(ACCT, "D01-W01"))?.webhookUrl).toBe("https://n8n.test/global");
    await store.putN8nWorkflow({ id: "00000000-0000-4000-8000-000000000011", accountId: ACCT, routineId: "D01-W01", webhookUrl: "https://n8n.test/mine", active: false });
    expect((await store.findN8nWorkflow(ACCT, "D01-W01"))?.webhookUrl).toBe("https://n8n.test/global");
    await store.putN8nWorkflow({ id: "00000000-0000-4000-8000-000000000011", accountId: ACCT, routineId: "D01-W01", webhookUrl: "https://n8n.test/mine", active: true });
    expect((await store.findN8nWorkflow(ACCT, "D01-W01"))?.webhookUrl).toBe("https://n8n.test/mine");
    expect(await store.findN8nWorkflow(ACCT, "D05-W02")).toBeNull();
  });
});
