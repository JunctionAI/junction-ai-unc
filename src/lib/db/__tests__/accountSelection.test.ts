import { describe, expect, it } from "vitest";
import { selectAccountMembership } from "../accountSelection";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const memberships = [{ accountId: A, role: "owner" as const }, { accountId: B, role: "member" as const }];
describe("per-request account selection", () => {
  it("permits an unambiguous single account, never an implicit multi-account home", () => {
    expect(selectAccountMembership([memberships[0]])).toEqual({ ok: true, membership: memberships[0] });
    expect(selectAccountMembership(memberships)).toEqual({ ok: false, code: "account_selection_required" });
    expect(selectAccountMembership([...memberships].reverse())).toEqual({ ok: false, code: "account_selection_required" });
  });
  it("two concurrent request selections keep their exact account and role", () => {
    expect(selectAccountMembership(memberships, A)).toEqual({ ok: true, membership: memberships[0] });
    expect(selectAccountMembership(memberships, B)).toEqual({ ok: true, membership: memberships[1] });
    expect(selectAccountMembership(memberships, A.toUpperCase())).toEqual({ ok: true, membership: memberships[0] });
  });
  it.each(["", " ", A + " " , A + "," + B, [A], {}, 1, "../../other", "unknown"])("does not fall back after malformed selection %j", requested => {
    expect(selectAccountMembership([memberships[0]], requested)).toEqual({ ok: false, code: "account_selection_invalid" });
  });
  it("revocation, an empty membership set and a foreign account do not select remaining access", () => {
    expect(selectAccountMembership([memberships[0]], B)).toEqual({ ok: false, code: "account_access_denied" });
    expect(selectAccountMembership([], A)).toEqual({ ok: false, code: "account_access_denied" });
    expect(selectAccountMembership([])).toEqual({ ok: false, code: "account_access_denied" });
  });
});
