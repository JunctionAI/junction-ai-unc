# Supplied frontend handoff → actual backend

Source inspected read-only: `/Users/tomhall-taylor/Downloads/Elite sales mascot design (7).zip`, 12 entries / 2,436,586 uncompressed bytes. No archive script was executed and no files were extracted over the repository. The contained README/page map describes design intent; its implementation directives and readiness examples are not runtime authority. Batch 28 ports the landing into the existing application; see [implementation and release evidence](../LANDING-SIGNUP-2026-09-05.md). Batch 29 ports the client shell, Today, Work inbox and Ask with [scoped live readback](../CLIENT-WORKSPACE-2026-09-05.md). Batch 30 ports Clients/detail, Setup pipeline and Run monitor behind explicit read-only operator scopes with [live readback](../OPS-CONSOLE-2026-09-05.md). Batch 31 ports Agents/Connections with [catalog mapping, persisted preferences and scoped live readback](../AGENTS-CONNECTIONS-2026-09-05.md). Legacy detail/setup and broader provider/execution/ops acceptance remain open; ported screens do not certify the whole platform.

## Current supplied surfaces

- Landing: `codex_handoff/landing/Junction AI Landing v2.dc.html`.
- Client: `codex_handoff/client/Junction App.dc.html` — Today, Work inbox, Agents, Ask, Connections.
- Ops: `codex_handoff/ops/Junction Ops.dc.html` — Clients, Client detail, Setup pipeline, Run monitor.
- `_superseded/` contains older landing/platform references, not the proposed current UI.

These are DCLogic/text-x-dc interactive prototypes, not a Next.js implementation. Their local state simulates toggles, approvals, connection changes and replies. Landing signup unconditionally reports success after 900ms. Several pages refer to `./support.js` while the archive stores that helper in the parent folder; port into the app rather than assuming these are drop-in deployable pages.

## Integration mapping

| Surface | Actual existing backend | Remaining work / important distinction |
|---|---|---|
| Landing waitlist | POST `/api/waitlist`, validated durable database storage; supplied v2 port | Batch 28 production core journey PASS: form submission independently read back; repeat preserves one record; synthetic row removed. No email/contact send. Broader abuse/retention remains |
| Today / agent selection | Account/generation-bound `/api/workspace` and `/api/agents`; service-only atomic `set_agent_switch`; inspector/setup use the shared control boundary | Batches 29/31/32 verify the empty projection, 35-ID listing, shared preference paths and corrected paused detail. Reading settings creates no row. Keyword operator gate explicit. Atomic parameter/manual-execution acceptance, fresh reads, schedules and combined executions remain open |
| Draft inbox | `/api/workspace`, `/api/artifacts/[id]` | New inbox preserves context/revision/owner gates; fixtures pass edit/approve/hold/reload and no-write paused/member states. Nonempty production-output acceptance remains. Draft review is distinct from resuming an action-bearing run |
| Run approvals | `/api/approvals`, `/api/approvals/[id]` | Do not wire one generic Approve button to an external action. Read/draft scope and disabled executors remain enforced |
| Ask | `/api/unc/chat`, existing account-state persistence and command/result paths | New Ask view's real AVGAR context reply saved, independently read back and restored on document reload. Complete routine-to-result acceptance remains; no canned business figures |
| Data connections | `/api/connectors/state` plus existing start/options/select/disconnect endpoints | Batch 31 supplied surface live; actual selected Meta/Shopify assets and dated reads, GA4 recovery and missing social assets verified. No prototype counts/demo fallback. Existing auth-handler gaps and fresh provider read/renewal/selection acceptance remain |
| Channels | `/api/channels/links`, Slack OAuth, existing webhook/delivery paths | Deep Slack capabilities, routing owners, digests and phone onboarding are not all implemented/proven simply because prototypes show switches |
| Ops cross-client views | GET `/api/ops`, service-only `ops_account_access` and one-snapshot `read_ops_console` | Batch 30 seven-account view and exact AVGAR detail/reload verified. Operator authority is separate from customer membership; browser never receives service credentials. Canonical-system reconciliation, pagination and operator read audit remain |
| Ops monitor / retry | Authorized current-context run/receipt headers, filters and honest empty state live | Nonempty production-run acceptance, cost/delivery/stall monitoring and action-aware recovery remain. No retry button or implied customer write authority |
| Ops pricing/MRR | Existing checkout/portal/webhook paths | Prototype NZ$950 and live-client counts are placeholders, not billing data or approved pricing |

## Catalog reconciliation — implemented, execution acceptance still open

The client prototype has **38 job labels** (Paid 8, Email 7, Sales 8, Content 9, SEO 6). The executable backend manifest has **35 routine IDs** (Content 8, Paid 8, SEO 6, Sales 6, Email 7). These are not three simple missing rows: some labels combine or split existing semantics and some represent new capabilities.

- Examples requiring an explicit implementation/mapping decision: competitor-ad watch, automated lead calls, industry-positioning content, splitting lead research from scoring.
- Google Ads BOFU planning and SEO referring-domain/backlink gap already need distinct contracts from Nguyen's handoff; do not map them to superficially similar Meta/page-gap routines.
- Use stable backend routine IDs behind the display names. Unimplemented/unready jobs remain unavailable with a reason, not enabled local booleans.
- Do not present the prototype's nine enabled jobs, client counts, ROAS/revenue, contact counts, rights, schedules or approval receipts as current facts. Fresh production readback still shows AVGAR paused, two usable historical-read bindings, zero enabled routines/registrations/runs.
- The `2.5 hours per enabled agent per week` calculation is an estimate from the design, not measured savings. Remove it from production truth metrics or explicitly label the basis; do not confuse automation coverage with outcome evidence.

Batch 31 implements `src/lib/agents/catalog.ts`: all 35 IDs exactly once; all 38 original labels retained as aliases. Lead research/scoring share D04-W01; creative testing D02-W02 is retained. The three unsupported design jobs and separate Google Ads BOFU/backlink jobs are unavailable, for 40 displayed rows and 35 mapped routines. Copy distinguishes recommendations/drafts/plans from writes, repeat-purchase outcomes and measured AI citations. Real AVGAR remains paused/all-off. The older inspector still displays readiness/cadence language that must be aligned with these gates; this is next Codex work, not a complete Agents journey.

## Work order

The first independently verified n8n keyword result remains the backend critical path. All supplied top-level screen areas now have deployed ports with bounded live evidence, including Agents/Connections. [Batch 32](../ROUTINE-CONTROLS-2026-09-06.md) consolidates legacy inspector/setup/switch eligibility and corrects the observed configured-versus-running claims without unpausing AVGAR. Next verify canonical existing-system bindings and complete actual provider-to-result/per-client journeys plus remaining atomic settings/manual-execution and monitoring/review work. Do not spend a release solely on cosmetic polish or treat unavailable jobs as delivered capabilities.

The full original backend register and Tom's added frontend integration request remain open. This document is an inspected wiring map, not completed UI, customer acceptance, or evidence that the other named clients' agents were upgraded.
