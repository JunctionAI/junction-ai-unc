/* Accounts source — where the worker learns which accounts exist and what
   their AccountContext (currency, monthly budget, approver) is.

   Two implementations:
     StaticAccountsSource — one `demo` account (demo mode, tests).
     DbAccountsSource     — accounts + resource_profiles + team_members through the
                            service-role DbClient. listAccounts() = every account with at
                            least one enabled routine (the loop's tick set); getAccount()
                            resolves any account id (a manual trigger may come from an
                            account that has nothing enabled yet).
   Which one runs is decided in wiring.ts from the environment. */

import { unwrap, type DbClient } from "../lib/db/types";
import type { AccountContext } from "../lib/runtime/types";

export interface WorkerAccount {
  account: AccountContext;
  /** Free-form template variables (vars.<key>) — e.g. niche, hashtags, competitorDomains. */
  vars?: Record<string, unknown>;
}

export interface AccountsSource {
  listAccounts(): Promise<WorkerAccount[]>;
  getAccount(accountId: string): Promise<WorkerAccount | null>;
}

export const DEMO_ACCOUNT: WorkerAccount = {
  account: { accountId: "demo", currency: "NZD", budgetMonthly: 3000, approver: "the founder" },
  vars: { niche: "natural health", hashtags: "#nzmade #supplements", region: "NZ", website: "example.com", competitorDomains: "competitor-a.com,competitor-b.com", buyerPrompts: "best marine collagen nz" },
};

export class StaticAccountsSource implements AccountsSource {
  constructor(private readonly accounts: WorkerAccount[] = [DEMO_ACCOUNT]) {}
  async listAccounts() {
    return [...this.accounts];
  }
  async getAccount(accountId: string) {
    return this.accounts.find((a) => a.account.accountId === accountId) ?? null;
  }
}

/** Fallback approver when no team member is marked as approving anything. */
export const DEFAULT_APPROVER = "the founder";

export class DbAccountsSource implements AccountsSource {
  constructor(private readonly db: DbClient) {}

  /** Accounts with ≥ 1 enabled routine — the only ones a scheduled tick can have work for. */
  async listAccounts(): Promise<WorkerAccount[]> {
    const rows = await unwrap<{ account_id: string }[]>("routine_states.select", this.db.from("routine_states").select("account_id").eq("enabled", true));
    const ids = [...new Set(rows.map((r) => r.account_id))];
    const out: WorkerAccount[] = [];
    for (const id of ids) {
      const acct = await this.getAccount(id);
      if (acct) out.push(acct);
    }
    return out;
  }

  async getAccount(accountId: string): Promise<WorkerAccount | null> {
    const account = await unwrap<{ id: string; currency: string } | null>("accounts.select", this.db.from("accounts").select("id, currency").eq("id", accountId).maybeSingle());
    if (!account) return null;
    const [profile, team] = await Promise.all([
      unwrap<{ budget_monthly: number | string | null; website: string | null } | null>(
        "resource_profiles.select",
        this.db.from("resource_profiles").select("budget_monthly, website").eq("account_id", accountId).maybeSingle(),
      ),
      unwrap<{ name: string; approves: string | null }[]>("team_members.select", this.db.from("team_members").select("name, approves").eq("account_id", accountId).order("position", { ascending: true })),
    ]);
    const budgetMonthly = Number(profile?.budget_monthly ?? 0);
    const approver = team.find((m) => (m.approves ?? "").trim() && m.name.trim())?.name.trim() ?? DEFAULT_APPROVER;
    const vars: Record<string, unknown> = {};
    if (profile?.website) vars.website = profile.website;
    return { account: { accountId: account.id, currency: account.currency || "NZD", budgetMonthly: Number.isFinite(budgetMonthly) ? budgetMonthly : 0, approver }, vars };
  }
}
