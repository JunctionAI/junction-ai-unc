# Calendar receiver draft — Batch 69

6 September 2026 NZ / 5 September UTC. **PARTIAL: source-matched Cloud draft and
real refusal paths; no authorized campaign read or customer calendar yet.**

## Exact receiver state

Codex-owned workflow `rQeWMo5ANO9OtUJp`,
[open draft](https://junctionai8.app.n8n.cloud/workflow/rQeWMo5ANO9OtUJp), is inactive,
unpublished and unpinned. Independently read revision
`52b301af-a66a-4377-9e36-fe836879e833` matches the generated definition at
**21:18:50.596 UTC**. Trigger `15393260-968f-4820-91f5-c38c189f00aa`; result builder
`3193f942-2781-4122-9415-c653a32b1e39`. Previous editor node IDs are superseded;
none has been registered with Unc.

`scripts/lib/calendar-receiver-workflow.mjs` builds all 13 nodes and eight
connection entries from the reviewed pure receiver source. Dedicated Header Auth
credential `KbxKHh7mfemphL2W` is separate from the keyword receiver and the native
AVGAR Klaviyo credential `4mkTKL1q0njNafh9`. Provider identity `SuYidF` remains
grounded in the [separate account-read evidence](KLAVIYO-ACCOUNT-BINDING-PROOF-2026-09-06.md).
No provider secret is exported or put in workflow text.

The graph validates input, calls only the fixed Junction calendar-authority
endpoint, checks canonical authority, reads bounded sent-email metadata through
native HTTP pagination, aggregates the result and returns a structured response.
Every fallible processing node has a terminal error-response path. Authority is
one-use: no automatic retry. Provider reads have a five-page ceiling, five-second
per-request timeout, validated next URLs and redirects disabled. Entire workflow
timeout is 50 seconds. These configuration limits are not proof of actual
pagination behavior or complete campaign-data coverage.

## What ran and what did not

Both final-draft tests used the watched **test webhook**, not the production URL.
No pinned nodes, retries or provider node execution occurred.

| Execution | Saved revision | Observed result |
|---|---|---|
| 95 | `52b301af-a66a-4377-9e36-fe836879e833` | Empty request returned HTTP 400 validation error. Saved trace contains only trigger, validator, false branch and invalid-request responder. 21:11:54.895–21:11:54.952 UTC. |
| 96 | Same | Valid-shaped synthetic request with intentionally invalid run bearer reached the real Junction authority, received HTTP 401 and took the refusal response. Authority request 467 ms; total 21:12:08.443–21:12:08.986 UTC. No Klaviyo call. |

n8n marks a successfully handled refusal `success`; this is **not** a successful
business result. The GET-only inspection script reports path/status evidence,
not calendar acceptance. It checks current definition parameters, credential
references, error policies and connections, normalizing only specific observed
Cloud defaults. Definition mismatch now exits nonzero. Execution projection
excludes webhook headers, run tokens and provider bodies; unexpected error text,
node names and nonnumeric HTTP-status payloads cannot pass through as diagnostics.

Earlier executions 88–92 exposed real Cloud expression issues and failed before
provider work. The expression delimiter parser terminated a compiled template
containing adjacent closing braces; canonical serialization now avoids that
delimiter without changing its output. Cloud AST rewriting also rejected
optional catch bindings (`null does not match type Pattern`, execution 91).
ES2018 compilation supplies explicit catch bindings. Two attempted UI edits
appended instead of replacing code; exact readback caught those. The final full
graph was replaced coherently and independently source-matched. Do not reuse
the earlier failing draft revisions.

## Current-source synthetic acceptance

The separate credential-free fixture `NLOGeeBNQMURm0kL` was updated to the current
bundle and executed once. Saved execution **97**, actual revision
`5bd2ba6d-72aa-4c02-9f73-dc16359198c2`, passes all **22 synthetic assertions**.
It ran at 21:18:25.706–21:18:27.608 UTC; Code took 1,855 ms.
At 21:18:51.231 UTC, authenticated saved-execution readback independently matched:

- Code SHA-256 `8fad7c56a91854f0ab7bafda93a53c700f04548f10c26f017e4d3d8dc0395aad`.
- Complete output SHA-256 `a45d8be3246bc2e6ada522c3c286dd029e378c1e1cc54124149f1582d2b563fa`.
- Bundle SHA-256 `20c76c1a8a9c32fb72b313e97e4dc97d9f6f3826ece460570e768c0ab722caa2`.

This fixture has two nodes, zero credentials and zero network calls. It tests
six future local weeks, DST, explicit timing hypotheses, source references,
empty data, wrong account/currency, denied/changed authority, expired reads,
unsafe/incomplete pagination and duplicate campaigns. Batch 68 execution 87 is
historical proof of the previous bundle, not current-source proof.

## Secret handling incident and resolution

During setup, an execution-view diagnostic exposed the initially generated
inbound test token. Tom was informed. It was rotated in the dedicated n8n
credential and securely replaced in Fly staged secrets and Vercel Production
secrets; no token value is included here. The revoked value received HTTP 403.
Execution 96 demonstrates the replacement passed inbound Header Auth and reached
the separate run-authorization refusal. No provider/API key was exposed or rotated.

Native saved webhook execution inputs can contain the inbound bearer even when
Header Auth is used. Treat execution-read access as privileged; do not print raw
saved payloads or diagnostic UI snapshots. The hardened projection is not a
claim that n8n's own stored data is redacted. B21 retention/access work remains.
Fly secret changes are staged and Vercel secret changes apply to a future deploy;
neither runtime was deployed by this batch. Receiver URL/workflow/node pins and
the actual calendar database registration/binding remain unset.

## Validation and next work

Full application suite: **227 files / 3,050 tests** pass. **59 Node tests** cover
compiler/fixture, workflow graph, drift refusal, credential-reference isolation
and secret-safe projection. App/worker TypeScript, production Next build, focused
ESLint and diff checks pass. Native MCP tooling is unavailable here; the fallback
was supported editor operations plus authenticated GET readback and actual watched
Cloud tests, not a claim that an unavailable MCP validator ran.

Next, Codex must finish the native campaign HTTP/happy-path acceptance, bind and
register the reviewed receiver, release its separate runtime configuration, and
run a bounded owner-authorized calendar through Unc to stored artifact/receipts
and customer reload. Unattended operation also needs genuine workflow-level
failure visibility; no no-op error workflow is substituted for an alert.
Customer selection/recovery, other delivered lanes and the original B01–B24/
all-client/launch requirements remain open.

Nguyen's workflows remain untouched. No new business allowance, calendar run,
provider call, routine activation, customer send or ad change was made. The
preceding contractor-advice turn was no backend progress; this continuation
is concrete source/Cloud verification progress. Goal remains active, not blocked.
