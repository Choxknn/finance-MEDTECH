const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),esbuild=require('esbuild');
let handler,inviteState='pending',createdPassword='',updatedPassword='',updatedUser='',finishFails=false,deleteCount=0;
let recoveryResult={id:'otp-row',profile_id:'member-user',line_user_id:'LINE-USER'},verifyValid=false,checkValid=false,loginValid=true,requestArgs=null,verifyArgs=null,checkArgs=null,linePushes=[],revokedUsers=[],securityEvents=[];
const reserve={student_id:'670111',name_prefix:'นาย',first_name:'Fixed',last_name:'Identity',year:'1'};
const db={
 rpc:async(name,args)=>{
  if(name==='request_line_recovery_otp'){requestArgs=args;return {data:recoveryResult}}
  if(name==='verify_line_recovery_otp'){verifyArgs=args;return {data:verifyValid?'member-user':null}}
  if(name==='check_line_recovery_otp'){checkArgs=args;return {data:checkValid}}
  if(name==='revoke_user_auth_sessions'){revokedUsers.push(args.p_user_id);return {data:4}}
  if(name==='claim_member_invite'){if(inviteState!=='pending')return {error:{message:'used'}};inviteState='processing';return {data:reserve}}
  if(name==='finish_member_invite'){inviteState='used';if(finishFails)return {error:{message:'lost response'}};return {data:null}}
  return {data:null}
 },
 auth:{
  signInWithPassword:async({email,password})=>loginValid?{data:{user:{id:'member-user'},session:{access_token:'login-access',refresh_token:'login-refresh',expires_at:1900000000,expires_in:3600,token_type:'bearer'}},error:null}:{data:{user:null,session:null},error:{message:'Invalid login credentials'}},
  admin:{
  createUser:async data=>{createdPassword=data.password;assert.equal(data.email,'670111@students.finance-medtech.invalid');return {data:{user:{id:'new-user'}}}},
  deleteUser:async()=>{deleteCount++;return {}},
  updateUserById:async(id,data)=>{updatedUser=id;updatedPassword=data.password;return {data:{user:{id}}}}
 }},
 from(table){
  let patch;
  const q={
   select(){return q},eq(){return q},gt(){return q},limit(){return q},
   update(value){patch=value;return q},
   maybeSingle(){return Promise.resolve({data:table==='member_invites'&&inviteState==='pending'?reserve:table==='line_accounts'?{line_user_id:'LINE-USER'}:null})},
   single(){return Promise.resolve({data:table==='member_invites'?{status:inviteState}:{id:'otp-row'}})},
   then(resolve,reject){if(patch&&table==='member_invites')inviteState=patch.status;return Promise.resolve({data:null}).then(resolve,reject)}
  };
  return q
 }
};
const flexSource=fs.readFileSync(require('path').resolve(__dirname,'../supabase/functions/_shared/line-flex.ts'),'utf8');
const flexModule={exports:{}};
vm.runInNewContext(esbuild.transformSync(flexSource,{loader:'ts',format:'cjs'}).code,{exports:flexModule.exports,module:flexModule});
const {accountOtpFlex,passwordChangedFlex}=flexModule.exports;
const source=fs.readFileSync(require('path').resolve(__dirname,'../supabase/functions/account-access/index.ts'),'utf8').replace(/^import .*;\n/gm,'');
vm.runInNewContext(esbuild.transformSync(source,{loader:'ts',format:'esm'}).code,{
 Deno:{env:{get:key=>key==='ALLOWED_ORIGINS'?'https://example.test':key==='SUPABASE_SERVICE_ROLE_KEY'?'service-secret':key==='LINE_CHANNEL_ACCESS_TOKEN'?'line-secret':''},serve:fn=>handler=fn},
 adminDb:()=>db,
 query:async promise=>{const result=await promise;if(result.error)throw Error(result.error.message);return result.data},
 hash:async value=>'digest:'+value,
 secret:key=>key==='SUPABASE_SERVICE_ROLE_KEY'?'service-secret':'line-secret',
 captchaConfig:()=>({site_key:'',enabled:false}),
 protectAccountRequest:async()=>({ipHash:'a'.repeat(64),targetHash:'b'.repeat(64),action:'test'}),
 recordAccountSecurityEvent:async(_db,context,event)=>securityEvents.push({context,event}),
 Response,Request,URL,Date,JSON,Error,AbortSignal,crypto:{getRandomValues:array=>{array[0]=123456;return array}},
 fetch:async(url,options)=>{linePushes.push({url,options});return {ok:true,status:200}},
 console:{warn:()=>{}},accountOtpFlex,passwordChangedFlex
});
const request=data=>new Request('https://project.test/functions/v1/account-access',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body:JSON.stringify(data)});
(async()=>{
 let r=await handler(request({action:'login',student_id:'670111',password:'CorrectPassword'}));
 assert.equal(r.status,200,'valid student credentials should create a session');
 const loginSession=await r.json();
 assert.equal(loginSession.access_token,'login-access');
 assert.equal(loginSession.refresh_token,'login-refresh');
 assert.ok(securityEvents.some(item=>item.event.type==='login_succeeded'),'successful login is written to security history');
 loginValid=false;
 r=await handler(request({action:'login',student_id:'670111',password:'WrongPassword'}));
 assert.equal(r.status,401,'invalid credentials must be rejected');
 assert.equal((await r.json()).error,'รหัสนักศึกษาหรือรหัสผ่านไม่ถูกต้อง');
 assert.ok(securityEvents.some(item=>item.event.type==='login_failed'),'failed login is written to security history');
 loginValid=true;
 r=await handler(request({action:'forgot',student_id:'670111'}));
 const generic=await r.json();
 assert.equal(r.status,200);
 assert.match(generic.message,/ส่งรหัส OTP/);
 assert.equal(linePushes.length,1,'linked accounts receive a LINE push');
 const push=JSON.parse(linePushes[0].options.body);
 assert.equal(push.to,'LINE-USER');
 assert.equal(push.messages[0].type,'flex','OTP must be sent as a LINE Flex Message');
 assert.match(JSON.stringify(push.messages[0]),/123456/);
 assert.equal(push.messages[0].altText,'รหัส OTP : 123456','LINE notification preview must show OTP, not the Flex card title');
 assert.equal(requestArgs.p_student,'670111');
 assert.match(requestArgs.p_code_hash,/service-secret/);
 assert.ok(!JSON.stringify(generic).includes('123456'),'OTP is never returned to the browser');

 r=await handler(request({action:'resend-otp',student_id:'670111'}));
 assert.equal(r.status,200);
 assert.match((await r.json()).message,/ส่งรหัส OTP/);
 assert.equal(linePushes.length,2,'resend action issues a replacement LINE OTP');
 const resendPush=JSON.parse(linePushes[1].options.body);
 assert.equal(resendPush.to,'LINE-USER');
 assert.equal(resendPush.messages[0].type,'flex','resent OTP must be sent as a LINE Flex Message');
 assert.equal(resendPush.messages[0].altText,'รหัส OTP : 123456');
 assert.match(JSON.stringify(resendPush.messages[0]),/123456/);
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
 const passwordReset=await r.json();
 assert.equal(updatedUser,'member-user');
 assert.equal(updatedPassword,'NewPass123');
 assert.equal(revokedUsers.length,1,'password recovery revokes all auth sessions');
 assert.equal(revokedUsers[0],'member-user');
 assert.equal(passwordReset.sessions_revoked,true);
 assert.equal(passwordReset.notification_sent,true);
 assert.equal(linePushes.length,3,'successful password recovery sends a LINE security alert');
 const securityNotice=JSON.parse(linePushes[2].options.body);
 assert.equal(securityNotice.to,'LINE-USER');
 assert.equal(securityNotice.messages[0].type,'flex','password confirmation must be a LINE Flex Message');
 assert.match(securityNotice.messages[0].altText,/เปลี่ยนรหัสผ่านสำเร็จ/);
 assert.match(JSON.stringify(securityNotice.messages[0]),/วันที่และเวลาที่เปลี่ยน/);
 assert.match(JSON.stringify(securityNotice.messages[0]),/หากไม่ใช่คุณที่ดำเนินการ/);
 const loggedTypes=securityEvents.map(item=>item.event.type);
 for(const eventType of ['login_succeeded','login_failed','otp_requested','otp_sent','otp_verification_failed','otp_verified','password_changed','sessions_revoked'])assert.ok(loggedTypes.includes(eventType),'security history records '+eventType);

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
