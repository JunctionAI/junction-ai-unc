/** Pure receiver helpers for Nguyen's Content search wrapper. No network, secrets or DB. */
import { CONTENT_ROUTINES, CONTENT_SEED, contentShadowSchema, type ContentShadowContract } from "./contentShadowContract";
import type { ArtifactDraft } from "../runtime/types";

const row = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const iso = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));

export interface ContentSerpOrganic { rank: number; title: string; url: string; domain: string }
export interface ContentPaaItem { rank: number; question: string }

export function validateContentIncoming(value: unknown, pins: { accountId: string; workflowId: string; routineId: "D01-W02" | "D01-W03" }, now: string) {
  const b = row(value), s = row(b.shadow), parsed = contentShadowSchema.safeParse(b.shadow);
  const details: Record<string, string> = {};
  const check = (pass: unknown, field: string, message: string) => { if (!pass) details[field] = message; };
  check(uuid(pins.accountId) && pins.workflowId.length > 0, "binding", "Receiver binding must be configured");
  check(parsed.success, "shadow.contract", "The content search shadow protocol is required");
  check(b.accountId === pins.accountId && s.accountId === pins.accountId, "accountId", "Account must match this receiver binding");
  check(uuid(b.runId), "runId", "A stored run UUID is required");
  check(b.routineId === pins.routineId && b.mode === "dry_run" && b.kind === CONTENT_ROUTINES[pins.routineId].kind,
    "routineId", "Only the selected Content draft routine is supported");
  check(parsed.success && parsed.data.routineId === pins.routineId && parsed.data.workflowId === pins.workflowId,
    "shadow.workflowId", "Expected receiver identity is required");
  check(parsed.success && parsed.data.client.seedKeyword === CONTENT_SEED, "shadow.client", "Approved AVGAR seed is required");
  check(iso(b.startedAt) && iso(now) && Date.parse(now) - Date.parse(String(b.startedAt)) >= -30_000
    && Date.parse(now) - Date.parse(String(b.startedAt)) <= 900_000, "startedAt", "The stored run must be current");
  check(typeof b.dataToken === "string" && b.dataToken.length >= 32 && !/[\r\n\s]/.test(b.dataToken),
    "dataToken", "A run-scoped authorization token is required");
  const valid = Object.keys(details).length === 0;
  return { valid, validationError: valid ? null : "Content request does not match the receiver contract", details };
}

export function contentNeeds(why: string) {
  return { needs: [{ input: "search_results", why }] };
}

export function buildHooksArtifact(rows: ContentSerpOrganic[], contract: ContentShadowContract, fetchedAt: string): ArtifactDraft {
  if (contract.routineId !== "D01-W02") throw new Error("hooks builder requires D01-W02");
  const items = rows.filter(r => r.title.trim() && r.url.trim()).slice(0, 8).map(r => ({
    title: r.title.trim().slice(0, 200),
    body: `Hook line: ${r.title.trim()}\nSkeleton: scroll-stopper reframe of a ranking SERP title for "${contract.client.seedKeyword}"\nMechanic: short-form cut from organic title only\nWhy: ranking #${r.rank} organic title (${r.domain})\nHow to shoot: TBD founder/creator brief — not evidenced\nStatus: hypothesis`,
    meta: { status: "hypothesis" as const, source: "search", mechanic: "serp_title_reframe", domain: r.domain, rank: r.rank, views: null, measured: false },
  }));
  if (!items.length) throw new Error("empty_serp");
  return {
    kind: "hook_list",
    title: `${items.length} search hook hypotheses for ${contract.client.seedKeyword}`,
    body: `Hooks are hypothesis reframes of DataForSEO SERP organic titles for seed "${contract.client.seedKeyword}". Not measured creative performance. SERP snapshots are not GSC clicks or impressions.`,
    items,
    evidence: [{ source: "dataforseo_serp", ref: `dataforseo_serp_organic seed=${contract.client.seedKeyword} location=${contract.client.locationCode} fetched_at=${fetchedAt}` },
      { source: "search_query", ref: contract.client.seedKeyword }],
  };
}

export function buildQuestionsArtifact(rows: ContentPaaItem[], contract: ContentShadowContract, fetchedAt: string): ArtifactDraft {
  if (contract.routineId !== "D01-W03") throw new Error("questions builder requires D01-W03");
  const items = rows.filter(r => r.question.trim()).slice(0, 10).map(r => ({
    title: r.question.trim().slice(0, 200),
    body: `Question: ${r.question.trim()}\nContent idea: AVGAR-relevant answer/comparison piece staged from this People Also Ask result only\nFormat: TBD (article/short/FAQ)\nStage: awareness/consideration hypothesis\nFrequency: null (unmeasured)`,
    meta: { frequency: null, question_source_type: "search_paa", source: "search", stage: "hypothesis", rank: r.rank },
  }));
  if (!items.length) throw new Error("empty_paa");
  return {
    kind: "question_list",
    title: `${items.length} search questions for ${contract.client.seedKeyword}`,
    body: `Questions from DataForSEO People Also Ask for seed "${contract.client.seedKeyword}". Frequency unmeasured. Search research, not from tickets or support.`,
    items,
    evidence: [{ source: "dataforseo_serp", ref: `dataforseo_serp_people_also_ask seed=${contract.client.seedKeyword} location=${contract.client.locationCode} fetched_at=${fetchedAt}` },
      { source: "search_query", ref: contract.client.seedKeyword }],
  };
}
