'use strict';
(()=>{
 let rows=[],loaded=false,loading=false,loadError='',scope='active',statusFilter='all',search='';
 const statusText={pending:'รอส่งตรวจ',review:'รอตรวจสอบ',approved:'ชำระแล้ว',rejected:'ไม่ผ่าน'};
 const paymentAdminPerson=p=>p.profiles||p.member_snapshot||{};
 const paymentAdminCharge=p=>p.charges||p.charge_snapshot||{};
 const paymentAdminRound=p=>paymentAdminCharge(p).rounds||paymentAdminCharge(p).round_snapshot||{};
 const paymentAdminCode=p=>String(p.verification?.code??p.verification?.data?.code??'');
 const paymentAdminMessage=p=>String(p.verification?.message??p.verification?.data?.message??p.note??'');
 function paymentAdminPage(){
  if(user?.role!=='admin')return head('ไม่มีสิทธิ์เข้าถึง','หน้านี้สำหรับผู้ดูแลระบบเท่านั้น');
  const active=rows.filter(p=>!p.deleted_at).length,trashed=rows.length-active,verified=rows.filter(p=>p.verification).length;
  return head('จัดการรายการชำระเงิน / SlipOK','ตรวจสอบข้อมูลการชำระ ผลตอบกลับจาก SlipOK และจัดการรายการที่ซ่อน')+
   '<section class="pa-stats">'+
   `<article><small>รายการที่ใช้งาน</small><strong>${active.toLocaleString('th-TH')}</strong></article><article><small>ซ่อนในถังขยะ</small><strong>${trashed.toLocaleString('th-TH')}</strong></article><article><small>มีประวัติ SlipOK</small><strong>${verified.toLocaleString('th-TH')}</strong></article></section>`+
   '<div class="toolbar pa-toolbar"><input id="payment-admin-search" type="search" placeholder="ค้นหา" aria-label="ค้นหารายการชำระเงิน" value="'+esc(search)+'"><label>แสดง<select id="payment-admin-scope"><option value="active" '+(scope==='active'?'selected':'')+'>รายการใช้งาน</option><option value="trash" '+(scope==='trash'?'selected':'')+'>รายการที่ซ่อน</option><option value="all" '+(scope==='all'?'selected':'')+'>ทั้งหมด</option></select></label><label>สถานะ<select id="payment-admin-status"><option value="all" '+(statusFilter==='all'?'selected':'')+'>ทุกสถานะ</option>'+Object.entries(statusText).map(([v,t])=>'<option value="'+v+'" '+(statusFilter===v?'selected':'')+'>'+t+'</option>').join('')+'</select></label><button type="button" class="secondary" data-pa-refresh '+(loading?'disabled':'')+'>'+ (loading?'กำลังโหลด…':'รีเฟรชข้อมูล')+'</button></div>'+
   '<p class="pa-retention-note">การซ่อนเป็นการลบแบบกู้คืนได้ เก็บไว้ 30 วันก่อนระบบล้างถังขยะอัตโนมัติ ทุกการแก้ไข ซ่อน และกู้คืนจะถูกบันทึกใน “ประวัติการแก้ไข”</p>'+
   (loading?'<div class="panel"><div class="empty">กำลังโหลดข้อมูลรายการชำระเงินและผลตรวจ SlipOK…</div></div>':loadError?'<div class="panel"><div class="empty"><p class="error">'+esc(loadError)+'</p><button type="button" class="secondary" data-pa-refresh>ลองอีกครั้ง</button></div></div>':'<section id="payment-admin-results">'+paymentAdminRowsHtml()+'</section>');
 }
 function paymentAdminRowsFiltered(){
  const q=search.trim().toLocaleLowerCase('th');
  return rows.filter(p=>scope==='all'||(scope==='trash'?!!p.deleted_at:!p.deleted_at))
   .filter(p=>statusFilter==='all'||p.status===statusFilter)
   .filter(p=>{
    if(!q)return true;
    const person=paymentAdminPerson(p),round=paymentAdminRound(p),charge=paymentAdminCharge(p);
    return [p.id,p.trans_ref,p.note,p.amount,p.status,p.source,paymentAdminCode(p),paymentAdminMessage(p),person.name,person.student_id,round.title,charge.title].some(v=>String(v??'').toLocaleLowerCase('th').includes(q));
   });
 }
 function paymentAdminRowsHtml(){
  const list=paymentAdminRowsFiltered();
  if(!list.length)return '<div class="panel"><div class="empty">ไม่พบรายการที่ตรงกับเงื่อนไข</div></div>';
  return '<div class="panel pa-table-panel"><div class="panel-head"><h2>รายการชำระเงิน ('+list.length.toLocaleString('th-TH')+')</h2><span class="help">แสดงสูงสุด 500 รายการล่าสุด</span></div><div class="table-wrap"><table class="pa-table"><thead><tr><th>วันเวลา</th><th>สมาชิก / บิล</th><th>ยอดเงิน</th><th>สถานะ</th><th>ผลตรวจ SlipOK</th><th>จัดการ</th></tr></thead><tbody>'+
  list.map(p=>{
   const person=paymentAdminPerson(p),round=paymentAdminRound(p),code=paymentAdminCode(p),message=paymentAdminMessage(p),deleted=!!p.deleted_at;
   const status=badge(p.status);
   const result=p.verification?(code?'<span class="pa-code">รหัส '+esc(code)+'</span>':'<span class="pa-code pa-code-ok">มีผลตอบกลับ</span>'):'<span class="help">ไม่มีผลตรวจ</span>';
   const resultMessage=p.verification?'<small class="pa-result-message">'+esc(message||'ไม่มีข้อความจากผู้ให้บริการ')+'</small>':'';
   const actions=deleted
    ?'<button type="button" class="secondary small" data-pa-details="'+esc(p.id)+'">ดูข้อมูล</button><button type="button" class="secondary small" data-pa-restore="'+esc(p.id)+'">กู้คืน</button>'
    :'<div class="pa-actions"><button type="button" class="secondary small" data-pa-details="'+esc(p.id)+'">รายละเอียด</button><button type="button" class="secondary small" data-pa-edit="'+esc(p.id)+'">แก้หมายเหตุ</button>'+(p.drive_file_id?'<button type="button" class="ghost small" data-pa-evidence="'+esc(p.id)+'">หลักฐาน</button>':'')+(p.status==='pending'||p.status==='review'?'<button type="button" class="ghost small" data-pa-review>ไปหน้าตรวจสอบ</button>':'')+'<button type="button" class="danger ghost small" data-pa-delete="'+esc(p.id)+'">ซ่อน</button></div>';
   return '<tr class="'+(deleted?'pa-deleted':'')+'"><td><strong>'+esc(dateTime(p.created_at))+'</strong>'+(deleted?'<small class="pa-deleted-label">ซ่อนเมื่อ '+esc(dateTime(p.deleted_at))+'</small>':'')+'<small class="pa-id">'+esc(p.id)+'</small></td><td><strong>'+esc(person.name||'สมาชิกที่ไม่มีข้อมูล')+'</strong><small>'+esc(person.student_id||'—')+'</small><small>'+esc(round.title||paymentAdminCharge(p).title||'รายการชำระเงิน')+'</small></td><td><strong>฿'+money(p.amount)+'</strong><small>'+esc(p.trans_ref?'อ้างอิง '+p.trans_ref:'ไม่มีเลขอ้างอิง')+'</small></td><td>'+status+(p.verification_method?'<small>'+esc(p.verification_method==='slipok'?'ตรวจด้วย SlipOK':'ตรวจโดยแอดมิน')+'</small>':'')+'</td><td>'+result+resultMessage+'</td><td>'+actions+'</td></tr>';
  }).join('')+'</tbody></table></div></div>';
 }
 async function loadPaymentAdminRows(){
  if(user?.role!=='admin'||loading)return;
  loading=true;loadError='';render();
  try{const result=await api('admin-payment-records');if(!Array.isArray(result.payments))throw Error('รูปแบบข้อมูลจากเซิร์ฟเวอร์ไม่ถูกต้อง');rows=result.payments;loaded=true}
  catch(error){loadError=error instanceof Error?error.message:'โหลดข้อมูลไม่สำเร็จ';loaded=true}
  finally{loading=false;if(user?.role==='admin'&&view==='payments-admin')render()}
 }
 function findPayment(id){return rows.find(p=>p.id===id)}
 function openPaymentDetails(id){
  const p=findPayment(id);if(!p)return;const person=paymentAdminPerson(p),round=paymentAdminRound(p),v=p.verification;
  const provider=v?'<div class="pa-detail-grid"><div><small>รหัสตอบกลับ</small><strong>'+esc(paymentAdminCode(p)||'—')+'</strong></div><div><small>HTTP status</small><strong>'+esc(v.diagnostics?.httpStatus??'—')+'</strong></div><div><small>ผลตรวจบัญชีผู้รับ</small><strong>'+ (v.diagnostics?.receiverMatched===true?'ตรงกัน':v.diagnostics?.receiverMatched===false?'ไม่ตรง / ตรวจไม่ได้':'—')+'</strong></div><div><small>สาขา SlipOK</small><strong>'+esc(v.diagnostics?.branchSlot??'—')+'</strong></div></div><p><strong>ข้อความจาก SlipOK</strong><br>'+esc(paymentAdminMessage(p)||'—')+'</p><details class="pa-json"><summary>ผลตอบกลับเต็ม (อ่านอย่างเดียว)</summary><pre>'+esc(JSON.stringify(v,null,2))+'</pre></details>':'<p class="help">รายการนี้ไม่มีผลตอบกลับจาก SlipOK ที่บันทึกไว้</p>';
  modal('รายละเอียดรายการชำระเงิน','<section class="pa-detail"><div class="pa-detail-grid"><div><small>สมาชิก</small><strong>'+esc(person.name||'—')+'</strong><span>'+esc(person.student_id||'—')+'</span></div><div><small>รายการบิล</small><strong>'+esc(round.title||paymentAdminCharge(p).title||'—')+'</strong></div><div><small>จำนวนเงิน</small><strong>฿'+money(p.amount)+'</strong></div><div><small>สถานะ</small><strong>'+esc(statusText[p.status]||p.status)+'</strong></div><div><small>วันเวลาส่งสลิป</small><strong>'+esc(dateTime(p.created_at))+'</strong></div><div><small>เลขอ้างอิง</small><strong>'+esc(p.trans_ref||'—')+'</strong></div><div><small>วิธีตรวจ</small><strong>'+esc(p.verification_method||p.source||'—')+'</strong></div><div><small>วันที่ตรวจสอบ</small><strong>'+esc(p.reviewed_at?dateTime(p.reviewed_at):'—')+'</strong></div></div><div class="pa-detail-note"><small>หมายเหตุในระบบ</small><p>'+esc(p.note||'ไม่มีหมายเหตุ')+'</p></div>'+provider+(p.deleted_at?'<p class="pa-deleted-label">อยู่ในถังขยะตั้งแต่ '+esc(dateTime(p.deleted_at))+'</p>':'')+'<div class="actions"><button type="button" class="secondary" data-action="close">ปิด</button></div></section>');
 }
 function openPaymentEdit(id){
  const p=findPayment(id);if(!p||p.deleted_at)return;
  modal('แก้ไขหมายเหตุรายการชำระเงิน','<form id="payment-admin-edit-form" data-id="'+esc(id)+'"><p class="help">แก้ไขหมายเหตุสำหรับการจัดการภายในเท่านั้น ผลตอบกลับดิบจาก SlipOK เลขอ้างอิง และยอดเงินจะไม่ถูกแก้ไข</p><label for="pa-edit-note">หมายเหตุ</label><textarea id="pa-edit-note" name="note" rows="3" maxlength="500">'+esc(p.note||'')+'</textarea><label for="pa-edit-reason">เหตุผลที่แก้ไข (บันทึกในประวัติ)</label><textarea id="pa-edit-reason" name="reason" rows="2" maxlength="500" required></textarea><div class="actions"><button type="button" class="secondary" data-action="close">ยกเลิก</button><button type="submit">บันทึกการแก้ไข</button></div><div class="form-error"></div></form>');
 }
 function openPaymentMutation(id,deleted){
  const p=findPayment(id);if(!p)return;
  const person=paymentAdminPerson(p),action=deleted?'ซ่อนรายการชำระเงิน':'กู้คืนรายการชำระเงิน';
  modal(action,'<form id="payment-admin-mutation-form" data-id="'+esc(id)+'" data-deleted="'+String(deleted)+'"><p>รายการของ <strong>'+esc(person.name||'สมาชิก')+'</strong> จำนวน <strong>฿'+money(p.amount)+'</strong></p><p class="help">'+(deleted?'รายการจะย้ายไปถังขยะและกู้คืนได้ภายใน 30 วัน':'ระบบจะคืนรายการกลับไปยังประวัติชำระเงิน โดยตรวจสอบข้อจำกัดยอดและรายการรอตรวจซ้ำ')+'</p><label for="pa-mutation-reason">เหตุผล (จำเป็น)</label><textarea id="pa-mutation-reason" name="reason" rows="3" maxlength="500" required></textarea><div class="actions"><button type="button" class="secondary" data-action="close">ยกเลิก</button><button type="submit" class="'+(deleted?'danger':'')+'">'+(deleted?'ยืนยันการซ่อน':'ยืนยันการกู้คืน')+'</button></div><div class="form-error"></div></form>');
 }
 const previousContent=content;
 content=function(){if(view==='payments-admin')return paymentAdminPage();return previousContent()};
 const previousRender=render;
 render=function(){previousRender();if(user?.role==='admin'&&view==='payments-admin'&&!loaded&&!loading)loadPaymentAdminRows()};
 document.addEventListener('input',event=>{
  if(event.target?.id==='payment-admin-search'){search=event.target.value;const target=document.getElementById('payment-admin-results');if(target)target.innerHTML=paymentAdminRowsHtml()}
 },true);
 document.addEventListener('change',event=>{
  if(event.target?.id==='payment-admin-scope'){scope=event.target.value;const target=document.getElementById('payment-admin-results');if(target)target.innerHTML=paymentAdminRowsHtml()}
  if(event.target?.id==='payment-admin-status'){statusFilter=event.target.value;const target=document.getElementById('payment-admin-results');if(target)target.innerHTML=paymentAdminRowsHtml()}
 },true);
 document.addEventListener('click',event=>{
  const button=event.target instanceof Element?event.target.closest('[data-pa-refresh],[data-pa-details],[data-pa-edit],[data-pa-delete],[data-pa-restore],[data-pa-evidence],[data-pa-review]'):null;
  if(!button)return;
  event.preventDefault();event.stopImmediatePropagation();
  if(button.hasAttribute('data-pa-refresh')){loaded=false;loadPaymentAdminRows();return}
  const id=button.dataset.paDetails||button.dataset.paEdit||button.dataset.paDelete||button.dataset.paRestore||button.dataset.paEvidence;
  if(button.hasAttribute('data-pa-details'))openPaymentDetails(id);
  else if(button.hasAttribute('data-pa-edit'))openPaymentEdit(id);
  else if(button.hasAttribute('data-pa-delete'))openPaymentMutation(id,true);
  else if(button.hasAttribute('data-pa-restore'))openPaymentMutation(id,false);
  else if(button.hasAttribute('data-pa-evidence')){if(typeof viewFile==='function')viewFile('payment',id);else toast('ไม่พบตัวแสดงหลักฐาน')}
  else if(button.hasAttribute('data-pa-review'))nav('review');
 },true);
 document.addEventListener('submit',async event=>{
  const form=event.target;
  if(!(form instanceof HTMLFormElement)||!['payment-admin-edit-form','payment-admin-mutation-form'].includes(form.id))return;
  event.preventDefault();event.stopImmediatePropagation();
  const data=Object.fromEntries(new FormData(form)),buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
  try{
   if(form.id==='payment-admin-edit-form'){
    await api('edit-record',{entity:'payment',id:form.dataset.id,patch:{note:String(data.note||''),reason:String(data.reason||'')}});
    toast('บันทึกหมายเหตุและประวัติการแก้ไขแล้ว');
   }else{
    await api('delete-records',{entity:'payment',ids:[form.dataset.id],deleted:form.dataset.deleted==='true',reason:String(data.reason||'')});
    toast(form.dataset.deleted==='true'?'ซ่อนรายการแล้ว · สามารถกู้คืนได้':'กู้คืนรายการชำระเงินแล้ว');
   }
   document.getElementById('dialog')?.close();loaded=false;await loadPaymentAdminRows();
   await refresh();
  }catch(error){const box=form.querySelector('.form-error');if(box)box.innerHTML='<p class="error" role="alert">'+esc(error instanceof Error?error.message:'ดำเนินการไม่สำเร็จ')+'</p>';else toast(error instanceof Error?error.message:'ดำเนินการไม่สำเร็จ')}
  finally{buttons.forEach(b=>b.disabled=false)}
 },true);
})();
