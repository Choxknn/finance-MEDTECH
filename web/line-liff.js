'use strict';
(()=>{
 const cfg=window.FINANCE_CONFIG,status=document.getElementById('line-liff-status'),retry=document.getElementById('line-liff-retry'),back=document.getElementById('line-liff-back'),oa=document.getElementById('line-liff-oa');
 const state=new URLSearchParams(location.search).get('state');
 let busy=false,completed=false;
 oa.href=cfg.lineOaUrl||'https://lin.ee/rpHtjnI';
 const say=(message)=>{status.textContent=message};
 function returnToSignup(){location.replace('./register.html')}
 async function finish(){
  if(busy||completed)return;busy=true;retry.hidden=true;oa.hidden=true;
  try{
   say('กำลังตรวจสอบสถานะการเป็นเพื่อน…');
   const friendship=await liff.getFriendship();
   if(!friendship.friendFlag){
    say('กรุณากดเพิ่มเพื่อนใน LINE Official Account เพื่อรับแจ้งเตือนจากระบบ');
    try{await liff.requestFriendship()}catch(error){say('ยังเพิ่มเพื่อนไม่สำเร็จ กรุณากดเปิด LINE Official Account แล้วลองตรวจสอบอีกครั้ง')}
    const after=await liff.getFriendship();
    if(!after.friendFlag){retry.hidden=false;oa.hidden=false;busy=false;return}
   }
   say('เพิ่มเพื่อนสำเร็จ กำลังยืนยันบัญชี…');
   const idToken=liff.getIDToken();
   if(!idToken)throw new Error('ไม่พบ ID Token กรุณาตรวจสอบว่าเปิดสิทธิ์ openid ใน LIFF App แล้ว');
   const result=await FinanceLine.request({action:'liff-finish',state,id_token:idToken});
   if(!result.ok||result.mode!=='signup')throw new Error('ยืนยัน LINE ไม่สำเร็จ กรุณาเริ่มเชื่อมใหม่');
   completed=true;say('เพิ่มเพื่อนและเชื่อม LINE สำเร็จแล้ว กลับไปยังหน้าสมัครสมาชิกเพื่อดำเนินการต่อ');
   back.hidden=false;
   if(liff.isInClient())setTimeout(()=>{try{liff.closeWindow()}catch{}},900);
  }catch(error){say(error.message||'เชื่อม LINE ไม่สำเร็จ กรุณาลองอีกครั้ง');retry.hidden=false;oa.hidden=false}
  finally{busy=false}
 }
 async function start(){
  if(!state||! /^[a-f0-9]{100,3000}$/.test(state))throw new Error('ไม่พบข้อมูลการสมัคร กรุณากลับไปเริ่มเชื่อม LINE จากหน้าสมัครสมาชิก');
  await liff.init({liffId:cfg.lineLiffId});
  if(!liff.isLoggedIn()){
   liff.login({redirectUri:location.href});
   return;
  }
  history.replaceState(null,'',location.pathname);
  retry.addEventListener('click',finish);
  back.addEventListener('click',returnToSignup);
  await finish();
 }
 start().catch(error=>{say(error.message||'เปิด LIFF ไม่สำเร็จ');retry.hidden=true;oa.hidden=false;back.hidden=false});
})();
