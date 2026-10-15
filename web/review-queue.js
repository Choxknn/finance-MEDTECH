'use strict';
function reviewQueueVisible(p){return !p.deleted_at&&!p.review_cleared_at&&['pending','review'].includes(p.status)}
function reviewWorkActions(p){return `<div class="review-work-actions"><label>ขั้นตอนตรวจ <select data-review-stage="${esc(p.id)}" aria-label="ขั้นตอนตรวจสอบ"><option value="waiting" ${p.review_stage!=='checking'?'selected':''}>รอตรวจสอบ</option><option value="checking" ${p.review_stage==='checking'?'selected':''}>กำลังตรวจสอบ</option></select></label></div>`}
(()=>{
 const oldRows=mpPaymentRows;mpPaymentRows=function(rows,review=false,history=false){if(!review)return oldRows(rows,review,history);return rows.length?rows.map(p=>`<section>${oldRows([p],true,false)}${reviewWorkActions(p)}</section>`).join(''):oldRows([],true,false)};
 const oldContent=content;content=function(){if(user?.role==='admin'&&view==='review'){const rows=(db.payments||[]).filter(reviewQueueVisible).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));return head('ตรวจสอบการชำระ','รายการที่ตรวจเสร็จจะออกจากคิวอัตโนมัติ และยังดูได้ในประวัติ')+mpCard('คิวตรวจสอบ','document',mpPaymentRows(rows,true))}return oldContent()};
 async function update(el,action,data){el.disabled=true;try{if(cfg.mode==='live')await api(action,data);else{const p=db.payments.find(p=>p.id===data.payment_id);if(action==='review-stage')p.review_stage=data.stage;else p.review_cleared_at=new Date().toISOString()}await refresh();render();toast(action==='review-stage'?'อัปเดตขั้นตอนตรวจแล้ว':'เคลียร์จากคิวแล้ว ประวัติยังอยู่ครบ')}catch(e){toast(e.message)}finally{el.disabled=false}}
 document.addEventListener('change',e=>{const el=e.target.closest('[data-review-stage]');if(el)update(el,'review-stage',{payment_id:el.dataset.reviewStage,stage:el.value})});
 document.addEventListener('click',e=>{const el=e.target.closest('[data-review-clear]');if(el)update(el,'clear-review',{payment_id:el.dataset.reviewClear})});
})();
