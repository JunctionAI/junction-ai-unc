/* scripts/eval-chat.ts — run the chat helpfulness evals against the live router + an LLM judge.

   Each scenario in src/lib/eval/chat-evals/scenarios.ts goes through the REAL chat system prompt
   (src/lib/unc/prompt.ts) and the "chat" task on the router (account model → env → default), then
   (1) the deterministic rubric — banned phrases, invented numbers, format — and (2) the
   "eval_judge" task scoring 0–2 on grounded · specific · in_voice · actionable · honest.

   Run (no tsx in node_modules):
     npx tsc -p scripts/brain/tsconfig.json && node dist/brain/scripts/eval-chat.js
   Flags: --only <id> · --no-judge (deterministic only) · --out <path> · --verbose (ledger lines)
   Needs a provider key in the environment (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY,
   OPENROUTER_API_KEY or LLM_CUSTOM_BASE_URL); with none it prints why and exits 0. Nothing is
   written to the database (db: null — usage lines go to stdout only with --verbose).
   Output: a table + design-reference/evals/chat-<YYYY-MM-DD>.json (all replies, scores, rationales). */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import { parsePlaybookMarkdown, type PlaybookRowLite } from "../src/lib/brain/playbooks";
import { isServiceRoleConfigured } from "../src/lib/db/server";
import { CRITERIA, evaluateReply, JUDGE_SYSTEM, judgeUserPrompt, parseJudgeScores, totalScore, type DeterministicResult, type JudgeScores } from "../src/lib/eval/chat-evals/rubric";
import { SCENARIOS, type Scenario } from "../src/lib/eval/chat-evals/scenarios";
import { complete, describeLlm, resolveModel } from "../src/lib/llm/router";

/* src/lib/unc/prompt.ts reaches src/lib/unc/context.ts, which imports with the "@/" alias. The
   standalone CommonJS build has no bundler to resolve it, so map "@/" onto the compiled src tree
   here and load the prompt builder AFTER the hook is in (dynamic import inside main). */
const SRC_DIR = path.resolve(__dirname, "..", "src");
type Resolver = { _resolveFilename: (request: string, ...rest: unknown[]) => string };
const resolver = Module as unknown as Resolver;
const originalResolve = resolver._resolveFilename;
resolver._resolveFilename = function (this: unknown, request: string, ...rest: unknown[]) {
  return originalResolve.call(this, request.startsWith("@/") ? path.join(SRC_DIR, request.slice(2)) : request, ...rest);
};

