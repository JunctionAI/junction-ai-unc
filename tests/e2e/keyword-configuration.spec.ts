import {test,expect} from "@playwright/test";
import {keywordFixture} from "../keyword-configuration-fixture/data";
const base=process.env.WORKSPACE_FIXTURE_BASE;
test.skip(!base,"Isolated fixture only, no live account or provider.");
const url=()=>`${base}/tests/keyword-configuration-fixture/index.html`;
test("choose, save and reload market without enabling or running",async({page})=>{
  const saved=structuredClone(keywordFixture),posts:string[]=[];const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
  await page.route('**/api/routines/keyword-configuration',async r=>{
    if(r.request().method()==='POST'){
      expect(r.request().headers()['x-unc-account-id']).toBe(saved.accountId);expect(r.request().postDataJSON()).toEqual({market:'NZ',version:1,stateUpdatedAt:null});
      saved.market='NZ';saved.version=2;saved.stateUpdatedAt='2026-09-06T00:00:00.123456+00:00';
    }
    await r.fulfill({json:saved});
  });
  await page.goto(url());await expect(page.getByText('Saved market: Not configured.',{exact:false})).toBeVisible();
  await page.getByLabel('Search market',{exact:true}).selectOption('NZ');await page.getByRole('button',{name:'Save market',exact:true}).click();
  await expect(page.getByText('Market saved. The routine is still off; no provider request was made.')).toBeVisible();
  await page.reload();await expect(page.getByText('Saved market: New Zealand.',{exact:false})).toBeVisible();
  expect(posts).toHaveLength(1);expect(posts[0]).toContain('/api/routines/keyword-configuration');expect(errors).toEqual([]);
});
test("lost save reply requires a read, never repeats the save",async({page})=>{
  const saved=structuredClone(keywordFixture);let posts=0;
  await page.route('**/api/routines/keyword-configuration',async r=>{
    if(r.request().method()==='POST'){posts++;saved.market='US';saved.version=2;saved.stateUpdatedAt='2026-09-06T00:00:00Z';await r.abort('failed');return;}
    await r.fulfill({json:saved});
  });
  await page.goto(url());await page.getByLabel('Search market',{exact:true}).selectOption('US');await page.getByRole('button',{name:'Save market',exact:true}).click();
  await expect(page.getByText(/Save not confirmed/)).toBeVisible();expect(posts).toBe(1);
  await page.getByRole('button',{name:'Refresh settings'}).click();await expect(page.getByText('Saved market: United States.',{exact:false})).toBeVisible();expect(posts).toBe(1);
});
test("context switch discards a late save confirmation",async({page})=>{
  let finish:()=>void=()=>{};const release=new Promise<void>(resolve=>{finish=resolve;});
  let started:()=>void=()=>{};const pending=new Promise<void>(resolve=>{started=resolve;});
  await page.route('**/api/routines/keyword-configuration',async r=>{
    if(r.request().method()==='POST'){started();await release;await r.fulfill({json:{...keywordFixture,market:'US',version:2,stateUpdatedAt:'2026-09-06T00:00:00Z'}}).catch(()=>{});return;}
    await r.fulfill({json:{...keywordFixture,contextGeneration:Number(r.request().headers()['x-unc-context-generation'])}});
  });
  await page.goto(url());await page.getByLabel('Search market',{exact:true}).selectOption('US');await page.getByRole('button',{name:'Save market',exact:true}).click();await pending;
  await page.getByRole('button',{name:'Change business context'}).click();finish();
  await expect(page.getByText('Saved market: Not configured.',{exact:false})).toBeVisible();await expect(page.getByText('Confirmed saves: 0')).toBeVisible();
});
test("enabled and draft states block market changes",async({page})=>{
  for(const state of [{enabled:true},{hasDraft:true}]){
    await page.route('**/api/routines/keyword-configuration',r=>r.fulfill({json:{...keywordFixture,...state}}));await page.goto(url());
    await expect(page.getByLabel('Search market',{exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Save market',exact:true})).toBeDisabled();await page.unroute('**/api/routines/keyword-configuration');
  }
});
for(const width of [390,1280])test(`keyword setup fits ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:850});await page.goto(url());await expect(page.getByLabel('Search market',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath(`keyword-setup-${width}.png`),fullPage:true});
});
