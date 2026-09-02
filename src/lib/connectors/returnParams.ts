/* Client side of the Connect flow — what happens when the platform sends the founder back.

   The callback redirects to /app?connected=<platform> or /app?connect_error=<platform>.
   readConnectReturn() parses that, applyConnectReturn() patches connState (the persistence
   layer's autosave/load makes it durable) and opens the Connectors view, then strips the
   params so a reload doesn't replay it. The result is parked for ConnectorsView to show
   one line in Unc's voice. In demo mode the params never appear, so nothing here runs. */

import { CONNECTOR_PLATFORMS } from "@/lib/db/mapping";
import type { Setter } from "@/lib/platform/state";

export interface ConnectReturn {
  kind: "connected" | "error";
  platform: string;
  /** Card name (connState key). */
  name: string;
}

const NAME_BY_PLATFORM: Record<string, string> = Object.fromEntries(Object.entries(CONNECTOR_PLATFORMS).map(([n, p]) => [p, n]));

export function readConnectReturn(search: string): ConnectReturn | null {
  const params = new URLSearchParams(search);
  const connected = params.get("connected");
  const failed = params.get("connect_error");
  const platform = connected || failed;
  if (!platform) return null;
  const name = NAME_BY_PLATFORM[platform];
  if (!name) return null;
  return { kind: connected ? "connected" : "error", platform, name };
}

let parked: ConnectReturn | null = null;

/** The last return (ConnectorsView reads it while mounting, then clears it). */
export function peekConnectReturn(): ConnectReturn | null {
  return parked;
}

export function clearConnectReturn(): void {
  parked = null;
}

/** Runs once on /app mount. No-op without the params. */
export function applyConnectReturn(set: Setter): void {
  if (typeof window === "undefined") return;
  const r = readConnectReturn(window.location.search);
  if (!r) return;
  parked = r;
  set((s) => ({ connState: { ...s.connState, [r.name]: r.kind === "connected" ? "ok" : "expired" }, view: "connectors" }));
  const url = new URL(window.location.href);
  url.searchParams.delete("connected");
  url.searchParams.delete("connect_error");
  window.history.replaceState(window.history.state, "", url.pathname + (url.search || "") + url.hash);
}

/** Copy in Unc's voice for the inline card note. */
export const CONNECT_COPY = {
  notSwitchedOn: "Not switched on yet — I'll tell you the moment it is.",
  connected: "Connected. I'll read it tonight and show you the receipt.",
  failed: "That didn't go through. Nothing was stored — try again in a minute.",
  signIn: "Sign in first, then I can connect it.",
  shopPrompt: "your-store.myshopify.com",
} as const;
