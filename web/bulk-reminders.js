'use strict';
let bulkReminderDraft=null,bulkReminderSending=false;
function reminderCandidates(){
 if(user?.role!=='admin')return [];
 return db.charges.filter(c=>{const p=db.profiles.find(p=>p.id===c.profile_id),r=round(c.round_id);return !c.deleted_at&&p&&p.active!==false&&!p.deleted_at&&p.line_linked&&!r.deleted_at&&!r.archived&&balance(c)>0&&!hasPending(c)});
}
dueReminderPicker=function(profileId='',selectedIds=[]){
 if(user?.role!=='admin'||bulkReminderSending)return;
 bulkReminderDraft=null;const rows=reminderCandidates(),groups=new Map(),selected=new Set(selectedIds);
 for(const c of rows){if(!groups.has(c.profile_id))groups.set(c.profile_id,[]);groups.get(c.profile_id).push(c);if(profileId===c.profile_id)selected.add(c.id)}
 const rounds=[...new Set(rows.map(c=>c.round_id))].map(id=>round(id));
 modal('แจ้งเตือนกำหนดชำระทาง LINE',`<form id="bulk-reminder-picker"><p class="sub">เลือกสมาชิกและบิลที่ยังไม่ชำระได้หลายรายการ · แสดงเฉพาะผู้ที่เชื่อม LINE แล้ว และไม่รวมบิลที่รอตรวจสลิป</p><div class="reminder-filters"><input type="search" id="reminder-search" aria-label="ค้นหาสมาชิกหรือบิล" placeholder="ค้นหาชื่อ รหัสนักศึกษา หรือบิล"><select id="reminder-round" aria-label="เลือกรายการบิล"><option value="">ทุกรายการบิล</option>${rounds.map(r=>`<option value="${esc(r.id)}">${esc(r.title)}</option>`).join('')}</select></div><div class="reminder-selection-tools"><span id="reminder-selected" role="status"></span><div><button type="button" class="ghost" data-reminder-select="all">เลือกที่แสดง</button><button type="button" class="ghost" data-reminder-select="none">ล้างที่เลือก</button></div></div><div class="reminder-members">${[...groups].map(([id,charges])=>{const p=db.profiles.find(p=>p.id===id);return `<section class="reminder-member" data-reminder-member="${esc(id)}"><label class="reminder-person"><input type="checkbox" data-reminder-person="${esc(id)}"><span>${esc(p.name)}<small>${esc(p.student_id)}</small></span></label><div>${charges.map(c=>{const r=round(c.round_id);return `<label class="reminder-charge" data-reminder-round="${esc(r.id)}" data-search="${esc([p.name,p.student_id,r.title].join(' ').toLocaleLowerCase('th'))}"><input type="checkbox" name="charge_ids" value="${esc(c.id)}" data-profile="${esc(id)}" ${selected.has(c.id)?'checked':''}><span><strong>${esc(r.title)}</strong><small>ครบกำหนด ${esc(date(r.due_date))}</small></span><b>฿${money(balance(c))}</b></label>`}).join('')}</div></section>`}).join('')||'<p class="empty">ไม่มีสมาชิกที่เชื่อม LINE และมีบิลค้างชำระ</p>'}</div><p id="reminder-no-results" class="help" hidden>ไม่พบรายการตามที่ค้นหา</p><p class="help">เลือกได้สูงสุด 50 บิลต่อครั้ง ระบบตรวจยอดล่าสุดอีกครั้งก่อนส่ง</p><div class="actions"><button type="button" class="secondary" data-action="close">ยกเลิก</button><button type="submit" ${rows.length?'':'disabled'}>ดูตัวอย่างก่อนส่ง</button></div><p class="form-error" role="alert"></p></form>`);
 updateReminderSelection();
};
function updateReminderSelection(){
 const f=document.getElementById('bulk-reminder-picker');if(!f)return;
 const q=f.querySelector('#reminder-search').value.trim().toLocaleLowerCase('th'),r=f.querySelector('#reminder-round').value;
 f.querySelectorAll('.reminder-charge').forEach(row=>row.hidden=!!((r&&row.dataset.reminderRound!==r)||(q&&!row.dataset.search.includes(q))));
 f.querySelectorAll('.reminder-member').forEach(group=>{const visible=[...group.querySelectorAll('.reminder-charge')].filter(row=>!row.hidden),boxes=visible.map(row=>row.querySelector('input')),checked=boxes.filter(b=>b.checked).length,person=group.querySelector('[data-reminder-person]');group.hidden=!visible.length;person.checked=!!boxes.length&&checked===boxes.length;person.indeterminate=checked>0&&checked<boxes.length;});
 const selected=[...f.querySelectorAll('[name=charge_ids]:checked')];f.querySelector('#reminder-selected').textContent=`เลือก ${new Set(selected.map(b=>b.dataset.profile)).size} คน · ${selected.length} บิล`;
 f.querySelector('#reminder-no-results').hidden=!![...f.querySelectorAll('.reminder-member')].find(g=>!g.hidden);
 f.querySelector('[type=submit]').disabled=!selected.length||selected.length>50||!!f.dataset.busy;
}
document.addEventListener('input',e=>{if(e.target.id==='reminder-search')updateReminderSelection()});
document.addEventListener('change',e=>{if(!e.target.closest('#bulk-reminder-picker'))return;if(e.target.hasAttribute('data-reminder-person'))e.target.closest('.reminder-member').querySelectorAll('.reminder-charge:not([hidden]) input').forEach(b=>b.checked=e.target.checked);updateReminderSelection()});
document.addEventListener('click',e=>{const b=e.target.closest('[data-reminder-select]');if(b){const f=b.closest('form');if(b.dataset.reminderSelect==='none')f.querySelectorAll('[name=charge_ids]').forEach(c=>c.checked=false);else f.querySelectorAll('.reminder-charge:not([hidden]) input').forEach(c=>c.checked=true);updateReminderSelection();}if(e.target.closest('[data-bulk-reminder-back]')&&bulkReminderDraft&&!bulkReminderSending){const ids=[...document.querySelectorAll('#bulk-reminder-send [name=charge_ids]:checked')].map(b=>b.value);dueReminderPicker('',ids);}});
function showBulkReminderPreview(groups,warnings,owner){
 bulkReminderDraft={groups,owner};const count=groups.reduce((n,g)=>n+g.items.length,0);
 modal('ตรวจสอบก่อนส่งแจ้งเตือน',`<form id="bulk-reminder-send"><p class="reminder-preview-summary">ผู้รับ ${groups.length} คน · ${count} บิล</p>${warnings.length?`<p class="help">${warnings.map(esc).join('<br>')}</p>`:''}<div class="reminder-preview-groups">${groups.map(g=>`<section><h3>${icon('users')}${esc(g.person.name)} <small>${esc(g.person.student_id)}</small></h3>${g.items.map(i=>`<div class="reminder-preview-item"><label><input type="checkbox" name="charge_ids" value="${esc(i.charge_id)}" checked><span>${esc(i.body.split('\n')[0])}</span></label><details><summary>ดูข้อความที่จะส่ง</summary>${flexPreviewHtml(i.title,i.body,'reminder')}</details></div>`).join('')}</section>`).join('')}</div><p class="help">ส่งแยกหนึ่งข้อความต่อบิล เฉพาะรายการที่เลือกและยังค้างชำระในขณะส่ง</p><div class="actions"><button type="button" class="secondary" data-bulk-reminder-back>กลับไปเลือก</button><button type="submit">ยืนยันส่ง LINE</button></div><p class="form-error" role="alert"></p><div id="bulk-reminder-progress" role="status" aria-live="polite"></div></form>`);
}
document.addEventListener('submit',async e=>{
 const f=e.target;if(!['bulk-reminder-picker','bulk-reminder-send'].includes(f.id))return;e.preventDefault();e.stopImmediatePropagation();
 if(user?.role!=='admin'||f.dataset.busy||f.dataset.finished||bulkReminderSending)return;
 const owner=user.id,selected=[...f.querySelectorAll('[name=charge_ids]:checked')].map(b=>b.value),error=f.querySelector('.form-error');error.textContent='';
 if(!selected.length||selected.length>50){error.textContent='เลือกรายการ 1–50 บิล';return;}
 f.dataset.busy='true';const buttons=[...f.querySelectorAll('button,input,select')];buttons.forEach(b=>b.disabled=true);
 try{
  if(f.id==='bulk-reminder-picker'){
   const rows=reminderCandidates().filter(c=>selected.includes(c.id)),ids=[...new Set(rows.map(c=>c.profile_id))],groups=[],warnings=[];
   for(const id of ids){
    if(!f.isConnected||user?.id!==owner)return;const person=db.profiles.find(p=>p.id===id);
    try{const result=cfg.mode==='live'?await api('remind-preview',{profile_id:id}):{items:rows.filter(c=>c.profile_id===id).map(c=>({charge_id:c.id,title:'แจ้งเตือนกำหนดชำระ',body:round(c.round_id).title+'\nยอดค้าง '+money(balance(c))+' บาท\nครบกำหนด '+date(round(c.round_id).due_date)}))};const items=result.items.filter(i=>selected.includes(i.charge_id));if(items.length)groups.push({person,items});else warnings.push(person.name+' · ไม่มีบิลค้างที่ต้องแจ้งแล้ว');}catch(err){warnings.push(person.name+' · '+err.message);}
   }
   if(!f.isConnected||user?.id!==owner)return;if(!groups.length)throw Error(warnings.join('\n')||'ไม่มีบิลค้างที่ต้องแจ้งเตือนแล้ว');showBulkReminderPreview(groups,warnings,owner);
  }else{
   const draft=bulkReminderDraft;if(!draft||draft.owner!==owner)throw Error('กรุณาเลือกรายการใหม่');
   const groups=draft.groups.map(g=>({...g,items:g.items.filter(i=>selected.includes(i.charge_id))})).filter(g=>g.items.length);if(!groups.length)throw Error('กรุณาเลือกรายการใหม่');
   bulkReminderSending=true;const progress=f.querySelector('#bulk-reminder-progress');let accepted=0,total=0;const outcomes=[];
   for(const g of groups){
    if(user?.id!==owner||user?.role!=='admin'){outcomes.push('หยุดส่งเนื่องจากบัญชีเข้าสู่ระบบเปลี่ยน');break;}
    progress.textContent=`กำลังส่ง ${outcomes.length+1}/${groups.length} คน · ${g.person.name}`;
    try{const result=cfg.mode==='live'?await api('remind',{profile_id:g.person.id,charge_ids:g.items.map(i=>i.charge_id),confirmation:'ส่งแจ้งเตือน'}):{sent:0,total:0,message:'โหมดตัวอย่าง ไม่ได้ส่ง LINE จริง'};accepted+=Number(result.sent||0);total+=Number(result.total||0);outcomes.push(g.person.name+' · '+result.message);}catch(err){outcomes.push(g.person.name+' · ยังยืนยันผลไม่ได้: '+err.message+' (ตรวจประวัติข้อความก่อนส่งใหม่)');}
   }
   f.dataset.finished='true';progress.innerHTML=`<h3>${cfg.mode==='live'?`LINE รับคำขอแล้ว ${accepted}/${total} บิล`:'จบตัวอย่าง ไม่มีการส่ง LINE จริง'}</h3><ul>${outcomes.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`;
   f.querySelector('.actions').innerHTML='<button type="button" class="secondary" data-action="close">ปิด</button>';
   if(user?.id===owner)try{await refresh();render();}catch{progress.insertAdjacentHTML('beforeend','<p class="help">อัปเดตข้อมูลหน้าเว็บไม่สำเร็จ กรุณารีเฟรชภายหลัง</p>');}
  }
 }catch(err){error.textContent=err.message;}
 finally{delete f.dataset.busy;bulkReminderSending=false;if(!f.dataset.finished)buttons.forEach(b=>b.disabled=false);if(f.id==='bulk-reminder-picker')updateReminderSelection();}
},true);
document.getElementById('dialog').addEventListener('cancel',e=>{if(bulkReminderSending)e.preventDefault()});
document.addEventListener('click',e=>{if(bulkReminderSending&&e.target.closest('#dialog [data-action=close]')){e.preventDefault();e.stopImmediatePropagation();}},true);
