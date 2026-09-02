/* Privacy Policy — content only. Source: the 2026-09-01 draft in the Junction Drive
   (product/unc-growth-agent-design-2026-09-01/legal-and-oauth/PRIVACY-POLICY-DRAFT.md) with
   the founder's policy choices applied: 30-day deletion after disconnect / account deletion,
   90-day lapsed retention, no arbitration. Under legal review — see docs note in the report. */

import { COMPANY, LEGAL_EFFECTIVE, list, p, table, type LegalDoc } from "./types";

export const PRIVACY: LegalDoc = {
  slug: "privacy",
  title: "Privacy Policy",
  effective: LEGAL_EFFECTIVE,
  intro: [
    p(`Junction is operated by **${COMPANY.legalName}**, ${COMPANY.form} (company number ${COMPANY.companyNumber}, NZBN ${COMPANY.nzbn}), registered office ${COMPANY.registeredOffice} ("Junction", "we", "us").`),
    p(`Questions or requests: [${COMPANY.privacy}](mailto:${COMPANY.privacy}) (Privacy Officer) · [${COMPANY.support}](mailto:${COMPANY.support}) (support).`),
  ],
  sections: [
    {
      id: "what-junction-is",
      heading: "1. What Junction is",
      blocks: [
        p("Junction is a subscription software product that acts as an AI growth agent for your business. You connect the platforms your business already uses (for example Shopify, Google Analytics, Google Ads, Meta Ads, Klaviyo). Junction reads data from those platforms into a private data warehouse for your account, and an AI agent analyses it, drafts marketing work, and proposes actions. **Nothing is published, sent, or spent unless you click Approve inside Junction.** Every read and every approved action is recorded in a receipts ledger you can inspect at any time."),
        p("This policy explains what data we handle, why, where it goes, and your rights."),
      ],
    },
    {
      id: "data-we-collect",
      heading: "2. Data we collect",
      blocks: [
        p("**2.1 Account data (you give this to us directly)**"),
        list(
          "Email address (used for magic-link sign-in — we do not store passwords), and if you join our waitlist, the email address you leave us.",
          "Business name, website, and the goals, budget, and context you tell Junction (in onboarding or in chat).",
          "Billing details: handled by Stripe. We do not receive or store your full card number; we see only what Stripe shares with merchants (e.g. card brand, last 4 digits, billing country, payment status).",
          "Support and chat messages you send to the AI agent or to our human support staff.",
        ),
        p("**2.2 Connected-platform data (you authorise this via OAuth)**"),
        p("When you connect a platform, you grant Junction read access through that platform's official API. We sync the following kinds of data into your account's private warehouse:"),
        table(
          ["Platform", "Data synced (read)"],
          [
            ["Shopify", "Orders, products, customers (names, emails, order history), inventory, discounts, store performance metrics"],
            ["Google Analytics 4", "Website traffic, acquisition channels, conversion and e-commerce events, audience aggregates"],
            ["Google Ads", "Campaign structure, spend, performance metrics (impressions, clicks, conversions, cost)"],
            ["Meta Ads (Facebook / Instagram ads)", "Ad account structure, spend, performance metrics and insights"],
            ["Klaviyo", "Campaign and flow performance metrics, list/segment sizes, subscriber profiles and email engagement events"],
            ["Later integrations (when released): Instagram, TikTok, LinkedIn, YouTube, Google Search Console", "Organic content performance, follower/audience aggregates, search performance"],
          ],
        ),
        list(
          "Some of this data is **personal information about your customers** (for example Shopify customer records and Klaviyo profiles). For that data, you are the controller/agency responsible; Junction processes it on your instructions under our Data Processing Addendum (available from " + `[${COMPANY.legal}](mailto:${COMPANY.legal})` + ").",
          "**OAuth tokens and API credentials are stored in an encrypted secret store.** They are used only by our sync machinery. They are never displayed to our staff, never passed to the AI model, and never shown in the product.",
          "We request the **minimum read scopes** each platform allows for the data above. Where a platform offers write permissions (e.g. publishing ads), those are only requested if you enable an approval-gated feature that needs them, and every write requires your explicit in-app approval.",
        ),
        p("**Google user data.** Junction's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. We use Google user data only to provide and improve the user-facing features described in this policy; we do not sell it, do not use it for advertising, and do not allow humans to read it except with your permission, for security purposes, to comply with law, or as part of aggregated/anonymised internal operations."),
        p("**2.3 Usage data (collected automatically)**"),
        list(
          "Log data: IP address, approximate country (from the request), browser/device type, pages viewed, actions taken in the app, timestamps.",
          "The receipts ledger: a record of every data read and every proposed/approved/executed action in your account (this exists for your benefit — it is how you audit what Junction did).",
          "Cookies and similar technologies for sign-in sessions, your pricing region, and product analytics (see section 10).",
        ),
      ],
    },
    {
      id: "how-we-use-data",
      heading: "3. How we use data",
      blocks: [
        list(
          "**Provide the service** — sync your connected-platform data, analyse it, draft marketing work, propose actions, and execute only the actions you approve.",
          "**AI processing** — see section 4.",
          "**Approval and audit** — maintain the receipts ledger and enforce server-side spend caps derived from the budget you set.",
          "**Support** — our human support staff can see your goals, strategy, chat history, and receipts ledger so they can help you. **Staff can never see your OAuth credentials or tokens.**",
          "**Billing** — manage your trial, subscription, invoices, and payment status via Stripe.",
          "**Benchmarks (aggregated and anonymised only)** — we compute cross-account aggregate statistics (for example, median email open rates for stores of a similar size) to power benchmark features. These aggregates are constructed so that no individual account, business, or person is identifiable, and no end-customer personal information is included in them.",
          "**Waitlist** — if you leave your email on our waitlist, we use it to invite you when a place opens and to tell you about the product; you can ask to be removed at any time.",
          "**Security and integrity** — detect abuse, debug faults, protect the service.",
          "**Legal compliance** — meet obligations under applicable law.",
        ),
        p("We do **not** sell personal information. We do **not** use your data or your customers' data to train AI models (see section 4). We do **not** use connected-platform data for our own advertising."),
      ],
    },
    {
      id: "ai-processing",
      heading: "4. AI processing disclosure",
      blocks: [
        p("Junction's analysis and drafting is performed by a large language model (Anthropic's Claude), accessed via Anthropic's API. What this means in practice:"),
        list(
          "Relevant business data from your warehouse (metrics, orders, campaign performance, your goals and chat messages) is sent to Anthropic's API to generate analysis and drafts. **Your OAuth credentials and tokens are never sent to the model.**",
          "Anthropic acts as our subprocessor. Under our agreement with Anthropic, API inputs and outputs are **not used to train Anthropic's models**.",
          "AI outputs are proposals. Nothing the AI drafts is published, sent, or spent without your explicit in-app approval, and server-enforced spend caps apply regardless of what the AI proposes.",
          "AI outputs can be wrong. Review them before approving (see our [Terms of Service](/terms)).",
        ),
      ],
    },
    {
      id: "subprocessors",
      heading: "5. Subprocessors and service providers",
      blocks: [
        p("We use the following subprocessors to run Junction. Each is bound by contract to protect your data and use it only to provide services to us."),
        table(
          ["Subprocessor", "Purpose", "Location of processing"],
          [
            ["Supabase (on AWS infrastructure)", "Database and data warehouse, authentication", "AWS — Asia-Pacific and United States regions"],
            ["Anthropic", "AI/LLM processing (Claude API)", "United States"],
            ["Vercel", "Application hosting and delivery", "United States (global edge network)"],
            ["Stripe", "Payments and billing", "United States (global)"],
            ["Airbyte", "Data synchronisation from connected platforms", "United States"],
            ["Resend", "Transactional email (sign-in links, notifications)", "United States"],
          ],
        ),
        p("We will update this list when subprocessors change; customers with a signed Data Processing Addendum receive advance notice per the DPA."),
      ],
    },
    {
      id: "retention-and-deletion",
      heading: "6. Data retention and deletion",
      blocks: [
        list(
          "**While your account is active:** connected-platform data is retained in your warehouse so the AI can analyse trends over time.",
          "**Disconnecting a platform:** when you disconnect a platform in Junction, we stop syncing immediately, revoke and delete the stored tokens, and **delete that platform's synced data from your warehouse within 30 days**. (Aggregated, anonymised benchmark statistics that no longer identify you are not reversible and are retained.)",
          `**Deleting your account:** you can delete your account from settings or by emailing [${COMPANY.support}](mailto:${COMPANY.support}). We delete your account data and all synced platform data **within 30 days**, except records we must keep for legal reasons (e.g. invoices and tax records, kept for 7 years under NZ law) and the minimum log data needed for security and fraud purposes.`,
          "**Lapsed subscriptions:** if your subscription lapses, we retain your account for **90 days** so you can return, then delete as above.",
          "**Backups:** deleted data may persist in encrypted backups for up to 35 days before being overwritten.",
          "**Waitlist:** waitlist emails are kept until you are invited or ask to be removed.",
        ),
      ],
    },
    {
      id: "security",
      heading: "7. Security",
      blocks: [
        list(
          "All data encrypted in transit (TLS) and at rest.",
          "OAuth tokens and API credentials stored in an encrypted secret store, isolated from the application database; not accessible to staff or to the AI model.",
          "Per-tenant isolation: every customer's warehouse data is separated by row-level security; your data is never visible to another customer.",
          "Server-enforced spend caps and an approval gate on all outbound actions — the AI cannot publish, send, or spend on its own.",
          "Complete audit trail (receipts ledger) of reads and actions.",
          "Access controls and least-privilege access for staff; staff never handle credentials.",
        ),
        p("No system is perfectly secure; if a breach affecting your data occurs, we will notify you and regulators as required by law."),
      ],
    },
    {
      id: "international-transfers",
      heading: "8. International transfers",
      blocks: [
        p("We are a New Zealand company. Your data is processed in the regions listed in section 5, which include the United States. Where we transfer personal information overseas:"),
        list(
          "**NZ Privacy Act 2020 (IPP 12):** we only disclose personal information overseas where the recipient is subject to comparable safeguards, contractual protections, or another lawful basis.",
          "**Australia (APP 8):** we take reasonable steps to ensure overseas recipients handle personal information consistently with the Australian Privacy Principles.",
          "**EU/UK (when applicable):** transfers are protected by the European Commission's Standard Contractual Clauses (or UK equivalent) with our subprocessors, as set out in the DPA. New Zealand holds an EU adequacy decision, so transfers from the EU to us in New Zealand are permitted on that basis.",
        ),
      ],
    },
    {
      id: "your-rights",
      heading: "9. Your rights",
      blocks: [
        p(`**Everyone:** you can access, correct, or delete your personal information, and disconnect any platform, at any time — most of this is self-serve in the app. For anything else, contact [${COMPANY.privacy}](mailto:${COMPANY.privacy}).`),
        list(
          "**New Zealand (Privacy Act 2020):** you have rights to access and correct personal information we hold about you. Complaints can be made to us first, and to the Office of the Privacy Commissioner (privacy.org.nz).",
          "**Australia (Privacy Act 1988 / APPs):** you may access and correct your personal information and complain to us or to the OAIC (oaic.gov.au).",
          "**EU/UK (GDPR / UK GDPR), where it applies:** you have rights of access, rectification, erasure, restriction, portability, and objection, and the right to lodge a complaint with your supervisory authority. Our lawful bases are: performance of contract (providing the service), legitimate interests (security, product improvement, aggregated benchmarks), and consent (where sought).",
          "**California (CCPA/CPRA), where it applies:** you have rights to know, delete, and correct, and to opt out of \"sale\"/\"sharing\" — we do not sell or share personal information as defined by the CCPA. We do not discriminate for exercising rights.",
        ),
        p("**Your customers' data:** if you are an end customer of a business that uses Junction (for example, you bought something from a store that connects Shopify to Junction), the business is responsible for your data; contact them first. We will assist them in fulfilling your rights requests as their processor."),
      ],
    },
    {
      id: "cookies",
      heading: "10. Cookies",
      blocks: [
        p("We use strictly necessary cookies for sign-in sessions and one small cookie that remembers your pricing region. Our marketing site uses first-party product analytics (Google Analytics 4) to understand how pages are used. We do not use third-party advertising cookies in the product."),
      ],
    },
    {
      id: "children",
      heading: "11. Children",
      blocks: [p("Junction is a business tool and is not directed at anyone under 18. We do not knowingly collect personal information from children.")],
    },
    {
      id: "changes",
      heading: "12. Changes to this policy",
      blocks: [p("We will post changes here and update the effective date. For material changes we will notify you by email or in-app notice before they take effect.")],
    },
    {
      id: "contact",
      heading: "13. Contact",
      blocks: [
        p(`**${COMPANY.legalName}** (company number ${COMPANY.companyNumber} · NZBN ${COMPANY.nzbn})`),
        p(COMPANY.registeredOffice),
        p(`Privacy Officer: [${COMPANY.privacy}](mailto:${COMPANY.privacy}) · Support: [${COMPANY.support}](mailto:${COMPANY.support}) · Legal: [${COMPANY.legal}](mailto:${COMPANY.legal})`),
      ],
    },
  ],
};
