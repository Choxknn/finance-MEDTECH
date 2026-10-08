import {financeSite} from '../_shared/line-flex.ts';
import {changeStudentLogin} from '../_shared/student-login.ts';
import {adminDb,query,secret,hash,uploadDrive,deleteDrive,driveToken,checkSlip,isRecentSlip,notify,paymentSuccess,deliverNotification,validateImage,validateReceipt} from '../_shared/services.ts';
const text=(v:unknown,max=500)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new Error('ข้อมูลข้อความไม่ถูกต้อง');return v.trim()};
const amount=(v:unknown)=>{const n=Number(v);if(!Number.isFinite(n)||n<=0||n>1000000||Math.abs(n*100-Math.round(n*100))>1e-6)throw new Error('จำนวนเงินไม่ถูกต้อง');return n};
const memberIds=(v:any)=>{if(!Array.isArray(v)||!v.length||v.length>500||v.some(x=>typeof x!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x)))throw new Error('เลือกสมาชิกที่ถูกต้อง 1–500 คน');return [...new Set(v)]};
const day=(v:unknown)=>{const s=text(v,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||new Date(s).toISOString().slice(0,10)!==s)throw new Error('วันที่ไม่ถูกต้อง');return s};
// Auth deletion must never wait behind failed Drive jobs.
async function cleanupAuthAccounts(db:any,limit=500){
 const jobs=await query(db.from('trash_cleanup_queue').select('id,target').eq('kind','auth').order('created_at').limit(limit));
 let failed=0;
 for(let offset=0;offset<jobs.length;offset+=10)await Promise.all(jobs.slice(offset,offset+10).map(async(job:any)=>{
  try{
   const owner=await query(db.from('profiles').select('id').eq('id',job.target).maybeSingle());
   if(owner)throw Error('Profile still exists');
   const result=await db.auth.admin.deleteUser(job.target);
   if(result.error&&result.error.code!=='user_not_found'&&result.error.status!==404)throw result.error;
   await query(db.from('trash_cleanup_queue').delete().eq('id',job.id));
  }catch{failed++}
 }));
 const remaining=await query(db.from('trash_cleanup_queue').select('id').eq('kind','auth').limit(1));
 return {processed:jobs.length-failed,failed,pending:remaining.length>0};
}
async function cleanupDriveFiles(db:any){
 const jobs=await query(db.from('trash_cleanup_queue').select('*').eq('kind','drive').order('created_at').limit(3));
 await Promise.all(jobs.map(async(job:any)=>{try{await deleteDrive(job.target,true);await query(db.from('trash_cleanup_queue').delete().eq('id',job.id))}catch{/* Keep failed file jobs for retry, independently of Auth. */}}));
}
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
   if(url.searchParams.get('action')!=='download'||!['payment','expense','expense-receipt','income','income-receipt'].includes(kind||''))return json({error:'Not found'},404);
   const table=kind==='payment'?'payments':kind?.startsWith('income')?'manual_incomes':'expenses';const record=await query(db.from(table).select('*').eq('id',id).single());if(kind!=='payment'&&!isAdmin&&(record.deleted_at||record.voided))throw Error('ไม่มีสิทธิ์เข้าถึงหลักฐานรายการนี้');
   if(kind==='payment'&&!isAdmin&&record.profile_id!==profile.id)throw new Error('ไม่มีสิทธิ์เข้าถึงหลักฐาน');
   const fileId=kind?.endsWith('-receipt')?record.receipt_file_id:record.drive_file_id;if(!fileId)throw new Error('ยังไม่มีไฟล์หลักฐาน');const access=await driveToken();
   const r=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,{headers:{Authorization:`Bearer ${access}`},signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('เปิดหลักฐานไม่สำเร็จ');return new Response(r.body,{headers:{...cors,'Content-Type':r.headers.get('Content-Type')||'application/octet-stream','X-Content-Type-Options':'nosniff'}});
  }
  let input:any,file:File|null=null,receiptFile:File|null=null;
  if(req.headers.get('content-type')?.startsWith('multipart/form-data')){const fd=await req.formData();input={...JSON.parse(String(fd.get('payload')||'{}')),action:fd.get('action')};file=fd.get('file') as File|null;receiptFile=fd.get('receipt') as File|null}else input=await req.json();
  switch(input.action){
   case 'prepare-members':{requireAdmin();const count=await query(db.rpc('prepare_registration_members',{p_rows:input.rows,p_actor:profile.id}));return json({count});}
   case 'create-registration-batch':{
    requireAdmin();const token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
    const id=await query(db.rpc('create_registration_batch',{p_ids:memberIds(input.ids),p_expires:input.expires_at,p_hash:await hash(token),p_actor:profile.id}));
    return json({id,url:financeSite+'register.html#token='+token,expires_at:input.expires_at});
   }
   case 'delete-fund-category':{requireAdmin();await query(db.rpc('delete_fund_category',{p_name:text(input.name,100),p_actor:profile.id}));return json({ok:true});}
   case 'create-password-link':{
    requireAdmin();const target=await query(db.from('profiles').select('id,student_id,name').eq('id',text(input.id,36)).eq('active',true).is('deleted_at',null).single());
    const account=await db.auth.admin.getUserById(target.id);if(account.error||!account.data.user?.email)throw Error('ไม่พบบัญชีสมาชิก');
    const link=await db.auth.admin.generateLink({type:'recovery',email:account.data.user.email});
    if(link.error||!link.data.properties?.hashed_token)throw Error('สร้างลิงก์เปลี่ยนรหัสผ่านไม่สำเร็จ');
    await query(db.from('audit').insert({actor:profile.name,action:'สร้างลิงก์เปลี่ยนรหัสผ่าน: '+target.student_id}));
    return json({url:financeSite+'reset-password.html#token_hash='+encodeURIComponent(link.data.properties.hashed_token),student_id:target.student_id,name:target.name});
   }
   case 'create-member-invite':{
    requireAdmin();const token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
    const id=await query(db.rpc('create_member_invite',{p_student:text(input.student_id,20),p_prefix:text(input.name_prefix,30),p_first:text(input.first_name,60),p_last:text(input.last_name,60),p_year:text(input.year,1),p_expires:input.expires_at,p_hash:await hash(token),p_actor:profile.id}));
    return json({id,url:financeSite+'register.html#token='+token,expires_at:input.expires_at});
   }
   case 'list-member-invites':{requireAdmin();return json({invites:await query(db.from('member_invites').select('id,student_id,name_prefix,first_name,last_name,expires_at,status,created_at,batch_id,year').order('created_at',{ascending:false}).limit(1000))});}
   case 'revoke-member-invite':{requireAdmin();await query(db.rpc('revoke_member_invite',{p_id:input.id,p_actor:profile.id}));return json({ok:true});}
   case 'cleanup-preview':case 'cleanup-history':{
    requireAdmin();const months=Number(input.months);if(!['notifications','audit'].includes(input.kind)||!Number.isInteger(months)||months<1||months>120)throw new Error('เลือกชนิดข้อมูลและจำนวนเดือน 1–120');
    const confirmed=input.action==='cleanup-history';if(confirmed&&(input.confirmation!=='ลบข้อมูล'||typeof input.anchor!=='string'||!Number.isFinite(Date.parse(input.anchor))))throw new Error('กรุณาตรวจสอบจำนวนรายการและยืนยันก่อนลบ');
    const result=await query(db.rpc('clear_old_messages',{p_kind:input.kind,p_months:months,p_actor:profile.id,p_confirmed:confirmed,p_anchor:confirmed?input.anchor:null}));return json(result);
   }
   case 'publish-announcement':{requireAdmin();const id=await query(db.rpc('publish_web_announcement',{p_title:text(input.title,120),p_body:text(input.body,2000),p_members:memberIds(input.profile_ids),p_actor:profile.id}));return json({id});}
   case 'dismiss-announcement':{await query(db.from('web_announcement_recipients').update({dismissed_at:new Date().toISOString()}).eq('announcement_id',text(input.id,36)).eq('profile_id',profile.id));return json({ok:true});}
   case 'delete-announcement':{requireAdmin();await query(db.from('web_announcements').delete().eq('id',text(input.id,36)));return json({ok:true});}
   case 'read-notification':{await query(db.from('notifications').update({seen_at:new Date().toISOString()}).eq('id',text(input.id,36)).eq('profile_id',profile.id));return json({ok:true});}
   case 'send-campaign':case 'process-campaign':{
    requireAdmin();const id=text(input.campaign_id,36);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw Error('รหัสชุดข้อความไม่ถูกต้อง');
    if(input.action==='send-campaign'){if(input.confirmation!=='ส่งข้อความ')throw Error('ยืนยันส่งข้อความก่อน');if(!['message','announcement','password'].includes(input.kind))throw Error('ประเภทข้อความไม่ถูกต้อง');await query(db.rpc('enqueue_campaign',{p_id:id,p_kind:input.kind,p_title:text(input.title,120),p_body:text(input.body,2000),p_members:memberIds(input.profile_ids),p_actor:profile.id}))}
    const jobs=await query(db.rpc('claim_campaign',{p_id:id,p_actor:profile.id}));for(let i=0;i<jobs.length;i+=5)await Promise.all(jobs.slice(i,i+5).map((n:any)=>deliverNotification(db,n)));
    const summary=await query(db.rpc('campaign_summary',{p_actor:profile.id,p_id:id}));if(!summary.length)throw Error('ไม่พบชุดข้อความ');return json({campaign:summary[0],processed:jobs.length});
   }
   case 'bootstrap':{
    await query(db.rpc('purge_trash',{p_all:false,p_actor:null}));
    const cleanupTask=Promise.allSettled([cleanupAuthAccounts(db,100),cleanupDriveFiles(db)]);
    const runtime=(globalThis as any).EdgeRuntime;if(runtime?.waitUntil)runtime.waitUntil(cleanupTask);else await cleanupTask;

    const rounds=await query(db.from('rounds').select('*').order('created_at'));
    const charges=await query(isAdmin?db.from('charges').select('*'):db.from('charges').select('*').eq('profile_id',profile.id));
    const totals=await query(db.rpc('charge_totals',{p_ids:charges.map((c:any)=>c.id)}));for(const c of charges)Object.assign(c,totals.find((t:any)=>t.id===c.id)||{});
    const allPayments=await query(db.from('payments').select('id,charge_id,profile_id,amount,status,drive_file_id,trans_ref,source,note,reviewed_at,created_at,deleted_at,charge_snapshot,member_snapshot').order('created_at'));
    const allIncomes=await query(db.from('manual_incomes').select('*').order('received_on',{ascending:false}));
    const allExpenses=await query(db.from('expenses').select('*').order('spent_on',{ascending:false}));
    const accounts=await query(isAdmin?db.from('line_accounts').select('profile_id,line_user_id'):db.from('line_accounts').select('profile_id').eq('profile_id',profile.id));
    const profiles=(await query(isAdmin?db.from('profiles').select('id,student_id,name,year,role,active,deleted_at,phone,contact_email,profile_note'):db.from('profiles').select('id,student_id,name,year,role,active,deleted_at,phone,contact_email,profile_note').eq('id',profile.id))).map((p:any)=>{if(!isAdmin)delete p.profile_note;return {...p,line_linked:accounts.some((a:any)=>a.profile_id===p.id),...(isAdmin?{line_user_id:accounts.find((a:any)=>a.profile_id===p.id)?.line_user_id||''}:{})}});
    const notifications=await query(db.from('notifications').select('id,profile_id,title,body,status,created_at,message_kind,campaign_id,seen_at').eq('profile_id',profile.id).order('created_at',{ascending:false}).limit(100));
    const recipients=await query(db.from('web_announcement_recipients').select('announcement_id,dismissed_at').eq('profile_id',profile.id));
    const allAnnouncements=await query(isAdmin?db.from('web_announcements').select('*').order('created_at',{ascending:false}).limit(100):db.from('web_announcements').select('*').in('id',recipients.map((r:any)=>r.announcement_id)).order('created_at',{ascending:false}).limit(100));
    const announcements=allAnnouncements.map((a:any)=>({...a,dismissed_at:recipients.find((r:any)=>r.announcement_id===a.id)?.dismissed_at||null,recipient:recipients.some((r:any)=>r.announcement_id===a.id)}));
    const campaigns=isAdmin?await query(db.rpc('campaign_summary',{p_actor:profile.id,p_id:null})):[];
    const audit=isAdmin?await query(db.from('audit').select('*').order('created_at',{ascending:false}).limit(200)):[];
    const paymentQrs=await query(db.from('payment_qrs').select('id,amount_cents,image_url').order('amount_cents'));
    const settings=await query(db.from('site_settings').select('data').eq('id',true).single());
    const expenseTotal=allExpenses.filter((e:any)=>!e.voided&&!e.deleted_at).reduce((s:number,e:any)=>s+Number(e.amount),0),income=allIncomes.filter((i:any)=>!i.deleted_at).reduce((s:number,i:any)=>s+Number(i.amount),0)+allPayments.filter((p:any)=>p.status==='approved'&&!p.deleted_at).reduce((s:number,p:any)=>s+Number(p.amount),0);
    const incomes=isAdmin?allIncomes:allIncomes.map(({created_by,...i}:any)=>i);
    const expenses=isAdmin?allExpenses:allExpenses.map(({created_by,...e}:any)=>e);
    // Expose only aggregate bill receipts, never other members' payment evidence or IDs.
    const collectionCharges=isAdmin?charges:await query(db.from('charges').select('id,round_id,round_snapshot'));
    const collectionMap=new Map<string,any>();
    for(const p of allPayments.filter((p:any)=>p.status==='approved'&&!p.deleted_at)){
     const c=collectionCharges.find((c:any)=>c.id===p.charge_id)||p.charge_snapshot;
     const rid=c?.round_id||c?.round_snapshot?.id||'archived';const r=rounds.find((r:any)=>r.id===rid)||c?.round_snapshot;
     const g=collectionMap.get(rid)||{id:rid,title:r?.title||'บิลที่เก็บถาวร',amount:0,count:0,last_at:null};g.amount+=Number(p.amount);g.count++;const at=p.reviewed_at||p.created_at;if(!g.last_at||at>g.last_at)g.last_at=at;collectionMap.set(rid,g);
    }
    const fundCollections=[...collectionMap.values()];
    const visiblePayments=(isAdmin?allPayments:allPayments.filter((p:any)=>p.profile_id===profile.id));
    const activeRounds=rounds.filter((r:any)=>!r.deleted_at),activeProfiles=profiles.filter((p:any)=>!p.deleted_at);
    const activeCharges=charges.filter((c:any)=>!c.deleted_at&&activeRounds.some((r:any)=>r.id===c.round_id)&&activeProfiles.some((p:any)=>p.id===c.profile_id));
    const trash=isAdmin?{member:profiles.filter((p:any)=>p.deleted_at),round:rounds.filter((r:any)=>r.deleted_at),charge:charges.filter((c:any)=>c.deleted_at),payment:allPayments.filter((p:any)=>p.deleted_at),income:allIncomes.filter((i:any)=>i.deleted_at),expense:allExpenses.filter((e:any)=>e.deleted_at)}:{};
    const refCharges=[...charges,...(isAdmin?allPayments:visiblePayments).filter((p:any)=>!p.charge_id&&p.charge_snapshot).map((p:any)=>p.charge_snapshot)].map((c:any)=>({...c,round_id:c.round_id||c.round_snapshot?.id,profile_id:c.profile_id||c.profile_snapshot?.id}));
    const refRounds=[...rounds,...refCharges.filter((c:any)=>c.round_snapshot&&!rounds.some((r:any)=>r.id===c.round_snapshot.id)).map((c:any)=>c.round_snapshot)];
    const refProfiles=[...profiles,...refCharges.map((c:any)=>c.profile_snapshot).filter(Boolean),...(isAdmin?allPayments:visiblePayments).map((p:any)=>p.member_snapshot).filter(Boolean)];
    for(const p of allPayments){p.charge_id??=p.charge_snapshot?.id;p.profile_id??=p.member_snapshot?.id;delete p.charge_snapshot;delete p.member_snapshot}
    return json({profile:profiles.find((p:any)=>p.id===profile.id),data:{fund_collections:fundCollections,campaigns,announcements,payment_qrs:paymentQrs,settings:settings.data,rounds:activeRounds,charges:activeCharges,profiles:activeProfiles,payments:visiblePayments.filter((p:any)=>!p.deleted_at),incomes:incomes.filter((i:any)=>!i.deleted_at),expenses:expenses.filter((e:any)=>!e.deleted_at),references:{rounds:refRounds,charges:refCharges,profiles:refProfiles},trash,notifications,audit,fund_totals:{income,expense:expenseTotal}}});
   }
   case 'save-income':{
    requireAdmin();const patch:any={responsible_name:text(input.responsible_name||profile.name,120),title:text(input.title,120),category:text(input.category,100),amount:amount(input.amount),received_on:day(input.received_on),note:String(input.note||'').slice(0,500),reason:input.id?text(input.reason,500):'เพิ่มรายรับ'};
    if(input.id&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id))throw new Error('รหัสรายการไม่ถูกต้อง');
    const uploaded:string[]=[];try{if(file){patch.drive_file_id=await uploadDrive(await validateImage(file),`income-${crypto.randomUUID()}`);uploaded.push(patch.drive_file_id)}if(receiptFile){patch.receipt_file_id=await uploadDrive(await validateReceipt(receiptFile),`income-receipt-${crypto.randomUUID()}`);uploaded.push(patch.receipt_file_id)}await query(db.rpc('save_manual_income',{p_id:input.id||null,p_patch:patch,p_actor:profile.id}))}catch(e){for(const id of uploaded)await deleteDrive(id);throw e}return json({ok:true});
   }
   case 'purge-trash':{
    requireAdmin();if(input.confirmation!=='ลบถาวร')throw new Error('ยืนยันลบถาวรก่อนดำเนินการ');const count=await query(db.rpc('purge_trash',{p_all:true,p_actor:profile.id}));const authCleanup=await cleanupAuthAccounts(db);if(authCleanup.pending)throw Error('ลบข้อมูลในถังขยะแล้ว แต่ยังลบบัญชีเข้าสู่ระบบไม่ครบ กรุณากดล้างถังขยะซ้ำเพื่อลองอีกครั้ง');return json({ok:true,count,authCleanup});
   }
   case 'delete-records':{
    requireAdmin();const entity=text(input.entity,20);if(!['member','round','charge','payment','expense','income'].includes(entity)||!Array.isArray(input.ids)||!input.ids.length||input.ids.length>500||typeof input.deleted!=='boolean')throw new Error('ข้อมูลรายการไม่ถูกต้อง');
    const ids=input.ids.map((id:unknown)=>{const s=text(id,36);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))throw new Error('รหัสรายการไม่ถูกต้อง');return s});
    await query(db.rpc('delete_records',{p_entity:entity,p_ids:ids,p_deleted:input.deleted,p_reason:text(input.reason,500),p_actor:profile.id}));return json({ok:true});
   }
   case 'edit-self':return json({error:'ข้อมูลโปรไฟล์แก้ไขได้โดยแอดมินเท่านั้น'},403);
   case 'add-fund-category':{requireAdmin();const result=await query(db.rpc('add_fund_category',{p_name:text(input.name,100),p_actor:profile.id}));return json({ok:true,result});}
   case 'set-line-destination':{requireAdmin();const lineId=text(input.line_user_id,33);if(!/^U[0-9a-f]{32}$/.test(lineId))throw Error('LINE User ID ไม่ถูกต้อง');await query(db.rpc('set_line_destination',{p_profile:input.id,p_line_user:lineId,p_actor:profile.id,p_reason:text(input.reason,500)}));return json({ok:true});}
   case 'unlink-line':{
    requireAdmin();const target=await query(db.from('profiles').select('id,student_id').eq('id',input.id).is('deleted_at',null).single());await query(db.from('line_accounts').delete().eq('profile_id',target.id));await query(db.from('line_link_codes').delete().eq('profile_id',target.id));await query(db.from('audit').insert({actor:profile.name,action:'ยกเลิกการเชื่อม LINE '+target.student_id}));return json({ok:true});
   }
   case 'save-payment-qr':{
    requireAdmin();const n=input.amount===''||input.amount==null?0:Number(input.amount);
    if(!Number.isFinite(n)||n<=0||n>1000000||Math.abs(n*100-Math.round(n*100))>1e-6)throw new Error('ยอด QR ไม่ถูกต้อง');
    const image=await validateImage(file);if(image.size>1024*1024)throw new Error('QR ต้องไม่เกิน 1 MB');
    const bytes=new Uint8Array(await image.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
    await query(db.rpc('manage_payment_qr',{p_cents:Math.round(n*100),p_image:`data:${image.type};base64,${btoa(binary)}`,p_delete:false,p_actor:profile.id}));return json({ok:true});
   }
   case 'delete-payment-qr':{
    requireAdmin();const n=Number(input.amount_cents);if(!Number.isInteger(n)||n<0||n>100000000)throw new Error('ยอด QR ไม่ถูกต้อง');
    await query(db.rpc('manage_payment_qr',{p_cents:n,p_image:null,p_delete:true,p_actor:profile.id}));return json({ok:true});
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
    else if(entity==='round'){if(typeof s.archived!=='boolean')throw new Error('สถานะไม่ถูกต้อง');patch={title:text(s.title,120),description:String(s.description||'').slice(0,1000),amount:amount(s.amount),due_date:day(s.due_date),archived:s.archived,profile_ids:memberIds(s.profile_ids),penalty_enabled:s.penalty_enabled===true,penalty_per_day:s.penalty_enabled===true?amount(s.penalty_per_day):0,penalty_max:s.penalty_enabled===true&&s.penalty_max!=null?amount(s.penalty_max):null}}
    else if(entity==='expense'){if(typeof s.voided!=='boolean')throw new Error('สถานะไม่ถูกต้อง');patch={responsible_name:text(s.responsible_name||profile.name,120),title:text(s.title,120),category:text(s.category,100),amount:amount(s.amount),spent_on:day(s.spent_on),note:String(s.note||'').slice(0,500),voided:s.voided,reason:text(s.reason,500)}}
    else if(entity==='payment')patch={note:String(s.note||'').slice(0,500)};
    else if(entity==='charge')patch={amount:amount(s.amount),reason:text(s.reason,500)};
    else throw new Error('ชนิดรายการไม่ถูกต้อง');
    const table={member:'profiles',round:'rounds',charge:'charges',payment:'payments',expense:'expenses'}[entity];await query(db.from(table!).select('id').eq('id',input.id).is('deleted_at',null).single());
    let driveId:string|undefined,receiptId:string|undefined;if(file){if(entity!=='expense')throw new Error('รายการนี้ไม่รองรับไฟล์');const image=await validateImage(file);driveId=await uploadDrive(image,`expense-edit-${crypto.randomUUID()}.${image.type.split('/')[1]}`);patch.drive_file_id=driveId}
    try{if(receiptFile){if(entity!=='expense')throw Error('รายการนี้ไม่รองรับใบเสร็จ');receiptId=await uploadDrive(await validateReceipt(receiptFile),`expense-receipt-${crypto.randomUUID()}`);patch.receipt_file_id=receiptId}await query(db.rpc('manage_record',{p_entity:entity,p_id:text(input.id,36),p_patch:patch,p_actor:profile.id}))}catch(e){if(driveId)await deleteDrive(driveId);if(receiptId)await deleteDrive(receiptId);throw e}
    return json({ok:true});
   }
   case 'change-student-id':{
    requireAdmin();const sid=text(input.student_id,20);if(!/^\d{5,20}$/.test(sid))throw new Error('รหัสนักศึกษาไม่ถูกต้อง');const target=await query(db.from('profiles').select('id,student_id,role').eq('id',input.id).is('deleted_at',null).single());
    if(target.student_id===sid)return json({ok:true});const duplicate=await query(db.from('profiles').select('id').eq('student_id',sid).maybeSingle());if(duplicate)throw new Error('รหัสนี้มีบัญชีแล้ว');
    const domain=Deno.env.get('STUDENT_EMAIL_DOMAIN')||'students.finance-medtech.invalid',loginChange=await changeStudentLogin(db,target.id,sid,domain);
    try{await query(db.from('profiles').update({student_id:sid}).eq('id',target.id))}catch(e){const rollback=await db.auth.admin.updateUserById(target.id,{email:loginChange.oldEmail,email_confirm:true});if(rollback.error)throw new Error('ข้อมูลเข้าสู่ระบบเปลี่ยนแล้ว แต่บันทึกรหัสไม่สำเร็จ กรุณาติดต่อผู้ดูแลระบบ');throw e}
    await query(db.from('audit').insert({actor:profile.name,action:'เปลี่ยนรหัสนักศึกษา',details:{profile_id:target.id,before:target.student_id,after:sid,retired_login_user_id:loginChange.retiredId}}));return json({ok:true});
   }
   case 'reset-password':{requireAdmin();throw Error('กรุณาสร้างลิงก์ให้สมาชิกตั้งรหัสผ่านเอง');}
   case 'import-members':{
    requireAdmin();if(!Array.isArray(input.rows)||!input.rows.length||input.rows.length>25)throw new Error('นำเข้าได้ครั้งละ 1–25 คน');
    const seen=new Set<string>();const rows=input.rows.map((r:any)=>{const sid=text(r.student_id,20),password=text(r.password,128),name=text(r.name,120),year=text(r.year,1);if(!/^\d{5,20}$/.test(sid)||password.length<6||!['1','2','3','4'].includes(year)||seen.has(sid))throw new Error('ตรวจรหัสนักศึกษา ชั้นปี รหัสผ่าน และข้อมูลซ้ำใน CSV');seen.add(sid);return {sid,password,name,year}});
    const results=[];for(const r of rows){const existing=await query(db.from('profiles').select('id').eq('student_id',r.sid).maybeSingle());if(existing){results.push({student_id:r.sid,status:'skipped',message:'มีบัญชีอยู่แล้ว'});continue}
     const {data,error}=await db.auth.admin.createUser({email:`${r.sid}@${Deno.env.get('STUDENT_EMAIL_DOMAIN')||'students.finance-medtech.invalid'}`,password:r.password,email_confirm:true});if(error){results.push({student_id:r.sid,status:'failed',message:'สร้างบัญชีไม่สำเร็จ'});continue}
     try{await query(db.from('profiles').insert({id:data.user!.id,student_id:r.sid,name:r.name,year:r.year,role:'member'}));await query(db.from('audit').insert({actor:profile.name,action:'นำเข้าสมาชิก CSV '+r.sid}));results.push({student_id:r.sid,status:'created',message:'เพิ่มแล้ว'})}catch{await db.auth.admin.deleteUser(data.user!.id);results.push({student_id:r.sid,status:'failed',message:'บันทึกข้อมูลไม่สำเร็จ'})}
    }return json({results});
   }
   case 'assign-round':{
    requireAdmin();const r=await query(db.from('rounds').select('*').eq('id',input.round_id).eq('archived',false).is('deleted_at',null).single());const p=await query(db.from('profiles').select('id,student_id').eq('id',input.profile_id).eq('role','member').eq('active',true).is('deleted_at',null).single());
    await query(db.from('charges').insert({profile_id:p.id,round_id:r.id,amount:r.amount}));await query(db.from('audit').insert({actor:profile.name,action:'เพิ่ม '+p.student_id+' ในรอบ '+r.title}));return json({ok:true});
   }
   case 'new-round':{requireAdmin();const id=await query(db.rpc('create_bill_with_notice',{p_title:text(input.title,120),p_description:String(input.description||'').slice(0,1000),p_amount:amount(input.amount),p_due:day(input.due_date),p_members:memberIds(input.profile_ids),p_penalty:input.penalty_enabled===true,p_rate:input.penalty_enabled===true?amount(input.penalty_per_day):0,p_actor:profile.id,p_max:input.penalty_enabled===true?amount(input.penalty_max):null,p_notify:input.notify_line===true}));if(input.notify_line===true){
     const task=(async()=>{const jobs=await query(db.rpc('claim_new_bill_notices',{p_round:id}));for(let i=0;i<jobs.length;i+=10)await Promise.all(jobs.slice(i,i+10).map((n:any)=>deliverNotification(db,n)))})();
     const runtime=(globalThis as any).EdgeRuntime;if(runtime?.waitUntil)runtime.waitUntil(task.catch(()=>{}));else await task.catch(()=>{});
    }return json({ok:true,id,notification_queued:input.notify_line===true});}
   case 'new-member':{
    requireAdmin();const sid=text(input.student_id,20);if(!/^\d{5,20}$/.test(sid))throw new Error('รหัสนักศึกษาไม่ถูกต้อง');const password=text(input.password,128);if(password.length<6)throw new Error('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');const name=text(input.name,120);const year=text(input.year,2);if(!['1','2','3','4'].includes(year))throw new Error('ชั้นปีไม่ถูกต้อง');
    const {data,error}=await db.auth.admin.createUser({email:`${sid}@${Deno.env.get('STUDENT_EMAIL_DOMAIN')||'students.finance-medtech.invalid'}`,password,email_confirm:true});if(error)throw new Error('สร้างบัญชีไม่ได้ รหัสนักศึกษาอาจมีอยู่แล้ว');
    try{await query(db.from('profiles').insert({id:data.user!.id,student_id:sid,name,year,role:'member'}))}catch(e){await db.auth.admin.deleteUser(data.user!.id);throw e}
    await query(db.from('audit').insert({actor:profile.name,action:'เพิ่มสมาชิก '+sid}));return json({ok:true});
   }
   case 'submit-payment':{
    if(!await query(db.rpc('payment_window_open')))throw Error('พักรับชำระเวลา 23:50–01:00 น. กรุณากลับมาเวลา 01:00 น.');
    const image=await validateImage(file),value=amount(input.amount),charge=await query(db.from('charges').select('*,rounds(title,created_at)').eq('id',input.charge_id).single());if(charge.profile_id!==profile.id)throw new Error('ไม่มีสิทธิ์ในรายการนี้');
    // Check required configuration before reserving or charging vendor quota.
    for(const k of ['SLIPOK_BRANCH_ID','SLIPOK_API_KEY','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REFRESH_TOKEN','GOOGLE_DRIVE_FOLDER_ID'])secret(k);
    const pid=await query(db.rpc('reserve_payment',{p_profile:profile.id,p_charge:charge.id,p_amount:value}));
    let driveId:string;
    try{driveId=await uploadDrive(image,`slip-${pid}.${image.type.split('/')[1]}`);await query(db.from('payments').update({drive_file_id:driveId}).eq('id',pid))}
    catch{await query(db.from('payments').update({status:'rejected',note:'บันทึกหลักฐานไม่สำเร็จ กรุณาส่งใหม่'}).eq('id',pid));return json({message:'บันทึกหลักฐานไม่สำเร็จ กรุณาส่งใหม่'});}
    let verified=false,note='ระบบตรวจสอบอัตโนมัติไม่สำเร็จ รอแอดมินตรวจ';
    try{
     const settings=await query(db.from('site_settings').select('data').eq('id',true).single());const result=await checkSlip(image,value,String(settings.data.accountNumber||'')),detail=result.body.data;
     // Old transfers must not automatically pay a newly created round.
     const validDate=isRecentSlip(detail,charge.rounds.created_at);
     await query(db.from('payments').update({verification:result.body}).eq('id',pid));
     if(result.ok&&validDate){await query(db.rpc('decide_payment',{p_id:pid,p_decision:'approved',p_note:'ตรวจสอบผ่าน SlipOK',p_ref:String(detail.transRef),p_actor:null}));verified=true;note='ยืนยันการชำระเงินแล้ว'}
     else note=!validDate&&(result.ok||detail?.transTimestamp)?'สลิปเกิน 48 ชั่วโมง ก่อนสร้างบิล หรือวันเวลาบนสลิปไม่ถูกต้อง':'ผลตรวจต้องตรวจเพิ่มเติม: '+String(result.body.message||detail?.message||'ยอดหรือบัญชีไม่ตรง');
    }catch{note='ตรวจสอบอัตโนมัติไม่สำเร็จ หรือพบเลขอ้างอิงซ้ำ รอแอดมินตรวจ';}
    if(!verified)await query(db.from('payments').update({status:'review',note:note.slice(0,500)}).eq('id',pid).eq('status','pending'));
    if(verified)await paymentSuccess(db,profile.id,`finance MEDTECH\nยืนยันชำระ ${charge.rounds.title}\nจำนวน ${value.toFixed(2)} บาท`);
    return json({message:verified?'ยืนยันการชำระแล้ว':'บันทึกสลิปแล้ว รอแอดมินตรวจสอบ',status:verified?'approved':'review',payment_id:pid});
   }
   case 'retry-payment':{
    requireAdmin();
    const p=await query(db.from('payments').select('*,charges(rounds(title,created_at))').eq('id',input.payment_id).single());
    if(!['pending','review'].includes(p.status)||!p.drive_file_id)throw new Error('ตรวจซ้ำได้เฉพาะรายการที่รอตรวจและมีหลักฐาน');
    const access=await driveToken();const r=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(p.drive_file_id)}?alt=media&supportsAllDrives=true`,{headers:{Authorization:`Bearer ${access}`},signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw new Error('เปิดหลักฐานไม่สำเร็จ');
    const blob=await r.blob();const image=await validateImage(new File([blob],'slip',{type:blob.type}));
    const settings=await query(db.from('site_settings').select('data').eq('id',true).single());const result=await checkSlip(image,Number(p.amount),String(settings.data.accountNumber||'')),detail=result.body.data;
    await query(db.from('payments').update({verification:result.body}).eq('id',p.id));
    const validDate=isRecentSlip(detail,p.charges.rounds.created_at);
    if(result.ok&&validDate){
     await query(db.rpc('decide_payment',{p_id:p.id,p_decision:'approved',p_note:'ตรวจสอบผ่าน SlipOK (ตรวจซ้ำ)',p_ref:String(detail.transRef),p_actor:null}));
     await paymentSuccess(db,p.profile_id,`finance MEDTECH\nยืนยันชำระ ${p.charges.rounds.title}\nจำนวน ${Number(p.amount).toFixed(2)} บาท`);
     return json({message:'SlipOK ยืนยันการชำระแล้ว'});
    }
    const note=!validDate&&(result.ok||detail?.transTimestamp)?'สลิปเกิน 48 ชั่วโมง ก่อนสร้างบิล หรือวันเวลาบนสลิปไม่ถูกต้อง':'ผลตรวจต้องตรวจเพิ่มเติม: '+String(result.body.message||detail?.message||'ยอดหรือบัญชีไม่ตรง');
    await query(db.from('payments').update({note:note.slice(0,500)}).eq('id',p.id).in('status',['pending','review']));
    return json({message:note});
   }
   case 'set-bill-status':{
    requireAdmin();
    const result=await query(db.rpc('admin_set_bill_status',{p_charge:input.charge_id,p_status:text(input.status,20),p_reason:text(input.reason,500),p_actor:profile.id,p_expected_paid:Number(input.expected_paid),p_expected_balance:Number(input.expected_balance),p_request:input.request_id}));return json({ok:true,result});
   }
   case 'review':{
    requireAdmin();const decision=text(input.decision,20);if(!['approved','rejected'].includes(decision))throw new Error('สถานะไม่ถูกต้อง');const p=await query(db.from('payments').select('*').eq('id',input.payment_id).single());
    await query(db.rpc('decide_payment',{p_id:p.id,p_decision:decision,p_note:text(input.note,500),p_ref:p.trans_ref||p.verification?.data?.transRef||`ADMIN-${p.id}`,p_actor:profile.id}));
    await (decision==='approved'?paymentSuccess:notify)(db,p.profile_id,`finance MEDTECH\n${decision==='approved'?'ยืนยันรับเงินแล้ว':'กรุณาแก้ไขหลักฐาน'}\nจำนวน ${Number(p.amount).toFixed(2)} บาท\n${input.note}`);return json({ok:true});
   }
   case 'new-expense':{
    requireAdmin();const title=text(input.title,120),category=text(input.category,100),value=amount(input.amount),spentOn=day(input.spent_on),responsible=text(input.responsible_name||profile.name,120),id=crypto.randomUUID();if(!file&&!receiptFile)throw Error('กรุณาแนบสลิปหรือใบเสร็จอย่างน้อยหนึ่งไฟล์');const uploaded:string[]=[];
    try{const driveId=file?await uploadDrive(await validateImage(file),`expense-${id}`):null;if(driveId)uploaded.push(driveId);const receiptId=receiptFile?await uploadDrive(await validateReceipt(receiptFile),`expense-receipt-${id}`):null;if(receiptId)uploaded.push(receiptId);await query(db.from('expenses').insert({id,title,category,amount:value,spent_on:spentOn,responsible_name:responsible,note:String(input.note||'').slice(0,500),drive_file_id:driveId,receipt_file_id:receiptId,created_by:profile.id}))}catch(e){for(const f of uploaded)await deleteDrive(f);throw e}
    await query(db.from('audit').insert({actor:profile.name,action:'บันทึกรายจ่าย '+title}));return json({ok:true});
   }
   case 'remind-preview':
   case 'remind':{
    requireAdmin();const p=await query(db.from('profiles').select('*').eq('id',input.profile_id).eq('active',true).is('deleted_at',null).single());
    const account=await query(db.from('line_accounts').select('profile_id').eq('profile_id',p.id).maybeSingle());if(!account)throw Error('สมาชิกยังไม่ได้เชื่อม LINE');
    const rounds=await query(db.from('rounds').select('id,title,due_date,archived').is('deleted_at',null));
    const cs=await query(db.from('charges').select('id,amount,round_id').eq('profile_id',p.id).is('deleted_at',null));
    const ps=await query(db.from('payments').select('amount,charge_id,status').eq('profile_id',p.id).is('deleted_at',null));
    const totals=cs.length?await query(db.rpc('charge_totals',{p_ids:cs.map((c:any)=>c.id)})):[];
    const items=cs.flatMap((c:any)=>{const r=rounds.find((r:any)=>r.id===c.round_id&&!r.archived);if(!r||ps.some((x:any)=>x.charge_id===c.id&&['pending','review'].includes(x.status)))return [];
     const due=Math.max(0,Number(totals.find((t:any)=>t.id===c.id)?.total_amount??c.amount)-ps.filter((x:any)=>x.charge_id===c.id&&x.status==='approved').reduce((sum:number,x:any)=>sum+Number(x.amount),0));if(due<=0)return [];
     const deadline=r.due_date?new Intl.DateTimeFormat('th-TH',{dateStyle:'long',timeZone:'Asia/Bangkok'}).format(new Date(r.due_date+'T00:00:00+07:00')):'ยังไม่ระบุ';
     return [{charge_id:c.id,due_date:r.due_date,title:'แจ้งเตือนกำหนดชำระ',body:`${r.title}\nยอดค้าง ${due.toFixed(2)} บาท\nครบกำหนด ${deadline}\nกรุณาตรวจสอบยอดล่าสุดก่อนชำระเงิน`}];});
    if(input.action==='remind-preview')return json({items});
    if(input.confirmation!=='ส่งแจ้งเตือน')throw Error('กรุณาตรวจสอบก่อนส่ง');
    const ids=Array.isArray(input.charge_ids)?input.charge_ids:[];if(!ids.length||ids.length>50)throw Error('เลือกรายการ 1–50 บิล');
    const selected=items.filter((i:any)=>ids.includes(i.charge_id));if(!selected.length)throw Error('ไม่มีรายการที่ต้องแจ้งเตือนแล้ว');
    const recent=await query(db.from('notifications').select('id').eq('profile_id',p.id).eq('message_kind','reminder').gte('created_at',new Date(Date.now()-60000).toISOString()).limit(1));if(recent.length)throw Error('เพิ่งส่งแจ้งเตือน กรุณารออย่างน้อย 1 นาที');
    let sent=0;for(const i of selected){const n=await query(db.from('notifications').insert({profile_id:p.id,title:i.title,body:i.body,message_kind:'reminder',reminder_charge_id:i.charge_id,reminder_key:`${i.charge_id}:${i.due_date}:manual-${crypto.randomUUID()}`,expires_at:new Date(Date.now()+600000).toISOString(),delivery_started_at:new Date().toISOString()}).select('*').single());if(await deliverNotification(db,n)==='sent')sent++;}
    await query(db.from('audit').insert({actor:profile.name,action:`ส่งแจ้งเตือนกำหนดชำระ ${p.student_id} · ${sent}/${selected.length} บิล`}));
    return json({message:`LINE รับคำขอแล้ว ${sent}/${selected.length} บิล`,sent,total:selected.length});
   }
   case 'link-code':{
    const code=crypto.randomUUID().replaceAll('-','').slice(0,16).toUpperCase();await query(db.from('line_link_codes').delete().eq('profile_id',profile.id));await query(db.from('line_link_codes').insert({profile_id:profile.id,code_hash:await hash(code),expires_at:new Date(Date.now()+600000).toISOString()}));return json({code});
   }
   case 'file':{const kind=text(input.kind,10);if(!['payment','expense'].includes(kind))throw new Error('ชนิดรายการไม่ถูกต้อง');if(kind==='expense')requireAdmin();const record=await query(db.from(kind==='payment'?'payments':'expenses').select('*').eq('id',input.id).single());if(kind==='payment'&&!isAdmin&&record.profile_id!==profile.id)throw new Error('ไม่มีสิทธิ์เข้าถึง');return json({url:`${secret('SUPABASE_URL')}/functions/v1/finance-api?action=download&kind=${kind}&id=${encodeURIComponent(record.id)}`});}
   default:return json({error:'Action not found'},404);
  }
 }catch(e){return json({error:e instanceof Error?e.message:'ทำรายการไม่สำเร็จ'},400)}
});



