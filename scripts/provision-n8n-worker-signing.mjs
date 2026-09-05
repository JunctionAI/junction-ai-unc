/** Scoped operator tool, not a workflow runner. Run through:
 * npx vercel env run -e production -- node scripts/provision-n8n-worker-signing.mjs [--apply]
 * Default is read-only. --apply fills missing worker configuration, never rotates keys,
 * starts a routine, changes flags or rebuilds the current worker image.
 * Secrets/tokens/remote challenge responses are never printed or written to disk.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";

const ORIGIN = "https://junction-unc.vercel.app";
const RECEIVER = "https://junctionai8.app.n8n.cloud/webhook/unc/d03-w01/keyword-shadow";
const APP = "unc-worker";
const MACHINE = "1857466fd76998";
const FLAGS = ["UNC_COMMANDS_ENABLED", "UNC_MESSAGING_ENABLED", "LIVE_MODE_ENABLED", "TNZ_SMS_ENABLED", "APPLE_MESSAGES_ENABLED"];
const mode = process.argv.slice(2);
if (mode.length > 1 || mode.some(arg => arg !== "--apply")) throw new Error("Only --apply is supported; default is read-only.");
const apply = mode.includes("--apply");
const root = (process.env.N8N_SIGNING_SECRET ?? "").trim();
if (root.length < 32 || /\s/.test(root)) throw new Error("A valid existing production signing root is required.");

// Fly receives only its normal local authentication/runtime environment, not Vercel's
// unrelated provider credentials. The signing root is passed through stdin to import.
const cliEnv = Object.fromEntries(["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "XDG_CONFIG_HOME", "FLY_CONFIG_DIR", "FLY_ACCESS_TOKEN"]
  .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
async function fly(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn("fly", args, { env: cliEnv, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", data => { stdout += data; });
    // CLI errors could include sensitive inputs. Never forward raw output on failure.
    child.stderr.resume();
    const timer = setTimeout(() => { child.kill("SIGTERM"); }, 120_000);
    child.on("error", () => { clearTimeout(timer); reject(new Error("Fly command unavailable; no automatic retry.")); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error("Fly command did not confirm success. Reconcile remote state before retrying any mutation."));
      else resolve(stdout);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
  });
}
const equal = (a, b) => typeof a === "string" && typeof b === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function checkProductionSigner() {
  const time = Date.now();
  // A nonexistent synthetic run and empty scopes prove signing compatibility without
  // granting a real run/provider access. The expected result is still a refusal.
  const claims = Buffer.from(JSON.stringify({ v: 1, accountId: randomUUID(), runId: randomUUID(),
    routineId: "D03-W01", scopes: [], iat: time, exp: time + 60_000 })).toString("base64url");
  const signature = createHmac("sha256", root).update(claims).digest("base64url");
  const request = async sig => {
    const res = await fetch(`${ORIGIN}/api/n8n/shadow-authority`, { method: "GET", redirect: "error",
      headers: { authorization: `Bearer unc_dt.${claims}.${sig}` }, signal: AbortSignal.timeout(15_000) });
    const body = await res.json();
    return { status: res.status, error: body.error };
  };
  const valid = await request(signature);
  const invalid = await request((signature[0] === "a" ? "b" : "a") + signature.slice(1));
  if (valid.status !== 404 || valid.error !== "no stored run for this token" || invalid.status !== 401 || invalid.error !== "data token mismatch")
    throw new Error("Production did not prove the supplied signing root; no worker changes allowed.");
  console.log(JSON.stringify({ productionSignerVerified: true, nonexistentRunRefused: valid.status, invalidSignatureRefused: invalid.status }));
}

async function workerState() {
  const status = JSON.parse(await fly(["status", "-a", APP, "--json"]));
  if (status.Name !== APP || status.Machines?.length !== 1 || status.Machines[0]?.id !== MACHINE || status.Machines[0]?.state !== "started")
    throw new Error("Unexpected worker topology/state; inspect before provisioning.");
  const machine = status.Machines[0];
  if (!FLAGS.every(key => machine.config.env[key] === "false")) throw new Error("Worker action flags are not all disabled.");
  const nonce = randomUUID();
  const expected = createHmac("sha256", root).update(nonce).digest("hex");
  // Code contains only public constants/challenge, never a credential. Node runs in
  // the existing machine and returns only booleans plus a one-time HMAC challenge.
  const code = `const {createHmac}=require("node:crypto");const e=process.env;const k=(e.N8N_SIGNING_SECRET||"").trim();const r=e.N8N_SHADOW_RECEIVER_TOKEN||"";console.log(JSON.stringify({buildSha:e.UNC_BUILD_SHA||null,signingPresent:!!k,challenge:k?createHmac("sha256",k).update(${JSON.stringify(nonce)}).digest("hex"):null,receiverPresent:!!r,receiverLength:r.length,receiverSeparate:!!r&&r!==k,receiverAuthReady:r.length>=24&&!/\\s/.test(r)&&r!==k,origin:e.N8N_DATA_BASE_URL||null,receiver:e.N8N_SHADOW_RECEIVER_URL||null,readerEnabled:e.N8N_EXECUTION_READER_ENABLED==="true",flagsOff:${JSON.stringify(FLAGS)}.every(n=>e[n]==="false")}));`;
  const encoded = Buffer.from(code).toString("base64");
  const raw = await fly(["ssh", "console", "-a", APP, "--machine", MACHINE, "--quiet", "-C",
    `node -e 'eval(Buffer.from("${encoded}","base64").toString())'`]);
  let remote;
  try { remote = JSON.parse(raw.trim()); } catch { throw new Error("Worker verification output was not recognized; no mutation allowed."); }
  if (!remote.flagsOff || remote.readerEnabled || !remote.receiverSeparate) {
    console.log(JSON.stringify({ workerPrecondition: { actionFlagsOff: remote.flagsOff,
      readerEnabled: remote.readerEnabled, receiverPresent: remote.receiverPresent,
      receiverLength: remote.receiverLength, receiverCredentialSeparate: remote.receiverSeparate } }));
    throw new Error("Worker is not in the expected disabled, separate-credential state.");
  }
  if (remote.signingPresent && !equal(remote.challenge, expected)) throw new Error("Worker already has a different root; rotation requires separate review.");
  if (remote.origin && remote.origin !== ORIGIN) throw new Error("Existing worker data origin differs; refusing to overwrite it.");
  if (remote.receiver && remote.receiver !== RECEIVER) throw new Error("Existing worker receiver differs; refusing to overwrite it.");
  const observed = { signingMatches: equal(remote.challenge, expected), signingMissing: !remote.signingPresent,
    originMissing: !remote.origin, receiverMissing: !remote.receiver, receiverCredentialSeparate: remote.receiverSeparate,
    receiverAuthReady: remote.receiverAuthReady, receiverCredentialLength: remote.receiverLength,
    image: machine.config.image, buildSha: remote.buildSha, release: machine.config.metadata.fly_release_version,
    actionFlagsOff: remote.flagsOff, readerDisabled: !remote.readerEnabled };
  console.log(JSON.stringify({ worker: observed }));
  return observed;
}

async function checkMatchingHealth(workerSha) {
  const response = await fetch(`${ORIGIN}/api/health`, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  const health = await response.json();
  if (!response.ok || !health.ok || !health.db?.ok || !health.worker?.fresh ||
      typeof workerSha !== "string" || !/^[a-f0-9]{40}$/.test(workerSha) || health.build?.sha !== workerSha.slice(0, 12))
    throw new Error("App/worker health or commit fingerprint does not match; verify the exact release before provisioning.");
  console.log(JSON.stringify({ appWorkerBuildMatch: true, buildSha: workerSha,
    databaseHealthy: true, workerFresh: true, checkedAt: health.time }));
}

try {
  await checkProductionSigner();
  const before = await workerState();
  await checkMatchingHealth(before.buildSha);
  if (apply) {
    const entries = [];
    if (before.signingMissing) entries.push(["N8N_SIGNING_SECRET", root]);
    if (before.originMissing) entries.push(["N8N_DATA_BASE_URL", ORIGIN]);
    if (before.receiverMissing) entries.push(["N8N_SHADOW_RECEIVER_URL", RECEIVER]);
    if (entries.length) {
      console.log(JSON.stringify({ applyingMissingKeys: entries.map(([key]) => key), preserveImage: before.image }));
      await fly(["secrets", "import", "-a", APP], entries.map(([key, value]) => `${key}=${value}`).join("\n") + "\n");
    }
    const after = await workerState();
    if (!after.signingMatches || after.originMissing || after.receiverMissing || after.image !== before.image)
      throw new Error("Post-apply verification incomplete; inspect state without reapplying.");
    await checkProductionSigner();
    await checkMatchingHealth(after.buildSha);
    console.log(JSON.stringify({ signingProvisionedAndVerified: true, sourceUnchanged: true,
      receiverAuthReady: after.receiverAuthReady, shadowDispatchReady: false, routinesDispatched: 0 }));
  }
} catch (error) {
  // Only our controlled diagnostic errors are printed, never fetch/SSH response bodies.
  const message = error instanceof Error ? error.message : "Unexpected failure";
  console.error(JSON.stringify({ ok: false, error: message.includes(root) ? "Sensitive failure details suppressed" : message }));
  process.exitCode = 1;
}
