'use strict';
(()=>{
 let checking=false;
 function showGateError(message){
  const app=document.getElementById('app');
  if(!app)return;
  app.innerHTML=`<section class="login-page"><section class="login-form-area"><div class="login-form" role="alert"><div class="line-login-symbol" aria-hidden="true">LINE</div><h1>ต้องเพิ่มเพื่อน LINE ก่อนเข้าใช้งาน</h1><p class="sub">ระบบยังตรวจสอบสถานะเพื่อน LINE Official Account ไม่สำเร็จ จึงยังไม่เปิดหน้าเว็บไซต์</p><p class="error" id="friend-gate-error">${esc(message||'กรุณาลองตรวจสอบอีกครั้ง')}</p><div class="actions"><button type="button" id="friend-gate-retry">ตรวจสอบอีกครั้ง</button><button type="button" class="secondary" data-action="logout">ออกจากระบบ</button></div><p class="help">เมื่อเพิ่มเพื่อนแล้ว ให้กลับมาหน้านี้ ระบบจะตรวจสอบและเข้าเว็บไซต์ให้อัตโนมัติ</p></div></section></section>`;
  document.getElementById('friend-gate-retry')?.addEventListener('click',async e=>{
   const button=e.currentTarget;button.disabled=true;button.textContent='กำลังตรวจสอบ…';
   const allowed=await window.ensureMemberFriendship();
   if(allowed){view='dashboard';render()}
   else if(button.isConnected){button.disabled=false;button.textContent='ตรวจสอบอีกครั้ง'}
  });
 }
 window.ensureMemberFriendship=async function(){
  if(cfg.mode!=='live'||!user||user.role==='admin')return true;
  if(checking)return false;
  checking=true;
  try{
   await ensureLiveSession();
   const result=await FinanceLine.request({action:'friend-gate-start'},token);
   if(result.required!==true){sessionStorage.removeItem('finance-line-friend-gate-pending');return true}
   const url=new URL(result.url);
   if(url.origin!=='https://liff.line.me'||url.pathname!=='/'+cfg.lineLiffId||!url.searchParams.has('friend_gate_state'))throw Error('ลิงก์ตรวจสอบ LINE ไม่ถูกต้อง กรุณาติดต่อผู้ดูแลระบบ');
   sessionStorage.setItem('finance-line-friend-gate-pending',JSON.stringify({profileId:user.id,createdAt:Date.now()}));
   const app=document.getElementById('app');
   if(app)app.innerHTML='<section class="login-page"><section class="login-form-area"><div class="login-form"><div class="line-login-symbol" aria-hidden="true">LINE</div><h1>กำลังเปิด LINE เพื่อเพิ่มเพื่อน</h1><p class="sub">กรุณากดยอมรับหน้าต่างเพิ่มเพื่อน LINE Official Account แล้วระบบจะพากลับเข้าเว็บไซต์</p><div class="login-loading" role="status">กำลังเปิด LIFF…</div></div></section></section>';
   location.assign(url.href);
   return false;
  }catch(error){
   showGateError(error instanceof Error?error.message:'ตรวจสอบ LINE ไม่สำเร็จ');
   return false;
  }finally{checking=false}
 };
})();