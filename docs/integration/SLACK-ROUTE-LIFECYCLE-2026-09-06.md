# Slack route lifecycle — Batch 82

6 September NZ. Source `1b757334b95dd87976eaa5d01a7e5caf0e3a2fba`.
This is part of the full client migration goal, not a completed Slack pilot.

## Implemented contract

- Owner-authenticated `PATCH /api/channels/slack/routes` accepts only
  `{routeId, revision, action}` where action is `pause`, `revoke` or `activate`.
  Account, owner and generation come from verified server context and must match
  the browser's existing readback headers. Cross-origin, stale actor/context,
  unknown fields and browser-supplied approval are refused.
- Pause returns an active route to staged; revoke is terminal. Both work after
  provider access is lost or business context changes, provided the caller is
  the current account owner and supplies the current route revision. Exact
  already-paused/already-revoked requests are honest no-ops. Lost responses are
  reconciled by readback, never automatically retried.
- Each changed transition increments the route revision and records a private
  audit entry. Old inbox/command/outbox bindings cannot silently adopt a new
  route revision. Queued delivery is refused after a pause. Already-sent or
  provider-in-flight requests cannot be recalled by this control.
- Retired rows and their references/history stay immutable. A partial unique
  index permits one non-retired reservation per workspace/channel. A replacement
  is a new row, created only after the prior owner's revocation, fresh owner
  authorization and provider verification. Original identity/account ownership
  is not transferred. New events resolve to the new active mapping; old captured
  events remain tied to the retired mapping and fail verification.
- The client screen exposes pause and a two-step retirement confirmation, with
  explicit saved-state readback. Activation stays operator-assisted; no general
  customer activation toggle is advertised.

## Operator activation authority — not enabled

Activation requires both server settings, neither configured by this batch:

- `UNC_SLACK_ROUTE_ACTIVATION_ENABLED=true`
- `UNC_SLACK_ROUTE_ACTIVATION_SCOPE`: one strict JSON object containing
  `accountId`, `actorId`, `contextGeneration`, `routeId`, `revision`,
  `workspaceId`, `conversationId`, `botUserId`, `expiresAt`, `reference`, and
  `previousResponderStopped: true`.

The scope must identify the exact staged route, owner, account generation and
revision. Expiry must be in the future and no more than one hour away. It is
an activation-operation window, not a grant of ongoing messaging permission.
`reference` must identify the actual scoped approval and the checked old-responder
stop/cutover evidence. The software does not independently discover or stop a
Hyperagent listener; this operator attestation must not be fabricated.

The service refuses missing/off/mismatched scopes before token/provider access.
It then checks current owner view and account pause, reads the stored credential
timestamp, verifies the actual bot/workspace through Slack `auth.test`, and checks
channel membership/non-shared/non-archived status through `conversations.info`.
Both calls have bounded timeouts and forbid redirects. The database rechecks
owner, identity, route revision, context, approval expiry, evidence freshness and
unchanged credential timestamp under locks before committing once.

Do **not** open `UNC_MESSAGING_ENABLED` merely to activate a route. That gate is
separate, remains false, and needs channel/recipient/window acceptance before
any live pilot. Installation, routing, routine selection, action permissions,
account pause and sending remain separate checks. A scoped activation does not
enable routines, change a provider connection, join a room or send a message.

## Verification

- Full suite: **3,171 tests / 233 files**; app and worker TypeScript, production
  Next build, focused ESLint and diff check pass.
- Eight isolated browser checks pass, including pause/retire/reload, explicit
  retirement confirmation/cancellation, lost-response readback without retry,
  staging, context changes and 390px/1280px layouts. Screenshots inspected;
  meaningful controls render with no framework error overlay. These fixtures
  have no live data or credentials; they are not customer-delivery evidence.
- Exact SQL runs in real isolated PostgreSQL. It proves missing/expired/wrong
  approval refusal, changed identity/credential/context and paused-account
  refusal, one winner from concurrent activation requests, pause cancellation of
  queued delivery, revoke after unlink/context repair, terminal retired rows,
  replacement activation and new-client resolution with unchanged old history,
  private audit and service-only access. Provider calls and customer sends: zero.

## Schema release

