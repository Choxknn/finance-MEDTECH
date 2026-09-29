// Run only on a trusted machine. Values are read from the environment, never from CLI arguments.
const needed=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','ADMIN_STUDENT_ID','ADMIN_NAME','ADMIN_PASSWORD'];
for(const key of needed)if(!process.env[key])throw Error(`Missing ${key}`);
const env=process.env,sid=env.ADMIN_STUDENT_ID.toLowerCase();
if(!/^[a-z0-9_-]{3,20}$/.test(sid)||env.ADMIN_PASSWORD.length<12)throw Error('Invalid ID or password shorter than 12 characters');
const base=env.SUPABASE_URL,headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'};
async function request(path,method,body){const r=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(`Supabase ${method} ${path}: HTTP ${r.status}`);return r.status===204?null:await r.json()}
const user=await request('/auth/v1/admin/users','POST',{email:`${sid}@${env.STUDENT_EMAIL_DOMAIN||'students.finance-medtech.invalid'}`,password:env.ADMIN_PASSWORD,email_confirm:true});
try{await request('/rest/v1/profiles','POST',{id:user.id,student_id:env.ADMIN_STUDENT_ID,name:env.ADMIN_NAME,role:'admin',year:null})}
catch(e){await request(`/auth/v1/admin/users/${user.id}`,'DELETE');throw e}
console.log('Admin account created. Sign in with the configured account ID.');
