/* Unc routines runtime — core types.

   A routine is a RoutineSpec: an ordered node chain
     TRIGGER → READ* → CHECK* → DECIDE? → PRODUCE? | N8N? → GATE? → EXECUTE? → RECEIPT
   executed by engine.ts. PRODUCE is where a routine makes REAL WORK — an Artifact (a post
   set, an email, a keyword list, a brief …) written by an injected Producer (the worker's
   LlmProducer) or by a registered n8n workflow; the artifact is stored, linked from a draft
   receipt and shown at the gate. A producer that lacks what it needs answers `needs`, and
   the run ends `waiting_input` with an honest receipt — never a silent skip. Every node is data (JSON-serialisable) so specs can
   live in routine_states.draft_spec / live_spec and be edited in the canvas
   inspector. Nothing in here touches a database or a network: adapters are
   injected (see ConnectorReader / DecisionProvider / Executor / Store). */

// ---------- identifiers ----------

/** Catalog id, e.g. "D01-W01" (category D01..D05, routine W01..W08). */
export type RoutineId = string;

/** Connector platforms. Mirrors connectors.platform in the schema; the last
    few (web, llm_search, calendar) are read-only research sources with no
    connector card yet. */
export type Platform =
  | "shopify"
  | "ga4"
  | "meta_ads"
  | "google_ads"
  | "klaviyo"
  | "instagram"
  | "tiktok"
  | "linkedin"
  | "youtube"
  | "search_console"
  | "hubspot"
  | "gmail"
  | "gorgias"
  | "xero"
  | "quickbooks"
  | "slack"
  | "web"
  | "llm_search"
  | "calendar";

export type RunMode = "dry_run" | "live";
/** waiting_input: the producer needs something from the founder (a connector, an answer); the
    run holds a snapshot and resumes through resumeRunWithInput. */
export type RunStatus = "running" | "waiting_approval" | "waiting_input" | "done" | "failed" | "skipped";
export type ApprovalStatus = "pending" | "approved" | "held" | "expired";
export type ReceiptKind = "read" | "draft" | "mutation" | "notification";
export type TasteAction = "approved" | "held" | "why_opened" | "edited";
export type Wave = 1 | 2;

// ---------- predicates (data, not code) ----------

export type CompareOp = "gt" | "gte" | "lt" | "lte" | "eq" | "neq" | "exists" | "between";

/** A literal, or a reference to another context path (e.g. { ref: "caps.perDay" }). */
export type PredicateValue = number | string | boolean | [number, number] | { ref: string };

/** A single metric comparison. `metric` is a dotted path into the run
    context, e.g. "reads.orders.count", "reads.insights.spend",
    "decision.spend.amount". `window` is informational — it names the period
    the metric was read over ("7d", "24h") so the receipt can say so. */
export interface MetricPredicate {
  metric: string;
  op: CompareOp;
  value?: PredicateValue;
  window?: string;
}
export interface AllPredicate {
  all: Predicate[];
}
export interface AnyPredicate {
  any: Predicate[];
}
export type Predicate = MetricPredicate | AllPredicate | AnyPredicate;

// ---------- read descriptors ----------

/** A platform query expressed as data. `resource` is the platform's noun
    (shopify: orders | products | customers | checkouts; ga4: report;
    meta_ads: insights | campaigns | ads; klaviyo: flows | campaigns |
    segments | metrics; search_console: search_analytics; …). */
export interface ReadQuery {
  resource: string;
  fields?: string[];
  /** Lookback window: "24h", "7d", "28d", "90d". */
  window?: string;
  filter?: Record<string, unknown>;
  groupBy?: string[];
  limit?: number;
}

/** What a ConnectorReader returns. `metrics` are pre-aggregated numbers the
    checks and templates can address directly; `rows` are the raw records. */
export interface ReadResult {
  rows: Record<string, unknown>[];
  metrics: Record<string, number | string | boolean | null>;
  fetchedAt: string;
  /** Optional provenance: "ok" | "empty" | "error:<code>" — mirrors
      connectors.last_sync_result so "couldn't ask" ≠ "nothing happened". */
  provenance?: string;
  sourceNote?: string;
  dataset?: { id: string; servedFrom: "stored"; storedAt: string };
}

