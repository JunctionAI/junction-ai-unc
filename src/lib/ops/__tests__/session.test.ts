import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), configured: true, service: {}, serviceConfigured: true }));
vi.mock("@/lib/db/client", () => ({ asDb: (x: unknown) => x, isDbConfigured: () => mocks.configured }));
vi.mock("@/lib/db/server", () => ({ getServerSupabase: async () => ({ auth: { getUser: mocks.getUser } }), getServiceSupabase: () => mocks.service, isServiceRoleConfigured: () => mocks.serviceConfigured }));
import { requireOpsIdentity } from "../session";
beforeEach(() => { mocks.configured = true; mocks.serviceConfigured = true; mocks.getUser.mockReset(); });
it("uses verified Auth identity, not user-editable metadata", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: { id: "verified", email_confirmed_at: "2026-09-05", user_metadata: { role: "admin", account_id: "forged" } } }, error: null });
  expect(await requireOpsIdentity()).toEqual({ userId: "verified", service: mocks.service });
});
it("no demo fallback, anonymous user or unverified email can read ops", async () => {
  mocks.configured = false; expect((await requireOpsIdentity() as Response).status).toBe(503); expect(mocks.getUser).not.toHaveBeenCalled();
  mocks.configured = true;
  for (const user of [null, { id: "u" }, { id: "u", email_confirmed_at: "now", is_anonymous: true }]) {
    mocks.getUser.mockResolvedValue({ data: { user }, error: null }); expect((await requireOpsIdentity() as Response).status).toBe(401);
  }
  mocks.getUser.mockResolvedValue({ data: { user: { id: "u", email_confirmed_at: "now" } }, error: new Error("revoked") });
  expect((await requireOpsIdentity() as Response).status).toBe(401);
});
