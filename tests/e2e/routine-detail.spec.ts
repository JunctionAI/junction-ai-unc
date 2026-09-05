import {test,expect,type Page} from "@playwright/test";
import {detailFixture,paramsFixture} from "../routine-detail-fixture/data";
const base=process.env.WORKSPACE_FIXTURE_BASE;
test.skip(!base,"Requires closed synthetic fixture, never a live client.");
const url=()=>`${base}/tests/routine-detail-fixture/index.html`;
async function bind(page:Page,data=detailFixture()) {
  await page.route("**/api/agents*",r=>r.fulfill({json:data}));return data;
}
test("paused detail is inspectable without implying execution or enabling any action",async({page})=>{
  const writes:string[]=[];page.on("request",r=>{if(r.method()!=="GET")writes.push(r.url());});
  await bind(page);await page.goto(url());
  await expect(page.getByTestId("detail-version")).toHaveText("v3 · configured");
  await expect(page.getByTestId("contract-cadence")).toHaveText("Manual");
  await expect(page.getByText("Configuration only. No upcoming run or active schedule is verified here.")).toBeVisible();
  await expect(page.getByRole("button",{name:"Run now (dry run)",exact:true})).toBeDisabled();
  await expect(page.getByRole("spinbutton").first()).toBeDisabled();
  await expect(page.getByText("Automation is paused for setup verification.").first()).toBeVisible();
  await page.reload();await expect(page.getByRole("button",{name:"Save",exact:true})).toBeDisabled();expect(writes).toEqual([]);
});
test("off, member and changed configuration block a run; refreshed exact context can request it",async({page})=>{
  const data=await bind(page);data.paused=false;
  const posts:unknown[]=[];await page.route("**/api/routines/run",async r=>{
    expect(r.request().headers()["x-unc-account-id"]).toBe(data.accountId);expect(r.request().headers()["x-unc-context-generation"]).toBe("1");
    posts.push(r.request().postDataJSON());await r.fulfill({json:{accountId:data.accountId,contextGeneration:1,run:{routineId:"D01-W01",runId:"fixture-only",status:"done",summary:"Synthetic receipt only",receipts:[]}}});
  });
  await page.goto(url());const run=page.getByRole("button",{name:"Run now (dry run)",exact:true});await expect(run).toBeDisabled();
  data.routines.find(r=>r.routineId==="D01-W01")!.enabled=true;data.role="member";
  await page.getByRole("button",{name:"Refresh routine",exact:true}).click();await expect(page.getByText("Only the account owner can change or run routines.").first()).toBeVisible();await expect(run).toBeDisabled();
  data.role="owner";await page.getByRole("button",{name:"Refresh routine",exact:true}).click();await expect(run).toBeEnabled();await run.click();
  await expect(page.getByText(/Dry run complete/)).toBeVisible();expect(posts).toEqual([{accountId:data.accountId,routineId:"D01-W01",version:3,stateUpdatedAt:"2026-09-05T12:00:00.000Z"}]);
});
test("foreign run and failed settings reads never render successful or empty evidence",async({page})=>{
  const data=await bind(page);data.paused=false;data.routines.find(r=>r.routineId==="D01-W01")!.enabled=true;
  await page.route("**/api/routines/params*",r=>r.fulfill({status:503,json:{error:"fixture unavailable"}}));
  await page.route("**/api/artifacts*",r=>r.fulfill({status:503,json:{error:"fixture unavailable"}}));
  await page.route("**/api/routines/run",r=>r.fulfill({json:{accountId:"foreign",contextGeneration:1,run:{routineId:"D01-W01",runId:"foreign-run",status:"done",summary:"Do not render",receipts:[]}}}));
  await page.goto(url());await expect(page.getByText("Couldn’t verify these account settings. Refresh to try again.")).toBeVisible();
  await page.getByRole("button",{name:"Run now (dry run)",exact:true}).click();
  await expect(page.getByText(/Couldn’t run it/)).toBeVisible();await expect(page.getByText("Do not render")).toHaveCount(0);await expect(page.getByText(/No saved draft found/)).toHaveCount(0);
});
test("settings save binds account and revision and never starts validation implicitly",async({page})=>{
  const data=await bind(page);data.paused=false;const settings=paramsFixture();let saves=0;
  await page.route("**/api/routines/params*",async r=>{
    if(r.request().method()==="GET"){await r.fulfill({json:settings});return;}
    expect(r.request().method()).toBe("PATCH");expect(r.request().headers()["x-unc-account-id"]).toBe(data.accountId);expect(r.request().headers()["x-unc-context-generation"]).toBe("1");
    const b=r.request().postDataJSON();expect(b.version).toBe(3);expect(b.stateUpdatedAt).toBe(settings.stateUpdatedAt);expect(b.params.postsPerWeek).toBe(4);
    saves++;settings.fields.find(f=>f.key==="postsPerWeek")!.value=4;await r.fulfill({json:settings});
  });
  await page.goto(url());await expect(page.getByRole("spinbutton").first()).toBeEnabled();await page.getByRole("spinbutton").first().fill("4");await page.getByRole("button",{name:"Save",exact:true}).click();
  await expect(page.getByRole("spinbutton").first()).toHaveValue("4");await expect(page.getByText(/Saved. These steer/)).toBeVisible();expect(saves).toBe(1);
});
for(const width of [390,1280])test(`routine detail fits ${width}px`,async({page})=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await bind(page);await page.setViewportSize({width,height:900});await page.goto(url());
  await expect(page.getByTestId("inspector-version")).toHaveText("v3 configured");expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);expect(errors).toEqual([]);
  await page.screenshot({path:test.info().outputPath(`routine-detail-${width}.png`),fullPage:false});
});
