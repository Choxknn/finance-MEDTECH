'use strict';
const individualFilters={member:'',round:'',status:'all',query:'',limit:30};
const individualOpen=new Set();let individualScope=null;
const individualLocked=c=>db.payments.some(p=>p.charge_id===c.id&&['approved','pending','review'].includes(p.status));
function individualRows(){
 const q=individualFilters.query.trim().toLocaleLowerCase('th');
 return db.charges.filter(c=>{
  const p=db.profiles.find(p=>p.id===c.profile_id),r=round(c.round_id);
  return p&&(!individualFilters.member||c.profile_id===individualFilters.member)&&(!individualFilters.round||c.round_id===individualFilters.round)&&(individualFilters.status==='all'||status(c)===individualFilters.status)&&(!q||[p.name,p.student_id,r.title].join(' ').toLocaleLowerCase('th').includes(q));
 }).sort((a,b)=>String(round(a.round_id).due_date).localeCompare(String(round(b.round_id).due_date)));
}
function individualCard(c){
 const p=db.profiles.find(p=>p.id===c.profile_id),r=round(c.round_id),locked=individualLocked(c);
 return `<details class="individual-bill" data-individual-id="${esc(c.id)}" ${individualOpen.has(c.id)?'open':''}><summary><span class="detail-symbol">${icon('document')}</span><span><strong>${esc(r.title)}</strong><small>${esc(p.name)} · ${esc(p.student_id)}</small></span><svg class="clay-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></summary><div class="individual-bill-body"><div class="detail-grid">${detailCard('ยอดบิล','฿'+money(c.amount))}${detailCard('ค่าปรับ','฿'+money(c.fee_amount||0))}${detailCard('ชำระแล้ว','฿'+money(paid(c)),'check')}${detailCard('ค้างชำระ','฿'+money(balance(c)))}${detailCard('ครบกำหนด',esc(date(r.due_date)))}${detailCard('สถานะ',badge(status(c)),'check')}</div>${r.archived?'<p class="help">บิลนี้ปิดรับชำระแล้ว</p>':''}${locked?`<p class="individual-lock">${icon('lock')} มีการชำระหรือรอตรวจแล้ว จึงแก้ยอดบิลไม่ได้</p>`:''}<div class="individual-actions"><button type="button" class="secondary small" data-individual-history="${esc(c.id)}">${icon('history')} ประวัติ / หลักฐาน</button><div class="button-group"><button type="button" class="secondary icon-button" data-individual-edit="${esc(c.id)}" aria-label="แก้ยอดบิล ${esc(p.name)}" title="${locked?'มีการชำระหรือรอตรวจแล้ว':'แก้ยอดเฉพาะคนนี้'}" ${locked?'disabled':''}>${icon('edit')}</button><button type="button" class="danger icon-button" data-delete-entity="charge" data-delete-id="${esc(c.id)}" aria-label="ลบบิลเฉพาะ ${esc(p.name)}" title="ลบบิลเฉพาะคนนี้">${icon('trash')}</button></div></div></div></details>`;
}
function individualResults(){
 const rows=individualRows(),count=rows.length,shown=rows.slice(0,individualFilters.limit);
 return `<div class="individual-totals">${detailCard('รายการที่พบ',count+' บิล','document')}${detailCard('ชำระแล้ว','฿'+money(rows.reduce((n,c)=>n+paid(c),0)),'check')}${detailCard('ค้างชำระ','฿'+money(rows.reduce((n,c)=>n+balance(c),0)))}</div><div class="individual-list">${shown.map(individualCard).join('')||'<div class="empty">ไม่พบบิลตามตัวเลือกนี้</div>'}</div>${count>shown.length?`<div class="individual-more"><button class="secondary small" data-individual-more>แสดงเพิ่ม (${shown.length} / ${count})</button></div>`:''}`;
}
function individualPage(){
 const person=db.profiles.find(p=>p.id===individualFilters.member);
 return head('บิลรายบุคคล','จัดการยอดเรียกเก็บและดูประวัติการชำระแยกรายคน',`<button data-individual-add>${icon('plus')} เพิ่มบิลให้สมาชิก</button>`)+`<section class="panel individual-filter-panel"><div class="panel-body">${person?`<div class="individual-person"><span class="detail-symbol">${icon('users')}</span><div><strong>${esc(person.name)}</strong><small>${esc(person.student_id)} · ปี ${esc(person.year||'—')}</small></div><button class="ghost small" data-individual-all aria-label="ดูสมาชิกทั้งหมด">ดูทุกคน</button></div>`:''}<div class="individual-filters"><div><label for="individual-query">ค้นหาสมาชิกหรือบิล</label><input id="individual-query" type="search" placeholder="ชื่อ รหัสนักศึกษา หรือชื่อบิล" value="${esc(individualFilters.query)}"></div><div><label for="individual-round">รายการบิล</label><select id="individual-round"><option value="">ทุกบิล</option>${db.rounds.map(r=>`<option value="${esc(r.id)}" ${r.id===individualFilters.round?'selected':''}>${esc(r.title)}</option>`).join('')}</select></div><div><label for="individual-status">สถานะ</label><select id="individual-status"><option value="all">ทุกสถานะ</option>${['unpaid','review','approved'].map(s=>`<option value="${s}" ${s===individualFilters.status?'selected':''}>${labels[s]}</option>`).join('')}</select></div></div></div></section><div id="individual-results">${individualResults()}</div>`;
}
const individualContent=content;content=function(){if(view==='individual-bills'){if(user?.role!=='admin')return head('ไม่มีสิทธิ์เข้าถึง')+panel('บิลรายบุคคล','<div class="empty">สำหรับผู้ดูแลการเงินเท่านั้น</div>');return individualPage()}return individualContent()};
function openIndividualBills(member='',roundId=''){
 if(user?.role!=='admin')return;
 Object.assign(individualFilters,{member,round:roundId,status:'all',query:'',limit:30});nav('individual-bills');window.scrollTo({top:0,behavior:'instant'});
}
function updateIndividualResults(){if(user?.role!=='admin')return;const box=document.getElementById('individual-results');if(box)box.innerHTML=individualResults()}
const individualRender=render;render=function(){
 const navTop=document.querySelector('.sidebar .nav')?.scrollTop||0;
 const scope=user?user.id+'|'+user.role:null;
 if(scope!==individualScope){individualScope=scope;Object.assign(individualFilters,{member:'',round:'',status:'all',query:'',limit:30});individualOpen.clear()}
 individualRender();if(user?.role!=='admin')return;
 const group=document.querySelector('.sidebar [data-view=rounds]')?.closest('.nav-section');
 if(group&&!group.querySelector('[data-view=individual-bills]'))group.insertAdjacentHTML('beforeend',`<button data-view="individual-bills" class="${view==='individual-bills'?'active':''}" ${view==='individual-bills'?'aria-current="page"':''} aria-label="บิลรายบุคคล" title="บิลรายบุคคล">${icon('identity')}<span class="nav-label">บิลรายบุคคล</span></button>`);
 if(view==='members')document.querySelectorAll('main [data-edit=member]').forEach(button=>{const p=db.profiles.find(p=>p.id===button.dataset.id);if(p?.role!=='member')return;button.insertAdjacentHTML('beforebegin',`<button class="secondary icon-button" data-member-bills="${esc(p.id)}" aria-label="จัดการบิลของ ${esc(p.name)}" title="จัดการบิลรายคน">${icon('document')}</button>`)});
 if(view==='rounds')document.querySelectorAll('main [data-edit=round]').forEach(button=>button.insertAdjacentHTML('beforebegin',`<button class="secondary icon-button" data-round-bills="${esc(button.dataset.id)}" aria-label="จัดการสมาชิกในบิล" title="จัดการบิลรายคน">${icon('users')}</button>`));
 const navEl=document.querySelector('.sidebar .nav');if(navEl)navEl.scrollTop=navTop;
};
function assignIndividualModal(){
 if(user?.role!=='admin')return;
 const members=db.profiles.filter(p=>p.role==='member'&&p.active!==false&&!p.deleted_at);
 if(!members.length)return modal('เพิ่มบิลให้สมาชิก','<div class="empty">เพิ่มสมาชิกที่เปิดใช้งานก่อน</div>');
 const id=members.some(p=>p.id===individualFilters.member)?individualFilters.member:members[0].id;
 modal('เพิ่มบิลให้สมาชิก',`<form id="member-assign" data-id="${esc(id)}"><label for="individual-assign-search">ค้นหาสมาชิก</label><input type="search" id="individual-assign-search" placeholder="ชื่อหรือรหัสนักศึกษา"><label for="individual-assign-member">สมาชิก</label><select id="individual-assign-member">${members.map(p=>`<option value="${esc(p.id)}" ${id===p.id?'selected':''}>${esc(p.name)} · ${esc(p.student_id)}</option>`).join('')}</select><div id="individual-assign-rounds"></div><div class="actions"><button type="button" class="secondary" data-action="close">ยกเลิก</button><button type="submit">เพิ่มบิล</button></div><div class="form-error"></div></form>`);updateAssignableRounds();
}
function updateAssignableRounds(){
 const form=document.getElementById('member-assign'),select=document.getElementById('individual-assign-member');if(!form||!select)return;
 const id=select.value;form.dataset.id=id;
 const eligible=db.rounds.filter(r=>!r.archived&&!db.charges.some(c=>c.profile_id===id&&c.round_id===r.id)&&!(db.trash?.charge||[]).some(c=>c.profile_id===id&&c.round_id===r.id));
 document.getElementById('individual-assign-rounds').innerHTML=id&&eligible.length?selectField('round_id','เลือกบิล',individualFilters.round,eligible.map(r=>[r.id,esc(r.title)+' · ฿'+money(r.amount)])):'<p class="note">'+(id?'ไม่มีบิลที่เพิ่มได้ หากเคยลบบิลของคนนี้ ให้กู้คืนจากถังขยะ':'ไม่พบสมาชิกที่ค้นหา')+'</p>';
 form.querySelector('[type=submit]').disabled=!id||!eligible.length;polishInformation(form);
}
const individualEdit=editRecord;editRecord=function(entity,id){
 if(entity!=='charge')return individualEdit(entity,id);
 if(user?.role!=='admin')return;
 const c=db.charges.find(c=>c.id===id);if(!c)return;
 const p=db.profiles.find(p=>p.id===c.profile_id),r=round(c.round_id);
 if(individualLocked(c))return modal('แก้ยอดบิลรายบุคคล','<p class="note">บิลนี้มีการชำระหรือรอตรวจแล้ว จึงไม่สามารถเปลี่ยนยอดเรียกเก็บได้</p>');
 modal('แก้ยอดบิลรายบุคคล',`<div class="detail-grid">${detailCard('สมาชิก',esc(p?.name)+'<small>'+esc(p?.student_id)+'</small>')}${detailCard('รายการบิล',esc(r.title),'document')}</div>`+recordForm('charge',id,inputField('amount','ยอดเรียกเก็บเฉพาะคนนี้',c.amount,'number','required min="0.01" max="1000000" step="0.01"')+inputField('reason','เหตุผลที่เปลี่ยนยอด','','text','required maxlength="500"')+'<p class="help">ปรับเฉพาะยอดพื้นฐานของสมาชิกคนนี้ ค่าปรับยังคำนวณตามเงื่อนไขของบิล</p>'));
};
function individualHistory(id){
 if(user?.role!=='admin')return;
 const c=db.charges.find(c=>c.id===id);if(!c)return;
 const p=db.profiles.find(p=>p.id===c.profile_id),payments=db.payments.filter(p=>p.charge_id===id).slice().sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
 modal('ประวัติการชำระรายบุคคล',`<div class="detail-grid">${detailCard('สมาชิก',esc(p?.name)+'<small>'+esc(p?.student_id)+'</small>')}${detailCard('รายการบิล',esc(round(c.round_id).title),'document')}</div>${paymentTable(payments,true)}`);
}
document.addEventListener('toggle',e=>{const el=e.target;if(!el.matches?.('[data-individual-id]'))return;if(el.open)individualOpen.add(el.dataset.individualId);else individualOpen.delete(el.dataset.individualId)},true);
document.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b||user?.role!=='admin')return;
 if(b.dataset.memberBills)openIndividualBills(b.dataset.memberBills);
 if(b.dataset.roundBills)openIndividualBills('',b.dataset.roundBills);
 if(b.hasAttribute('data-individual-all'))openIndividualBills('',individualFilters.round);
 if(b.hasAttribute('data-individual-add'))assignIndividualModal();
 if(b.dataset.individualEdit)editRecord('charge',b.dataset.individualEdit);
 if(b.dataset.individualHistory)individualHistory(b.dataset.individualHistory);
 if(b.hasAttribute('data-individual-more')){individualFilters.limit+=30;updateIndividualResults()}
});
document.addEventListener('input',e=>{
 if(user?.role!=='admin')return;
 if(e.target.id==='individual-query'){individualFilters.query=e.target.value;individualFilters.limit=30;updateIndividualResults()}
 if(e.target.id==='individual-assign-search'){
  const q=e.target.value.trim().toLocaleLowerCase('th'),select=document.getElementById('individual-assign-member'),old=select.value;
  select.innerHTML=db.profiles.filter(p=>p.role==='member'&&p.active!==false&&!p.deleted_at&&[p.name,p.student_id].join(' ').toLocaleLowerCase('th').includes(q)).map(p=>`<option value="${esc(p.id)}" ${p.id===old?'selected':''}>${esc(p.name)} · ${esc(p.student_id)}</option>`).join('');updateAssignableRounds();
 }
});
document.addEventListener('change',e=>{
 if(user?.role!=='admin')return;
 if(e.target.id==='individual-round'||e.target.id==='individual-status'){individualFilters[e.target.id==='individual-round'?'round':'status']=e.target.value;individualFilters.limit=30;updateIndividualResults()}
 if(e.target.id==='individual-assign-member')updateAssignableRounds();
});
if(user)render();
