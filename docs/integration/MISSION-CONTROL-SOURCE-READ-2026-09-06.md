# Mission Control stored-source read release — 6 September 2026

## Outcome

Unc can now verify an explicitly granted client's normalized, already-stored
email campaign data through its production operator console. This is a governed
data-source bridge, not a provider connector or a routine result.

| Client | Unc account | Exact source | Sent rows | Source max updated | Production read |
| --- | --- | --- | ---: | --- | --- |
| Home1nvasion | `1620999d-ee8e-4490-bfd6-b908a9fa86dc` | `junction.client_orgs / h1` | 73 | `2026-09-05T19:08:11.737281Z` | `2026-09-06T01:00Z` |
| Deep Blue Health | `4fae2ad8-194f-49c4-9954-39a6b6d35b14` | `public.client_accounts / 82d2ebf1-33aa-42a9-8d6e-f4238a5c7ac6` | 195 | `2026-09-05T18:42:53.175923Z` | `2026-09-06T01:00Z` |

H1 has 86 total warehouse rows; 73 satisfy the contract's `sent_at is not null`
filter. Neither count is a new Klaviyo API response.

## Contract and authority

- Source contract: `junction.source.email-campaigns.v1`.
- Source endpoint: Mission Control Edge Function `unc-source-read`, version 1,
  ID `34c8f4c0-4004-4f82-a768-17ae691e9436`.
- Unc entry point: `POST /api/ops/source-read`.
- Maximum response: 500 rows and 2 MB; 20-second caller timeout.
- Exact account, source project, source kind, source key, dataset, binding ID and
  client context generation are checked. Display names are never join keys.
- Source grant and Unc operator source-read authority are separate records. A
  source binding alone cannot call the bridge.
- The shared bridge secret was rotated on release and is stored only in the
  Vercel production environment and Supabase Edge Function secrets.

The RPC executes as its owner only after the exact active source grant is found.
`service_role`, `anon` and `authenticated` have no direct SELECT on
`h1.email_campaigns` or `dbh.email_campaigns`; browser roles cannot execute the
RPC. The response excludes contact/customer PII, raw provider payloads and email
body copy.

## Acceptance evidence

- Signed-in production H1 read: 73 sent rows and the exact source timestamp.
- Signed-in production DBH read: 195 sent rows and the exact source timestamp.
- Signed-in production AVGAR: exact binding visible, source-read authority absent,
  no read control rendered.
- Edge Function without authorization: 401 and `private, no-store`.
- Edge Function with browser Origin: 403 before source access.
- Unc endpoint without a verified operator session: 401 and `private, no-store`.
- SQL readback: RPC `SECURITY DEFINER`; service-only execute; browser execute false;
  service-role direct table SELECT false.
- No provider call, source scheduler change, client membership, routine switch,
  Slack route, publishing, customer message, ad mutation or spend occurred.

Production application deployment:
`dpl_DDfK1oSjv48oq4d426YM4S7HPytk`, rebuilt from application source
`e0e7e58ecb3dee4a4adb578a39c8da3d372d92a4` after secret rotation.

## Remaining boundary

These rows are not yet persisted as Unc routine datasets, and the source
timestamps are older than Unc's current one-hour default dataset freshness
window. The next release must keep source-backed data distinct from provider
OAuth state, record its real age, and prove an eligible read/draft routine against
that policy before calling either client runnable.

Rollback is narrow: revoke the two source-read authorities/grants and rotate the
bridge secret. Do not delete source data or alter provider credentials.
