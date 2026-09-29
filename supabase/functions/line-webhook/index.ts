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
   const m=event.message.text.trim().match(/^เชื่อม\s+([A-F0-9]{16})$/i);if(!m)continue;
   const id=await query(db.rpc('consume_line_code',{p_hash:await hash(m[1].toUpperCase()),p_line_user:event.source.userId}));
   if(event.replyToken){const r=await fetch('https://api.line.me/v2/bot/message/reply',{method:'POST',headers:{Authorization:`Bearer ${secret('LINE_CHANNEL_ACCESS_TOKEN')}`,'Content-Type':'application/json'},body:JSON.stringify({replyToken:event.replyToken,messages:[{type:'text',text:id?'เชื่อม finance MEDTECH สำเร็จแล้ว':'รหัสไม่ถูกต้อง หมดอายุ หรือถูกใช้แล้ว กรุณาสร้างรหัสใหม่'}]}),signal:AbortSignal.timeout(10000)});if(!r.ok&&r.status>=500)return new Response('Retry',{status:500});}
  }
  return new Response('OK');
 }catch{return new Response('Webhook error',{status:500})}
});
