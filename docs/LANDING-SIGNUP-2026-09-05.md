# Supplied landing and durable signup — Batch 28

## Implemented and verified locally

- Ported the supplied v2 landing into the existing Next.js app, retaining its cream/navy/blue direction, concrete-work explorer, process, messaging illustrations, signup and FAQ. No prototype JavaScript, new framework, stock assets or invented client metrics were introduced. Shopify install forwarding and real sign-in/legal routes remain.
- Public explorer controls collect category interests only. They do not enable account routines or call runtime APIs. Fifteen illustrative jobs are not the separate 38-job client catalog. Messaging samples are labelled illustrative; publishing, messages, ad changes and subscription activation are not offered.
- Signup accepts only confirmed database storage, including an existing unique email. Unconfirmed storage returns 503, not success. The public path never sends email or uses temporary filesystem capture. Duplicate signup preserves the first record and its interest attribution.
- Browser validation, request-in-flight guard, 20-second timeout, truthful failure/rate-limit/retry states, focus labels and normalized email. Source attribution strips referrer query/fragment/credentials. Logs do not include sink error payloads.
- Removed unused anonymous/authenticated waitlist table grants without broadening RLS. Source migration `20260905103751_waitlist_server_only.sql`; live version `20260905104131_waitlist_server_only`. Role-boundary rehearsal and rolled-back server insertion passed; post-apply reads/inserts denied to client roles, service insert allowed, zero signup rows.
- **201 files / 2,548 tests pass**; app and worker TypeScript, production build and diff checks pass. Lint: zero errors, 39 pre-existing warnings. Seven browser tests pass at 390/1280px, including interactive selections, failure/retry and legal navigation. Browser response fixtures prove UI behaviour, not live persistence. Fixed decorative toggle interception identified by the browser tests; no forced clicks. Primary browser visual check passed; its development hydration warning traced to Grammarly/Dashlane-injected attributes, not suppressed in code.

## Deploy result — production READY

- URL: https://junction-unc.vercel.app/ . Deployment `dpl_DPLRUejf5H3mwTtYpx5VLEUGnrL7`; candidate https://junction-lrwmp7h38-tom-junctionmedis-projects.vercel.app . Existing project/team, clean detached release checkout `/tmp/unc-landing-release.Q00Oss`.
- GitHub/live application commit: `97f832c57bf6eec4ceb7ece180cbe937d2ea4de3`. Next.js 16.3.4. Build-to-ready 39.790 seconds (Vercel CLI build phase reports 29 seconds). Candidate health and anonymous 401 independently checked before canonical promotion. Canonical health reports `97f832c57bf6`, healthy database and fresh worker.
- Worker remains Batch 27: source `1a1b0596e67c549425255446db9971ec69524069`, Fly release 19, existing machine `1857466fd76998`, image `d882624a87f8d270973bfd574a068eced262fc9917c66d721c69e277d5babab3`. The compiled dependency list excludes all changed landing/waitlist files; no worker/runtime contract changed. No unnecessary worker restart or claim of matching commit hashes. Fresh ticks at 10:44:24.397 and 10:45:24.405 UTC.
- Primary browser canonical landing renders the supplied v2 port. Real form submission at **10:44:54.909 UTC** saved row `4e98996f-9d56-40f9-b067-14311eabb633`, synthetic `junction-release-97f832c@example.test`, source `landing_v2-seo`, country NZ, referrer canonical origin/path. UI success and independent SQL readback both pass. Reload/repeat submission confirmed success; SQL still showed exactly the same one row, source and timestamp. Removed only that exact synthetic id/email/source; 10:45:53 UTC readback shows zero canaries and zero signups. No real customer record was removed and no message was sent.
- Existing authenticated AVGAR Home hydrates with preserved connections, zero enabled routines and the setup pause. Post-release SQL: zero routine runs, AVGAR still paused. Independent Fly metadata confirms all five command/messaging/live/SMS/Apple flags false. Apple webhook remains 503 `apple_channel_not_ready`; anonymous connector state remains 401.
- Unrelated `src/lib/runtime/context 2.ts` preserved and excluded from commit/deployment. Nguyen's workflows and credentials unchanged.

### Post-deploy observability

- Error scan: zero error/fatal entries for this deployment from 10:43:00 to 10:45:23 UTC. This is bounded evidence, not continuous monitoring acceptance.
- Drains: not re-inventoried in this frontend-only batch; configuration remains unverified here.
- Monitoring: ongoing alerting/retention acceptance remains open.

Rollback reference: prior Vercel deployment `dpl_2pvHPR8wb55mykjBnuy7orjgiJaE` / app source `1a1b0596e67c549425255446db9971ec69524069`; worker stays unchanged. Keep restrictive waitlist grants. The old landing handler can falsely report success on storage failure, so prefer forward repair; if rollback is necessary, separately disable public signup until durable confirmation is restored.

## Remaining acceptance

This does not port the supplied client/ops pages, connect the remaining clients, prove a provider routine or complete the original goal. Client Today/inbox and ops authorization/bindings remain next independent work. Nguyen's execution-read/receiver dependencies are unchanged and were not rechecked.

Public-form rate limiting remains per server instance, not distributed abuse protection. Broader spam protection, consent/retention operations and alerting remain launch-register work. No claim of pixel-identical prototype parity or full accessibility audit is made. Old unused landing source is retained for reference.
