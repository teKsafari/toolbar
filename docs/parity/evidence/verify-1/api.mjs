import { chromium } from '/home/dev/toolbar/node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core/index.mjs';
const S='http://localhost:3000';
const b = await chromium.launch({ headless:false, env:{...process.env, DISPLAY:':161'} });
const ctx = await b.newContext({ viewport:{width:1440,height:900} });
const p = await ctx.newPage(); await p.goto(S+'/login'); await p.waitForLoadState('networkidle');
if (!(await p.getByLabel('Password').isVisible().catch(()=>false))) await p.getByRole('button',{name:'Use a password instead'}).click();
await p.getByLabel('Work email').fill('parity@example.com'); await p.getByLabel('Password').fill('nib parity password');
await p.getByRole('button',{name:'Continue',exact:true}).click(); await p.waitForURL(u=>!u.pathname.startsWith('/login'));
await p.goto(S+'/settings/api'); await p.waitForLoadState('networkidle');
const rows = await p.locator('tr[data-route]').evaluateAll(trs=>trs.map(t=>t.dataset.route+' | '+t.innerText.replace(/\s+/g,' ')));
console.log('ROWS', rows.length);
for (const r of rows) if (/ai|audit|integrat|send|tracker|slack|linked|issue|mail|share|invite|retention|cli/i.test(r)) console.log('  ', r);
const req = ctx.request;
const idx = await (await req.get(S+'/api/v1', {headers:{origin:S}})).json();
const list = JSON.stringify(idx);
console.log('INDEX has audit', /audit/.test(list), 'ai-draft', /ai-draft/.test(list), 'integrations', /integrations/.test(list), 'send', /\/send/.test(list));
const ws = '01a13d46-2930-77af-a501-80d6ef19574c';
const wss = await (await req.get(S+'/api/v1/workspaces',{headers:{origin:S}})).json();
console.log('WS', JSON.stringify(wss).slice(0,300));
for (const [m,u] of [['GET',`/api/v1/workspaces/${ws}/audit`],['POST','/api/v1/recordings/01a14061-b560-7dfd-854c-0eb3780c451c/ai-draft'],['GET',`/api/v1/workspaces/00000000-0000-0000-0000-000000000000/audit`]]) {
  const r = await req.fetch(S+u,{method:m,headers:{origin:S,'content-type':'application/json'},data:m==='POST'?'{}':undefined});
  console.log(m,u,r.status(), (await r.text()).slice(0,200));
}
const r2 = await fetch(S+`/api/v1/workspaces/${ws}/audit`); console.log('anon audit', r2.status, (await r2.text()).slice(0,150));
await b.close();
