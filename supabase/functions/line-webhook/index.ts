import {financeFlex} from '../_shared/line-flex.ts';
import {adminDb,query,secret,hash} from '../_shared/services.ts';
Deno.serve(async req=>{
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 const raw=await req.text(),signature=req.headers.get('x-line-signature');if(!signature)return new Response('Forbidden',{status:403});
 try{
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret('LINE_CHANNEL_SECRET')),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const sig=Uint8Array.from(atob(signature),c=>c.charCodeAt(0));if(!await crypto.subtle.verify('HMAC',key,sig,new TextEncoder().encode(raw)))return new Response('Forbidden',{status:403});
  const payload=JSON.parse(raw),db=adminDb();
  for(const event of payload.events||[]){
   if(event.type!=='message'||event.message?.type!=='text'||event.source?.type!=='user')continue;
   const m=event.message.text.trim().match(/^(เชื่อม|สมัคร)\s+([A-F0-9]{16})$/i);if(!m)continue;
   const id=await query(db.rpc(m[1]==='สมัคร'?'consume_registration_line_code':'consume_line_code',{p_hash:await hash(m[2].toUpperCase()),p_line_user:event.source.userId}));
   if(event.replyToken){const r=await fetch('https://api.line.me/v2/bot/message/reply',{method:'POST',headers:{Authorization:`Bearer ${secret('LINE_CHANNEL_ACCESS_TOKEN')}`,'Content-Type':'application/json'},body:JSON.stringify({replyToken:event.replyToken,messages:[financeFlex(id?'เชื่อม LINE สำเร็จ':'เชื่อม LINE ไม่สำเร็จ',id?(m[1]==='สมัคร'?'ยืนยัน LINE สำหรับสมัครสำเร็จ กลับไปหน้าสมัคร กดตรวจสอบ LINE และตั้งรหัสผ่านเพื่อเปิดบัญชี':'เชื่อม finance MEDTECH สำเร็จแล้ว คุณจะได้รับข้อความแจ้งเตือนผ่าน LINE'):'รหัสไม่ถูกต้อง หมดอายุ หรือถูกใช้แล้ว กรุณาสร้างรหัสใหม่')]}),signal:AbortSignal.timeout(10000)});if(!r.ok&&r.status>=500)return new Response('Retry',{status:500});}
  }
  return new Response('OK');
 }catch{return new Response('Webhook error',{status:500})}
});
