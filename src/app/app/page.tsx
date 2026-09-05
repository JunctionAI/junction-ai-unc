import Platform from "@/components/platform/Platform";
import { getBillingForRequest, pricingForRequest } from "@/lib/billing/server";
import { accountChoicesForRequest } from "@/lib/db/accountChoices";
import { selectAccountMembership } from "@/lib/db/accountSelection";
import AccountPicker from "@/components/platform/AccountPicker";
import { AccountScopeProvider } from "@/components/platform/AccountScope";

export const metadata = {
  title: "Junction — Your sales and marketing workspace",
};

/* Billing (Phase 6) is resolved here, server-side: demo unless STRIPE_* + Supabase env are
   present, in which case the founder's entitlement gates the control centre. The pricing
   locale rides along so the paywall shows the founder's country price. */
export default async function AppPage({ searchParams }: { searchParams: Promise<{ country?: string; account?: string | string[] }> }) {
  const { country, account } = await searchParams;
  const access = await accountChoicesForRequest();
  const selection = selectAccountMembership(access.choices, account);
  if (access.error || (!selection.ok && (access.choices.length > 0 || account !== undefined)))
    return <AccountPicker choices={access.choices} error={access.error ?? (account !== undefined ? "That client selection is unavailable. Choose a workspace you can access." : null)} />;
  const accountId = selection.ok ? selection.membership.accountId : null;
  const [billing, pricing] = await Promise.all([getBillingForRequest(accountId), pricingForRequest(country)]);
  return <AccountScopeProvider key={accountId ?? "unselected"} accountId={accountId} choices={access.choices}>
    <Platform billing={{ ...billing, pricing }} />
  </AccountScopeProvider>;
}