// ---------- spend ----------

export interface SpendCaps {
  currency: string;
  perDay: number;
  perMonth: number;
}

/** Spend a decision commits. Either a fixed amount or a metric-derived one
    (e.g. 20% of current daily budget, capped). Resolved to SpendAmount by the
    DecisionProvider. */
export type SpendDescriptor =
  | { amount: number; period?: "day" | "month" | "once" }
  | { amountMetric: string; multiplier?: number; max?: number; period?: "day" | "month" | "once" };

export interface SpendAmount {
  amount: number;
  currency: string;
  period: "day" | "month" | "once";
}

// ---------- nodes ----------

interface NodeBase {
  id: string;
  /** Human label shown on the canvas. */
  label?: string;
}

/** Cadence: "manual", a 5-field cron expression, or "event:<platform>:<event>"
    for on-new-data triggers (e.g. "event:shopify:order_created"). */
export interface TriggerNode extends NodeBase {
  kind: "trigger";
  cadence: string;
  /** Template; runs sharing a rendered dedup key on the same day are skipped.
      Default "{{routine.id}}:{{today}}". */
  dedupKey?: string;
}

export interface ReadNode extends NodeBase {
  kind: "read";
  source: Platform;
  query: ReadQuery;
  /** Context alias: results land at reads.<as>. */
  as: string;
  /** Reject reads older than this many minutes (certified-input freshness). */
  freshnessMinutes?: number;
  /** An optional read that cannot be answered (nothing connected, no reader, an error) does
      not fail the run: it lands as an empty result with provenance "unavailable" and a
      notification receipt saying so, and the chain carries on with what it has. Wave-1
      drafting routines use this so a founder with only a site profile still gets a draft. */
  optional?: boolean;
}

export interface CheckNode extends NodeBase {
  kind: "check";
  predicate: Predicate;
  /** What a false predicate means: "skip" ends the run quietly (nothing to
      do today), "fail" ends it as an incident. Default "skip". */
  onFail?: "skip" | "fail";
  /** Receipt copy for the skip/fail case. */
  reason?: string;
}

export interface DecisionOption {
  id: string;
  label: string;
  /** Selecting this option ends the run after a receipt (no gate/execute). */
  terminal?: boolean;
  spend?: SpendDescriptor;
  params?: Record<string, unknown>;
}

export type SelectionRule =
  | { kind: "first" }
  | { kind: "threshold"; metric: string; op: CompareOp; value: PredicateValue; ifTrue: string; ifFalse: string }
  | { kind: "llm"; prompt: string; fallback?: string };

/** Versioned rule inputs carried inside a promoted routine spec. The worker treats this as
    untrusted JSON and applies only its explicit numeric allowlist. Keeping routine-specific
    policy on the decide node means an editor row cannot change live decisions before the
    containing draft has passed validation and been promoted. */
export interface MetaAdsetDecisionPolicy {
  kind: "meta.adset";
  preset?: {
    targetCpa?: number;
    maxCpa?: number;
    roasFloor?: number;
    minSpendBeforeJudging?: number;
    fatigueFrequency?: number;
    fatigueCtrDrop?: number;
    scaleStepPct?: number;
    holdDays?: number;
  };
  /** Optional routine ceiling. It may tighten, never loosen, the account's per-day cap. */
  dailyBudgetCap?: number;
}

export type DecisionPolicy = MetaAdsetDecisionPolicy;

export interface DecideNode extends NodeBase {
  kind: "decide";
  question: string;
  options: DecisionOption[];
  rule: SelectionRule;
  /** Optional policy snapshot governed by the routine draft -> validate -> promote lifecycle. */
  policy?: DecisionPolicy;
}

/** The decision a DecisionProvider returns. Lands at ctx.decision. */
export interface Decision {
  optionId: string;
  label: string;
  reasoning: string;
  terminal?: boolean;
  spend?: SpendAmount;
  params?: Record<string, unknown>;
}

