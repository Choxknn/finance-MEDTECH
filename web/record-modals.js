'use strict';
// Preserve page position, including iOS, across replacement dialogs.
let modalPageState=null;
function lockModalPage(){
 if(modalPageState)return;
 modalPageState={x:window.scrollX,y:window.scrollY,style:document.body.getAttribute('style')};
 document.documentElement.classList.add('modal-page-open');
 Object.assign(document.body.style,{position:'fixed',top:`-${modalPageState.y}px`,left:`-${modalPageState.x}px`,width:'100%',overflow:'hidden'});
}
function unlockModalPage(){
 if(document.getElementById('dialog')?.open||!modalPageState)return;
 const previous=modalPageState;modalPageState=null;
 if(previous.style===null)document.body.removeAttribute('style');else document.body.setAttribute('style',previous.style);
 document.documentElement.classList.remove('modal-page-open');window.scrollTo(previous.x,previous.y);
}
const recordModal=modal;modal=function(...args){lockModalPage();try{recordModal(...args);document.getElementById('dialog').setAttribute('aria-label',String(args[0]))}catch(error){unlockModalPage();throw error}};
document.getElementById('dialog').addEventListener('close',unlockModalPage);
new MutationObserver(()=>{if(document.getElementById('dialog').open)lockModalPage();else unlockModalPage()}).observe(document.getElementById('dialog'),{attributes:true,attributeFilter:['open']});
function showRecordWindow(button){
 const row=button.closest('tr');if(!row)return;
 const cells=[...row.cells].map(cell=>{
  const copy=cell.cloneNode(true);copy.querySelectorAll('.record-disclosure,.detail-cell-label').forEach(el=>el.remove());
  copy.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));
  return detailCard(cell.dataset.label||'รายละเอียด',copy.innerHTML);
 }).join('');
 modal(button.querySelector('span')?.textContent||'รายละเอียดรายการ',`<div class="record-window detail-grid">${cells}</div>`);
 if(typeof watchProofs==='function')watchProofs();
}
document.addEventListener('click',e=>{
 const disclosure=e.target.closest('.record-disclosure');
 if(disclosure){e.preventDefault();e.stopImmediatePropagation();showRecordWindow(disclosure);return}
 const summary=e.target.closest('[data-clay-bill]>summary,[data-individual-id]>summary');
 if(summary){
  e.preventDefault();e.stopImmediatePropagation();const card=summary.parentElement;
  const body=card.querySelector('.clay-bill-body,.individual-bill-body');
  const c=db.charges.find(c=>c.id===card.dataset.individualId),person=c&&db.profiles.find(p=>p.id===c.profile_id);
  const member=person?`<div class="detail-grid payment-times">${detailCard('สมาชิก',esc(person.name)+'<small>'+esc(person.student_id)+'</small>')}</div>`:'';
  modal(summary.querySelector('strong')?.textContent||summary.innerText||summary.textContent,`<div class="record-window">${member}${body.innerHTML}</div>`);
  if(typeof watchProofs==='function')watchProofs();return;
 }
 const statusButton=e.target.closest('[data-bill-status]');if(statusButton){e.preventDefault();e.stopImmediatePropagation();billStatusModal(statusButton.dataset.billStatus)}
 // Navigating from a record's actions closes the details window.
 if(e.target.closest('[data-member-bills],[data-round-bills]'))document.getElementById('dialog').close();
},true);
const modalIndividualCard=individualCard;individualCard=function(c){
 const html=modalIndividualCard(c);
 return html.replace('<div class="button-group">',`<div class="button-group"><button type="button" class="secondary icon-button" data-bill-status="${esc(c.id)}" title="เปลี่ยนสถานะบิล" aria-label="เปลี่ยนสถานะบิล">${icon('check')}</button>`);
};
function billStatusModal(id){
 if(user?.role!=='admin')return;
 const c=db.charges.find(c=>c.id===id);if(!c)return;
 modal('เปลี่ยนสถานะบิล',`<div class="detail-grid">${detailCard('รายการบิล',esc(round(c.round_id).title))}${detailCard('สมาชิก',esc(db.profiles.find(p=>p.id===c.profile_id)?.name))}${detailCard('สถานะปัจจุบัน',badge(status(c)))}${detailCard('ค้างชำระ','฿'+money(balance(c)))}</div><form id="bill-status-form" data-id="${esc(id)}" data-paid="${paid(c)}" data-balance="${balance(c)}" data-request="${crypto.randomUUID()}"><label for="bill-new-status">สถานะใหม่</label><select id="bill-new-status" name="status"><option value="approved">ชำระแล้ว</option><option value="unpaid">รอชำระ</option></select><p class="note" id="bill-status-impact"></p><label for="bill-status-reason">เหตุผลในการเปลี่ยนสถานะ</label><textarea id="bill-status-reason" name="reason" required maxlength="500"></textarea><div class="actions"><button type="button" class="secondary" data-action="close">ยกเลิก</button><button type="submit">ยืนยันเปลี่ยนสถานะ</button></div><div class="form-error"></div></form>`);
 document.getElementById('bill-new-status').value=status(c)==='approved'?'unpaid':'approved';updateBillStatusImpact();
}
function updateBillStatusImpact(){const select=document.getElementById('bill-new-status'),box=document.getElementById('bill-status-impact');if(!select||!box)return;box.textContent=select.value==='approved'?'ยืนยันว่าได้รับเงินส่วนที่ค้างแล้ว ระบบจะบันทึกรับเงินเข้ากองกลางและสร้างเลขอ้างอิงภายในให้อัตโนมัติ หากมีสลิปรอตรวจ ให้ตรวจสลิปก่อน':'ยกเลิกการรับเงินที่เคยยืนยันในบิลนี้ทั้งหมด ยอดจะถูกหักออกจากเงินกองกลาง และกลับมาเรียกเก็บใหม่ ประวัติและหลักฐานเดิมยังคงอยู่'}
document.addEventListener('change',e=>{if(e.target.id==='bill-new-status')updateBillStatusImpact()});
document.addEventListener('submit',async e=>{
 const form=e.target;if(form.id!=='bill-status-form')return;e.preventDefault();e.stopImmediatePropagation();
 if(user?.role!=='admin'||form.dataset.saving)return;
 form.dataset.saving='true';const button=form.querySelector('[type=submit]');button.disabled=true;
 try{
  const data=Object.fromEntries(new FormData(form));
  if(cfg.mode==='live')await api('set-bill-status',{charge_id:form.dataset.id,status:data.status,reason:data.reason,expected_paid:Number(form.dataset.paid),expected_balance:Number(form.dataset.balance),request_id:form.dataset.request});
  else{
   const c=db.charges.find(c=>c.id===form.dataset.id);
   if(hasPending(c))throw Error('มีสลิปรอตรวจ กรุณาตรวจสอบการชำระก่อนเปลี่ยนสถานะ');
   if(data.status==='approved'&&balance(c)>0){const id=crypto.randomUUID();db.payments.push({id,charge_id:c.id,profile_id:c.profile_id,amount:balance(c),status:'approved',source:'admin',trans_ref:'ADMIN-'+id,note:data.reason,created_at:new Date().toISOString(),reviewed_at:new Date().toISOString()})}
   if(data.status==='unpaid')db.payments.filter(p=>p.charge_id===c.id&&p.status==='approved').forEach(p=>{p.status='rejected';p.note=data.reason});
   audit('เปลี่ยนสถานะบิล '+c.id+' เป็น '+labels[data.status]+' · '+data.reason);
  }
  await refresh();document.getElementById('dialog').close();render();toast('เปลี่ยนสถานะบิลแล้ว');
 }catch(error){form.querySelector('.form-error').innerHTML=`<p class="error" role="alert">${esc(error.message)}</p>`}
 finally{delete form.dataset.saving;button.disabled=false}
},true);
const referenceReview=reviewModal;reviewModal=function(id){referenceReview(id);const p=db.payments.find(p=>p.id===id);if(!p)return;const ref=p.trans_ref;if(ref)document.querySelector('#dialog .modal-head').insertAdjacentHTML('afterend',`<div class="detail-grid payment-times">${detailCard(ref.startsWith('ADMIN-')?'เลขอ้างอิงภายใน':'เลขอ้างอิงธนาคาร',esc(ref),'document')}</div>`)};
if(user)render();
