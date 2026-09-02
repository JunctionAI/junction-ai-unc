/* System prompt builder for Unc — the live chat behind the corner buddy and the
   onboarding plan-pushback thread. Server-side only (imported by the API route).
   Voice rules come from design-reference/README.md §Voice; the product guardrails
   are Junction's: Unc proposes, the founder approves, no invented numbers.

   Playbooks (src/lib/brain/playbooks.ts): for each founder message the route recalls ≤ 3 of
   Junction's method cards by the message text — domains inferred from the message and the
   plan's phases — and hands them in as a compact "JUNCTION PLAYBOOK NOTES" section (~900
   chars). The rule that travels with them: playbooks are Junction's methods, not facts about
   the founder's business — they inform the recommendation, never the numbers. Env-gated: no
   database → no notes; no embeddings → keyword recall. */

import { recallPlaybooks, renderPlaybooksForPrompt, type Playbook, type PlaybookDomain, type PlaybookRowLite, type RecallOptions } from "../brain/playbooks";
import { splitBrain } from "./context";

export type UncSurface = "corner" | "onboarding";

const VOICE_AND_GUARDRAILS = `You are Unc, the Junction operator — the marketing department that runs a founder's growth beside them. You are chatting inside the Junction product. Your register: "In your corner."

Voice rules (non-negotiable):
- First person, present tense. Numbers over adjectives.
- You propose and show your working; you never command. Example of your register: "I weighed 14 moves against your budget. Here's the one I'd make."
- Never call yourself a "fully autonomous AI employee". Never promise "10x overnight" or "set and forget". Never overclaim.
- Warm, direct, concrete. No hype, no filler, no exclamation marks.

Product guardrails (absolute):
- You propose; the founder approves. Nothing publishes, sends, or spends without their explicit okay. If they ask you to just do something consequential, stage it as a proposal awaiting their approval instead.
- Creative drafts obey the same truth rule. When you write hooks, headlines, ad or email copy, do not invent facts, statistics, history, awards, customer counts or quotes. Use only what the ACCOUNT CONTEXT, the founder's memories, or the scanned business profile support. If a strong hook needs a claim you can't source, write the placeholder [needs a real fact: what would make this true] instead of the claim, and say the founder can supply it.
- Connector state governs everything behind it. If a platform's connector in the ACCOUNT CONTEXT is "needs_reconnect", "expired", "disconnected", "off" or "error", then every routine that reads or writes that platform is blocked — no results from it are current, nothing there has run or changed since it broke. Say that first, name the platform, and point the founder to Connectors → Reconnect before discussing that work. Never describe a blocked platform's activity as live.
- No invented numbers. The ONLY numbers you may state are ones present in the ACCOUNT CONTEXT below or in the "What I know about this founder" section (numbers the founder stated to you count as context; you may do simple arithmetic on them and say so). If neither contains a number the founder asks for, say plainly that you don't have that number yet — never estimate or make one up.
- Playbooks are Junction's methods, not facts about the founder's business. When a JUNCTION PLAYBOOK NOTES section is present, draw on it to shape the recommendation — name the method in plain words — but never present a playbook line as something that happened in this account, and never take a number from it.
- Ground answers in the account context: their goal, pace, plan phases, pending approvals, routines and connectors. Point to the specific routine or approval when relevant.

Format (chat bubble):
- 2–4 short sentences. Plain text only — no markdown, no bullet points, no headings, no emojis.`;

const SURFACE_NOTES: Record<UncSurface, string> = {
  corner: `Setting: the in-app chat. You run this account day to day. Answer questions about the numbers, explain decisions and reasoning, and when the founder asks for work, say what you'd run and what would come back for their approval.`,
  onboarding: `Setting: the final onboarding step. You have just proposed a draft growth plan (in the ACCOUNT CONTEXT under "strategy") and the founder is pushing back or asking why before agreeing it. Take the pushback seriously: explain the trade-off with the numbers you have, and where their point is good, say what you'd change in the draft. The plan is agreed together — never dig in for its own sake.`,
};

export const MEMORY_RULE = `Memory rules:
- These memories are the founder's own truth — what they told you, decided, or agreed. Use them without being asked; do not ask again for something you already know.
- If the founder says something now that contradicts a memory, the founder wins: go with what they say now and note the change in one short clause (e.g. "noted — that's changed from the 15% floor").
- Constraints are hard limits on what you propose. Upcoming events shape timing.`;

export const PLAYBOOK_RULE = `Playbook rule: these are Junction's methods, not facts about the founder's business — they inform the recommendation, never the numbers. Use one when it fits the question; say which method you're drawing on in plain words; never quote a playbook as if it were the founder's data.`;

export const PLAYBOOK_NOTES_HEADER = "JUNCTION PLAYBOOK NOTES (use when relevant, never quote as the founder's data):";

export function renderMemorySection(memories: string[]): string {
  if (!memories.length) return "";
  return `WHAT I KNOW ABOUT THIS FOUNDER (from what they have told me and decided — their truth):\n${memories.map((m) => `- ${m}`).join("\n")}\n\n${MEMORY_RULE}`;
}

export function renderProfileSection(profile: string): string {
  const p = profile.trim();
  return p ? `HOW THEY LIKE TO WORK:\n${p}` : "";
}

/** The playbook block as it sits in the prompt (the notes already carry the header). */
export function renderPlaybookSection(notes: string | undefined): string {
  const n = (notes ?? "").trim();
  return n ? `${n}\n\n${PLAYBOOK_RULE}` : "";
}

/** `context` may carry `memories` (string lines), `profile` (text) and `playbooks` (the rendered
    notes) from attachBrain — they are rendered as their own sections, above the JSON account state. */
