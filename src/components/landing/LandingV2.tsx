"use client";

import Link from "next/link";
import { useState } from "react";
import SiteFooter from "@/components/site/SiteFooter";
import WaitlistForm, { goToWaitlist } from "./WaitlistForm";
import styles from "./landing-v2.module.css";

/** Supplied v2 design, implemented in the existing app. Public explorer choices
 * are interest signals, never account routine settings or execution evidence. */
export const LANDING_AGENTS = [
  { id: "sales", name: "Sales", does: "Prepare for the buyers worth talking to.", tasks: ["Research right-fit leads", "Draft the first message", "Prepare a follow-up"] },
  { id: "content", name: "Content", does: "Stay visible without starting from a blank page.", tasks: ["Draft posts in your voice", "Find hooks in your niche", "Repurpose your content"] },
  { id: "paid", name: "Paid ads", does: "See where your ad money could work harder.", tasks: ["Review spend and performance", "Plan the next ad test", "Spot creative fatigue"] },
  { id: "seo", name: "SEO", does: "Find the searches and content worth working on.", tasks: ["Find keyword opportunities", "Identify content gaps", "Watch search positions"] },
  { id: "email", name: "Email & SMS", does: "Prepare useful next steps for existing customers.", tasks: ["Draft abandoned-cart emails", "Plan post-purchase education", "Prepare a winback campaign"] },
] as const;

const questions = [
  ["Why use this if I already use AI?", "Junction is being built to take on the setup and coordination of recurring sales and marketing work: the inputs, business context, process, schedule and review. Keep using your usual AI tools too."],
  ["Who is it for?", "Businesses with an offer, a website and sales or marketing work to do regularly. We’ll confirm the useful workflows and required connections during setup."],
  ["Does it publish, send messages or change my ads?", "The initial beta prepares research, analysis, plans and drafts for review. Publishing, customer messages and ad changes remain disabled. Joining the waitlist does not enable them."],
  ["What can I connect?", "Connections depend on your chosen work and the access you authorise. We’ll confirm the supported platforms, correct business accounts and required data during setup—not ask you to connect everything."],
  ["What does it cost?", "Pricing, inclusions and limits will be explained before you join a paid plan. Joining the waitlist does not start a subscription."],
] as const;

function JunctionMark() {
  return <span className={styles.mark} aria-hidden="true"><svg width="16" height="16" viewBox="0 0 14 14"><path d="M2 3L7 7L2 11" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M8 7H12" stroke="var(--amber)" strokeWidth="2" strokeLinecap="round" /></svg></span>;
}

