# Client workspace — Batch 29

The previous goal turn was verified landing/signup progress. This batch advances the supplied client design and preserves the full B01–B24/all-client goal; it does not infer n8n purchase/key approval.

## Implemented

- Ported the supplied client shell, Today, Work inbox and full-page Ask into the existing authenticated application. Existing onboarding and guided setup remain. Agents, Connections, business plan and messaging-channel controls retain their existing functional components; their full supplied-design port is still outstanding. Context/model/skill/billing/sign-out controls remain available.
- New GET `/api/workspace` requires the authenticated canonical account and exact account/generation headers. It reads saved artifacts, approvals, receipts, runs and routine switches; rechecks generation and membership before returning a no-store projection. No provider call, execution, credential change or schema migration is involved.
- Failure or wrong context renders an error/unknown counts, not zero/empty success. Refresh/focus reads stay account-bound; an account/generation change unmounts the old view and pending work. Internal run snapshots are not exposed. Dates are explicitly UTC; “completed last 24h” uses completion timestamps, not start times.
- Draft review reuses the existing revision-checked owner endpoint for edit, approve and hold. Edited drafts can be approved/held. Review-only status changes do not resume the action engine. Paused/member views can inspect and copy but cannot POST a review; local Why inspection does not write when read-only. No channel-send controls are offered by this workspace.
- Run approvals remain distinct, inspectable records. The new inbox does not expose a generic action-resuming Approve button. Publishing, customer messaging, ad mutation and spend remain disabled.
- Navigation, hash reload/back, category filters, real receipt/run handles and the existing persisted account conversation are wired. No prototype ROAS/revenue/hours-saved or claimed scheduled run is shown.

## Verification before release

- **202 files / 2,557 unit tests PASS**; app and worker TypeScript and production build pass. Focused lint passes; full lint found the existing 39 warnings plus a new hash-assignment lint error, which was fixed using native same-document navigation and rechecked. No rule suppression.
- **Eight browser tests PASS** against an isolated Vite component harness: Today/inbox/filter/receipt/navigation/reload/back; account/generation/revision-bound edit→approve→reload; held-state reload and conflict failure; paused/member no-write behavior; Ask view handoff; failed/wrong-context response; 390/1280px layout. Route tests cover current/foreign/stale context, reset/revocation during read, failure and internal-snapshot redaction.
- Test server uses `envDir: false`, a no-session facts adapter and synthetic fixture records; it is outside application routes and cannot operate live accounts. Browser responses prove UI behavior, not n8n output. Main browser visual inspection completed; new page uses existing brand tokens and fonts with a real fallback.
- No changed runtime dependency is compiled into the worker. Leave Batch 27 worker healthy rather than restarting it for a frontend/read-projection change. No migration or provider edit.

## Open acceptance and next work

- Production deployment, actual AVGAR projection/UI comparison and new Ask view readback are pending.
- Recent history is capped at 100 records per list; hitting a limit is explicit and counts are described as in-view, not lifetime totals. Older-history pagination/search remains unfinished. No “next run” schedule is invented.
- Nonempty draft review has browser-fixture and existing real-SQL decision-contract evidence, not a fresh production provider-produced draft. That acceptance depends on a real authorized result. The fixture must not be inserted into AVGAR to manufacture readiness.
- Full Agents/Connections design integration, 38-label catalog reconciliation, ops authorization/projections, canonical existing-client system mapping, remaining auth/data/scheduler/monitoring/retention and channel/second-client acceptance remain open. n8n execution access, receiver reconciliation and real US/NZ/AU pilot results remain separate gates.
