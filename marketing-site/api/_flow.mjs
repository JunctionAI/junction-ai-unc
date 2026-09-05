// The Bottleneck welcome flow — six emails over 25 days, then it stops.
// Written plain on purpose: one idea per email, short sentences, no marketing vocabulary.
// Nothing here sends by itself; subscribe.js sends step 1, flow-tick.js sends the rest.

export const SITE = 'https://getjunction.ai';
export const FROM = 'Tom at Junction <tom@getjunction.ai>';
export const REPLY_TO = 'tom@getjunction.ai';

// Days after signup that each email goes out.
export const SCHEDULE = [0, 3, 7, 12, 18, 25];

// Milliseconds until the next email after sending step N (1-indexed). null = flow finished.
export function nextSendAfter(step) {
  if (step >= SCHEDULE.length) return null;
  const days = SCHEDULE[step] - SCHEDULE[step - 1];
  return new Date(Date.now() + days * 86400_000).toISOString();
}

const INK = '#0B2138', BLUE = '#2E86D0', BODY = '#243B52', MUTED = '#6E8BA8', LINE = '#DCE8F2';

// Shared shell. Tables, inline styles, 600px — the boring choices are the ones that render
// the same in Outlook, Gmail and Apple Mail.
function shell({ body, unsubUrl }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:0;background:#F1F6FA;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F1F6FA;">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:16px;border:1px solid ${LINE};">
    <tr><td style="padding:32px 36px 0;">
      <img src="${SITE}/assets/brand/logomark-blue.png" width="26" height="26" alt="Junction" style="display:block;border:0;">
    </td></tr>
    <tr><td style="padding:22px 36px 34px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:17px;line-height:1.65;color:${BODY};">
${body}
    </td></tr>
  </table>
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;">
    <tr><td style="padding:20px 36px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${MUTED};">
      You're getting this because you asked for the fifteen-minute checklist at getjunction.ai.<br>
      <a href="${unsubUrl}" style="color:${MUTED};text-decoration:underline;">Unsubscribe</a> &nbsp;&middot;&nbsp; Junction AI, New Zealand
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

const h2 = (t) => `<h2 style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-weight:700;font-size:23px;line-height:1.25;color:${INK};margin:0 0 18px;">${t}</h2>`;
const p = (t) => `<p style="margin:0 0 16px;">${t}</p>`;
const img = (file, alt) =>
  `<img src="${SITE}/assets/email/${file}" width="528" alt="${alt}" style="display:block;width:100%;max-width:528px;height:auto;border:0;border-radius:10px;margin:22px 0;">`;
const sign = () => `<p style="margin:26px 0 0;">Tom<br><span style="color:${MUTED};">Junction</span></p>`;
const btn = (href, label) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 4px;"><tr><td style="background:${BLUE};border-radius:10px;">
   <a href="${href}" style="display:inline-block;padding:14px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;">${label}</a>
   </td></tr></table>`;

export const EMAILS = [
  {
    step: 1,
    subject: 'Your checklist',
    preview: "Four checks, fifteen minutes, and you don't need us for any of them.",
    body: () => `
${h2('Your fifteen-minute checklist')}
${p('Here it is. Four checks on your own site. Fifteen minutes, no tools.')}
${p("Do it on your phone, on data, not wifi. That's how most people will actually see your site, and it's harsher than your laptop.")}
${img('flow-01-checklist.png', 'The four checks: time it, read it like a stranger, check the numbers agree, click every button')}
${p('<b>1. Time it.</b> Open your site and count the seconds before you can read the first sentence. Past three seconds, that is your biggest problem, and nothing else on this list matters yet.')}
${p("<b>2. Read your homepage like a stranger.</b> What is the best true thing about your business? An award. A big stockist. Twenty years of doing it properly. Now check: is it on that page? Most of the time it is hiding on the About page, four clicks away.")}
${p('<b>3. Check your numbers agree.</b> Old prices. A counter saying one thing at the top and another at the bottom. A "since 2019" that should say 2016. One mismatch and a careful reader starts doubting the rest.')}
${p('<b>4. Click every button in your header and footer.</b> Especially the ones you added for a sale and never took down.')}
${p('That is the whole thing. Go and do it.')}
${p("I'll send you a few more of these over the next few weeks. Short ones, one idea each. If they are not useful, there is an unsubscribe link at the bottom and I won't be offended.")}
${sign()}`,
  },
  {
    step: 2,
    subject: "You don't have fifty problems",
    preview: 'You have one. The other forty-nine feel just as urgent, and fixing them changes nothing.',
    body: () => `
${h2("You don't have fifty problems")}
${p('Most owners I talk to have a list. The site needs redoing. The emails have stopped. Instagram has gone quiet. There are no ads running. The photos are old.')}
${p('It feels like fifty problems.')}
${p('It is almost never fifty. It is one.')}
${img('flow-02-pipe.png', 'A wide pipe with one narrow section, water backing up behind it')}
${p('Think of your business as a pipe with water running through it. Somewhere there is a narrow bit. Everything upstream of it piles up. Everything downstream is starved.')}
${p('Widen the narrow bit and the whole pipe flows. Polish any other section and nothing changes at all.')}
${p('That is why marketing can feel like shovelling. You work hard, you do sensible things, and the number at the end does not move. You were probably working on the wrong section.')}
${p('The hard part is not fixing it. The hard part is being sure which bit is narrow.')}
${p('That is next.')}
${sign()}`,
  },
  {
    step: 3,
    subject: 'How to find your narrow bit',
    preview: 'Do not look where it feels worst. Look where people leave.',
    body: () => `
${h2('How to find your narrow bit')}
${p('Last time: you have one narrow bit, not fifty problems. So how do you find it?')}
${p('Not by feel. The thing that bothers you most is usually the thing you are best at noticing, which is not the same as the thing costing you money.')}
${p('Do this instead. Write down the steps someone takes to buy from you, and put a number next to each one. For a shop that is roughly:')}
${p('<b>Visit the site &rarr; look at a product &rarr; add to cart &rarr; buy &rarr; buy again</b>')}
${img('flow-03-steps.png', 'Five steps descending, with one much bigger drop highlighted')}
${p('Now look at the gaps between the numbers. One will be much bigger than the others.')}
${p('That is your narrow bit. Not the step you hate. The step where people leave.')}
${p('Two things worth knowing.')}
${p('The biggest drop is usually not at the end. Everyone worries about checkout. Most businesses are losing people much earlier, at the moment a stranger decides whether to bother at all.')}
${p('And if you cannot get the numbers, that is your answer. Not being able to see where people leave is itself the narrow bit, and it is the first thing to fix.')}
${sign()}`,
  },
  {
    step: 4,
    subject: 'Why it stays broken',
    preview: 'You already know what to fix. Knowing was never the problem.',
    body: () => `
${h2('Why it stays broken')}
${p('Here is the awkward bit.')}
${p('Most owners I meet can tell me their narrow bit in about ninety seconds. They knew before I asked. Some have known for a year.')}
${p('It is still there.')}
${img('flow-04-orgchart.png', 'An org chart where every marketing box contains the same person')}
${p('So the real problem is usually not knowing. It is that the only person who can fix it is also doing quotes, and orders, and staff, and the thing that broke this morning.')}
${p('You are the founder. You are also the marketing department. And the marketing department only gets the hours left over, which some weeks is none.')}
${p('That is not a discipline problem. It is arithmetic. A job needing ten hours a week, given two, does not get done in five weeks. It just does not get done.')}
${p('I am not building up to telling you to try harder. Trying harder is what you have been doing.')}
${p('There are three honest options. Do it yourself and accept that it goes slowly. Hire someone, and carry the cost and the managing. Or have it run for you.')}
${p('Next time I will show you what the third one actually looks like, using our own business, because it is the only one I can show you the inside of.')}
${sign()}`,
  },
  {
    step: 5,
    subject: 'We shipped the wrong website',
    preview: 'What it looks like when someone else runs it, including the part that went wrong.',
    body: () => `
${h2('We shipped the wrong website')}
${p('I said I would show you the inside of one, so here is ours.')}
${p('We rebuilt our own website recently. The build we had been handed looked fine. It also loaded four files off someone else&rsquo;s server before it drew a single word, then assembled the page inside the visitor&rsquo;s browser. Which meant that when Google came to read it, there was nothing there to read.')}
${p('We threw all of it out. The site is now one plain page with nothing to fetch before it draws. It answers in about a sixth of a second.')}
${img('flow-05-beforeafter.png', 'Before: four files loading from another server. After: one plain page.')}
${p('Nothing about that is clever. That is the point. Ordinary work, done properly, done quickly.')}
${p('Now the part I would rather leave out.')}
${p('Two designs arrived in the same folder and I put the wrong one live. It had a long cinematic intro. Lightning, neurons, a river. It looked incredible. It also sat between a visitor and the first sentence about what we actually do.')}
${p('It was live briefly. Then it was gone, and it is not coming back.')}
${p('That is what having it run for you actually looks like. Not magic. Things move fast, someone with taste says "no, not that one", and it gets fixed the same day instead of sitting on a list for a year.')}
${p('Speed on its own is not worth much. Speed with someone watching is the whole thing.')}
${sign()}`,
  },
  {
    step: 6,
    subject: 'Want me to find yours?',
    preview: 'Free, takes me a few days, and there is nothing attached to it.',
    body: ({ website }) => `
${h2('Want me to find yours?')}
${p('Last one from me.')}
${p('Over the past few weeks: you have one narrow bit rather than fifty problems. You find it by looking at where people leave, not where it hurts. And the reason it is still there is that you are the founder and the marketing department at the same time.')}
${p('If you have gone and fixed it yourself, genuinely, good. That was the point.')}
${p('If you have not, here is the offer.')}
${p('I will do you a free <b>Bottleneck Snapshot</b>. I look at your site and your category, and I write down the one thing capping your growth, why it is the one thing, and what I would do about it. Plainly, in a page.')}
${p('It is free, it takes me a few days, and there is nothing attached to it. No call needed. Take it and do it yourself if you like &mdash; plenty of people do.')}
${btn(`mailto:${REPLY_TO}?subject=${encodeURIComponent('Snapshot')}&body=${encodeURIComponent(website ? `My website is ${website}` : 'My website is ')}`, 'Send me a Snapshot')}
${p(`<span style="color:${MUTED};font-size:15px;">Or just hit reply and say "snapshot".</span>`)}
${p('That is me done. If you would rather just read occasionally, stay on the list and I will send something worth reading every couple of weeks.')}
${p('Thanks for reading this far.')}
${sign()}`,
  },
];

export function render(step, { website, unsubUrl }) {
  const e = EMAILS.find((x) => x.step === step);
  if (!e) return null;
  return {
    subject: e.subject,
    // Preview text: hidden line the inbox shows next to the subject.
    html: shell({
      body: `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${e.preview}</div>${e.body({ website })}`,
      unsubUrl,
    }),
  };
}
