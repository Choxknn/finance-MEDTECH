const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),esbuild=require('esbuild');
let handler,inviteState='pending',createdPassword='',updatedPassword='',updatedUser='',finishFails=false,deleteCount=0;
let recoveryResult={id:'otp-row',profile_id:'member-user',line_user_id:'LINE-USER'},verifyValid=false,checkValid=false,requestArgs=null,verifyArgs=null,checkArgs=null,linePushes=[];
const reserve={student_id:'670111',name_prefix:'นาย',first_name:'Fixed',last_name:'Identity',year:'1'};
const db={
 rpc:async(name,args)=>{
  if(name==='request_line_recovery_otp'){requestArgs=args;return {data:recoveryResult}}
  if(name==='verify_line_recovery_otp'){verifyArgs=args;return {data:verifyValid?'member-user':null}}
  if(name==='check_line_recovery_otp'){checkArgs=args;return {data:checkValid}}
  if(name==='claim_member_invite'){if(inviteState!=='pending')return {error:{message:'used'}};inviteState='processing';return {data:reserve}}
  if(name==='finish_member_invite'){inviteState='used';if(finishFails)return {error:{message:'lost response'}};return {data:null}}
  return {data:null}
 },
 auth:{admin:{
  createUser:async data=>{createdPassword=data.password;assert.equal(data.email,'670111@students.finance-medtech.invalid');return {data:{user:{id:'new-user'}}}},
  deleteUser:async()=>{deleteCount++;return {}},
  updateUserById:async(id,data)=>{updatedUser=id;updatedPassword=data.password;return {data:{user:{id}}}}
 }},
 from(table){
  let patch;
  const q={
   select(){return q},eq(){return q},gt(){return q},limit(){return q},
   update(value){patch=value;return q},
   maybeSingle(){return Promise.resolve({data:table==='member_invites'&&inviteState==='pending'?reserve:null})},
   single(){return Promise.resolve({data:table==='member_invites'?{status:inviteState}:{id:'otp-row'}})},
   then(resolve,reject){if(patch&&table==='member_invites')inviteState=patch.status;return Promise.resolve({data:null}).then(resolve,reject)}
  };
  return q
 }
};
const source=fs.readFileSync(require('path').resolve(__dirname,'../supabase/functions/account-access/index.ts'),'utf8').replace(/^import .*;\n/gm,'');
vm.runInNewContext(esbuild.transformSync(source,{loader:'ts',format:'esm'}).code,{
 Deno:{env:{get:key=>key==='ALLOWED_ORIGINS'?'https://example.test':key==='SUPABASE_SERVICE_ROLE_KEY'?'service-secret':key==='LINE_CHANNEL_ACCESS_TOKEN'?'line-secret':''},serve:fn=>handler=fn},
 adminDb:()=>db,
 query:async promise=>{const result=await promise;if(result.error)throw Error(result.error.message);return result.data},
 hash:async value=>'digest:'+value,
 secret:key=>key==='SUPABASE_SERVICE_ROLE_KEY'?'service-secret':'line-secret',
 captchaConfig:()=>({site_key:'',enabled:false}),
 protectAccountRequest:async()=>{},
 Response,Request,URL,Date,JSON,Error,AbortSignal,crypto:{getRandomValues:array=>{array[0]=123456;return array}},
 fetch:async(url,options)=>{linePushes.push({url,options});return {ok:true,status:200}},
 console:{warn:()=>{}}
});
const request=data=>new Request('https://project.test/functions/v1/account-access',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body:JSON.stringify(data)});
(async()=>{
 let r=await handler(request({action:'forgot',student_id:'670111'}));
 const generic=await r.json();
 assert.equal(r.status,200);
 assert.match(generic.message,/ส่งรหัส OTP/);
 assert.equal(linePushes.length,1,'linked accounts receive a LINE push');
 const push=JSON.parse(linePushes[0].options.body);
 assert.equal(push.to,'LINE-USER');
 assert.match(push.messages[0].text,/123456/);
 assert.equal(requestArgs.p_student,'670111');
 assert.match(requestArgs.p_code_hash,/service-secret/);
 assert.ok(!JSON.stringify(generic).includes('123456'),'OTP is never returned to the browser');

 r=await handler(request({action:'resend-otp',student_id:'670111'}));
 assert.equal(r.status,200);
 assert.match((await r.json()).message,/ส่งรหัส OTP/);
 assert.equal(linePushes.length,2,'resend action issues a replacement LINE OTP');
 const resendPush=JSON.parse(linePushes[1].options.body);
 assert.equal(resendPush.to,'LINE-USER');
 assert.match(resendPush.messages[0].text,/123456/);
 assert.equal(requestArgs.p_student,'670111');
 
 recoveryResult=null;
 r=await handler(request({action:'forgot',student_id:'999999'}));
 assert.deepEqual(await r.json(),generic,'Do not disclose whether an account or LINE link exists');
 assert.equal(linePushes.length,2,'unlinked IDs do not receive additional LINE messages');

 checkValid=true;
 r=await handler(request({action:'check-otp',student_id:'670111',otp:'123456'}));
 assert.equal(r.status,200);assert.equal((await r.json()).valid,true);assert.equal(checkArgs.p_student,'670111');
 checkValid=false;
 r=await handler(request({action:'check-otp',student_id:'670111',otp:'000000'}));
 assert.equal((await r.json()).valid,false);
 verifyValid=false;
 r=await handler(request({action:'verify-otp',student_id:'670111',otp:'000000',password:'Ab1234'}));
 assert.equal(r.status,400);
 assert.equal(updatedPassword,'','invalid OTP cannot change password');
 assert.equal(verifyArgs.p_student,'670111');

 verifyValid=true;
 r=await handler(request({action:'verify-otp',student_id:'670111',otp:'123456',password:'NewPass123'}));
 assert.equal(r.status,200);
 assert.equal(updatedUser,'member-user');
 assert.equal(updatedPassword,'NewPass123');

 r=await handler(request({action:'invite-preview',token:'a'.repeat(64)}));
 assert.equal(r.status,200);
 assert.equal(inviteState,'pending','Preview cannot consume invite');
 r=await handler(request({action:'invite-accept',token:'a'.repeat(64),password:'12345'}));
 assert.equal(r.status,400);
 assert.equal(inviteState,'pending');
 r=await handler(request({action:'invite-accept',token:'a'.repeat(64),password:'Ab1234',student_id:'other',role:'admin'}));
 assert.equal(r.status,200);
 assert.equal(createdPassword,'Ab1234');
 assert.equal(inviteState,'used');
 r=await handler(request({action:'invite-accept',token:'a'.repeat(64),password:'Ab1234'}));
 assert.equal(r.status,400);
 inviteState='pending';finishFails=true;
 r=await handler(request({action:'invite-accept',token:'a'.repeat(64),password:'Ab1234'}));
 assert.equal(r.status,200);
 assert.equal(deleteCount,0,'Lost response must not delete accepted user');
 console.log('LINE OTP recovery: push delivery, generic account responses, hashed OTP verification, password update, and invite protections passed');
})().catch(error=>{console.error(error);process.exitCode=1});