/** The repo root — walk up from wherever this file runs (src/ or dist/brain/) to package.json. */
function findRoot(from: string): string {
  let dir = from;
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, "package.json")) && existsSync(path.join(dir, "content"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(`could not find the repo root above ${from}`);
}

const ROOT = findRoot(__dirname);
const MAX_REPLY_TOKENS = 2000; // same cap + effort as /api/unc/chat

interface Row {
  id: string;
  title: string;
  question: string;
  model: string;
  reply: string;
  deterministic: DeterministicResult;
  judge: JudgeScores | null;
  judgeRaw?: string;
  total: number | null;
  /** The JUNCTION PLAYBOOK NOTES block the reply was given (absent when none applied). */
  playbooks?: string;
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

type PromptBuilder = (context: unknown, surface: Scenario["surface"]) => string;
type NotesRecall = (message: string, context: unknown, opts: { rows?: PlaybookRowLite[] | null }) => Promise<string>;

/** The playbook cards from content/playbooks/** as keyword-rankable rows — the eval's stand-in
    for the `playbooks` table when no database is configured (same recall, same block). */
function playbookRowsFromContent(root: string): PlaybookRowLite[] {
  const dir = path.join(root, "content", "playbooks");
  if (!existsSync(dir)) return [];
  const rows: PlaybookRowLite[] = [];
  for (const domain of readdirSync(dir)) {
    const sub = path.join(dir, domain);
    let files: string[] = [];
    try {
      files = readdirSync(sub).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        const p = parsePlaybookMarkdown(readFileSync(path.join(sub, f), "utf8"), path.join(sub, f));
        rows.push({ id: `${p.domain}/${f}`, domain: p.domain, title: p.title, body: p.body, tags: p.tags });
      } catch {
        // a malformed card is the import script's problem, not the eval's
      }
    }
  }
  return rows;
}

async function ask(s: Scenario, verbose: boolean, buildUncSystemPrompt: PromptBuilder, notesFor: (s: Scenario) => Promise<string>): Promise<{ reply: string; model: string; notes: string }> {
  // The same playbook notes the live route attaches (src/lib/unc/respond.ts): ≤ 3 cards for the question.
  const notes = await notesFor(s);
  const context = notes ? { ...s.context, playbooks: notes } : s.context;
  const r = await complete("chat", { system: buildUncSystemPrompt(context, s.surface), messages: [{ role: "user", content: s.question }], maxTokens: MAX_REPLY_TOKENS, effort: "low" }, { db: null, log: verbose ? undefined : () => undefined });
  if (!r) throw new Error("no provider configured");
  if (r.stopReason === "error") throw new Error(`chat ${r.errorCode}: ${r.errorMessage ?? ""}`);
  if (r.stopReason === "refusal") return { reply: "[refusal]", model: r.model, notes };
  return { reply: r.text.trim(), model: r.model, notes };
}

async function judge(s: Scenario, reply: string, verbose: boolean): Promise<{ scores: JudgeScores | null; raw: string }> {
  const r = await complete("eval_judge", { system: JUDGE_SYSTEM, messages: [{ role: "user", content: judgeUserPrompt(s, reply) }], maxTokens: 1200, jsonMode: true, effort: "low" }, { db: null, log: verbose ? undefined : () => undefined });
  if (!r || r.stopReason === "error" || r.stopReason === "refusal") return { scores: null, raw: r?.errorMessage ?? r?.stopReason ?? "no provider" };
  return { scores: parseJudgeScores(r.text), raw: r.text };
}

async function main() {
  const only = arg("--only");
  const noJudge = process.argv.includes("--no-judge");
  const verbose = process.argv.includes("--verbose");
  const chat = resolveModel("chat");
  if (!chat) {
    console.log("eval-chat: no LLM provider configured (set ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY or LLM_CUSTOM_BASE_URL). Nothing run — the offline half lives in `npm test`.");
    return;
  }
  const judgeModel = noJudge ? null : resolveModel("eval_judge");
  console.log(`eval-chat: ${describeLlm()} · chat → ${chat.id}${chat.source === "fallback" ? ` (standing in for ${chat.fallbackFrom})` : ""} · judge → ${judgeModel ? judgeModel.id : "off"}`);

  const scenarios = only ? SCENARIOS.filter((s) => s.id === only) : SCENARIOS;
  if (!scenarios.length) throw new Error(`no scenario "${only}"`);
  const { buildUncSystemPrompt, recallPlaybookNotes } = (await import("../src/lib/unc/prompt")) as { buildUncSystemPrompt: PromptBuilder; recallPlaybookNotes: NotesRecall };
  // Playbook notes: the table when a database is configured, else the content/ cards in keyword mode.
  const contentRows = isServiceRoleConfigured() ? null : playbookRowsFromContent(ROOT);
  console.log(`eval-chat: playbooks → ${contentRows ? `${contentRows.length} cards from content/ (keyword mode, no database)` : "playbooks table"}`);
  const notesFor = (s: Scenario) => recallPlaybookNotes(s.question, s.context, contentRows ? { rows: contentRows } : {});
  const rows: Row[] = [];
  for (const s of scenarios) {
    process.stdout.write(`  ${s.id.padEnd(20)} `);
    const { reply, model, notes } = await ask(s, verbose, buildUncSystemPrompt, notesFor);
    const deterministic = evaluateReply(s, reply);
    let scores: JudgeScores | null = null;
    let raw: string | undefined;
    if (judgeModel) ({ scores, raw } = await judge(s, reply, verbose));
    const total = scores ? totalScore(scores) : null;
    rows.push({ id: s.id, title: s.title, question: s.question, model, reply, deterministic, judge: scores, judgeRaw: raw, total, playbooks: notes || undefined });
    console.log(`${deterministic.pass ? "det ok " : "det FAIL"} ${total === null ? "" : `judge ${total}/10`}`);
  }

  // table
  const head = ["scenario", "det", ...CRITERIA.map((c) => c.slice(0, 6)), "total"];
  console.log(`\n${head.map((h, i) => h.padEnd(i === 0 ? 20 : 7)).join("")}`);
  for (const r of rows) {
    const det = r.deterministic.pass ? "ok" : [r.deterministic.bannedPhrases.length && "ban", r.deterministic.unsupportedNumbers.length && "num", r.deterministic.formatIssues.length && "fmt"].filter(Boolean).join("+");
    console.log([r.id.padEnd(20), det.padEnd(7), ...CRITERIA.map((c) => String(r.judge ? r.judge[c] : "-").padEnd(7)), r.total === null ? "-" : `${r.total}/10`].join(""));
  }
  const judged = rows.filter((r) => r.total !== null);
  const detPass = rows.filter((r) => r.deterministic.pass).length;
  const mean = judged.length ? judged.reduce((n, r) => n + (r.total ?? 0), 0) / judged.length : null;
  console.log(`\ndeterministic: ${detPass}/${rows.length} pass · judge mean: ${mean === null ? "n/a" : `${mean.toFixed(1)}/10 over ${judged.length}`}`);
  for (const r of rows.filter((x) => !x.deterministic.pass)) console.log(`  ${r.id}: ${JSON.stringify({ banned: r.deterministic.bannedPhrases, numbers: r.deterministic.unsupportedNumbers, format: r.deterministic.formatIssues })}`);

  const date = new Date().toISOString().slice(0, 10);
  const out = arg("--out") ?? path.join(ROOT, "design-reference", "evals", `chat-${date}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), chatModel: chat.id, judgeModel: judgeModel?.id ?? null, summary: { scenarios: rows.length, deterministicPass: detPass, judgeMean: mean }, rows }, null, 2));
  console.log(`wrote ${path.relative(ROOT, out)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
