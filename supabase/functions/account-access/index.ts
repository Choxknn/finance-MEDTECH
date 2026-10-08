import {adminDb,query,hash,deliverNotification} from '../_shared/services.ts';
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'',allowed=(Deno.env.get('ALLOWED_ORIGINS')||'').split(',').map(s=>s.trim());
 const headers={'Access-Control-Allow-Origin':allowed.includes(origin)?origin:'null','Access-Control-Allow-Headers':'apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Vary':'Origin'};
 const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json'}});
 if(origin&&!allowed.includes(origin))return json({error:'Origin not allowed'},403);
 if(req.method==='OPTIONS')return new Response(null,{headers});
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 try{
  const raw=await req.text();if(raw.length>4096)return json({error:'คำขอใหญ่เกินไป'},413);const input=JSON.parse(raw),db=adminDb();
  if(input.action==='forgot'){
   if(typeof input.student_id!=='string'||!/^\d{5,20}$/.test(input.student_id))return json({error:'กรุณาระบุรหัสนักศึกษาให้ถูกต้อง'},400);
   const ip=(req.headers.get('x-forwarded-for')||'unknown').split(',').at(-1)!.trim();
   const nId=await query(db.rpc('request_line_recovery',{p_student:input.student_id,p_student_hash:await hash(input.student_id),p_ip_hash:await hash(ip)}));
   if(nId){const n=await query(db.from('notifications').select('*').eq('id',nId).single());await deliverNotification(db,n)}
   return json({message:'หากรหัสนักศึกษานี้เชื่อม LINE ไว้ ระบบจะส่งลิงก์ตั้งรหัสผ่านให้ กรุณาตรวจสอบแชต LINE OA หากไม่ได้รับข้อความหรือยังไม่เชื่อม LINE ให้ติดต่อผู้ดูแลระบบ'});
  }
  if(!['invite-preview','invite-accept','batch-start','batch-state','batch-accept'].includes(input.action)||typeof input.token!=='string'||!/^[0-9a-f]{64}$/.test(input.token))return json({error:'ลิงก์ไม่ถูกต้อง'},400);
  let tokenHash=await hash(input.token);
  if(input.action==='batch-start'){
   if(typeof input.student_id!=='string'||!/^\d{5,20}$/.test(input.student_id))throw Error('รหัสนักศึกษาไม่ถูกต้อง');
   const session=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''),code=crypto.randomUUID().replaceAll('-','').slice(0,16).toUpperCase();
   const person=await query(db.rpc('start_registration_session',{p_batch_hash:tokenHash,p_student:input.student_id,p_session_hash:await hash(session),p_code_hash:await hash(code)}));return json({person,session,code});
  }
  if(['batch-state','batch-accept'].includes(input.action)&&(typeof input.session!=='string'||!/^[0-9a-f]{64}$/.test(input.session)||typeof input.student_id!=='string'||!/^\d{5,20}$/.test(input.student_id)))throw Error('ข้อมูลการสมัครไม่ถูกต้อง');
  if(input.action==='batch-state')return json(await query(db.rpc('registration_session_state',{p_session_hash:await hash(input.session),p_batch_hash:tokenHash,p_student:input.student_id,p_claim:false})));
  if(input.action==='invite-preview'){
   const batch=await query(db.from('registration_batches').select('expires_at').eq('token_hash',tokenHash).gt('expires_at',new Date().toISOString()).maybeSingle());if(batch)return json({batch});
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
 }catch(error){return json({error:error instanceof Error?error.message:'ดำเนินการไม่สำเร็จ'},400)}
});
