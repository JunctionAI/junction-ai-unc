/* Typed action library — public surface. See docs/ACTIONS.md. */

export * from "./types";
export { ACTIONS, ACTION_IDS, getAction, isActionId, risksOf, pickDeclaredParams, idempotencyKey, describeActionsForPrompt, type AnyAction } from "./registry";
export { DEFAULT_META_PRESET, INDUSTRY_META_PRESETS, META_INDUSTRIES, withPresetDefaults, resolveMetaPreset, staticPresetSource, describePreset, type MetaPreset, type MetaIndustry, type PresetSource } from "./presets";
export { META_ACTIONS, readPerformance, adsetPause, adsetResume, adsetSetDailyBudget, adPause, adResume, adRotate, campaignCreateFromBrief, creativeUploadImageFromUrl, budgetGuards, DATE_PRESETS, OBJECTIVES } from "./meta/actions";
export { META_GRAPH_VERSION, META_GRAPH_BASE, REDACTED_BEARER, mapMetaError, parseRateLimit, toMinorUnits, fromMinorUnits, redactId, encodeBody } from "./meta/graph";
export { toPerformanceRow, summarise, type PerformanceRow, type PerformanceSummary } from "./meta/insights";
export { evaluateAdset, evaluateAdsets, adsetMetricsFromRow, scaledBudget, ctrDropPct, META_ADSET_RULES, VERDICT_PRIORITY, type AdsetMetrics, type Evaluation, type AccountEvaluation, type Verdict, type Rule } from "./rules/meta";
export { RulesDecisionProvider, RULE_BINDINGS, findBinding, numbersAreGrounded, type RuleBinding, type ReasoningWriter, type RulesDecisionOptions } from "./rules/decision";
