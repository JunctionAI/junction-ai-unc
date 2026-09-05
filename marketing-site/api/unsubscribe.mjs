// Unsubscribe. GET = the link in the footer. POST = Gmail/Yahoo one-click (List-Unsubscribe-Post).
// The token is an HMAC of the address, so nobody can unsubscribe anyone else from a guessed URL.

import { rpc, unsubValid } from './_lib.mjs';

const page = (title, line) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Junction</title></head>
<body style="margin:0;background:#F1F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:520px;margin:14vh auto;padding:40px 32px;background:#fff;border:1px solid #DCE8F2;border-radius:16px;">
<h1 style="font-size:22px;color:#0B2138;margin:0 0 12px;">${title}</h1>
<p style="font-size:16px;line-height:1.6;color:#243B52;margin:0 0 22px;">${line}</p>
<a href="https://getjunction.ai" style="font-size:15px;color:#2E86D0;">getjunction.ai</a>
</div></body></html>`;

export default async function handler(req, res) {
  const { e: email, t: token } = req.query || {};

  if (!email || !unsubValid(email, token)) {
    if (req.method === 'POST') return res.status(400).json({ ok: false });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(400).send(page('That link did not work', 'Email tom@getjunction.ai and I will take you off by hand.'));
  }

  try {
    await rpc('junction_email_stop', { p_email: String(email), p_status: 'unsubscribed' });
  } catch (err) {
    console.error('unsubscribe:', err.message);
    if (req.method === 'POST') return res.status(500).json({ ok: false });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(page('Something broke', 'Email tom@getjunction.ai and I will take you off by hand.'));
  }

  if (req.method === 'POST') return res.status(200).json({ ok: true });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(page('Done, you are off the list', 'No more emails from me. No hard feelings.'));
}
