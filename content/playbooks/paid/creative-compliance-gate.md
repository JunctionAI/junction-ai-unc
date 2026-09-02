---
domain: paid
title: Creative compliance gate before human review
tags: [creative, compliance, qa, meta, review]
source: skills/CREATIVE-COMPLIANCE-GATE.md
---
An automated pre-review gate runs on every generated ad before a human sees it, so the founder only reviews what needs their eye. Everything unflagged is cleared; anything flagged carries the specific check, the offending element and the minimal fix.

The check matrix:
- Text fidelity (blocker): every specified text layer visible; no lorem ipsum, placeholder names or "XX" tokens; balanced quotation marks; no typos against the source row.
- Brand voice (warn): matches the client's voice; no refused words; tone consistent with the archetype.
- Compliance (blocker): no personal-attribute targeting language; no before/after bodies; no cure or treat claims; no diagnosis-implying questions; category overlay applied (health, finance); every factual claim traces to a source; no unverifiable scale claims.
- Composition (warn): no clipped text; real product rendered, not a placeholder; decorative elements intact; palette in the right family; aspect ratio as declared.
- Format (minor): file size sane for the platform; dimensions match the ratio.
- Character caps (minor): primary above-fold, headline, description within platform limits.

Recommendation logic: any blocker → re-roll; warnings only → manual review; all pass → ship.

Calibration: false positives are recorded as overrides with a reason and an approver; repeated override patterns update the rules. The gate learns.

In the product this is the Taste Gate: Unc proposes, the gate pre-checks, the founder approves — nothing publishes without the okay.
