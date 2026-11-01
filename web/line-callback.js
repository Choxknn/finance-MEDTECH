'use strict';
(async()=>{
 const params=new URLSearchParams(location.search);
 history.replaceState(null,'',location.pathname);
 let flow=null;
 const returnHome=notice=>{
  if(notice)sessionStorage.setItem('finance-line-return-notice',notice);
  location.replace('./');
 };
 try{
  const raw=localStorage.getItem('finance-line-oauth')||sessionStorage.getItem('finance-line-oauth');
  localStorage.removeItem('finance-line-oauth');sessionStorage.removeItem('finance-line-oauth');
  flow=raw&&JSON.parse(raw);
  if(!flow||Date.now()-flow.createdAt>600000||params.get('state')!==flow.state)throw Error('ไม่พบคำขอเข้าสู่ระบบในเบราว์เซอร์นี้ กรุณาเริ่มใหม่');
  if(params.has('error'))throw Error('ยกเลิกการเข้าสู่ระบบด้วย LINE แล้ว');
  let accessToken=null;
  if(flow.mode==='link'){
   const saved=localStorage.getItem('finance-medtech-session-v1')||sessionStorage.getItem('finance-medtech-session-v1');
   accessToken=saved?JSON.parse(saved).access_token:null;
   if(!accessToken)throw Error('กรุณาเข้าสู่ระบบใหม่ก่อนเชื่อม LINE');
  }
  const result=await FinanceLine.request({action:'finish',state:flow.state,code:params.get('code'),verifier:flow.verifier},accessToken);
  if(result.mode!==flow.mode)throw Error('ผลการยืนยันไม่ตรงกับคำขอ');
  if(flow.mode==='signup'){
   const signupRaw=localStorage.getItem('finance-signup-resume')||sessionStorage.getItem('finance-signup-resume');
   if(!signupRaw)throw Error('ไม่พบข้อมูลสมัคร กรุณาเปิดลิงก์สมัครใหม่');
   const context=JSON.parse(signupRaw);context.lineVerified=true;
   sessionStorage.setItem('finance-signup-resume',JSON.stringify(context));localStorage.setItem('finance-signup-resume',JSON.stringify(context));
   location.replace('./register.html');return;
  }
  if(flow.mode==='login'){
   const s=result.session;
   if(!s?.access_token||!s.refresh_token)throw Error('ไม่ได้รับเซสชันเข้าสู่ระบบ');
   localStorage.removeItem('finance-medtech-session-v1');
   sessionStorage.removeItem('finance-medtech-session-v1');
   (flow.remember?localStorage:sessionStorage).setItem('finance-medtech-session-v1',JSON.stringify(s));
   returnHome();return;
  }
  if(flow.mode==='link'){
   returnHome(result.alreadyLinked?'line-already-linked':'line-linked-success');return;
  }
  throw Error('ไม่พบขั้นตอน LINE ที่ต้องการ');
 }catch(err){
  const message=err instanceof Error?err.message:'เชื่อมต่อ LINE ไม่สำเร็จ';
  if(flow?.mode==='link'&&/LINE นี้เชื่อมกับสมาชิกคนอื่นแล้ว/.test(message)){
   returnHome('line-linked-other');return;
  }
  if((flow?.mode==='signup'||flow?.mode==='link')&&/LINE นี้มีบัญชีแล้ว|LINE นี้เชื่อมกับบัญชีอื่น/.test(message)){
   returnHome('line-already-registered');return;
  }
  const status=document.getElementById('line-callback-status');
  const back=document.getElementById('line-callback-back');
  if(status)status.textContent=message;
  if(back)back.hidden=false;
 }
})();