/* scripts/import-playbooks.ts — load content/playbooks/<domain>/<slug>.md into the `playbooks`
   table (migration 0010), embedding each card when OPENAI_API_KEY is set.

   Run (no tsx in node_modules — same tsc pattern as the beta seeder):
     npx tsc -p scripts/brain/tsconfig.json && node dist/brain/scripts/import-playbooks.js --dry-run
     npx tsc -p scripts/brain/tsconfig.json && node dist/brain/scripts/import-playbooks.js
   Flags: --dry-run (parse + report, no network, no writes) · --no-embed (upsert without vectors —
   recallPlaybooks falls back to keyword search) · --only <domain>.
   Env (process.env only; `set -a; source .env.local; set +a` first):
     NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY   the writes (service role; playbooks has no member write policy)
     OPENAI_API_KEY (+ optional OPENAI_BASE_URL)            embeddings — text-embedding-3-small, 1536 dims, the shape
                                                            match_playbooks expects. Absent = stored without embedding.
   Upsert key: (domain, title). Re-running is idempotent; a changed body re-embeds. Never prints a key. */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { EMBEDDING_MODEL, embedText, isPlaybookDomain, parsePlaybookMarkdown, playbookEmbeddingText, type PlaybookFile } from "../src/lib/brain/playbooks";
import type { DbClient } from "../src/lib/db/types";
import { unwrap } from "../src/lib/db/types";

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
const CONTENT_DIR = path.join(ROOT, "content", "playbooks");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".md")) out.push(p);
  }
  return out.sort();
}

export function loadPlaybookFiles(dir = CONTENT_DIR): { file: string; playbook: PlaybookFile }[] {
  return walk(dir).map((file) => ({ file: path.relative(ROOT, file), playbook: parsePlaybookMarkdown(readFileSync(file, "utf8"), path.relative(ROOT, file)) }));
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const noEmbed = process.argv.includes("--no-embed");
  const only = arg("--only");
  if (only && !isPlaybookDomain(only)) throw new Error(`--only ${only}: unknown domain`);

  let items = loadPlaybookFiles();
  if (only) items = items.filter((i) => i.playbook.domain === only);
  const dupes = new Map<string, string[]>();
  for (const i of items) {
    const k = `${i.playbook.domain}/${i.playbook.title}`;
    dupes.set(k, [...(dupes.get(k) ?? []), i.file]);
  }
  const clash = [...dupes.entries()].filter(([, files]) => files.length > 1);
  if (clash.length) throw new Error(`duplicate (domain,title): ${clash.map(([k, f]) => `${k} ← ${f.join(", ")}`).join("; ")}`);

  const byDomain = items.reduce<Record<string, number>>((a, i) => ((a[i.playbook.domain] = (a[i.playbook.domain] ?? 0) + 1), a), {});
  console.log(`${items.length} playbooks in ${path.relative(ROOT, CONTENT_DIR)} — ${Object.entries(byDomain).map(([d, n]) => `${d} ${n}`).join(" · ")}`);
  for (const i of items) console.log(`  ${i.playbook.domain.padEnd(9)} ${i.playbook.title}  [${i.playbook.tags.join(", ")}]  ${i.playbook.body.length} chars  ← ${i.file}`);

  const canEmbed = !noEmbed && !!(process.env.OPENAI_API_KEY ?? "").trim();
  console.log(canEmbed ? `embeddings: ${EMBEDDING_MODEL} (OPENAI_API_KEY present)` : `embeddings: skipped (${noEmbed ? "--no-embed" : "OPENAI_API_KEY missing"}) — keyword recall only until re-run with a key`);
  if (dryRun) {
    console.log("dry run — nothing written.");
    return;
  }

  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are required (or pass --dry-run)");
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(url, key, { auth: { persistSession: false } }) as unknown as DbClient;

  let embedded = 0;
  let written = 0;
  for (const { file, playbook } of items) {
    let embedding: number[] | null = null;
    if (canEmbed) {
      embedding = await embedText(playbookEmbeddingText(playbook));
      if (embedding) embedded++;
      else console.warn(`  ! embedding failed for ${file} — stored without a vector`);
    }
    const row: Record<string, unknown> = { domain: playbook.domain, title: playbook.title, body: playbook.body, source: playbook.source ?? file, tags: playbook.tags };
    if (embedding) row.embedding = JSON.stringify(embedding); // pgvector accepts the JSON array literal
    await unwrap(`playbooks.upsert ${file}`, db.from("playbooks").upsert(row, { onConflict: "domain,title" }));
    written++;
  }
  console.log(`done — ${written} upserted, ${embedded} embedded.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
