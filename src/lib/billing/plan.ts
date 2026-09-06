/* The one plan — client-safe constants. No env, no SDK: safe to import from components.

   Copy is verbatim from the landing page pricing card (design-reference/Junction Landing
   .dc.html §pricing / src/app/page.tsx) — the paywall must read exactly like it. */

export const PLAN_PRICE_USD = 100;
export const PLAN_CURRENCY = "usd";
export const PLAN_INTERVAL = "month";
export const TRIAL_DAYS = 14;

export const PLAN_COPY = {
  label: "Pricing — simple, like the rest",
  price: "$100",
  priceSuffix: "USD / month",
  trialBadge: "14-day free trial",
  checklist: [
    "Unc, working on your goal 24/7",
    "All 36 routines, customised to you",
    "Human experts behind him, always",
    "Nothing runs without your okay — everything receipted",
  ],
  cta: "Start your free trial",
  cancel: "Cancel any time",
} as const;
