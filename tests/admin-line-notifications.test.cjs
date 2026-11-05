const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),esbuild=require('esbuild'),{webcrypto}=require('node:crypto');
let handler,role='admin';const calls={notify:[],success:[],rpc:[]};
const rows={
 profiles:{id:'admin',name:'Admin',role:'admin',active:true},
 charges:{id:'charge-id',profile_id:'member-id',round_id:'round-id',amount:100},
 rounds:{id:'round-id',title:'บิลทดสอบ',created_at:'2026-11-01T00:00:00Z'},
 payments:{id:'payment-id',profile_id:'member-id',charge_id:'charge-id',amount:100,status:'review',drive_file_id:'evidence-file',trans_ref:null,verification:null,charges:{rounds:{title:'บิลทดสอบ',created_at:'2026-11-01T00:00:00Z'}}},
 site_settings:{data:{accountNumber:'123456'}}
};
const db={
 auth:{getUser:async()=>({data:{user:{id:'admin'}},error:null})},
 from(table){let q={select(){return q},eq(){return q},is(){return q},in(){return q},update(){return q},single:async()=>({data:rows[table],error:null}),maybeSingle:async()=>({data:rows[table],error:null}),then(resolve,reject){return Promise.resolve({data:rows[table],error:null}).then(resolve,reject)}};return q},
 rpc:async(name,args)=>{calls.rpc.push({name,args});return {data:null,error:null}}
};
const source=fs.readFileSync('supabase/functions/finance-api/index.ts','utf8').replace(/^import .*;\n/gm,'');
class TestFile{constructor(parts,name,opts={}){this.name=name;this.type=opts.type||'image/png';this.size=10}}
vm.runInNewContext(esbuild.transformSync(source,{loader:'ts',format:'esm'}).code,{
 Deno:{env:{get:k=>k==='ALLOWED_ORIGINS'?'https://example.test':'test-secret'},serve:f=>handler=f},
 adminDb:()=>db,query:async q=>{const r=await q;if(r.error)throw r.error;return r.data},
 limitRequest:async()=>{},notify:async(...args)=>{calls.notify.push(args);return 'sent'},
 paymentSuccess:async(...args)=>{calls.success.push(args);return {delivery:args[3]?'sent':'in_app'}},
 discardRejectedSlip:async()=>{},readEvidence:async()=>({ok:true,blob:async()=>new Blob(['image'],{type:'image/png'})}),
 validateImage:async f=>f,checkSlip:async()=>({ok:true,body:{data:{transRef:'SLIP-REF'}}}),
 isRecentSlip:()=>true,slipRejectionReason:()=>null,slipOverpaid:()=>false,overpaidMessage:'ยอดเกิน',
 Request,Response,URL,AbortSignal,crypto:webcrypto,File:TestFile,Blob,Date,Error,String,Number,Math,JSON,Object,Array,Set,Promise,TextDecoder,Uint8Array,console
});
const request=body=>new Request('https://project.test/functions/v1/finance-api',{method:'POST',headers:{origin:'https://example.test',authorization:'Bearer session','content-type':'application/json'},body:JSON.stringify(body)});
async function call(body){const res=await handler(request(body));const data=await res.json();assert.equal(res.status,200,JSON.stringify(data));return data}
(async()=>{
 const editEnabled=await call({action:'edit-record',entity:'charge',id:'charge-id',patch:{amount:150,reason:'ปรับยอด'},notify_line:true});
 assert.equal(editEnabled.line_notification,'sent','individual bill edit reports successful LINE delivery');
 assert.equal(calls.notify.length,1,'individual bill edit sends when enabled');
 assert.equal(calls.notify[0][1],'member-id');assert.equal(calls.notify[0][2],'bill_updated');
 const editDisabled=await call({action:'edit-record',entity:'charge',id:'charge-id',patch:{amount:160,reason:'ปรับยอด'},notify_line:false});
 assert.equal(editDisabled.line_notification,'not_requested','disabled LINE toggle reports no request');
 assert.equal(calls.notify.length,1,'individual bill edit does not send when disabled');
 await call({action:'set-bill-status',charge_id:'charge-id',status:'approved',reason:'รับเงินแล้ว',expected_paid:0,expected_balance:100,request_id:'request-1',notify_line:true});
 assert.equal(calls.success.length,1,'manual mark-paid sends when enabled');assert.equal(calls.success[0][1],'member-id');assert.equal(calls.success[0][3],true);
 await call({action:'set-bill-status',charge_id:'charge-id',status:'approved',reason:'รับเงินแล้ว',expected_paid:0,expected_balance:100,request_id:'request-2',notify_line:false});
 assert.equal(calls.success.length,1,'manual mark-paid does not send when disabled');
 await call({action:'review',payment_id:'payment-id',decision:'approved',note:'ผ่าน',notify_line:true});
 assert.equal(calls.success.length,2,'payment review sends when enabled');assert.equal(calls.success[1][3],true);
 await call({action:'review',payment_id:'payment-id',decision:'approved',note:'ผ่าน',notify_line:false});
 assert.equal(calls.success.length,3);assert.equal(calls.success[2][3],false,'payment review respects disabled toggle');
 await call({action:'review',payment_id:'payment-id',decision:'rejected',note:'ไม่ผ่าน',notify_line:true});
 assert.equal(calls.success.length,3,'rejected payment never sends success Flex');
 await call({action:'retry-payment',payment_id:'payment-id'});
 assert.equal(calls.success.length,4,'successful SlipOK retry always creates success notification');
 assert.equal(calls.success[3][3],true,'successful SlipOK retry sends without needing a toggle');
 console.log('Admin LINE notification routing passed: individual edit, mark-paid, payment review toggle, and automatic successful SlipOK retry');
})().catch(e=>{console.error(e);process.exitCode=1});
