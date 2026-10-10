export const EVIDENCE_BUCKET='finance-evidence';
const checked=async(q:any)=>{const {data,error}=await q;if(error)throw Error(error.message);return data};
export const isStoredEvidence=(id:string)=>id.startsWith('sb:');
export async function storageUsage(db:any){return checked(db.rpc('evidence_storage_usage'))}
async function lock(db:any){const id=crypto.randomUUID();if(!await checked(db.rpc('evidence_storage_lock',{p_id:id})))throw Error('กำลังจัดการพื้นที่หลักฐาน กรุณาลองอีกครั้ง');return id}
async function unlock(db:any,id:string){await checked(db.rpc('evidence_storage_lock',{p_id:id,p_release:true}))}
export async function removeStoredEvidence(db:any,id:string,reason='ลบรายการหรือเปลี่ยนหลักฐาน'){
 if(!isStoredEvidence(id))throw Error('ไม่ใช่ไฟล์ใน Supabase');const path=id.slice(3);
 const row=await checked(db.from('evidence_files').select('*').eq('path',path).maybeSingle());if(!row)throw Error('ไม่พบทะเบียนไฟล์');if(row.state==='deleted')return;
 // Persist intent before the external deletion, so a failed request can be retried.
 await checked(db.from('evidence_files').update({state:'deleting',delete_reason:reason}).eq('path',path));
 await checked(db.storage.from(EVIDENCE_BUCKET).remove([path]));
 await checked(db.from('evidence_files').update({state:'deleted',deleted_at:new Date().toISOString()}).eq('path',path));
 await checked(db.from('audit').insert({actor:'ระบบจัดการหลักฐาน',action:`ลบไฟล์ ${row.name}: ${reason}`}));
}
async function maintainUnlocked(db:any,incoming=0){
 const retry=await checked(db.from('evidence_files').select('*').eq('state','deleting').order('created_at').limit(100));
 for(const f of retry)await removeStoredEvidence(db,'sb:'+f.path,f.delete_reason);
 const abandoned=await checked(db.from('evidence_files').select('*').eq('state','pending').lt('created_at',new Date(Date.now()-3600000).toISOString()).limit(100));
 for(const f of abandoned)await removeStoredEvidence(db,'sb:'+f.path,'อัปโหลดไม่เสร็จ');
 const jobs=await checked(db.from('trash_cleanup_queue').select('id,target').eq('kind','drive').like('target','sb:%').order('created_at').limit(100));
 for(const job of jobs){await removeStoredEvidence(db,job.target);await checked(db.from('trash_cleanup_queue').delete().eq('id',job.id))}
 let usage=await storageUsage(db);let removed=0;
 if(usage.auto_cleanup&&Number(usage.used_bytes)+incoming>=Number(usage.budget_bytes)*.9){
 const files=await checked(db.rpc('evidence_cleanup_candidates'));
 for(const f of files){if(Number(usage.used_bytes)+incoming<=Number(usage.budget_bytes)*.8)break;await removeStoredEvidence(db,'sb:'+f.path,'พื้นที่ถึง 90% ลบไฟล์เก่าสุดอัตโนมัติ');removed++;usage=await storageUsage(db)}
 }
 return {...usage,removed};
}
export async function maintainEvidence(db:any){const id=await lock(db);try{return await maintainUnlocked(db)}finally{await unlock(db,id)}}
export async function deleteEvidenceByAdmin(db:any,path:string,actor:string){const id=await lock(db);try{await removeStoredEvidence(db,'sb:'+path,'แอดมินลบรูป: '+actor)}finally{await unlock(db,id)}}
export async function uploadEvidence(db:any,file:File,name:string){
 const id=await lock(db);try{
 const usage=await maintainUnlocked(db,file.size);if(Number(usage.used_bytes)+file.size>Number(usage.budget_bytes))throw Error('พื้นที่หลักฐานเต็ม กรุณาให้แอดมินเพิ่มงบพื้นที่หรือลบไฟล์ที่ไม่ใช้');
 const path=crypto.randomUUID();await checked(db.from('evidence_files').insert({path,name,size:file.size,mime_type:file.type}));
 try{await checked(db.storage.from(EVIDENCE_BUCKET).upload(path,file,{contentType:file.type,upsert:false}));await checked(db.from('evidence_files').update({state:'active'}).eq('path',path));return 'sb:'+path}
 catch(e){try{await removeStoredEvidence(db,'sb:'+path,'อัปโหลดไม่สำเร็จ')}catch{}throw e}
 }finally{await unlock(db,id)}
}
export async function downloadEvidence(db:any,id:string){
 const path=id.slice(3),f=await checked(db.from('evidence_files').select('state,delete_reason').eq('path',path).maybeSingle());
 if(!f||f.state!=='active')throw Error('หลักฐานนี้ถูกลบแล้ว'+(f?.delete_reason?' · '+f.delete_reason:''));
 const blob=await checked(db.storage.from(EVIDENCE_BUCKET).download(path));return new Response(blob,{headers:{'Content-Type':blob.type}});
}
export async function evidenceOverview(db:any,page=0){return {usage:await storageUsage(db),files:await checked(db.from('evidence_files').select('*').order('created_at',{ascending:false}).order('path').range(page*30,page*30+29)),page}}
