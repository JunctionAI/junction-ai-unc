/* Provider factory + the per-platform routing decision, in one place.

   authProviderFor(platform, deps) → { mode: "own" }                       our app (default)
                                   | { mode: "composio" | "nango", provider } a configured provider
                                   | { mode: "composio" | "nango", provider: null, reason }
                                                                             flagged but unusable

   "Unusable" = the provider's API key is absent, or it has no integration handle for the
   platform (env). Both read as an honest fallback on /start — never a half-configured link. */

import { authProviderMode, isPlatformConfigured, type AuthProviderMode } from "../registry";
import { ComposioProvider } from "../composio";
import { NangoProvider } from "../nango";
import type { AuthProvider, AuthProviderId, ProviderDeps } from "./interface";
import type { Platform } from "../../runtime/types";

export type ProviderResolution = { mode: "own" } | { mode: AuthProviderId; provider: AuthProvider } | { mode: AuthProviderId; provider: null; reason: "provider_not_configured" | "no_integration" };

export function makeAuthProvider(id: AuthProviderId, deps: ProviderDeps): AuthProvider | null {
  switch (id) {
    case "composio":
      return ComposioProvider.fromEnv(deps);
    case "nango":
      return NangoProvider.fromEnv(deps);
    default:
      return null;
  }
}

export function authProviderFor(platform: string, deps: ProviderDeps): ProviderResolution {
  const mode: AuthProviderMode = authProviderMode(platform, deps.env);
  if (mode === "own") return { mode };
  const provider = makeAuthProvider(mode, deps);
  if (!provider) return { mode, provider: null, reason: "provider_not_configured" };
  if (!provider.supports(platform as Platform)) return { mode, provider: null, reason: "no_integration" };
  return { mode, provider };
}

/** True iff Connect has a usable path for the platform: our own app, or a configured provider. */
export function isPlatformConnectable(platform: string, deps: ProviderDeps): boolean {
  const r = authProviderFor(platform, deps);
  return r.mode === "own" ? isPlatformConfigured(platform, deps.env) : r.provider !== null;
}
