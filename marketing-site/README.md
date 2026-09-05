# Junction public website

Deployed independently to the existing **junction-site** Vercel project. Do not deploy this directory to junction-unc.

Homepage is a static, booking-first adaptation of the supplied/implemented LandingV2. Styles preserve its cream/navy/blue direction; self-hosted Manrope fonts are reused from the existing site. Existing server functions, public pages, legacy redirects and cron configuration remain unchanged.

Deploy: `vercel deploy --prod --skip-domain --yes`; verify the candidate with `vercel curl / --deployment ID` and browser; then `vercel promote ID --yes`.
Project identity in local .vercel/project.json is ignored by Git. Receipt and rollback: ../docs/WEBSITE-CALENDLY-RELEASE-2026-09-06.md.

qa/viewports.html is a local-only responsive fixture excluded from deployments.

