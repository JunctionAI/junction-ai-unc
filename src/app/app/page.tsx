import Platform from "@/components/platform/Platform";
import { getBillingForRequest } from "@/lib/billing/server";

export const metadata = {
  title: "Junction — Growth operating agent",
};

/* Billing (Phase 6) is resolved here, server-side: demo unless STRIPE_* + Supabase env are
   present, in which case the founder's entitlement gates the control centre. */
export default async function AppPage() {
  const billing = await getBillingForRequest();
  return <Platform billing={billing} />;
}
