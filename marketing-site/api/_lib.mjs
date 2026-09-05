// Shared plumbing for the email flow. Supabase RPC + Resend send + unsubscribe tokens.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const env = (k) => process.env[k];

export function configured() {
  return Boolean(env('SUPABASE_URL') && env('SUPABASE_SERVICE_ROLE_KEY') && env('RESEND_API_KEY') && env('UNSUB_SECRET'));
}

// Every DB call goes through one of the four locked-down RPCs. The junction schema is not
// exposed to PostgREST, so there is no other way in — which is the point.
export async function rpc(name, args) {
  const r = await fetch(`${env('SUPABASE_URL')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: env('SUPABASE_SERVICE_ROLE_KEY'),
      Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`rpc ${name} ${r.status} ${await r.text()}`);
  return r.json();
}

export async function sendEmail({ to, subject, html, from, replyTo, unsubUrl }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
      reply_to: replyTo,
      // One-click unsubscribe. Gmail and Yahoo require this on bulk mail, and it is the
      // difference between the inbox and the promotions tab for a new sending domain.
      headers: {
        'List-Unsubscribe': `<${unsubUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`resend ${r.status} ${JSON.stringify(body)}`);
  return body.id || null;
}

const norm = (e) => String(e || '').trim().toLowerCase();

export const unsubToken = (email) =>
  createHmac('sha256', env('UNSUB_SECRET')).update(norm(email)).digest('hex').slice(0, 32);

export function unsubValid(email, token) {
  const a = Buffer.from(unsubToken(email));
  const b = Buffer.from(String(token || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

export const unsubUrlFor = (email, site) =>
  `${site}/api/unsubscribe?e=${encodeURIComponent(norm(email))}&t=${unsubToken(email)}`;

// Deliberately permissive. Bounces are handled by the webhook; rejecting real addresses at
// the form because of a clever regex is the more expensive mistake.
export const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(norm(e));

export function tidyUrl(u) {
  const s = String(u || '').trim();
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    return new URL(withScheme).toString().slice(0, 300);
  } catch {
    return null;
  }
}
