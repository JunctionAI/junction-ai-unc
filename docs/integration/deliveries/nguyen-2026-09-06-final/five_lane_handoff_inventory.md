# Five-lane handoff inventory (final merge 2026-09-06)

Replaces 	om-2026-09-06-correction (stale D03) with #45 business corrections + #41 final D03 overlays.

D03 frozen revision: c771cd3-8899-4401-915c-40d4477e48e2 (supersedes e5ae41ae-d025-4231-9f5c-99589c43e88a).

D03 fixtures in this bundle are **offline exact-final-builder fixed-clock replays**, not historical saved artifacts.

| routine | workflow ID | revision | credential (metadata) | packaged file | proof class | remaining blocker |
|---|---|---|---|---|---|---|
| D02-W01 daily_decisioning | WljLEMABNjfUkbB1 | 053e1e02-c816-4d7c-aa32-08e9eb06e6f3 | Facebook Graph account 2 / j6w7zi8lhRivXI0q (facebookGraphApiOAuth2Api) | examples/D02_meta_decisions_sample.json | PACKAGED_ARTIFACT_READY | Codex Unc adapter; packaged example not FINAL_REVISION_TESTED |
| D02-W02 creative_testing | WljLEMABNjfUkbB1 | 053e1e02-c816-4d7c-aa32-08e9eb06e6f3 | Facebook Graph account 2 / j6w7zi8lhRivXI0q | examples/D02_meta_decisions_sample.json | PACKAGED_ARTIFACT_READY | test_budget_per_variant TBD; Codex adapter |
| D02-W03 hook_rotation | WljLEMABNjfUkbB1 | 053e1e02-c816-4d7c-aa32-08e9eb06e6f3 | Facebook Graph account 2 / j6w7zi8lhRivXI0q | examples/D02_meta_decisions_sample.json | PACKAGED_ARTIFACT_READY | Codex adapter |
| D02-W04 ad_fatigue | WljLEMABNjfUkbB1 | 053e1e02-c816-4d7c-aa32-08e9eb06e6f3 | Facebook Graph account 2 / j6w7zi8lhRivXI0q | examples/D02_meta_decisions_sample.json | PACKAGED_ARTIFACT_READY | Codex adapter |
| D02-W05 creator_whitelisting | WljLEMABNjfUkbB1 | NOT_VERIFIED | Facebook Graph account 2 / j6w7zi8lhRivXI0q | none | BLOCKED_INPUT | Tom: approved creator handles/rights/consent |
| D02-W06 creative_test_planner | WljLEMABNjfUkbB1 | 053e1e02-c816-4d7c-aa32-08e9eb06e6f3 | Facebook Graph account 2 / j6w7zi8lhRivXI0q | examples/D02_meta_decisions_sample.json (blocked ledger item included) | HISTORICAL_PROVIDER_PROOF | experiment_ledger_connected; Codex adapter |
| D02-W07 budget_pacing | WljLEMABNjfUkbB1 | 053e1e02-c816-4d7c-aa32-08e9eb06e6f3 | Facebook Graph account 2 / j6w7zi8lhRivXI0q | examples/D02_meta_decisions_sample.json | PACKAGED_ARTIFACT_READY | Codex adapter |
| D02-W08 organic_to_paid | WljLEMABNjfUkbB1 | NOT_VERIFIED | Facebook Graph account 2 / j6w7zi8lhRivXI0q | none | BLOCKED_INPUT | Tom: approved organic-performance source |
| D02-W09 Google Ads BOFU (mapping) | TSajBg5SB32NQtLE | 960c91bc-7216-4999-aa0b-045a4beb1d4d | DataForSEO Unnamed credential / SK8RwgcCrYPQdWRB | examples/D02-W09_gads_bofu_plan.json | PACKAGED_ARTIFACT_READY | Codex distinct Unc mapping (not D03-W01); login_customer_id + conversion_action TBD for mutate |
| D03-W01 keyword_opportunity | XiXJKuph1fAeH9pe (wrapper); OUerIfgAkMnhkuen (historical TEST logic) | ac771cd3-8899-4401-915c-40d4477e48e2 | DataForSEO SK8RwgcCrYPQdWRB; wrapper Header Auth Y9Xu3zApLSrcWu1e | d03/D03-W01_build_artifact_final_jscode.js; d03/D03-W01_exact_replay_US_77.json; d03/D03-W01_exact_replay_NZ_78.json; d03/D03-W01_exact_replay_AU_79.json; d03/D03-W01_exact_final_builder_test_summary.json; d03/D03-W01_edge_case_regression.json | PACKAGED_ARTIFACT_READY | Codex independent diff review + Unc repin to ac771cd3-8899-4401-915c-40d4477e48e2 before further live execution |
| D03-W02 content_gap | OUerIfgAkMnhkuen | cda63062-b8c5-4f3a-a718-a71bd6e1040f | DataForSEO SK8RwgcCrYPQdWRB | examples/D03_seo_historical_pack.json | PACKAGED_ARTIFACT_READY | Codex adapter |
| D03-W03 AI-search probe | OUerIfgAkMnhkuen | NOT_VERIFIED | n/a | none | BLOCKED_INPUT | Tom/Codex: intended AI-search source |
| D03-W04 CMS/Admin | n/a | NOT_VERIFIED | Shopify OAuth parked | none | BLOCKED_INPUT | CMS/Admin access; Shopify deferred by Tom |
| D03-W05 serp_position_watch | OUerIfgAkMnhkuen | cda63062-b8c5-4f3a-a718-a71bd6e1040f | DataForSEO SK8RwgcCrYPQdWRB | examples/D03_seo_historical_pack.json | PACKAGED_ARTIFACT_READY | Codex adapter |
| D03-W06 page/content analysis (distinct from backlink gap) | OUerIfgAkMnhkuen | cda63062-b8c5-4f3a-a718-a71bd6e1040f | DataForSEO SK8RwgcCrYPQdWRB | examples/D03_seo_historical_pack.json (content_gap item; keep distinct from D03-W07) | HISTORICAL_PROVIDER_PROOF | Keep distinct from D03-W07 backlink-gap mapping |
| D03-W07 backlink_gap (reserved mapping already assigned) | OUerIfgAkMnhkuen | cda63062-b8c5-4f3a-a718-a71bd6e1040f | DataForSEO SK8RwgcCrYPQdWRB | examples/D03_seo_historical_pack.json (competitor/backlink gap item) | PACKAGED_ARTIFACT_READY | Codex adapter/registration for reserved D03-W07 mapping |
| D01-W02 viral_hook_mining | lMXjTgd3Qh4vZaMp | c8d6955d-0033-47ce-9672-399f7f10118c | DataForSEO SK8RwgcCrYPQdWRB | examples/D01-W02_hooks.json | PACKAGED_ARTIFACT_READY | Codex adapter; how-to-shoot TBD |
| D01-W03 customer_question_mining | lMXjTgd3Qh4vZaMp | c8d6955d-0033-47ce-9672-399f7f10118c | DataForSEO SK8RwgcCrYPQdWRB | examples/D01-W03_questions.json | PACKAGED_ARTIFACT_READY | support/DM/review source not connected; Codex adapter |
| D05-W01 welcome | DV5Wv6wXlzpz4zeN | f96c1b82-348a-4711-823f-a9f68498793e | Header Auth account / 4mkTKL1q0njNafh9 | D05-W01_welcome.json (+ D05-W01_welcome_operator_notes.json) | PACKAGED_ARTIFACT_READY | Codex adapter; FINAL_REVISION_TESTED of packaged draft = not done |
| D05-W02 abandoned_cart | DV5Wv6wXlzpz4zeN | NOT_VERIFIED | Header Auth account / 4mkTKL1q0njNafh9 | none | BLOCKED_INPUT | Tom: contact_frequency_cap |
| D05-W03 segmentation | DV5Wv6wXlzpz4zeN | f96c1b82-348a-4711-823f-a9f68498793e | Header Auth account / 4mkTKL1q0njNafh9 | examples/D05-W03_segmentation.json | PACKAGED_ARTIFACT_READY | Codex adapter; size is aggregate gap not live membership |
| D05-W04 winback | DV5Wv6wXlzpz4zeN | NOT_VERIFIED | Header Auth account / 4mkTKL1q0njNafh9 | none | BLOCKED_INPUT | Tom: margin_floor |
| D05-W05 post_purchase | DV5Wv6wXlzpz4zeN | f96c1b82-348a-4711-823f-a9f68498793e | Header Auth account / 4mkTKL1q0njNafh9 | D05-W05_post_purchase.json (+ D05-W05_post_purchase_operator_notes.json) | PACKAGED_ARTIFACT_READY / needs_input | approved education copy needs_input; Codex adapter |
| D05-W06 review_timing | DV5Wv6wXlzpz4zeN | f96c1b82-348a-4711-823f-a9f68498793e | Header Auth account / 4mkTKL1q0njNafh9 | examples/D05-W06_review_timing.json | PACKAGED_ARTIFACT_READY | suppression limits TBD; Codex adapter |
| D05-W07 campaign_calendar | DV5Wv6wXlzpz4zeN | f96c1b82-348a-4711-823f-a9f68498793e | Header Auth account / 4mkTKL1q0njNafh9 | D05-W07_six_week_calendar.json | PACKAGED_ARTIFACT_READY | Codex adapter; FINAL_REVISION_TESTED of packaged calendar = not done |

## needs_input
- D05-W05 education section

## blocked
- D02-W05, D02-W08, D03-W03, D03-W04, D05-W02, D05-W04