export default function LandingV2() {
  const [opened, setOpened] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const interested = LANDING_AGENTS.filter(a => a.tasks.some((_, i) => selected.includes(`${a.id}-${i}`))).map(a => a.id);
  // Existing source field records category interest without a new database/API contract.
  const signupSource = ["landing_v2", ...interested].join("-");
  const join = () => goToWaitlist("waitlist-v2");

  return <div className={styles.page}>
    <a className={styles.skip} href="#main-content">Skip to content</a>
    <nav className={`${styles.container} ${styles.nav}`} aria-label="Main navigation">
      <Link href="/" className={styles.wordmark}><JunctionMark />Junction AI</Link>
      <div className={styles.navLinks}><a href="#how-it-works">How it works</a><Link href="/login">Sign in</Link></div>
      <button className={styles.primary} onClick={join}>Join the waitlist</button>
    </nav>
    <main id="main-content">
      <header className={`${styles.container} ${styles.hero}`}>
        <p className={styles.eyebrow}>Your business. More useful work.</p>
        <h1>Grow your <strong>business</strong><br /><span>with sales and marketing agents</span></h1>
        <p className={styles.lead}>Turn your business context and connected data into research, recommendations and drafts—ready for your review.</p>
        <div className={styles.ctaRow}><button className={styles.blueButton} onClick={join}>Join the private beta <span aria-hidden="true">↗</span></button><span>No card. No subscription.</span></div>
        <p className={styles.note}>Private beta: available workflows and connections are confirmed during setup. The examples below show the product direction, not completed work for your account.</p>
      </header>

      <section className={styles.dark} aria-labelledby="work-title">
        <div className={styles.container}>
          <h2 id="work-title">Choose the work you want<br className={styles.desktopBreak} /> off your plate.</h2>
          <p className={styles.sectionIntro}>Five areas of work. Open one and explore what’s useful.</p>
          <div className={styles.explorer}>
            <div className={styles.explorerHeader}><JunctionMark /><b>Your agents</b><span>Explore workflows · not live controls</span></div>
            <div className={styles.agentList}>
              {LANDING_AGENTS.map(agent => <div key={agent.id} className={styles.agent} data-open={opened === agent.id}>
                <button className={styles.agentHeader} aria-expanded={opened === agent.id} aria-controls={`landing-agent-${agent.id}`} onClick={() => setOpened(opened === agent.id ? null : agent.id)}>
                  <strong>{agent.name}</strong><span>{agent.does}</span><span aria-hidden="true">{opened === agent.id ? "−" : "+"}</span>
                </button>
                {opened === agent.id && <div id={`landing-agent-${agent.id}`} className={styles.agentBody}>
                  <div className={styles.taskGrid}>{agent.tasks.map((task, index) => {
                    const key = `${agent.id}-${index}`;
                    const on = selected.includes(key);
                    return <label className={styles.task} key={key}><input type="checkbox" checked={on} onChange={() => setSelected(prev => on ? prev.filter(k => k !== key) : [...prev, key])} /><span className={styles.toggle} aria-hidden="true" /><span>{task}</span></label>;
                  })}</div>
                  {agent.tasks.some((_, i) => selected.includes(`${agent.id}-${i}`)) && <div className={styles.interestPrompt}><p>Interested in <b>{agent.name.toLowerCase()}</b>? We’ll save that category with your signup and confirm what’s ready during setup.</p><button className={styles.blueButton} onClick={join}>Join the waitlist</button></div>}
                </div>}
              </div>)}
            </div>
          </div>
          <p className={styles.darkNote}>Explorer choices don’t connect accounts, run routines or change ads. Publishing and customer messaging remain disabled in the beta.</p>
          <details className={styles.process}><summary>See the process <span aria-hidden="true">↗</span></summary><p>Each workflow defines the information it needs, the steps to follow and the result to produce. Your offer, audience and relevant data shape the work. Missing inputs are requested; outputs come back for review.</p></details>
        </div>
      </section>

      <section className={`${styles.container} ${styles.exploration}`} aria-label="Your workflow interests">
        <div className={styles.interestPanel}>
          <div><h3>Start with what matters to you.</h3><p>Your selections help us understand what you’re looking for. They don’t activate anything.</p></div>
          <div className={styles.interestBars}>{LANDING_AGENTS.map(a => {
            const count = a.tasks.filter((_, i) => selected.includes(`${a.id}-${i}`)).length;
            return <div key={a.id}><span>{a.name}</span><div className={styles.bar} aria-hidden="true"><span style={{ transform: `scaleX(${count / a.tasks.length})` }} /></div><small>{count}/{a.tasks.length} interests</small></div>;
          })}</div>
        </div>
      </section>

      <section className={`${styles.container} ${styles.split}`}>
        <h2>The work gets done.<br /><span className={styles.blueText}>You bring the judgment.</span></h2>
        <div><div className={styles.responsibilityBar} aria-hidden="true"><span /><span /></div><div className={styles.responsibilities}>
          <div><h3>The agent’s work</h3><div className={styles.chips}>{["Research", "Drafting", "Checking the details", "Preparing recommendations"].map(t => <span key={t}>{t}</span>)}</div></div>
          <div><h3>Your part</h3><div className={`${styles.chips} ${styles.warmChips}`}>{["Taste", "Creativity", "Decisions"].map(t => <span key={t}>{t}</span>)}</div></div>
        </div></div>
      </section>

      <section className={`${styles.dark} ${styles.knowledge}`}><div className={`${styles.container} ${styles.split}`}>
        <h2>Structured workflows.<br /><span>Built around your business.</span></h2>
        <div><h3>Inputs before answers</h3><p>Your offer, your audience and your source data belong with the task. A missing input should lead to a clear question—not an invented number.</p><p className={styles.darkNote}>Available capabilities and update schedules are confirmed during setup.</p></div>
      </div></section>

      <section className={`${styles.container} ${styles.channels}`}>
        <div><h2>In the app.<br />Alongside your team.</h2><p className={styles.sectionIntro}>Review the work in your client workspace. Messaging channels are part of the plan, with identity and access checked before they’re enabled.</p>
          <div className={styles.chips}>{["Web app", "Slack", "iMessage", "WhatsApp", "Telegram", "Email"].map(t => <span key={t}>{t}</span>)}</div><p className={styles.note}>Channel availability is confirmed during setup. These conversations are illustrative, not live delivery receipts.</p>
        </div>
        <div className={styles.conversationStack} aria-label="Illustrative conversations">
          <div className={styles.phone}><div className={styles.phoneTime}>9:41 <span>Illustration</span></div><div className={styles.phoneTitle}><JunctionMark /><b>Junction</b></div><div className={styles.bubbles}>
            <p>morning 👋 here’s what a useful update could look like.</p><p>your post drafts, the sources behind them, and a clear next step.</p><p className={styles.mine}>show me the drafts</p><p>ready for your review in the app. nothing published.</p>
          </div><div className={styles.messageField}>Message Junction <span aria-hidden="true">↑</span></div></div>
          <div className={styles.slackExample}><div className={styles.slackRail}>J<span>#</span></div><div className={styles.slackBody}><header><b># growth</b><small>Illustrative handoff</small></header><div className={styles.slackMessage}><JunctionMark /><div><b>Junction <small>APP</small></b><p>A review handoff could bring the draft, its source data and the decision to the same place.</p><blockquote>Draft · why it was prepared<br />Sources · what it’s based on<br />Status · waiting for review</blockquote><p className={styles.note}>No approval or send action is available in this illustration.</p></div></div></div></div>
        </div>
      </section>

      <section id="how-it-works" className={styles.dark}><div className={styles.container}>
        <p className={styles.eyebrow}>How Junction is designed to work</p><h2>Simple to use.<br />A lot working behind it.</h2><p className={styles.sectionIntro}>Your business data, specialist workflows and feedback—connected to keep useful work moving.</p>
        <ol className={styles.flow}>{[
          ["01 · Sources", "Your connected tools", "Store, ads, CRM and email. Only the authorised business accounts and data."],
          ["02 · Context", "Your business", "The offer, audience, constraints and dated data behind each task."],
          ["03 · Work", "A defined workflow", "The selected routine follows its steps and records what happened."],
          ["04 · Review", "A useful result", "Research, recommendations and drafts, with the evidence to review them."],
        ].map(([label, title, text]) => <li key={label}><small>{label}</small><h3>{title}</h3><p>{text}</p></li>)}</ol><p className={styles.feedback}>Your feedback and measured results inform the next run.</p>
      </div></section>

      <section className={`${styles.container} ${styles.signup}`} aria-labelledby="signup-title"><div className={styles.signupPanel}>
        <div><h2 id="signup-title">Put your next useful<br />workflow in motion.</h2><p>Join the Junction AI private-beta waitlist.</p></div><div className={styles.signupForm}>
          {interested.length > 0 && <p className={styles.note}>Interests: {LANDING_AGENTS.filter(a => interested.includes(a.id)).map(a => a.name).join(", ")}.</p>}
          <WaitlistForm id="waitlist-v2" source={signupSource} helper="Your first signup saves your email and interest categories. Joining does not connect a platform or start a subscription." />
          <p className={styles.privacyNote}>How we handle your details: <Link href="/privacy">Privacy</Link>.</p>
        </div>
      </div></section>

      <section id="questions" className={`${styles.container} ${styles.questions}`} aria-labelledby="questions-title"><p className={styles.eyebrow}>Questions</p><h2 id="questions-title">Before you join.</h2>{questions.map(([q, a]) => <details key={q}><summary>{q}<span aria-hidden="true">+</span></summary><p>{a}</p></details>)}</section>
    </main>
    <div className={styles.footer}><div className={`${styles.container} ${styles.footerNav}`}><Link href="/" className={styles.wordmark}><JunctionMark />Junction AI</Link><Link href="/login">Sign in</Link><a href="#questions">Questions</a></div><SiteFooter /></div>
  </div>;
}
