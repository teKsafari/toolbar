import { chromium } from '/home/dev/toolbar/node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
const S='http://localhost:3000';
const VIDEO='01a14061-b560-7dfd-854c-0eb3780c451c', SHOT='01a1401b-188c-72cc-ad78-3fb54c9ca37e';
const b = await chromium.launch({ headless:false, env:{...process.env, DISPLAY:':161'} });
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
async function login(ctx){const p=await ctx.newPage();await p.goto(S+'/login');await p.waitForLoadState('networkidle');
if(!(await p.getByLabel('Password').isVisible().catch(()=>false)))await p.getByRole('button',{name:'Use a password instead'}).click();
await p.getByLabel('Work email').fill('parity@example.com');await p.getByLabel('Password').fill('nib parity password');
await p.getByRole('button',{name:'Continue',exact:true}).click();await p.waitForURL(u=>!u.pathname.startsWith('/login'));await p.close();}
const scan = (p) => p.evaluate(() => {
  const parse=(c)=>{const m=c.match(/[\d.]+/g)?.map(Number)??[0,0,0,0];return [m[0],m[1],m[2],m.length>3?m[3]:1];};
  const L=([r,g,b])=>{const f=(v)=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b)};
  const bgOf=(el)=>{const layers=[];for(let e=el;e;e=e.parentElement){const c=parse(getComputedStyle(e).backgroundColor);if(c[3]>0){layers.push(c);if(c[3]>=1)break;}}
    let base=[255,255,255];if(!layers.length||layers[layers.length-1][3]<1){base=parse(getComputedStyle(document.body).backgroundColor);}
    for(let i=layers.length-1;i>=0;i--){const [r,g,b,a]=layers[i];base=[r*a+base[0]*(1-a),g*a+base[1]*(1-a),b*a+base[2]*(1-a)];}return base;};
  const out=[];const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  let n;while((n=w.nextNode())){const t=n.textContent.trim();if(!t)continue;const el=n.parentElement;const cs=getComputedStyle(el);
    if(cs.visibility==='hidden'||+cs.opacity===0)continue;const r=el.getBoundingClientRect();if(!r.width||!r.height||r.bottom<0||r.top>innerHeight)continue;
    if(el.closest('video,canvas,img,[aria-hidden=true]'))continue;
    const fg=parse(cs.color);const bg=bgOf(el);const f=[fg[0]*fg[3]+bg[0]*(1-fg[3]),fg[1]*fg[3]+bg[1]*(1-fg[3]),fg[2]*fg[3]+bg[2]*(1-fg[3])];
    const a=L(f),c=L(bg);const ratio=(Math.max(a,c)+0.05)/(Math.min(a,c)+0.05);out.push({t:t.slice(0,30),ratio:Math.round(ratio*100)/100});}
  out.sort((x,y)=>x.ratio-y.ratio);
  return {min:out[0]?.ratio, under3:out.filter(o=>o.ratio<3).slice(0,6), n:out.length, overflow:document.documentElement.scrollWidth-innerWidth, bg:getComputedStyle(document.body).backgroundColor};
});
const res={};
let shareUrl;
for (const w of [1440,390]) for (const theme of ['light','dark']) {
  const k=`${w}-${theme}`;
  const ctx=await b.newContext({viewport:{width:w,height:w===390?844:900},colorScheme:theme});
  await login(ctx);
  const p=await ctx.newPage();
  await p.goto(`${S}/c/${VIDEO}`);await p.waitForLoadState('networkidle').catch(()=>{});await sleep(1500);
  res[`J-090 capture ${k}`]=await scan(p); await p.screenshot({path:`d-cap-${k}.png`});
  // share popover
  const caret = p.getByRole('button',{name:/share options|more share|copy link options/i}).first();
  const carets = await p.locator('header button[aria-haspopup], header button[aria-expanded]').all();
  let opened=false;
  for (const c of carets){ const lab=(await c.getAttribute('aria-label'))??''; if(/share|link/i.test(lab)){await c.click();opened=true;break;} }
  if(!opened && await caret.count()){await caret.click();opened=true;}
  await sleep(600);
  res[`J-118 popover ${k}`]={opened,...await scan(p)}; await p.screenshot({path:`d-pop-${k}.png`});
  await p.keyboard.press('Escape');
  // screenshot lightbox
  await p.goto(`${S}/c/${SHOT}`);await p.waitForLoadState('networkidle').catch(()=>{});await sleep(1200);
  const img=p.locator('main img').first();
  if(await img.count()){await img.click().catch(()=>{});await sleep(700);}
  res[`J-099 lightbox ${k}`]={dialog:await p.locator('[role=dialog]').count(),...await scan(p)}; await p.screenshot({path:`d-lb-${k}.png`});
  await p.keyboard.press('Escape');
  // members
  await p.goto(`${S}/settings/members`);await p.waitForLoadState('networkidle').catch(()=>{});await sleep(800);
  res[`J-124/J-173 members ${k}`]=await scan(p); await p.screenshot({path:`d-mem-${k}.png`});
  // paused settings pages
  for (const pg of ['audit','integrations','cli']){const r=await p.goto(`${S}/settings/${pg}`);res[`paused /settings/${pg} ${k}`]={status:r.status(),url:p.url()};}
  if(!shareUrl){const r=await ctx.request.post(`${S}/api/v1/recordings/${VIDEO}/share-links`,{headers:{origin:S,'content-type':'application/json'},data:'{}'});const j=await r.json();shareUrl=j.url??j.link?.url;res.share={status:r.status(),keys:Object.keys(j)};}
  await ctx.close();
  // signed out share page
  const so=await b.newContext({viewport:{width:w,height:w===390?844:900},colorScheme:theme});
  const q=await so.newPage(); if(shareUrl){await q.goto(shareUrl);await q.waitForLoadState('networkidle').catch(()=>{});await sleep(1500);
  res[`J-121 signed-out ${k}`]=await scan(q); await q.screenshot({path:`d-so-${k}.png`});
  if(w===390 && await q.getByTestId('narrow-devtools').isVisible().catch(()=>false)) await q.getByTestId('narrow-devtools').click();
  for(const t of ['console','network']){await q.getByTestId(`tab-${t}`).click().catch(()=>{});await sleep(400);res[`J-121 signed-out ${t} ${k}`]=await scan(q);}
  }
  await so.close();
}
fs.writeFileSync('dark.json',JSON.stringify({shareUrl:!!shareUrl,res},null,2));
await b.close();
