import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ configured: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ isDbConfigured: mocks.configured }));
vi.mock("@/lib/db/session", () => ({ requireAccountOwnerSession: mocks.session }));

import { requireModelAccountContext } from "../accountContext";

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

    const service = { from: vi.fn() };
    mocks.session.mockResolvedValueOnce({ accountId: "acct-1", service });
    expect(await requireModelAccountContext()).toEqual({ accountId: "acct-1", db: service });
  });
});
