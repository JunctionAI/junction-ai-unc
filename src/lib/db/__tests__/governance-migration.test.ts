import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const file = "supabase/migrations/20260903142609_owner_governed_runtime_tables.sql";
const migration = readFileSync(resolve(process.cwd(), file), "utf8")
  .replace(/--[^\n]*/g, "")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

const governed = ["connectors", "routine_states", "routine_runs", "approvals", "receipts", "taste_events", "artifacts", "account_model_prefs", "account_presets", "routine_params"];
const ownerEditable = ["goals", "resource_profiles", "team_members", "plans", "business_profiles", "account_state_meta", "account_profiles"];

describe("owner-governed runtime-table migration", () => {
  it("replaces blanket member writes with tenant-scoped authenticated reads", () => {
    expect(migration).toContain("drop policy if exists member_all on public.%i");
    expect(migration).toContain("create policy member_read on public.%i for select to authenticated using (public.is_account_member(account_id))");
    expect(migration).toContain("revoke all on table public.%i from anon, authenticated");
    expect(migration).toContain("grant select on table public.%i to authenticated");
  });

  it.each(governed)("includes %s in the governed table allowlist", (table) => {
    expect(migration).toContain(`'${table}'`);
  });

  it.each(ownerEditable)("makes %s member-readable but owner-writable", (table) => {
    expect(migration).toContain(`'${table}'`);
  });

  it("binds owner-editable policies to the current user's owner membership", () => {
    expect(migration).toContain("create policy owner_write on public.%i for all to authenticated");
    expect(migration).toContain("m.user_id = auth.uid() and m.role = 'owner'");
    expect(migration).toContain("grant select, insert, update, delete on table public.%i to authenticated");
  });

  it("prevents a member from raising the account cap through the browser", () => {
    expect(migration).toContain("drop policy if exists member_update on public.accounts;");
    expect(migration).toContain("create policy owner_update on public.accounts");
    expect(migration).toContain("grant update (name, currency) on table public.accounts to authenticated;");
    expect(migration).not.toContain("grant update (monthly_llm_cap_usd)");
  });

  it("runs the policy and grant changes atomically", () => {
    expect(migration.startsWith("begin;")).toBe(true);
    expect(migration.endsWith("commit;")).toBe(true);
  });
});
