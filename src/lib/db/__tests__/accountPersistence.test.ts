import { describe, expect, it } from "vitest";
import { accountAuthProblem, accountAutosaveEnabled } from "../useAccountPersistence";

describe("account persistence auth boundary", () => {
  it("fails closed on a configured deployment with no verified session", () => {
    expect(accountAuthProblem(null, null)).toBe("Your sign-in session is no longer available. Try again or sign out, then sign in again.");
    expect(accountAuthProblem(null, { message: "Auth session missing!" })).toBe("Couldn't verify your signed-in account: Auth session missing!");
    expect(accountAuthProblem({ id: "user-1" }, null)).toBeNull();
  });

  it("enables browser autosave only for a hydrated owner account", () => {
    expect(accountAutosaveEnabled("account", "acct-1", "owner")).toBe(true);
    expect(accountAutosaveEnabled("account", "acct-1", "member")).toBe(false);
    expect(accountAutosaveEnabled("connecting", "acct-1", "owner")).toBe(false);
    expect(accountAutosaveEnabled("account", null, "owner")).toBe(false);
  });
});
