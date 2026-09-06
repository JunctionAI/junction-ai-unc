/** SEO package planning, not provider authority. The existing admission path must still
 * validate every selected step at dispatch. No switch enables publishing or another switch.
 * A package is scoped to one tenant, generation, market, and reporting cycle. */
export const SEO_STEPS = [
  { id: "keywords", routineId: "D03-W01", label: "Find relevant searches", dependencies: [] },
  { id: "gaps", routineId: "D03-W02", label: "Choose pages to improve or create", dependencies: ["keywords"] },
  { id: "competitors", routineId: "D03-W06", label: "Check competitor pages", dependencies: [] },
  { id: "ai_visibility", routineId: "D03-W03", label: "Check AI-search visibility", dependencies: [] },
  { id: "page_edits", routineId: "D03-W04", label: "Prepare page title and description edits", dependencies: ["keywords"] },
  // Article creation has no existing SEO routine ID. Explicit capability, never W04 in disguise.
  { id: "articles", routineId: null, label: "Draft the selected articles and internal links", dependencies: ["gaps"] },
  { id: "monitor", routineId: "D03-W05", label: "Check search performance", dependencies: [] },
] as const;
export type SeoStepId = typeof SEO_STEPS[number]["id"];
export interface SeoPackageScope {
  accountId: string;
  contextGeneration: number;
  market: "US" | "NZ" | "AU";
  cycleId: string;
}
export interface SeoStepResult extends SeoPackageScope {
  stepId: SeoStepId;
  artifactId: string;
  artifactRevision: number;
  runId: string;
  completedAt: string;
  validUntil: string;
  /** References are checked against the selected upstream revision, not just its ID. */
  inputs: { artifactId: string; artifactRevision: number }[];
}
export interface SeoPackageInput extends SeoPackageScope {
  now: string;
  enabledRoutineIds: string[];
  prepareArticles: boolean;
  /** Readiness comes from reviewed adapter registration, not catalog membership. */
  readySteps: SeoStepId[];
  results: SeoStepResult[];
}
export interface SeoPackageStep {
  id: SeoStepId;
  label: string;
  routineId: string | null;
  state: "off" | "blocked" | "ready" | "complete";
  reason: string;
  artifactId?: string;
  artifactRevision?: number;
  inputs: { artifactId: string; artifactRevision: number }[];
}

/** Deterministic dependency reconciliation. Completed means a saved draft was supplied by
 * the trusted persistence adapter, not that a website change happened. Clients cannot supply
 * these results directly. Cycles prevent old research being silently reused as current work. */
export function planSeoPackage(input: SeoPackageInput) {
  const now = Date.parse(input.now);
  if (!input.accountId.trim() || !input.cycleId.trim() || !Number.isSafeInteger(input.contextGeneration) ||
      input.contextGeneration < 0 || !Number.isFinite(now) || !["US", "NZ", "AU"].includes(input.market))
    throw new Error("Invalid SEO package scope");
  const current = input.results.filter(r => r.accountId === input.accountId &&
    r.contextGeneration === input.contextGeneration && r.market === input.market && r.cycleId === input.cycleId &&
    r.artifactId.trim() && r.runId.trim() && Number.isSafeInteger(r.artifactRevision) && r.artifactRevision >= 0 &&
    Date.parse(r.completedAt) <= now && Date.parse(r.validUntil) > now);
  const steps: SeoPackageStep[] = [];
  for (const definition of SEO_STEPS) {
    const enabled = definition.routineId ? input.enabledRoutineIds.includes(definition.routineId) : input.prepareArticles;
    const dependencies = definition.dependencies.map(id => steps.find(s => s.id === id)!);
    const inputs = dependencies.filter(s => s.state === "complete").map(s => ({ artifactId: s.artifactId!, artifactRevision: s.artifactRevision! }));
    const result = current.filter(r => r.stepId === definition.id &&
      r.inputs.length === inputs.length && inputs.every(i => r.inputs.some(x => x.artifactId === i.artifactId && x.artifactRevision === i.artifactRevision)))
      .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt) || b.artifactRevision - a.artifactRevision || a.artifactId.localeCompare(b.artifactId))[0];
    const missing = dependencies.filter(s => s.state !== "complete");
    let state: SeoPackageStep["state"], reason: string;
    if (!enabled) { state = "off"; reason = "Not selected. This package will not enable it."; }
    else if (missing.length) { state = "blocked"; reason = `Needs: ${missing.map(s => s.label).join(", ")}.`; }
    else if (result) { state = "complete"; reason = "Saved result available for review; no website change implied."; }
    else if (!input.readySteps.includes(definition.id)) { state = "blocked"; reason = "The required adapter or verified source is not ready."; }
    else { state = "ready"; reason = "Ready for the existing authorised run path; not started yet."; }
    steps.push({ id: definition.id, label: definition.label, routineId: definition.routineId, state, reason, inputs,
      ...(state === "complete" && result ? { artifactId: result.artifactId, artifactRevision: result.artifactRevision } : {}) });
  }
  const selected = steps.filter(s => s.state !== "off");
  const complete = selected.filter(s => s.state === "complete").length;
  return {
    scope: { accountId: input.accountId, contextGeneration: input.contextGeneration, market: input.market, cycleId: input.cycleId },
    steps,
    status: !selected.length ? "off" : complete === selected.length ? "ready_for_review" : "incomplete",
    summary: `${complete} of ${selected.length} selected SEO steps have saved results. Nothing has been published.`,
    publishEnabled: false as const,
  };
}

/** One page owner per reviewed intent cluster in a market. This does not guess semantic
 * similarity from keyword strings: the research adapter must assign evidence-backed intent
 * keys. Different countries must be reconciled separately rather than merged by keyword. */
export interface SeoPageProposal {
  intentKey: string;
  kind: "improve_existing" | "new_article";
  targetUrl?: string;
  sourceArtifactId: string;
}
export function reconcileSeoPageProposals(proposals: SeoPageProposal[]) {
  const groups = new Map<string, SeoPageProposal[]>();
  for (const proposal of proposals) {
    const key = proposal.intentKey.trim().toLowerCase().replace(/\s+/g, " ");
    if (!key || !proposal.sourceArtifactId.trim()) throw new Error("Page proposal needs intent and evidence");
    groups.set(key, [...(groups.get(key) ?? []), proposal]);
  }
  return [...groups.entries()].map(([intentKey, group]) => {
    const existing = group.filter(p => p.kind === "improve_existing");
    const urls = [...new Set(existing.map(p => p.targetUrl?.trim()).filter(Boolean))];
    const conflict = existing.some(p => !p.targetUrl?.trim()) || urls.length > 1;
    return { intentKey, state: conflict ? "needs_review" : "proposed", kind: existing.length ? "improve_existing" : "new_article",
      targetUrl: !conflict && urls.length === 1 ? urls[0] : null,
      sourceArtifactIds: [...new Set(group.map(p => p.sourceArtifactId))],
      reason: conflict ? "Resolve the existing page owner before drafting." : existing.length ? "Improve the existing owner instead of duplicating it with an article." : "One article proposal for this intent; verify against the site inventory before drafting." };
  });
}
