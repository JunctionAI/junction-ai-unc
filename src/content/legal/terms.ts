/* Terms of Service — content only. Source: the 2026-09-01 draft in the Junction Drive
   (product/unc-growth-agent-design-2026-09-01/legal-and-oauth/TERMS-OF-SERVICE-DRAFT.md) with
   the founder's policy choices applied: card required for the trial, refunds case by case,
   plain NZ courts (no arbitration). Under legal review — see docs note in the report. */

import { COMPANY, LEGAL_EFFECTIVE, list, p, type LegalDoc } from "./types";

export const TERMS: LegalDoc = {
  slug: "terms",
  title: "Terms of Service",
  effective: LEGAL_EFFECTIVE,
  intro: [
    p(`These Terms are between you and **${COMPANY.legalName}**, ${COMPANY.form} (company number ${COMPANY.companyNumber}, NZBN ${COMPANY.nzbn}), registered office ${COMPANY.registeredOffice} ("Junction", "we", "us"). By creating an account or using Junction you agree to these Terms and to our [Privacy Policy](/privacy). If you use Junction for a business (you almost certainly do), you confirm you have authority to bind that business, and "you" means the business.`),
  ],
  sections: [
    {
      id: "what-junction-does",
      heading: "1. What Junction does — and the approval model",
      blocks: [
        p("Junction is an AI growth agent for your business:"),
        list(
          "You connect business platforms (e.g. Shopify, Google Analytics, Google Ads, Meta Ads, Klaviyo) through their official authorisation flows.",
          "Junction reads data from those platforms into a private warehouse for your account.",
          "An AI agent analyses your data, drafts marketing work (emails, ads, content, strategy), and **proposes** actions.",
          "**Nothing is published, sent, or spent unless you click Approve in the app.** Server-enforced spend caps, set from the budget you state, apply to any approved spending.",
          "Every read and every action is recorded in a receipts ledger you can inspect.",
        ),
        p("**You retain responsibility for approved actions.** When you approve a proposal, you are the one instructing it to happen — as if you had done it yourself. Review before you approve. This includes responsibility for the content of anything published (accuracy, legality, advertising standards, spam/anti-spam compliance such as the NZ Unsolicited Electronic Messages Act and the Australian Spam Act, and the policies of each platform it is published to)."),
      ],
    },
    {
      id: "accounts",
      heading: "2. Accounts",
      blocks: [
        list(
          "Sign-in is by email magic link. You are responsible for the security of your email account and anything done through links sent to it.",
          "One account per business unless we agree otherwise. Keep your account information accurate.",
          "You must be at least 18 and using Junction for business purposes.",
        ),
      ],
    },
    {
      id: "connecting-platforms",
      heading: "3. Connecting platforms — your authority",
      blocks: [
        p("When you connect a platform account, you warrant that:"),
        list(
          "you own that account or are authorised by its owner to connect it and to let Junction read its data and (only when you approve specific actions) act through it;",
          "your use of Junction with that platform complies with the platform's own terms;",
          "data you make available to Junction (including your customers' personal information) was collected lawfully and you have the rights needed for us to process it as described in the Privacy Policy and DPA.",
        ),
        p("You can disconnect any platform at any time; we stop syncing and delete that platform's synced data as described in the Privacy Policy."),
      ],
    },
    {
      id: "subscription",
      heading: "4. Subscription, trial, cancellation, refunds",
      blocks: [
        list(
          "**Price:** the monthly price shown for your country at sign-up (US$100 per month in the United States; local-currency pricing where offered), plus any applicable taxes, billed via Stripe. Prices may change with at least 30 days' notice; changes apply from your next billing cycle.",
          "**Free trial:** 14 days from sign-up. **A card is required to start the trial; nothing is charged until the trial ends.** If you do not cancel before the trial ends, your paid subscription begins automatically.",
          "**Cancellation:** cancel any time in the app; cancellation takes effect at the end of the current billing period, and you keep access until then.",
          `**Refunds:** fees are non-refundable except where required by law. If something has gone wrong, email [${COMPANY.support}](mailto:${COMPANY.support}) and we will look at it case by case. Nothing in these Terms limits rights you may have under the NZ Consumer Guarantees Act or Australian Consumer Law where those apply — noting Junction is supplied for business use.`,
          "Non-payment may result in suspension after reasonable notice.",
        ),
      ],
    },
    {
      id: "acceptable-use",
      heading: "5. Acceptable use",
      blocks: [
        p("You must not:"),
        list(
          "use Junction to send spam or unlawful, deceptive, infringing, or harmful content;",
          "connect accounts you are not authorised to connect, or use another person's data without lawful basis;",
          "attempt to access other customers' data, probe or overload our systems, or bypass the approval gate, spend caps, or security controls;",
          "resell or white-label Junction without a written agreement with us;",
          "use Junction to build a competing dataset or to scrape/exfiltrate platform data in breach of the source platform's terms;",
          "reverse engineer the service except where law permits.",
        ),
        p("We may suspend or terminate accounts that breach this section, with notice where practicable."),
      ],
    },
    {
      id: "ai-disclaimer",
      heading: "6. AI disclaimer",
      blocks: [
        list(
          "AI outputs are generated by a machine learning model and **can be inaccurate, incomplete, or unsuitable**. They are proposals and drafts, not professional advice (not legal, financial, or tax advice).",
          "**We do not guarantee business results.** Marketing outcomes depend on your product, market, budget, and factors outside anyone's control. Metrics shown in Junction are sourced from your connected platforms and may lag or differ from the platforms' own dashboards.",
          "You are responsible for reviewing every AI proposal before approving it. Approved outputs are used at your own judgment.",
          "Similar or identical AI outputs may be generated for other customers; we do not warrant uniqueness of AI-generated content.",
        ),
      ],
    },
    {
      id: "intellectual-property",
      heading: "7. Intellectual property and data",
      blocks: [
        list(
          "**Your data is yours.** You own the data you connect and everything in your warehouse. You grant us a licence to host, process, and analyse it solely to provide the service, as described in the Privacy Policy and DPA.",
          "**Approved outputs are yours.** To the extent we hold any rights in AI-drafted work you approve, we assign or licence them to you. (Purely AI-generated material may have limited copyright protection in some jurisdictions.)",
          "**Junction is ours.** The software, models of operation, prompts, interfaces, and branding are our (or our licensors') property. No rights are granted except the right to use the service under these Terms.",
          "**Aggregated data:** we may create and use aggregated, anonymised statistics (e.g. benchmarks) that do not identify you, your business, or any person, including after you leave.",
          "**Feedback** you give us may be used without obligation.",
        ),
      ],
    },
    {
      id: "third-party-platforms",
      heading: "8. Third-party platforms",
      blocks: [
        p("Junction depends on third-party platforms (Shopify, Google, Meta, Klaviyo, and others) and infrastructure providers. We are not responsible for their availability, API changes, rate limits, data accuracy, or decisions (such as ad disapprovals or account suspensions on their side). If a platform revokes or restricts our access, related features may stop working; we will make reasonable efforts to restore or provide alternatives."),
      ],
    },
    {
      id: "confidentiality",
      heading: "9. Confidentiality and privacy",
      blocks: [
        p(`Each party will protect the other's confidential information. Our handling of personal information is governed by the [Privacy Policy](/privacy) and, for your end-customer data, the Data Processing Addendum (available from [${COMPANY.legal}](mailto:${COMPANY.legal})), which is incorporated into these Terms.`),
      ],
    },
    {
      id: "warranties",
      heading: "10. Warranties and disclaimers",
      blocks: [
        p("We warrant we will provide the service with reasonable care and skill. Otherwise, to the maximum extent permitted by law, the service is provided **\"as is\"** and we disclaim all implied warranties, including fitness for a particular purpose and non-infringement. We do not warrant uninterrupted or error-free operation."),
        p("**Business use:** you agree you are acquiring the service in trade for business purposes, and (to the extent permitted) the NZ Consumer Guarantees Act 1993 does not apply, and the parties contract out of sections 9, 12A and 13 of the Fair Trading Act 1986 where it is fair and reasonable to do so."),
      ],
    },
    {
      id: "liability",
      heading: "11. Limitation of liability",
      blocks: [
        p("To the maximum extent permitted by law:"),
        list(
          "Neither party is liable for indirect or consequential loss, loss of profits, revenue, goodwill, or data (except for your data-restoration rights under the DPA).",
          "Our total aggregate liability arising out of or in connection with the service in any 12-month period is capped at the fees you paid us in that period.",
          "Nothing limits liability that cannot lawfully be limited (e.g. fraud), or your payment obligations.",
          "**Approved actions:** you acknowledge that losses flowing from an action you approved (e.g. ad spend on an approved campaign that underperforms, or an approved email that generates complaints) are your responsibility, except to the extent caused by our breach of these Terms (e.g. we executed something materially different from what you approved, or breached a spend cap).",
        ),
      ],
    },
    {
      id: "indemnity",
      heading: "12. Indemnity",
      blocks: [p("You indemnify us against third-party claims arising from: (a) content or actions you approved; (b) your breach of section 3 (platform authority) or section 5 (acceptable use); (c) your violation of law — except to the extent we caused the claim.")],
    },
    {
      id: "termination",
      heading: "13. Termination",
      blocks: [
        list(
          "You may stop using Junction and cancel at any time (section 4).",
          "We may terminate or suspend for material breach (with notice and a chance to cure where practicable), for legal or security reasons, or by discontinuing the service with at least 30 days' notice (with a pro-rata refund of prepaid fees for the unused period in that case).",
          "On termination: your access ends, and data is deleted per the Privacy Policy and DPA. Sections that by nature survive (IP, liability, indemnity, confidentiality, governing law) survive.",
        ),
      ],
    },
    {
      id: "general",
      heading: "14. General",
      blocks: [
        list(
          "**Governing law:** New Zealand law. The courts of New Zealand have non-exclusive jurisdiction over any dispute. There is no arbitration requirement.",
          "**Changes to these Terms:** we may update them; material changes notified at least 30 days ahead by email or in-app. Continued use after the effective date is acceptance.",
          "**Assignment:** you need our consent to assign; we may assign to an affiliate or in a sale of the business.",
          "**Force majeure**, **severability**, **no waiver**, and **entire agreement** clauses apply in their usual form. These Terms plus the Privacy Policy and DPA are the whole agreement.",
          `**Notices:** to you at your account email; to us at [${COMPANY.legal}](mailto:${COMPANY.legal}).`,
        ),
        p(`**${COMPANY.legalName}** · company number ${COMPANY.companyNumber} · NZBN ${COMPANY.nzbn} · ${COMPANY.registeredOffice}`),
      ],
    },
  ],
};
