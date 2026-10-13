import {query,hash} from './services.ts';
export function captchaConfig(){const site=Deno.env.get('TURNSTILE_SITE_KEY')||'',secret=Deno.env.get('TURNSTILE_SECRET_KEY')||'';return {site_key:site&&secret?site:'',enabled:!!(site&&secret)}}
export async function limitRequest(db:any,key:string,limit:number,seconds:number){if(!await query(db.rpc('allow_finance_request',{p_key:await hash(key),p_limit:limit,p_seconds:seconds})))throw Object.assign(Error('ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่'),{status:429})}
export async function protectAccountRequest(db:any,req:Request,input:any){
 const ip=(req.headers.get('x-forwarded-for')||'unknown').split(',').at(-1)!.trim();
 await limitRequest(db,'account-ip:'+ip,120,60);
 if(['batch-start','batch-accept','invite-accept','forgot'].includes(input.action)){
  await limitRequest(db,'account-sensitive:'+ip+':'+String(input.student_id||input.token||'').slice(0,100),12,900);
  if(captchaConfig().enabled){
   if(typeof input.captcha_token!=='string'||!input.captcha_token)throw Error('กรุณายืนยันว่าไม่ใช่บอท');
   const response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:Deno.env.get('TURNSTILE_SECRET_KEY'),response:input.captcha_token}),signal:AbortSignal.timeout(10000)});
   const result=await response.json(),hosts=(Deno.env.get('ALLOWED_ORIGINS')||'').split(',').map(s=>{try{return new URL(s.trim()).hostname}catch{return ''}}).filter(Boolean);
   if(!response.ok||!result.success||!hosts.includes(result.hostname))throw Error('ยืนยันความปลอดภัยไม่สำเร็จ กรุณาลองใหม่');
  }
 }
}
