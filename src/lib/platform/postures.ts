/* The three growth postures — the prototype's plan definitions (verbatim). Lifted out of
   derive.ts so the persistence mapping (src/lib/db/mapping.ts) can read them without importing
   the view model: derive → setup/home → setup/channels → db/mapping → derive was a cycle. */

import type { Posture } from "./plan";

export interface PostureDef {
  label: string;
  tag: string;
  thesis: string;
  fit: string;
  why: string;
  phases: { n: string; name: string; st: string; routines: string[]; you: string }[];
}

export const postureDefs: Record<Posture, PostureDef> = {
  brand: {
    label: "Brand-led organic",
    tag: "CURRENT PLAY",
    thesis: "Compound trust through your voice, convert it with retention, amplify with paid only once repeat holds.",
    fit: "Fits: low budget · strong voice · brand-first belief",
    why: "Chosen with you on 12 Aug. Your budget caps paid, your writing is the asset, and you believe brand compounds before sales. Someone sales-led would get a different plan — this one is shaped to where you add the most value, and it persists until we supersede it together.",
    phases: [
      { n: "1", name: "Organic brand engine", st: "ACTIVE", routines: ["Founder content engine", "Social repurposing", "Customer-question mining"], you: "~2 h/wk — your voice and taste, the part only you can do." },
      { n: "2", name: "Retention & lifecycle", st: "NOW", routines: ["Winback campaign prep", "Welcome flow tuning", "Review request timing"], you: "~20 min/day clearing approvals." },
      { n: "3", name: "Paid amplification", st: "GATED · repeat ≥ 18%", routines: ["Daily paid decisioning", "Organic-to-paid promotion"], you: "Weekly budget sign-off." },
      { n: "4", name: "Scale the organization", st: "GATED · NZ$40k MRR", routines: ["Specialist agents", "First human hire"], you: "Hire and graduation decisions." },
    ],
  },
  sales: {
    label: "Sales-led outbound",
    tag: "ALTERNATIVE",
    thesis: "Fill your calendar with qualified conversations and clear everything around the close.",
    fit: "Fits: strong closer · calls, DMs, demos · deal-driven",
    why: "If your edge is conversations — cold calls, LinkedIn DMs, demos — the machine should hunt, qualify and brief so every hour you spend is spent closing. Retention and content become support acts for pipeline.",
    phases: [
      { n: "1", name: "Pipeline engine", st: "WOULD ACTIVATE", routines: ["Lead research & scoring", "Supervised outbound drafts"], you: "~1 h/day — conversations and closing, your strength." },
      { n: "2", name: "Follow-up & pipeline", st: "NEXT", routines: ["Follow-up cadence", "Pipeline hygiene"], you: "Approve sends; take the meetings." },
      { n: "3", name: "Referral & expansion", st: "GATED · 20 closed deals", routines: ["Review request timing", "Winback campaign prep"], you: "The asks only a founder can make." },
      { n: "4", name: "Scale the organization", st: "GATED · NZ$40k MRR", routines: ["Sales agents", "First SDR hire"], you: "Hire and graduation decisions." },
    ],
  },
  paid: {
    label: "Paid-led scale",
    tag: "ALTERNATIVE",
    thesis: "Deploy capital into creative testing and buy learning faster than organic can compound.",
    fit: "Fits: capital to deploy · media experience · speed-first",
    why: "With capital and ad experience, paid buys learning fastest — the machine guards efficiency, kills losers overnight and scales winners inside hard guardrails while CRO keeps the funnel honest.",
    phases: [
      { n: "1", name: "Creative testing engine", st: "WOULD ACTIVATE", routines: ["Creative test planner", "Organic-to-paid promotion"], you: "Creative taste calls, weekly." },
      { n: "2", name: "Spend scaling", st: "GATED · ROAS ≥ 2.5×", routines: ["Daily paid decisioning", "Budget pacing guard"], you: "Budget sign-off as caps rise." },
      { n: "3", name: "Funnel & flows", st: "NEXT", routines: ["Welcome flow tuning", "Abandoned cart recovery"], you: "Approve test variants." },
      { n: "4", name: "Scale the organization", st: "GATED · NZ$40k MRR", routines: ["Specialist agents", "Media buyer hire"], you: "Hire and graduation decisions." },
    ],
  },
};
