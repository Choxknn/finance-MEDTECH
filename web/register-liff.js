'use strict';
(()=>{
 const params=new URLSearchParams(location.search);
 const initialState=params.get('signup_state')||params.get('state');
 const nested=params.get('liff.state')||'';
 const nestedQuery=nested.includes('?')?nested.slice(nested.indexOf('?')+1):nested;
 const nestedParams=new URLSearchParams(nestedQuery);
 let signupState=initialState||nestedParams.get('signup_state')||nestedParams.get('state')||'';
 if(!params.has('signup_state')&&!params.has('state')&&!params.has('liff.state'))return;
 const status=document.getElementById('register-status');
 const intro=document.querySelector('.signup-intro');
 const steps=document.querySelector('.signup-steps');
 if(steps)steps.hidden=true;
 if(intro)intro.textContent='กำลังยืนยันการเพิ่มเพื่อน LINE เพื่อดำเนินการสมัครสมาชิก';
 ['invite-person','invite-expiry','student-lookup','registration-review','registration-line','register-form','signup-complete'].forEach(id=>{const el=document.getElementById(id);if(el)el.hidden=true});
 document.querySelector('.signup-footer-actions')?.setAttribute('hidden','');
 const actions=document.createElement('div');actions.className='actions signup-liff-actions';
 const retry=document.createElement('button');retry.type='button';retry.textContent='ลองตรวจสอบอีกครั้ง';retry.hidden=true;
 const back=document.createElement('button');back.type='button';back.className='secondary';back.textContent='กลับไปหน้าก่อนหน้า';back.hidden=true;
 actions.append(retry,back);status.insertAdjacentElement('afterend',actions);
 const say=message=>{status.textContent=message};
 let busy=false,completed=false;
 const readState=()=>{
  if(signupState)return signupState;
  const current=new URLSearchParams(location.search);
  const direct=current.get('signup_state')||current.get('state');
  if(direct)return direct;
  const value=current.get('liff.state')||'';
  const query=value.includes('?')?value.slice(value.indexOf('?')+1):value;
  const nested=new URLSearchParams(query);
  return nested.get('signup_state')||nested.get('state')||'';
 };
 const redirectUri=()=>{
  const url=new URL(location.href);url.searchParams.delete('state');url.searchParams.delete('liff.state');url.searchParams.set('signup_state',readState());return url.href;
 };
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
   const result=await FinanceLine.request({action:'liff-finish',state:signupState,id_token:idToken});
   if(!result.ok||result.mode!=='signup')throw new Error('ยืนยัน LINE ไม่สำเร็จ กรุณาเริ่มใหม่จากหน้าสมัครสมาชิก');
   completed=true;sessionStorage.removeItem('finance-line-liff-signup-state');
   say('ยืนยันการเพิ่มเพื่อนเรียบร้อยแล้ว กำลังกลับไปหน้าสมัครสมาชิก…');
   back.hidden=false;
   if(liff.isInClient())setTimeout(()=>{try{liff.closeWindow()}catch{}},650);
  }catch(error){
   const message=error.message||'ยืนยัน LINE ไม่สำเร็จ กรุณาลองอีกครั้ง';
   if(/LINE นี้มีบัญชีแล้ว|LINE นี้เชื่อมกับบัญชีอื่น/.test(message)){
    sessionStorage.setItem('finance-line-return-notice','line-already-registered');
    location.replace('./');return;
   }
   say(message);retry.hidden=false;
  }
  finally{busy=false}
 }
 retry.addEventListener('click',finish);
 back.addEventListener('click',()=>{if(history.length>1)history.back();else location.replace('./register.html')});
 async function start(){
  if(!signupState)throw new Error('ไม่พบข้อมูลการสมัคร กรุณากลับไปหน้าสมัครสมาชิกแล้วกดเพิ่มเพื่อนอีกครั้ง');
  sessionStorage.setItem('finance-line-liff-signup-state',signupState);
  if(!window.liff)throw new Error('โหลด LINE SDK ไม่สำเร็จ กรุณาเปิดลิงก์อีกครั้ง');
  await liff.init({liffId:window.FINANCE_CONFIG.lineLiffId});
  if(!liff.isLoggedIn()){liff.login({redirectUri:redirectUri()});return}
  await finish();
 }
 start().catch(error=>{say(error.message||'เปิด LINE ไม่สำเร็จ');retry.hidden=false;back.hidden=false});
})();