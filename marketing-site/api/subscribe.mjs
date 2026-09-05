// Signup endpoint. Writes the subscriber, then sends email 1 immediately — the one thing
// the person literally just asked for. Everything after this is the cron's job.
//
// Handles both the popup (fetch/JSON) and the plain <form> fallback (urlencoded → redirect),
// so the page still works with JavaScript off.

import { configured, rpc, sendEmail, unsubUrlFor, validEmail, tidyUrl } from './_lib.mjs';
import { render, nextSendAfter, SITE, FROM, REPLY_TO } from './_flow.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const b = req.body || {};
  const wantsJson = (req.headers['content-type'] || '').includes('application/json');
  const done = (ok, error) => {
    if (wantsJson) return res.status(ok ? 200 : 400).json({ ok, error });
    return res.redirect(303, ok ? '/checklist-on-its-way' : '/?signup=error');
  };

  // Honeypot. Real people never fill this in; bots fill everything.
  if (String(b.company || '').trim()) return done(true);

  const email = String(b.email || '').trim().toLowerCase();
  const website = tidyUrl(b.website);
  if (!validEmail(email)) return done(false, 'That email address does not look right.');

  if (!configured()) {
    console.error('subscribe: missing env');
    return done(false, 'Not set up yet — email tom@getjunction.ai and I will add you by hand.');
  }

  let row;
  try {
    const out = await rpc('junction_email_subscribe', {
      p_email: email,
      p_website: website,
      p_source: String(b.source || 'site-popup').slice(0, 40),
    });
    row = Array.isArray(out) ? out[0] : out;
  } catch (e) {
    console.error('subscribe: db', e.message);
    return done(false, 'Could not save that — email tom@getjunction.ai instead.');
  }

  // Already on the list: say yes, send nothing. A second signup must never restart the flow.
  if (!row?.is_new) return done(true);

  try {
    const unsubUrl = unsubUrlFor(email, SITE);
    const mail = render(1, { website, unsubUrl });
    const messageId = await sendEmail({
      to: email, from: FROM, replyTo: REPLY_TO, unsubUrl,
      subject: mail.subject, html: mail.html,
    });
    await rpc('junction_email_mark_sent', {
      p_id: row.id, p_step: 1, p_message_id: messageId, p_next_send_at: nextSendAfter(1),
    });
  } catch (e) {
    // They are saved. The cron will pick them up and send step 1 on its next run, so a
    // Resend blip costs a few hours, not the subscriber.
    console.error('subscribe: send', e.message);
  }

  return done(true);
}
