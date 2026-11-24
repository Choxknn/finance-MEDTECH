'use strict';
(()=>{
 const params=new URLSearchParams(location.search);
 const nested=params.get('liff.state')||'';
 const nestedQuery=nested.includes('?')?nested.slice(nested.indexOf('?')+1):nested;
 const nestedParams=new URLSearchParams(nestedQuery);
 const friendGateState=params.get('friend_gate_state')||nestedParams.get('friend_gate_state')||'';
 let signupState=params.get('signup_state')||params.get('state')||nestedParams.get('signup_state')||nestedParams.get('state')||'';
 const flow=friendGateState?'friend-gate':signupState?'signup':'';
 if(!flow)return;
 const flowState=friendGateState||signupState;
 const status=document.getElementById('register-status');
 const intro=document.querySelector('.signup-intro');
 const steps=document.querySelector('.signup-steps');
 if(steps)steps.hidden=true;
 if(intro)intro.textContent=flow==='friend-gate'?'กรุณาเพิ่มเพื่อน LINE Official Account ก่อนเข้าใช้งานเว็บไซต์':'กำลังยืนยันการเพิ่มเพื่อน LINE เพื่อดำเนินการสมัครสมาชิก';
 ['invite-person','invite-expiry','student-lookup','registration-review','registration-line','register-form','signup-complete'].forEach(id=>{const el=document.getElementById(id);if(el)el.hidden=true});
 document.querySelector('.signup-footer-actions')?.setAttribute('hidden','');
 const actions=document.createElement('div');actions.className='actions signup-liff-actions';
 const retry=document.createElement('button');retry.type='button';retry.textContent='ลองตรวจสอบอีกครั้ง';retry.hidden=true;
 const back=document.createElement('button');back.type='button';back.className='secondary';back.textContent='กลับไปหน้าก่อนหน้า';back.hidden=true;
 actions.append(retry,back);status.insertAdjacentElement('afterend',actions);
 const say=message=>{status.textContent=message};
 let busy=false,completed=false;
 const readState=()=>{
  if(flowState)return flowState;
  const current=new URLSearchParams(location.search);
  const value=current.get('liff.state')||'';
  const query=value.includes('?')?value.slice(value.indexOf('?')+1):value;
  const nested=new URLSearchParams(query);
  return flow==='friend-gate'?(current.get('friend_gate_state')||nested.get('friend_gate_state')||''):(current.get('signup_state')||current.get('state')||nested.get('signup_state')||nested.get('state')||'');
 };
 const redirectUri=()=>{
  const url=new URL(location.href);url.searchParams.delete('state');url.searchParams.delete('liff.state');url.searchParams.delete('friend_gate_state');url.searchParams.delete('signup_state');url.searchParams.set(flow==='friend-gate'?'friend_gate_state':'signup_state',readState());return url.href;
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
   say(flow==='friend-gate'?'เพิ่มเพื่อนสำเร็จ กำลังยืนยันบัญชีเพื่อเข้าเว็บไซต์…':'เพิ่มเพื่อนสำเร็จ กำลังยืนยันการสมัคร…');
   const idToken=liff.getIDToken();
   if(!idToken)throw new Error('ไม่พบ ID Token กรุณาตรวจสอบสิทธิ์ openid ใน LIFF App');
   const result=flow==='friend-gate'
    ?await FinanceLine.request({action:'friend-gate-finish',state:flowState,id_token:idToken})
    :await FinanceLine.request({action:'liff-finish',state:signupState,id_token:idToken});
   if(flow==='friend-gate'){
    if(!result.ok||result.mode!=='friend-gate')throw new Error('ตรวจสอบการเพิ่มเพื่อนไม่สำเร็จ กรุณาลองอีกครั้ง');
    completed=true;sessionStorage.removeItem('finance-line-friend-gate-pending');
    say('เพิ่มเพื่อน LINE เรียบร้อยแล้ว กำลังกลับเข้าสู่เว็บไซต์…');
    location.replace('./');
    return;
   }
   if(!result.ok||result.mode!=='signup')throw new Error('ยืนยัน LINE ไม่สำเร็จ กรุณาเริ่มใหม่จากหน้าสมัครสมาชิก');
   completed=true;sessionStorage.removeItem('finance-line-liff-signup-state');
   let resume=null;try{resume=JSON.parse(sessionStorage.getItem('finance-signup-resume')||localStorage.getItem('finance-signup-resume')||'null')}catch{}
   if(resume&&/^[0-9a-f]{64}$/.test(resume.token||'')&&/^[0-9a-f]{64}$/.test(resume.session||'')){
    resume.lineVerified=true;sessionStorage.setItem('finance-signup-resume',JSON.stringify(resume));localStorage.setItem('finance-signup-resume',JSON.stringify(resume));
    say('เชื่อม LINE สำเร็จ กำลังกลับไปหน้าตั้งรหัสผ่าน…');location.replace('./register.html#token='+encodeURIComponent(resume.token));return;
   }
   say('เชื่อม LINE สำเร็จแล้ว กรุณากลับไปเปิดลิงก์สมัครเดิมเพื่อดำเนินการตั้งรหัสผ่าน');
   back.textContent='กลับไปหน้าสมัครสมาชิก';back.hidden=false;
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
 back.addEventListener('click',()=>{if(flow==='friend-gate')location.replace('./');else if(history.length>1)history.back();else location.replace('./register.html')});
 async function start(){
  if(!readState())throw new Error(flow==='friend-gate'?'ไม่พบคำขอตรวจสอบเพื่อน กรุณาเข้าสู่ระบบเว็บไซต์ใหม่':'ไม่พบข้อมูลการสมัคร กรุณากลับไปหน้าสมัครสมาชิกแล้วกดเพิ่มเพื่อนอีกครั้ง');
  if(flow==='friend-gate')sessionStorage.setItem('finance-line-friend-gate-pending',JSON.stringify({createdAt:Date.now()}));else sessionStorage.setItem('finance-line-liff-signup-state',signupState);
  if(!window.liff)throw new Error('โหลด LINE SDK ไม่สำเร็จ กรุณาเปิดลิงก์อีกครั้ง');
  await liff.init({liffId:window.FINANCE_CONFIG.lineLiffId});
  if(!liff.isLoggedIn()){liff.login({redirectUri:redirectUri()});return}
  await finish();
 }
 start().catch(error=>{say(error.message||'เปิด LINE ไม่สำเร็จ');retry.hidden=false;back.hidden=false});
})();