'use strict';
(()=>{
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 const stamp=()=>new Date().toISOString();
 function composeNotices(){
  if(!user||!db)return [];
  const notes=(db.notifications||[]).filter(n=>n.profile_id===user.id&&!n.dismissed_at).map(n=>({...n,notice_kind:'notification'}));
  const announcements=(db.announcements||[]).filter(n=>!n.dismissed_at).map(n=>({...n,notice_kind:'announcement',status:'in_app'}));
  const charges=user.role==='admin'?[]:(db.charges||[]).filter(c=>c.profile_id===user.id&&!c.deleted_at&&balance(c)>0).map(c=>{
   const state=(db.charge_notice_states||[]).find(s=>s.charge_id===c.id);
   if(state?.dismissed_at)return null;
   const r=round(c.round_id);
   return {id:c.id,profile_id:user.id,notice_kind:'charge',title:r.title||'แจ้งเตือนการชำระเงิน',body:`ยอดที่ต้องชำระ ฿${money(balance(c))}\nครบกำหนด ${date(r.due_date)}`,created_at:r.due_date||c.created_at||null,status:'in_app',seen_at:state?.seen_at||null};
  }).filter(Boolean);
  return [...notes,...announcements,...charges].sort((a,b)=>(Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0));
 }
 noticeList=function(){return composeNotices()};
 noticeRow=function(n){
  const presentation=typeof noticePresentation==='function'?noticePresentation(n):{title:n.title||'แจ้งเตือน',body:n.body||'',tone:'info'};
  const kind=n.notice_kind||(n.message_kind?'notification':'system'),unread=!n.seen_at;
  let channel='ระบบ';
  if(kind==='notification'&&n.status!=='in_app'){
   channel=({sent:'LINE',failed:'LINE ส่งไม่สำเร็จ',unlinked:'LINE ยังไม่ได้เชื่อม',pending:'LINE กำลังส่ง',queued:'LINE รอส่ง'})[n.status]||'LINE';
  }
  const id=String(n.id||''),safeId=esc(id),safeKind=esc(kind);
  return `<article class="message-card notification-center-card ${presentation.tone||'info'} ${unread?'is-unread':''}" data-notice-kind="${safeKind}" data-notice-id-value="${safeId}">
   <span class="message-symbol">${icon(presentation.tone==='success'?'check':'bell')}</span>
   <div class="message-content notification-read-target" role="button" tabindex="0" data-read-notice="${safeId}" data-kind="${safeKind}" aria-label="อ่านข้อความ ${esc(presentation.title)}">
    <div class="message-heading"><h3>${esc(presentation.title)}</h3><span class="delivery-tag">${esc(channel)}</span></div>
    <p class="message-description">${esc(presentation.body||'เปิดรายการที่เกี่ยวข้องเพื่อตรวจสอบรายละเอียด')}</p>
    ${n.image_url?'<img class="notification-image" src="'+esc(n.image_url)+'" alt="รูปประกาศ">':''}
    <footer><time>${n.status==='in_app'&&kind==='charge'?'ครบกำหนด '+date(n.created_at):typeof thaiTimestamp==='function'?thaiTimestamp(n.created_at):dateTime(n.created_at)}</time></footer>
   </div>
   <button type="button" class="notification-dismiss" data-dismiss-notice="${safeId}" data-kind="${safeKind}" aria-label="ลบการแจ้งเตือน">×${unread?'<span class="notice-unread-dot" aria-hidden="true"></span>':''}</button>
  </article>`;
 };
 const originalVerification=paymentVerificationHtml;
 paymentVerificationHtml=function(p){if(view==='history')return '';return originalVerification(p)};
 function updateBadge(){
  const count=composeNotices().filter(n=>!n.seen_at).length;
  document.querySelectorAll('.clay-notifications').forEach(button=>{
   button.querySelector('.unread-count')?.remove();
   button.setAttribute('aria-label',count?`การแจ้งเตือน ยังไม่อ่าน ${count} รายการ`:'การแจ้งเตือน');
   if(count)button.insertAdjacentHTML('beforeend',`<span class="unread-count" aria-hidden="true">${count>99?'99+':count}</span>`);
  });
  const markAll=document.querySelector('[data-mark-all-notices]');
  if(markAll)markAll.disabled=count===0;
 }
 const stateRequests=new Set();
 function applyLocalState(kind,id,state,owner){
  const at=stamp();
  if(kind==='notification'){
   const n=(db.notifications||[]).find(n=>n.id===id&&n.profile_id===owner);if(n){if(state==='read')n.seen_at=at;else n.dismissed_at=at}
  }else if(kind==='announcement'){
   const n=(db.announcements||[]).find(n=>n.id===id);if(n){if(state==='read')n.seen_at=at;else n.dismissed_at=at}
  }else{
   db.charge_notice_states??=[];
   let saved=db.charge_notice_states.find(s=>s.charge_id===id&&s.profile_id===owner);
   if(!saved){saved={profile_id:owner,charge_id:id,seen_at:null,dismissed_at:null};db.charge_notice_states.push(saved)}
   if(state==='read')saved.seen_at=at;else saved.dismissed_at=at;
  }
 }
 function updateReadCard(kind,id){
  document.querySelectorAll('.notification-center-card').forEach(card=>{
   if(card.dataset.noticeKind!==kind||card.dataset.noticeIdValue!==id)return;
   card.classList.remove('is-unread');
   card.querySelector('.notice-unread-dot')?.remove();
   card.querySelector('[data-read-notice]')?.setAttribute('aria-label','อ่านข้อความที่อ่านแล้ว');
   noticeObserver?.unobserve(card);
  });
 }
 async function persistNoticeState(kind,id,state,owner){
  if(cfg.mode==='live')await api('notice-state',{kind,id,state});
  applyLocalState(kind,id,state,owner);
  if(state==='read')updateReadCard(kind,id);
 }
 async function changeState(kind,id,state,button=null){
  if(!user||!uuid.test(id)||!['notification','announcement','charge'].includes(kind))return;
  const owner=user.id,record=composeNotices().find(n=>n.notice_kind===kind&&n.id===id);
  if(!record||state==='read'&&record.seen_at)return;
  const key=owner+'|'+kind+'|'+id+'|'+state;
  if(stateRequests.has(key))return;
  stateRequests.add(key);
  if(button)button.disabled=true;
  try{
   await persistNoticeState(kind,id,state,owner);
   if(state==='read')updateBadge();else render();
  }catch(err){
   toast(err.message||'บันทึกการแจ้งเตือนไม่สำเร็จ');
   if(button)button.disabled=false;
  }finally{stateRequests.delete(key)}
 }
 let noticeObserver=null;
 function observeVisibleNotices(){
  noticeObserver?.disconnect();noticeObserver=null;
  if(!user||view!=='notifications'||typeof IntersectionObserver==='undefined')return;
  noticeObserver=new IntersectionObserver(entries=>{
   for(const entry of entries){
    if(!entry.isIntersecting)continue;
    const card=entry.target,kind=card.dataset.noticeKind,id=card.dataset.noticeIdValue;
    if(!card.classList.contains('is-unread')||!uuid.test(id||''))continue;
    void changeState(kind,id,'read');
   }
  },{root:null,threshold:0});
  document.querySelectorAll('.notification-center-card.is-unread').forEach(card=>noticeObserver.observe(card));
 }
 async function markAllNoticesRead(button){
  if(!user)return;
  const owner=user.id,unread=composeNotices().filter(n=>!n.seen_at&&uuid.test(String(n.id||'')));
  if(!unread.length){updateBadge();return}
  if(button)button.disabled=true;
  let failed=0;
  for(const n of unread){
   if(user?.id!==owner)break;
   const key=owner+'|'+n.notice_kind+'|'+n.id+'|read';
   if(stateRequests.has(key))continue;
   stateRequests.add(key);
   try{await persistNoticeState(n.notice_kind,n.id,'read',owner)}
   catch(err){failed++;toast(err.message||'มีบางรายการอ่านไม่สำเร็จ')}
   finally{stateRequests.delete(key)}
  }
  updateBadge();
  observeVisibleNotices();
  if(button)button.disabled=composeNotices().every(n=>!!n.seen_at);
  if(!failed&&user?.id===owner)toast('อ่านการแจ้งเตือนทั้งหมดแล้ว');
 }
 document.addEventListener('click',e=>{
  const markAll=e.target.closest('[data-mark-all-notices]');
  if(markAll){e.preventDefault();e.stopImmediatePropagation();void markAllNoticesRead(markAll);return}
  const remove=e.target.closest('[data-dismiss-notice]');
  if(remove){e.preventDefault();e.stopImmediatePropagation();void changeState(remove.dataset.kind,remove.dataset.dismissNotice,'dismiss',remove);return}
  const read=e.target.closest('[data-read-notice]');
  if(read){e.preventDefault();e.stopImmediatePropagation();void changeState(read.dataset.kind,read.dataset.readNotice,'read',read)}
 });
 document.addEventListener('keydown',e=>{
  const read=e.target.closest('[data-read-notice]');
  if(read&&['Enter',' '].includes(e.key)){e.preventDefault();void changeState(read.dataset.kind,read.dataset.readNotice,'read',read)}
 });
 if(typeof showPaymentSuccess==='function'){
  const previousPaymentSuccess=showPaymentSuccess;
  showPaymentSuccess=function(...args){const result=previousPaymentSuccess(...args);updateBadge();return result};
 }
 const previousRender=render;
 render=function(){previousRender();updateBadge();observeVisibleNotices()};
 if(typeof renderInBackground==='function'){
  const previousBackground=renderInBackground;
  renderInBackground=function(){previousBackground();updateBadge();observeVisibleNotices()};
 }
 if(user)render();
})();
