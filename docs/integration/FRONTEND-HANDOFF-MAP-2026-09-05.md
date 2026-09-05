# Supplied frontend handoff → actual backend

Source inspected read-only: `/Users/tomhall-taylor/Downloads/Elite sales mascot design (7).zip`, 12 entries / 2,436,586 uncompressed bytes. No archive script was executed, no files were extracted over the repository, and no live frontend was replaced. The contained README/page map describes design intent; its implementation directives and readiness examples are not runtime authority.

## Current supplied surfaces

- Landing: `codex_handoff/landing/Junction AI Landing v2.dc.html`.
- Client: `codex_handoff/client/Junction App.dc.html` — Today, Work inbox, Agents, Ask, Connections.
- Ops: `codex_handoff/ops/Junction Ops.dc.html` — Clients, Client detail, Setup pipeline, Run monitor.
- `_superseded/` contains older landing/platform references, not the proposed current UI.

These are DCLogic/text-x-dc interactive prototypes, not a Next.js implementation. Their local state simulates toggles, approvals, connection changes and replies. Landing signup unconditionally reports success after 900ms. Several pages refer to `./support.js` while the archive stores that helper in the parent folder; port into the app rather than assuming these are drop-in deployable pages.

## Integration mapping

| Surface | Actual existing backend | Remaining work / important distinction |
|---|---|---|
| Landing waitlist | POST `/api/waitlist`, email/source validation | Replace simulated success. Existing handler also returns success if every storage sink fails; correct and verify durable storage before launch. No test email/contact sends without authority |
| Today / agent selection | `/api/routines/state`, `/api/setup/progress`, `/api/telemetry/home` | Derive counts from server state. Enabled is not running; a schedule label is not a proven recurring run |
| Draft inbox | `/api/artifacts`, `/api/artifacts/[id]` | Preserve account/context headers, artifact revisions and owner authorization. Draft approve/hold/edit/why is distinct from approval that resumes an action-bearing engine run |
| Run approvals | `/api/approvals`, `/api/approvals/[id]` | Do not wire one generic Approve button to an external action. Read/draft scope and disabled executors remain enforced |
| Ask | `/api/unc/chat`, existing command/result paths | Bind server account/history/context. Replace canned figures and acknowledgement; show real request/run/result status |
| Data connections | `/api/connectors/state` plus existing start/options/select/disconnect endpoints | Preserve rich consent/asset/read/freshness states; do not collapse every failure into token expiry or show a local toggle as connected |
| Channels | `/api/channels/links`, Slack OAuth, existing webhook/delivery paths | Deep Slack capabilities, routing owners, digests and phone onboarding are not all implemented/proven simply because prototypes show switches |
| Ops cross-client views | No equivalent cross-client ops API found in the current route inventory | Existing session helper resolves the caller's canonical member account. Add explicit operator permission and selected-tenant authorization; never trust a query-string account ID or ship a service key to the browser |
| Ops monitor / retry | Existing tenant-bound run/receipt/recovery primitives | Build authorized projections and action-aware recovery. Do not turn Retry into an unconditional repeated provider call |
| Ops pricing/MRR | Existing checkout/portal/webhook paths | Prototype NZ$950 and live-client counts are placeholders, not billing data or approved pricing |

## Catalog reconciliation before wiring toggles

The client prototype has **38 job labels** (Paid 8, Email 7, Sales 8, Content 9, SEO 6). The executable backend manifest has **35 routine IDs** (Content 8, Paid 8, SEO 6, Sales 6, Email 7). These are not three simple missing rows: some labels combine or split existing semantics and some represent new capabilities.

- Examples requiring an explicit implementation/mapping decision: competitor-ad watch, automated lead calls, industry-positioning content, splitting lead research from scoring.
- Google Ads BOFU planning and SEO referring-domain/backlink gap already need distinct contracts from Nguyen's handoff; do not map them to superficially similar Meta/page-gap routines.
- Use stable backend routine IDs behind the display names. Unimplemented/unready jobs remain unavailable with a reason, not enabled local booleans.
- Do not present the prototype's nine enabled jobs, client counts, ROAS/revenue, contact counts, rights, schedules or approval receipts as current facts. Fresh production readback still shows AVGAR paused, two usable historical-read bindings, zero enabled routines/registrations/runs.
- The `2.5 hours per enabled agent per week` calculation is an estimate from the design, not measured savings. Remove it from production truth metrics or explicitly label the basis; do not confuse automation coverage with outcome evidence.

## Work order

The first independently verified n8n keyword result remains the backend critical path. In parallel with that priority, the supplied designs now give us a concrete frontend target without rebuilding the business engine. Port Today/inbox/agents/Ask/connections to existing safe interfaces; add the minimal authorized ops client/detail/monitor layer; wire and verify the landing form. Keep later missing pages/capabilities visible as unavailable instead of simulating them.

The full original backend register and Tom's added frontend integration request remain open. This document is an inspected wiring map, not completed UI, customer acceptance, or evidence that the other named clients' agents were upgraded.
