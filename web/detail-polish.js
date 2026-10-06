'use strict';
Object.assign(icons, {
  trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  edit:'<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18M7 14h3m4 0h3m-10 4h3"/>',
  identity:'<rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="8" cy="10" r="2"/><path d="M5 16a3 3 0 0 1 6 0m3-6h4m-4 4h4"/>',
  document:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8m-8 4h5"/>',
  note:'<path d="M4 4h16v12l-5 5H4zM15 21v-5h5M8 9h8m-8 4h5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>'
});
function detailIcon(label) {
  if (/หมายเหตุ|รายละเอียด|เหตุผล/.test(label)) return 'note';
  if (/รหัส|บัญชี|ชั้นปี/.test(label)) return 'identity';
  if (/ผู้|สมาชิก|ชื่อ|รับผิดชอบ/.test(label)) return 'users';
  if (/เวลา|บันทึก|แจ้งชำระ|ตรวจสอบเมื่อ/.test(label)) return 'clock';
  if (/วัน|กำหนด/.test(label)) return 'calendar';
  if (/เงิน|ยอด|ชำระ|รายรับ|รายจ่าย|ค่าปรับ|ค้าง/.test(label)) return 'wallet';
  if (/สถานะ|LINE/.test(label)) return 'check';
  return 'document';
}
function detailCard(label,value,name=detailIcon(label)) {
  return `<div class="detail-card"><span class="detail-symbol">${icon(name)}</span><div><span class="detail-label">${esc(label)}</span><div class="detail-value">${value}</div></div></div>`;
}
function polishInformation(root=document) {
  root.querySelectorAll('.summary-line,.round-summary>div,.fund-detail').forEach(el=>{
    if(el.dataset.infoStyled)return;
    const label=el.querySelector('span,small');if(!label)return;
    el.dataset.infoStyled='true';el.classList.add('info-frame');
    label.insertAdjacentHTML('afterbegin',icon(detailIcon(label.textContent)));
    label.classList.add('info-caption');
  });
  root.querySelectorAll('.clay-bill').forEach(details=>{
    const info=details.querySelector('.bill-info');if(!info||info.dataset.infoStyled)return;
    const c=db.charges.find(c=>c.id===details.dataset.clayBill);if(!c)return;
    const r=round(c.round_id);info.dataset.infoStyled='true';info.classList.add('detail-grid');
    info.innerHTML=detailCard('ยอดบิล','฿'+money(c.amount))+detailCard('ครบกำหนด',esc(date(r.due_date)))+detailCard('สถานะ',r.archived?'<span class="badge unpaid">ปิดรับชำระ</span>':badge(status(c)),'check')+detailCard('ค่าปรับ','฿'+money(c.fee_amount||0));
    if(r.description)info.insertAdjacentHTML('beforeend',detailCard('รายละเอียด',esc(r.description)));
  });
  root.querySelectorAll('th').forEach(th=>{
    if(th.querySelector('svg')||!th.textContent.trim())return;
    th.insertAdjacentHTML('afterbegin',icon(detailIcon(th.textContent)));
  });
  root.querySelectorAll('.mobile-record-table td[data-label]').forEach(td=>{
    if(td.matches('.record-title,.record-actions,.record-empty,.record-status')||td.querySelector('.detail-cell-label')||!td.dataset.label)return;
    const label=document.createElement('span');label.className='detail-cell-label';
    label.innerHTML=icon(detailIcon(td.dataset.label))+esc(td.dataset.label);td.prepend(label);
  });
  root.querySelectorAll('label[for]').forEach(label=>{
    if(label.querySelector('svg')||label.closest('.bill-members'))return;
    label.classList.add('field-caption');label.insertAdjacentHTML('afterbegin',icon(detailIcon(label.textContent)));
  });
  root.querySelectorAll('.record-original-content>small').forEach(el=>{if(/\d{2}:\d{2}/.test(el.textContent))el.classList.add('record-timestamp')});
  root.querySelectorAll('.activity-meta time,.message-content footer time,.announcement-card>small,.record-timestamp').forEach(el=>{
    if(el.querySelector('.record-stamp,svg'))return;el.classList.add('time-caption');el.insertAdjacentHTML('afterbegin',icon('clock'));
  });
}
const informationRender=render;render=function(){informationRender();if(user)polishInformation();else polishInformation(document.getElementById('app'))};
const informationModal=modal;modal=function(...args){informationModal(...args);polishInformation(document.getElementById('dialog'))};
const informationReview=reviewModal;reviewModal=function(id){informationReview(id);const p=db.payments.find(p=>p.id===id);if(!p)return;document.querySelector('#dialog .modal-head').insertAdjacentHTML('afterend',`<div class="detail-grid payment-times">${recordStamp(p.created_at,'แจ้งชำระ')}${p.reviewed_at?recordStamp(p.reviewed_at,'ตรวจสอบ'):''}</div>`)};
if(user)render();else polishInformation(document.getElementById('app'));
