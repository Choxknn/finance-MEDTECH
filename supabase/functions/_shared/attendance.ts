import {query} from './services.ts';
async function rejectAdminAttendance(db:any,student:string){
 const admins=await query(db.from('profiles').select('id').eq('student_id',student).eq('role','admin').limit(1));
 if(admins.length)throw Error('ผู้ดูแลระบบไม่ต้องเช็คชื่อ');
}
export async function attendanceAction(db:any,profile:any,input:any){
 if(profile.role!=='admin')throw Error('เฉพาะผู้ดูแลระบบ');
 if(input.action==='attendance-list'){
  const sessions=await query(db.from('attendance_sessions').select('*').order('held_on',{ascending:false}).order('created_at',{ascending:false}).limit(200));
  const selected=sessions.some((s:any)=>s.id===input.session_id)?input.session_id:sessions[0]?.id;
  if(selected&&!sessions.some((s:any)=>s.id===selected))throw Error('ไม่พบรอบเช็คชื่อ');
  const [allMarks,activeMembers,adminProfiles]=await Promise.all([
   selected?query(db.from('attendance_marks').select('*').eq('session_id',selected).order('checked_at',{ascending:false})):Promise.resolve([]),
   query(db.from('profiles').select('id,student_id,name,year').eq('active',true).is('deleted_at',null).neq('role','admin').order('student_id')),
   query(db.from('profiles').select('id,student_id').eq('role','admin'))
  ]);
  const adminIds=new Set(adminProfiles.map((p:any)=>p.id));
  const adminStudentIds=new Set(adminProfiles.map((p:any)=>p.student_id).filter(Boolean));
  const marks=allMarks.filter((m:any)=>!adminIds.has(m.profile_id)&&!adminStudentIds.has(m.student_id));
  return {sessions,selected,marks,members:activeMembers};
 }
 if(input.action==='attendance-delete'){await query(db.from('attendance_sessions').delete().eq('id',input.id).select('id').single());return {ok:true}}
 if(input.action==='attendance-create'){
  const held_time=input.held_time?String(input.held_time):null;if(held_time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(held_time))throw Error('เวลาไม่ถูกต้อง');
  const title=String(input.title||'').trim(),held=String(input.held_on||'');if(!title||title.length>120||!/^\d{4}-\d{2}-\d{2}$/.test(held))throw Error('ระบุชื่อรอบและวันที่');
  return {session:await query(db.from('attendance_sessions').insert({title,held_on:held,held_time,created_by:profile.id}).select().single())};
 }
 if(input.action==='attendance-toggle'){
  if(typeof input.active!=='boolean')throw Error('สถานะไม่ถูกต้อง');await query(db.from('attendance_sessions').update({active:input.active}).eq('id',input.id).select('id').single());return {ok:true};
 }
 if(input.action==='attendance-set'){
  const student=String(input.student_id||'').trim();if(!/^\d{5,20}$/.test(student)||typeof input.checked!=='boolean')throw Error('ข้อมูลสถานะไม่ถูกต้อง');
  if(input.checked){await rejectAdminAttendance(db,student);return await query(db.rpc('check_in_student',{p_session:input.session_id,p_student:student,p_actor:profile.id}));}
  if(!input.mark_id)throw Error('กรุณาเปิดรายชื่อใหม่');
  const removed=await query(db.from('attendance_marks').delete().eq('id',input.mark_id).eq('session_id',input.session_id).eq('student_id',student).select('id'));
  if(!removed.length)throw Error('สถานะเปลี่ยนไปแล้ว กรุณาเปิดรายชื่อใหม่');
  return {ok:true};
 }
 if(input.action==='attendance-check'){
  const student=String(input.student_id||'').trim();if(!/^\d{5,20}$/.test(student))throw Error('QR รหัสนักศึกษาไม่ถูกต้อง');
  await rejectAdminAttendance(db,student);return await query(db.rpc('check_in_student',{p_session:input.session_id,p_student:student,p_actor:profile.id}));
 }
 throw Error('ไม่พบคำสั่งเช็คชื่อ');
}
