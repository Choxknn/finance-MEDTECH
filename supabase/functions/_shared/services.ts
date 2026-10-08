import {financeFlex,automaticTitle,financeSite} from './line-flex.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
export const secret=(key:string)=>{const value=Deno.env.get(key);if(!value)throw new Error(`ยังไม่ได้ตั้งค่า ${key}`);return value};
export const adminDb=()=>createClient(secret('SUPABASE_URL'),secret('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
export async function query(q:any){const {data,error}=await q;if(error)throw new Error(error.message);return data}
export async function hash(text:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('')}
export async function driveToken(){const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:secret('GOOGLE_CLIENT_ID'),client_secret:secret('GOOGLE_CLIENT_SECRET'),refresh_token:secret('GOOGLE_REFRESH_TOKEN'),grant_type:'refresh_token'}),signal:AbortSignal.timeout(20000)});const j=await r.json();if(!r.ok||!j.access_token)throw new Error('เชื่อม Google Drive ไม่สำเร็จ');return j.access_token}
export async function uploadDrive(file:File,name:string){const access=await driveToken(),boundary=crypto.randomUUID();const body=new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,JSON.stringify({name,parents:[secret('GOOGLE_DRIVE_FOLDER_ID')]}),`\r\n--${boundary}\r\nContent-Type: ${file.type}\r\n\r\n`,file,`\r\n--${boundary}--\r\n`]);const r=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true',{method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':`multipart/related; boundary=${boundary}`},body,signal:AbortSignal.timeout(30000)});const j=await r.json();if(!r.ok||!j.id)throw new Error('บันทึกหลักฐานใน Google Drive ไม่สำเร็จ');return j.id as string}
export async function deleteDrive(id:string,strict=false){try{const access=await driveToken();const r=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true`,{method:'DELETE',headers:{Authorization:`Bearer ${access}`},signal:AbortSignal.timeout(15000)});if(!r.ok&&r.status!==404)throw Error('ลบหลักฐานไม่สำเร็จ')}catch(e){if(strict)throw e}}
export function isRecentSlip(detail:any,createdAt:string,now=Date.now()){const transferred=Date.parse(detail?.transTimestamp||'');return Number.isFinite(transferred)&&transferred>=Date.parse(createdAt)&&transferred<=now+60000&&now-transferred<=48*60*60*1000}
export function matchesReceiver(detail:any,expected:string){
 const target=expected.replace(/[^0-9]/g,'');if(!target)return false;
 const candidates=[detail?.receiver?.proxy?.value,detail?.receiver?.account?.value,detail?.toMerchantId].filter((x:any)=>typeof x==='string');
 return candidates.some((value:string)=>{const compact=value.replace(/[\s\-]/g,'').toLowerCase();if(compact===target)return true;if(compact.length!==target.length||compact.replace(/[^0-9]/g,'').length<4)return false;return [...compact].every((ch,i)=>/^[x*]$/.test(ch)||ch===target[i])});
}
export function slipOkBranch(value:string){const v=value.trim();if(/^\d+$/.test(v))return v;return v.match(/^https:\/\/api\.slipok\.com\/api\/line\/apikey\/(\d+)\/?$/)?.[1]||null}
export async function checkSlip(file:File,amount:number,expectedReceiver:string){
 const branch=slipOkBranch(secret('SLIPOK_BRANCH_ID'));if(!branch)return {ok:false,body:{code:'LOCAL_BRANCH_ID',message:'SLIPOK_BRANCH_ID ต้องเป็นรหัสสาขาตัวเลข'}};
 const body=new FormData();const ext=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'} as Record<string,string>)[file.type];if(!ext)throw new Error('ชนิดไฟล์ไม่รองรับ');body.set('files',file,`slip.${ext}`);body.set('log','true');body.set('amount',String(amount));
 const r=await fetch(`https://api.slipok.com/api/line/apikey/${encodeURIComponent(branch)}`,{method:'POST',headers:{'x-authorization':secret('SLIPOK_API_KEY').trim()},body,signal:AbortSignal.timeout(30000)});
 const j=await r.json(),receiverMatched=matchesReceiver(j.data,expectedReceiver);
 return {ok:r.ok&&j.success===true&&j.data?.success===true&&Math.round(Number(j.data.amount)*100)===Math.round(amount*100)&&!!j.data.transRef&&receiverMatched,body:{...j,...(!receiverMatched&&j.success?{message:'ข้อมูลบัญชีผู้รับไม่ตรงหรือข้อมูลถูกปิดบังจนตรวจยืนยันไม่ได้'}:{}),diagnostics:{httpStatus:r.status,transport:'image-multipart',receiverMatched,branchNumeric:true}}};
}
export async function deliverNotification(db:any,n:any){
 const account=await query(db.from('line_accounts').select('line_user_id').eq('profile_id',n.profile_id).maybeSingle());const p=await query(db.from('profiles').select('active,deleted_at').eq('id',n.profile_id).maybeSingle());
 if(!p||!p.active||p.deleted_at){await query(db.from('notifications').update({status:'failed',error:'สมาชิกปิดใช้งานแล้ว'}).eq('id',n.id));return 'failed'}
 if(!account){await query(db.from('notifications').update({status:'unlinked'}).eq('id',n.id));return 'unlinked'}
 try{let actionUrl='';
 if(n.new_bill_id){const bill=await query(db.from('rounds').select('id,archived,deleted_at').eq('id',n.new_bill_id).maybeSingle());const charge=await query(db.from('charges').select('id').eq('round_id',n.new_bill_id).eq('profile_id',n.profile_id).is('deleted_at',null).maybeSingle());if(!bill||bill.archived||bill.deleted_at||!charge){await query(db.from('notifications').update({status:'in_app',error:'บิลถูกลบ ปิดรับชำระ หรือสมาชิกไม่ได้อยู่ในบิลแล้ว'}).eq('id',n.id));return 'in_app'}actionUrl=financeSite+'?view=bills';}

 if(n.message_kind==='reminder'){
  const c=await query(db.from('charges').select('*,rounds(due_date,archived,deleted_at)').eq('id',n.reminder_charge_id).maybeSingle());
  const ps=c?await query(db.from('payments').select('amount,status').eq('charge_id',c.id).is('deleted_at',null)):[];
  const totals=c?await query(db.rpc('charge_totals',{p_ids:[c.id]})):[];
  if(!c||c.deleted_at||c.rounds.deleted_at||c.rounds.archived||!n.reminder_key.includes(':'+c.rounds.due_date+':')||Date.parse(n.expires_at)<=Date.now()||ps.some((x:any)=>['pending','review'].includes(x.status))||ps.filter((x:any)=>x.status==='approved').reduce((a:number,x:any)=>a+Number(x.amount),0)>=Number(totals[0]?.total_amount??c.amount)){await query(db.from('notifications').update({status:'in_app',error:'รายการชำระแล้ว รอตรวจสอบ หรือเปลี่ยนกำหนดชำระ'}).eq('id',n.id));return 'in_app'}
 }
 if(n.message_kind==='password'){
  const u=await db.auth.admin.getUserById(n.profile_id);if(u.error||!u.data.user?.email)throw Error('ไม่พบบัญชีสำหรับตั้งรหัสผ่าน');
  let recoveryHash=n.recovery_token_hash;
  if(!recoveryHash){const link=await db.auth.admin.generateLink({type:'recovery',email:u.data.user.email});
  if(link.error||!link.data.properties?.hashed_token)throw Error('สร้างลิงก์ตั้งรหัสผ่านไม่สำเร็จ');recoveryHash=link.data.properties.hashed_token;await query(db.from('notifications').update({recovery_token_hash:recoveryHash}).eq('id',n.id));}
  actionUrl=financeSite+'reset-password.html#token_hash='+encodeURIComponent(recoveryHash);
 }
 const r=await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:`Bearer ${secret('LINE_CHANNEL_ACCESS_TOKEN')}`,'Content-Type':'application/json','X-Line-Retry-Key':n.retry_key},body:JSON.stringify({to:account.line_user_id,messages:[financeFlex(n.title,n.body,n.new_bill_id?'new_bill':n.message_kind,actionUrl)]}),signal:AbortSignal.timeout(15000)});if(!r.ok&&r.status!==409)throw Error('LINE HTTP '+r.status);await query(db.from('notifications').update({status:'sent',error:null}).eq('id',n.id));return 'sent'}catch(e){await query(db.from('notifications').update({status:'failed',error:e instanceof Error?e.message:'LINE error'}).eq('id',n.id));return 'failed'}
}
export async function notify(db:any,profileId:string,body:string){const n=await query(db.from('notifications').insert({profile_id:profileId,body,title:automaticTitle(body),message_kind:/กรุณาแก้ไข/.test(body)?'correction':'message'}).select().single());return deliverNotification(db,n)}
export async function validateImage(f:File|null){if(!(f instanceof File)||f.size===0||f.size>5*1024*1024)throw new Error('ไฟล์ต้องมีขนาดไม่เกิน 5 MB');if(!['image/jpeg','image/png','image/webp'].includes(f.type))throw new Error('ชนิดไฟล์ไม่รองรับ');const a=new Uint8Array(await f.slice(0,12).arrayBuffer());const jpg=a[0]===255&&a[1]===216&&a[2]===255,png=a[0]===137&&a[1]===80&&a[2]===78&&a[3]===71,webp=new TextDecoder().decode(a.slice(0,4))==='RIFF'&&new TextDecoder().decode(a.slice(8,12))==='WEBP';if(!(f.type==='image/jpeg'&&jpg||f.type==='image/png'&&png||f.type==='image/webp'&&webp))throw new Error('ข้อมูลภาพไม่ตรงชนิดไฟล์');return f}


export async function validateReceipt(f:File|null){if(!(f instanceof File)||!f.size||f.size>5*1024*1024)throw Error('ใบเสร็จต้องมีขนาดไม่เกิน 5 MB');if(f.type==='application/pdf'){const header=new TextDecoder().decode(await f.slice(0,5).arrayBuffer());if(header!=='%PDF-')throw Error('ข้อมูลไฟล์ PDF ไม่ถูกต้อง');return f}return validateImage(f)}

export async function paymentSuccess(db:any,profileId:string,body:string){await query(db.from('notifications').insert({profile_id:profileId,title:'ชำระเงินสำเร็จ',body,message_kind:'payment_success',status:'in_app'}))}
