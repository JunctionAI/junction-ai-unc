/* Accounts source — where the worker learns which accounts exist and what
   their AccountContext (currency, monthly budget, approver) is.

   Injected so the loop and the API can run on a static list today and on the
   accounts + resource_profiles tables (via the Supabase store) later. The
   shipped implementation is StaticAccountsSource with one demo account. */

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
