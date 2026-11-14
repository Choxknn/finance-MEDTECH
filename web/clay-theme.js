'use strict';
icons.bill='<path d="M6 3h9l4 4v14H6Z"/><path d="M14 3v5h5M9 12h7M9 16h5"/>';
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
// Use the actual quick-navigation buttons as the source of truth.
function clayIsMainMenuView(layout) {
  const dock = layout?.querySelector('.clay-dock');
  return Boolean(dock && [...dock.querySelectorAll('button[data-view]')]
    .some(button => button.dataset.view === view));
}
function clayNavigateBack() {
  // The finance category ledger returns to the finance overview.
  nav(view === 'fund-category' ? 'fund' : 'dashboard');
}
document.addEventListener('click', event => {
  const button = event.target.closest('[data-topbar-back]');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  clayNavigateBack();
}, true);

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
  const backButton = topbar.querySelector('.menu-toggle, .topbar-back, [data-topbar-back]');
  if (backButton) {
    backButton.classList.remove('secondary', 'menu-toggle');
    backButton.classList.add('topbar-back');
    backButton.removeAttribute('data-action');
    backButton.dataset.topbarBack = 'true';
    const isFinanceCategory = view === 'fund-category';
    const isMobileBack = window.matchMedia('(max-width: 720px)').matches;
    const showHomeIcon = isMobileBack && !isFinanceCategory;
    backButton.setAttribute('aria-label', isFinanceCategory ? 'กลับหน้าการเงิน' : 'กลับหน้าหลัก');
    backButton.title = isFinanceCategory ? 'กลับหน้าการเงิน' : 'กลับหน้าหลัก';
    backButton.innerHTML = showHomeIcon
      ? '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 10 9-7 9 7"></path><path d="M5 9v11h14V9"></path><path d="M9 20v-6h6v6"></path></svg>'
      : '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>';
  }
  const homeBrand = topbar.querySelector('.mobile-brand');
  if (homeBrand) {
    homeBrand.classList.add('topbar-brand');
    homeBrand.innerHTML = `<img src="./medtech-mark-20261011.png" alt="MEDTECH logo">`;
  }
  // Keep the hidden title node because the material layout updates it on every render.
  if (!topbar.querySelector('.clay-notifications')) topbar.querySelector('.user').insertAdjacentHTML('beforebegin', `<button class="clay-notifications" data-view="notifications" aria-label="การแจ้งเตือน" title="การแจ้งเตือน">${icon('bell')}</button>`);
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
      ? [['dashboard','home','ภาพรวม'],['rounds','bill','รายการบิล'],['review','check','ตรวจสอบ'],['fund','wallet','กองกลาง']]
      : [['dashboard','home','หน้าหลัก'],['bills','bill','รายการบิล'],['history','history','ประวัติ'],['fund','wallet','กองกลาง']];
    layout.insertAdjacentHTML('beforeend', `<nav class="clay-dock" aria-label="เมนูด่วน">${items.map(([v,i,label])=>`<button type="button" data-view="${v}" class="${view===v?'active':''}" ${view===v?'aria-current="page"':''}>${icon(i)}<span>${label}</span></button>`).join('')}<button type="button" data-action="menu" aria-label="เปิดเมนูทั้งหมด">${icon('menu')}<span>เมนู</span></button></nav>`);
  }
  // Re-evaluate after the dock exists; this also runs on every later render.
  if (backButton) {
    backButton.hidden = clayIsMainMenuView(layout);
    backButton.setAttribute('aria-hidden', String(backButton.hidden));
    topbar.dataset.backHidden = String(backButton.hidden);
  }
  layout.querySelector('.workspace').insertAdjacentHTML('beforeend', '<footer class="clay-footer">Finance · MEDTECH <span>การเงิน</span></footer>');
}
const clayRender = render;
render = function () { clayRender(); applyClayPresentation(); };
if (user) render(); else clayLoginPresentation();
