import {test,expect} from "@playwright/test";
import {agentsFixture} from "../agents-fixture/data";
import {CONNECTOR_REGISTRY} from "../../src/lib/connectors/registry";
const base=process.env.WORKSPACE_FIXTURE_BASE;
test.skip(!base,"Requires isolated component fixture, never a live account.");
const url=()=>`${base}/tests/agents-fixture/index.html`;
test("single and combined selections persist across reload without any run request",async({page})=>{
  const saved=structuredClone(agentsFixture);const posts:string[]=[];
  page.on("request",r=>{if(r.method()==="POST")posts.push(r.url());});
  await page.route("**/api/agents",async route=>{
    const req=route.request();if(req.method()==="GET"){await route.fulfill({json:saved});return;}
    expect(req.headers()["x-unc-account-id"]).toBe(saved.accountId);expect(req.headers()["x-unc-context-generation"]).toBe("1");
    const b=req.postDataJSON();const r=saved.routines.find(r=>r.routineId===b.routineId)!;expect(b.stateUpdatedAt).toBe(r.stateUpdatedAt);
    r.enabled=b.enabled;r.stateUpdatedAt=new Date().toISOString();await route.fulfill({json:{saved:{accountId:saved.accountId,contextGeneration:1,...r}}});
  });
  await page.goto(url());const first=page.getByRole("switch",{name:"Draft posts in your voice",exact:true});
  await first.click();await expect(first).toBeChecked();await expect(first).toBeEnabled();
  await page.getByRole("switch",{name:"Plan next month’s campaigns",exact:true}).click();
  await expect(page.getByText("2 of 36 catalog routines selected")).toBeVisible();await page.reload();await expect(first).toBeChecked();
  await first.click();await expect(first).not.toBeChecked();await expect(first).toBeEnabled();
  await page.getByRole("switch",{name:"Plan next month’s campaigns",exact:true}).click();await expect(page.getByText("0 of 36 catalog routines selected")).toBeVisible();
  expect(posts).toHaveLength(4);expect(posts.every(p=>p.endsWith("/api/agents"))).toBe(true);
});
test("unsupported jobs, aliases and keyword block remain honest; filters and inspector target work",async({page})=>{
  await page.goto(url());await expect(page.getByRole("switch",{name:"Call leads to book meetings"})).toBeDisabled();
  await expect(page.getByRole("switch",{name:"Find searches you can win"})).toBeDisabled();
  await expect(page.getByTestId("agent-D04-W01")).toHaveCount(1);
  await page.getByRole("textbox",{name:"Find a routine"}).fill("Score them before you call");await expect(page.getByRole("switch")).toHaveCount(1);
  await page.getByRole("button",{name:"Inspect →"}).click();await expect(page.getByText("Inspector target: D04-W01")).toBeVisible();
});
test("member and paused state cannot enable, but owner can turn a saved switch off",async({page})=>{
  const saved=structuredClone(agentsFixture);saved.paused=true;saved.routines[0].enabled=true;
  await page.route("**/api/agents",r=>r.fulfill({json:saved}));await page.goto(url());
  await expect(page.getByTestId(`agent-${saved.routines[0].routineId}`).getByRole("switch")).toBeEnabled();
  await expect(page.getByRole("switch",{name:"Draft posts in your voice",exact:true})).toBeDisabled();
  saved.role="member";await page.reload();await expect(page.getByTestId(`agent-${saved.routines[0].routineId}`).getByRole("switch")).toBeDisabled();
});
test("conflict reconciles without retry; foreign state clears switches",async({page})=>{
  let posts=0,foreign=false;await page.route("**/api/agents",async r=>{
    if(r.request().method()==="POST"){posts++;await r.fulfill({status:409,json:{error:"changed"}});return;}
    await r.fulfill({json:{...agentsFixture,accountId:foreign?"foreign":agentsFixture.accountId}});
  });
  await page.goto(url());const s=page.getByRole("switch",{name:"Draft posts in your voice",exact:true});await s.click();
  await expect(page.getByText(/Save not confirmed/)).toBeVisible();await expect(s).not.toBeChecked();expect(posts).toBe(1);
  foreign=true;await page.getByRole("button",{name:"Refresh",exact:true}).click();await expect(page.getByRole("alert")).toContainText("Couldn’t verify");await expect(s).toBeDisabled();
});
test("a lost save response checks actual saved state rather than retrying the POST",async({page})=>{
  const saved=structuredClone(agentsFixture);let posts=0;
  await page.route("**/api/agents",async r=>{
    if(r.request().method()==="POST"){posts++;saved.routines.find(x=>x.routineId==="D01-W01")!.enabled=true;await r.abort("failed");return;}
    await r.fulfill({json:saved});
  });
  await page.goto(url());const s=page.getByRole("switch",{name:"Draft posts in your voice",exact:true});await s.click();
  await expect(page.getByText(/Save outcome is uncertain/)).toBeVisible();await expect(s).toBeChecked();await expect(s).toBeEnabled();expect(posts).toBe(1);
});
test("Connections uses real read evidence, hides prototype counts and clears access on failed refresh",async({page})=>{
  let failed=false;const requests:string[]=[];page.on("request",r=>{if(r.method()==="POST")requests.push(r.url());});
  const connectors=CONNECTOR_REGISTRY.map(c=>({platform:c.id,name:c.name,status:c.id==="shopify"||c.id==="meta_ads"?"connected":c.id==="ga4"?"needs_reconnect":"disconnected",
    externalRef:c.id==="shopify"?"fixture.myshopify.com":null,lastSyncAt:c.id==="shopify"?"2026-09-04T09:00:00.000Z":null,lastSyncResult:c.id==="shopify"?"ok":null,lastReadMetrics:c.id==="shopify"?5:null,oauthConfigured:false,tokenPath:false}));
  await page.route("**/api/connectors/state",r=>r.fulfill(failed?{status:503,json:{error:"unavailable"}}:{json:{role:"owner",connectors,google:{configured:false,children:[]}}}));
  await page.route("**/api/connectors/meta_ads/options",r=>r.fulfill({json:{externalRef:null,options:[],listed:true}}));
  await page.route("**/api/channels/links",r=>r.fulfill({status:503,json:{error:"channel setup unavailable"}}));
  await page.goto(url());await page.getByRole("button",{name:"Connections",exact:true}).click();
  await expect(page.getByText("1 platforms with a selected asset and dated read",{exact:false})).toBeVisible();
  await expect(page.getByTestId("connector-shopify")).toContainText("2026-09-04");
  await expect(page.getByTestId("connector-meta_ads")).toContainText("choose the business asset");
  await expect(page.getByTestId("connector-meta_ads").getByText("Connected",{exact:true})).toHaveCount(0);
  await expect(page.getByText(/unlocks \d+ routines/)).toHaveCount(0);
  await page.setViewportSize({width:390,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath("connections-390.png"),fullPage:false});
  failed=true;await page.getByRole("button",{name:"Refresh status"}).click();await expect(page.getByTestId("connectors-live-error")).toBeVisible();
  await expect(page.getByRole("button",{name:"Connect",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Messaging",exact:true}).click();await expect(page.getByText(/Customer messaging remains disabled/)).toBeVisible();expect(requests).toEqual([]);
});
for(const width of [390,1280])test(`Agents fits ${width}px`,async({page})=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await page.setViewportSize({width,height:900});await page.goto(url());
  await expect(page.getByText("0 of 36 catalog routines selected")).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);expect(errors).toEqual([]);
  await page.screenshot({path:test.info().outputPath(`agents-${width}.png`),fullPage:false});
});
