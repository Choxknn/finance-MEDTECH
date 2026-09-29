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
  const profile=await query(db.from('profiles').select('*').eq('id',auth.data.user.id).eq('active',true).single());
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
    const allPayments=await query(db.from('payments').select('id,charge_id,profile_id,amount,status,drive_file_id,trans_ref,source,note,created_at').order('created_at'));
    const allExpenses=await query(db.from('expenses').select('*').order('spent_on',{ascending:false}));
    const accounts=await query(isAdmin?db.from('line_accounts').select('profile_id'):db.from('line_accounts').select('profile_id').eq('profile_id',profile.id));
    const profiles=(await query(isAdmin?db.from('profiles').select('id,student_id,name,year,role,active'):db.from('profiles').select('id,student_id,name,year,role,active').eq('id',profile.id))).map((p:any)=>({...p,line_linked:accounts.some((a:any)=>a.profile_id===p.id)}));
    const notifications=await query(isAdmin?db.from('notifications').select('id,profile_id,title,body,status,created_at').order('created_at',{ascending:false}).limit(200):db.from('notifications').select('id,profile_id,title,body,status,created_at').eq('profile_id',profile.id).order('created_at',{ascending:false}).limit(100));
    const audit=isAdmin?await query(db.from('audit').select('*').order('created_at',{ascending:false}).limit(200)):[];
    const expenseTotal=allExpenses.reduce((s:number,e:any)=>s+Number(e.amount),0),income=allPayments.filter((p:any)=>p.status==='approved').reduce((s:number,p:any)=>s+Number(p.amount),0);
    const expenses=isAdmin?allExpenses:allExpenses.map(({drive_file_id,created_by,...e}:any)=>e);
    return json({profile:profiles.find((p:any)=>p.id===profile.id),data:{rounds,charges,profiles,payments:isAdmin?allPayments:allPayments.filter((p:any)=>p.profile_id===profile.id),expenses,notifications,audit,fund_totals:{income,expense:expenseTotal}}});
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
    requireAdmin();const p=await query(db.from('profiles').select('*').eq('id',input.profile_id).eq('active',true).single());
    const recent=await query(db.from('notifications').select('id').eq('profile_id',p.id).gte('created_at',new Date(Date.now()-60000).toISOString()).limit(1));if(recent.length)throw new Error('เพิ่งส่งข้อความ กรุณารออย่างน้อย 1 นาที');
    const cs=await query(db.from('charges').select('id,amount').eq('profile_id',p.id)),ps=await query(db.from('payments').select('amount').eq('profile_id',p.id).eq('status','approved'));
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
