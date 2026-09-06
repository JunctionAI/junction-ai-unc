import type { planSeoPackage, SeoStepId } from "./seoPackage";

const descriptions: Record<SeoStepId, string> = {
  keywords: "keyword research", gaps: "the page opportunities", competitors: "the competitor review",
  ai_visibility: "the AI-search visibility review", page_edits: "the page title and description drafts",
  articles: "the article drafts and internal links", monitor: "the search performance review",
};

/** No extra model call, raw routine codes, provider-controlled links or invented outcomes.
 * This is a status reply, not a claim that ready work has started running. */
export function seoPackageReply(packageState: ReturnType<typeof planSeoPackage>): string {
  const selected = packageState.steps.filter(s => s.state !== "off");
  if (!selected.length) return "your SEO routines are off right now. choose what you'd like me to work on, then set a time.";
  const complete = selected.filter(s => s.state === "complete");
  const ready = selected.filter(s => s.state === "ready");
  const blocked = selected.filter(s => s.state === "blocked");
  const sentences = [complete.length
    ? `i've saved ${complete.map(s => descriptions[s.id]).join(", ")} for review 🔎`
    : "there isn't a completed SEO result to review yet."];
  if (ready.length) sentences.push(`next up: ${ready.map(s => descriptions[s.id]).join(", ")}. ready to run, but not started yet.`);
  if (blocked.length) sentences.push(`still waiting: ${blocked.map(s => descriptions[s.id]).join(", ")}. the package shows what's missing for each.`);
  if (packageState.status === "ready_for_review") sentences.push("everything you selected has a saved result. have a look before we make any website changes.");
  sentences.push("nothing has been published or changed on your website.");
  return sentences.join("\n\n");
}
