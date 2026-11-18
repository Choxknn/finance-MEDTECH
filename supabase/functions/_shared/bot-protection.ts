import {query,hash,secret} from './services.ts';
export function captchaConfig(){const site=Deno.env.get('TURNSTILE_SITE_KEY')||'',secret=Deno.env.get('TURNSTILE_SECRET_KEY')||'';return {site_key:site&&secret?site:'',enabled:!!(site&&secret)}}
export async function limitRequest(db:any,key:string,limit:number,seconds:number){if(!await query(db.rpc('allow_finance_request',{p_key:await hash(key),p_limit:limit,p_seconds:seconds})))throw Object.assign(Error('ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่'),{status:429})}
export type AccountSecurityContext={ipHash:string;targetHash:string|null;action:string};
const ACCOUNT_WIDE_BLOCK='0'.repeat(64);
const securityPepper=()=>secret('SUPABASE_SERVICE_ROLE_KEY');
async function blockSuspiciousIp(db:any,ipHash:string,reason:string,targetHash:string|null=null){
 const now=new Date(),until=new Date(now.getTime()+30*60*1000).toISOString();
 const target=targetHash||ACCOUNT_WIDE_BLOCK;
 const result=await db.from('account_security_blocks').upsert({
  ip_hash:ipHash,target_hash:target,reason,blocked_until:until,updated_at:now.toISOString()
 },{onConflict:'ip_hash,target_hash'});
 if(result.error)throw result.error;
 const logged=await db.from('account_security_events').insert({
  event_type:'ip_temporarily_blocked',severity:'high',
  message:'ระงับคำขอจากเครือข่ายนี้ชั่วคราวเนื่องจากตรวจพบพฤติกรรมผิดปกติ',
  ip_hash:ipHash,details:{duration_minutes:30,reason}
 });
 if(logged.error)console.warn('Account security block event write failed');
}
export async function recordAccountSecurityEvent(db:any,context:AccountSecurityContext,event:any){
 try{
  const row={
   profile_id:event.profileId||null,event_type:event.type,severity:event.severity||'info',
   message:String(event.message||'กิจกรรมความปลอดภัยของบัญชี').slice(0,250),
   ip_hash:context?.ipHash||null,target_hash:context?.targetHash||null,
   details:event.details&&typeof event.details==='object'?event.details:{}
  };
  const inserted=await db.from('account_security_events').insert(row);
  if(inserted.error)throw inserted.error;
  const since=new Date(Date.now()-15*60*1000).toISOString();
  if(['rate_limit_exceeded','captcha_failed'].includes(event.type)){
   const counted=await db.from('account_security_events').select('id',{count:'exact',head:true})
    .eq('ip_hash',context.ipHash).in('event_type',['rate_limit_exceeded','captcha_failed']).gte('created_at',since);
   if(!counted.error&&Number(counted.count||0)>=3)
    await blockSuspiciousIp(db,context.ipHash,'มีคำขอผิดปกติหรือไม่ผ่านการจำกัดความถี่หลายครั้ง');
  }else if(['otp_verification_failed','login_failed'].includes(event.type)&&context?.targetHash){
   const counted=await db.from('account_security_events').select('id',{count:'exact',head:true})
    .eq('ip_hash',context.ipHash).eq('target_hash',context.targetHash)
    .eq('event_type',event.type).gte('created_at',since);
   if(!counted.error&&Number(counted.count||0)>=5)
    await blockSuspiciousIp(db,context.ipHash,event.type==='login_failed'?'เข้าสู่ระบบไม่สำเร็จซ้ำหลายครั้ง':'กรอกรหัส OTP ผิดซ้ำหลายครั้ง');
  }
 }catch(error){console.warn('Account security event logging failed');}
}
export async function protectAccountRequest(db:any,req:Request,input:any):Promise<AccountSecurityContext>{
 const ip=(req.headers.get('x-forwarded-for')||'unknown').split(',').at(-1)!.trim();
 const pepper=securityPepper();
 const ipHash=await hash(pepper+':finance-medtech:ip:'+ip);
 const rawTarget=typeof input.student_id==='string'?'student:'+input.student_id.toLowerCase():
  typeof input.token==='string'?'token:'+input.token:'action:'+String(input.action||'unknown');
 const targetHash=await hash(pepper+':finance-medtech:target:'+rawTarget);
 const context={ipHash,targetHash,action:String(input.action||'unknown')};
 const blockQuery=()=>db.from('account_security_blocks').select('blocked_until')
  .eq('ip_hash',ipHash).gt('blocked_until',new Date().toISOString());
 const [networkBlock,accountBlock]=await Promise.all([
  query(blockQuery().eq('target_hash',ACCOUNT_WIDE_BLOCK).maybeSingle()),
  query(blockQuery().eq('target_hash',targetHash||ACCOUNT_WIDE_BLOCK).maybeSingle())
 ]);
 if(networkBlock||accountBlock)throw Object.assign(Error('คำขอจากเครือข่ายนี้ถูกระงับชั่วคราว กรุณาลองใหม่ภายหลัง'),{status:429});
 const guardedLimit=async(key:string,limit:number,seconds:number)=>{
  try{await limitRequest(db,key,limit,seconds)}
  catch(error){
   if((error as any)?.status===429)await recordAccountSecurityEvent(db,context,{
    type:'rate_limit_exceeded',severity:'high',message:'ตรวจพบคำขอถี่ผิดปกติและจำกัดคำขออัตโนมัติ',
    details:{action:context.action,limit,window_seconds:seconds}
   });
   throw error;
  }
 };
 await guardedLimit('account-ip:'+ip,120,60);
 const sensitive=['login','batch-start','batch-accept','invite-accept','forgot','resend-otp','verify-otp','check-otp'].includes(input.action);
 if(sensitive){
  // Detect one network probing many student IDs, not only repeated attempts against one ID.
  await guardedLimit('account-sensitive-ip:'+ip,40,900);
  await guardedLimit('account-sensitive:'+ip+':'+String(input.student_id||input.token||'').toLowerCase().slice(0,100),12,900);
 }
 // Turnstile is checked when requesting the OTP (and during registration).
 // OTP checks also use the database five-attempt limit and network anomaly detection.
 const needsCaptcha=['batch-start','batch-accept','invite-accept','forgot'].includes(input.action);
 if(needsCaptcha&&captchaConfig().enabled){
  if(typeof input.captcha_token!=='string'||!input.captcha_token){
   await recordAccountSecurityEvent(db,context,{type:'captcha_failed',severity:'warning',message:'คำขอไม่ผ่านการยืนยัน CAPTCHA',details:{action:context.action}});
   throw Error('กรุณายืนยันว่าไม่ใช่บอท');
  }
  const response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:Deno.env.get('TURNSTILE_SECRET_KEY'),response:input.captcha_token}),signal:AbortSignal.timeout(10000)});
  const result=await response.json(),hosts=(Deno.env.get('ALLOWED_ORIGINS')||'').split(',').map(s=>{try{return new URL(s.trim()).hostname}catch{return ''}}).filter(Boolean);
  if(!response.ok||!result.success||!hosts.includes(result.hostname)){
   await recordAccountSecurityEvent(db,context,{type:'captcha_failed',severity:'warning',message:'คำขอไม่ผ่านการยืนยัน CAPTCHA',details:{action:context.action}});
   throw Error('ยืนยันความปลอดภัยไม่สำเร็จ กรุณาลองใหม่');
  }
 }
 return context;
}
