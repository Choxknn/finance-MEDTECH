'use strict';
(()=>{
 const storeIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10l2-6h14l2 6M4 10v10h16V10M9 20v-6h6v6M3 10a3 3 0 0 0 4.5 2.6A3 3 0 0 0 12 10a3 3 0 0 0 4.5 2.6A3 3 0 0 0 21 10"/></svg>';
 let owner='',products=[],checked=0,fetching=false,readObserver;
 const reading=new Set(),readLocally=new Set();
 function scope(){const id=user?.id||'';if(id!==owner){owner=id;products=[];checked=0;readLocally.clear()}return id}
 function unread(){return (db.notifications||[]).filter(n=>n.id&&n.profile_id===user?.id&&!n.seen_at&&!readLocally.has(n.id))}
 function paintBadges(){const count=unread().length;document.querySelectorAll('.clay-notifications').forEach(b=>{b.querySelector('.unread-count')?.remove();b.setAttribute('aria-label',count?`ข้อความและการแจ้งเตือน ยังไม่อ่าน ${count} ข้อความ`:'ข้อความและการแจ้งเตือน');if(count)b.insertAdjacentHTML('beforeend',`<span class="unread-count" aria-hidden="true">${count>99?'99+':count}</span>`)})}
 function paintStore(){
  document.querySelectorAll('[data-store-entry]').forEach(el=>el.remove());
  if(!user||!products.some(p=>!p.deleted_at&&['open','scheduled'].includes(shopSaleState(p))))return;
  const sidebar=document.querySelector('.sidebar .nav');
  if(sidebar&&!sidebar.querySelector('[data-view="shop"]'))sidebar.insertAdjacentHTML('beforeend',`<button data-store-entry data-view="shop" class="${view==='shop'?'active':''}">${storeIcon}<span class="nav-label">ร้านค้า</span></button>`);
  const dock=document.querySelector('.clay-dock');
  if(dock&&!dock.querySelector('[data-view="shop"]'))dock.insertAdjacentHTML('beforeend',`<button class="tablet-store-entry ${view==='shop'?'active':''}" data-store-entry data-view="shop">${storeIcon}<span>ร้านค้า</span></button>`);
  document.querySelector('#app')?.insertAdjacentHTML('beforeend',`<button type="button" class="mobile-store-entry" data-store-entry data-view="shop" aria-label="เปิดร้านค้า" title="ร้านค้า">${storeIcon}</button>`);
 }
 async function checkStore(){const id=scope();if(!id||document.hidden||fetching||Date.now()-checked<60000)return;fetching=true;checked=Date.now();try{const result=cfg.mode==='live'?await api('shop-list'):shopData;if(user?.id!==id)return;products=result.products||[];paintStore()}catch{}finally{fetching=false}}
 function watchRead(){
  readObserver?.disconnect();if(!user||view!=='notifications')return;
  const id=user.id;
  async function mark(el){const key=el.dataset.noticeId;if(!key||reading.has(key)||readLocally.has(key))return;const n=(db.notifications||[]).find(n=>n.id===key&&n.profile_id===id);if(!n||n.seen_at)return;reading.add(key);try{if(cfg.mode==='live')await api('read-notification',{id:key});if(user?.id!==id)return;readLocally.add(key);n.seen_at=new Date().toISOString();paintBadges()}catch{}finally{reading.delete(key)}}
  const rows=document.querySelectorAll('[data-notice-id]');
  if(!('IntersectionObserver' in window))return;
  readObserver=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){readObserver.unobserve(e.target);void mark(e.target)}}),{threshold:.5});rows.forEach(el=>readObserver.observe(el));
 }
 const oldRow=noticeRow;noticeRow=function(n){const html=oldRow(n);return n.id&&n.profile_id===user?.id?html.replace('<article ',`<article data-notice-id="${esc(n.id)}" `):html};
 const oldRender=render;render=function(){oldRender();scope();if(!user){readObserver?.disconnect();return}if(shopLoaded&&shopOwner===user.id)products=shopData.products;paintStore();paintBadges();watchRead();void checkStore()};
 setInterval(()=>{if(user&&!document.hidden){paintStore();void checkStore()}},60000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void checkStore()});
 if(user)render();
})();
