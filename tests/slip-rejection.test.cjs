const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),esbuild=require('esbuild');
function moduleFrom(path,extra={}){const code=esbuild.transformSync(fs.readFileSync(path,'utf8').replace(/^import .*;\n/gm,''),{loader:'ts',format:'cjs'}).code;const ctx={module:{exports:{}},Date,Number,Math,JSON,Error,...extra};ctx.exports=ctx.module.exports;vm.runInNewContext(code,ctx);return ctx.module.exports}
const services=moduleFrom('supabase/functions/_shared/services.ts');
test('non-slip and wrong receiver have definitive rejection; service failures do not',()=>{
 for(const code of [1005,1006,1007,1008,1011,1014])assert(services.slipRejectionReason({code}),String(code));
 for(const code of [1000,1001,1002,1003,1004,1009,1010,'LOCAL_QUOTA_EMPTY','LOCAL_BRANCH_ID',undefined])assert.equal(services.slipRejectionReason({code}),'',String(code));
 assert(services.slipRejectionReason({diagnostics:{receiverMismatch:true}}));
 const receiver=value=>({receiver:{proxy:{value}}});const target='006660001474178';
 assert(services.receiverDefinitelyWrong(receiver('006660001474179'),target));assert(services.receiverDefinitelyWrong(receiver('00666xxxxx74179'),target));
 assert(!services.receiverDefinitelyWrong(receiver('00666xxxxx74178'),target));assert(!services.receiverDefinitelyWrong(receiver('xxxxxxxxxxxxxxx'),target));assert(!services.receiverDefinitelyWrong(receiver('1234567890'),target));
});
test('shop persists rejection for non-slip and mismatched recipient and keeps outages in review',async()=>{
 for(const code of [1005,1006,1007,1008,1011,1014,1009,1010]){
 const writes=[];const db={from:()=>({select:()=>({eq:()=>({single:async()=>({data:{data:{accountNumber:'123'}}})})})}),rpc:async(name,args)=>{writes.push({name,args});return {data:{}}}};
 const shop=moduleFrom('supabase/functions/_shared/shop-payment.ts',{query:async q=>(await q).data,checkSlip:async()=>({ok:false,body:{code}}),isRecentSlip:()=>false,slipRejectionReason:services.slipRejectionReason,discardRejectedSlip:async()=>{}});
 const result=await shop.verifyShopSlip(db,{id:'payment',amount:100},{created_at:'2026-10-01'},{});const expected=[1009,1010].includes(code)?'review':'rejected';assert.equal(result.status,expected);assert.equal(writes[0].args.p_status,expected);assert.equal(writes[0].args.p_ref,null);
 }
});
