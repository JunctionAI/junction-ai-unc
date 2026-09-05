# Website and call booking — 6 September NZ

**PASS: the new public page and owner-only booking journey. Not full Unc launch acceptance.**

## Public release
- Existing project preserved: junction-site / prj_oSGxCZba4W2XCm5c8Jgr6SMVsTYu.
- New production: dpl_5z3WEyFztTCYz6kiDCwyEGgWso9T, https://junction-site-93sacmg2z-tom-junctionmedis-projects.vercel.app. Static/Other; build 203ms. Promoted after protected-candidate hash and authenticated browser checks.
- https://getjunction.ai/ returns 200 and exactly matches source SHA-256 c67274d988997db0863e9995e3222dbc6be2eb80fb506176e5a7190217957483. https://www.getjunction.ai/ resolves to the apex and matches.
- Nine booking links all point to https://calendly.com/tom-getjunction/discovery-meeting. Public hero CTA clicked through and correct Discovery Meeting/20-minute event read back.
- Desktop browser and 320/390/768px embedded browser viewports visually checked. Native details explorer opens. No script is needed to book or read the page.
- Privacy/blog remain 200; api/subscribe and api/resend-webhook remain 405 on GET. No subscriber POST, cron tick, customer message or data-changing endpoint test was performed.
- Four existing server functions, schedule configuration, mail DNS and all subdomains preserved byte-for-byte/configuration unchanged. Existing legacy /login and /app redirects are deliberately retained for earlier users; the new landing's Sign in links explicitly target the Unc app.
- Source is marketing-site/, a preserved copy of the exact prior production artifact with the new v2-derived homepage and two versioned stylesheets. Initial local/live prior homepage hashes matched, not a filename-only inference.

Rollback: from marketing-site run the installed Vercel CLI with `vercel rollback dpl_2Y7qbKBDNuWWLMxLadzfiyqASK5g`. Previous immutable URL: https://junction-site-d70qdpwes-tom-junctionmedis-projects.vercel.app. Do not move the domain into junction-unc or overwrite unrelated DNS.

## Booking acceptance and cleanup
A clearly labelled **owner-only** test for 7 September 2026, 12:00–12:20 Auckland time, was booked through the public Calendly form using Tom's known personal email. No guests/client recipients.
- Calendly: You are scheduled; correct host, timezone and duration.
- Organiser email independently found at tom@getjunction.ai, Gmail message 1a071c19b96772c6, received 2026-09-05T13:28:28Z.
- Calendar event trqddv9putlqe92s6guh5diij0 independently found at that exact time with Google Meet conferencing details and test description.
- Cancelled only that exact test through its Calendly cancellation link. UI: Cancellation Confirmed.
- Calendar readback: same event now titled Canceled, response declined, transparency transparent; it no longer blocks availability. A cancellation record remains recoverable in the calendar.
The email invitation delivery to Tom's personal inbox was not separately read; organiser delivery and calendar/Meet creation are independently proven.

## Limits
Post-release bounded Vercel error scan returned no logs. Team log-drain API returned zero drains; alert delivery is not verified. Static page success is not backend observability sign-off.

The public offer is a discovery call and private-beta onboarding with capability confirmation, not all-client automation readiness. Application production remains Batch 34; this site release does not deploy staged Batch 35 manual changes or activate n8n.
