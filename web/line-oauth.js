'use strict';
window.FinanceLine={
 isExternalMobile(){const ua=navigator.userAgent;return !/Line\//i.test(ua)&&(/Android|iPhone|iPad|iPod/i.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1))},
 showAppLink(url){
  document.getElementById('line-launch-dialog')?.remove();
  const box=document.createElement('dialog');box.id='line-launch-dialog';box.className='line-launch-dialog';box.setAttribute('aria-labelledby','line-launch-title');
  box.innerHTML='<div class="line-launch-symbol" aria-hidden="true">LINE</div><h2 id="line-launch-title">ดำเนินการต่อใน LINE</h2><p>กดปุ่มด้านล่างเพื่อเปิดแอป LINE และยืนยันบัญชีของคุณ</p><a class="line-launch-primary">เปิดแอป LINE</a><a class="line-launch-fallback">ใช้ LINE Login ผ่านเบราว์เซอร์</a><p class="line-launch-help">หากไม่มีแอป หรือเปิดแอปไม่ได้ ให้เลือกล็อกอินผ่านเบราว์เซอร์</p><button type="button" class="line-launch-cancel">ยกเลิก</button>';
  const appUrl=new URL(url);appUrl.searchParams.delete('disable_auto_login');box.querySelector('.line-launch-primary').href=appUrl.href;
  const fallback=new URL(url);fallback.searchParams.set('disable_auto_login','true');box.querySelector('.line-launch-fallback').href=fallback.href;
  box.querySelectorAll('a').forEach(a=>{a.rel='noreferrer';a.addEventListener('click',e=>{let flow;try{flow=JSON.parse(sessionStorage.getItem('finance-line-oauth'))}catch{}if(!flow||Date.now()-flow.createdAt>600000){e.preventDefault();box.querySelector('p').textContent='คำขอหมดอายุแล้ว กรุณาปิดหน้าต่างและกดเข้าสู่ระบบใหม่';return}box.querySelector('p').textContent='กำลังเปิด LINE…'})});
  box.querySelector('button').addEventListener('click',()=>box.close());box.addEventListener('close',()=>box.remove(),{once:true});document.body.append(box);box.showModal();
 },
 async request(data,accessToken){const cfg=window.FINANCE_CONFIG,r=await fetch(cfg.supabaseUrl+'/functions/v1/line-login',{method:'POST',headers:{apikey:cfg.supabaseAnonKey,'Content-Type':'application/json',...(accessToken?{Authorization:'Bearer '+accessToken}:{})},body:JSON.stringify(data)});const j=await r.json();if(!r.ok)throw Error(j.error||'เชื่อมต่อ LINE ไม่สำเร็จ');return j},
 async start(mode,{accessToken,session,remember=true}={}){const bytes=crypto.getRandomValues(new Uint8Array(32)),encode=b=>btoa(String.fromCharCode(...b)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');const verifier=encode(bytes),challenge=encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));const result=await this.request({action:'start',mode,session,challenge},accessToken);const url=new URL(result.url);if(url.origin!=='https://access.line.me')throw Error('ลิงก์ LINE ไม่ถูกต้อง');sessionStorage.setItem('finance-line-oauth',JSON.stringify({state:result.state,verifier,mode,remember,createdAt:Date.now()}));if(this.isExternalMobile()){this.showAppLink(url);return}location.assign(url.href)}
};
