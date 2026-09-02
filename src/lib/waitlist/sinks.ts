/* SERVER ONLY — the real sinks behind recordWaitlist (env-gated, process.env only, nothing
   logged beyond a one-line failure). See ./store.ts for the cascade. */

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { getServiceSupabase, isServiceRoleConfigured } from "@/lib/db/server";
import type { Sink, WaitlistEntry, WaitlistSinks } from "./store";

export const WAITLIST_FROM = "Unc <tom@getjunction.ai>";
export const WAITLIST_TO = "tom@getjunction.ai";
export const RESEND_URL = "https://api.resend.com/emails";

/** Service-role insert. A unique violation (23505) is a duplicate signup — recorded already. */
export function dbSink(): Sink | null {
  if (!isServiceRoleConfigured()) return null;
  return async (entry: WaitlistEntry) => {
    const service = getServiceSupabase();
    const { error } = await service.from("waitlist").insert({
      email: entry.email,
      country: entry.country,
      source: entry.source,
      referrer: entry.referrer,
      created_at: entry.createdAt,
    });
    if (!error) return;
    if (error.code === "23505") return "duplicate";
    throw new Error(error.code ? `db ${error.code}` : "db insert failed");
  };
}

/** Notification to Tom via Resend's HTTP API — a plain fetch, no SDK (no new dependencies). */
export function emailSink(fetchImpl: typeof fetch = fetch, env: Record<string, string | undefined> = process.env): Sink | null {
  const key = (env.RESEND_API_KEY || "").trim();
  if (!key) return null;
  return async (entry: WaitlistEntry) => {
    const res = await fetchImpl(RESEND_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: WAITLIST_FROM,
        to: [WAITLIST_TO],
        subject: `Waitlist: ${entry.email}`,
        text: [`New waitlist signup`, ``, `Email:    ${entry.email}`, `Country:  ${entry.country ?? "—"}`, `Source:   ${entry.source ?? "—"}`, `Referrer: ${entry.referrer ?? "—"}`, `At:       ${entry.createdAt}`].join("\n"),
      }),
    });
    if (!res.ok) throw new Error(`resend ${res.status}`);
  };
}

/** Last resort: one JSON line per signup under .data/ (gitignored). */
export function fileSink(dataDir = path.join(process.cwd(), ".data")): Sink {
  return async (entry: WaitlistEntry) => {
    await mkdir(dataDir, { recursive: true });
    await appendFile(path.join(dataDir, "waitlist.jsonl"), JSON.stringify(entry) + "\n", "utf8");
  };
}

export function defaultSinks(): WaitlistSinks {
  return { db: dbSink(), email: emailSink(), file: fileSink() };
}
