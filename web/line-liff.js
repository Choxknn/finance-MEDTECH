'use strict';
(()=>{
 const cfg=window.FINANCE_CONFIG,status=document.getElementById('line-liff-status'),retry=document.getElementById('line-liff-retry'),back=document.getElementById('line-liff-back');
 const params=new URLSearchParams(location.search);
 const readState=()=>{
  const direct=params.get('signup_state')||params.get('state');
  if(direct)return direct;
  const nested=params.get('liff.state')||'';
  const query=nested.includes('?')?nested.slice(nested.indexOf('?')+1):nested;
  const nestedParams=new URLSearchParams(query);
  return nestedParams.get('signup_state')||nestedParams.get('state')||sessionStorage.getItem('finance-line-liff-signup-state');
 };
 let state=readState(),busy=false,completed=false;
 if(state)sessionStorage.setItem('finance-line-liff-signup-state',state);
 const say=message=>{status.textContent=message};
 function returnToSignup(){history.length>1?history.back():location.replace('./register.html')}
 retry.addEventListener('click',finish);
 back.addEventListener('click',returnToSignup);
 async function finish(){
  if(busy||completed)return;busy=true;retry.hidden=true;
  try{
   say('กำลังตรวจสอบการเพิ่มเพื่อน LINE…');
   let friendship=await liff.getFriendship();
   if(!friendship.friendFlag){
    say('กรุณากดยอมรับหน้าต่างเพิ่มเพื่อนที่ LINE แสดงขึ้นมา…');
    try{await liff.requestFriendship()}catch(error){}
    friendship=await liff.getFriendship();
    if(!friendship.friendFlag){say('ยังไม่ได้เพิ่มเพื่อน LINE กรุณากดยอมรับ แล้วกดลองอีกครั้ง');retry.hidden=false;return}
   }
   say('เพิ่มเพื่อนสำเร็จ กำลังยืนยันการสมัคร…');
   const idToken=liff.getIDToken();
   if(!idToken)throw new Error('ไม่พบ ID Token กรุณาตรวจสอบสิทธิ์ openid ใน LIFF App');
   const result=await FinanceLine.request({action:'liff-finish',state,id_token:idToken});
   if(!result.ok||result.mode!=='signup')throw new Error('ยืนยัน LINE ไม่สำเร็จ กรุณาเริ่มเชื่อมใหม่');
   completed=true;sessionStorage.removeItem('finance-line-liff-signup-state');
   say('ยืนยันการเพิ่มเพื่อนเรียบร้อยแล้ว กำลังกลับไปหน้าสมัครสมาชิก…');
   back.hidden=false;
   if(liff.isInClient())setTimeout(()=>{try{liff.closeWindow()}catch{}},650);
  }catch(error){say(error.message||'เชื่อม LINE ไม่สำเร็จ กรุณาลองอีกครั้ง');retry.hidden=false}
  finally{busy=false}
 }
 async function start(){
  await liff.init({liffId:cfg.lineLiffId});
  state=state||readState();
  if(!state)throw new Error('ไม่พบข้อมูลการสมัคร กรุณากลับไปหน้าสมัครสมาชิกแล้วกดเพิ่มเพื่อนอีกครั้ง');
  sessionStorage.setItem('finance-line-liff-signup-state',state);
  if(!liff.isLoggedIn()){
   const redirect=new URL(location.href);redirect.searchParams.delete('state');redirect.searchParams.delete('liff.state');redirect.searchParams.set('signup_state',state);
   liff.login({redirectUri:redirect.href});
   return;
  }
  history.replaceState(null,'',location.pathname);
  await finish();
 }
 start().catch(error=>{say(error.message||'เปิด LIFF ไม่สำเร็จ');retry.hidden=true;back.hidden=false});
})();