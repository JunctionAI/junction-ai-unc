import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ user: { id: "user" } as { id: string } | null, requested: null as string | null,
  memberships: [] as { accountId: string; role: "owner" | "member" }[] }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(f.requested === null ? {} : { "x-unc-account-id": f.requested }) }));
vi.mock("../client", () => ({ isDbConfigured: () => true, asDb: (x: unknown) => x }));
vi.mock("../server", () => ({ isServiceRoleConfigured: () => true, getServiceSupabase: () => ({}),
  getServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: f.user } }) } }) }));
vi.mock("../accountState", () => ({ listMemberships: async () => f.memberships, acceptBetaInvites: async () => [] }));
import { requireAccountOwnerSession, requireAccountSession } from "../session";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
beforeEach(() => { f.user = { id: "user" }; f.requested = null; f.memberships = [{ accountId: A, role: "owner" }, { accountId: B, role: "member" }]; });
describe("verified session resolves request-bound membership", () => {
  it("requires selection for multiple memberships and refuses unowned IDs", async () => {
    const missing = await requireAccountSession() as Response;
    expect(missing.status).toBe(409); expect((await missing.json()).code).toBe("account_selection_required");
    f.requested = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    expect((await requireAccountSession() as Response).status).toBe(403);
  });
  it("keeps a selected member read-only rather than falling back to an owned account", async () => {
    f.requested = B;
    expect(await requireAccountSession()).toMatchObject({ accountId: B, role: "member" });
    expect((await requireAccountOwnerSession() as Response).status).toBe(403);
    f.requested = A; expect(await requireAccountOwnerSession()).toMatchObject({ accountId: A, role: "owner" });
  });
  it("accepts independent explicit Request objects without ambient account state", async () => {
    const [a, b] = await Promise.all([A, B].map(id => requireAccountSession(new Request("https://unc.test/api/workspace", { headers: { "x-unc-account-id": id } }))));
    expect(a).toMatchObject({ accountId: A }); expect(b).toMatchObject({ accountId: B });
    f.memberships = [f.memberships[0]];
    expect((await requireAccountSession(new Request("https://unc.test", { headers: { "x-unc-account-id": B } })) as Response).status).toBe(403);
  });
  it("still requires authentication and rejects malformed selection for a single account", async () => {
    f.user = null; expect((await requireAccountSession() as Response).status).toBe(401);
    f.user = { id: "user" }; f.memberships = [f.memberships[0]]; f.requested = "not-an-account";
    expect((await requireAccountSession() as Response).status).toBe(409);
  });
});
