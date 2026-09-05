import {test,expect,type Route} from "@playwright/test";
const base=process.env.WORKSPACE_FIXTURE_BASE;test.skip(!base,"Isolated fixture only.");
const url=()=>`${base}/tests/keyword-request-fixture/index.html`;
const reply=(r:Route,status="queued",canStartNew=false)=>({accountId:"aa5cfc84-2569-4c99-9b40-67003ae55eda",actorId:"74802c60-149a-4405-b719-dc058d174072",contextGeneration:1,
  requestId:r.request().method()==="POST"?r.request().postDataJSON().requestId:new URL(r.request().url()).searchParams.get("requestId"),routineId:"D03-W01",phase:"record",
  command:{id:"00000000-0000-4000-8000-000000000007",status,runId:status==="queued"?null:"00000000-0000-4000-8000-000000000007"},reply:`Synthetic ${status}, no provider call`,canStartNew});
test("one click queues once, reload checks the original, terminal evidence allows a new request",async({page})=>{
  const posts:string[]=[];let done=false;
  await page.route('**/api/routines/keyword-request*',async r=>{if(r.request().method()==='POST')posts.push(r.request().postDataJSON().requestId);await r.fulfill({json:reply(r,done?'done':'queued',done)});});
  await page.goto(url());await page.getByRole('button',{name:'Run keyword research',exact:true}).click();
  await expect(page.getByText(/Synthetic queued/)).toBeVisible();expect(posts).toHaveLength(1);
  await page.reload();await page.getByRole('button',{name:'Check original request'}).click();await expect(page.getByText(/Synthetic queued/)).toBeVisible();expect(posts).toHaveLength(1);
  done=true;await page.getByRole('button',{name:'Check original request'}).click();await page.getByRole('button',{name:'Show latest saved result'}).click();await expect(page.getByText('Result refreshes: 1')).toBeVisible();
  await page.getByRole('button',{name:'Allow a new request'}).click();await expect(page.getByRole('button',{name:'Run keyword research',exact:true})).toBeEnabled();expect(posts).toHaveLength(1);
});
test("lost response retains request and only sends GET on recovery, even while paused",async({page})=>{
  let id='',posts=0;await page.route('**/api/routines/keyword-request*',async r=>{
    if(r.request().method()==='POST'){posts++;id=r.request().postDataJSON().requestId;await r.abort('failed');return;}
    expect(new URL(r.request().url()).searchParams.get('requestId')).toBe(id);await r.fulfill({json:reply(r)});
  });
  await page.goto(url());await page.getByRole('button',{name:'Run keyword research',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();
  await page.reload();await page.getByRole('button',{name:'Toggle setup hold'}).click();await page.getByRole('button',{name:'Check original request'}).click();await expect(page.getByText(/Synthetic queued/)).toBeVisible();expect(posts).toBe(1);
});
test("unknown original state does not expose new-run permission",async({page})=>{
  await page.route('**/api/routines/keyword-request*',r=>r.fulfill({json:{...reply(r),phase:'not_found',command:null,reply:'Unknown original state',canStartNew:false}}));
  await page.goto(url());await page.getByRole('button',{name:'Run keyword research',exact:true}).click();await expect(page.getByText('Unknown original state')).toBeVisible();
  await expect(page.getByRole('button',{name:'Allow a new request'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Run keyword research',exact:true})).toHaveCount(0);
});
test("late reply is discarded when business context changes",async({page})=>{
  let finish:()=>void=()=>{},start:()=>void=()=>{};const release=new Promise<void>(r=>finish=r),pending=new Promise<void>(r=>start=r);
  await page.route('**/api/routines/keyword-request*',async r=>{start();await release;await r.fulfill({json:reply(r)}).catch(()=>{});});
  await page.goto(url());await page.getByRole('button',{name:'Run keyword research',exact:true}).click();await pending;await page.getByRole('button',{name:'Change business context'}).click();finish();
  await expect(page.getByRole('button',{name:'Run keyword research',exact:true})).toBeVisible();await expect(page.getByText(/Synthetic queued/)).toHaveCount(0);
});
test("unreadable browser storage refuses to send",async({page})=>{
  await page.addInitScript(()=>{Storage.prototype.setItem=()=>{throw Error('fixture storage unavailable');};});let posts=0;page.on('request',r=>{if(r.method()==='POST')posts++;});
  await page.goto(url());await page.getByRole('button',{name:'Run keyword research',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();expect(posts).toBe(0);
});
for(const width of [390,1280])test(`request controls fit ${width}px without page errors`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width,height:850});await page.goto(url());
  await expect(page.getByRole('button',{name:'Run keyword research',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);expect(errors).toEqual([]);
  await page.screenshot({path:test.info().outputPath(`keyword-request-${width}.png`),fullPage:true});
});
