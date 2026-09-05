import { unwrap, type DbClient } from "./types";

export const AUTOMATION_PAUSED_MESSAGE = "Automated routines and briefs are paused while this business setup is verified. Your connections are preserved; you can still use account chat.";

/** Preflight avoids paid work; the SQL trigger is the final write barrier for
 * legacy workers and operations already in flight. This is not a generation fence. */
export async function automationPauseResponse(db: DbClient, accountId: string): Promise<Response | null> {
  try {
    const row = await unwrap<{ automation_paused?: boolean } | null>("accounts.automation_pause",
      db.from("accounts").select("automation_paused").eq("id", accountId).maybeSingle());
    if (!row) throw new Error("Account unavailable");
    return row.automation_paused
      ? Response.json({ error: AUTOMATION_PAUSED_MESSAGE, code: "automation_paused" }, { status: 503 }) : null;
  } catch {
    return Response.json({ error: "Couldn't verify whether account automation is available." }, { status: 503 });
  }
}
