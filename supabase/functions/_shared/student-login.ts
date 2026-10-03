// Keep the auth user UUID (and all financial links) while changing its login address.
export async function changeStudentLogin(db:any,targetId:string,studentId:string,domain:string){
 const email=`${studentId}@${domain}`.toLowerCase();const current=await db.auth.admin.getUserById(targetId);if(current.error||!current.data.user)throw Error('ไม่พบบัญชีเข้าสู่ระบบของสมาชิก');
 const oldEmail=current.data.user.email;if(!oldEmail)throw Error('บัญชีนี้ไม่มีอีเมลเข้าสู่ระบบ');let conflict:any=null;
 for(let page=1;;page++){const r=await db.auth.admin.listUsers({page,perPage:1000});if(r.error)throw Error('ตรวจสอบรหัสเข้าสู่ระบบไม่สำเร็จ');conflict=r.data.users.find((u:any)=>u.id!==targetId&&u.email?.toLowerCase()===email);if(conflict||r.data.users.length<1000)break;}
 if(conflict){const owner=await db.from('profiles').select('id').eq('id',conflict.id).maybeSingle();if(owner.error)throw Error('ตรวจสอบบัญชีเดิมไม่สำเร็จ');if(owner.data)throw Error('รหัสนี้ผูกกับบัญชีสมาชิกอื่นอยู่ กรุณาตรวจสอบสมาชิกและถังขยะ');
  if(!Number.isFinite(Date.parse(conflict.created_at))||Date.now()-Date.parse(conflict.created_at)<3600000)throw Error('รหัสนี้กำลังถูกใช้สร้างบัญชี กรุณาลองใหม่ภายหลัง');
  // Retain the old orphan auth record; release only its login address, never merge accounts.
  const retired=await db.auth.admin.updateUserById(conflict.id,{email:`retired-${conflict.id}@${domain}`,email_confirm:true});if(retired.error)throw Error('จัดการรหัสของบัญชีเก่าที่ค้างไม่สำเร็จ');
 }
 const updated=await db.auth.admin.updateUserById(targetId,{email,email_confirm:true});if(updated.error)throw Error(['email_exists','email_address_not_authorized','user_already_exists'].includes(updated.error.code)?'รหัสนี้มีบัญชีเข้าสู่ระบบแล้ว':'เปลี่ยนข้อมูลเข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่');
 return {oldEmail,retiredId:conflict?.id||null};
}
