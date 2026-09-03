/* Account-mode artifact review is a taste gate: members can inspect drafts, but only the
   current account owner may approve, hold, edit, use, or send one. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { restoreEnv, setFakeEnv } from "@/lib/billing/__tests__/env";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { setStoreForTests } from "@/lib/runtime/store";
import { SupabaseStore } from "@/lib/runtime/store/supabase";

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

const ACCOUNT = "00000000-0000-4000-8000-00000000acc1";
const USER = "00000000-0000-4000-8000-00000000u5e1";
const ARTIFACT = "00000000-0000-4000-8000-00000000a4f1";
const params = { params: Promise.resolve({ id: ARTIFACT }) };

beforeEach(() => {
  setFakeEnv();
  db = new FakeSupabase();
  db.userId = USER;
  user = { id: USER, email: "member@example.test" };
  db.seed("accounts", [{ id: ACCOUNT, name: "Example Co" }]);
  db.seed("account_members", [{ account_id: ACCOUNT, user_id: USER, role: "member" }]);
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
    expect((await GET(new Request(`http://unc.test/api/artifacts/${ARTIFACT}`), params)).status).toBe(200);
    const res = await POST(new Request(`http://unc.test/api/artifacts/${ARTIFACT}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
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
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    }), params);
    expect(res.status).toBe(200);
    expect((await res.json()).artifact.status).toBe("approved");
    expect(db.rows("artifacts")[0].status).toBe("approved");
    expect(db.rows("taste_events")).toHaveLength(1);
    expect(db.rows("receipts").at(-1)).toMatchObject({ run_id: "00000000-0000-4000-8000-000000000111", kind: "notification", payload: { artifactDecision: true, artifactId: ARTIFACT, action: "approve" } });
  });
});
