// The clock. Resend has no automation builder, so this is it: once a day, send whatever is due.
// Vercel cron hits this with `Authorization: Bearer $CRON_SECRET`.
//
// Safe to run twice. junction_email_mark_sent inserts into a table with unique(subscriber, flow,
// step); a duplicate insert fails, mark_sent returns false, and the email is not sent again.

import { configured, rpc, sendEmail, unsubUrlFor } from './_lib.mjs';
import { render, nextSendAfter, SITE, FROM, REPLY_TO, SCHEDULE } from './_flow.mjs';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false });
  }
  if (!configured()) return res.status(500).json({ ok: false, error: 'missing env' });

  const started = Date.now();
  let due;
  try {
    due = await rpc('junction_email_due', { p_limit: 200 });
  } catch (e) {
    console.error('flow-tick: due', e.message);
    return res.status(500).json({ ok: false, error: 'db' });
  }

  const result = { ok: true, due: due.length, sent: 0, skipped: 0, failed: 0, finished: 0 };

  for (const s of due) {
    const step = s.step + 1;
    if (step > SCHEDULE.length) {
      result.skipped++;
      continue;
    }
    try {
      const unsubUrl = unsubUrlFor(s.email, SITE);
      const mail = render(step, { website: s.website, unsubUrl });
      const messageId = await sendEmail({
        to: s.email, from: FROM, replyTo: REPLY_TO, unsubUrl,
        subject: mail.subject, html: mail.html,
      });
      const next = nextSendAfter(step);
      const marked = await rpc('junction_email_mark_sent', {
        p_id: s.id, p_step: step, p_message_id: messageId, p_next_send_at: next,
      });
      if (marked) {
        result.sent++;
        if (!next) result.finished++;
      } else {
        result.skipped++;
      }
    } catch (e) {
      // Leave next_send_at alone — tomorrow's run retries this person.
      console.error(`flow-tick: ${s.email} step ${step}:`, e.message);
      result.failed++;
    }
  }

  // Heartbeat. A cron nobody watches is a cron that stalls everyone mid-flow for weeks,
  // so this line goes into the Vercel log every single day, even on a quiet one.
  result.ms = Date.now() - started;
  console.log('flow-tick', JSON.stringify(result));
  return res.status(200).json(result);
}
