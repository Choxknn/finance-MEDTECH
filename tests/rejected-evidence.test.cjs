const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),esbuild=require('esbuild');
test('only rejected evidence is detached and deleted; failed deletion retains durable retry',async()=>{
 const src=fs.readFileSync('supabase/functions/_shared/services.ts','utf8'),fn=src.slice(src.indexOf('export async function discardRejectedSlip'),src.indexOf('export function isRecentSlip'));
 for(const [status,fail] of [['approved',false],['review',false],['rejected',false],['rejected',true]]){
 const events=[];const db={from:table=>{let action='read';const q={select(){return q},eq(){return q},single:async()=>({data:{status,drive_file_id:'sb:slip.png'}}),upsert(){action='queue';return q},update(v){assert.equal(v.drive_file_id,null);action='detach';return q},delete(){action='unqueue';return q},then(resolve){events.push(action);resolve({data:{}})}};return q}};
 const ctx={module:{exports:{}},query:async q=>(await q).data,deleteDrive:async(id,strict)=>{assert.equal(id,'sb:slip.png');assert(strict);events.push('delete-file');if(fail)throw Error('network')},console:{warn(){}}};ctx.exports=ctx.module.exports;vm.runInNewContext(esbuild.transformSync(fn,{loader:'ts',format:'cjs'}).code,ctx);await ctx.module.exports.discardRejectedSlip(db,'payments','id');
 assert.deepEqual(events,status!=='rejected'?[]:fail?['queue','detach','delete-file']:['queue','detach','delete-file','unqueue']);
 }
});
