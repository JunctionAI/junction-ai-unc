/* Credential boundary for the worker's readers.

   Readers never touch process.env and never read .env files. They receive a
   PlatformCredential from an injected CredentialProvider. The ONLY shipped
   implementation is FixtureCredentialProvider, which hands out fixture markers
   (no real tokens) so every routine can dry-run against canned data.

   A real provider (per-account tokens from the connectors table, decrypted
   server-side) is Wave 2 and founder-gated — see src/worker/README.md. Tests
   that exercise live request-shaping construct the typed credential shapes
   below inline with fake values and stub global fetch. */

import type { Platform } from "../lib/runtime/types";

export type PlatformCredential =
  | { kind: "fixture"; platform: Platform; marker: string }
  | { kind: "shopify"; shopDomain: string; accessToken: string }
  | { kind: "klaviyo"; apiKey: string }
  | { kind: "ga4"; propertyId: string; accessToken: string }
  | { kind: "meta_ads"; adAccountId: string; accessToken: string }
  | { kind: "google_ads"; customerId: string; developerToken: string; accessToken: string; loginCustomerId?: string }
  | { kind: "hubspot"; accessToken: string; portalId?: string };

export interface CredentialProvider {
  /** null = nothing connected for this account + platform. */
  get(accountId: string, platform: Platform): Promise<PlatformCredential | null>;
}

/** Fixture markers for every platform. Never returns a real token. */
export class FixtureCredentialProvider implements CredentialProvider {
  constructor(private readonly platforms: "all" | Platform[] = "all") {}
  async get(_accountId: string, platform: Platform): Promise<PlatformCredential | null> {
    if (this.platforms !== "all" && !this.platforms.includes(platform)) return null;
    return { kind: "fixture", platform, marker: `fixture:${platform}` };
  }
}

/** For logs/receipts: what a credential IS, never what it contains. */
export function describeCredential(c: PlatformCredential | null): string {
  if (!c) return "none";
  return c.kind === "fixture" ? c.marker : `${c.kind}:live`;
}
