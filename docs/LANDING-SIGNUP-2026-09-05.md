# Supplied landing and durable signup — Batch 28

## Implemented and verified locally

- Ported the supplied v2 landing into the existing Next.js app, retaining its cream/navy/blue direction, concrete-work explorer, process, messaging illustrations, signup and FAQ. No prototype JavaScript, new framework, stock assets or invented client metrics were introduced. Shopify install forwarding and real sign-in/legal routes remain.
- Public explorer controls collect category interests only. They do not enable account routines or call runtime APIs. Fifteen illustrative jobs are not the separate 38-job client catalog. Messaging samples are labelled illustrative; publishing, messages, ad changes and subscription activation are not offered.
- Signup accepts only confirmed database storage, including an existing unique email. Unconfirmed storage returns 503, not success. The public path never sends email or uses temporary filesystem capture. Duplicate signup preserves the first record and its interest attribution.
- Browser validation, request-in-flight guard, 20-second timeout, truthful failure/rate-limit/retry states, focus labels and normalized email. Source attribution strips referrer query/fragment/credentials. Logs do not include sink error payloads.
- Removed unused anonymous/authenticated waitlist table grants without broadening RLS. Source migration `20260905103751_waitlist_server_only.sql`; live version `20260905104131_waitlist_server_only`. Role-boundary rehearsal and rolled-back server insertion passed; post-apply reads/inserts denied to client roles, service insert allowed, zero signup rows.
- **201 files / 2,548 tests pass**; app and worker TypeScript, production build and diff checks pass. Lint: zero errors, 39 pre-existing warnings. Seven browser tests pass at 390/1280px, including interactive selections, failure/retry and legal navigation. Browser response fixtures prove UI behaviour, not live persistence. Fixed decorative toggle interception identified by the browser tests; no forced clicks. Primary browser visual check passed; its development hydration warning traced to Grammarly/Dashlane-injected attributes, not suppressed in code.

## Release gate

Deployment and public route → independent saved-record readback are pending. The worker's compiled dependency list excludes all changed landing/waitlist files; no worker/runtime contract changed. Keep the existing healthy worker release rather than restarting it solely to match a frontend commit hash. Record both identities explicitly.

Release this as one coherent public landing/signup journey. Preserve unrelated `src/lib/runtime/context 2.ts`. After release, use one unique synthetic `@example.test` signup, confirm the stored record and repeat-signup deduplication, then remove only that synthetic record. No customer address, notification or n8n execution is needed.

## Remaining acceptance

This does not port the supplied client/ops pages, connect the remaining clients, prove a provider routine or complete the original goal. Client Today/inbox and ops authorization/bindings remain next independent work. Nguyen's execution-read/receiver dependencies are unchanged and were not rechecked.

Public-form rate limiting remains per server instance, not distributed abuse protection. Broader spam protection, consent/retention operations and alerting remain launch-register work. No claim of pixel-identical prototype parity or full accessibility audit is made. Old unused landing source is retained for reference.
