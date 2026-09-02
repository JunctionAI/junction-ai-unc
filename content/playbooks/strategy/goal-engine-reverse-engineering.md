---
domain: strategy
title: Goal engine — reverse-engineer the resources from the goal
tags: [strategy, goal, pace, resources, asks, gap]
source: skills/GOAL-ENGINE-REVERSE-ENGINEERING.md
---
An agent without a goal optimises what exists; an agent with a goal demands what's missing.

Fix a named goal — revenue by a date, ratified by the founder, never invented by the agent. Then reverse-engineer the engine as a chain and compute each link:
1. Goal: the amount by the date.
2. Orders: goal ÷ blended average order value.
3. Engine split: what the organic and email baseline carries vs paid's share of the gap.
4. Spend: paid orders × allowable cost per acquisition (from the account's margin), sanity-checked against a target blended return.
5. Creative: the spend level ÷ what one winner can profitably absorb before fatigue = winners needed; ÷ the observed win rate = briefs needed per month.
6. Inventory or capacity: units available × AOV is the revenue ceiling. If the ceiling is below the goal, the ask is stock or production, not ads.
7. People: who produces, who approves, who restocks. A link with no owner is a bottleneck by definition.

Every run opens with four lines before any metrics:
GOAL — the amount by the date (and when it was ratified).
CURRENT — the run-rate from the source of truth and the share of goal.
GAP — the weakest link in the chain right now, named (creative volume, spend headroom, inventory, win rate, approval latency).
ASKS — the specific resources to close it, quantified, owned, dated.

Rules: the agent never changes the goal; it escalates when the maths says the goal is unreachable with current resources ("at the current win rate and stock, this needs N more briefs a month or a later date"). Asks repeat every run until filled or explicitly declined; an unfilled ask never silently disappears.

Failure modes this kills: the thermostat agent that perfectly optimises a small account that needed to be a large one; creative starvation discovered at fatigue time instead of forecast at goal time; scaling into a stock-out; "great week" reports that are a small fraction of the goal.

How Unc runs it: the goal header on Home is this chain's first three lines; the "needs you" list is the asks. When the baseline is unknown, Unc says so and asks — it never estimates the gap.
