/* SERVER ONLY — imports next/headers; never import from a client component.
   Request-bound locale resolution for server components (the landing page, /app). */

import { cookies, headers } from "next/headers";
import { COUNTRY_COOKIE, COUNTRY_HEADER, resolveLocale, type ResolvedLocale } from "./resolve";

/** `override` is the page's `?country=` search param (server components get it as a prop,
    not from the request URL). */
export async function resolveLocaleForRequest(override?: string | string[] | null): Promise<ResolvedLocale> {
  const [h, c] = await Promise.all([headers(), cookies()]);
  return resolveLocale({
    override: Array.isArray(override) ? override[0] : override,
    cookie: c.get(COUNTRY_COOKIE)?.value ?? null,
    header: h.get(COUNTRY_HEADER),
  });
}
