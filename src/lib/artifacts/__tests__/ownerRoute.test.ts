/* Account-mode artifact review is a taste gate: members can inspect drafts, but only the
   current account owner may approve, hold, edit, use, or send one. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { restoreEnv, setFakeEnv } from "@/lib/billing/__tests__/env";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { setStoreForTests } from "@/lib/runtime/store";
import { SupabaseStore } from "@/lib/runtime/store/supabase";
import { installArtifactFixture } from "./deliveryFixture";
import { artifactHeaders } from "../client";

let db: FakeSupabase;
let user: { id: string; email?: string } | null = null;
const sessionClient = () => ({
  auth: { getUser: async () => ({ data: { user }, error: null }) },
  from: (table: string) => db.from(table),
  rpc: (fn: string, args?: Record<string, unknown>) => db.rpc(fn, args),
});

vi.mock("@/lib/db/server", () => ({
  getServerSupabase: async () => sessionClient(),
  getServiceSupabase: () => db,
  isServiceRoleConfigured: () => true,
}));

import { GET, POST } from "@/app/api/artifacts/[id]/route";
import { GET as LIST } from "@/app/api/artifacts/route";

const ACCOUNT = "00000000-0000-4000-8000-00000000acc1";
const USER = "00000000-0000-4000-8000-00000000u5e1";
const ARTIFACT = "00000000-0000-4000-8000-00000000a4f1";
const params = { params: Promise.resolve({ id: ARTIFACT }) };

beforeEach(() => {
  setFakeEnv();
  db = new FakeSupabase();
  installArtifactFixture(db);
  db.userId = USER;
  user = { id: USER, email: "member@example.test" };
  db.seed("accounts", [{ id: ACCOUNT, name: "Example Co" }]);
  db.seed("account_members", [{ account_id: ACCOUNT, user_id: USER, role: "member" }]);
  db.seed("routine_runs", [{ id: "00000000-0000-4000-8000-000000000111", account_id: ACCOUNT, context_generation: 0, routine_id: "D01-W01", version: 1, mode: "dry_run", status: "done" }]);
  db.seed("artifacts", [{
    id: ARTIFACT,
    account_id: ACCOUNT,
    run_id: "00000000-0000-4000-8000-000000000111",
    routine_id: "D01-W01",
    kind: "post",
    title: "A founder post",
    body: "Draft body",
    items: [],
    meta: {},
    evidence: [],
    status: "draft",
    edited_body: null,
    created_at: "2026-09-04T00:00:00.000Z",
  }]);
  setStoreForTests(new SupabaseStore(db));
});

afterEach(() => {
  restoreEnv();
  setStoreForTests(undefined);
});

describe("account artifact taste gate", () => {
  it("allows member reads but refuses member decisions without changing the draft", async () => {
    expect((await GET(new Request(`http://unc.test/api/artifacts/${ARTIFACT}`, { headers: artifactHeaders(ACCOUNT, 0) }), params)).status).toBe(200);
    const res = await POST(new Request(`http://unc.test/api/artifacts/${ARTIFACT}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...artifactHeaders(ACCOUNT, 0) },
      body: JSON.stringify({ action: "approve", expectedRevision: 0 }),
    }), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "owner_only" });
    expect(db.rows("artifacts")[0].status).toBe("draft");
    expect(db.rows("taste_events")).toHaveLength(0);
  });

  it("allows the owner to make the taste decision", async () => {
    db.rows("account_members")[0].role = "owner";
    const res = await POST(new Request(`http://unc.test/api/artifacts/${ARTIFACT}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...artifactHeaders(ACCOUNT, 0) },
      body: JSON.stringify({ action: "approve", expectedRevision: 0 }),
    }), params);
    expect(res.status).toBe(200);
    expect((await res.json()).artifact.status).toBe("approved");
    expect(db.rows("artifacts")[0].status).toBe("approved");
    expect(db.rows("taste_events")).toHaveLength(1);
    expect(db.rows("receipts").at(-1)).toMatchObject({ run_id: "00000000-0000-4000-8000-000000000111", kind: "notification", payload: { artifactDecision: true, artifactId: ARTIFACT, action: "approve" } });
  });

  it("rejects missing/cross-account/stale context before listing or deciding", async () => {
    db.rows("account_members")[0].role = "owner";
    for (const headers of [{}, artifactHeaders("another-account", 0), artifactHeaders(ACCOUNT, 1)]) {
      expect((await LIST(new Request("http://unc.test/api/artifacts", { headers }))).status).toBe(409);
      expect((await POST(new Request("http://unc.test/api/artifacts/" + ARTIFACT, { method: "POST", headers, body: JSON.stringify({ action: "approve", expectedRevision: 0 }) }), params)).status).toBe(409);
    }
    expect(db.rows("receipts")).toHaveLength(0);
  });

  it("filters archived runs before limits and never offers another member's channel", async () => {
    db.rows("accounts")[0].context_generation = 1;
    db.seed("channel_links", [{ account_id: ACCOUNT, user_id: "other-owner", channel: "slack", external_id: "other-destination", verified_at: db.now() }]);
    const request = new Request("http://unc.test/api/artifacts?limit=1", { headers: artifactHeaders(ACCOUNT, 1) });
    expect(await (await LIST(request)).json()).toMatchObject({ accountId: ACCOUNT, contextGeneration: 1, artifacts: [], channels: [] });
    expect((await GET(new Request("http://unc.test/api/artifacts/" + ARTIFACT, { headers: artifactHeaders(ACCOUNT, 1) }), params)).status).toBe(404);
    db.rows("routine_runs")[0].context_generation = 1;
    expect((await (await LIST(request)).json()).artifacts).toHaveLength(1);
  });

  it("same-status stale edits do not overwrite a newer version", async () => {
    db.rows("account_members")[0].role = "owner";
    const edit = () => POST(new Request("http://unc.test/api/artifacts/" + ARTIFACT, { method: "POST", headers: artifactHeaders(ACCOUNT, 0),
      body: JSON.stringify({ action: "edit", editedBody: "Reviewed words", expectedRevision: 0 }) }), params);
    expect((await edit()).status).toBe(200);
    expect((await edit()).status).toBe(409);
    expect(db.rows("receipts")).toHaveLength(1);
  });

  it("messaging release gate refuses send without reserving an operation", async () => {
    db.rows("account_members")[0].role = "owner";
    process.env.UNC_MESSAGING_ENABLED = "false";
    const res = await POST(new Request("http://unc.test/api/artifacts/" + ARTIFACT, { method: "POST", headers: artifactHeaders(ACCOUNT, 0),
      body: JSON.stringify({ action: "send", channel: "slack", expectedRevision: 0 }) }), params);
    expect(res.status).toBe(503);
    expect(db.rows("artifact_deliveries")).toHaveLength(0);
  });
});
