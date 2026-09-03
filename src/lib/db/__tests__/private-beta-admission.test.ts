import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const compact = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/--[^\n]*/g, "").replace(/\s+/g, " ").toLowerCase();
const migration = compact("supabase/migrations/20260903144000_private_beta_admission.sql");
const login = readFileSync(resolve(root, "src/app/login/LoginForm.tsx"), "utf8");
const session = readFileSync(resolve(root, "src/lib/db/session.ts"), "utf8");

describe("private-beta admission", () => {
  it("revokes self-serve account creation from every client role", () => {
    for (const role of ["public", "anon", "authenticated"]) {
      expect(migration).toContain(`revoke all on function public.create_account(text, text) from ${role};`);
    }
  });

  it("the magic-link form never creates an unknown Auth user", () => {
    expect(login).toContain("shouldCreateUser: false");
    expect(login).toContain("private beta is invite-only");
  });

  it("server sessions cannot fall through to create_account", () => {
    expect(session).not.toContain("createAccount(db)");
    expect(session).toContain('code: "invite_required"');
  });
});
