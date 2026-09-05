// Resend webhook: hard bounces and spam complaints stop the flow immediately.
// Continuing to mail an address that bounced is how a young sending domain gets itself filtered,
// and getjunction.ai has no sending history to spend.
//
// Point Resend at https://getjunction.ai/api/resend-webhook for email.bounced + email.complained,
// and put the signing secret in RESEND_WEBHOOK_SECRET.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { rpc } from './_lib.mjs';

export const config = { api: { bodyParser: false } };

const raw = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

// Svix signature scheme, which is what Resend uses.
function verify(secret, headers, body) {
  const id = headers['svix-id'];
  const ts = headers['svix-timestamp'];
  const sigHeader = headers['svix-signature'];
  if (!id || !ts || !sigHeader) return false;

  // Reject anything older than five minutes so a captured request cannot be replayed.
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');

  // Header looks like "v1,<sig> v1,<sig>" — any one matching is enough.
  return sigHeader.split(' ').some((part) => {
    const sig = part.split(',')[1];
    if (!sig) return false;
    const a = Buffer.from(sig), b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return res.status(500).json({ ok: false, error: 'not configured' });

  const body = await raw(req);
  if (!verify(secret, req.headers, body)) return res.status(401).json({ ok: false });

  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return res.status(400).json({ ok: false });
  }

  const status =
    event.type === 'email.bounced' ? 'bounced' :
    event.type === 'email.complained' ? 'unsubscribed' : null;

  if (status) {
    const to = [].concat(event.data?.to || []);
    for (const address of to) {
      try {
        await rpc('junction_email_stop', { p_email: address, p_status: status });
        console.log('resend-webhook', event.type, status);
      } catch (e) {
        console.error('resend-webhook:', e.message);
      }
    }
  }

  return res.status(200).json({ ok: true });
}
