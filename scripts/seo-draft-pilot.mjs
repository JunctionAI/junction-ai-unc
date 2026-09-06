/** Explicit operator-only draft test. Reads AVGAR's verified keyword result and public
 * site, calls the budgeted model once, and writes LOCAL review artifacts. No live DB writes,
 * Slack messages, publishing, switch changes, or automatic retries. */
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');
const { produceSeoDraft } = require('../dist/worker/lib/runtime/seoDraft.js');
const { readSeoSiteSources } = require('../dist/worker/lib/runtime/seoSources.js');
const { rowToArtifact } = require('../dist/worker/lib/runtime/store/supabase.js');
const { createTextClient } = require('../dist/worker/lib/llm/router.js');
const accountId = 'aa5cfc84-2569-4c99-9b40-67003ae55eda';
const artifactId = 'ea33a35b-5c1f-4b70-8678-18e56ac86621';
if (!['--run-once','--replay'].includes(process.argv[2])) throw Error('Explicit --run-once or --replay required');
const replay = process.argv[2] === '--replay' ? JSON.parse(await readFile(process.argv[3],'utf8')) : null;
if (replay && (replay.scope?.accountId !== accountId || replay.sourceKeywordArtifactId !== artifactId || typeof replay.modelReply !== 'string')) throw Error('Replay evidence mismatch');
if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) throw Error('Server environment unavailable');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const read = async q => { const { data, error } = await q; if (error) throw Error('Saved evidence read failed'); return data; };
const account = await read(db.from('accounts').select('id,context_generation,automation_paused').eq('id',accountId).single());
if (account.context_generation !== 1 || account.automation_paused) throw Error('Account context changed or paused');
const artifact = await read(db.from('artifacts').select('*').eq('account_id',accountId).eq('id',artifactId).single());
const run = await read(db.from('routine_runs').select('id,status,mode,context_generation,routine_id').eq('account_id',accountId).eq('id',artifact.run_id).single());
const permit = await read(db.from('n8n_shadow_permits').select('status').eq('account_id',accountId).eq('run_id',run.id).single());
if (run.status !== 'done' || run.mode !== 'dry_run' || run.context_generation !== 1 || run.routine_id !== 'D03-W01' || permit.status !== 'verified') throw Error('Keyword run is not independently verified');
// Check the stored contract's market, not the human-readable artifact title.
const receipt = artifact.meta?.executionReceipt;
if (receipt?.client?.locationCode !== 2840 || receipt.client.primaryDomain !== 'avgarsport.com' ||
    receipt.client.seedKeyword !== 'golf travel bag' || receipt.accountId !== accountId || receipt.runId !== run.id ||
    receipt.revisionEvidence !== 'verified_execution_record') {
  throw Error('Keyword artifact market metadata requires explicit mapping review');
}
const now = new Date().toISOString();
const scope = { accountId, contextGeneration: 1, market: 'US', cycleId: `operator-${now}` };
const sources = replay ? replay.sources : await readSeoSiteSources(scope,'https://avgarsport.com/',now);
const client = createTextClient('routine_produce',{ maxTokens: 6500, effort: 'low', jsonMode: true }, { accountId, db });
if (!client) throw Error('No configured draft model');
let modelReply;
const result = await produceSeoDraft({ ...scope,now,...sources,keywords:[{artifact:rowToArtifact(artifact),market:'US',contextGeneration:1}],prepareArticles:true,preparePageEdits:true },
  async ({system,prompt})=>{ modelReply=replay ? replay.modelReply : await client.complete({system,user:prompt,accountId}); return modelReply; });
const output = resolve('artifacts/seo-pilot', now.replace(/[:.]/g,'-'));
await mkdir(output,{recursive:true});
await writeFile(resolve(output,'result.json'),JSON.stringify({scope,sourceKeywordArtifactId:artifactId,sources,result,modelReply},null,2),{mode:0o600});
if ('needs' in result) { console.log(JSON.stringify({status:'BLOCKED',needs:result.needs,output})); process.exitCode=1; }
else {
  const draft=result.artifact;
  await writeFile(resolve(output,'REVIEW.md'),`# ${draft.title}\n\n${draft.body}\n\n${draft.items.map(i=>`## ${i.title}\n\n${i.body}\n\n${JSON.stringify(i.meta,null,2)}`).join('\n\n')}\n\n## Sources\n${sources.pages.map(p=>`- [${p.title.replace(/\n/g,' ')}](${p.url})`).join('\n')}\n`,{mode:0o600});
  console.log(JSON.stringify({status:'DRAFT_ONLY',items:draft.items.length,output,storedInLiveApp:false,published:false}));
}
