"use client";
/* Browser side of billing: call the route, follow the URL Stripe gave us. */

async function follow(path: string): Promise<string | null> {
  try {
    const res = await fetch(path, { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string; fallback?: boolean };
    if (body.url) {
      window.location.assign(body.url);
      return null;
    }
    if (body.fallback) return "Billing isn’t switched on yet.";
    return body.error || "Something went wrong — try again in a moment.";
  } catch {
    return "Something went wrong — try again in a moment.";
  }
}

/** Start the trial (Stripe Checkout). Resolves with an error message, or null once redirecting. */
export const startCheckout = () => follow("/api/billing/checkout");
/** Open the Stripe Customer Portal (cancel, update card, invoices). */
export const openPortal = () => follow("/api/billing/portal");