/** Templates ({{path}}) are rendered from the run context at gate time. */
export interface GateNode extends NodeBase {
  kind: "gate";
  title: string;
  detail?: string;
  before?: string;
  after?: string;
  reasoning?: string;
  expiryHours: number;
  approver?: string;
}

export interface Mutation {
  /** Typed action id (src/lib/actions, e.g. "meta.adset.set_daily_budget") or a legacy
      platform verb ("update_adset_budget"). Unknown ids fail closed at the executor. */
  action: string;
  target?: Record<string, unknown>;
  params?: Record<string, unknown>;
}

export interface ExecuteNode extends NodeBase {
  kind: "execute";
  platform: Platform;
  mutation: Mutation;
  /** Static spend when the decision doesn't carry one. */
  spend?: SpendDescriptor;
  idempotencyKey?: string;
  rollback?: string;
}

export interface ReceiptNode extends NodeBase {
  kind: "receipt";
  /** Template for the run summary. */
  summary?: string;
  measurementWindowDays?: number;
}

// ---------- artifacts (the real work a routine produces) ----------

export type ArtifactKind =
  | "post"
  | "post_set"
  | "email"
  | "hook_list"
  | "keyword_list"
  | "content_gap"
  | "lead_brief"
  | "outreach_draft"
  | "meeting_brief"
  | "question_list"
  | "calendar"
  | "generic";

export const ARTIFACT_KINDS: readonly ArtifactKind[] = ["post", "post_set", "email", "hook_list", "keyword_list", "content_gap", "lead_brief", "outreach_draft", "meeting_brief", "question_list", "calendar", "generic"] as const;

export type ArtifactStatus = "draft" | "approved" | "held" | "edited" | "used";

export interface ArtifactItem {
  title: string;
  /** Markdown. */
  body: string;
  meta?: Record<string, unknown>;
}

/** Where a line of the artifact came from — the founder can check every claim. */
export interface ArtifactEvidence {
  /** "site_profile" | "memory" | "read:<alias>" | "input:<key>" | "playbook" | "n8n" … */
  source: string;
  ref: string;
}

/** What a Producer / n8n workflow hands back: everything but the ids the engine assigns. */
export interface ArtifactDraft {
  kind: ArtifactKind;
  title: string;
  /** Markdown — headings, bold, lists; rendered without a dependency. */
  body: string;
  items?: ArtifactItem[];
  meta?: Record<string, unknown>;
  evidence?: ArtifactEvidence[];
}

/** A stored artifact (table `artifacts`, migration 0013). */
export interface Artifact extends ArtifactDraft {
  id: string;
  accountId: string;
  runId: string;
  routineId: RoutineId;
  items: ArtifactItem[];
  meta: Record<string, unknown>;
  evidence: ArtifactEvidence[];
  status: ArtifactStatus;
  /** The founder's edit of `body`; the original stays. */
  editedBody?: string;
  createdAt: string;
}

/** What a producer needs before it can draft — one line per missing thing. Either a platform
    to connect or a named founder input (an answer key the resume-input API accepts). */
export interface ProduceNeed {
  platform?: Platform;
  input?: string;
  why: string;
}

export type ProduceResult = { artifact: ArtifactDraft } | { needs: ProduceNeed[]; note?: string };

/** Generates the routine's artifact from the run context through the injected Producer
    (skill = which skill card to run; defaults to the routine id). When an active n8n workflow is
    registered for the routine (Store.findN8nWorkflow) the engine hands the step to the N8nBridge
    instead. Dry-run and live both produce: producing is never outward. */
export interface ProduceNode extends NodeBase {
  kind: "produce";
  skill?: string;
  /** Cap on items in the artifact (the validator enforces it). */
  maxItems?: number;
}

/** Explicit n8n step: POST the run context to a webhook and take the Artifact it returns
    (synchronously, or later through POST /api/routines/artifacts). One of webhookUrl /
    webhookUrlEnv is set; absent both, the account's registered workflow (n8n_workflows) is used. */
export interface N8nNode extends NodeBase {
  kind: "n8n";
  /** Optional server-pinned, synchronous, fail-closed pilot contract. */
  shadowContract?: import("../n8n/shadowContract").KeywordShadowContract;
  webhookUrl?: string;
  /** Name of the env variable holding the webhook URL. */
  webhookUrlEnv?: string;
  timeoutMs?: number;
}

