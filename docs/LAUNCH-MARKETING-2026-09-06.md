# Junction website and launch pack — expanded goal

Tom explicitly added these requirements on 6 September NZ, after confirming the n8n purchase. The full B01–B24 and all-client goal continues. This is not a claim of launch readiness.

## Authorized deliverables

1. Publish the supplied new Junction landing/product page on `getjunction.ai` and its canonical `www` variant, with a rollback reference and working HTTPS/mobile navigation. Preserve mail DNS, unrelated subdomains, existing forms/webhooks and retained public pages deliberately.
2. Make Book a call lead to the correct live Calendly event. Verify timezone, availability, details/confirmation and owner notification/calendar delivery with a clearly labelled, owner-only test when available; remove only that exact test afterwards. A link opening is not a completed-booking receipt.
3. Deliver a rendered, editable **30-second Remotion launch video**. Prepare landscape master and a vertical adaptation if practical, thumbnail/cover, source and render instructions. Use the new design and verified product story. Do not show fabricated client metrics, provider outputs or successful phone automation as live footage.
4. Prepare a compact marketing pack: founder launch post, short X/thread variant, launch email draft, three short social captions, video hook/CTA alternatives and a posting checklist with verified links. Draft assets only; posting/email sends/paid ads remain separately gated.
5. Target handoff: **7 September 2026 NZ**, interpreting Tom's “by tomorrow.” Report any actual deadline risk or dependency rather than promising unverified completion.

## Evidence and current state

### Delivery update — 6 September NZ

**Website and booking PASS:** the new booking-first v2 adaptation is now live on getjunction.ai; www resolves correctly. A real owner-only test produced Calendly confirmation, organiser email and a Google Calendar event with Meet details, then was cancelled and read back as non-blocking. [Release/rollback evidence](WEBSITE-CALENDLY-RELEASE-2026-09-06.md).

**Assets rendered:** editable 30-second Remotion landscape/vertical videos, two cover graphics and original soundtrack are in `launch-video/`; the founder post, X post/thread, email draft, three captions and posting checklist are in `launch-materials/LAUNCH-PACK.md`. Full product acceptance remains open. Historical discovery notes below are retained; they no longer describe the website/video as unbuilt.

- `getjunction.ai` is on Vercel nameservers, attached to **junction-site**, project `prj_oSGxCZba4W2XCm5c8Jgr6SMVsTYu`, not junction-unc. `www.getjunction.ai` is on the same project. `app.getjunction.ai` belongs to attention; playbook/mma subdomains belong to separate projects. Do not reassign them casually.
- Existing production rollback: `dpl_2Y7qbKBDNuWWLMxLadzfiyqASK5g`, `https://junction-site-d70qdpwes-tom-junctionmedis-projects.vercel.app`, dated 25 August. It includes api/subscribe, api/unsubscribe, api/flow-tick and api/resend-webhook, plus Blog/Privacy links. Preserve or deliberately route these; do not replace the whole domain with an app missing them.
- Current public footer Book a call points to `https://calendly.com/tom-getjunction/discovery-meeting`. Some older source drafts use `tom-tspx/introductory-meeting`; do not choose the older link from filename recency. Public link resolved, but browser availability/actual booking acceptance is not yet done.
- New supplied landing currently lives in Unc `src/components/landing/LandingV2.tsx`; `/` is still a private-beta waitlist. Call booking, product-launch wording and custom-domain deployment remain work, not done.
- Current public website has broad autopilot/scheduling/freshness and historical commercial claims. They are not evidence for this app's runtime. New marketing must distinguish verified native/client services from the still-gated Unc product.
- Remotion router/create skills are loaded; no launch composition, MP4 or marketing copy pack has been created yet. Read their required layout/markup/scene references before implementation.

## Work order

Finish the now-unblocked n8n key/read/registration path and ship a useful real result. In parallel with Nguyen's response, wire the website/Calendly journey and create the launch pack against that actual product state. Retain one coherent acceptance record per deliverable; do not substitute another isolated safety release or draft script for the requested launch.
