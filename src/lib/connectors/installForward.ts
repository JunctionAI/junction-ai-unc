/* Client-safe half of the Shopify App Store install entry (no node: imports — the landing
   page's server component and the tests import it). Paths + the landing forward.

   Shopify sends a merchant who clicks Install (or "Open app" in admin) to application_url —
   the landing page — with ?shop=&hmac=&timestamp=&host=. The landing forwards that, query
   intact, to /api/connectors/shopify/install (src/lib/connectors/install.ts), which verifies
   the HMAC and starts the OAuth flow. Everything is forwarded because Shopify signs every
   param: dropping one would break the HMAC check on the other side. */

export const INSTALL_PATH = "/api/connectors/shopify/install";
export const RESUME_PATH = `${INSTALL_PATH}/resume`;

/** The install-route URL for a landing request carrying ?shop=&hmac=, else null. */
export function shopifyInstallForward(params: Record<string, string | string[] | undefined>): string | null {
  const shop = params.shop;
  const hmac = params.hmac;
  if (typeof shop !== "string" || !shop.trim() || typeof hmac !== "string" || !hmac.trim()) return null;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string") qs.append(k, v);
    else if (Array.isArray(v)) for (const x of v) qs.append(k, x);
  }
  return `${INSTALL_PATH}?${qs.toString()}`;
}