export type Node = TriggerNode | ReadNode | CheckNode | DecideNode | ProduceNode | N8nNode | GateNode | ExecuteNode | ReceiptNode;
export type NodeKind = Node["kind"];

// ---------- KPI contract (outcome telemetry) ----------

/** Where a KPI's actual value comes from.
    - read: a certified platform read through the ConnectorReader (the same reader the
      routines use). `metric` is a key of ReadResult.metrics or "count" (row count);
      `per` divides by another metric/"count" and `scale` multiplies (e.g. ×100 for a %).
    - runs: the routine's own ledger in the Store over the window — completed runs, draft
      receipts, mutation receipts, or approvals the founder approved. */
export type KpiSource =
  | { kind: "read"; platform: Platform; resource: string; metric: string; per?: string; scale?: number; query?: Omit<ReadQuery, "resource" | "window"> }
  | { kind: "runs"; metric: "completed_runs" | "draft_receipts" | "mutation_receipts" | "approved"; multiplier?: number };

/** The measurable promise a routine makes. `op` says which direction is good
    (gte: actual ≥ target hits; lte: actual ≤ target hits). Measured by
    src/lib/telemetry/outcomes.ts and written to routine_outcomes. */
export interface KpiContract {
  /** Stable key; also the benchmark metric_key when the KPI feeds "The bar". */
  key: string;
  label: string;
  target: number;
  op: "gte" | "lte";
  /** Measurement window in days (the window ends at the start of the measuring day, UTC). */
  windowDays: number;
  /** Display unit: "drafts / week", "%", "h", "×" … */
  unit: string;
  source: KpiSource;
}

// ---------- spec ----------

export interface RoutineSpec {
  id: RoutineId;
  version: number;
  name: string;
  /** Launch wave. Wave 1 routines are draft-only (never mutate). */
  wave: Wave;
  /** True iff the chain contains an execute node. */
  mutates: boolean;
  nodes: Node[];
  /** The routine's KPI contract (catalog constant; see KPI_CONTRACTS in catalog-specs.ts). */
  kpi?: KpiContract;
  /** Conservative founder-hours one completed run saves (catalog constant; see
      HOURS_SAVED_PER_RUN in catalog-specs.ts). Feeds the Home automation strip in DB mode. */
  hoursSavedPerRun?: number;
  /** What the routine honestly needs to produce (from its skill card) — so availability / the
      UI can say "Needs: X" instead of gating on every read. Absent = the reads say it all. */
  minimum?: SpecMinimum;
}

/** The skill's stated minimum, as data. `platforms` are needed connections; `inputs` are
    founder answers the run can ask for (waiting_input); `summary` is the one honest line. */
export interface SpecMinimum {
  summary: string;
  platforms: Platform[];
  inputs: string[];
  /** Platforms that help but are not required (their reads are optional). */
  helpful: Platform[];
}

// ---------- run context + results ----------

export interface AccountContext {
  accountId: string;
  /** Captured before reading business inputs; never replaced when resuming old work. */
  contextGeneration?: number;
  currency: string;
  /** resource_profiles.budget_monthly — the hard spend guardrail source. */
  budgetMonthly: number;
  /** Explicit caps; derived from budgetMonthly (÷30 per day) when absent. */
  caps?: SpendCaps;
  /** Named approver for gates (team_members.approves). */
  approver?: string;
}

export interface RunInput {
  account: AccountContext;
  /** How the run started. */
  triggeredBy?: "schedule" | "manual" | "event";
  /** Free-form variables available to templates at vars.<key>. */
  vars?: Record<string, unknown>;
  /** Founder-provided answers (inputs.<key>) — what resume-input merges in. */
  inputs?: Record<string, string>;
}

