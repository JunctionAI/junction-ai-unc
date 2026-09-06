import type { Store, RunRecord } from "../runtime/store/interface";
import type { RoutineCommand } from "./types";

// Fixed first-party destination. No model/provider-controlled links or Slack mentions.
const APP = "https://junction-unc.vercel.app/app";
const safeTitle = (text: string) => text.replace(/https?:\/\/\S+/gi, "")
  .replace(/[<>@&*_`~\[\]{}\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 110);

/** Summarise only persisted work belonging to this exact run and generation.
 * No extra model call and no invented ranking, revenue or publishing claim. */
export async function savedResultReply(store: Store, c: RoutineCommand, fallback: string): Promise<string> {
  if (!c.runId || c.runId !== c.id) return fallback;
  const run: RunRecord | null = await store.getRun(c.runId);
  if (!run || run.status !== "done" || run.accountId !== c.actor.accountId ||
      run.contextGeneration !== c.contextGeneration || run.routineId !== c.routineId || run.mode !== "dry_run") return fallback;
  const artifacts = await store.listArtifacts(c.actor.accountId, { runId: c.runId, contextGeneration: c.contextGeneration, limit: 2 });
  const a = artifacts.find(a => a.runId === run.id && a.accountId === run.accountId && a.routineId === run.routineId);
  if (!a) return fallback;
  const link = `${APP}?account=${encodeURIComponent(c.actor.accountId)}`;
  const titles = a.items.slice(0, 3).map(i => safeTitle(i.title)).filter(Boolean);
  const heading = a.kind === "keyword_list"
    ? `keyword scan done 🔎 the saved draft contains ${a.items.length} keyword candidates.`
    : `your draft is ready: ${safeTitle(a.title)}.`;
  return [heading, ...titles.map(t => `• ${t}`),
    a.kind === "keyword_list" ? "use these to shortlist search terms for page/content review; they aren't proven winners yet." : "review the findings and supporting sources before acting.",
    `full findings and sources: ${link}`, "nothing was published or changed on your connected platforms."].join("\n");
}
