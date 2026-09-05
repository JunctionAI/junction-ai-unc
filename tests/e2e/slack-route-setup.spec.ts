import {test,expect} from "@playwright/test";
const base=process.env.WORKSPACE_FIXTURE_BASE;
test.skip(!base,"Isolated synthetic fixture only; no live account or provider.");
const A="aa5cfc84-2569-4c99-9b40-67003ae55eda",U="74802c60-149a-4405-b719-dc058d174072",L="22ebc4cc-5592-4404-b32f-e12c7b01c1cd";
const identity={identityLinkId:L,identityLinkVersion:2,workspaceId:"T1",workspaceName:"Synthetic team",botUserId:"UBOT",credentialStored:true};
const fixture=()=>({accountId:A,actorId:U,contextGeneration:1,paused:true,identities:[identity],routes:[] as Record<string,unknown>[],activationAvailable:false,executedAction:"none"});
const savedRoute={identityLinkId:L,identityLinkVersion:2,workspaceId:"T1",conversationId:"C1",routeId:U,revision:0,state:"staged",bindingCurrent:true,verifiedAt:"2026-09-06T00:00:00Z"};
const url=()=>`${base}/tests/slack-route-setup-fixture/index.html`;
test("owner explicitly selects existing identity; stage and reload show no activation",async({page})=>{
  const saved=fixture(),posts:string[]=[],errors:string[]=[];
  page.on("pageerror",e=>errors.push(e.message));page.on("request",r=>{if(r.method()==="POST")posts.push(r.url());});
  await page.route("**/api/channels/slack/routes",async r=>{
    if(r.request().method()==="POST"){
      expect(r.request().headers()["x-unc-actor-id"]).toBe(U);
      expect(r.request().postDataJSON()).toEqual({identityLinkId:L,identityLinkVersion:2,workspaceId:"T1",conversationId:"C1"});saved.routes=[savedRoute];
    }await r.fulfill({json:saved});
  });
  await page.goto(url());await expect(page.getByLabel("Existing Slack connection")).toHaveValue("");
  await expect(page.getByRole("button",{name:"Verify and stage channel"})).toBeDisabled();
  await page.getByLabel("Existing Slack connection").selectOption(L);await page.getByLabel("Client Slack channel ID").fill("C1");
  await page.getByRole("button",{name:"Verify and stage channel"}).click();await expect(page.getByText(/Channel mapping saved as staged/)).toBeVisible();
  await page.reload();await expect(page.getByText(/T1 \/ C1 — staged/)).toBeVisible();
  expect(posts).toEqual([`${base}/api/channels/slack/routes`]);expect(errors).toEqual([]);
  await expect(page.locator('[data-nextjs-dialog], vite-error-overlay')).toHaveCount(0);
});
test("lost save reply blocks another submission until readback; no automatic retry",async({page})=>{
  const saved=fixture();let posts=0;
  await page.route("**/api/channels/slack/routes",async r=>{
    if(r.request().method()==="POST"){posts++;saved.routes=[savedRoute];await r.abort("failed");}else await r.fulfill({json:saved});
  });
  await page.goto(url());await page.getByLabel("Existing Slack connection").selectOption(L);await page.getByLabel("Client Slack channel ID").fill("C1");
  await page.getByRole("button",{name:"Verify and stage channel"}).click();await expect(page.getByText(/Refresh to check the saved mapping/)).toBeVisible();
  await expect(page.getByRole("button",{name:"Verify and stage channel"})).toHaveCount(0);
  await page.getByRole("button",{name:"Refresh Slack setup"}).click();await expect(page.getByText(/T1 \/ C1 — staged/)).toBeVisible();expect(posts).toBe(1);
});
test("late save response cannot populate a changed business context",async({page})=>{
  let release=()=>{},started=()=>{};const held=new Promise<void>(r=>{release=r;}),pending=new Promise<void>(r=>{started=r;});
  await page.route("**/api/channels/slack/routes",async r=>{
    if(r.request().method()==="POST"){started();await held;await r.fulfill({json:{...fixture(),routes:[savedRoute]}}).catch(()=>{});}
    else await r.fulfill({json:{...fixture(),contextGeneration:Number(r.request().headers()["x-unc-context-generation"])}});
  });
  await page.goto(url());await page.getByLabel("Existing Slack connection").selectOption(L);await page.getByLabel("Client Slack channel ID").fill("C1");
  await page.getByRole("button",{name:"Verify and stage channel"}).click();await pending;
  await page.getByRole("button",{name:"Change business context"}).click();release();
  await expect(page.getByLabel("Existing Slack connection")).toHaveValue("");await expect(page.getByLabel("Client Slack channel ID")).toHaveValue("");
  await expect(page.getByText(/Channel mapping saved as staged/)).toHaveCount(0);await expect(page.getByText(/T1 \/ C1 — staged/)).toHaveCount(0);
});
test("missing identity or missing saved credential cannot pretend to be connected",async({page})=>{
  await page.route("**/api/channels/slack/routes",r=>r.fulfill({json:{...fixture(),identities:[]}}));
  await page.goto(url());await expect(page.getByText(/No verified Junction Slack identity/)).toBeVisible();
  await expect(page.getByRole("button",{name:"Verify and stage channel"})).toHaveCount(0);
});
for(const width of [390,1280])test(`Slack setup fits ${width}px and has usable fields`,async({page})=>{
  await page.route("**/api/channels/slack/routes",r=>r.fulfill({json:{...fixture(),routes:[savedRoute]}}));
  await page.setViewportSize({width,height:1000});await page.goto(url());await expect(page.getByLabel("Existing Slack connection")).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath(`slack-setup-${width}.png`),fullPage:true});
});
