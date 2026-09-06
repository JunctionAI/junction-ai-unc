# Mission Control source-backed routine reader — 6 September 2026

## Outcome

The production Unc worker can now consume explicitly granted Home1nvasion and
Deep Blue Health campaign history from the normalized Mission Control source.
This is a server-side, account-scoped runtime data path. It does not copy a
provider credential into Unc, mark Klaviyo connected, enable a routine, dispatch
a workflow or perform an outward action.

| Client | Unc account | Runtime grant | 90-day rows | Source max updated |
| --- | --- | --- | ---: | --- |
| Home1nvasion | `1620999d-ee8e-4490-bfd6-b908a9fa86dc` | `b7a3ad27-de07-440a-89e9-d03601cab21f` | 1 | `2026-09-05T19:08:11.737281Z` |
| Deep Blue Health | `4fae2ad8-194f-49c4-9954-39a6b6d35b14` | `f53e3893-ffe9-46f6-bc6a-b50de0065f55` | 15 | `2026-09-05T18:42:53.175923Z` |

The smaller row counts are the routine query's 90-day window, not missing source
rows. The operator bridge independently returned 73 sent H1 rows and 195 sent DBH
rows across its full bounded result.

## Authority and behavior

- `account_source_dataset_grants` authorizes one exact account, context
  generation, verified source binding, platform, dataset and normalization
  contract, with a maximum source age. It is service-only and tenant identities
  are immutable after insert.
- `authorize_account_source_dataset_read` refuses paused accounts, stale context
  generations, revoked grants, mismatched source bindings and unregistered
  datasets. Browser roles cannot select the registry or execute the function.
- Runtime admission also requires the account in
  `UNC_MISSION_CONTROL_SOURCE_ACCOUNTS`; database authority alone cannot activate
  a read path.
- `accountDataReader` routes only the admitted Klaviyo campaign-history query to
  the internal bridge. It does not unseal or call a provider credential, and it
  does not fall back to a provider when the source path fails.
- The reader checks complete pagination, exact source identity, maximum 500 rows,
  duplicate IDs, future timestamps and the grant's source-age policy. It returns
  normalized subjects and available performance metrics with explicit nulls for
  unavailable fields.
- H1's native daily source-and-learning review remains an internal continuity
  process. It is not relabelled as one of Unc's seven customer-facing Email & SMS
  routines. Routine selection stays independent and composable.

## Release and acceptance evidence

- Application source: `2b903868a066dd6dce1f7d6b7792f217134f243f`.
- Production Vercel deployment: `dpl_EE8yo3AocYs4uhEJna2RHL8oLCXJ`.
- Fly worker release `44`, image manifest
  `sha256:0d4467c6d8b274768686c03b3423b554a64a4bcddc669bd25ad421d633956ec1`,
  compiled with `UNC_BUILD_SHA=2b90386`.
- Compiled worker readback returned one H1 and fifteen DBH 90-day campaign rows,
  exact source timestamps, `junction.source.email-campaigns.v1`, and
  `providerApiCall=false` for both accounts.
- The final coordinated source secret rotation was followed by a signed-in H1
  operator read of 73 sent rows. Source, Vercel and worker secrets are
  synchronized; their values were not printed or copied into documentation.
- 243 test files / 3,234 tests passed. Application and worker TypeScript,
  production build, lint and diff checks passed. The isolated source verifier
  passed twelve authority and denial controls with no provider or remote database
  calls.
- Production remains at zero enabled routines and zero runs for H1 and DBH. No
  client membership, schedule, Slack route, workflow, provider record, customer
  message, campaign, ad or spend was changed.

## Remaining boundary

The source path makes eligible read/draft routines possible; it does not decide
which routines a client has adopted. H1 and DBH still need exact routine mapping,
business inputs for the selected draft, useful-output acceptance and an approved
delivery route. Customer login membership and provider write authority remain
separate grants. The 24-hour source-age policy is an explicit initial runtime
policy, not proof of ongoing provider synchronization or a universal SLA.
