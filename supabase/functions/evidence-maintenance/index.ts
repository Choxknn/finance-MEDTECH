import {adminDb,query} from '../_shared/services.ts';
import {maintainEvidence,uploadEvidence,downloadEvidence,deleteEvidenceByAdmin} from '../_shared/evidence-storage.ts';
Deno.serve(async req=>{
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 const key=req.headers.get('x-worker-key');if(!key||key.length!==64)return new Response('Forbidden',{status:403});
 try{
 const db=adminDb();if(!await query(db.rpc('authorize_reminder_worker',{p_key:key})))return new Response('Forbidden',{status:403});
 const input=await req.json();
 if(input.self_test===true){
  const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
  const id=await uploadEvidence(db,new File([bytes],'storage-test.png',{type:'image/png'}),'ทดสอบระบบพื้นที่ (ลบหลังทดสอบ)');
  try{const r=await downloadEvidence(db,id);const saved=new Uint8Array(await r.arrayBuffer());if(saved.length!==bytes.length||saved.some((v,i)=>v!==bytes[i]))throw Error('Storage roundtrip mismatch')}
  finally{await deleteEvidenceByAdmin(db,id.slice(3),'ทดสอบระบบ')}
  return Response.json({ok:true,upload:true,download:true,deleted:true});
 }
 return Response.json(await maintainEvidence(db));
 }catch{return new Response('Storage maintenance failed; will retry next run',{status:500})}
});
