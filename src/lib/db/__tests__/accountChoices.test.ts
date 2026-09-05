import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "./fakeSupabase";
const auth = vi.hoisted(() => ({ user: { id: "user" } as { id: string } | null, configured: true, error: null as object | null }));
let db: FakeSupabase;
vi.mock("../client", () => ({ isDbConfigured: () => auth.configured, asDb: (v: unknown) => v }));
vi.mock("../server", () => ({ getServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: auth.user }, error: auth.error }) }, from: (table: string) => db.from(table) }) }));
import { accountChoicesForRequest, accountChoicesForUser } from "../accountChoices";

beforeEach(() => {
  auth.configured = true; auth.user = { id: "user" }; auth.error = null;
  db = new FakeSupabase();
  db.seed("accounts", [{ id: "a", name: "Client A" }, { id: "b", name: "Client B" }, { id: "foreign", name: "Private client" }]);
  db.seed("account_members", [{ account_id: "a", user_id: "user", role: "owner" }, { account_id: "b", user_id: "user", role: "member" }, { account_id: "foreign", user_id: "peer", role: "owner" }]);
});
describe("authorized account picker listing", () => {
  it("lists only exact user memberships, preserving member roles and hiding peer accounts", async () => {
    expect(await accountChoicesForRequest()).toEqual({ error: null, choices: [{ accountId: "a", name: "Client A", role: "owner" }, { accountId: "b", name: "Client B", role: "member" }] });
    expect(db.lastCall("accounts", "select").filters).toEqual(expect.arrayContaining([{ kind: "in", column: "id", value: ["a", "b"] }]));
  });
  it("rereads membership after revocation and never provisions or grants access", async () => {
    db.rows("account_members").splice(1, 1);
    expect(await accountChoicesForUser(db, "user")).toEqual([{ accountId: "a", name: "Client A", role: "owner" }]);
    expect(await accountChoicesForUser(db, "nobody")).toEqual([]);
    expect(db.rows("accounts")).toHaveLength(3);
  });
  it("fails closed for an expired or unverified session, while a no-database build remains demo", async () => {
    auth.error = { message: "private provider detail" };
    expect(await accountChoicesForRequest()).toEqual({ choices: [], error: expect.not.stringContaining("private provider detail") });
    auth.error = null; auth.user = null;
    expect((await accountChoicesForRequest()).error).toBeTruthy();
    auth.configured = false;
    expect(await accountChoicesForRequest()).toEqual({ choices: [], error: null });
  });
});
