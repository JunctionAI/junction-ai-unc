import Platform from "@/components/platform/Platform";
import { getBillingForRequest, pricingForRequest } from "@/lib/billing/server";

export const metadata = {
  title: "Junction — Your sales and marketing workspace",
};

/* Billing (Phase 6) is resolved here, server-side: demo unless STRIPE_* + Supabase env are
   present, in which case the founder's entitlement gates the control centre. The pricing
   locale rides along so the paywall shows the founder's country price. */
export default async function AppPage({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  const { country } = await searchParams;
  const [billing, pricing] = await Promise.all([getBillingForRequest(), pricingForRequest(country)]);
  return <Platform billing={{ ...billing, pricing }} />;
}