Remote migration `20260905231500_slack_route_lifecycle`; local filename
`20260905230842_slack_route_lifecycle.sql`. Remote function body hashes match
the checked-in tested definitions:

- transition: `7a4fb09c1a9d1a0e51525c9e773f64be`
- staging: `d833dc36317f7bd2f665e1f4150103e6`
- resolution: `6bc30153f64af74f926f97fd6abc0e7b`

All three are security invoker, empty search path, service executable and not
anon/authenticated executable. Audit RLS is enabled with no browser SELECT.
The new partial unique index is independently read back. No route existed
before or after application, and the existing verified Slack identity stayed
present. Security advisors remain **six pre-existing WARN**, now 23 INFO; the
additional INFO is the intentionally private audit table without browser RLS
policies ([advisory explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)). No privileges were widened to clear notices. See the existing
security register; this is not a clean-security sign-off.

## Matched runtime release and readback

- **URL:** https://junction-unc.vercel.app/app
- **Target/status:** production, READY, promoted successfully.
- **Deployment:** `dpl_AJoYyAigYvmqhSeeCYnh7KstSgbj`, immutable URL
  `https://junction-4d3wwqb1q-tom-junctionmedis-projects.vercel.app`.
- **Source:** `1b757334b95dd87976eaa5d01a7e5caf0e3a2fba`; Next 16.3.4,
  44-second remote build. Clean detached checkout
  `/private/tmp/unc-slack-lifecycle-release.aLi3uW`; no local env files or user's
  `context 2.ts` included.
- **Worker:** release 43, sole Sydney machine `1857466fd76998`, healthy;
  image `registry.fly.io/unc-worker:deployment-01M1SXP2PVRGTBP0XDWK23XB1J`, digest
  `sha256:92f2af9c8c7bdc27f9ea1731c67e575165685a3fa18f4a88e361f163fbdf5fc3`.
  Actual process readback at `2026-09-05T23:17:28.417Z` reports the full matching
  SHA, all five action/messaging flags false, activation disabled and no scope.
  Actual service RPC refuses the deliberately nonexistent route with 42501;
  no row was changed. App configuration metadata independently shows neither
  activation setting exists.
- **Acceptance:** candidate health and anonymous PATCH 401 passed before
  promotion. Canonical health at `23:17:42.506Z` reports source `1b757334b95d`,
  DB healthy, worker fresh and lastError null. Signed-in owner Today and
  Connections/Messaging render the preserved AVGAR context, eight saved results,
  verified Junction AI identity and channel setup. No route was staged or
  activated to create artificial production evidence.
- **Independent DB readback:** `23:18:06.704549Z`, zero routes/transitions, same
  verified Slack link `781b8885-8b1d-4181-894a-a3c9e977ccf7` at revision 0,
  eight AVGAR runs, generation 1 / paused true.
- **Post-deploy observability:** bounded error/fatal scan returned no entries;
  Vercel drains API returns zero drains. Alert delivery remains unverified.

**Rollback:** prior corrected-origin app
`dpl_5Bg9bHmN5UPY98D54yaBfBZvQJQM` and worker release 42 image digest
`sha256:72b81267d9b140225498ebf65dda335749d25698a19dfb67f3c13bb9129f97f0`
use source `781dfe740026b9148396a2bf55c64b537d347c48`. Preserve installed Slack
credentials and the additive database migration. There are no routes at release
time. If route history exists when a later rollback is considered, the old
browser's staged confirmation does not filter retired rows; prefer a forward
fix rather than silently reverting that compatibility. Never delete history,
restore old queued bindings, or enable messages as a rollback shortcut.

## Remaining customer acceptance

Map each existing client to its actual Slack channel and owner; verify bot
membership and platform asset/data/routine bindings. Obtain scoped pilot and
listener-cutover approval, verify the prior responder is stopped, then prove
one useful request through the selected registered routine, persisted result,
same-thread delivery, switch-off and recovery. Roll out the same verified path
to the remaining clients. Do not claim this route-control release has done that.

References: [Supabase function security and privileges](https://supabase.com/docs/guides/database/functions)
and the existing [Junction-owned runtime contract](JUNCTION-OWNED-SLACK-RUNTIME.md).
