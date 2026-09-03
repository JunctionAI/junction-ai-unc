import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260903140410_harden_rpc_tenant_boundaries.sql",
  ),
  "utf8",
)
  .replace(/--[^\n]*/g, "")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

describe("RPC tenant-boundary migration", () => {
  it.each([
    "public.match_memories(uuid, vector, integer, text[])",
    "public.match_playbooks(vector, integer, text[])",
  ])("keeps %s callable by the service role only", (signature) => {
    for (const role of ["public", "anon", "authenticated"]) {
      expect(migration).toContain(
        `revoke all on function ${signature} from ${role};`,
      );
    }
    expect(migration).toContain(
      `grant execute on function ${signature} to service_role;`,
    );
  });

  it("role-scopes the shared playbook read policy without auth.role()", () => {
    expect(migration).toContain(
      "drop policy if exists authed_read on public.playbooks;",
    );
    expect(migration).toContain(
      "create policy authed_read on public.playbooks for select to authenticated using (true);",
    );
    expect(migration).not.toContain("auth.role()");
  });
});
