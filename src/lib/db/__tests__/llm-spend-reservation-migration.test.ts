import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const file = "supabase/migrations/20260903211025_llm_spend_reservations.sql";
const migration = readFileSync(resolve(process.cwd(), file), "utf8")
  .replace(/--[^\n]*/g, "")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

describe("atomic LLM spend-reservation migration", () => {
  it("creates a private-by-default durable reservation table in one forward transaction", () => {
    expect(migration.startsWith("begin;")).toBe(true);
    expect(migration.endsWith("commit;")).toBe(true);
    expect(migration).toContain("create table llm_spend_reservations");
    expect(migration).toContain("ceiling_usd numeric not null check (ceiling_usd > 0)");
    expect(migration).toContain("alter table llm_spend_reservations enable row level security;");
    expect(migration).toContain("revoke all on table llm_spend_reservations from public, anon, authenticated;");
    expect(migration).toContain("grant select, insert, delete on table llm_spend_reservations to service_role;");
  });

  it("serialises admission on the account before summing UTC-month usage and every active reservation", () => {
    expect(migration).toContain("from public.accounts as a where a.id = p_account_id for update;");
    expect(migration).toContain("from public.llm_usage as u where u.account_id = p_account_id and u.created_at >= v_month_start and u.created_at < v_month_start + interval '1 month';");
    expect(migration).toContain("from public.llm_spend_reservations as r where r.account_id = p_account_id and r.expires_at > v_now;");
    expect(migration).not.toContain("r.month_start = v_month_date");
    expect(migration).toContain("if v_spent + v_reserved + p_ceiling_usd > v_cap then");
    expect(migration).toContain("v_expires_at := v_month_start + interval '1 month 30 minutes';");
    expect(migration).toContain("insert into public.llm_spend_reservations");
  });

  it.each([
    "public.reserve_llm_spend(uuid, numeric, numeric)",
    "public.release_llm_spend_reservation(uuid, uuid)",
  ])("keeps %s service-role-only and security-invoker", (signature) => {
    expect(migration).toContain(`revoke all on function ${signature} from public, anon, authenticated;`);
    expect(migration).toContain(`grant execute on function ${signature} to service_role;`);
    expect(migration).not.toContain("security definer");
  });

  it("locks the same account before an account-scoped release", () => {
    expect(migration).toContain("create function public.release_llm_spend_reservation");
    expect(migration).toContain("delete from public.llm_spend_reservations as r where r.id = p_reservation_id and r.account_id = p_account_id;");
  });
});
