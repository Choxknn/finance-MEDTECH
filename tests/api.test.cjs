const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const esbuild=require('esbuild');
let handler,role='member',rpcCalls=[];
const db={auth:{getUser:async()=>({data:{user:{id:'actor'}},error:null})},from:()=>({select:()=>({eq(){return this},is(){return this},single:async()=>({data:{id:'actor',name:'Test',role,active:true},error:null})})}),rpc:async(name,args)=>{rpcCalls.push({name,args});return {data:null,error:null}}};
const src=fs.readFileSync(require('node:path').resolve(__dirname,'../supabase/functions/finance-api/index.ts'),'utf8').replace(/^import .*;\n/,'');
vm.runInNewContext(esbuild.transformSync(src,{loader:'ts',format:'esm'}).code,{Deno:{env:{get:k=>k==='ALLOWED_ORIGINS'?'https://example.test':undefined},serve:f=>handler=f},adminDb:()=>db,query:async q=>{const r=await q;if(r.error)throw r.error;return r.data},Response,Request,URL,AbortSignal,crypto,File,Uint8Array,Date,Set,Number,String,JSON,Error});
const request=data=>new Request('https://project.test/functions/v1/finance-api',{method:'POST',headers:{origin:'https://example.test',authorization:'Bearer fake','content-type':'application/json'},body:JSON.stringify(data)});
(async()=>{
const noAuth=await handler(new Request('https://project.test/functions/v1/finance-api',{method:'POST',body:'{}'}));assert.equal(noAuth.status,401);
for(const action of ['save-payment-qr','delete-payment-qr','save-income','delete-records','unlink-line','edit-record','save-settings','reset-password','change-student-id','import-members','assign-round']){const r=await handler(request({action}));assert.equal(r.status,400);assert.match((await r.json()).error,/ไม่มีสิทธิ์/)}
assert.equal(rpcCalls.length,0,'member cannot reach management RPCs');
let denied=await handler(request({action:'edit-self',name:'Changed',year:'1'}));assert.equal(denied.status,403);assert.equal(rpcCalls.length,0);role='admin';let r=await handler(request({action:'edit-record',entity:'round',id:'round-id',patch:{title:' test ',description:'',amount:150,due_date:'2026-10-05',archived:false}}));assert.equal(r.status,200);assert.equal(rpcCalls[0].name,'manage_record');assert.equal(rpcCalls[0].args.p_actor,'actor');assert.equal(rpcCalls[0].args.p_patch.title,'test');
r=await handler(request({action:'delete-records',entity:'member',ids:['actor'],deleted:true,reason:'test'}));assert.equal(r.status,400);
r=await handler(request({action:'edit-record',entity:'member',id:'member-id',patch:{name:'Test',role:'superadmin',year:'1',active:true}}));assert.equal(r.status,400);
r=await handler(request({action:'save-settings',settings:{siteName:'Test',bankName:'Bank',accountName:'Name',accountNumber:'001',lineOaUrl:'javascript:alert(1)',paymentQrUrl:'./payment-qr.png'}}));assert.equal(r.status,400);
r=await handler(request({action:'edit-record',entity:'charge',id:'charge',patch:{amount:10.001,reason:'test'}}));assert.equal(r.status,400);
r=await handler(new Request('https://project.test/functions/v1/finance-api',{method:'POST',headers:{origin:'https://evil.test'},body:'{}'}));assert.equal(r.status,403);
r=await handler(request({action:'save-income',title:'Donation',category:'Gift',amount:123,received_on:'2026-10-02'}));assert.equal(r.status,200);assert.equal(rpcCalls.at(-1).name,'save_manual_income');r=await handler(request({action:'save-income',title:'Gift',category:'Gift',amount:-1,received_on:'2026-10-02'}));assert.equal(r.status,400);
r=await handler(request({action:'save-payment-qr',amount:-1}));assert.equal(r.status,400);r=await handler(request({action:'delete-payment-qr',amount_cents:12.5}));assert.equal(r.status,400);r=await handler(request({action:'delete-payment-qr',amount_cents:0}));assert.equal(r.status,200);assert.equal(rpcCalls.at(-1).name,'manage_payment_qr');assert.equal(rpcCalls.at(-1).args.p_delete,true);
console.log('API authentication, admin authorization, patch validation, CORS, URL and money validation passed');
})().catch(e=>{console.error(e);process.exitCode=1});
