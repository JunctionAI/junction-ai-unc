// Isolated browser contract test. Uses real AccountScope/Switcher components,
// synthetic clients and a loopback-only server; no auth, providers or live data.
import { build } from "vite";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const root = resolve(import.meta.dirname, "..");
const entry = resolve(root, "__client_selection_fixture__.tsx");
const source = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AccountScopeProvider, AccountSwitcher, useAccountRequest} from '@/components/platform/AccountScope';
const choices = [{accountId:'${A}', name:'Client A', role:'owner'}, {accountId:'${B}', name:'Client B', role:'member'}];
const selected = new URLSearchParams(location.search).get('account') || '${A}';
function Probe() {
  const request = useAccountRequest();
  const [text,setText] = useState(''), [result,setResult] = useState('');
  return <main style={{fontFamily:'sans-serif',padding:32,maxWidth:500}}>
    <h1>Junction client-selection fixture</h1><p>No live clients or provider calls</p>
    <AccountSwitcher/><label>Unsaved draft<input aria-label="Unsaved draft" value={text} onChange={e=>setText(e.target.value)}/></label>
    <button onClick={()=>request('/api/probe').then(r=>r.json()).then(r=>setResult(r.accountId))}>Read this client</button>
    <output aria-label="Read result">{result}</output>
  </main>;
}
createRoot(document.getElementById('root')).render(<AccountScopeProvider accountId={selected} choices={choices}><Probe/></AccountScopeProvider>);
`;
const bundle = await build({
  configFile: false, root, logLevel: "error", define: { "process.env.NODE_ENV": '"production"' }, resolve: { alias: { "@": resolve(root, "src") } },
  plugins: [{ name: "client-selection-fixture", resolveId: id => id === entry ? `\0${entry}` : null, load: id => id === `\0${entry}` ? source : null }],
  build: { write: false, minify: false, lib: { entry, name: "ClientSelectionFixture", formats: ["iife"] } },
});
const code = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(item => item.type === "chunk" && item.isEntry).code;
const calls = [];
const server = createServer((req, res) => {
  if (req.url === "/fixture.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(code); return; }
  if (req.url === "/api/probe") {
    const accountId = req.headers["x-unc-account-id"];
    calls.push(accountId);
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ accountId })); return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  context.setDefaultTimeout(10_000);
  const a = await context.newPage(), b = await context.newPage();
  const errors = []; const pageError = error => { errors.push(error.message); console.error("Fixture browser error:", error.message); };
  a.on("pageerror", pageError); b.on("pageerror", pageError);
  await Promise.all([a.goto(`${origin}/app?account=${A}`), b.goto(`${origin}/app?account=${B}`)]);
  await a.getByLabel("Unsaved draft").fill("Only client A's draft");
  await Promise.all([a.getByRole("button", { name: "Read this client" }).click(), b.getByRole("button", { name: "Read this client" }).click()]);
  await Promise.all([a.getByLabel("Read result").filter({ hasText: A }).waitFor(), b.getByLabel("Read result").filter({ hasText: B }).waitFor()]);
  assert.equal(await a.getByLabel("Switch client").inputValue(), A);
  assert.equal(await b.getByLabel("Switch client").inputValue(), B);
  await Promise.all([a.waitForURL(`**/app?account=${B}`), a.getByLabel("Switch client").selectOption(B)]);
  assert.equal(await a.getByLabel("Unsaved draft").inputValue(), "");
  assert.equal(await a.getByLabel("Read result").textContent(), "");
  await a.getByRole("button", { name: "Read this client" }).click();
  await a.getByLabel("Read result").filter({ hasText: B }).waitFor();
  assert.equal(await b.getByLabel("Switch client").inputValue(), B);
  assert.deepEqual(calls.slice(0, 2).sort(), [A, B].sort());
  assert.equal(calls[2], B); assert.deepEqual(errors, []);
  await a.screenshot({ path: resolve(root, "test-results/client-selection.png") });
  console.log(JSON.stringify({ status: "PASS", fixtureOnly: true, independentTabs: true, fullNavigationClearsDraft: true, requests: calls, pageErrors: errors }));
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}
