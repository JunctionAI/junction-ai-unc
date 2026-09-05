import { redirect } from "next/navigation";
import type { Metadata } from "next";
import LandingV2 from "@/components/landing/LandingV2";
import { shopifyInstallForward } from "@/lib/connectors/installForward";
export const metadata: Metadata = {
  title: "Junction AI | Sales and marketing agents for your business",
  description: "Explore business-specific sales and marketing workflows. Join Junction’s private-beta waitlist for research, recommendations and drafts ready for review.",
};

/* Supplied v2 waitlist landing. Paid pricing is not advertised before confirmation;
   billing locale resolution remains in the existing checkout/settings routes.

   One detour: this URL is also the Shopify app's application_url, so a request carrying
   ?shop=&hmac= is a merchant arriving from the App Store — forward it, query intact, to the
   install entry (shopify/REVIEW-CHECKLIST.md §2d). Nothing else about the page changes. */

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const install = shopifyInstallForward(params);
  if (install) redirect(install);
  return <LandingV2 />;
}
