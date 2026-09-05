import { test, expect } from "@playwright/test";
import { fixture } from "../workspace-fixture/data";
const base = process.env.WORKSPACE_FIXTURE_BASE;
test.skip(!base, "Start the isolated workspace component server; no live accounts are used.");
const url = () => `${base}/tests/workspace-fixture/index.html`;

test("full history pages, returns to newer work and never enables draft actions", async ({ page }) => {
  const requests: string[] = [],writes: string[]=[];
  page.on("request",r=>{if(r.method()!=="GET")writes.push(r.url());});
  await page.route("**/api/workspace/history*",r=>{
    requests.push(r.request().url());
    expect(r.request().headers()["x-unc-account-id"]).toBe(fixture.accountId);
    expect(r.request().headers()["x-unc-context-generation"]).toBe("1");
    const older=new URL(r.request().url()).searchParams.has("cursor");
    return r.fulfill({json:{accountId:fixture.accountId,contextGeneration:1,fetchedAt:fixture.fetchedAt,asOf:fixture.fetchedAt,
      nextCursor:older?null:"fixture-position",entries:older?[{kind:"artifact",id:"older-draft",occurredAt:fixture.fetchedAt,
        artifact:{...fixture.artifacts[0],id:"older-draft",title:"Older saved golf research"}}]:[{kind:"run",id:"newer-run",occurredAt:fixture.fetchedAt,
        run:{id:"newer-run",routineId:"D03-W01",name:"Recent history run",mode:"dry_run",status:"done",startedAt:fixture.fetchedAt,finishedAt:fixture.fetchedAt}}]}});
  });
  await page.goto(url()+"#inbox");await page.getByRole("button",{name:"Browse full saved history"}).click();
  await expect(page.getByText("Recent history run",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Older page",exact:true}).click();
  await expect(page.getByText("Older saved golf research",{exact:true})).toBeVisible();
  await page.getByTestId("artifact-open").click();
  await expect(page.getByTestId("artifact-approve")).toBeDisabled();
  await expect(page.getByTestId("artifact-hold")).toBeDisabled();
  await expect(page.getByText("End of this history view.")).toBeVisible();
  await expect(page.getByRole("button",{name:"Older page",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Newer page",exact:true}).click();
  await expect(page.getByText("Recent history run",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Newer page",exact:true})).toBeDisabled();
  expect(requests.some(u=>u.includes("cursor=fixture-position"))).toBe(true);expect(writes).toEqual([]);
});
test("history failure or foreign context never renders an empty/successful page", async ({ page }) => {
  await page.route("**/api/workspace/history*",r=>r.fulfill({json:{accountId:"foreign-account",contextGeneration:1,entries:[],nextCursor:null,asOf:fixture.fetchedAt}}));
  await page.goto(url()+"#inbox");await page.getByRole("button",{name:"Browse full saved history"}).click();
  await expect(page.getByRole("alert").filter({hasText:"Couldn’t verify this history page"})).toBeVisible();
  await expect(page.getByText("No saved records on this page.")).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Older page",exact:true})).toBeDisabled();
});

test("Today and inbox show saved records, filters, receipts and unchanged navigation", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(url());
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await expect(page.getByText("Golf keyword discovery", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Work inbox/ }).click();
  await page.getByRole("button", { name: "Content", exact: true }).click();
  await expect(page.getByText("No saved work matches this filter.")).toBeVisible();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.getByText("Golf keyword discovery", { exact: true })).toBeVisible();
  await page.getByText("Synthetic draft prepared", { exact: true }).click();
  await expect(page.getByText("Receipt receipt-fixture", { exact: false })).toBeVisible();
  await page.reload(); await expect(page.getByRole("heading", { name: "Work inbox", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Existing connectors controls" })).toBeVisible();
  await page.goBack(); await expect(page.getByRole("heading", { name: "Work inbox", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test("draft review carries account/generation/revision, updates and survives reload", async ({ page }) => {
  const saved = structuredClone(fixture); const posts: Record<string, unknown>[] = [];
  await page.route("**/api/workspace", r => r.fulfill({ json: saved }));
  await page.route("**/api/artifacts/*", async r => {
    const req = r.request(); const body = req.postDataJSON(); posts.push(body);
    expect(req.headers()["x-unc-account-id"]).toBe(saved.accountId);
    expect(req.headers()["x-unc-context-generation"]).toBe("1");
    expect(body.expectedRevision).toBe(saved.artifacts[0].revision);
    saved.artifacts[0] = { ...saved.artifacts[0], status: body.action === "edit" ? "edited" : "approved", revision: saved.artifacts[0].revision! + 1, editedBody: body.editedBody || saved.artifacts[0].editedBody };
    await r.fulfill({ json: { artifact: saved.artifacts[0] } });
  });
  await page.goto(url() + "#inbox"); await page.getByTestId("artifact-open").click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Edit the draft" }).fill("My reviewed words");
  await page.getByRole("button", { name: "Save edit", exact: true }).click();
  await expect(page.getByTestId("artifact-status")).toHaveText("Edited");
  await page.getByTestId("artifact-open").click();
  await page.getByTestId("artifact-approve").click();
  await expect(page.getByTestId("artifact-status")).toHaveText("Approved");
  await page.reload(); await expect(page.getByTestId("artifact-status")).toHaveText("Approved");
  expect(posts.map(p => p.action)).toEqual(["edit", "approve"]);
});
test("paused/member read-only mode never posts a decision or delivery", async ({ page }) => {
  const posts: string[] = []; page.on("request", r => { if (r.method() === "POST") posts.push(r.url()); });
  await page.route("**/api/workspace", r => r.fulfill({ json: { ...fixture, paused: true, canReview: false } }));
  await page.goto(url() + "#inbox"); await page.getByTestId("artifact-open").click();
  await expect(page.getByTestId("artifact-approve")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Why?", exact: true }).click();
  await expect(page.getByText("Synthetic browser test only", { exact: false })).toBeVisible();
  expect(posts).toEqual([]); await expect(page.getByRole("button", { name: /Send me this/ })).toHaveCount(0);
});
test("a revision conflict leaves the draft unchanged and a held draft reloads as held", async ({ page }) => {
  const saved = structuredClone(fixture); let conflict = true; const posts: unknown[] = [];
  await page.route("**/api/workspace", r => r.fulfill({ json: saved }));
  await page.route("**/api/artifacts/*", async r => {
    const body = r.request().postDataJSON(); posts.push(body);
    if (conflict) { await r.fulfill({ status: 409, json: { error: "Draft changed. Reload before deciding." } }); return; }
    saved.artifacts[0] = { ...saved.artifacts[0], status: "held", revision: 1 };
    await r.fulfill({ json: { artifact: saved.artifacts[0] } });
  });
  await page.goto(url() + "#inbox"); await page.getByTestId("artifact-open").click();
  await page.getByTestId("artifact-approve").click();
  await expect(page.getByText("Couldn’t do that: Draft changed. Reload before deciding.")).toBeVisible();
  await expect(page.getByTestId("artifact-status")).toHaveText("Waiting on you");
  conflict = false; await page.getByTestId("artifact-hold").click();
  await page.getByRole("textbox", { name: "Why hold it?" }).fill("Check demand before choosing a winner");
  await page.getByRole("button", { name: "Hold it", exact: true }).click();
  await expect(page.getByTestId("artifact-status")).toHaveText("Held");
  await page.reload(); await expect(page.getByTestId("artifact-status")).toHaveText("Held");
  expect(posts).toHaveLength(2);
});
test("a plain-language request opens the account conversation", async ({ page }) => {
  await page.goto(url());
  await page.getByRole("textbox", { name: "Ask your agents" }).fill("What should I review first?");
  await page.getByRole("button", { name: "Ask", exact: true }).last().click();
  await expect(page.getByRole("heading", { name: "Ask", exact: true })).toBeVisible();
  await expect(page.getByRole("log")).toContainText("What should I review first?");
  await expect(page.getByRole("log")).toContainText("Synthetic response. Nothing executed.");
});
test("wrong context and failed refresh cannot become zero or stale-success screens", async ({ page }) => {
  let fail = false;
  await page.route("**/api/workspace", r => r.fulfill({ status: fail ? 503 : 200, json: fail ? { error: "unavailable" } : { ...fixture, accountId: "wrong-account" } }));
  await page.goto(url()); await expect(page.getByRole("alert")).toContainText("No empty or completed state");
  await expect(page.getByText("No draft or run approval is waiting", { exact: false })).toHaveCount(0);
  fail = true; await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
});
for (const width of [390, 1280]) test(`workspace and draft review fit ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 }); await page.goto(url() + "#inbox");
  await page.getByTestId("artifact-open").click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`workspace-${width}.png`), fullPage: true });
});
