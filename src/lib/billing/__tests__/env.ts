/* Test env helpers — fake Stripe values (no account exists; nothing here is real). */

export const FAKE_ENV = {
  STRIPE_SECRET_KEY: "sk_test_unit_fake_000000000000000000",
  STRIPE_WEBHOOK_SECRET: "whsec_unit_fake_secret_000000000000",
  STRIPE_PRICE_ID: "price_unit_fake_000",
  NEXT_PUBLIC_APP_URL: "https://unc.example.test",
  NEXT_PUBLIC_SUPABASE_URL: "https://fake.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-fake",
  SUPABASE_SERVICE_ROLE_KEY: "service-fake",
} as const;

const KEYS = Object.keys(FAKE_ENV) as (keyof typeof FAKE_ENV)[];
let saved: Partial<Record<keyof typeof FAKE_ENV, string | undefined>> = {};

export function setFakeEnv(overrides: Partial<Record<keyof typeof FAKE_ENV, string | undefined>> = {}) {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) {
    const v = k in overrides ? overrides[k] : FAKE_ENV[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
export function clearBillingEnv() {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
}
export function restoreEnv() {
  for (const k of KEYS) {
    const v = saved[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
