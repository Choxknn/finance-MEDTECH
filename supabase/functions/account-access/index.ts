import {captchaConfig,protectAccountRequest} from '../_shared/bot-protection.ts';
import {adminDb,query,hash,secret} from '../_shared/services.ts';
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'',allowed=(Deno.env.get('ALLOWED_ORIGINS')||'').split(',').map(s=>s.trim());
 const headers={'Access-Control-Allow-Origin':allowed.includes(origin)?origin:'null','Access-Control-Allow-Headers':'apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Vary':'Origin'};
 const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json'}});
 if(origin&&!allowed.includes(origin))return json({error:'Origin not allowed'},403);
 if(req.method==='OPTIONS')return new Response(null,{headers});
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 try{
  const raw=await req.text();if(raw.length>4096)return json({error:'คำขอใหญ่เกินไป'},413);const input=JSON.parse(raw),db=adminDb();
  if(input.action==='security-config')return json(captchaConfig());
  await protectAccountRequest(db,req,input);
  if(input.action==='forgot'){
   if(typeof input.student_id!=='string'||!/^\d{5,20}$/.test(input.student_id))return json({error:'กรุณาระบุรหัสนักศึกษาให้ถูกต้อง'},400);
   const ip=(req.headers.get('x-forwarded-for')||'unknown').split(',').at(-1)!.trim();
   const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,'0');
   const pepper=secret('SUPABASE_SERVICE_ROLE_KEY');
   const codeHash=await hash(pepper+':finance-medtech-password-recovery:'+input.student_id+':'+code);
   const request=await query(db.rpc('request_line_recovery_otp',{p_student:input.student_id,p_student_hash:await hash(input.student_id),p_ip_hash:await hash(ip),p_code_hash:codeHash}));
   if(request?.id&&request?.line_user_id){
    try{
     const sent=await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:'Bearer '+secret('LINE_CHANNEL_ACCESS_TOKEN'),'Content-Type':'application/json'},body:JSON.stringify({to:request.line_user_id,messages:[{type:'text',text:'รหัส OTP สำหรับตั้งรหัสผ่านใหม่ของ finance MEDTECH คือ '+code+'\nรหัสมีอายุ 5 นาทีและใช้ได้ครั้งเดียว หากไม่ได้เป็นผู้ขอ สามารถละเว้นข้อความนี้ได้'}]}),signal:AbortSignal.timeout(15000)});
     if(!sent.ok)throw Error('LINE HTTP '+sent.status);
    }catch(error){
     await query(db.from('password_recovery_otps').update({consumed_at:new Date().toISOString()}).eq('id',request.id));
     console.warn('Password recovery OTP delivery failed');
    }
   }
   return json({message:'หากรหัสนักศึกษานี้มีบัญชีและเชื่อม LINE ไว้ ระบบจะส่งรหัส OTP ไปยัง LINE ที่ผูกบัญชี กรุณาตรวจสอบแชต LINE'});
  }
  if(input.action==='check-otp'){
   if(typeof input.student_id!=='string'||!/^\\d{5,20}$/.test(input.student_id)||typeof input.otp!=='string'||!/^\\d{6}$/.test(input.otp))return json({valid:false});
   const pepper=secret('SUPABASE_SERVICE_ROLE_KEY');
   const codeHash=await hash(pepper+':finance-medtech-password-recovery:'+input.student_id+':'+input.otp);
   const valid=await query(db.rpc('check_line_recovery_otp',{p_student:input.student_id,p_code_hash:codeHash}));
   return json({valid:valid===true});
  }
  if(input.action==='verify-otp'){
   if(typeof input.student_id!=='string'||!/^\d{5,20}$/.test(input.student_id)||typeof input.otp!=='string'||!/^\d{6}$/.test(input.otp)||typeof input.password!=='string'||input.password.length<6||input.password.length>128)return json({error:'กรุณาตรวจสอบรหัสนักศึกษา รหัส OTP และรหัสผ่านใหม่'},400);
   const pepper=secret('SUPABASE_SERVICE_ROLE_KEY');
   const codeHash=await hash(pepper+':finance-medtech-password-recovery:'+input.student_id+':'+input.otp);
   const profileId=await query(db.rpc('verify_line_recovery_otp',{p_student:input.student_id,p_code_hash:codeHash}));
   if(!profileId)return json({error:'รหัส OTP ไม่ถูกต้อง หมดอายุ หรือถูกใช้แล้ว กรุณาขอรหัสใหม่'},400);
   const changed=await db.auth.admin.updateUserById(profileId,{password:input.password});
   if(changed.error)throw Error('เปลี่ยนรหัสผ่านไม่สำเร็จ กรุณาขอ OTP ใหม่');
   return json({message:'ตั้งรหัสผ่านใหม่สำเร็จ'});
  }
  if(!['invite-preview','invite-accept','batch-start','batch-state','batch-accept','batch-reset-line'].includes(input.action)||typeof input.token!=='string'||!/^[0-9a-f]{64}$/.test(input.token))return json({error:'ลิงก์ไม่ถูกต้อง'},400);
  let tokenHash=await hash(input.token);
  if(input.action==='batch-start'){
   if(typeof input.student_id!=='string'||!/^\d{5,20}$/.test(input.student_id))throw Error('รหัสนักศึกษาไม่ถูกต้อง');
   const session=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''),code=crypto.randomUUID().replaceAll('-','').slice(0,16).toUpperCase();
   const person=await query(db.rpc('start_registration_session',{p_batch_hash:tokenHash,p_student:input.student_id,p_session_hash:await hash(session),p_code_hash:await hash(code)}));return json({person,session,code});
  }
  if(['batch-state','batch-accept','batch-reset-line'].includes(input.action)&&(typeof input.session!=='string'||!/^[0-9a-f]{64}$/.test(input.session)||typeof input.student_id!=='string'||!/^\d{5,20}$/.test(input.student_id)))throw Error('ข้อมูลการสมัครไม่ถูกต้อง');
  if(input.action==='batch-reset-line'){
   if(typeof input.discard!=='boolean')throw Error('ข้อมูลการสมัครไม่ถูกต้อง');
   const nextSession=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''),nextCode=crypto.randomUUID().replaceAll('-','').slice(0,16).toUpperCase();
   await query(db.rpc('reset_registration_line_session',{p_session_hash:await hash(input.session),p_batch_hash:tokenHash,p_student:input.student_id,p_discard:input.discard,p_new_session_hash:input.discard?null:await hash(nextSession),p_new_code_hash:input.discard?null:await hash(nextCode)}));
   return json(input.discard?{ok:true,discarded:true}:{ok:true,session:nextSession,code:nextCode});
  }
  if(input.action==='batch-state')return json(await query(db.rpc('registration_session_state',{p_session_hash:await hash(input.session),p_batch_hash:tokenHash,p_student:input.student_id,p_claim:false})));
  if(input.action==='invite-preview'){
   const batch=await query(db.from('registration_batches').select('id').eq('token_hash',tokenHash).maybeSingle());if(batch){const remaining=await query(db.from('member_invites').select('id').eq('batch_id',batch.id).in('status',['pending','processing']).limit(1));if(!remaining.length)return json({error:'สมาชิกในลิงก์นี้สมัครครบแล้ว หรือผู้ดูแลยกเลิกลิงก์แล้ว'},400);return json({batch:{reusable:true}})}
   const invite=await query(db.from('member_invites').select('student_id,name_prefix,first_name,last_name,year,expires_at').eq('token_hash',tokenHash).eq('status','pending').gt('expires_at',new Date().toISOString()).maybeSingle());
   if(!invite)return json({error:'ลิงก์หมดอายุหรือถูกใช้แล้ว กรุณาติดต่อผู้ดูแลระบบ'},400);
   return json({invite});
  }
  if(typeof input.password!=='string'||input.password.length<6||input.password.length>128)return json({error:'รหัสผ่านต้องมี 6–128 ตัวอักษร'},400);
  const invite=input.action==='batch-accept'?await query(db.rpc('registration_session_state',{p_session_hash:await hash(input.session),p_batch_hash:tokenHash,p_student:input.student_id,p_claim:true})):await query(db.rpc('claim_member_invite',{p_hash:tokenHash}));if(input.action==='batch-accept')tokenHash=invite.token_hash;let userId:string|null=null,completed=false;
  try{
   const created=await db.auth.admin.createUser({email:`${invite.student_id}@${Deno.env.get('STUDENT_EMAIL_DOMAIN')||'students.finance-medtech.invalid'}`,password:input.password,email_confirm:true});
   if(created.error||!created.data.user)throw Error('สร้างบัญชีไม่ได้ รหัสนักศึกษาอาจมีบัญชีแล้ว กรุณาติดต่อผู้ดูแลระบบ');
   userId=created.data.user.id;
   await query(db.rpc('finish_member_invite',{p_hash:tokenHash,p_user:userId}));completed=true;
   return json({ok:true});
  }catch(error){
   // Never undo an accepted signup when the finish response was lost.
   const state=await query(db.from('member_invites').select('status').eq('token_hash',tokenHash).single());
   if(state.status==='used')return json({ok:true});
   if(!completed){if(userId){const removed=await db.auth.admin.deleteUser(userId);if(removed.error)throw Error('สร้างบัญชีไม่สำเร็จ กรุณาติดต่อผู้ดูแลระบบ')}await query(db.from('member_invites').update({status:'pending'}).eq('token_hash',tokenHash).eq('status','processing'))}
   throw error;
  }
 }catch(error){return json({error:error instanceof Error?error.message:'ดำเนินการไม่สำเร็จ'},(error as any)?.status===429?429:400)}
});
