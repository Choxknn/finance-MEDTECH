const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {JSDOM}=require('jsdom');
test('mascot action lives inside speech and survives continuous text animation',()=>{
 const dom=new JSDOM('<body></body>',{runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window,d=w.document;try{
 w.user={id:'student',role:'member'};w.esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;');w.icon=()=>'<svg></svg>';w.render=()=>{};w.view='dashboard';w.matchMedia=()=>({matches:false});
 const source=fs.readFileSync('web/material-expressive.js','utf8');w.eval(source.slice(source.indexOf('function materialSpeech('),source.indexOf('function materialSay(')));
 d.body.innerHTML='<div class="meddy-bubble">'+w.materialSpeech({label:'ดูบิลที่ต้องแก้ไข'},'มีสลิปที่ต้องแก้ไขนะ เข้าไปดูเหตุผลและส่งหลักฐานใหม่ได้เลย')+'</div>';
 const bubble=d.querySelector('.meddy-bubble');bubble.getBoundingClientRect=()=>({height:146});
 const frames=[];w.requestAnimationFrame=fn=>(frames.push(fn),frames.length);w.cancelAnimationFrame=()=>{};
 w.eval(fs.readFileSync('web/finishing-polish.js','utf8'));
 const action=d.querySelector('[data-meddy-go]');assert(action.closest('.meddy-bubble'));assert.equal(bubble.style.minHeight,'146px','reserve the full speech bubble height before typing');assert.equal(action.hidden,true);let i=0;while(frames.length&&i<200)frames.shift()(i++*40);
 assert.equal(action.hidden,false);assert.equal(d.querySelector('[data-meddy-go]'),action);assert.equal(d.querySelector('.meddy-spoken-text').textContent,'มีสลิปที่ต้องแก้ไขนะ เข้าไปดูเหตุผลและส่งหลักฐานใหม่ได้เลย');assert.equal(d.querySelector('.meddy-spoken-text').children.length,0);assert.equal(d.querySelectorAll('.meddy-link').length,1);
 }finally{w.close()}
});


test('changing pages does not replay the mascot speech typing animation',()=>{
 const dom=new JSDOM('<body></body>',{runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,d=w.document;
 try{
  w.user={id:'student',role:'member'};w.view='dashboard';w.matchMedia=()=>({matches:false});
  w.render=()=>{};const frames=[];w.requestAnimationFrame=fn=>(frames.push(fn),frames.length);w.cancelAnimationFrame=()=>{};
  const bubble='<div class="meddy-bubble"><span class="meddy-speech-text">ข้อความเดิมของน้องเม็ดเลือด</span><button data-meddy-go>ดูบิล</button></div>';
  d.body.innerHTML=bubble;
  w.eval(fs.readFileSync('web/finishing-polish.js','utf8'));
  let clock=0;while(frames.length&&clock<10000){const frame=frames.shift();frame(clock);clock+=100}
  assert.equal(d.querySelector('.meddy-spoken-text').textContent,'ข้อความเดิมของน้องเม็ดเลือด');
  w.view='profile';w.render();
  d.body.innerHTML=bubble;
  w.view='dashboard';w.render();
  assert.equal(frames.length,0,'returning to dashboard with unchanged speech should not schedule typing frames');
  assert.equal(d.querySelector('.meddy-speech-text').textContent,'ข้อความเดิมของน้องเม็ดเลือด');
 }finally{w.close()}
});
