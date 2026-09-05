import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountFacts } from "../accountFacts";

const mocks = vi.hoisted(() => ({
  read: vi.fn(), memberships: vi.fn(), session: vi.fn(), subscribe: false,
}));
vi.mock("react", () => ({ useSyncExternalStore: (subscribe: (listener: () => void) => unknown, snapshot: () => unknown) => {
  if (mocks.subscribe) { mocks.subscribe = false; subscribe(() => {}); }
  return snapshot();
} }));
vi.mock("../../db/client", () => ({
  isDbConfigured: () => true,
  getBrowserSupabase: () => ({ auth: { getSession: mocks.session } }),
  asDb: (db: unknown) => db,
}));
vi.mock("../../db/accountState", () => ({ listMemberships: mocks.memberships }));
vi.mock("../loadAccountFacts", () => ({ loadAccountFacts: mocks.read }));

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const facts = (accountId: string): AccountFacts => ({
  accountId, connectors: [], routineStates: [], plan: null, resources: null,
  approvals: [], decided: [], runs: [], receipts: [], fetchedAt: new Date().toISOString(),
});
const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.subscribe = false;
  mocks.session.mockResolvedValue({ data: { session: { user: { id: "verified-user" } } } });
  mocks.memberships.mockResolvedValue([{ accountId: A, role: "owner" }, { accountId: B, role: "member" }]);
});

describe("account facts identity isolation", () => {
  it("clears old facts immediately and never throttles the newly selected client", async () => {
    const store = await import("../accountFacts");
    const next = deferred<AccountFacts>();
    mocks.read.mockResolvedValueOnce(facts(A)).mockReturnValueOnce(next.promise);
    store.publishPersistence({ mode: "account", accountId: A });
    await drain();
    expect(store.useAccountFacts().facts?.accountId).toBe(A);
    store.publishPersistence({ mode: "account", accountId: B });
    expect(store.useAccountFacts()).toMatchObject({ accountId: B, facts: null, loading: true });
    expect(mocks.read.mock.calls.map(call => call[1])).toEqual([A, B]);
    next.resolve(facts(B));
    await drain();
    expect(store.useAccountFacts().facts?.accountId).toBe(B);
  });

  it.each(["success", "failure"])("ignores a prior client's late %s without clearing the current pending request", async outcome => {
    const store = await import("../accountFacts");
    const old = deferred<AccountFacts>();
    const current = deferred<AccountFacts>();
    mocks.read.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    store.publishPersistence({ mode: "account", accountId: A });
    store.publishPersistence({ mode: "account", accountId: B });
    if (outcome === "success") old.resolve(facts(A)); else old.reject(new Error("old client failed"));
    await drain();
    store.refreshAccountFacts(true);
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(store.useAccountFacts()).toMatchObject({ accountId: B, facts: null, loading: true, error: null });
    current.resolve(facts(B));
    await drain();
    expect(store.useAccountFacts()).toMatchObject({ facts: { accountId: B }, loading: false });
  });

  it("does not accept the original request after switching A to B and back to A", async () => {
    const store = await import("../accountFacts");
    const first = deferred<AccountFacts>();
    const second = deferred<AccountFacts>();
    const third = deferred<AccountFacts>();
    mocks.read.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    store.publishPersistence({ mode: "account", accountId: A });
    store.publishPersistence({ mode: "account", accountId: B });
    store.publishPersistence({ mode: "account", accountId: A });
    first.resolve(facts(A)); second.resolve(facts(B));
    await drain();
    expect(store.useAccountFacts()).toMatchObject({ accountId: A, facts: null, loading: true });
    third.resolve(facts(A));
    await drain();
    expect(store.useAccountFacts().facts?.accountId).toBe(A);
  });

  it("clears account facts when persistence loses access and ignores its pending read", async () => {
    const store = await import("../accountFacts");
    const pending = deferred<AccountFacts>();
    mocks.read.mockReturnValueOnce(pending.promise);
    store.publishPersistence({ mode: "account", accountId: A });
    store.publishPersistence({ mode: "error", accountId: null });
    pending.resolve(facts(A));
    await drain();
    expect(store.useAccountFacts()).toMatchObject({ accountId: null, facts: null, loading: false });
    expect(mocks.memberships).not.toHaveBeenCalled();
  });

  it("does not choose the first of multiple memberships", async () => {
    const store = await import("../accountFacts");
    mocks.subscribe = true;
    store.useAccountFacts();
    await drain();
    expect(store.useAccountFacts()).toMatchObject({ mode: "account", accountId: null, facts: null });
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("keeps a published client when an earlier membership fallback finishes", async () => {
    const pending = deferred<{ accountId: string; role: string }[]>();
    mocks.memberships.mockReturnValueOnce(pending.promise);
    mocks.read.mockResolvedValue(facts(B));
    const store = await import("../accountFacts");
    mocks.subscribe = true;
    store.useAccountFacts();
    await drain();
    expect(mocks.memberships).toHaveBeenCalledTimes(1);
    store.publishPersistence({ mode: "account", accountId: B });
    pending.resolve([{ accountId: A, role: "owner" }]);
    await drain();
    expect(store.useAccountFacts()).toMatchObject({ accountId: B, facts: { accountId: B } });
    expect(mocks.read.mock.calls.map(call => call[1])).toEqual([B]);
  });
});
