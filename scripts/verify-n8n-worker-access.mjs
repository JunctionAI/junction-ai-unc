import {readFileSync} from "node:fs";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
const exec=promisify(execFile),app="unc-worker",machine="1857466fd76998";
const cli=process.env.FLY_BIN??"fly";
const flags=["APPLE_MESSAGES_ENABLED","LIVE_MODE_ENABLED","TNZ_SMS_ENABLED","UNC_COMMANDS_ENABLED","UNC_MESSAGING_ENABLED"];
const run=async args=>(await exec(cli,args,{timeout:45000,maxBuffer:1048576})).stdout;
try {
  const before=JSON.parse(await run(["status","-a",app,"--json"]));
  const m=before.Machines?.[0];
  if(before.Name!==app || before.Machines?.length!==1 || m?.id!==machine || m.state!=="started" || flags.some(n=>m.config.env[n]!=="false"))throw new Error();
  const source=readFileSync(new URL("./verify-n8n-execution-access.mjs",import.meta.url),"utf8");
  const code=Buffer.from(`(async()=>{${source}\n})().catch(()=>{console.error('Verification failed; details suppressed');process.exitCode=1;});`).toString("base64");
  const output=await run(["ssh","console","-a",app,"--machine",machine,"--quiet","-C",`node -e 'eval(Buffer.from("${code}","base64").toString())'`]);
  const report=JSON.parse(output.trim());
  if(report.status!=="PASS")throw new Error();
  const after=JSON.parse(await run(["status","-a",app,"--json"]));
  const last=after.Machines?.find(x=>x.id===machine);
  if(last?.state!=="started" || last.config.image!==m.config.image || flags.some(n=>last.config.env[n]!=="false"))throw new Error();
  console.log(JSON.stringify({...report,worker:{app,machine,image:last.config.image,release:last.config.metadata?.fly_release_version,externalActionFlagsOff:true}},null,2));
} catch {
  console.error(JSON.stringify({status:"FAIL",error:"Worker verification failed. Raw CLI and transport output suppressed; no changes or workflow runs requested by this verifier."}));
  process.exitCode=1;
}
