const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {JSDOM}=require('jsdom');
test('mascot action lives inside speech and survives continuous text animation',()=>{
 const dom=new JSDOM('<body></body>',{runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window,d=w.document;try{
 w.user={id:'student',role:'member'};w.esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;');w.icon=()=>'<svg></svg>';w.render=()=>{};w.view='dashboard';w.matchMedia=()=>({matches:false});
 const source=fs.readFileSync('web/material-expressive.js','utf8');w.eval(source.slice(source.indexOf('function materialSpeech('),source.indexOf('function materialSay(')));
 d.body.innerHTML='<div class="meddy-bubble">'+w.materialSpeech({label:'ดูบิลที่ต้องแก้ไข'},'มีสลิปที่ต้องแก้ไขนะ เข้าไปดูเหตุผลและส่งหลักฐานใหม่ได้เลย')+'</div>';
 const frames=[];w.requestAnimationFrame=fn=>(frames.push(fn),frames.length);w.cancelAnimationFrame=()=>{};
 w.eval(fs.readFileSync('web/finishing-polish.js','utf8'));
 const action=d.querySelector('[data-meddy-go]');assert(action.closest('.meddy-bubble'));assert.equal(action.hidden,true);let i=0;while(frames.length&&i<200)frames.shift()(i++*40);
 assert.equal(action.hidden,false);assert.equal(d.querySelector('[data-meddy-go]'),action);assert.equal(d.querySelector('.meddy-spoken-text').textContent,'มีสลิปที่ต้องแก้ไขนะ เข้าไปดูเหตุผลและส่งหลักฐานใหม่ได้เลย');assert.equal(d.querySelector('.meddy-spoken-text').children.length,0);assert.equal(d.querySelectorAll('.meddy-link').length,1);
 }finally{w.close()}
});
