import {query} from './services.ts';
export async function attendanceAction(db:any,profile:any,input:any){
 if(profile.role!=='admin')throw Error('เฉพาะผู้ดูแลระบบ');
 if(input.action==='attendance-list'){
  const sessions=await query(db.from('attendance_sessions').select('*').order('held_on',{ascending:false}).order('created_at',{ascending:false}).limit(200));
  const selected=input.session_id||sessions[0]?.id;
  if(selected&&!sessions.some((s:any)=>s.id===selected))throw Error('ไม่พบรอบเช็คชื่อ');
  const marks=selected?await query(db.from('attendance_marks').select('*').eq('session_id',selected).order('checked_at',{ascending:false})):[];
  const members=await query(db.from('profiles').select('id,student_id,name,year').eq('active',true).is('deleted_at',null).order('student_id'));
  return {sessions,selected,marks,members};
 }
 if(input.action==='attendance-create'){
  const title=String(input.title||'').trim(),held=String(input.held_on||'');if(!title||title.length>120||!/^\d{4}-\d{2}-\d{2}$/.test(held))throw Error('ระบุชื่อรอบและวันที่');
  return {session:await query(db.from('attendance_sessions').insert({title,held_on:held,created_by:profile.id}).select().single())};
 }
 if(input.action==='attendance-toggle'){
  if(typeof input.active!=='boolean')throw Error('สถานะไม่ถูกต้อง');await query(db.from('attendance_sessions').update({active:input.active}).eq('id',input.id).select('id').single());return {ok:true};
 }
 if(input.action==='attendance-check'){
  const student=String(input.student_id||'').trim();if(!/^\d{5,20}$/.test(student))throw Error('QR รหัสนักศึกษาไม่ถูกต้อง');
  return await query(db.rpc('check_in_student',{p_session:input.session_id,p_student:student,p_actor:profile.id}));
 }
 throw Error('ไม่พบคำสั่งเช็คชื่อ');
}
