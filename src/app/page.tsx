import { redirect } from "next/navigation";
import Landing from "@/components/landing/Landing";
import { shopifyInstallForward } from "@/lib/connectors/installForward";
import { toLocalePricing } from "@/lib/locale/countries";
import { resolveLocaleForRequest } from "@/lib/locale/server";

/* getjunction.ai — the waitlist landing. Server wrapper: resolves the visitor's pricing
   locale (x-vercel-ip-country → cookie → ?country=XX override, see src/lib/locale) and hands
   the client-safe slice to the pixel-ported page in src/components/landing/Landing.tsx.

   One detour: this URL is also the Shopify app's application_url, so a request carrying
   ?shop=&hmac= is a merchant arriving from the App Store — forward it, query intact, to the
   install entry (shopify/REVIEW-CHECKLIST.md §2d). Nothing else about the page changes. */

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const install = shopifyInstallForward(params);
  if (install) redirect(install);
  const country = typeof params.country === "string" ? params.country : undefined;
  const locale = await resolveLocaleForRequest(country);
  return <Landing pricing={toLocalePricing(locale)} />;
}
