const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const root=require('node:path').resolve(__dirname,'..');
const token='a'.repeat(64);
const dom=new JSDOM(fs.readFileSync(root+'/web/register.html','utf8'),{url:'https://example.test/register.html#token='+token,runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;w.FINANCE_CONFIG={supabaseUrl:'https://project.test',supabaseAnonKey:'anon',lineOaUrl:'https://lin.ee/example'};
w.FinanceLine={request:async()=>({enabled:true}),startLiffSignup:async()=>({})};
const calls=[];let linked=false,startCount=0,resetCount=0;
w.fetch=async(url,options)=>{
 const body=JSON.parse(options.body);calls.push(body);
 let data={};
 if(body.action==='invite-preview')data={batch:{expires_at:'2026-12-31T00:00:00Z'}};
 else if(body.action==='batch-start'){startCount++;data={session:(startCount===1?'b':'d').repeat(64),code:'ABC123XYZ9876543',person:{name:'ทดสอบ ระบบ'}}}
 else if(body.action==='batch-state')data={linked};
 else if(body.action==='batch-reset-line'){
  if(body.discard)data={ok:true,discarded:true};
  else{resetCount++;linked=false;data={ok:true,session:(resetCount===1?'c':'e').repeat(64),code:resetCount===1?'NEWCODE123456789':'NEXTCODE12345678'}}
 }
 return {ok:true,json:async()=>data};
};
const ctx=dom.getInternalVMContext(),tick=()=>new Promise(resolve=>setTimeout(resolve,0)),wait=async()=>{await tick();await tick();await tick()};
(async()=>{
 vm.runInContext(fs.readFileSync(root+'/web/register.js','utf8'),ctx);
 await wait();
 const footer=w.document.querySelector('.signup-back'),label=footer.querySelector('span'),lookup=w.document.getElementById('student-lookup'),step=n=>w.document.querySelector('[data-signup-step="'+n+'"]');
 assert.equal(label.textContent,'กลับเข้าสู่ระบบ','step 1 keeps the login link label');
 assert.equal(lookup.hidden,false,'batch signup starts at student ID lookup');

 lookup.elements.student_id.value='6701110482001';
 lookup.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait();
 assert.equal(step(2).getAttribute('aria-current'),'step','lookup advances to step 2');
 assert.equal(label.textContent,'กลับ','step 2 displays a back action');
 footer.click();await wait();
 assert.equal(lookup.hidden,false,'step 2 back returns to student ID lookup');
 assert.equal(step(1).getAttribute('aria-current'),'step','step 2 back restores step 1');
 assert.ok(calls.some(x=>x.action==='batch-reset-line'&&x.discard===true),'step 2 back clears the pending server session');
 assert.equal(w.localStorage.getItem('finance-signup-resume'),null,'step 2 back clears the saved browser resume data');

 lookup.elements.student_id.value='6701110482001';
 lookup.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait();
 w.document.getElementById('registration-confirm').click();
 assert.equal(step(3).getAttribute('aria-current'),'step','confirming details advances to LINE step');

 linked=true;
 w.document.getElementById('registration-check').click();await wait();
 assert.equal(step(4).getAttribute('aria-current'),'step','verified LINE advances to password step');

 footer.click();await wait();
 assert.equal(step(3).getAttribute('aria-current'),'step','step 4 back returns to LINE step');
 assert.equal(w.document.getElementById('registration-line').hidden,false,'step 4 back restores LINE section');
 assert.equal(linked,false,'step 4 back resets the linked LINE state');
 let resume=JSON.parse(w.localStorage.getItem('finance-signup-resume'));
 assert.equal(resume.session,'c'.repeat(64),'step 4 back stores the replacement session');
 assert.equal(resume.code,'NEWCODE123456789','step 4 back stores a fresh LINE code');
 assert.equal(resume.lineVerified,false,'step 4 back clears the old verified flag');
 assert.equal(w.document.getElementById('registration-code').textContent,'สมัคร NEWCODE123456789','the displayed LINE code is refreshed');

 footer.click();await wait();
 assert.equal(step(2).getAttribute('aria-current'),'step','step 3 back returns to details review');
 assert.equal(w.document.getElementById('registration-review').hidden,false,'step 3 back restores review section');
 resume=JSON.parse(w.localStorage.getItem('finance-signup-resume'));
 assert.equal(resume.reviewConfirmed,false,'step 3 back requires confirming the details again');
 assert.equal(resume.session,'e'.repeat(64),'step 3 back also rotates the pending session');
 assert.equal(linked,false,'step 3 back keeps the previous LINE identity cleared');

 footer.click();await wait();
 assert.equal(step(1).getAttribute('aria-current'),'step','step 2 back returns to student ID lookup again');
 assert.ok(calls.filter(x=>x.action==='batch-reset-line'&&x.discard===false).length===2,'both LINE-related back steps reset the previous identity');
 assert.equal(calls.filter(x=>x.action==='batch-reset-line'&&x.discard===true).length,2,'returning to step 1 discards the pending server session');
 assert.equal(label.textContent,'กลับเข้าสู่ระบบ','step 1 restores the login label');
 console.log('Signup navigation and LINE reset tests passed');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>w.close());
