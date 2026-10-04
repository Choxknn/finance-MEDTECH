'use strict';
// Presentation only: reuse the existing data, permissions and action handlers.
const clayWallet = () => `<div class="clay-sculpture" aria-hidden="true"><div class="clay-coin">฿</div><div class="clay-wallet"><i></i></div><div class="clay-coin clay-coin-small">฿</div><span class="clay-spark">✦</span></div>`;
const clayOpenBills = new Set();
const clayOriginalBillRow = billRow;
billRow = function (charge) {
  return `<details class="clay-bill" data-clay-bill="${esc(charge.id)}" ${clayOpenBills.has(charge.id)?'open':''}><summary><span class="clay-bill-symbol">${icon('wallet')}</span><span>${esc(round(charge.round_id).title)}</span><svg class="clay-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></summary><div class="clay-bill-body">${clayOriginalBillRow(charge)}</div></details>`;
};
document.addEventListener('toggle', event => {
  const el = event.target;
  if (!el.matches?.('[data-clay-bill]')) return;
  if (el.open) clayOpenBills.add(el.dataset.clayBill);
  else clayOpenBills.delete(el.dataset.clayBill);
}, true);
function clayLoginPresentation() {
  const art = document.querySelector('.login-art');
  if (art && !art.querySelector('.clay-sculpture')) art.insertAdjacentHTML('beforeend', clayWallet());
}
const clayLogin = login;
login = function () { clayLogin(); clayLoginPresentation(); };
function applyClayPresentation() {
  if (!user) { clayLoginPresentation(); return; }
  const layout = document.querySelector('.layout');
  if (!layout) return;
  layout.dataset.clayView = view;
  layout.dataset.clayRole = user.role;
  const brand = layout.querySelector('.sidebar .brand');
  if (brand && (!cfg.siteName || cfg.siteName === 'finance MEDTECH')) brand.innerHTML = 'finance<span>MEDTECH</span>';
  const heading = layout.querySelector('.page-head > div');
  if (heading && !heading.querySelector('.clay-eyebrow')) heading.insertAdjacentHTML('afterbegin', `<div class="clay-eyebrow">${user.role==='admin'?'พื้นที่ผู้ดูแลการเงิน':'พื้นที่ของฉัน'} <span>·</span> FINANCE MEDTECH</div>`);
  const title = layout.querySelector('.topbar-title');
  if (title) title.textContent = 'Finance · MEDTECH';
  const topbar = layout.querySelector('.topbar');
  if (!topbar.querySelector('.clay-notifications')) topbar.querySelector('.user').insertAdjacentHTML('beforebegin', `<button class="secondary clay-notifications" data-view="notifications" aria-label="เปิดข้อความและการแจ้งเตือน" title="ข้อความและการแจ้งเตือน">${icon('bell')}</button>`);
  if (view === 'dashboard') {
    const stats = layout.querySelector('.stats');
    if (stats) {
      stats.classList.add('clay-dashboard-stats');
      const featured = stats.querySelector('.featured');
      if (featured) {
        featured.insertAdjacentHTML('beforeend', `<button class="clay-hero-action" data-view="${user.role==='admin'?'rounds':'bills'}">ดูรายการบิล <span aria-hidden="true">→</span></button>${clayWallet()}`);
        featured.querySelector('.label svg')?.remove();
      }
      [...stats.querySelectorAll('.stat:not(.featured)')].forEach((stat, index) => {
        stat.classList.add(index === 0?'clay-stat-sage':'clay-stat-lilac');
        stat.querySelector('.label svg')?.remove();
        stat.insertAdjacentHTML('afterbegin', `<span class="clay-stat-symbol" aria-hidden="true">${icon(index===0?(user.role==='admin'?'wallet':'check'):'history')}</span>`);
      });
    }
    // The announcement stays above the summary but below the page heading.
    const announcement = layout.querySelector('.dashboard-announcements');
    if (announcement && heading) heading.parentElement.after(announcement);
  }
  layout.querySelectorAll('.panel').forEach(panel => {
    if (panel.querySelector('.panel-head h2')?.textContent.trim() === 'เงินกองกลาง') panel.classList.add('clay-fund-panel');
  });
  if (!layout.querySelector('.clay-dock')) {
    const items = user.role==='admin'
      ? [['dashboard','home','ภาพรวม'],['rounds','wallet','รายการบิล'],['review','check','ตรวจสอบ'],['fund','wallet','กองกลาง']]
      : [['dashboard','home','หน้าหลัก'],['bills','wallet','รายการบิล'],['history','history','ประวัติ'],['fund','wallet','กองกลาง']];
    layout.insertAdjacentHTML('beforeend', `<nav class="clay-dock" aria-label="เมนูด่วน">${items.map(([v,i,label])=>`<button type="button" data-view="${v}" class="${view===v?'active':''}" ${view===v?'aria-current="page"':''}>${icon(i)}<span>${label}</span></button>`).join('')}<button type="button" data-action="menu" aria-label="เปิดเมนูทั้งหมด">${icon('menu')}<span>เมนู</span></button></nav>`);
  }
  layout.querySelector('.workspace').insertAdjacentHTML('beforeend', '<footer class="clay-footer">Finance · MEDTECH <span>เงินกองกลางของเรา</span></footer>');
}
const clayRender = render;
render = function () { clayRender(); applyClayPresentation(); };
if (user) render(); else clayLoginPresentation();
