
class Component extends DCLogic {
  constructor(props) {
    super(props);
    const mk = (names, cat, id) => names.map((n, i) => ({ id: `${id}-W${String(i+1).padStart(2,'0')}`, name: n, cat }));
    this.categories = [
      { id:'D01', name:'Content', systems:['Founder content engine','Viral hook mining','Customer-question mining','UGC creator pipeline','Social repurposing','Winning elements library','Trend watch','Content performance learning'] },
      { id:'D02', name:'Paid ads', systems:['Daily paid decisioning','Creative testing sprints','Hook rotation engine','Ad fatigue watch','Creator whitelisting','Creative test planner','Budget pacing guard','Organic-to-paid promotion'] },
      { id:'D03', name:'SEO', systems:['Keyword opportunity scan','Content gap analysis','AI search visibility','On-page SEO fixes','SERP position watch','Competitor gap watch'] },
      { id:'D04', name:'Sales', systems:['Lead research & scoring','Supervised outbound drafts','Meeting brief builder','Follow-up cadence','Win/loss capture','Pipeline hygiene'] },
      { id:'D05', name:'Email & SMS', systems:['Welcome flow tuning','Abandoned cart recovery','Segmentation refresh','Winback campaign prep','Post-purchase education','Review request timing','Campaign calendar prep'] },
    ];
    this.allSystems = this.categories.flatMap(c => mk(c.systems, c.name, c.id));
    const states = ['Active','Active','Draft mode','Available','Available','Dry run','Available','Approval gated'];
    const modes = ['Approval gated — prepares the exact mutation and waits for a named approver.','Draft — prepares work but never changes the destination.','Read only — inspects and recommends.','Bounded auto — reversible actions inside published policy, read back and receipted.'];
    const cadences = ['Daily at 07:00, after certified metrics refresh.','Weekly on Monday, or on demand from conversation.','On new data arriving from connected sources.','Every 6 hours during active campaigns.'];
    this.allSystems.forEach((s, i) => {
      s.state = states[i % states.length];
      s.mode = modes[i % modes.length];
      s.cadence = cadences[i % cadences.length];
      s.kpi = ['Goal movement per run','Approval acceptance rate','Time-to-decision','Reconciled accuracy'][i % 4];
      s.purpose = `Runs ${s.name.toLowerCase()} inside agreed limits, with certified inputs and a full receipt.`;
    });
    const benefits = {
      'Founder content engine':'Posts in your voice, drafted for you','Customer-question mining':'Never run out of content ideas','Social repurposing':'One post becomes five','Content performance learning':'Double down on what works',
      'Daily paid decisioning':'Budget moves to winners every morning','Creative test planner':'Find winning ads faster','Budget pacing guard':'Never overspend','Organic-to-paid promotion':'Turn proven posts into ads',
      'Keyword opportunity scan':'Find searches you can win','Content gap analysis':'Know exactly what to write next','On-page SEO fixes':'Fix what holds rankings back','SERP position watch':'Know the moment rankings move',
      'Lead research & scoring':'Only talk to right-fit leads','Supervised outbound drafts':'Outreach written — you just approve','Follow-up cadence':'Never drop a deal','Pipeline hygiene':'A clean pipeline, always',
      'Viral hook mining':'Steal what\u2019s already working in your niche','UGC creator pipeline':'A steady stream of real-people content','Winning elements library':'Every win becomes a reusable recipe','Trend watch':'Catch trends while they\u2019re rising',
      'Creative testing sprints':'Test 10+ ad concepts a month — brands that do pay ~31% less per sale','Hook rotation engine':'Fresh hooks before ads go stale (they fatigue in ~2 weeks)','Ad fatigue watch':'Kill tired ads before they waste spend','Creator whitelisting':'Run ads from real people\u2019s handles — trust you can\u2019t buy',
      'AI search visibility':'Get recommended by ChatGPT & friends','Competitor gap watch':'Spot their moves before rankings shift',
      'Meeting brief builder':'Walk into every call prepared','Win/loss capture':'Learn why deals close or die',
      'Segmentation refresh':'Right message, right person, every time','Post-purchase education':'Turn buyers into believers',
      'Welcome flow tuning':'Turn first orders into second orders','Abandoned cart recovery':'Win back the almost-buyers','Winback campaign prep':'Revive lapsed customers','Review request timing':'More reviews, asked at the right moment','Campaign calendar prep':'Campaigns planned ahead, not scrambled',
    };
    this.allSystems.forEach(s => { s.benefit = benefits[s.name] || s.purpose; });
    this.catTaglines = { 'Content':'Get seen consistently', 'Paid ads':'Make every dollar work harder', 'SEO':'Get found on Google', 'Sales':'Fill your calendar with right-fit buyers', 'Email & SMS':'Keep customers coming back' };
    const flag = (id, p) => { const s = this.allSystems.find(x => x.id === id); if (s) s.purpose = p; };
    flag('D01-W01','Turns real customer questions into founder-voice posts, staged for one-tap approval.');
    flag('D02-W01','Reads certified spend and revenue each morning and proposes the day\u2019s budget moves.');
    flag('D02-W04','Finds organic winners and prepares them as paid creative tests.');
    flag('D04-W01','Researches and scores leads against your ICP before any outreach is drafted.');
    flag('D03-W01','Finds search demand you can win with content you already have authority for.');
    this.connectorDefs = [
      { name:'Shopify', cat:'Commerce', unlocks:12, st:'ok', note:'orders · products · customers' },
      { name:'Google Analytics 4', cat:'Analytics', unlocks:10, st:'ok', note:'sessions · conversion · attribution' },
      { name:'Meta Ads', cat:'Paid', unlocks:4, st:'ok', note:'campaigns · spend · creative' },
      { name:'Google Ads', cat:'Paid', unlocks:4, st:'off', note:'search & shopping campaigns' },
      { name:'Klaviyo', cat:'Email & SMS', unlocks:5, st:'expired', note:'lists · flows · campaigns' },
      { name:'Instagram', cat:'Social', unlocks:4, st:'ok', note:'posts · reels · engagement' },
      { name:'TikTok', cat:'Social', unlocks:3, st:'off', note:'posts · views · trends' },
      { name:'LinkedIn', cat:'Social', unlocks:4, st:'off', note:'founder posts · engagement' },
      { name:'YouTube', cat:'Social', unlocks:2, st:'off', note:'videos · watch time' },
      { name:'Google Search Console', cat:'SEO', unlocks:4, st:'off', note:'queries · positions · indexing' },
      { name:'HubSpot', cat:'Sales', unlocks:4, st:'off', note:'contacts · deals · pipeline' },
      { name:'Gmail', cat:'Sales', unlocks:3, st:'off', note:'supervised outreach drafts' },
      { name:'Gorgias', cat:'Support', unlocks:2, st:'off', note:'tickets · customer questions' },
      { name:'Xero', cat:'Accounting', unlocks:6, st:'off', note:'real profit · margins · cash cover' },
      { name:'QuickBooks', cat:'Accounting', unlocks:6, st:'off', note:'real profit · margins · cash cover' },
      { name:'Slack', cat:'Workspace', unlocks:21, st:'ok', note:'decisions · approvals · alerts' },
    ];
    this.state = {
      view:'today', selCat:'All', sel:null, draft:'', goalTitle:'NZ$40,000 MRR', deadline:'2026-09-30',
      apStatus:['pending','pending','pending'], apWhy:[false,false,false],
      propStatus:['ready','blocked','building'],
      nodeSel:0, nodeVals:{}, wfState:'clean', wfVer:12, routineOn:{},
      chatOpen:false, setupOpen:false, setupStep:0, setupDone:false, connState:{}, posture:'brand',
      readThread:[], readDraft:'', chatMode:'ai',
      humanThread:[
        { from:'h', text:'Kia ora \u2014 Sam from the Junction team. I can see your goal, strategy and receipts (never your credentials), so you don\u2019t need to explain from scratch. What are you wrestling with?' },
        { from:'h', text:'One nudge from this week\u2019s account review: the welcome-flow voiceover is your biggest open lever \u2014 worth your 2 hours before anything else.' },
      ],
      routineEdits:{}, addOpen:null,
      profile:{ budget:'≤ NZ$120/day', time:'6 h/wk', strength:'Writing & product', belief:'Brand before sales', team:'Just me' },
      onboarded:false, obStep:0, obStrengths:['Writing','Product'], obBreadth:'focused',
      obCats:['revenue'], team:[{ name:'You', role:'Founder', areas:['Content','Paid ads','SEO','Sales','Email & SMS'] }], budgetMo:3600, hoursWk:6, baselineText:'NZ$28,400 MRR today',
      currency:'NZD', targetNum:40000, baselineNum:28400, reinvest:'balanced', marginPct:30, obMoneyOpen:false, obTeamOpen:false, website:'', socials:'',
      obPlatforms:['Instagram'], obThread:[], obDraft:'', obPace:'Steady · 4 weeks', obPostureSet:['brand'],
      goalTexts:{ revenue:'NZ$40,000 MRR', profit:'63% blended margin', brand:'25k engaged followers', leads:'40 qualified leads/mo', retention:'22% repeat purchase rate', launch:'Launch the AU market' },
      messages:[
        { from:'j', text:'Morning Tom. Overnight I completed the weekly brief and staged 4 founder posts. One decision is waiting: a NZ$40/day budget shift with 3.1× expected ROAS. Want the reasoning?' },
        { from:'u', text:'Why shift budget away from Prospecting-B?' },
        { from:'j', text:'Prospecting-B\u2019s 7-day ROAS fell to 1.4\u00d7 while Advantage+ retargeting held 3.1\u00d7 on the same certified revenue definition. The shift stays inside your NZ$120/day guardrail and is reversible. This comes from Daily paid decisioning \u2014 you can inspect every step.', link:'D02-W01', linkLabel:'Inspect the system \u2192' },
      ],
    };
  }
  _install() {
    if (this._wired) return;
    this._wired = true;
    this._buddyTick = () => {
      const els = Array.from(document.querySelectorAll('[data-buddy]'));
      let txt = '';
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight * 0.55 && r.bottom > 80) txt = el.getAttribute('data-buddy');
      }
      if (txt !== (this.state.buddyText || '')) this.setState({ buddyText: txt });
    };
    this._buddyScroll = () => {
      if (this._buddyRaf) return;
      this._buddyRaf = requestAnimationFrame(() => { this._buddyRaf = 0; this._buddyTick(); });
    };
    window.addEventListener('scroll', this._buddyScroll, { passive: true });
    setTimeout(this._buddyTick, 400);
  }
  componentDidMount() { this._install(); }
  componentWillUnmount() { if (this._buddyScroll) window.removeEventListener('scroll', this._buddyScroll); }
  renderVals() {
    const S = this.state;
    this._install();
    const viewKey = `${S.view}|${S.sel ? S.sel.id : ''}|${S.onboarded ? 1 : 0}`;
    if (viewKey !== this._viewKey) { this._viewKey = viewKey; setTimeout(() => this._buddyTick && this._buddyTick(), 150); }
    const msgN = S.messages.length + S.humanThread.length + S.obThread.length;
    if (msgN !== this._msgN) {
      this._msgN = msgN;
      setTimeout(() => document.querySelectorAll('[data-autoscroll]').forEach(el => { el.scrollTop = el.scrollHeight; }), 60);
    }
    const baseline = S.baselineNum || 28400;
    const cur = this.props.currentMRR ?? (baseline !== 28400 ? baseline : 31650);
    const curSym = { NZD:'NZ$', AUD:'A$', USD:'US$', GBP:'£', EUR:'€' }[S.currency] || 'NZ$';
    const digitsM = S.goalTitle.match(/\d[\d,]*/);
    const target = Math.max((digitsM ? parseInt(digitsM[0].replace(/,/g, ''), 10) : 40000) || 40000, cur + 1);
    const today = new Date('2026-08-31T00:00:00'), start = new Date('2026-08-12T00:00:00'), dl = new Date(S.deadline + 'T00:00:00');
    const elapsed = Math.max(1, Math.round((today - start) / 864e5));
    const pace = (cur - baseline) / elapsed;
    const daysLeftN = Math.max(1, Math.round((dl - today) / 864e5));
    const needed = Math.max(0, (target - cur) / daysLeftN);
    const proj = Math.round(cur + pace * daysLeftN);
    const gap = target - proj;
    const onTrack = gap <= 0;
    const fmt = n => curSym + Math.round(n).toLocaleString('en-NZ');
    const nav = v => () => this.setState({ view:v });
    const openSys = s => this.setState({ view:'systems', sel:s, nodeSel:0, nodeVals:{}, wfState:'clean', setupOpen:false, setupStep:0, setupDone:false });
    const cyan = 'oklch(0.78 0.13 220)', navy = 'oklch(0.27 0.055 262)';
    const activeBg = 'oklch(0.36 0.06 262)', dim = 'oklch(0.45 0.05 262)';
    const stateStyle = st => st === 'Active' ? ['oklch(0.45 0.1 240)','oklch(0.94 0.03 225)']
      : st === 'Available' ? ['oklch(0.52 0.03 260)','oklch(0.945 0.008 260)']
      : ['oklch(0.5 0.12 75)','oklch(0.93 0.05 80)'];
    const apData = [
      { sys:'D02-W01', title:'Shift NZ$40/day into Advantage+ retargeting', detail:'Prospecting-B ROAS fell to 1.4\u00d7 over 7 days; retargeting holds 3.1\u00d7. Reversible, inside guardrail.', before:'NZ$60/day Prospecting-B', after:'NZ$20/day + NZ$40 retargeting', expiry:'expires in 18h' },
      { sys:'D01-W01', title:'Publish founder post \u201cWhy we stopped discounting\u201d', detail:'Drafted from 31 customer questions. Zero first-person claims added. Scheduled for 09:00 Tuesday.', before:'Staged draft', after:'Published to LinkedIn', expiry:'expires in 2d' },
      { sys:'D05-W03', title:'Send winback to 412 lapsed customers', detail:'Zero-recipient test passed. 15% offer respects margin guardrail. Suppresses anyone emailed this week.', before:'0 recipients', after:'412 recipients, 1 send', expiry:'expires in 3d' },
    ];
    const whyTexts = [
      'Certified 7-day ROAS: Prospecting-B 1.4\u00d7, Advantage+ 3.1\u00d7 on identical revenue definitions. Reversible within a day, inside your NZ$120/day guardrail. Downside if wrong: ~NZ$40. Upside at the current spread: ~NZ$68/day.',
      'Drafted only from questions 31 customers actually asked. No first-person claims were generated \u2014 the two personal lines are quoted from your own previous posts. Tuesday 09:00 is your audience\u2019s peak window.',
      'All 412 lapsed 60\u2013180 days; anyone emailed this week is suppressed. The 15% offer keeps margin at 63%, above your 61% floor. Zero-recipient test passed last night \u2014 receipt R-4489.',
    ];
    const approvals = apData.map((a, i) => ({ ...a,
      pending: S.apStatus[i] === 'pending', approved: S.apStatus[i] === 'approved', held: S.apStatus[i] === 'held',
      receipt: `R-449${i + 1}`, showWhy: S.apWhy[i] && S.apStatus[i] === 'pending', whyText: whyTexts[i],
      why: () => this.setState(s => ({ apWhy: s.apWhy.map((x, j) => j === i ? !x : x) })),
      approve: () => this.setState(s => ({ apStatus: s.apStatus.map((x, j) => j === i ? 'approved' : x) })),
      hold: () => this.setState(s => ({ apStatus: s.apStatus.map((x, j) => j === i ? 'held' : x) })),
    }));
    const cats = ['All', ...this.categories.map(c => c.name)];
    const catChips = cats.map(name => {
      const on = S.selCat === name;
      return { name, count: name === 'All' ? this.allSystems.length : this.categories.find(c => c.name === name).systems.length,
        pick: () => this.setState({ selCat:name }),
        bg: on ? navy : 'white', color: on ? 'white' : 'oklch(0.4 0.04 262)', border: on ? navy : 'oklch(0.89 0.012 260)' };
    });
    const visibleSystems = this.allSystems.filter(s => S.selCat === 'All' || s.cat === S.selCat).map(s => {
      const [c, b] = stateStyle(s.state);
      return { ...s, stateColor:c, stateBg:b, open: () => openSys(s) };
    });
    const sel = S.sel;
    const selSteps = sel ? [
      { n:1, title:'Resolve identity and goal', detail:'Tenant, current goal, workflow version and a deduplication key — no run happens twice.', line:true },
      { n:2, title:'Read certified inputs', detail:`Exact sources behind ${sel.name.toLowerCase()}, checked for freshness and reconciliation.`, line:true },
      { n:3, title:'Decide inside bounds', detail:'The versioned skill produces one bounded decision with its evidence attached.', line:true },
      { n:4, title:'Ask when it matters', detail:'Consequential actions produce an exact before/after packet and wait for a named approver.', line:true },
      { n:5, title:'Execute, read back, receipt', detail:'Only the approved scope runs. Junction independently verifies the result and writes the full receipt.', line:false },
    ] : [];
    const selState = sel ? stateStyle(sel.state) : ['',''];
    const send = () => {
      const t = S.draft.trim(); if (!t) return;
      if (S.chatMode === 'human') {
        this.setState(s => ({ draft:'', humanThread:[...s.humanThread,
          { from:'u', text:t },
          { from:'j', text:'Got it \u2014 I have your account context in front of me: goal, strategy, receipts. I\u2019ll come back with a proper answer within a few hours, or I can book you a 20-minute strategy call. \u2014 Sam' }] }));
      } else {
        this.setState(s => ({ draft:'', messages:[...s.messages,
          { from:'u', text:t },
          { from:'j', text:'Understood. I\u2019ll map that to the right system, run it read-only first, and bring you one decision with the evidence \u2014 nothing changes without your approval.' }] }));
      }
    };
    const msgs = S.messages.map(m => ({ text:m.text, fromUser:m.from==='u', fromJunction:m.from==='j',
      link:!!m.link, linkLabel:m.linkLabel,
      linkGo: () => { const s = this.allSystems.find(x => x.id === m.link); openSys(s); } }));
    const toggleChat = () => this.setState(s => ({ chatOpen: !s.chatOpen }));
    const postureDefs = {
      brand: { label:'Brand-led organic', tag:'CURRENT PLAY', thesis:'Compound trust through your voice, convert it with retention, amplify with paid only once repeat holds.', fit:'Fits: low budget · strong voice · brand-first belief',
        why:'Chosen with you on 12 Aug. Your budget caps paid, your writing is the asset, and you believe brand compounds before sales. Someone sales-led would get a different plan — this one is shaped to where you add the most value, and it persists until we supersede it together.',
        phases:[
          { n:'1', name:'Organic brand engine', st:'ACTIVE', routines:['Founder content engine','Social repurposing','Customer-question mining'], you:'~2 h/wk — your voice and taste, the part only you can do.' },
          { n:'2', name:'Retention & lifecycle', st:'NOW', routines:['Winback campaign prep','Welcome flow tuning','Review request timing'], you:'~20 min/day clearing approvals.' },
          { n:'3', name:'Paid amplification', st:'GATED · repeat ≥ 18%', routines:['Daily paid decisioning','Organic-to-paid promotion'], you:'Weekly budget sign-off.' },
          { n:'4', name:'Scale the organization', st:'GATED · NZ$40k MRR', routines:['Specialist agents','First human hire'], you:'Hire and graduation decisions.' } ] },
      sales: { label:'Sales-led outbound', tag:'ALTERNATIVE', thesis:'Fill your calendar with qualified conversations and clear everything around the close.', fit:'Fits: strong closer · calls, DMs, demos · deal-driven',
        why:'If your edge is conversations — cold calls, LinkedIn DMs, demos — the machine should hunt, qualify and brief so every hour you spend is spent closing. Retention and content become support acts for pipeline.',
        phases:[
          { n:'1', name:'Pipeline engine', st:'WOULD ACTIVATE', routines:['Lead research & scoring','Supervised outbound drafts'], you:'~1 h/day — conversations and closing, your strength.' },
          { n:'2', name:'Follow-up & pipeline', st:'NEXT', routines:['Follow-up cadence','Pipeline hygiene'], you:'Approve sends; take the meetings.' },
          { n:'3', name:'Referral & expansion', st:'GATED · 20 closed deals', routines:['Review request timing','Winback campaign prep'], you:'The asks only a founder can make.' },
          { n:'4', name:'Scale the organization', st:'GATED · NZ$40k MRR', routines:['Sales agents','First SDR hire'], you:'Hire and graduation decisions.' } ] },
      paid: { label:'Paid-led scale', tag:'ALTERNATIVE', thesis:'Deploy capital into creative testing and buy learning faster than organic can compound.', fit:'Fits: capital to deploy · media experience · speed-first',
        why:'With capital and ad experience, paid buys learning fastest — the machine guards efficiency, kills losers overnight and scales winners inside hard guardrails while CRO keeps the funnel honest.',
        phases:[
          { n:'1', name:'Creative testing engine', st:'WOULD ACTIVATE', routines:['Creative test planner','Organic-to-paid promotion'], you:'Creative taste calls, weekly.' },
          { n:'2', name:'Spend scaling', st:'GATED · ROAS ≥ 2.5×', routines:['Daily paid decisioning','Budget pacing guard'], you:'Budget sign-off as caps rise.' },
          { n:'3', name:'Funnel & flows', st:'NEXT', routines:['Welcome flow tuning','Abandoned cart recovery'], you:'Approve test variants.' },
          { n:'4', name:'Scale the organization', st:'GATED · NZ$40k MRR', routines:['Specialist agents','Media buyer hire'], you:'Hire and graduation decisions.' } ] },
    };
    const pd = postureDefs[S.posture];
    const postureLeans = {
      brand: { skills:['Writing','Video','Community'], plats:['Instagram','TikTok','LinkedIn'] },
      sales: { skills:['Sales conversations','Cold calls','DMs & outreach'], plats:['LinkedIn','Email / SMS'] },
      paid: { skills:['Paid media','Design'], plats:['Facebook','Google (Search & Ads)','TikTok'] },
    };
    const leanChip = (t, on) => ({ t, bg: on ? 'oklch(0.94 0.03 225)' : 'oklch(0.955 0.006 90)', color: on ? 'oklch(0.35 0.08 240)' : 'oklch(0.5 0.03 260)' });
    const postures = ['brand','sales','paid'].map(k => { const d = postureDefs[k]; const on = S.obPostureSet.includes(k);
      const lean = postureLeans[k];
      const matches = lean.skills.filter(x => S.obStrengths.includes(x)).length + lean.plats.filter(x => S.obPlatforms.includes(x)).length;
      return {
      label:d.label, thesis:d.thesis, fit:d.fit, tag: on ? 'CURRENT PLAY' : 'ALTERNATIVE', selected:on,
      skillChips: lean.skills.map(t => leanChip(t, S.obStrengths.includes(t))),
      platChips: lean.plats.map(t => leanChip(t, S.obPlatforms.includes(t))),
      match: matches ? `Matches ${matches} of your picks` : 'Outside your current picks',
      border: on ? 'oklch(0.78 0.13 220)' : 'oklch(0.91 0.01 260)', shadow: on ? '0 2px 16px oklch(0.78 0.13 220 / 0.22)' : 'none',
      pick: () => this.setState(s => { const set = on ? s.obPostureSet.filter(x => x !== k) : [...s.obPostureSet, k]; if (!set.length) return {}; return { obPostureSet: set, posture: set[0] }; }) }; });
    const suggMap = {
      'brand.0':['Content performance learning','Keyword opportunity scan'],
      'brand.1':['Abandoned cart recovery','Campaign calendar prep'],
      'brand.2':['Creative test planner','Budget pacing guard'],
      'brand.3':['Follow-up cadence','Lead research & scoring'],
      'sales.0':['Pipeline hygiene','Customer-question mining'],
      'sales.1':['Campaign calendar prep','Welcome flow tuning'],
      'sales.2':['Winback campaign prep','Review request timing'],
      'sales.3':['Founder content engine','Keyword opportunity scan'],
      'paid.0':['Organic-to-paid promotion','Content gap analysis'],
      'paid.1':['Keyword opportunity scan','SERP position watch'],
      'paid.2':['Welcome flow tuning','Abandoned cart recovery'],
      'paid.3':['Founder content engine','Lead research & scoring'],
    };
    const rKey = i => `${S.posture}.${i}`;
    const phases = pd.phases.map((ph, pi) => {
      const active = ph.st === 'ACTIVE' || ph.st === 'NOW' || ph.st === 'WOULD ACTIVATE';
      const routines = S.routineEdits[rKey(pi)] ?? ph.routines;
      return { ...ph,
        border: ph.st === 'NOW' ? 'oklch(0.78 0.13 220 / 0.6)' : 'oklch(0.91 0.01 260)',
        nBg: active ? 'oklch(0.27 0.055 262)' : 'oklch(0.93 0.008 260)', nFg: active ? 'oklch(0.78 0.13 220)' : 'oklch(0.55 0.03 260)',
        stColor: active ? 'oklch(0.45 0.1 240)' : 'oklch(0.5 0.12 75)', stBg: active ? 'oklch(0.94 0.03 225)' : 'oklch(0.93 0.05 80)',
        pillBorder: ph.st === 'NOW' ? 'oklch(0.78 0.13 220 / 0.7)' : active ? 'oklch(0.42 0.06 250)' : 'oklch(0.36 0.05 262)',
        pillColor: ph.st === 'NOW' ? 'oklch(0.97 0.01 90)' : active ? 'oklch(0.85 0.03 250)' : 'oklch(0.6 0.05 250)',
        pillDot: ph.st === 'NOW' ? 'oklch(0.78 0.13 220)' : active ? 'oklch(0.6 0.08 235)' : 'oklch(0.45 0.05 260)',
        routines: routines.map(name => ({ name,
          open: () => { const s2 = this.allSystems.find(x => x.name === name); if (s2) openSys(s2); },
          remove: () => this.setState(s => ({ routineEdits: { ...s.routineEdits, [rKey(pi)]: routines.filter(x => x !== name) } })) })),
        hasSugg: (suggMap[rKey(pi)] || []).filter(n => !routines.includes(n)).length > 0,
        suggPreview: (suggMap[rKey(pi)] || []).filter(n => !routines.includes(n)).slice(0, 3).map(name => ({ name,
          open: () => { const s2 = this.allSystems.find(x => x.name === name); if (s2) openSys(s2); } })),
        addOpen: S.addOpen === rKey(pi),
        toggleAdd: () => this.setState(s => ({ addOpen: s.addOpen === rKey(pi) ? null : rKey(pi) })),
        suggestions: (suggMap[rKey(pi)] || []).filter(n => !routines.includes(n)).map(name => ({ name, add: () => this.setState(s => ({ routineEdits: { ...s.routineEdits, [rKey(pi)]: [...routines, name] }, addOpen: null })) })),
        count: routines.length,
        goRoutines: () => this.setState({ view:'systems', selCat:'All', sel:null }),
      };
    });
    const routineCount = phases.reduce((acc, ph) => acc + ph.routines.length, 0);
    const nowPhase = phases.find(p => p.st === 'NOW') || phases[0];
    const nextBestSugg = nowPhase.suggestions[0];
    const effConn = d => S.connState[d.name] || d.st;
    const connectors = this.connectorDefs.map(d => { const st = effConn(d); return { ...d, ok: st==='ok', expired: st==='expired', off: st==='off', connect: () => this.setState(s => ({ connState: { ...s.connState, [d.name]:'ok' } })) }; });
    const connSummary = `${connectors.filter(c=>c.ok).length} connected · ${connectors.filter(c=>c.expired).length} needs attention · ${connectors.filter(c=>c.off).length} available`;
    const wfDefs = sel ? [
      { tag:'TRIGGER', name:'Schedule', desc:sel.cadence, color:'oklch(0.5 0.12 75)', params:[['Cadence', sel.cadence],['Dedup key','tenant + goal + date']] },
      { tag:'READ', name:'Certified inputs', desc:'Shopify · GA4 · Meta', color:'oklch(0.55 0.11 235)', params:[['Sources','Shopify, GA4, Meta Ads'],['Freshness limit','60 min']] },
      { tag:'CHECK', name:'Validate & reconcile', desc:'Freshness · coverage · authority', color:'oklch(0.55 0.11 235)', params:[['Reconcile tolerance','±1.5%'],['On failure','block + incident']] },
      { tag:'DECIDE', name:'Skill decision', desc:'Bounded by guardrails', color:'oklch(0.45 0.1 240)', params:[['Skill version',`v${S.wfVer}`],['Bound',`≤ NZ$${Math.round(S.budgetMo / 30)}/day`],['KPI', sel.kpi]] },
      { tag:'GATE', name:'Approval', desc:'Named approver · Tom', color:'oklch(0.5 0.12 75)', params:[['Approver','Tom'],['Expiry','48 h'],['Auto-approve','never']] },
      { tag:'EXECUTE', name:'Execute + read back', desc:'Idempotent · rollback ready', color:'oklch(0.45 0.1 240)', params:[['Write mode','approval_gated'],['Rollback','prepared per action']] },
      { tag:'RECEIPT', name:'Receipt + learning', desc:'Reads · changes · learnings', color:'oklch(0.55 0.11 235)', params:[['Receipt','required'],['Measurement window','14 days']] },
    ] : [];
    const wfNodes = wfDefs.map((n, i) => ({ ...n, tagColor:n.color, hasNext: i < wfDefs.length - 1,
      border: i === S.nodeSel ? 'oklch(0.78 0.13 220)' : 'oklch(0.89 0.012 260)',
      shadow: i === S.nodeSel ? '0 2px 14px oklch(0.78 0.13 220 / 0.3)' : 'none',
      pick: () => this.setState({ nodeSel:i }) }));
    const inspNode = wfDefs[S.nodeSel] || wfDefs[0] || { tag:'', name:'', color:'', params:[] };
    const inspParams = inspNode.params.map(([k, dv]) => { const key = `${S.nodeSel}.${k}`; return { k, v: S.nodeVals[key] ?? dv, set: e => this.setState(s => ({ nodeVals: { ...s.nodeVals, [key]: e.target.value }, wfState:'draft' })) }; });
    const setupDefs = [
      { title:'Connect the sources this system reads', items:[['Shopify','ok'],['GA4','ok'],['Klaviyo — reconnect','warn']], note:'Least-privilege scopes only. Junction lists every scope before you approve the connection.', cta:'Sources look right' },
      { title:'Confirm your definitions', items:[['Currency · NZD','ok'],['Timezone · Pacific/Auckland','ok'],['Attribution · last non-direct','ok'],['Revenue · net of refunds','ok']], note:'These certify every number the system reads and reports.', cta:'Definitions confirmed' },
      { title:'What Junction needs from you', items:[['Owner · Tom','ok'],['3 examples in your voice','warn'],['Guardrail · ≤ 2 emails/wk','ok'],['Approval · every consequential action','ok']], note:'Your taste and first-person claims stay yours — Junction drafts, you approve.', cta:'Provided — keep going' },
      { title:'Dry run tonight', items:[['Zero recipients','ok'],['Full receipt','ok']], note:'Runs against live reads with zero outward actions. Results land in Home with the receipt before anything activates.', cta:'Start dry run' },
    ];
    const setupSteps = setupDefs.map((d, i) => { const done = i < S.setupStep, active = i === S.setupStep; return {
      title:d.title, note:d.note, cta:d.cta, active, line: i < 3, mark: done ? '✓' : String(i + 1),
      cBg: done ? 'oklch(0.78 0.13 220)' : active ? 'oklch(0.27 0.055 262)' : 'oklch(0.93 0.008 260)',
      cFg: done ? 'oklch(0.22 0.05 262)' : active ? 'oklch(0.78 0.13 220)' : 'oklch(0.55 0.03 260)',
      tColor: done || active ? 'oklch(0.27 0.05 262)' : 'oklch(0.58 0.02 260)',
      items: d.items.map(([t, st2]) => ({ t, border: st2==='ok' ? 'oklch(0.88 0.015 260)' : 'oklch(0.8 0.09 75)', color: st2==='ok' ? 'oklch(0.35 0.05 262)' : 'oklch(0.45 0.11 70)', bg: st2==='ok' ? 'white' : 'oklch(0.93 0.05 80)' })),
      next: () => i === 3 ? this.setState({ setupOpen:false, setupDone:true }) : this.setState({ setupStep: i + 1 }),
    }; });
    return {
      wfNodes, inspParams, inspTag: inspNode.tag, inspName: inspNode.name, inspColor: inspNode.color,
      wfVersion: S.wfState==='clean' ? `v${S.wfVer} · active` : S.wfState==='draft' ? `v${S.wfVer+1} · draft` : `v${S.wfVer+1} · validated`,
      wfVerColor: S.wfState==='draft' ? 'oklch(0.45 0.11 70)' : 'oklch(0.45 0.1 240)',
      wfVerBg: S.wfState==='draft' ? 'oklch(0.93 0.05 80)' : 'oklch(0.94 0.03 225)',
      wfDraft: S.wfState !== 'clean', wfCanValidate: S.wfState === 'draft', wfValidated: S.wfState === 'validated',
      wfDraftMsg: S.wfState === 'validated' ? 'Validation passed on demonstration data — promote when you\u2019re ready. The previous version stays available for rollback.' : `Edits create version v${S.wfVer + 1} (draft). Junction validates it against this system\u2019s acceptance tests before it can run in production.`,
      wfValidate: () => this.setState({ wfState:'validated' }),
      wfPromote: () => this.setState(s => ({ wfState:'clean', wfVer: s.wfVer + 1 })),
      setupIdle: !S.setupOpen && !S.setupDone, setupOn: S.setupOpen, setupDone: S.setupDone, setupSteps,
      setupProgress: `step ${Math.min(S.setupStep + 1, 4)} of 4 · dry-run before anything goes live`,
      openSetup: () => this.setState({ setupOpen:true, setupStep:0 }),
      isOnboarding: !S.onboarded, notOnboarding: S.onboarded,
      ob0: S.obStep===0, ob1: S.obStep===1, ob2: S.obStep===2, ob3: S.obStep===3, ob4: S.obStep===4, ob5: S.obStep===5, ob6: S.obStep===6,
      obMid: S.obStep >= 1 && S.obStep <= 5,
      obDots: [0,1,2,3,4,5,6].map(i => ({ w: i===S.obStep ? '26px' : '10px', bg: i<=S.obStep ? 'oklch(0.78 0.13 220)' : 'oklch(0.88 0.015 260)' })),
      obGoalCats: [['revenue','Revenue','NZ$40k MRR'],['profit','Profit','63% blended margin'],['brand','Brand','25k engaged followers'],['leads','Leads','40 qualified leads/mo'],['retention','Customer retention','22% repeat rate'],['launch','New product','enter AU by November']].map(([k, label, ex]) => { const on = S.obCats.includes(k); return { label, ex,
        border: on ? 'oklch(0.78 0.13 220)' : 'oklch(0.89 0.012 260)', bg: on ? 'oklch(0.94 0.03 225)' : 'white',
        toggle: () => this.setState(s => { const cats = on ? s.obCats.filter(x => x !== k) : [...s.obCats, k]; if (!cats.length) return {}; return { obCats: cats, goalTitle: s.goalTexts[cats[0]] }; }) }; }),
      obBaseline: S.baselineText, onObBaseline: e => this.setState({ baselineText: e.target.value }),
      obMetricLabel: ({ revenue:'Target MRR', profit:'Target margin %', brand:'Target followers', leads:'Target leads / mo', retention:'Target repeat %', launch:'Days to launch' })[S.obCats[0]] || 'Target',
      obIsMoney: S.obCats[0] === 'revenue' || S.obCats[0] === 'profit',
      obTargetNum: S.targetNum,
      onObTargetNum: e => { const v = +e.target.value || 0; this.setState(s => ({ targetNum: v, goalTexts: { ...s.goalTexts, [s.obCats[0]]: s.obCats[0] === 'revenue' ? `${s.currency === 'NZD' ? 'NZ$' : s.currency === 'USD' ? 'US$' : s.currency === 'AUD' ? 'A$' : s.currency === 'GBP' ? '£' : '€'}${v.toLocaleString()} MRR` : `${v}` }, goalTitle: s.obCats[0] === 'revenue' ? `${s.currency === 'NZD' ? 'NZ$' : s.currency === 'USD' ? 'US$' : s.currency === 'AUD' ? 'A$' : s.currency === 'GBP' ? '£' : '€'}${v.toLocaleString()} MRR` : s.goalTitle })); },
      obBaselineNum: S.baselineNum,
      onObBaselineNum: e => { const v = +e.target.value || 0; this.setState({ baselineNum: v, baselineText: `${v}` }); },
      obCurrencies: ['NZD','AUD','USD','GBP','EUR'].map(code => { const on = S.currency === code; return { code,
        border: on ? 'oklch(0.78 0.13 220)' : 'oklch(0.87 0.015 260)', bg: on ? 'oklch(0.94 0.03 225)' : 'white', color: on ? 'oklch(0.35 0.08 240)' : 'oklch(0.4 0.04 262)',
        pick: () => this.setState({ currency: code }) }; }),
      obGoalDefs: S.obCats.map((k, i) => ({ text: S.goalTexts[k],
        tag: i === 0 ? 'Governing' : 'Checkpoint', tagColor: i === 0 ? 'oklch(0.45 0.1 240)' : 'oklch(0.55 0.03 260)',
        set: e => this.setState(s => ({ goalTexts: { ...s.goalTexts, [k]: e.target.value }, ...(i === 0 ? { goalTitle: e.target.value } : {}) })) })),
      obLevers: (() => {
        const levers = { revenue:'traffic × conversion × repeat × price — I find which one is binding and work it first', profit:'margin mix, discount discipline, CAC efficiency, retention over acquisition', brand:'a consistent founder voice, doubling down on format winners, distribution cadence, community', leads:'ICP clarity, the channels that actually reach them, the offer, follow-up speed', retention:'lifecycle flows, post-purchase experience, winback timing, reviews', launch:'sequenced awareness, a waitlist engine, launch-week systems, PR moments' };
        const first = S.obCats[0];
        return `Main levers here: ${levers[first]}. I\u2019ll draft the strategy around them — you steer it at the end and any time after.${S.obCats.length > 1 ? ' Your other goals become checkpoints: the governing goal never gets to sacrifice them.' : ''}`;
      })(),
      obNext: () => this.setState(s => ({ obStep: Math.min(6, s.obStep+1) })),
      obBack: () => this.setState(s => ({ obStep: Math.max(0, s.obStep-1) })),
      obFinish: () => this.setState(s => ({ onboarded:true, view:'today',
        profile: { ...s.profile, belief: s.obPostureSet.map(k => ({ brand:'Brand before sales', sales:'Sales conversations first', paid:'Buy learning fast' })[k]).join(' + ') } })),
      obConns: this.connectorDefs.slice(0, 10).map(d => { const on = (S.connState[d.name] || d.st) === 'ok'; return {
        label: on ? `✓ ${d.name}` : d.name,
        border: on ? 'oklch(0.78 0.13 220)' : 'oklch(0.87 0.015 260)', bg: on ? 'oklch(0.94 0.03 225)' : 'white', color: on ? 'oklch(0.35 0.08 240)' : 'oklch(0.4 0.04 262)',
        toggle: () => this.setState(s => ({ connState: { ...s.connState, [d.name]: on ? 'off' : 'ok' } })) }; }),
      obConnCount: this.connectorDefs.filter(d => (S.connState[d.name] || d.st) === 'ok').length,
      obStrengthChips: ['Writing','Video','Design','Sales conversations','Cold calls','DMs & outreach','Email','Paid media','SEO','Community','Product'].map(t => { const on = S.obStrengths.includes(t); return { t,
        border: on ? 'oklch(0.78 0.13 220)' : 'oklch(0.87 0.015 260)', bg: on ? 'oklch(0.94 0.03 225)' : 'white', color: on ? 'oklch(0.35 0.08 240)' : 'oklch(0.4 0.04 262)',
        toggle: () => this.setState(s => ({ obStrengths: on ? s.obStrengths.filter(x => x !== t) : [...s.obStrengths, t], profile: { ...s.profile, strength: (on ? s.obStrengths.filter(x => x !== t) : [...s.obStrengths, t]).join(' & ') || 'Writing & product' } })) }; }),
      obPlatformChips: ['Instagram','TikTok','LinkedIn','Facebook','YouTube','X','Google (Search & Ads)','Bing','Pinterest','Reddit','Email / SMS','Other'].map(t => { const on = S.obPlatforms.includes(t); return { t,
        border: on ? 'oklch(0.78 0.13 220)' : 'oklch(0.87 0.015 260)', bg: on ? 'oklch(0.94 0.03 225)' : 'white', color: on ? 'oklch(0.35 0.08 240)' : 'oklch(0.4 0.04 262)',
        toggle: () => this.setState(s => ({ obPlatforms: on ? s.obPlatforms.filter(x => x !== t) : [...s.obPlatforms, t] })) }; }),
      obFocused: () => this.setState({ obBreadth:'focused' }), obBroad: () => this.setState({ obBreadth:'broad' }),
      focBorder: S.obBreadth==='focused' ? 'oklch(0.78 0.13 220)' : 'oklch(0.87 0.015 260)', focBg: S.obBreadth==='focused' ? 'oklch(0.94 0.03 225)' : 'white', focColor: S.obBreadth==='focused' ? 'oklch(0.35 0.08 240)' : 'oklch(0.4 0.04 262)',
      broBorder: S.obBreadth==='broad' ? 'oklch(0.78 0.13 220)' : 'oklch(0.87 0.015 260)', broBg: S.obBreadth==='broad' ? 'oklch(0.94 0.03 225)' : 'white', broColor: S.obBreadth==='broad' ? 'oklch(0.35 0.08 240)' : 'oklch(0.4 0.04 262)',
      obBudgetMo: S.budgetMo, obBudgetLabel: `${curSym}${S.budgetMo.toLocaleString('en-NZ')}/mo`, obBudgetDay: `${curSym}${Math.round(S.budgetMo / 30)}`,
      obBudgetMin: `${curSym}0`, obBudgetMax: `${curSym}20k/mo`,
      onObBudget: e => { const v = +e.target.value; this.setState(s => ({ budgetMo: v, profile: { ...s.profile, budget: `≤ ${curSym}${Math.round(v / 30)}/day` } })); },
      obHoursWk: S.hoursWk, obHoursLabel: `${S.hoursWk} h/wk`,
      obHoursNote: S.hoursWk < 4 ? 'Approvals only — I draft everything, you decide.' : S.hoursWk <= 10 ? 'Time spent on taste and approvals.' : S.hoursWk <= 40 ? 'Enough to own a channel yourself — I\u2019ll build the machine around it.' : 'A full-time growth push — I\u2019ll run like a whole department around you.',
      onObHours: e => { const v = +e.target.value; this.setState(s => ({ hoursWk: v, profile: { ...s.profile, time: `${v} h/wk` } })); },
      ...(() => {
        const st = S.obStrengths || [];
        const has = (...xs) => xs.some(x => st.includes(x));
        const dayBudget = Math.round(S.budgetMo / 30);
        const pw = { brand:{ Content:2.5, 'Email & SMS':1.3, SEO:1.1, 'Paid ads':0.8, Sales:0.6 },
                     sales:{ Sales:2.5, 'Email & SMS':1.2, Content:1, 'Paid ads':0.8, SEO:0.6 },
                     paid:{ 'Paid ads':2.5, Content:1.1, 'Email & SMS':1.2, SEO:0.7, Sales:0.7 } }[S.posture] || {};
        const chans = [
          { k:'Content', fit:(pw['Content']||1)*(has('Writing','Video','Design','Community')?2:1) },
          { k:'Sales', fit:(pw['Sales']||1)*(has('Cold calls','DMs & outreach')?2.5:0.6) },
          { k:'Paid ads', fit:(pw['Paid ads']||1)*(has('Paid media')?2:0.9)*(dayBudget>=50?1:0.3) },
          { k:'Email & SMS', fit:(pw['Email & SMS']||1)*1.2 },
          { k:'SEO', fit:(pw['SEO']||1)*(has('SEO')?1.8:0.7) },
        ].sort((a,b)=>b.fit-a.fit);
        const weeksLeft = Math.max(4, Math.round((new Date(S.deadline+'T00:00:00') - new Date('2026-09-01T00:00:00'))/6048e5));
        const w1 = Math.max(2, Math.round(weeksLeft*0.3));
        const w2end = Math.min(weeksLeft-1, w1 + Math.max(2, Math.round(weeksLeft*0.3)));
        const span = (a,b) => a>=b ? `Week ${a}` : `Weeks ${a}–${b}`;
        const rest = chans.slice(2).map(c=>c.k).join(' + ');
        const gapLeft = Math.max(0, target - cur);
        const reinvestPct = { steady:'25%', balanced:'40%', aggressive:'60%' }[S.reinvest];
        const hasPaid = chans.slice(0,2).some(c=>c.k==='Paid ads') || true;
        return {
          homePlain: onTrack
            ? `You need ${fmt(gapLeft)} more by the deadline. Right now you\u2019re on pace. Keep clearing your part below.`
            : `You need ${fmt(gapLeft)} more by the deadline. You\u2019re a little behind — the plan below closes the gap. Your part is below.`,
          homePlan: [
            { weeks:span(1,w1), title:`${chans[0].k} — your strength, running first`, focus:'Get the engine working. You: taste + okays.', on:true, st:'Now' },
            { weeks:span(w1+1,w2end), title:`Add ${chans[1].k.toLowerCase()}`, focus:'Turn momentum into revenue. You: a few okays a day.', on:false, st:'Next' },
            { weeks:`${span(w2end+1,weeksLeft)}+`, title:rest, focus:'Switch on as the numbers earn it.', on:false, st:'Later' },
          ].map(p => ({ ...p,
            border: p.on ? 'oklch(0.78 0.13 220 / 0.6)' : 'oklch(0.91 0.01 260)',
            weekColor: p.on ? 'oklch(0.45 0.1 240)' : 'oklch(0.6 0.02 260)',
            stColor: p.on ? 'oklch(0.45 0.1 240)' : 'oklch(0.55 0.03 260)',
            stBg: p.on ? 'oklch(0.94 0.03 225)' : 'oklch(0.945 0.008 260)' })),
          homeSetup: (() => {
            const okN = this.connectorDefs.filter(d => (S.connState[d.name] || d.st) === 'ok').length;
            const allOk = this.connectorDefs.every(d => (S.connState[d.name] || d.st) === 'ok');
            return [
              { title:'Platforms connected', done:allOk, action:`${okN} of ${this.connectorDefs.length} — connect more`, go:()=>this.setState({view:'connectors'}) },
              { title:'History imported', done:true, note:'orders, spend, sends — in one warehouse' },
              { title:'Site & socials scanned', done:true, note:'your voice, offers and market — read' },
              { title:'Numbers certified', done:false, note:'cross-checked against your sources nightly' },
            ].map(x => ({ ...x, mark: x.done ? '✓' : '·',
              hasAction: !!x.action, hasNote: !!x.note,
              border: x.done ? 'oklch(0.91 0.01 260)' : 'oklch(0.78 0.13 220 / 0.55)',
              mBg: x.done ? 'oklch(0.78 0.13 220)' : 'oklch(0.94 0.03 225)', mFg: x.done ? 'oklch(0.22 0.05 262)' : 'oklch(0.45 0.1 240)' }));
          })(),
          ...(() => {
            const isOn = n => S.routineOn[n] ?? (this.allSystems.find(x => x.name === n) || {}).state === 'Active';
            const onCount = this.allSystems.filter(s2 => isOn(s2.name)).length;
            const total = this.allSystems.length;
            const hrs = Math.round(onCount * 2.5);
            const pct = Math.round(onCount / total * 100);
            const rank = onCount >= 18 ? 'Fully OP' : onCount >= 12 ? 'Operator' : onCount >= 6 ? 'Builder' : 'Getting started';
            const withTeam = S.team.filter(p => (p.areas || []).length && p.name && p.name !== 'You').length;
            return {
              gamOnCount: onCount, gamTotal: total, gamHrs: hrs, gamPct: `${pct}%`, gamRank: rank,
              gamCats: this.categories.map(c => {
                const on = c.systems.filter(isOn).length;
                const full = on === c.systems.length;
                return { name: c.name,
                  dots: c.systems.map(n => ({ bg: isOn(n) ? 'oklch(0.72 0.17 150)' : 'oklch(0.92 0.008 260)' })),
                  sub: full ? 'Complete ✓' : `${on}/${c.systems.length} · ${c.systems.length - on} to unlock`,
                  subColor: full ? 'oklch(0.55 0.15 150)' : 'oklch(0.52 0.03 260)',
                  open: () => this.setState({ view:'systems', selCat:c.name, sel:null }) };
              }),
              gamHireLine: withTeam > 0
                ? `Your team covers ${withTeam} approval area${withTeam === 1 ? '' : 's'} — decisions there skip you entirely. Hand off the rest and the machine barely needs you.`
                : `Pro move: put a teammate in charge of an area\u2019s approvals (Strategy → team) and its decisions skip you entirely — that\u2019s another ~${Math.max(2, Math.round(hrs * 0.4))} h/week back.`,
            };
          })(),
          homeBar: [
            { what:'Content output', bar:'5 posts / week', proof:'What DTC brands at your target ship — you\u2019re at 3. I\u2019ll draft the extra two; you just okay them.', behind:true, fixLabel:'Queue 2 more drafts / week', fix:()=>this.setState({view:'systems', selCat:'Content', sel:null}) },
            { what:'Repeat purchase', bar:'22% of customers', proof:'The category norm at NZ$40k MRR — you\u2019re at 14%. Winback + welcome flows close most of this gap.', behind:true, fixLabel:'Switch on the flows', fix:()=>this.setState({view:'systems', selCat:'Email & SMS', sel:null}) },
            { what:'Response speed', bar:'< 4 h to leads', proof:'Businesses that hit goals like yours reply same-morning. You\u2019re already there.', behind:false },
          ].map(x => ({ ...x, status: x.behind ? 'Below the bar' : 'At the bar ✓', okColor: x.behind ? 'oklch(0.5 0.12 75)' : 'oklch(0.55 0.15 150)' })),
          homeAds: hasPaid,
          homeAdsLine: `Ad spend starts at ${curSym}${dayBudget}/day and only grows from wins: about ${reinvestPct} of new profit rolls back in, so the budget scales itself as the goal gets closer.`,
        };
      })(),
      obWebsite: S.website, onObWebsite: e => this.setState({ website: e.target.value }),
      obSocials: S.socials, onObSocials: e => this.setState({ socials: e.target.value }),
      obPlanShort: `Your goal needs ${fmt(Math.max(0, (S.targetNum - S.baselineNum)))} of new ground by ${new Date(S.deadline + 'T00:00:00').toLocaleDateString('en-NZ', { day:'numeric', month:'short' })}. With ${curSym}${Math.round(S.budgetMo/30)}/day and ${S.hoursWk} h/wk of you, here\u2019s the shortest path I can see:`,
      ...(() => {
        const st = S.obStrengths || [];
        const has = (...xs) => xs.some(x => st.includes(x));
        const dayBudget = Math.round(S.budgetMo / 30);
        // Score each channel: their stated belief (posture) leads, strengths double it, budget gates paid
        const pw = { brand:{ Content:2.5, 'Email & SMS':1.3, SEO:1.1, 'Paid ads':0.8, Sales:0.6 },
                     sales:{ Sales:2.5, 'Email & SMS':1.2, Content:1, 'Paid ads':0.8, SEO:0.6 },
                     paid:{ 'Paid ads':2.5, Content:1.1, 'Email & SMS':1.2, SEO:0.7, Sales:0.7 } }[S.posture] || {};
        const chans = [
          { k:'Content', fit: (pw['Content'] || 1) * (has('Writing','Video','Design','Community') ? 2 : 1), why:'organic compounds and costs hours, not dollars' },
          { k:'Sales', fit: (pw['Sales'] || 1) * (has('Cold calls','DMs & outreach') ? 2.5 : 0.6), why:'conversations are your highest-leverage hours' },
          { k:'Paid ads', fit: (pw['Paid ads'] || 1) * (has('Paid media') ? 2 : 0.9) * (dayBudget >= 50 ? 1 : 0.3), why:'you have budget to buy learning fast' },
          { k:'Email & SMS', fit: (pw['Email & SMS'] || 1) * 1.2, why:'the cheapest revenue is the customers you already have' },
          { k:'SEO', fit: (pw['SEO'] || 1) * (has('SEO') ? 1.8 : 0.7), why:'slow but compounding — plant it once the engine runs' },
        ].sort((a, b) => b.fit - a.fit);
        const first = chans[0], second = chans[1], rest = chans.slice(2).map(c => c.k).join(', ');
        const weeksLeft = Math.max(4, Math.round((new Date(S.deadline + 'T00:00:00') - new Date('2026-09-01T00:00:00')) / 6048e5));
        const w1 = Math.max(2, Math.round(weeksLeft * 0.3));
        const w2end = Math.min(weeksLeft - 1, w1 + Math.max(2, Math.round(weeksLeft * 0.3)));
        const span = (a, b) => a >= b ? `Week ${a}` : `Weeks ${a}–${b}`;
        return {
          obPlanStep1: `${span(1, w1)}: our world-class ${first.k.toLowerCase()} routines, built around what you do best. Focus: a working engine — drafts flowing, your taste applied, first wins on the board.`,
          obPlanStep2: `${span(w1 + 1, w2end)}: we add ${second.k.toLowerCase()} — ${second.why}. Focus: converting the momentum into revenue.`,
          obPlanStep3: `${span(w2end + 1, weeksLeft)} and beyond: ${rest} switch on as their numbers earn it. Focus: scaling what\u2019s proven, straight through your goal.`,
        };
      })(),
      obToggleMoney: () => this.setState(s => ({ obMoneyOpen: !s.obMoneyOpen })),
      obTeamOpen: S.obTeamOpen, obTeamChevron: S.obTeamOpen ? '▾' : '▸',
      obToggleTeam: () => this.setState(s => ({ obTeamOpen: !s.obTeamOpen })),
      obMargin: S.marginPct, obMarginLabel: `${S.marginPct}%`, onObMargin: e => this.setState({ marginPct: Math.max(0, Math.min(90, +e.target.value || 0)) }),
      obReinvest: [['steady','Steady','20–30%'],['balanced','Balanced','30–50%'],['aggressive','All-in','50–70%']].map(([k, label, pct]) => { const on = S.reinvest === k; return { label, pct,
        border: on ? 'oklch(0.78 0.13 220)' : 'oklch(0.87 0.015 260)', bg: on ? 'oklch(0.94 0.03 225)' : 'white',
        pick: () => this.setState({ reinvest: k }) }; }),
      obReinvestNote: ({ steady:'Keep most profit as cash — growth stays inside the base budget. Good when cash flow is tight.', balanced:'The sweet spot for most growing businesses — the budget above is the floor, and wins compound it.', aggressive:'Chasing speed — most new profit rolls straight back in. I\u2019ll flag it if cash cover drops below 3 months.' })[S.reinvest],
      obTeam: S.team.map((p, i) => ({ name: p.name, role: p.role,
        areas: ['Content','Paid ads','SEO','Sales','Email & SMS'].map(t => { const on = (p.areas || []).includes(t); return { t,
          border: on ? 'oklch(0.78 0.13 220)' : 'oklch(0.89 0.012 260)', bg: on ? 'oklch(0.94 0.03 225)' : 'white', color: on ? 'oklch(0.35 0.08 240)' : 'oklch(0.5 0.03 260)',
          toggle: () => this.setState(s => ({ team: s.team.map((x, j) => j === i ? { ...x, areas: on ? (x.areas || []).filter(a => a !== t) : [...(x.areas || []), t] } : x) })) }; }),
        setName: e => this.setState(s => ({ team: s.team.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })),
        setRole: e => this.setState(s => ({ team: s.team.map((x, j) => j === i ? { ...x, role: e.target.value } : x) })),
        remove: () => this.setState(s => ({ team: s.team.length > 1 ? s.team.filter((x, j) => j !== i) : s.team })) })),
      obAddPerson: () => this.setState(s => ({ team: [...s.team, { name:'', role:'Marketing', areas:[] }] })),
      obVolume: (() => {
        const plats = S.obBreadth === 'broad' ? Math.max(3, S.obPlatforms.length) : Math.min(2, Math.max(1, S.obPlatforms.length));
        const posts = Math.max(3, Math.min(14, Math.round(S.hoursWk * 1.5)));
        const day = Math.round(S.budgetMo / 30);
        if (S.posture === 'sales') return `Doing the maths on your goal: I\u2019d aim for roughly ${Math.max(10, S.hoursWk * 4)} researched leads a week, with ${Math.max(2, Math.round(S.hoursWk / 2))} hours of your conversations booked against them. Later I\u2019d expect us to add content and email behind the pipeline.`;
        if (S.posture === 'paid') return `Doing the maths on your budget: NZ$${day}/day supports about ${Math.max(2, Math.round(S.budgetMo / 900))} creative tests a month \u2014 enough to find winners without burning the budget on guesses. Later I\u2019d expect us to add landing-page tests and email behind the ads.`;
        return `Doing the maths on your goal and hours: I\u2019d aim for about ${posts} posts a week across ${plats} platform${plats > 1 ? 's' : ''} \u2014 I draft from real customer questions, you give it your voice. Later I\u2019d expect us to add email and reviews behind the content.`;
      })(),
      obSummaryTitle: `${S.obPostureSet.map(k => postureDefs[k].label).join(' + ')}, ${S.obBreadth === 'broad' ? 'run broad across channels' : 'focused where you\u2019re strongest'}`,
      obSummaryBody: `You want ${S.goalTitle || 'to grow'}. With your budget, your ${S.profile.time}, and what you\u2019re good at (${S.obStrengths.slice(0, 3).join(', ').toLowerCase() || 'writing'}), that\u2019s the way I\u2019d grow you. I do the day-to-day work; you okay the things that matter.`,
      obStrengthSummary: S.obStrengths.slice(0, 3).join(' · ') || 'Writing · Product',
      obPaceChips: ['Sprint · 2 weeks','Steady · 4 weeks','Gentle · 8 weeks'].map(t => { const on = S.obPace === t; return { t,
        border: on ? 'oklch(0.78 0.13 220)' : 'oklch(0.4 0.06 250)', bg: on ? 'oklch(0.78 0.13 220)' : 'transparent', color: on ? 'oklch(0.22 0.05 262)' : 'oklch(0.85 0.03 250)',
        pick: () => this.setState({ obPace: t }) }; }),
      obPaceLine: `${S.obPace.split(' · ')[1]} it is — I\u2019ll only ever ask for a few minutes of your day, and I handle the rest.`,
      obThreadMsgs: S.obThread.map(m => ({ text: m.text, fromUser: m.from === 'u', fromJ: m.from === 'j' })),
      obDraft: S.obDraft, onObDraft: e => this.setState({ obDraft: e.target.value }),
      obSend: () => { const t = S.obDraft.trim(); if (!t) return; this.setState(s => ({ obDraft:'', obThread: [...s.obThread, { from:'u', text:t }, { from:'j', text:'Good push — folded into the draft. You\u2019ll see it reflected in Strategy, and we keep reshaping it there as the data comes in.' }] })); },
      onObKey: e => { if (e.key === 'Enter') { const t = S.obDraft.trim(); if (!t) return; this.setState(s => ({ obDraft:'', obThread: [...s.obThread, { from:'u', text:t }, { from:'j', text:'Good push — folded into the draft. You\u2019ll see it reflected in Strategy, and we keep reshaping it there as the data comes in.' }] })); } },
      isToday: S.onboarded && S.view==='today', isSystems: S.view==='systems', isConnectors: S.view==='connectors',
      goToday:nav('today'), goSystems:nav('systems'), goConnectors:nav('connectors'), goTalk:toggleChat,
      todayBg: S.view==='today'?activeBg:'transparent', systemsBg: S.view==='systems'?activeBg:'transparent',
      connectorsBg: S.view==='connectors'?activeBg:'transparent',
      todayDot: S.view==='today'?cyan:dim, systemsDot: S.view==='systems'?cyan:dim,
      connectorsDot: S.view==='connectors'?cyan:dim,
      toggleChat, chatOpen: S.chatOpen,
      chatIsAI: S.chatMode === 'ai', chatIsHuman: S.chatMode === 'human',
      chatTitle: S.chatMode === 'ai' ? 'Junction' : 'Human support',
      chatSub: S.chatMode === 'ai' ? 'In your corner · knows your numbers' : 'Real people who know your setup · reply within hours',
      chatPlaceholder: S.chatMode === 'ai' ? 'Ask for work, a change, an explanation…' : 'Ask Sam anything — strategy, setup, a second opinion…',
      modeAI: () => this.setState({ chatMode:'ai' }), modeHuman: () => this.setState({ chatMode:'human' }),
      aiBg: S.chatMode === 'ai' ? 'oklch(0.78 0.13 220)' : 'transparent', aiFg: S.chatMode === 'ai' ? 'oklch(0.22 0.05 262)' : 'oklch(0.72 0.06 235)',
      huBg: S.chatMode === 'human' ? 'oklch(0.78 0.13 220)' : 'transparent', huFg: S.chatMode === 'human' ? 'oklch(0.22 0.05 262)' : 'oklch(0.72 0.06 235)',
      chatMsgs: (S.chatMode === 'ai' ? S.messages : S.humanThread).map(m => ({ text:m.text, fromUser:m.from === 'u', fromJunction:m.from !== 'u',
        link: !!m.link, linkLabel: m.linkLabel,
        linkGo: () => { const s2 = this.allSystems.find(x => x.id === m.link); if (s2) openSys(s2); } })),
      connectors, connSummary,
      isStrategy: S.view==='strategy', goStrategy: nav('strategy'),
      strategyBg: S.view==='strategy'?activeBg:'transparent', strategyDot: S.view==='strategy'?cyan:dim,
      postures, phases, postureName: pd.label,
      postureWhy: `${pd.why} Right now that\u2019s shaped by ${S.profile.budget} for paid, ${S.profile.time} of your time, and your strengths: ${(S.obStrengths.join(', ') || 'writing, product').toLowerCase()}.`,
      simpleRead: (() => {
        const idx = phases.indexOf(nowPhase) + 1;
        const play = S.obPostureSet.map(k => postureDefs[k].label).join(' + ').toLowerCase();
        const needsN = S.apStatus.filter(x => x === 'pending').length + ((S.connState['Klaviyo'] || 'expired') !== 'ok' ? 1 : 0);
        const needs = needsN === 0 ? 'nothing is waiting on you right now' : `it needs ${needsN === 1 ? 'one thing' : `${needsN} things`} only you can do, waiting below`;
        return onTrack
          ? `On pace for ${fmt(target)} — ${nowPhase.name.toLowerCase()} is carrying it. This week ${needs}. Running ${routineCount} of ${this.allSystems.length} core routines — room to expand when you\u2019re ready.`
          : `You\u2019re in ${nowPhase.name.toLowerCase()} — phase ${idx} of your ${play} plan. At today\u2019s pace you land ${fmt(gap)} short of ${fmt(target)}. The plan closes that, but this week ${needs}. Running ${routineCount} of ${this.allSystems.length} core routines; expand or revisit the strategy any time.`;
      })(),
      scrollToNeeds: () => { const el = document.querySelector('[data-buddy^="Only you"]'); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 70, behavior:'smooth' }); },
      routineCount, libTotal: this.allSystems.length, nextBest: nextBestSugg ? nextBestSugg.name : 'Abandoned cart recovery',
      addNextBest: () => { if (nextBestSugg) nextBestSugg.add(); },
      profBudget: S.profile.budget, onProfBudget: e => this.setState(s => ({ profile: { ...s.profile, budget: e.target.value } })),
      profTime: S.profile.time, onProfTime: e => this.setState(s => ({ profile: { ...s.profile, time: e.target.value } })),
      profStrength: S.profile.strength, onProfStrength: e => this.setState(s => ({ profile: { ...s.profile, strength: e.target.value } })),
      profBelief: S.profile.belief, onProfBelief: e => this.setState(s => ({ profile: { ...s.profile, belief: e.target.value } })),
      readThread: S.readThread.map(m => ({ text:m.text, fromUser:m.from==='u', fromJ:m.from==='j' })),
      readDraft: S.readDraft, onReadDraft: e => this.setState({ readDraft: e.target.value }),
      readChips: [
        ['Challenge this read', 'Fair. The organic-first call rests on two numbers: CVR 3.1% and NZ$54/day headroom. If you think paid can beat 2.5\u00d7 now, I\u2019ll stage a NZ$20/day probe behind an approval and we\u2019ll let the data argue.'],
        ['Budget changed', 'Tell me the new number and I\u2019ll re-rank the paths tonight — more headroom pulls paid forward; less makes retention and CRO carry more.'],
        ['I have more time this week', 'Then I\u2019ll queue the two moves that need your voice — welcome-flow copy and one founder post — and hold the rest. That\u2019s the highest-leverage use of your hours.'],
      ].map(([t, reply]) => ({ t, send: () => this.setState(s => ({ readThread: [...s.readThread, { from:'u', text:t }, { from:'j', text:reply }] })) })),
      klaviyoDown: (S.connState['Klaviyo'] || 'expired') !== 'ok',
      klaviyoOk: (S.connState['Klaviyo'] || 'expired') === 'ok',
      fixKlaviyo: () => this.setState(s => ({ connState: { ...s.connState, Klaviyo: 'ok' } })),
      readSend: () => { const t = S.readDraft.trim(); if (!t) return; this.setState(s => ({ readDraft:'', readThread: [...s.readThread, { from:'u', text:t }, { from:'j', text:'Noted — logged against today\u2019s read and weighted into tomorrow\u2019s. If it changes the ranking, the plan adjusts and you\u2019ll see exactly why.' }] })); },
      onReadKey: e => { if (e.key === 'Enter') { const t = S.readDraft.trim(); if (!t) return; this.setState(s => ({ readDraft:'', readThread: [...s.readThread, { from:'u', text:t }, { from:'j', text:'Noted — logged against today\u2019s read and weighted into tomorrow\u2019s. If it changes the ranking, the plan adjusts and you\u2019ll see exactly why.' }] })); } },
      goalTitle: S.goalTitle, onGoalTitle: e => this.setState({ goalTitle: e.target.value }),
      deadline: S.deadline, onDeadline: e => this.setState({ deadline: e.target.value || S.deadline }),
      daysLeft: daysLeftN, daysLeftLabel: `${daysLeftN} day${daysLeftN === 1 ? '' : 's'}`,
      needsCount: S.apStatus.filter(x => x === 'pending').length + ((S.connState['Klaviyo'] || 'expired') !== 'ok' ? 1 : 0),
      allClear: S.apStatus.filter(x => x === 'pending').length + ((S.connState['Klaviyo'] || 'expired') !== 'ok' ? 1 : 0) === 0,
      nowFmt: fmt(cur), paceFmt: fmt(pace), neededFmt: fmt(needed), projFmt: fmt(proj),
      neededColor: needed > pace ? 'oklch(0.5 0.12 75)' : 'oklch(0.27 0.05 262)',
      statusLabel: onTrack ? 'On track' : `Behind by ${fmt(gap)}`,
      statusColor: onTrack ? 'oklch(0.45 0.1 240)' : 'oklch(0.5 0.12 75)',
      statusBg: onTrack ? 'oklch(0.94 0.03 225)' : 'oklch(0.93 0.05 80)',
      strategicRead: `At ${fmt(pace)}/day you land at ${fmt(proj)}${onTrack ? ' \u2014 clear of the goal. Hold the line and bank the learning.' : ` \u2014 ${fmt(gap)} short.`} I weighed 14 moves against your NZ$54/day budget headroom. Your site already converts ahead of industry and reels are compounding, so traffic isn\u2019t the constraint \u2014 repeat purchase is (14% vs a 22% norm). Retention closes the gap organically, for free. Paid could buy it faster, but it burns headroom retention gives us for nothing \u2014 it\u2019s queued for when repeat crosses 18%.`,
      signals: [
        { label:'Budget headroom', value:'NZ$54/day', delta:'of NZ$120 guardrail', deltaColor:'oklch(0.62 0.05 250)' },
        { label:'Site CVR', value:'3.1%', delta:'industry 2.8% \u00b7 ahead', deltaColor:'oklch(0.78 0.13 220)' },
        { label:'Social views', value:'48.2k/wk', delta:'\u25b2 22% \u00b7 reels working', deltaColor:'oklch(0.78 0.13 220)' },
        { label:'Email revenue', value:'9% of total', delta:'industry 22% \u00b7 your gap', deltaColor:'oklch(0.75 0.14 75)' },
      ],
      levers: [
        { name:'Retention: winback + welcome', impact:'+NZ$2,900/mo', cost:'NZ$0 \u2014 organic', conf:'HIGH \u00b7 DOING FIRST', confColor:'oklch(0.78 0.13 220)', bg:'oklch(0.32 0.06 262)', border:'oklch(0.78 0.13 220 / 0.55)' },
        { name:'Scale organic content', impact:'+NZ$1,400/mo', cost:'NZ$0 \u2014 2h/wk of your voice', conf:'MEDIUM \u00b7 RUNNING', confColor:'oklch(0.75 0.04 250)', bg:'transparent', border:'oklch(0.38 0.05 262)' },
        { name:'CRO: PDP 3.1% \u2192 3.6%', impact:'+NZ$1,100/mo', cost:'NZ$0 \u2014 test staged', conf:'MEDIUM \u00b7 QUEUED', confColor:'oklch(0.75 0.04 250)', bg:'transparent', border:'oklch(0.38 0.05 262)' },
        { name:'Scale paid +NZ$38/day', impact:'+NZ$3,300/mo', cost:'burns 70% of headroom', conf:'HOLD \u00b7 UNTIL REPEAT \u2265 18%', confColor:'oklch(0.75 0.14 75)', bg:'transparent', border:'oklch(0.38 0.05 262)' },
      ],
      focus: ['D05-W03', 'D05-W01', 'D05-W04'].map(id => { const s = this.allSystems.find(x => x.id === id); return { name: s.name, open: () => openSys(s) }; }),
      showBuddy: S.onboarded,
      buddyText: S.buddyText, hasBuddyText: !!S.buddyText && !S.chatOpen,
      proposals: [
        { id:'D05-W01', name:'Welcome flow tuning', why:'Your welcome flow converts 2.1%; tuned flows in your category do 6%+. Sequence drafted from your top customer questions.' },
        { id:'D05-W06', name:'Review request timing', why:'Reviews lift repeat purchase ~9% in your category. Trigger drafted: 12 days post-delivery, suppressed for open tickets.' },
        { id:'D06-W02', name:'PDP conversion review', why:'The free CRO path. A/B test staged on your top 3 products — copy from real support language.' },
      ].map((p, i) => ({ ...p,
        ready: S.propStatus[i] === 'ready', blocked: S.propStatus[i] === 'blocked', building: S.propStatus[i] === 'building',
        turnOn: () => this.setState(s => ({ propStatus: s.propStatus.map((x, j) => j === i ? 'building' : x) })),
      })),
      goalPct: `${Math.max(0, Math.min(100, Math.round((cur - baseline) / (target - baseline) * 100)))}%`,
      approvals, pendingCount: S.apStatus.filter(x => x==='pending').length,
      completed: [
        { text:'Weekly operating brief delivered — three priorities set against the repeat-purchase constraint', receipt:'Receipt R-4482' },
        { text:'4 founder posts drafted from customer questions, staged for approval', receipt:'Receipt R-4483' },
        { text:'18 leads researched and scored against ICP, 6 qualified for review', receipt:'Receipt R-4485' },
      ],
      catChips, visibleSystems, noSel:!sel, hasSel:!!sel,
      catAll: S.selCat === 'All', catOne: S.selCat !== 'All',
      catCards: this.categories.map(c => { const onN = c.systems.filter(n => S.routineOn[n] ?? (this.allSystems.find(x => x.name === n) || {}).state === 'Active').length; return {
        name: c.name, tagline: this.catTaglines[c.name] || '', onLabel: `${onN} of ${c.systems.length} on`,
        open: () => this.setState({ selCat: c.name }) }; }),
      backToCats: () => this.setState({ selCat:'All' }),
      selCatName: S.selCat, selCatTag: this.catTaglines[S.selCat] || '',
      channelRows: (S.selCat === 'All' ? [] : this.allSystems.filter(s2 => s2.cat === S.selCat)).map(s2 => { const on = S.routineOn[s2.name] ?? s2.state === 'Active'; return {
        benefit: s2.benefit, name: s2.name, saves: 2 + (s2.id.charCodeAt(5) % 3),
        togBg: on ? 'oklch(0.72 0.17 150)' : 'oklch(0.88 0.015 260)', knobLeft: on ? '19.5px' : '2.5px',
        toggle: () => this.setState(st => ({ routineOn: { ...st.routineOn, [s2.name]: !on } })),
        how: () => openSys(s2) }; }),
      selId:sel?.id, selCat:sel?.cat, selName:sel?.name, selPurpose:sel?.purpose, selCadence:sel?.cadence,
      selMode:sel?.mode, selKpi:sel?.kpi, selState:sel?.state, selStateColor:selState[0], selStateBg:selState[1],
      selSteps, closeSys: () => this.setState({ sel:null }),
      messages:msgs, draft:S.draft, send,
      onDraft: e => this.setState({ draft:e.target.value }),
      onKey: e => { if (e.key==='Enter') send(); },
    };
  }
}
