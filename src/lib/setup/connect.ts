/* Client side of "Connect" from the guided step — one call into the existing connector start
   path (POST /api/connectors/<platform>/start, owned by the connectors module). This helper
   only shapes the answer so the step can say the honest thing:

     redirect   the browser is being sent to the platform's OAuth screen
     fallback   the platform isn't switched on yet → "Connect with a token" (Connectors view)
     shop       Shopify needs the store domain first
     signIn     no session
     error      anything else, with the server's line

   Demo mode never gets here (the guided steps only render in accounts mode). No secret ever
   passes through: the response carries a URL or a reason, nothing else. */

export type ConnectStart = { kind: "redirect"; url: string } | { kind: "fallback"; reason: string } | { kind: "shop" } | { kind: "signIn" } | { kind: "error"; message: string };
import type { AccountFetch } from "@/lib/db/accountRequest";

type StartResponse = { url?: string; fallback?: boolean; reason?: string; error?: string };

export async function startConnect(platform: string, opts: { shop?: string; fetch?: AccountFetch } = {}): Promise<ConnectStart> {
  if (platform === "shopify" && !opts.shop) return { kind: "shop" };
  const f = opts.fetch ?? fetch;
  try {
    const res = await f(`/api/connectors/${encodeURIComponent(platform)}/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(opts.shop ? { shop: opts.shop } : {}),
    });
    const data = (await res.json().catch(() => ({}))) as StartResponse;
    if (res.status === 401) return { kind: "signIn" };
    if (res.ok && typeof data.url === "string" && data.url) return { kind: "redirect", url: data.url };
    if (res.ok && data.fallback) return { kind: "fallback", reason: data.reason ?? "platform_not_configured" };
    return { kind: "error", message: data.error ?? `couldn’t start the connection (${res.status})` };
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/** The email question's answer becomes a founder-stated memory (POST /api/brain/memories) so
    Unc never asks twice; the known_platforms write is the client's (derive addKnownPlatform →
    autosave). Fire-and-forget by design: a failed memory write never blocks the step. */
export const EMAIL_ANSWER_MEMORY: Record<"klaviyo" | "mailchimp" | "none", string> = {
  klaviyo: "Email is sent with Klaviyo.",
  mailchimp: "Email is sent with Mailchimp (no connector for it yet).",
  none: "No email tool yet — nothing sends email today; email routines wait until there is one.",
};

export async function recordEmailAnswer(answer: "klaviyo" | "mailchimp" | "none", opts: { fetch?: AccountFetch; contextGeneration?: number } = {}): Promise<boolean> {
  const f = opts.fetch ?? fetch;
  try {
    const res = await f("/api/brain/memories", { method: "POST", headers: { "content-type": "application/json", "x-unc-context-generation": String(opts.contextGeneration ?? 0) }, body: JSON.stringify({ text: EMAIL_ANSWER_MEMORY[answer], kind: "fact" }) });
    if (res.ok) return true;
    // Context conflicts are not duplicates and must never be reported as remembered.
    return res.status === 409 && (await res.json()).code === "already_exists";
  } catch {
    return false;
  }
}

/** Copy for the guided step, Unc's voice (the connectors module keeps its own for its view). */
export const CONNECT_STEP_COPY = {
  notSwitchedOn: "Not switched on yet — I'll tell you the moment it is.",
  withToken: "Connect with a token",
  connected: "Connected ✓ — I'll read your last 90 days tonight and confirm the numbers here.",
  reading: "Reading your last 90 days now…",
  signIn: "Sign in first, then I can connect it.",
  failed: "That didn't go through. Nothing was stored — try again in a minute.",
  shopPrompt: "your-store.myshopify.com",
  later: "I'll do this later",
} as const;
