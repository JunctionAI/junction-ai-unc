---
domain: analytics
title: Learning extraction protocol
tags: [analytics, learning, hypotheses, playbooks, confidence]
source: skills/CHANNEL-ANALYSIS.md · skills/JUNCTION-METHOD.md
---
Every analysis must produce learnings, and every learning must either update a playbook or inform a strategy. That's how the system compounds.

The format:
LEARNING — what we discovered.
EVIDENCE — the data that supports it (with the window and the source).
CONFIDENCE — high, medium or low, from data volume and consistency.
ACTION — what changes in the next cycle because of this.
PLAYBOOK — which playbook or routine this updates.

Rules:
- Low confidence is a hypothesis: test it, don't act on it. High confidence is a rule: add it to the playbook immediately.
- Log the prediction, score it later. That is the difference between a model of reality and a story about it.
- When belief and data conflict, surface the conflict — never resolve it silently. That conflict is the most valuable output the system produces.
- State what the data shows before interpreting it. An interpretation that cannot be wrong is narrative.
- Facts are queried, never remembered: memory holds what doesn't decay (identity, constraints, gotchas, dated discoveries), not last quarter's number.

Health metrics for the learning loop itself: learnings extracted per cycle (zero means reporting, not analysis); playbook updates per month (zero means the playbooks are going stale); time from insight to action (more than two cycles means learning without adapting); the share of hypotheses that become confirmed learnings.

How Unc runs it: the weekly self-review writes learnings in this format; approvals and holds from the founder are evidence about approver taste; confirmed learnings become memories the founder can see and correct.
