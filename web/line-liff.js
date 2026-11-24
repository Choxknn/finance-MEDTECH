'use strict';
(()=>{
 const cfg=window.FINANCE_CONFIG,status=document.getElementById('line-liff-status'),retry=document.getElementById('line-liff-retry'),back=document.getElementById('line-liff-back');
 const params=new URLSearchParams(location.search),nested=params.get('liff.state')||'';
 const nestedParams=new URLSearchParams(nested.includes('?')?nested.slice(nested.indexOf('?')+1):nested);
 let signupState=params.get('signup_state')||params.get('state')||nestedParams.get('signup_state')||nestedParams.get('state')||'';
 let friendGateState=params.get('friend_gate_state')||nestedParams.get('friend_gate_state')||'';
 const flow=friendGateState?'friend-gate':signupState?'signup':'',flowState=friendGateState||signupState;
 let busy=false,completed=false;
 if(signupState)sessionStorage.setItem('finance-line-liff-signup-state',signupState);
 const say=message=>{status.textContent=message};
 function returnToWebsite(){location.replace(flow==='signup'?'./register.html':'./')}
 retry.addEventListener('click',finish);
 back.addEventListener('click',returnToWebsite);
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
   say('เพิ่มเพื่อนสำเร็จ กำลังยืนยันบัญชี…');
   const idToken=liff.getIDToken();
   if(!idToken)throw new Error('ไม่พบ ID Token กรุณาตรวจสอบสิทธิ์ openid ใน LIFF App');
   const result=await FinanceLine.request({action:flow==='friend-gate'?'friend-gate-finish':'liff-finish',state:flowState,id_token:idToken});
   if(flow==='friend-gate'){
    if(!result.ok||result.mode!=='friend-gate')throw new Error('ตรวจสอบการเพิ่มเพื่อนไม่สำเร็จ กรุณาลองอีกครั้ง');
    completed=true;sessionStorage.removeItem('finance-line-friend-gate-pending');
    say('เพิ่มเพื่อน LINE เรียบร้อยแล้ว กำลังกลับเข้าสู่เว็บไซต์…');
    location.replace('./');return;
   }
   if(!result.ok||result.mode!=='signup')throw new Error('ยืนยัน LINE ไม่สำเร็จ กรุณาเริ่มเชื่อมใหม่');
   completed=true;sessionStorage.removeItem('finance-line-liff-signup-state');
   let resume=null;
   try{resume=JSON.parse(localStorage.getItem('finance-signup-resume')||sessionStorage.getItem('finance-signup-resume')||'null')}catch{}
   if(resume&&/^[0-9a-f]{64}$/.test(resume.token||'')&&/^[0-9a-f]{64}$/.test(resume.session||'')){
    resume.lineVerified=true;
    sessionStorage.setItem('finance-signup-resume',JSON.stringify(resume));
    localStorage.setItem('finance-signup-resume',JSON.stringify(resume));
    say('เชื่อม LINE สำเร็จ กำลังกลับไปหน้าตั้งรหัสผ่าน…');
    location.replace('./register.html#token='+encodeURIComponent(resume.token));return;
   }
   say('เชื่อม LINE สำเร็จแล้ว กรุณากลับไปเปิดลิงก์สมัครเดิมเพื่อตั้งรหัสผ่าน');
   back.textContent='กลับไปหน้าสมัครสมาชิก';back.hidden=false;
  }catch(error){
   const message=error instanceof Error?error.message:'เชื่อม LINE ไม่สำเร็จ กรุณาลองอีกครั้ง';
   if(/LINE นี้มีบัญชีแล้ว|LINE นี้เชื่อมกับบัญชีอื่น/.test(message)){
    sessionStorage.setItem('finance-line-return-notice','line-already-registered');
    location.replace('./');return;
   }
   say(message);retry.hidden=false;
  }finally{busy=false}
 }
 async function start(){
  if(!flow||!flowState)throw new Error('ไม่พบคำขอเชื่อม LINE กรุณากลับไปเริ่มจากหน้าเว็บไซต์ใหม่');
  await liff.init({liffId:cfg.lineLiffId});
  if(!liff.isLoggedIn()){
   const redirect=new URL(location.href);
   ['state','liff.state','signup_state','friend_gate_state'].forEach(key=>redirect.searchParams.delete(key));
   redirect.searchParams.set(flow==='friend-gate'?'friend_gate_state':'signup_state',flowState);
   liff.login({redirectUri:redirect.href});return;
  }
  history.replaceState(null,'',location.pathname);
  await finish();
 }
 start().catch(error=>{say(error.message||'เปิด LIFF ไม่สำเร็จ');retry.hidden=false;back.hidden=false});
})();