export function buildUncSystemPrompt(context: unknown, surface: UncSurface): string {
  const note = SURFACE_NOTES[surface] ?? SURFACE_NOTES.corner;
  const { context: base, brain } = splitBrain(context);
  const sections = [VOICE_AND_GUARDRAILS, note];
  if (brain) {
    const mem = renderMemorySection(brain.memories);
    const prof = renderProfileSection(brain.profile);
    const play = renderPlaybookSection(brain.playbooks);
    if (mem) sections.push(mem);
    if (prof) sections.push(prof);
    if (play) sections.push(play);
  }
  sections.push(`ACCOUNT CONTEXT (the founder's live account state — your only source of numbers besides the memories above):\n${JSON.stringify(base, null, 0)}`);
  return sections.join("\n\n");
}

// ---------- playbook recall for a chat turn ----------

export const PLAYBOOK_NOTES_MAX_CHARS = 900;
export const PLAYBOOK_NOTES_PER_CARD = 220; // three cards + header fit under the ~900-char cap
export const PLAYBOOK_NOTES_LIMIT = 3;

const DOMAIN_TERMS: Record<PlaybookDomain, RegExp> = {
  email: /\b(email|emails|klaviyo|flow|flows|welcome|winback|win-back|abandon(?:ed)?|cart|newsletter|subscriber|list|segment|sms|post-purchase|replenish)/i,
  paid: /\b(meta|facebook|instagram ads|tiktok ads|paid|ads?|ad spend|spend|creative|creatives|roas|cpa|cac|campaign|adset|budget|google ads|pmax|performance max|retarget|prospect)/i,
  seo: /\b(seo|google search|search console|ranking|rankings|keyword|keywords|organic search|ai search|chatgpt|perplexity|geo|aeo|llms?\.txt|citation|backlink|pr\b|newsroom|found on)/i,
  content: /\b(content|post|posts|reel|reels|video|videos|hook|hooks|script|caption|tiktok|instagram|linkedin|youtube|social|creator|ugc|copy)/i,
  sales: /\b(sales|lead|leads|pipeline|outbound|outreach|crm|hubspot|deal|deals|demo|call|calls|prospect|close|closing|follow-up|followup)/i,
  analytics: /\b(analys|analyt|numbers|report|weekly|week's|this week|review|measure|measurement|attribution|dashboard|data|kpi|metric|tracking)/i,
  strategy: /\b(strategy|plan|goal|priorit|focus|roadmap|phase|launch|drop|inventory|clearance|stock|scale|grow|growth|what should i|where should)/i,
};

/** Channel names as the plan's phases carry them → playbook domains. */
const CHANNEL_DOMAIN: Record<string, PlaybookDomain> = { content: "content", "paid ads": "paid", paid: "paid", seo: "seo", sales: "sales", "email & sms": "email", email: "email" };

/** Domains to search for a founder message: what the message is about, plus the plan's channels
    (phase 1 first) so a vague "what should I do next?" lands on the founder's actual play. */
export function inferPlaybookDomains(text: string, phaseChannels: string[] = []): PlaybookDomain[] {
  const out: PlaybookDomain[] = [];
  for (const [d, re] of Object.entries(DOMAIN_TERMS) as [PlaybookDomain, RegExp][]) if (re.test(text)) out.push(d);
  for (const ch of phaseChannels) {
    const key = ch.trim().toLowerCase();
    const d = CHANNEL_DOMAIN[key] ?? (Object.keys(CHANNEL_DOMAIN).find((k) => key.includes(k)) ? CHANNEL_DOMAIN[Object.keys(CHANNEL_DOMAIN).find((k) => key.includes(k))!] : null);
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}

/** The plan's phase channels from a chat context object (strategy.phases[].name, strategy.channelRanking[].channel). */
export function phaseChannelsFrom(context: unknown): string[] {
  const c = context && typeof context === "object" ? (context as { strategy?: { phases?: { name?: unknown }[]; channelRanking?: { channel?: unknown }[] } }) : null;
  const s = c?.strategy;
  const names = (s?.phases ?? []).map((p) => (typeof p?.name === "string" ? p.name : "")).filter(Boolean);
  const ranked = (s?.channelRanking ?? []).map((p) => (typeof p?.channel === "string" ? p.channel : "")).filter(Boolean);
  return [...names, ...ranked];
}

export interface PlaybookNotesOptions extends RecallOptions {
  limit?: number;
  maxChars?: number;
}

/** Recall ≤ 3 playbooks for a founder message and render the compact notes block ("" when none
    or when no database/rows are available). Never throws — a recall failure is no notes. */
export async function recallPlaybookNotes(message: string, context: unknown, opts: PlaybookNotesOptions = {}): Promise<string> {
  const q = message.trim();
  if (!q) return "";
  const domains = inferPlaybookDomains(q, phaseChannelsFrom(context));
  let cards: Playbook[] = [];
  try {
    cards = await recallPlaybooks(q, domains.length ? domains : null, opts.limit ?? PLAYBOOK_NOTES_LIMIT, opts);
    if (!cards.length && domains.length) cards = await recallPlaybooks(q, null, opts.limit ?? PLAYBOOK_NOTES_LIMIT, opts);
  } catch {
    return "";
  }
  return renderPlaybookNotes(cards, opts.maxChars);
}

/** Pure: the notes block for already-recalled cards (tests and the eval script use it directly). */
export function renderPlaybookNotes(cards: Playbook[], maxChars = PLAYBOOK_NOTES_MAX_CHARS): string {
  return renderPlaybooksForPrompt(cards.slice(0, PLAYBOOK_NOTES_LIMIT), { header: PLAYBOOK_NOTES_HEADER, maxChars, perPlaybookChars: PLAYBOOK_NOTES_PER_CARD });
}

export type { PlaybookRowLite };
