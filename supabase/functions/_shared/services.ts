import jsQR from 'npm:jsqr@1.4.0';
import jpeg from 'npm:jpeg-js@0.4.4';
import { PNG } from 'npm:pngjs@7.0.0';
export async function slipQrData(file:File){
 const bytes=new Uint8Array(await file.arrayBuffer());let decoded:any;
 if(file.type==='image/jpeg')decoded=jpeg.decode(bytes,{useTArray:true,maxResolutionInMP:20,maxMemoryUsageInMB:128});
 else if(file.type==='image/png'){
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length<24||v.getUint32(16)*v.getUint32(20)>20000000)throw new Error('ภาพมีความละเอียดสูงเกินไป');
  decoded=PNG.sync.read(bytes);
 }else return null;
 const result=jsQR(new Uint8ClampedArray(decoded.data),decoded.width,decoded.height,{inversionAttempts:'attemptBoth'});
 return result?.data||null;
}
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
export const secret=(key:string)=>{const value=Deno.env.get(key);if(!value)throw new Error(`ยังไม่ได้ตั้งค่า ${key}`);return value};
export const adminDb=()=>createClient(secret('SUPABASE_URL'),secret('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
export async function query(q:any){const {data,error}=await q;if(error)throw new Error(error.message);return data}
export async function hash(text:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('')}
export async function driveToken(){const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:secret('GOOGLE_CLIENT_ID'),client_secret:secret('GOOGLE_CLIENT_SECRET'),refresh_token:secret('GOOGLE_REFRESH_TOKEN'),grant_type:'refresh_token'}),signal:AbortSignal.timeout(20000)});const j=await r.json();if(!r.ok||!j.access_token)throw new Error('เชื่อม Google Drive ไม่สำเร็จ');return j.access_token}
export async function uploadDrive(file:File,name:string){const access=await driveToken(),boundary=crypto.randomUUID();const body=new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,JSON.stringify({name,parents:[secret('GOOGLE_DRIVE_FOLDER_ID')]}),`\r\n--${boundary}\r\nContent-Type: ${file.type}\r\n\r\n`,file,`\r\n--${boundary}--\r\n`]);const r=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true',{method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':`multipart/related; boundary=${boundary}`},body,signal:AbortSignal.timeout(30000)});const j=await r.json();if(!r.ok||!j.id)throw new Error('บันทึกหลักฐานใน Google Drive ไม่สำเร็จ');return j.id as string}
export async function deleteDrive(id:string){try{const access=await driveToken();await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true`,{method:'DELETE',headers:{Authorization:`Bearer ${access}`},signal:AbortSignal.timeout(15000)})}catch{/* orphan reconciliation is documented */}}
export async function checkSlip(file:File,amount:number){
 let data:string|null=null;try{data=await slipQrData(file)}catch{/* Fall back to vendor image recognition. */}
 const headers:Record<string,string>={'x-authorization':secret('SLIPOK_API_KEY').trim()};
 let body:FormData|string;
 if(data){headers['Content-Type']='application/json';body=JSON.stringify({data,log:true,amount})}
 else{body=new FormData();const ext=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'} as Record<string,string>)[file.type];if(!ext)throw new Error('ชนิดไฟล์ไม่รองรับ');body.set('files',file,`slip.${ext}`);body.set('log','true');body.set('amount',String(amount))}
 const r=await fetch(`https://api.slipok.com/api/line/apikey/${encodeURIComponent(secret('SLIPOK_BRANCH_ID').trim())}`,{method:'POST',headers,body,signal:AbortSignal.timeout(30000)});
 const j=await r.json();return {ok:r.ok&&j.success===true&&j.data?.success===true&&Number(j.data.amount)===amount&&!!j.data.transRef,body:j};
}
export async function notify(db:any,profileId:string,body:string){const n=await query(db.from('notifications').insert({profile_id:profileId,body,title:'finance MEDTECH'}).select().single());const account=await query(db.from('line_accounts').select('line_user_id').eq('profile_id',profileId).maybeSingle());if(!account){await query(db.from('notifications').update({status:'unlinked'}).eq('id',n.id));return 'unlinked'}try{const r=await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:`Bearer ${secret('LINE_CHANNEL_ACCESS_TOKEN')}`,'Content-Type':'application/json','X-Line-Retry-Key':n.retry_key},body:JSON.stringify({to:account.line_user_id,messages:[{type:'text',text:body}]}),signal:AbortSignal.timeout(15000)});if(!r.ok&&r.status!==409)throw new Error('LINE HTTP '+r.status);await query(db.from('notifications').update({status:'sent'}).eq('id',n.id));return 'sent'}catch(e){await query(db.from('notifications').update({status:'failed',error:e instanceof Error?e.message:'LINE error'}).eq('id',n.id));return 'failed'}}
export async function validateImage(f:File|null){if(!(f instanceof File)||f.size===0||f.size>5*1024*1024)throw new Error('ไฟล์ต้องมีขนาดไม่เกิน 5 MB');if(!['image/jpeg','image/png','image/webp'].includes(f.type))throw new Error('ชนิดไฟล์ไม่รองรับ');const a=new Uint8Array(await f.slice(0,12).arrayBuffer());const jpg=a[0]===255&&a[1]===216&&a[2]===255,png=a[0]===137&&a[1]===80&&a[2]===78&&a[3]===71,webp=new TextDecoder().decode(a.slice(0,4))==='RIFF'&&new TextDecoder().decode(a.slice(8,12))==='WEBP';if(!(f.type==='image/jpeg'&&jpg||f.type==='image/png'&&png||f.type==='image/webp'&&webp))throw new Error('ข้อมูลภาพไม่ตรงชนิดไฟล์');return f}
