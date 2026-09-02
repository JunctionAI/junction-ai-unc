import Landing from "@/components/landing/Landing";
import { toLocalePricing } from "@/lib/locale/countries";
import { resolveLocaleForRequest } from "@/lib/locale/server";

/* getjunction.ai — the waitlist landing. Server wrapper: resolves the visitor's pricing
   locale (x-vercel-ip-country → cookie → ?country=XX override, see src/lib/locale) and hands
   the client-safe slice to the pixel-ported page in src/components/landing/Landing.tsx. */

export default async function Page({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  const { country } = await searchParams;
  const locale = await resolveLocaleForRequest(country);
  return <Landing pricing={toLocalePricing(locale)} />;
}
