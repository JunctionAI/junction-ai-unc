# Account source bindings — Batch 87

Junction now has one canonical, service-only record of which pre-existing data
system belongs to which Unc client account. This resolves source identity; it
does not copy credentials, create client logins, enable routines or grant action
authority.

## Live verified bindings

| Unc client | Unc account | Existing source | Source identity |
| --- | --- | --- | --- |
| AVGAR Sport | `aa5cfc84-2569-4c99-9b40-67003ae55eda` | Mission Control `public.client_accounts` | `9fa0ec20-b157-415a-989f-27362235c131` |
| Deep Blue Health | `4fae2ad8-194f-49c4-9954-39a6b6d35b14` | Mission Control `public.client_accounts` | `82d2ebf1-33aa-42a9-8d6e-f4238a5c7ac6` |
| Unity MMA | `083d6e9f-4697-4845-8869-952c0e1f9d83` | Mission Control `public.client_accounts` | `fa43e65b-75e1-4ee5-9378-0d13e997e339` |
| Home1nvasion | `1620999d-ee8e-4490-bfd6-b908a9fa86dc` | Mission Control `junction.client_orgs` | `h1` |
| Aerspan Airdomes | `f206666f-ac52-4508-a508-3535a8f229a3` | Mission Control `junction.client_orgs` | `domes` |

Independent production readback at `2026-09-06T00:31:58.670623Z` returned five
verified rows, five distinct Unc accounts and five distinct external identities.
The legacy AVGAR account, Rory O'Keefe, NZ Pure Health, Ribbon Rose and Own Your
Energy remain deliberately unbound because their exact identity is unresolved or
the Unc account does not yet exist.

## Enforcement

- Browser roles have no table or function access. Only the server service role
  can read or write source bindings.
- A write uses the authenticated operator identity from the server, requires
  active read access plus separately recorded source-binding authority, and
  checks the current client context generation.
- One external source identity cannot be assigned to two Unc accounts.
- Updates use an expected revision, so a stale operator cannot overwrite a
  newer binding.
- Rows contain source IDs and evidence references only. They never contain API
  keys, OAuth tokens or provider credentials.

The isolated database verifier passed refusal, uniqueness, context-generation,
compare-and-swap and function-ACL cases with zero provider and zero remote calls.
The operator API separately rejects unsigned, cross-origin, malformed, oversized,
foreign-account and stale requests.

The Mission Control table inventory reports 65 existing tables with RLS disabled.
A separate privilege readback across every `h1`, `dbh`, `nzph` and `junction`
table found no `SELECT`, `INSERT`, `UPDATE` or `DELETE` privilege for either
`anon` or `authenticated`. The advisory therefore remains hardening debt, but
the checked browser roles are not currently granted access to those tables.
Do not blanket-enable RLS without mapping the existing database-role callers;
that could interrupt the working ingestion jobs.

## Application release

Source `68d975298e87d9405db1e3916d6ac8a3974e2403` is live as Vercel deployment
`dpl_HLBvtt6JxRhpBk32C5kd7aAFMuuh`. Candidate and canonical health report the
matching source, a healthy database and fresh compatible worker. Anonymous source
reads return 401 with private/no-store caching. The signed-in ops console shows
the exact AVGAR binding and a second isolated Deep Blue Health binding after
reload; DBH still truthfully shows zero login members, zero dated connector reads
and zero enabled routines.

## What this unlocks next

Each client's source read adapter and routine registry can now resolve from a
stable account identity instead of matching names or copying credentials. The
next acceptance is a fresh account-specific source read, followed by an enabled
read/draft routine that persists a useful result and receipt. Login membership,
Slack activation, publishing, customer messaging, ad mutation and spend remain
separate gates.
