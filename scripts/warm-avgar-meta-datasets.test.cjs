/* eslint-disable @typescript-eslint/no-require-imports -- Node's CommonJS test runner checks the worker operator script without a bundler. */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "warm-avgar-meta-datasets.cjs"), "utf8");
const baseline = { UNC_BUILD_SHA: "7cf363cadee7e1c72e86a014812550f7b000fee0", NEXT_PUBLIC_SUPABASE_URL: "https://ycgayfsvcjpsnryrpukv.supabase.co" };

for (const [key, value, expected] of [
  ["UNC_BUILD_SHA", "other", "wrong_runtime"],
  ["NEXT_PUBLIC_SUPABASE_URL", "https://other.supabase.co", "wrong_runtime"],
  ...["UNC_COMMANDS_ENABLED", "UNC_MESSAGING_ENABLED", "LIVE_MODE_ENABLED", "TNZ_SMS_ENABLED", "APPLE_MESSAGES_ENABLED", "UNC_DATA_SYNC_ENABLED"].map(key => [key, "true", "runtime_not_held"]),
  ["UNC_COMMAND_RELEASE_SCOPES", '[{"accountId":"anything"}]', "command_scope_not_empty"],
]) {
  test(`refuses ${key} before database, credential or provider access`, async () => {
    let compiledReads = 0, clientCreations = 0;
    const sandbox = { process: { env: { ...baseline, [key]: value }, argv: [] }, module: { exports: {} }, require(name) {
      if (name === "node:path") return path;
      if (name === "@supabase/supabase-js") return { createClient() { clientCreations++; throw new Error("unexpected database access"); } };
      compiledReads++;
      throw new Error("unexpected compiled dependency access");
    } };
    vm.runInNewContext(source, sandbox, { filename: "warm-avgar-meta-datasets.cjs", timeout: 1000 });
    await assert.rejects(sandbox.module.exports.run(true), new RegExp(expected));
    assert.equal(compiledReads, 0);
    assert.equal(clientCreations, 0);
  });
}
