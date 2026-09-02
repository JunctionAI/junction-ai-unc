/* Unc routines runtime — public surface. Pure TypeScript, no I/O of its own:
   reads, decisions, executions and persistence are all injected. */

export * from "./types";
export { runRoutine, resumeRun, capsFor } from "./engine";
export type { Adapters, RunOptions, ResumeOptions } from "./engine";
export { validateSpec, assertValidSpec, SpecValidationError, isValidCadence, PLATFORMS, ROUTINE_ID_RE } from "./validate";
export type { ValidationIssue } from "./validate";
export {
  getOrInitState,
  effectiveSpec,
  saveDraft,
  discardDraft,
  validateDraft,
  latestDryRunFor,
  promoteDraft,
  setEnabled,
  dryRunPassed,
  PromoteRefusedError,
} from "./versioning";
export type { VersioningDeps, DryRunOutcome } from "./versioning";
export { DeterministicDecisionProvider, StaticReader, FailingReader } from "./providers";
export type { Fixtures, FixtureKey } from "./providers";
export { MemoryStore } from "./store/memory";
export type { Store, RoutineStateRecord, RunRecord, RunSnapshot, ListRunsOptions, ListReceiptsOptions } from "./store/interface";
export { CATALOG_SPECS, CATALOG_SPEC_BY_ID, catalogSpec, WAVE_1_IDS, CADENCE } from "./catalog-specs";
export { renderTemplate, resolvePath, evaluatePredicate, resolveSpend, stableHash } from "./context";
