# Infrastructure — scaling + cost (founder decision 4)

**Question:** Fly.io — does it scale, and how do we launch India cheaply without losing quality?

## Fly.io
- Pay-per-second Machines; a `shared-cpu-1x` 256MB always-on ≈ **US$2/mo**; a 2-machine autoscaled worker ≈ US$15–25/mo. Scales horizontally by adding Machines per region; our worker is stateless (state in Supabase) so it scales trivially. Regions include **Sydney (syd)**, **Singapore (sin)** and **Mumbai (bom)** — the worker can run in `bom` for India accounts with no code change (`fly.toml` `primary_region`).
- Verdict: yes for the worker. It is not the bottleneck; model tokens are.

## Where the money actually goes (per account / month, launch cadence)
| Item | Est. | Lever |
|---|---|---|
| Model tokens | US$5–15 | Route mechanics (decisions, scans, self-review) to **fast tiers** (Haiku / Gemini Flash), keep Sonnet-class for chat + narrative; prompt caching on the system prompt + context; per-account token budget in `llm_usage` |
| Supabase | ~US$0.5–2 (Pro shared) | One project, tenant schemas; Mumbai region `ap-south-1` available if India latency matters |
| Vercel | ~US$0–1 | Static + edge; Pro team already paid |
| Fly worker | ~US$0.2 | Shared across accounts |
| Airbyte | variable | Row-based pricing can dominate for big Shopify stores → direct API readers already exist for launch platforms; use Airbyte only where a reader doesn't |

**India plan:** Fly `bom` + Supabase `ap-south-1` (second project or region) when India accounts > ~20; until then Sydney serves India at ~150–200 ms, fine for a non-realtime product. Cost floor ≈ US$7–20/account → INR pricing must stay above ~₹2,500 (see PRICING-BY-COUNTRY.md).

**Quality guard:** the eval harness + the taste ledger; any tier change is A/B'd on self-review quality and approval rates before rollout.

Sources: fly.io/docs/about/pricing, withorb Fly pricing 2025, deployhandbook Fly pricing 2026.
