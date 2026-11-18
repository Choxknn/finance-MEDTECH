const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto'),esbuild=require('esbuild');
const source=fs.readFileSync(path.resolve(__dirname,'../supabase/functions/_shared/bot-protection.ts'),'utf8').replace(/^import .*;\n/gm,'');
function makeDb({failLimitAt=0,blocked=false,countOverride=null}={}){
 let calls=0;const events=[],blocks=[];
 const db={
  events,blocks,
  rpc:async(name,args)=>{
   if(name!=='allow_finance_request')return {data:null,error:null};
   calls++;return {data:failLimitAt===calls?false:true,error:null};
  },
  from(table){
   const filters={};
   const q={
    select(){return q},
    eq(k,v){filters[k]=v;return q},
    gt(k,v){filters[k]={gt:v};return q},
    gte(k,v){filters[k]={gte:v};return q},
    in(k,v){filters[k]={in:v};return q},
    maybeSingle(){return Promise.resolve({data:table==='account_security_blocks'&&blocked?{blocked_until:new Date(Date.now()+60000).toISOString()}:null,error:null})},
    insert(row){if(table==='account_security_events')events.push(row);return Promise.resolve({data:null,error:null})},
    upsert(row){if(table==='account_security_blocks')blocks.push(row);return Promise.resolve({data:null,error:null})},
    then(resolve,reject){
     const matching=events.filter(row=>Object.entries(filters).every(([key,value])=>{
      if(value&&typeof value==='object'&&'in'in value)return value.in.includes(row[key]);
      if(value&&typeof value==='object'&&'gte'in value)return row[key]>=value.gte;
      if(value&&typeof value==='object'&&'gt'in value)return row[key]>value.gt;
      return row[key]===value;
     })).length;
     return Promise.resolve({count:countOverride===null?matching:countOverride,error:null,data:null}).then(resolve,reject);
    }
   };
   return q;
  }
 };
 return db;
}
const moduleBox={exports:{}};
vm.runInNewContext(esbuild.transformSync(source,{loader:'ts',format:'cjs'}).code,{
 exports:moduleBox.exports,module:moduleBox,
 query:async promise=>{const result=await promise;if(result.error)throw Error(result.error.message||'database error');return result.data},
 hash:async value=>crypto.createHash('sha256').update(value).digest('hex'),
 secret:()=> 'service-role-test-secret',
 Deno:{env:{get:key=>key==='SUPABASE_SERVICE_ROLE_KEY'?'service-role-test-secret':''}},
 fetch:async()=>({ok:true,json:async()=>({success:true})}),URL,Date,AbortSignal,console:{warn:()=>{}}
});
const {protectAccountRequest,recordAccountSecurityEvent}=moduleBox.exports;
const request=(action='forgot')=>new Request('https://example.test',{headers:{'x-forwarded-for':'198.51.100.10','user-agent':'test-agent'}});
(async()=>{
 const okDb=makeDb();
 const context=await protectAccountRequest(okDb,request(),{action:'forgot',student_id:'670111'});
 assert.match(context.ipHash,/^[0-9a-f]{64}$/);assert.match(context.targetHash,/^[0-9a-f]{64}$/);
 assert.equal(okDb.events.length,0,'normal requests do not create anomaly events');

 const blockedDb=makeDb({failLimitAt:2,countOverride:3});
 await assert.rejects(()=>protectAccountRequest(blockedDb,request(),{action:'forgot',student_id:'670111'}),error=>error.status===429);
 assert.ok(blockedDb.events.some(event=>event.event_type==='rate_limit_exceeded'));
 assert.ok(blockedDb.events.some(event=>event.event_type==='ip_temporarily_blocked'));
 assert.equal(blockedDb.blocks.length,1,'three abnormal rate-limit events temporarily block the IP');
 assert.equal(blockedDb.blocks[0].target_hash,'0'.repeat(64),'network-wide anomalies create an IP-wide block');

 const existingBlock=makeDb({blocked:true});
 await assert.rejects(()=>protectAccountRequest(existingBlock,request(),{action:'forgot',student_id:'670111'}),error=>error.status===429);

 const otpDb=makeDb();
 for(let i=0;i<5;i++)await recordAccountSecurityEvent(otpDb,context,{type:'otp_verification_failed',severity:'warning',message:'กรอกรหัส OTP ไม่ถูกต้อง'});
 assert.ok(otpDb.blocks.length===1,'five failed OTP checks for one target temporarily block the source IP');
 assert.equal(otpDb.blocks[0].target_hash,context.targetHash,'OTP failures block only this account on this network');
 assert.ok(otpDb.events.some(event=>event.event_type==='ip_temporarily_blocked'));

 const loginDb=makeDb();
 for(let i=0;i<5;i++)await recordAccountSecurityEvent(loginDb,context,{type:'login_failed',severity:'warning',message:'เข้าสู่ระบบไม่สำเร็จ'});
 assert.equal(loginDb.blocks.length,1,'five failed password logins trigger a temporary account block');
 assert.equal(loginDb.blocks[0].target_hash,context.targetHash,'password failures do not block other accounts behind the same router');

 console.log('Account protection: request rate limits, IP anomaly blocking, repeated OTP failure blocking and security event recording passed');
})().catch(error=>{console.error(error);process.exitCode=1});
