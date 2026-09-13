const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || fs.readFileSync('.env.local', 'utf8').match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m)?.[1].trim();
const storageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
const org = '11111111-1111-4111-8111-111111111111', userId = '22222222-2222-4222-8222-222222222222', serviceId = '33333333-3333-4333-8333-333333333333';
const user = { id: userId, email: 'owner@example.invalid', email_confirmed_at: new Date().toISOString(), aud: 'authenticated', app_metadata: {}, user_metadata: {} };
const session = { access_token: 'test-token', refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, user };
const service = { id: serviceId, name: 'Sunday service', type: 'services', status: 'active' };
const code = { id: 'code', name: 'Lobby', default_service_category_id: serviceId, expires_on: null, status: 'active', public_url: 'http://localhost:3000/check-in/test', attendance_checkin_windows: [], schedule: null };
const upcoming = [{ date: '2030-01-06', service_at: '2030-01-06T10:00:00Z', opens_at: '2030-01-06T09:30:00Z', closes_at: '2030-01-06T11:30:00Z', skipped: false }];
const json = (route, data, status=200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
let browser, currentPage;
(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 640 } });
  await context.addInitScript(({storageKey,session,org}) => { localStorage.setItem(storageKey,JSON.stringify(session)); localStorage.setItem('active_org_id',org); localStorage.setItem('active_org_role','owner'); }, {storageKey,session,org});
  let failSave = true, publicOpen = false, failedCheckin = true;
  const errors=[];
  await context.route('**/*', async route => {
    const request=route.request(), target=new URL(request.url());
    if(target.hostname.endsWith('.supabase.co')) {
      if(target.pathname.includes('/auth/')) return json(route,{user});
      if(target.pathname.endsWith('/organizations')) return json(route,{name:'Grace Church'});
      if(target.pathname.endsWith('/organization_settings')) return json(route,{timezone_name:'UTC',timezone_confirmed:true,use_default_logo:true});
      if(target.pathname.endsWith('/categories')) return json(route,[service]);
      if(target.pathname.endsWith('/user_organizations')) return json(route,{role:'owner',organization_id:org,user_id:userId});
      return json(route,[]);
    }
    if(target.origin!=='http://localhost:3000') return route.abort();
    if(target.pathname==='/api/attendance/check-in-codes') return json(route,{codes:[code],timezone:{timezone_name:'UTC',timezone_confirmed:true}});
    if(target.pathname.endsWith('/code/schedule')) {
      const body=request.postDataJSON();
      if(request.method()==='PUT') {
        if(failSave){failSave=false;return json(route,{error:'Schedule save interrupted. Try again.'},503);}
        code.schedule={...body,timezone_name:'UTC',paused:false,last_error:null,upcoming};
      } else if(body.action==='skip') code.schedule.upcoming[0].skipped=true;
      else code.schedule.paused=body.action==='pause';
      return json(route,{ok:true});
    }
    if(target.pathname==='/api/attendance/public/test') return json(route,{organization:{name:'Grace Church',logo_url:null},qr_name:'Lobby',service_name:'Sunday service',session_date:'2030-01-06',timezone:'UTC',window:upcoming[0],status:publicOpen?'open':'scheduled',remembered_profiles:[{id:'profile',label:'Test Member'}]});
    if(target.pathname.endsWith('/remembered-checkin')) {
      if(failedCheckin){failedCheckin=false;return json(route,{error:'Connection interrupted. Try again.'},503);}
      return json(route,{state:'linked'});
    }
    if(target.pathname.startsWith('/api/')) return json(route,{error:'Unmocked test endpoint'},503);
    return route.continue();
  });
  const page=await context.newPage(); currentPage=page; page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://localhost:3000/app/attendance');
  await page.getByRole('button',{name:'QR Check-in',exact:true}).click();
  await page.getByRole('button',{name:'Repeat automatically',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Starting on',{exact:true}).fill('2030-01-01');
  await dialog.getByLabel('Repeat every',{exact:true}).selectOption('2');
  await dialog.getByRole('button',{name:'Save recurring schedule'}).scrollIntoViewIfNeeded();
  assert(await dialog.evaluate(el=>el.scrollHeight>el.clientHeight),'The mobile editor should scroll');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
  fs.mkdirSync('tmp',{recursive:true}); await page.screenshot({path:'tmp/attendance-recurrence-mobile.png',fullPage:true});
  await dialog.getByRole('button',{name:'Save recurring schedule'}).click();
  await dialog.getByRole('alert').filter({hasText:'Schedule save interrupted'}).waitFor();
  await dialog.getByRole('button',{name:'Save recurring schedule'}).click();
  await dialog.waitFor({state:'hidden'}); assert.equal(code.schedule.every_weeks,2);
  await page.getByRole('button',{name:'Pause recurrence',exact:true}).click();
  await page.getByRole('button',{name:'Resume recurrence',exact:true}).click();
  await page.getByRole('button',{name:'Skip 2030-01-06',exact:true}).click();
  await page.getByText('Skipped',{exact:false}).waitFor();
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole('button',{name:'Edit recurrence',exact:true}).click();
  await page.screenshot({path:'tmp/attendance-recurrence-desktop.png',fullPage:true});
  await page.goto('http://localhost:3000/check-in/test');
  await page.getByRole('heading',{name:'Check-in is scheduled.'}).waitFor();
  publicOpen=true;
  await page.getByRole('button',{name:'Test Member',exact:true}).waitFor({timeout:25000});
  await page.getByRole('button',{name:'Test Member',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Connection interrupted'}).waitFor();
  await page.getByRole('button',{name:'Test Member',exact:true}).click();
  await page.getByText('Test Member is checked in.',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: mobile scrolling, weekly recurrence save/retry, pause/resume/skip, desktop editor, automatic public opening refresh, failed check-in recovery; no browser errors. All APIs/providers mocked.');
})().catch(async error=>{console.error(error);if(currentPage){console.error('Page:',currentPage.url(),await currentPage.locator('body').innerText());await currentPage.screenshot({path:'tmp/attendance-recurrence-failure.png',fullPage:true});}process.exitCode=1;}).finally(async()=>{await browser?.close();});
