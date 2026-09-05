import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ configured: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ isDbConfigured: mocks.configured }));
vi.mock("@/lib/db/session", () => ({ requireAccountOwnerSession: mocks.session }));

import { requireModelAccountContext } from "../accountContext";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";

beforeEach(() => {
  mocks.configured.mockReset().mockReturnValue(false);
  mocks.session.mockReset();
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => vi.unstubAllEnvs());

describe("browser model-call account boundary", () => {
  it("allows DB-less local/test demo mode but fails closed without storage in production", async () => {
    expect(await requireModelAccountContext()).toBeNull();
    vi.stubEnv("NODE_ENV", "production");
    const blocked = await requireModelAccountContext();
    expect(blocked).toBeInstanceOf(Response);
    expect((blocked as Response).status).toBe(503);
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("requires the signed-in account owner on configured deployments and uses its service DB", async () => {
    mocks.configured.mockReturnValue(true);
    const signedOut = Response.json({ error: "sign in first" }, { status: 401 });
    mocks.session.mockResolvedValueOnce(signedOut);
    expect(await requireModelAccountContext()).toBe(signedOut);

    const member = Response.json({ error: "only the account owner can do that", code: "owner_only" }, { status: 403 });
    mocks.session.mockResolvedValueOnce(member);
    expect(await requireModelAccountContext()).toBe(member);

    const service = new FakeSupabase();
    service.insertRow("accounts", { id: "acct-1" });
    mocks.session.mockResolvedValueOnce({ accountId: "acct-1", service });
    const result = await requireModelAccountContext();
    expect(result).toMatchObject({ accountId: "acct-1", contextGeneration: 0 });
    if (!result || result instanceof Response) throw new Error("expected account context");
    await result.db.from("memories").insert({ kind: "fact", text: "owned", source: "founder" });
    expect(service.rows("memories")[0]).toMatchObject({ account_id: "acct-1", context_generation: 0 });
  });

  it("requires the exact loaded generation after repair and fails closed on unavailable storage", async () => {
    mocks.configured.mockReturnValue(true);
    const service = new FakeSupabase();
    service.insertRow("accounts", { id: "acct-1", context_generation: 2 });
    mocks.session.mockResolvedValue({ accountId: "acct-1", service });
    for (const header of [null, "0", "1", "03", "2.0", "-1"]) {
      const req = new Request("https://unc.test", { headers: header === null ? {} : { "x-unc-context-generation": header } });
      const result = await requireModelAccountContext(req);
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(409);
    }
    expect(await requireModelAccountContext(new Request("https://unc.test", { headers: { "x-unc-context-generation": "2" } }))).toMatchObject({ contextGeneration: 2 });
    mocks.session.mockResolvedValue({ accountId: "unknown", service });
    expect((await requireModelAccountContext() as Response).status).toBe(503);
  });

  it("rejects a stale tab from another account even at the same generation", async () => {
    mocks.configured.mockReturnValue(true);
    const service = new FakeSupabase();
    service.insertRow("accounts", { id: "new-account", context_generation: 1 });
    mocks.session.mockResolvedValue({ accountId: "new-account", service });
    const response = await requireModelAccountContext(new Request("https://unc.test", { headers: { "x-unc-account-id": "old-account", "x-unc-context-generation": "1" } }));
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(409);
  });
});
