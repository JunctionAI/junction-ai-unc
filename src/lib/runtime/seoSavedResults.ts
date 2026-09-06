import type { Store } from "./store/interface";
import { SEO_STEPS, type SeoPackageScope, type SeoStepId, type SeoStepResult } from "./seoPackage";

const expectedKinds: Partial<Record<SeoStepId, string>> = {
  keywords: "keyword_list", gaps: "content_gap", competitors: "content_gap",
  ai_visibility: "content_gap", page_edits: "generic", monitor: "generic",
};

/** Written by the package controller when admitting a step, never accepted from chat.
 * Market/cycle membership cannot be inferred from an artifact title or keyword. */
export interface SeoResultBinding extends SeoPackageScope {
  stepId: SeoStepId;
  routineId: string;
  runId: string;
  artifactId: string;
  artifactRevision: number;
  specHash: string;
  validUntil: string;
  inputs: SeoStepResult["inputs"];
}

/** Independent persistence readback. A proposed binding does not prove completion. */
export async function readSavedSeoResults(
  store: Pick<Store, "getRun" | "getArtifact">,
  scope: SeoPackageScope,
  bindings: SeoResultBinding[],
  now: string,
): Promise<{ results: SeoStepResult[]; rejected: { artifactId: string; reason: string }[] }> {
  if (bindings.length > 50 || !Number.isFinite(Date.parse(now))) throw new Error("Invalid SEO result read request");
  const results: SeoStepResult[] = [];
  const rejected: { artifactId: string; reason: string }[] = [];
  for (const binding of bindings) {
    const definition = SEO_STEPS.find(s => s.id === binding.stepId);
    if (binding.accountId !== scope.accountId || binding.contextGeneration !== scope.contextGeneration ||
        binding.market !== scope.market || binding.cycleId !== scope.cycleId || !definition ||
        // Article producer mapping must be implemented before accepting article completion.
        !definition.routineId || definition.routineId !== binding.routineId ||
        !binding.specHash || Date.parse(binding.validUntil) <= Date.parse(now) || !Number.isFinite(Date.parse(binding.validUntil))) {
      rejected.push({ artifactId: binding.artifactId, reason: "Result binding is outside the current package or unsupported." });
      continue;
    }
    const [run, artifact] = await Promise.all([store.getRun(binding.runId), store.getArtifact(binding.artifactId)]);
    if (!run || !artifact || run.accountId !== scope.accountId || artifact.accountId !== scope.accountId ||
        (run.contextGeneration ?? 0) !== scope.contextGeneration || run.routineId !== binding.routineId ||
        artifact.routineId !== binding.routineId || run.id !== binding.runId || artifact.runId !== run.id ||
        artifact.id !== binding.artifactId || artifact.kind !== expectedKinds[binding.stepId] ||
        run.specHash !== binding.specHash || run.status !== "done" ||
        run.mode !== "dry_run" || !run.finishedAt || !Number.isFinite(Date.parse(run.finishedAt)) ||
        Date.parse(run.finishedAt) > Date.parse(now) || (artifact.revision ?? 0) !== binding.artifactRevision ||
        !["draft", "approved", "edited"].includes(artifact.status)) {
      rejected.push({ artifactId: binding.artifactId, reason: "Saved run or draft does not match the admitted result revision." });
      continue;
    }
    results.push({ ...scope, stepId: binding.stepId, artifactId: artifact.id, artifactRevision: artifact.revision ?? 0,
      runId: run.id, completedAt: run.finishedAt, validUntil: binding.validUntil,
      inputs: binding.inputs.map(i => ({ ...i })) });
  }
  return { results, rejected };
}
