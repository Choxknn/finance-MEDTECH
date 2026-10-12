import {adminDb,query,hash,validateImage} from '../_shared/services.ts';
import {EVIDENCE_BUCKET,removeStoredEvidence} from '../_shared/evidence-storage.ts';
// Single-job capability: opaque 256-bit token, hashed in a private table, expiring and revocable.
Deno.serve(async(req:Request)=>{
 const json=(value:any,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 const token=req.headers.get('authorization')?.replace(/^Bearer /,'');if(!token||!/^[a-f0-9]{64}$/.test(token))return json({error:'Unauthorized'},401);
 const db=adminDb();
 try{
  const job=await query(db.from('legacy_import_jobs').select('id').eq('token_hash',await hash(token)).gt('expires_at',new Date().toISOString()).is('completed_at',null).maybeSingle());
  if(!job)return json({error:'Expired or invalid import job'},403);
  const rows=await query(db.rpc('claim_legacy_evidence',{p_job:job.id}));const row=rows[0];if(!row)return json({done:true});
  let stored:string|null=null;
  try{
   const source=new URL(row.source_url);let id:string|null=null;
   if(source.protocol==='https:'&&!source.username&&!source.password){
    if(source.hostname==='lh3.googleusercontent.com')id=source.pathname.match(/^\/d\/([A-Za-z0-9_-]+)$/)?.[1]||null;
    if(source.hostname==='drive.google.com')id=source.pathname==='/uc'?source.searchParams.get('id'):source.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]+)\/view$/)?.[1]||null;
   }
   if(!id||!/^[A-Za-z0-9_-]+$/.test(id))throw Error('Unsupported source URL');const url='https://lh3.googleusercontent.com/d/'+id;
   const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(25000)});if(!response.ok)throw Error('Source HTTP '+response.status);
   const type=response.headers.get('content-type')?.split(';')[0]||'';if(!['image/jpeg','image/png','image/webp'].includes(type))throw Error('Source is not a supported image');
   const reader=response.body!.getReader(),parts:Uint8Array[]=[];let bytes=0;while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>5*1024*1024){await reader.cancel();throw Error('Image exceeds 5 MB')}parts.push(chunk.value)}
   const file=await validateImage(new File(parts,'legacy-slip',{type}));let path:string='';for(let attempt=0;attempt<40;attempt++){try{path=await query(db.rpc('reserve_legacy_file',{p_job:job.id,p_row:row.id,p_size:file.size,p_type:file.type}));break}catch(e){if(!String(e).includes('กำลังจัดการพื้นที่')||attempt===39)throw e;await new Promise(resolve=>setTimeout(resolve,350+Math.random()*450))}}
   stored='sb:'+path;await query(db.storage.from(EVIDENCE_BUCKET).upload(path,file,{contentType:file.type,upsert:false}));
   await query(db.rpc('finish_legacy_file',{p_row:row.id,p_path:path}));return json({copied:true});
  }catch(e){if(stored){await removeStoredEvidence(db,stored,'ยกเลิกไฟล์นำเข้าที่บันทึกไม่สำเร็จ').catch(()=>{});await query(db.rpc('evidence_storage_lock',{p_id:stored.slice(3),p_release:true})).catch(()=>{})}await query(db.from('legacy_payments').update({evidence_state:'failed',evidence_error:String(e instanceof Error?e.message:e).slice(0,300)}).eq('id',row.id));return json({failed:true})}
 }catch(e){return json({error:String(e instanceof Error?e.message:e)},500)}
});
