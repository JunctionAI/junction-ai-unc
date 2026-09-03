/* Platform's persistence boundary, rendered server-side: loading and account failures stop before
   the demo/application tree. A real demo session still reaches the existing demo UI. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const accountHook = vi.hoisted(() => ({
  current: {} as {
    mode: "demo" | "connecting" | "account" | "error";
    accountId: string | null;
    role: "owner" | "member" | null;
    userEmail: string | null;
    accountName: string;
    setAccountName: (name: string) => void;
    autosave: "idle" | "pending" | "saving" | "saved" | "error";
    error: string | null;
    retry: () => void;
  },
}));

vi.mock("@/lib/db/useAccountPersistence", () => ({
  useAccountPersistence: () => accountHook.current,
}));

import Platform from "../Platform";

const persistence = (mode: "demo" | "connecting" | "account" | "error", error: string | null = null) => ({
  mode,
  accountId: mode === "account" ? "acct-1" : null,
  role: mode === "account" ? ("owner" as const) : null,
  userEmail: mode === "error" ? "founder@example.test" : null,
  accountName: "",
  setAccountName: () => {},
  autosave: error ? ("error" as const) : ("idle" as const),
  error,
  retry: () => {},
});

describe("Platform persistence boundary", () => {
  beforeEach(() => {
    accountHook.current = persistence("demo");
  });

  it("keeps the application tree unmounted while the real account is loading", () => {
    accountHook.current = persistence("connecting");
    const html = renderToStaticMarkup(createElement(Platform));
    expect(html).toContain("Fetching your account…");
    expect(html).not.toContain("Demonstration data");
  });

  it("preserves the intentional no-database demo experience", () => {
    const html = renderToStaticMarkup(createElement(Platform));
    expect(html).toContain("Hey! I&#x27;m Unc.");
    expect(html).toContain("Skip — explore with demo data");
    expect(html).not.toContain('data-testid="account-persistence-error"');
  });

  it("blocks on a signed-in persistence error with retry and POST sign-out, never demo fixtures", () => {
    accountHook.current = persistence("error", "account rows were unavailable");
    const html = renderToStaticMarkup(createElement(Platform));
    expect(html).toContain('data-testid="account-persistence-error"');
    expect(html).toContain("I couldn’t load your real account.");
    expect(html).toContain("account rows were unavailable");
    expect(html).toContain("Try again");
    expect(html).toContain('action="/auth/signout"');
    expect(html).toContain('method="post"');
    expect(html).toContain("founder@example.test");
    expect(html).not.toContain("Demonstration data");
    expect(html).not.toContain("NZ$28,400");
  });

  it("treats a configured but expired session as account recovery, never as demo", () => {
    accountHook.current = persistence("error", "Your sign-in session is no longer available. Try again or sign out, then sign in again.");
    const html = renderToStaticMarkup(createElement(Platform));
    expect(html).toContain('data-testid="account-persistence-error"');
    expect(html).toContain("Your sign-in session is no longer available");
    expect(html).toContain('action="/auth/signout"');
    expect(html).not.toContain("Skip — explore with demo data");
  });

  it("also blocks an account autosave error instead of leaving stale account UI interactive", () => {
    accountHook.current = { ...persistence("account", "save failed"), accountId: "acct-1" };
    const html = renderToStaticMarkup(createElement(Platform));
    expect(html).toContain('data-testid="account-persistence-error"');
    expect(html).toContain("I couldn’t save your latest account state.");
    expect(html).toContain("save failed");
    expect(html).not.toContain("Not saved — retrying");
  });
});
