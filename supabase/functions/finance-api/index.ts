import {adminDb,query,secret,hash,uploadDrive,deleteDrive,driveToken,checkSlip,notify,validateImage} from '../_shared/services.ts';
const text=(v:unknown,max=500)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new Error('ข้อมูลข้อความไม่ถูกต้อง');return v.trim()};
const amount=(v:unknown)=>{const n=Number(v);if(!Number.isFinite(n)||n<=0||n>1000000||Math.abs(n*100-Math.round(n*100))>1e-6)throw new Error('จำนวนเงินไม่ถูกต้อง');return n};
const day=(v:unknown)=>{const s=text(v,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||new Date(s).toISOString().slice(0,10)!==s)throw new Error('วันที่ไม่ถูกต้อง');return s};
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'',allowed=(Deno.env.get('ALLOWED_ORIGINS')||'').split(',').map(s=>s.trim());
 const cors={'Access-Control-Allow-Origin':allowed.includes(origin)?origin:'null','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,GET,OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
 const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});
 if(origin&&!allowed.includes(origin))return json({error:'Origin not allowed'},403);
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 if(!['POST','GET'].includes(req.method))return json({error:'Method not allowed'},405);
 try{
  const db=adminDb(),bearer=req.headers.get('authorization')?.replace(/^Bearer /,'');if(!bearer)return json({error:'กรุณาเข้าสู่ระบบ'},401);
  const auth=await db.auth.getUser(bearer);if(auth.error||!auth.data.user)return json({error:'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'},401);
  const profile=await query(db.from('profiles').select('*').eq('id',auth.data.user.id).eq('active',true).is('deleted_at',null).single());
  const isAdmin=profile.role==='admin';const requireAdmin=()=>{if(!isAdmin)throw new Error('ไม่มีสิทธิ์ดำเนินการ')};
  if(req.method==='GET'){
   const url=new URL(req.url),kind=url.searchParams.get('kind'),id=url.searchParams.get('id');
   if(url.searchParams.get('action')!=='download'||!['payment','expense'].includes(kind||''))return json({error:'Not found'},404);
   if(kind==='expense')requireAdmin();const record=await query(db.from(kind==='payment'?'payments':'expenses').select('*').eq('id',id).single());
   if(kind==='payment'&&!isAdmin&&record.profile_id!==profile.id)throw new Error('ไม่มีสิทธิ์เข้าถึงหลักฐาน');
   if(!record.drive_file_id)throw new Error('ยังไม่มีไฟล์หลักฐาน');const access=await driveToken();
   const r=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(record.drive_file_id)}?alt=media&supportsAllDrives=true`,{headers:{Authorization:`Bearer ${access}`},signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('เปิดหลักฐานไม่สำเร็จ');return new Response(r.body,{headers:{...cors,'Content-Type':r.headers.get('Content-Type')||'application/octet-stream','X-Content-Type-Options':'nosniff'}});
  }
  let input:any,file:File|null=null;
  if(req.headers.get('content-type')?.startsWith('multipart/form-data')){const fd=await req.formData();input={...JSON.parse(String(fd.get('payload')||'{}')),action:fd.get('action')};file=fd.get('file') as File|null}else input=await req.json();
  switch(input.action){
   case 'bootstrap':{
    const rounds=await query(db.from('rounds').select('*').order('created_at'));
    const charges=await query(isAdmin?db.from('charges').select('*'):db.from('charges').select('*').eq('profile_id',profile.id));
    const allPayments=await query(db.from('payments').select('id,charge_id,profile_id,amount,status,drive_file_id,trans_ref,source,note,reviewed_at,created_at,deleted_at').order('created_at'));
    const allIncomes=await query(db.from('manual_incomes').select('*').order('received_on',{ascending:false}));
    const allExpenses=await query(db.from('expenses').select('*').order('spent_on',{ascending:false}));
    const accounts=await query(isAdmin?db.from('line_accounts').select('profile_id'):db.from('line_accounts').select('profile_id').eq('profile_id',profile.id));
    const profiles=(await query(isAdmin?db.from('profiles').select('id,student_id,name,year,role,active,deleted_at,phone,contact_email,profile_note'):db.from('profiles').select('id,student_id,name,year,role,active,deleted_at,phone,contact_email,profile_note').eq('id',profile.id))).map((p:any)=>{if(!isAdmin)delete p.profile_note;return {...p,line_linked:accounts.some((a:any)=>a.profile_id===p.id)}});
    const notifications=await query(isAdmin?db.from('notifications').select('id,profile_id,title,body,status,created_at').order('created_at',{ascending:false}).limit(200):db.from('notifications').select('id,profile_id,title,body,status,created_at').eq('profile_id',profile.id).order('created_at',{ascending:false}).limit(100));
    const audit=isAdmin?await query(db.from('audit').select('*').order('created_at',{ascending:false}).limit(200)):[];
    const settings=await query(db.from('site_settings').select('data').eq('id',true).single());
    const expenseTotal=allExpenses.filter((e:any)=>!e.voided&&!e.deleted_at).reduce((s:number,e:any)=>s+Number(e.amount),0),income=allIncomes.filter((i:any)=>!i.deleted_at).reduce((s:number,i:any)=>s+Number(i.amount),0)+allPayments.filter((p:any)=>p.status==='approved'&&!p.deleted_at).reduce((s:number,p:any)=>s+Number(p.amount),0);
    const incomes=isAdmin?allIncomes:allIncomes.map(({created_by,...i}:any)=>i);
    const expenses=isAdmin?allExpenses:allExpenses.map(({drive_file_id,created_by,...e}:any)=>e);
    const visiblePayments=(isAdmin?allPayments:allPayments.filter((p:any)=>p.profile_id===profile.id));
    const activeRounds=rounds.filter((r:any)=>!r.deleted_at),activeProfiles=profiles.filter((p:any)=>!p.deleted_at);
    const activeCharges=charges.filter((c:any)=>!c.deleted_at&&activeRounds.some((r:any)=>r.id===c.round_id)&&activeProfiles.some((p:any)=>p.id===c.profile_id));
    const trash=isAdmin?{member:profiles.filter((p:any)=>p.deleted_at),round:rounds.filter((r:any)=>r.deleted_at),charge:charges.filter((c:any)=>c.deleted_at),payment:allPayments.filter((p:any)=>p.deleted_at),income:allIncomes.filter((i:any)=>i.deleted_at),expense:allExpenses.filter((e:any)=>e.deleted_at)}:{};
    return json({profile:profiles.find((p:any)=>p.id===profile.id),data:{settings:settings.data,rounds:activeRounds,charges:activeCharges,profiles:activeProfiles,payments:visiblePayments.filter((p:any)=>!p.deleted_at),incomes:incomes.filter((i:any)=>!i.deleted_at),expenses:expenses.filter((e:any)=>!e.deleted_at),references:{rounds,charges,profiles},trash,notifications,audit,fund_totals:{income,expense:expenseTotal}}});
   }
   case 'save-income':{
    requireAdmin();const patch={title:text(input.title,120),category:text(input.category,100),amount:amount(input.amount),received_on:day(input.received_on),note:String(input.note||'').slice(0,500),reason:input.id?text(input.reason,500):'เพิ่มรายรับ'};
    if(input.id&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id))throw new Error('รหัสรายการไม่ถูกต้อง');
    await query(db.rpc('save_manual_income',{p_id:input.id||null,p_patch:patch,p_actor:profile.id}));return json({ok:true});
   }
   case 'delete-records':{
    requireAdmin();const entity=text(input.entity,20);if(!['member','round','charge','payment','expense','income'].includes(entity)||!Array.isArray(input.ids)||!input.ids.length||input.ids.length>500||typeof input.deleted!=='boolean')throw new Error('ข้อมูลรายการไม่ถูกต้อง');
    const ids=input.ids.map((id:unknown)=>{const s=text(id,36);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))throw new Error('รหัสรายการไม่ถูกต้อง');return s});
    await query(db.rpc('delete_records',{p_entity:entity,p_ids:ids,p_deleted:input.deleted,p_reason:text(input.reason,500),p_actor:profile.id}));return json({ok:true});
   }
   case 'edit-self':{
    const year=String(input.year||'');if(!['1','2','3','4',''].includes(year))throw new Error('ชั้นปีไม่ถูกต้อง');const email=String(input.contact_email||'').trim();if(email&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254))throw new Error('อีเมลไม่ถูกต้อง');
    await query(db.rpc('update_own_profile',{p_actor:profile.id,p_name:text(input.name,120),p_year:year,p_phone:String(input.phone||'').slice(0,30),p_email:email}));return json({ok:true});
   }
   case 'unlink-line':{
    requireAdmin();const target=await query(db.from('profiles').select('id,student_id').eq('id',input.id).is('deleted_at',null).single());await query(db.from('line_accounts').delete().eq('profile_id',target.id));await query(db.from('line_link_codes').delete().eq('profile_id',target.id));await query(db.from('audit').insert({actor:profile.name,action:'ยกเลิกการเชื่อม LINE '+target.student_id}));return json({ok:true});
   }
   case 'save-settings':{
    requireAdmin();const s=input.settings||{},value:any={siteName:text(s.siteName,80),bankName:text(s.bankName,120),accountName:text(s.accountName,120),accountNumber:text(s.accountNumber,40),lineOaUrl:String(s.lineOaUrl||''),paymentQrUrl:String(s.paymentQrUrl||'')};
    if(value.lineOaUrl&&!/^https:\/\/(lin\.ee|line\.me)\//.test(value.lineOaUrl))throw new Error('ลิงก์ LINE ต้องมาจาก lin.ee หรือ line.me');
    if(file){const image=await validateImage(file);if(image.size>1024*1024)throw new Error('QR ต้องไม่เกิน 1 MB');const bytes=new Uint8Array(await image.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);value.paymentQrUrl=`data:${image.type};base64,${btoa(binary)}`}
    else if(value.paymentQrUrl!=='./payment-qr.png'&&!/^https:\/\//.test(value.paymentQrUrl)&&!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value.paymentQrUrl))throw new Error('URL QR ไม่ถูกต้อง');
    if(value.paymentQrUrl.length>1500000)throw new Error('QR ใหญ่เกินไป');
    await query(db.rpc('save_settings',{p_values:value,p_actor:profile.id}));return json({ok:true});
   }
   case 'edit-record':{
    requireAdmin();const entity=text(input.entity,20),s=input.patch||{};let patch:any;
    if(entity==='member'){if(!['member','admin'].includes(s.role)||typeof s.active!=='boolean'||!['1','2','3','4',''].includes(String(s.year)))throw new Error('สิทธิ์ สถานะ หรือชั้นปีไม่ถูกต้อง');patch={name:text(s.name,120),year:String(s.year),role:s.role,active:s.active,phone:String(s.phone||'').slice(0,30),contact_email:String(s.contact_email||'').slice(0,254),profile_note:String(s.profile_note||'').slice(0,1000)}}
    else if(entity==='round'){if(typeof s.archived!=='boolean')throw new Error('สถานะไม่ถูกต้อง');patch={title:text(s.title,120),description:String(s.description||'').slice(0,1000),amount:amount(s.amount),due_date:day(s.due_date),archived:s.archived}}
    else if(entity==='expense'){if(typeof s.voided!=='boolean')throw new Error('สถานะไม่ถูกต้อง');patch={title:text(s.title,120),category:text(s.category,100),amount:amount(s.amount),spent_on:day(s.spent_on),note:String(s.note||'').slice(0,500),voided:s.voided,reason:text(s.reason,500)}}
    else if(entity==='payment')patch={note:String(s.note||'').slice(0,500)};
    else if(entity==='charge')patch={amount:amount(s.amount),reason:text(s.reason,500)};
    else throw new Error('ชนิดรายการไม่ถูกต้อง');
    const table={member:'profiles',round:'rounds',charge:'charges',payment:'payments',expense:'expenses'}[entity];await query(db.from(table!).select('id').eq('id',input.id).is('deleted_at',null).single());
    let driveId:string|undefined;if(file){if(entity!=='expense')throw new Error('รายการนี้ไม่รองรับไฟล์');const image=await validateImage(file);driveId=await uploadDrive(image,`expense-edit-${crypto.randomUUID()}.${image.type.split('/')[1]}`);patch.drive_file_id=driveId}
    try{await query(db.rpc('manage_record',{p_entity:entity,p_id:text(input.id,36),p_patch:patch,p_actor:profile.id}))}catch(e){if(driveId)await deleteDrive(driveId);throw e}
    return json({ok:true});
   }
   case 'change-student-id':{
    requireAdmin();const sid=text(input.student_id,20);if(!/^\d{5,20}$/.test(sid))throw new Error('รหัสนักศึกษาไม่ถูกต้อง');const target=await query(db.from('profiles').select('id,student_id,role').eq('id',input.id).is('deleted_at',null).single());
    if(target.student_id===sid)return json({ok:true});const duplicate=await query(db.from('profiles').select('id').eq('student_id',sid).maybeSingle());if(duplicate)throw new Error('รหัสนี้มีบัญชีแล้ว');
    const domain=Deno.env.get('STUDENT_EMAIL_DOMAIN')||'students.finance-medtech.invalid',authResult=await db.auth.admin.updateUserById(target.id,{email:`${sid}@${domain}`,email_confirm:true});if(authResult.error)throw new Error('เปลี่ยนข้อมูลเข้าสู่ระบบไม่สำเร็จ');
    try{await query(db.from('profiles').update({student_id:sid}).eq('id',target.id))}catch(e){const rollback=await db.auth.admin.updateUserById(target.id,{email:`${target.student_id}@${domain}`,email_confirm:true});if(rollback.error)throw new Error('ข้อมูลเข้าสู่ระบบเปลี่ยนแล้ว แต่บันทึกรหัสไม่สำเร็จ กรุณาติดต่อผู้ดูแลระบบ');throw e}
    await query(db.from('audit').insert({actor:profile.name,action:'เปลี่ยนรหัสนักศึกษา',details:{profile_id:target.id,before:target.student_id,after:sid}}));return json({ok:true});
   }
   case 'reset-password':{
    requireAdmin();const target=await query(db.from('profiles').select('id,student_id,role').eq('id',input.id).is('deleted_at',null).single());if(target.id===profile.id)throw new Error('ใช้ปุ่มเปลี่ยนรหัสผ่านของฉันสำหรับบัญชีตัวเอง');const password=text(input.password,128);if(password.length<12)throw new Error('รหัสผ่านต้องมีอย่างน้อย 12 ตัวอักษร');
    const result=await db.auth.admin.updateUserById(target.id,{password});if(result.error)throw new Error('เปลี่ยนรหัสผ่านไม่สำเร็จ');
    await query(db.from('audit').insert({actor:profile.name,action:'รีเซ็ตรหัสผ่านสมาชิก '+target.student_id}));return json({ok:true});
   }
   case 'import-members':{
    requireAdmin();if(!Array.isArray(input.rows)||!input.rows.length||input.rows.length>25)throw new Error('นำเข้าได้ครั้งละ 1–25 คน');
    const seen=new Set<string>();const rows=input.rows.map((r:any)=>{const sid=text(r.student_id,20),password=text(r.password,128),name=text(r.name,120),year=text(r.year,1);if(!/^\d{5,20}$/.test(sid)||password.length<12||!['1','2','3','4'].includes(year)||seen.has(sid))throw new Error('ตรวจรหัสนักศึกษา ชั้นปี รหัสผ่าน และข้อมูลซ้ำใน CSV');seen.add(sid);return {sid,password,name,year}});
    const results=[];for(const r of rows){const existing=await query(db.from('profiles').select('id').eq('student_id',r.sid).maybeSingle());if(existing){results.push({student_id:r.sid,status:'skipped',message:'มีบัญชีอยู่แล้ว'});continue}
     const {data,error}=await db.auth.admin.createUser({email:`${r.sid}@${Deno.env.get('STUDENT_EMAIL_DOMAIN')||'students.finance-medtech.invalid'}`,password:r.password,email_confirm:true});if(error){results.push({student_id:r.sid,status:'failed',message:'สร้างบัญชีไม่สำเร็จ'});continue}
     try{await query(db.from('profiles').insert({id:data.user!.id,student_id:r.sid,name:r.name,year:r.year,role:'member'}));await query(db.from('audit').insert({actor:profile.name,action:'นำเข้าสมาชิก CSV '+r.sid}));results.push({student_id:r.sid,status:'created',message:'เพิ่มแล้ว'})}catch{await db.auth.admin.deleteUser(data.user!.id);results.push({student_id:r.sid,status:'failed',message:'บันทึกข้อมูลไม่สำเร็จ'})}
    }return json({results});
   }
   case 'assign-round':{
    requireAdmin();const r=await query(db.from('rounds').select('*').eq('id',input.round_id).eq('archived',false).is('deleted_at',null).single());const p=await query(db.from('profiles').select('id,student_id').eq('id',input.profile_id).eq('role','member').eq('active',true).is('deleted_at',null).single());
    await query(db.from('charges').insert({profile_id:p.id,round_id:r.id,amount:r.amount}));await query(db.from('audit').insert({actor:profile.name,action:'เพิ่ม '+p.student_id+' ในรอบ '+r.title}));return json({ok:true});
   }
   case 'new-round':requireAdmin();await query(db.rpc('create_round',{p_title:text(input.title,120),p_description:String(input.description||'').slice(0,1000),p_amount:amount(input.amount),p_due:day(input.due_date),p_actor:profile.name}));return json({ok:true});
   case 'new-member':{
    requireAdmin();const sid=text(input.student_id,20);if(!/^\d{5,20}$/.test(sid))throw new Error('รหัสนักศึกษาไม่ถูกต้อง');const password=text(input.password,128);if(password.length<12)throw new Error('รหัสผ่านต้องมีอย่างน้อย 12 ตัวอักษร');const name=text(input.name,120);const year=text(input.year,2);if(!['1','2','3','4'].includes(year))throw new Error('ชั้นปีไม่ถูกต้อง');
    const {data,error}=await db.auth.admin.createUser({email:`${sid}@${Deno.env.get('STUDENT_EMAIL_DOMAIN')||'students.finance-medtech.invalid'}`,password,email_confirm:true});if(error)throw new Error('สร้างบัญชีไม่ได้ รหัสนักศึกษาอาจมีอยู่แล้ว');
    try{await query(db.from('profiles').insert({id:data.user!.id,student_id:sid,name,year,role:'member'}))}catch(e){await db.auth.admin.deleteUser(data.user!.id);throw e}
    await query(db.from('audit').insert({actor:profile.name,action:'เพิ่มสมาชิก '+sid}));return json({ok:true});
   }
   case 'submit-payment':{
    const image=await validateImage(file),value=amount(input.amount),charge=await query(db.from('charges').select('*,rounds(title,created_at)').eq('id',input.charge_id).single());if(charge.profile_id!==profile.id)throw new Error('ไม่มีสิทธิ์ในรายการนี้');
    // Check required configuration before reserving or charging vendor quota.
    for(const k of ['SLIPOK_BRANCH_ID','SLIPOK_API_KEY','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REFRESH_TOKEN','GOOGLE_DRIVE_FOLDER_ID'])secret(k);
    const pid=await query(db.rpc('reserve_payment',{p_profile:profile.id,p_charge:charge.id,p_amount:value}));
    let driveId:string;
    try{driveId=await uploadDrive(image,`slip-${pid}.${image.type.split('/')[1]}`);await query(db.from('payments').update({drive_file_id:driveId}).eq('id',pid))}
    catch{await query(db.from('payments').update({status:'rejected',note:'บันทึกหลักฐานไม่สำเร็จ กรุณาส่งใหม่'}).eq('id',pid));return json({message:'บันทึกหลักฐานไม่สำเร็จ กรุณาส่งใหม่'});}
    let verified=false,note='ระบบตรวจสอบอัตโนมัติไม่สำเร็จ รอแอดมินตรวจ';
    try{
     const result=await checkSlip(image,value),detail=result.body.data;
     // Old transfers must not automatically pay a newly created round.
     const transferred=detail?.transTimestamp?Date.parse(detail.transTimestamp):NaN;
     const validDate=Number.isFinite(transferred)&&transferred>=Date.parse(charge.rounds.created_at)&&transferred<=Date.now()+300000;
     await query(db.from('payments').update({verification:result.body}).eq('id',pid));
     if(result.ok&&validDate){await query(db.rpc('decide_payment',{p_id:pid,p_decision:'approved',p_note:'ตรวจสอบผ่าน SlipOK',p_ref:String(detail.transRef),p_actor:null}));verified=true;note='ยืนยันการชำระเงินแล้ว'}
     else note='ผลตรวจต้องตรวจเพิ่มเติม: '+String(result.body.message||detail?.message||'ยอด บัญชี หรือวันที่ไม่ตรง');
    }catch{note='ตรวจสอบอัตโนมัติไม่สำเร็จ หรือพบเลขอ้างอิงซ้ำ รอแอดมินตรวจ';}
    if(!verified)await query(db.from('payments').update({status:'review',note:note.slice(0,500)}).eq('id',pid).eq('status','pending'));
    if(verified)await notify(db,profile.id,`finance MEDTECH\nยืนยันชำระ ${charge.rounds.title}\nจำนวน ${value.toFixed(2)} บาท`);
    return json({message:verified?'ยืนยันการชำระแล้ว':'บันทึกสลิปแล้ว รอแอดมินตรวจสอบ',payment_id:pid});
   }
   case 'retry-payment':{
    requireAdmin();
    const p=await query(db.from('payments').select('*,charges(rounds(title,created_at))').eq('id',input.payment_id).single());
    if(!['pending','review'].includes(p.status)||!p.drive_file_id)throw new Error('ตรวจซ้ำได้เฉพาะรายการที่รอตรวจและมีหลักฐาน');
    const access=await driveToken();const r=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(p.drive_file_id)}?alt=media&supportsAllDrives=true`,{headers:{Authorization:`Bearer ${access}`},signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw new Error('เปิดหลักฐานไม่สำเร็จ');
    const blob=await r.blob();const image=await validateImage(new File([blob],'slip',{type:blob.type}));
    const result=await checkSlip(image,Number(p.amount)),detail=result.body.data;
    await query(db.from('payments').update({verification:result.body}).eq('id',p.id));
    const transferred=detail?.transTimestamp?Date.parse(detail.transTimestamp):NaN;
    const validDate=Number.isFinite(transferred)&&transferred>=Date.parse(p.charges.rounds.created_at)&&transferred<=Date.now()+300000;
    if(result.ok&&validDate){
     await query(db.rpc('decide_payment',{p_id:p.id,p_decision:'approved',p_note:'ตรวจสอบผ่าน SlipOK (ตรวจซ้ำ)',p_ref:String(detail.transRef),p_actor:null}));
     await notify(db,p.profile_id,`finance MEDTECH\nยืนยันชำระ ${p.charges.rounds.title}\nจำนวน ${Number(p.amount).toFixed(2)} บาท`);
     return json({message:'SlipOK ยืนยันการชำระแล้ว'});
    }
    const note='ผลตรวจต้องตรวจเพิ่มเติม: '+String(result.body.message||detail?.message||'ยอด บัญชี หรือวันที่ไม่ตรง');
    await query(db.from('payments').update({note:note.slice(0,500)}).eq('id',p.id).in('status',['pending','review']));
    return json({message:note});
   }
   case 'review':{
    requireAdmin();const decision=text(input.decision,20);if(!['approved','rejected'].includes(decision))throw new Error('สถานะไม่ถูกต้อง');const p=await query(db.from('payments').select('*').eq('id',input.payment_id).single());
    await query(db.rpc('decide_payment',{p_id:p.id,p_decision:decision,p_note:text(input.note,500),p_ref:String(input.trans_ref||'').slice(0,100),p_actor:profile.id}));
    await notify(db,p.profile_id,`finance MEDTECH\n${decision==='approved'?'ยืนยันรับเงินแล้ว':'กรุณาแก้ไขหลักฐาน'}\nจำนวน ${Number(p.amount).toFixed(2)} บาท\n${input.note}`);return json({ok:true});
   }
   case 'new-expense':{
    requireAdmin();const image=await validateImage(file),title=text(input.title,120),category=text(input.category,100),value=amount(input.amount),spentOn=day(input.spent_on),id=crypto.randomUUID();const driveId=await uploadDrive(image,`expense-${id}.${image.type.split('/')[1]}`);
    try{await query(db.from('expenses').insert({id,title,category,amount:value,spent_on:spentOn,note:String(input.note||'').slice(0,500),drive_file_id:driveId,created_by:profile.id}))}catch(e){await deleteDrive(driveId);throw e}
    await query(db.from('audit').insert({actor:profile.name,action:'บันทึกรายจ่าย '+title}));return json({ok:true});
   }
   case 'remind':{
    requireAdmin();const p=await query(db.from('profiles').select('*').eq('id',input.profile_id).eq('active',true).is('deleted_at',null).single());
    const recent=await query(db.from('notifications').select('id').eq('profile_id',p.id).gte('created_at',new Date(Date.now()-60000).toISOString()).limit(1));if(recent.length)throw new Error('เพิ่งส่งข้อความ กรุณารออย่างน้อย 1 นาที');
    const activeRounds=await query(db.from('rounds').select('id').is('deleted_at',null));const cs=(await query(db.from('charges').select('id,amount,round_id').eq('profile_id',p.id).is('deleted_at',null))).filter((c:any)=>activeRounds.some((r:any)=>r.id===c.round_id)),ps=(await query(db.from('payments').select('amount,charge_id').eq('profile_id',p.id).eq('status','approved').is('deleted_at',null))).filter((payment:any)=>cs.some((c:any)=>c.id===payment.charge_id));
    const outstanding=cs.reduce((s:number,c:any)=>s+Number(c.amount),0)-ps.reduce((s:number,x:any)=>s+Number(x.amount),0);if(outstanding<=0)throw new Error('ไม่มีเงินค้างชำระ');
    const result=await notify(db,p.id,`finance MEDTECH\nคุณ ${p.name}\nยอดค้างชำระ ${outstanding.toFixed(2)} บาท\nตรวจสอบรายการที่หน้าเว็บของกลุ่ม`);
    return json({message:result==='sent'?'ส่งการแจ้งเตือนแล้ว':result==='unlinked'?'สมาชิกยังไม่ได้เชื่อม LINE':'ส่ง LINE ไม่สำเร็จ ดูประวัติการแจ้งเตือน'});
   }
   case 'link-code':{
    const code=crypto.randomUUID().replaceAll('-','').slice(0,16).toUpperCase();await query(db.from('line_link_codes').delete().eq('profile_id',profile.id));await query(db.from('line_link_codes').insert({profile_id:profile.id,code_hash:await hash(code),expires_at:new Date(Date.now()+600000).toISOString()}));return json({code});
   }
   case 'file':{const kind=text(input.kind,10);if(!['payment','expense'].includes(kind))throw new Error('ชนิดรายการไม่ถูกต้อง');if(kind==='expense')requireAdmin();const record=await query(db.from(kind==='payment'?'payments':'expenses').select('*').eq('id',input.id).single());if(kind==='payment'&&!isAdmin&&record.profile_id!==profile.id)throw new Error('ไม่มีสิทธิ์เข้าถึง');return json({url:`${secret('SUPABASE_URL')}/functions/v1/finance-api?action=download&kind=${kind}&id=${encodeURIComponent(record.id)}`});}
   default:return json({error:'Action not found'},404);
  }
 }catch(e){return json({error:e instanceof Error?e.message:'ทำรายการไม่สำเร็จ'},400)}
});