export interface RunContext {
  runId: string;
  routineId: RoutineId;
  version: number;
  mode: RunMode;
  startedAt: string;
  account: AccountContext;
  caps: SpendCaps;
  triggeredBy: "schedule" | "manual" | "event";
  vars: Record<string, unknown>;
  reads: Record<string, ReadResult>;
  checks: Record<string, boolean>;
  decision?: Decision;
  /** Founder answers (from the run input or a resume-input); addressed as inputs.<key>.
      Optional so hand-built contexts elsewhere stay valid; the engine always sets it. */
  inputs?: Record<string, string>;
  /** The artifact the produce / n8n step stored (addressed as artifact.<field>). */
  artifact?: Artifact;
  approval?: ApprovalRecord;
  execution?: ExecutionResult;
}

export interface ExecutionResult {
  ok: boolean;
  externalRef?: string;
  readback?: Record<string, unknown>;
  error?: string;
}

export interface ApprovalRecord {
  id: string;
  accountId: string;
  runId: string;
  routineId: RoutineId;
  title: string;
  detail?: string;
  beforeState?: string;
  afterState?: string;
  reasoning?: string;
  status: ApprovalStatus;
  expiresAt: string;
  decidedAt?: string;
  decidedBy?: string;
  createdAt: string;
}

export interface Receipt {
  id: string;
  accountId: string;
  /** Required for a run-less producer after a reset; otherwise inherited from the parent run. */
  contextGeneration?: number;
  runId: string;
  approvalId?: string;
  kind: ReceiptKind;
  platform?: Platform;
  description: string;
  payload: Record<string, unknown>;
  /** Money committed by a mutation receipt (spend-cap accounting). */
  spend?: SpendAmount;
  createdAt: string;
}

export interface TasteEvent {
  id: string;
  accountId: string;
  approvalId?: string;
  routineId?: RoutineId;
  action: TasteAction;
  context: Record<string, unknown>;
  createdAt: string;
}

export interface RunResult {
  runId: string;
  routineId: RoutineId;
  version: number;
  mode: RunMode;
  status: RunStatus;
  summary: string;
  receipts: Receipt[];
  approval?: ApprovalRecord;
  /** The artifact this run produced (also linked from its draft receipt). */
  artifact?: Artifact;
  /** status waiting_input: what the producer asked for. */
  needs?: ProduceNeed[];
  error?: string;
}

// ---------- injected adapters ----------

export interface ConnectorReader {
  read(source: Platform, query: ReadQuery, ctx: RunContext): Promise<ReadResult>;
}

export interface DecisionProvider {
  decide(node: DecideNode, ctx: RunContext): Promise<Decision>;
}

export interface Executor {
  execute(node: ExecuteNode, mutation: Mutation, ctx: RunContext): Promise<ExecutionResult>;
  /** Optional: in dry_run the engine asks for the exact request the mutation WOULD send
      (typed action library — src/lib/actions). null = no action for this mutation, so the
      engine keeps its generic "Would <verb>" draft receipt. Never sends anything. */
  dryRun?(node: ExecuteNode, mutation: Mutation, ctx: RunContext): Promise<ExecuteDryRun | null>;
}

/** What Executor.dryRun answers: the human line, the payload for the draft receipt (the
    shaped request, guards, spend …) and, when the action's guards would stop it, why. */
export interface ExecuteDryRun {
  preview: string;
  payload: Record<string, unknown>;
  blocked?: string;
}

/** Makes the artifact. Throws when it cannot work at all (no model configured, transport
    failure) — the engine then fails the run closed with a receipt. Returns `needs` when the
    account lacks what the skill's minimum asks for. */
export interface Producer {
  produce(node: ProduceNode, ctx: RunContext): Promise<ProduceResult>;
}

export type N8nCallResult = { kind: "artifact"; artifact: ArtifactDraft } | { kind: "needs"; needs: ProduceNeed[] } | { kind: "accepted" };

/** The n8n bridge: POSTs the signed payload and interprets the reply. `workflow` is the
    registered webhook (from the store) when the step came from a produce node. */
export interface N8nBridge {
  call(node: N8nNode | ProduceNode, ctx: RunContext, workflow: N8nWorkflow | null): Promise<N8nCallResult>;
}

/** A registered n8n workflow for a routine (table n8n_workflows). account_id null = global. */
export interface N8nWorkflow {
  id: string;
  accountId: string | null;
  routineId: RoutineId;
  webhookUrl: string;
  active: boolean;
}
