'use strict';
(()=>{
 const base=new URL('./',document.currentScript.src);
 const gate=document.createElement('div');gate.id='primary-font-gate';gate.setAttribute('role','status');gate.setAttribute('aria-live','polite');
 gate.innerHTML='<span class="primary-font-spinner" aria-hidden="true"></span><p>กำลังโหลดฟอนต์ของเว็บ…</p>';
 document.body.append(gate);
 let loading=false,attempt=0;
 async function load(){
  if(loading||document.documentElement.classList.contains('primary-font-ready'))return;loading=true;attempt++;
  gate.querySelector('p').textContent='กำลังโหลดฟอนต์ของเว็บ…';gate.classList.remove('font-error');
  const timer=setTimeout(()=>{gate.querySelector('p').textContent='กำลังรอฟอนต์ กรุณาตรวจสอบอินเทอร์เน็ต'},10000);
  try{
   const faces=await Promise.all([['regular',400],['bold',700]].map(async([file,weight])=>{
    const url=new URL(`fonts/line-seed/${file}.woff2`,base);if(attempt>1)url.searchParams.set('retry',Date.now());
    const face=new FontFace('LINE Seed Sans TH',`url("${url.href}") format("woff2")`,{weight:String(weight),style:'normal',display:'block'});
    await Promise.race([face.load(),new Promise((_,reject)=>setTimeout(()=>reject(Error('font timeout')),25000))]);return face;
   }));
   faces.forEach(face=>document.fonts.add(face));
   document.documentElement.classList.add('primary-font-ready');gate.remove();
  }catch{
   gate.classList.add('font-error');gate.querySelector('p').textContent='กำลังเชื่อมต่อเพื่อโหลดฟอนต์อีกครั้ง…';setTimeout(load,Math.min(15000,attempt*3000));
  }finally{clearTimeout(timer);loading=false}
 }
 window.addEventListener('online',()=>{if(!document.documentElement.classList.contains('primary-font-ready'))void load()});
 void load();
})();
