# Intake API — for n8n (and anything else that can POST JSON)

`POST /api/intake` lets Tom's n8n workflows — or a Typeform/Tally form behind one — teach Unc
about a founder's business without anyone typing it into the app. Everything it writes lands in
the Client Brain (docs/CLIENT-BRAIN.md): memories the founder can see and correct under
**What Unc knows**, plus the structured rows the product already reads (business profile, goal,
resources, team, connectors).

Code: `src/app/api/intake/route.ts` (endpoint), `src/app/api/intake/keys/route.ts` (keys),
`src/lib/intake/{schema,apply,keys,rateLimit,memoryWriter}.ts`. Tables: migration
`supabase/migrations/0010_client_brain.sql` (`intake_keys`, `intake_events`, `memories`).

## Auth — intake keys

- A key belongs to one account. The **account owner** mints it in the app session:
  `POST /api/intake/keys` `{ "label": "n8n prod" }` → `{ key: "unc_ik_…", summary }`.
  The plaintext is returned **once**; only its SHA-256 is stored (`intake_keys.key_hash`).
- Present it as `Authorization: Bearer unc_ik_…`. Verification hashes the presented key, looks the
  hash up, and re-compares with a timing-safe equality. Revoked keys (`DELETE /api/intake/keys`
  `{ "id": … }`) are rejected; the row is kept for the audit trail.
- `GET /api/intake/keys` lists `{ id, label, createdAt, lastUsedAt, revokedAt }` — never a hash.
- Rate limit: 30 requests per 5 minutes per key (in-process). Over → `429` with `Retry-After`.
- There is no demo mode: without Supabase + the service role the endpoint answers `503`.

## Idempotency

Send `Idempotency-Key: <any string ≤200 chars>` (n8n: `{{$execution.id}}` or the form's
response id). A repeat with the same key on the same account replays the first outcome
(`replayed: true`) and writes nothing again. The hash of `<accountId>:<key>` is stored in
`intake_events.outcome.idempotency_key_hash`; the lookup scans the account's last 200 events.

## The contract

All fields optional; unknown top-level fields are dropped with a warning; a wrong *shape* is a
`400` naming the field. Strings are trimmed and capped (2,000 chars; notes 8,000), lists capped at
100 items (with a warning), body ≤ 256 KB. List fields also accept a newline-separated string
(a Typeform paragraph answer).

```json
{
  "business":   { "name": "Acme Co", "website": "https://acme.test", "socials": ["@acme"], "category": "Supplements",
                  "products": ["Omega", "Zinc"], "voice_notes": "plain, no hype", "market": "NZ + AU" },
  "goal":       { "title": "NZ$60,000 MRR", "baseline": 28400, "deadline": "2026-12-31", "currency": "NZD" },
  "resources":  { "budget_monthly": 3600, "hours_weekly": 8, "team": [{ "name": "Ana", "role": "Founder" }] },
  "platforms":  [{ "platform": "Shopify", "external_ref": "acme.myshopify.com" }, "Meta", "Google Analytics 4"],
  "contacts":   [{ "name": "Sam", "role": "Ops", "email": "sam@acme.test" }],
  "facts":      ["Ships from Auckland"],
  "preferences": ["Short replies"],
  "constraints": ["Never discount the flagship"],
  "events":     [{ "text": "Black Friday launch", "at": "2026-11-27" }],
  "notes":      "Founder is time-poor."
}
```

Validation worth knowing: `goal.deadline` is `YYYY-MM-DD` (or an ISO datetime); `goal.currency`
is a 3-letter code; `resources.hours_weekly` is 0–168; `contacts[].email` must be an address;
platform names are folded onto connector slugs (`Meta`/`Facebook Ads` → `meta_ads`,
`Google Analytics` → `ga4`, `Google Search Console` → `search_console`, otherwise lower-snake).

## What gets written

| Field | Memory (kind · confidence) | Structured row |
|---|---|---|
| business.name/website/socials/category/products/market | fact · 0.9 | `business_profiles.profile` merged (name, category, products ∪, market.region, sources ∪) |
| business.voice_notes | preference · 0.6 | `profile.voice.tone` |
| goal | decision · 0.9 | `goals` inserted **only if the account has none** (category revenue, tier governing); currency → `accounts.currency` |
| resources.budget_monthly / hours_weekly | fact · 0.9 | `resource_profiles` merged |
| resources.team[] / contacts[] | relationship · 0.9 | `team_members` appended when the name is new |
| platforms[] | fact · 0.9 | `connectors` row `status='disconnected'` + `external_ref` hint when none exists; an existing row keeps its status |
| facts[] / notes | fact · 0.6 | — |
| preferences[] | preference · 0.6 | — |
| constraints[] | constraint · 0.6 | — |
| events[] | event · 0.6 (`happens_at`) | — |

Rules: `source='intake'`, every memory points at the `intake_events` row (`source_ref`); identical
text already live on the account is skipped (reported in `warnings`); non-null values are never
overwritten with null; lists are unioned; the founder's own goal is never replaced.

Response: `200 { ok, event_id, written: { memories, memories_skipped, profile_fields, goal,
resource_fields, team_members, connectors }, warnings: [], replayed }`.

## n8n HTTP Request node

```
Method: POST
URL: https://<app>/api/intake
Authentication: Generic → Header Auth
  Name:  Authorization
  Value: Bearer unc_ik_…              ← store as an n8n credential, never in the workflow JSON
Send Headers:
  Content-Type: application/json
  Idempotency-Key: {{ $execution.id }}
Send Body: JSON
  {
    "business": { "name": "{{ $json.company }}", "website": "{{ $json.website }}" },
    "goal": { "title": "{{ $json.goal }}", "deadline": "{{ $json.deadline }}", "currency": "NZD" },
    "resources": { "budget_monthly": {{ $json.budget }}, "hours_weekly": {{ $json.hours }} },
    "platforms": {{ JSON.stringify($json.platforms) }},
    "preferences": "{{ $json.how_to_work_with_me }}",
    "notes": "{{ $json.anything_else }}"
  }
Options: Response → JSON; Continue on Fail (then branch on {{ $json.error }})
```

Errors to branch on: `401` (key missing/revoked — rotate), `400` (`error` names the field —
fix the mapping), `429` (back off `Retry-After`), `503` (deployment not configured).

## "Clients set up themselves" — Typeform/Tally → n8n → intake

1. **Form** (Tally or Typeform): company, website, socials (paragraph), what they sell, the one
   goal + a date + where it is now, monthly growth budget, hours a week, platforms (multi-select),
   who's on the team, "how do you like to work?" (paragraph), "anything Unc should know?"
   (paragraph). Hidden field: the founder's email.
2. **n8n**: form webhook → a `Set` node that maps answers onto the contract above (paragraph
   answers straight into `preferences`/`constraints`/`notes`; multi-select straight into
   `platforms`) → the HTTP Request node → an `IF` on `ok`.
3. **Account resolution**: one intake key = one account, so either run one workflow per beta
   founder with their key, or keep a lookup table (email → key) in n8n and pick the credential by
   the hidden email field. (A per-founder key is also what you revoke if a form leaks.)
4. **On success**: optionally post to Slack "Unc learned N things about <company>"; the founder
   sees the same rows under What Unc knows and can correct any of them.
5. **Re-submissions** are safe: identical facts dedupe, the goal is never overwritten, and the
   form's response id as the Idempotency-Key makes a webhook retry a no-op.
