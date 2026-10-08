import {adminDb,query,secret,hash} from '../_shared/services.ts';
import {financeSite} from '../_shared/line-flex.ts';
const callback=financeSite+'line-callback.html';
const hex=(bytes:Uint8Array)=>[...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');
const unhex=(value:string)=>Uint8Array.from(value.match(/../g)||[],v=>parseInt(v,16));
const base64url=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
async function signingKey(){return crypto.subtle.importKey('raw',new TextEncoder().encode(secret('LINE_LOGIN_CHANNEL_SECRET')),{name:'HMAC',hash:'SHA-256'},false,['sign','verify'])}
async function signState(data:any){const bytes=new TextEncoder().encode(JSON.stringify(data));return hex(bytes)+hex(new Uint8Array(await crypto.subtle.sign('HMAC',await signingKey(),bytes)))}
async function readState(value:any){if(typeof value!=='string'||value.length>3000||value.length<66||!/^[a-f0-9]+$/.test(value)||value.length%2)throw Error('ข้อมูลยืนยัน LINE ไม่ถูกต้อง');const bytes=unhex(value.slice(0,-64));if(!await crypto.subtle.verify('HMAC',await signingKey(),unhex(value.slice(-64)),bytes))throw Error('ข้อมูลยืนยัน LINE ไม่ถูกต้อง');const data=JSON.parse(new TextDecoder().decode(bytes));if(!Number.isFinite(data.exp)||data.exp<Date.now())throw Error('การเชื่อมต่อหมดอายุ กรุณาลองใหม่');return data}
async function activeProfile(db:any,req:Request){const bearer=req.headers.get('authorization')?.replace(/^Bearer /,'');if(!bearer)throw Error('กรุณาเข้าสู่ระบบก่อนเชื่อม LINE');const auth=await db.auth.getUser(bearer);if(auth.error||!auth.data.user)throw Error('กรุณาเข้าสู่ระบบใหม่');return query(db.from('profiles').select('id,active').eq('id',auth.data.user.id).eq('active',true).is('deleted_at',null).single())}
async function linePost(path:string,body:Record<string,string>){const r=await fetch('https://api.line.me/'+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body),signal:AbortSignal.timeout(15000)});const j=await r.json();if(!r.ok)throw Error('ยืนยัน LINE ไม่สำเร็จ กรุณาเริ่มใหม่');return j}
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'',allowed=(Deno.env.get('ALLOWED_ORIGINS')||'').split(',').map(s=>s.trim());
 const headers={'Access-Control-Allow-Origin':allowed.includes(origin)?origin:'null','Access-Control-Allow-Headers':'apikey,content-type,authorization','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Vary':'Origin'};
 const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json'}});
 if(origin&&!allowed.includes(origin))return json({error:'Origin not allowed'},403);if(req.method==='OPTIONS')return new Response(null,{headers});if(req.method!=='POST')return json({error:'Method not allowed'},405);
 try{
  const raw=await req.text();if(raw.length>8192)throw Error('คำขอใหญ่เกินไป');const input=JSON.parse(raw);
  const clientId=Deno.env.get('LINE_LOGIN_CHANNEL_ID'),configured=!!clientId&&!!Deno.env.get('LINE_LOGIN_CHANNEL_SECRET');
  if(input.action==='status')return json({enabled:configured});
  if(!configured)return json({error:'ยังไม่ได้ตั้งค่า LINE Login กรุณาใช้รหัสนักศึกษาเข้าสู่ระบบก่อน'},503);
  const db=adminDb();
  if(input.action==='start'){
   if(!['login','link','signup'].includes(input.mode)||typeof input.challenge!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.challenge))throw Error('คำขอ LINE Login ไม่ถูกต้อง');
   const state:any={mode:input.mode,challenge:input.challenge,nonce:crypto.randomUUID().replaceAll('-',''),exp:Date.now()+600000};
   if(input.mode==='link')state.profile=(await activeProfile(db,req)).id;
   if(input.mode==='signup'){
    if(typeof input.session!=='string'||!/^[a-f0-9]{64}$/.test(input.session))throw Error('กรุณาเริ่มสมัครใหม่');state.sessionHash=await hash(input.session);
    const session=await query(db.from('registration_sessions').select('invite_id,batch_id').eq('session_hash',state.sessionHash).gt('expires_at',new Date().toISOString()).single());
    await query(db.from('member_invites').select('id').eq('id',session.invite_id).eq('batch_id',session.batch_id).eq('status','pending').gt('expires_at',new Date().toISOString()).single());
   }
   const signed=await signState(state),url=new URL('https://access.line.me/oauth2/v2.1/authorize');url.search=new URLSearchParams({response_type:'code',client_id:clientId!,redirect_uri:callback,state:signed,scope:'openid profile',nonce:state.nonce,code_challenge:state.challenge,code_challenge_method:'S256',bot_prompt:'normal'}).toString();return json({url:url.href,state:signed});
  }
  if(input.action!=='finish')throw Error('คำขอไม่ถูกต้อง');const state=await readState(input.state);
  if(typeof input.verifier!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(input.verifier)||base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input.verifier))))!==state.challenge)throw Error('ไม่พบคำขอจากเบราว์เซอร์นี้ กรุณาเริ่มใหม่');
  if(state.mode==='link'&&(await activeProfile(db,req)).id!==state.profile)throw Error('บัญชีที่เชื่อมไม่ตรงกัน');
  if(typeof input.code!=='string'||!input.code||input.code.length>2000)throw Error('ไม่ได้รับรหัสยืนยันจาก LINE');
  const tokens=await linePost('oauth2/v2.1/token',{grant_type:'authorization_code',code:input.code,redirect_uri:callback,client_id:clientId!,client_secret:secret('LINE_LOGIN_CHANNEL_SECRET'),code_verifier:input.verifier});
  if(!tokens.id_token)throw Error('ไม่ได้รับข้อมูลยืนยัน LINE');
  const identity=await linePost('oauth2/v2.1/verify',{id_token:tokens.id_token,client_id:clientId!,nonce:state.nonce});
  if(identity.nonce!==state.nonce||String(identity.aud)!==clientId||identity.iss!=='https://access.line.me'||identity.exp*1000<=Date.now()||!/^U[0-9a-f]{32}$/.test(identity.sub))throw Error('ข้อมูลยืนยัน LINE ไม่ถูกต้อง');
  const linked=await query(db.from('line_accounts').select('profile_id').eq('line_user_id',identity.sub).maybeSingle());
  if(state.mode==='signup'){
   if(linked)throw Error('LINE นี้มีบัญชีแล้ว กรุณาเข้าสู่ระบบด้วย LINE');
   const session=await query(db.from('registration_sessions').select('code_hash').eq('session_hash',state.sessionHash).gt('expires_at',new Date().toISOString()).single());
   const id=await query(db.rpc('consume_registration_line_code',{p_hash:session.code_hash,p_line_user:identity.sub}));if(!id)throw Error('การสมัครหมดอายุหรือเชื่อมแล้ว กรุณาเริ่มใหม่');return json({mode:'signup',ok:true});
  }
  if(state.mode==='link'){
   if(linked&&linked.profile_id!==state.profile)throw Error('LINE นี้เชื่อมกับสมาชิกคนอื่นแล้ว');
   await query(db.from('line_accounts').upsert({profile_id:state.profile,line_user_id:identity.sub},{onConflict:'profile_id'}));
   await query(db.from('line_link_codes').delete().eq('profile_id',state.profile));return json({mode:'link',ok:true});
  }
  if(state.mode!=='login'||!linked)throw Error('LINE นี้ยังไม่เชื่อมบัญชี กรุณาเข้าสู่ระบบด้วยรหัสนักศึกษาแล้วเชื่อม LINE ในหน้าโปรไฟล์');
  await query(db.from('profiles').select('id').eq('id',linked.profile_id).eq('active',true).is('deleted_at',null).single());
  const account=await db.auth.admin.getUserById(linked.profile_id);if(account.error||!account.data.user?.email)throw Error('ไม่พบบัญชีที่ใช้งานได้');
  const magic=await db.auth.admin.generateLink({type:'magiclink',email:account.data.user.email});if(magic.error||!magic.data.properties?.hashed_token)throw Error('สร้างเซสชันไม่สำเร็จ');
  const verified=await db.auth.verifyOtp({type:'email',token_hash:magic.data.properties.hashed_token});if(verified.error||!verified.data.session||verified.data.user?.id!==linked.profile_id)throw Error('เข้าสู่ระบบไม่สำเร็จ');
  const s=verified.data.session;return json({mode:'login',session:{access_token:s.access_token,refresh_token:s.refresh_token,expires_at:s.expires_at,expires_in:s.expires_in}});
 }catch(error){return json({error:error instanceof Error?error.message:'เชื่อม LINE ไม่สำเร็จ'},400)}
});
