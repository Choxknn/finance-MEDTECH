'use strict';

(() => {
  let paymentPageState = null;
  let paymentSheetEntrancePending = false;
  let paymentSheetCloseTimer = null;
  let paymentSheetDrag = null;
  let paymentBackgroundLock = null;
  const baseContent = content;
  const baseNav = nav;

  function paymentPageIcon(name) {
    const paths = {
      arrow: '<path d="M19 12H5m7 7-7-7 7-7"/>',
      bank: '<path d="M3 10h18M5 10v9m4-9v9m6-9v9m4-9v9M3 20h18M12 3 2 8v2h20V8z"/>',
      qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zm5 0h2v2h-2zm-5 5h2v2h-2zm5 0h2v2h-2z"/>',
      lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3"/>',
      close: '<path d="m18 6-12 12M6 6l12 12"/>',
      upload: '<path d="M12 16V4m-5 7 5-7 5 7"/><path d="M4 16v4h16v-4"/>'
    };
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || paths.bank) + '</svg>';
  }

  function paymentPageCharge() {
    if (!paymentPageState || !user) return null;
    return db.charges.find(item => item.id === paymentPageState.id && item.profile_id === user.id) || null;
  }

  function paymentPageSummary(charge, bill, amount) {
    const paidAmount = paid(charge);
    const feeAmount = Number(charge.fee_amount || 0);
    const due = bill.due_date ? recordTime(bill, 'due_date') : 'ไม่ระบุวันครบกำหนด';
    return '<section class="payment-page-overview" aria-label="สรุปรายการชำระเงิน">' +
      '<div class="payment-page-heading">' +
      '<h1 class="payment-page-bill-title">' + esc(bill.title || 'รายการชำระเงิน') + '</h1>' +
      '<div class="payment-page-due"><span class="payment-page-due-mark"></span><span>ครบกำหนด</span><strong>' + esc(due) + '</strong></div></div>' +
      '<aside class="payment-page-total"><div class="payment-page-total-label"><span>ยอดที่ต้องชำระ</span></div>' +
      '<strong class="payment-page-total-value">฿' + money(amount) + '</strong><div class="payment-page-total-divider"></div>' +
      '<div class="payment-page-total-line"><span>ยอดบิล</span><b>฿' + money(charge.amount) + '</b></div>' +
      (feeAmount > 0 ? '<div class="payment-page-total-line"><span>ค่าปรับ</span><b>฿' + money(feeAmount) + '</b></div>' : '') +
      (paidAmount > 0 ? '<div class="payment-page-total-line"><span>ชำระแล้ว</span><b>฿' + money(paidAmount) + '</b></div>' : '') +
      '</aside></section>';
  }

  function paymentPageMethodChoice(name, title, description, note, icon, disabled, popular) {
    return '<button type="button" class="payment-page-method-choice" data-payment-method="' + name + '"' +
      (disabled ? ' disabled aria-disabled="true"' : '') + '><span class="payment-page-method-symbol">' + paymentPageIcon(icon) + '</span>' +
      '<span class="payment-page-method-copy"><strong>' + title + '</strong>' +
      (popular ? '<span class="payment-page-method-popular"><span aria-hidden="true">🔥</span> ยอดนิยม</span>' : '') + '</span>' +
      '<span class="payment-page-method-arrow">' + paymentPageIcon('arrow') + '</span></button>';
  }

  function paymentSheetHeader() {
    return '<header class="payment-sheet-header" aria-label="ควบคุมหน้าต่างชำระบิล">' +
      '<button type="button" class="payment-sheet-header-button payment-sheet-back-button" data-payment-sheet-back aria-label="ย้อนกลับ" title="ย้อนกลับ">' + paymentPageIcon('arrow') + '</button>' +
      '<strong>ชำระบิล</strong>' +
      '<button type="button" class="payment-sheet-header-button payment-sheet-close-button" data-payment-sheet-close aria-label="ปิดหน้าชำระบิล" title="ปิด">' + paymentPageIcon('close') + '</button>' +
      '</header>';
  }

  function paymentPageMarkup() {
    const overlayClass = paymentSheetEntrancePending ? 'payment-sheet-overlay' : 'payment-sheet-overlay is-open';
    const charge = paymentPageCharge();
    if (!charge) {
      return '<div class="' + overlayClass + '" data-payment-sheet-overlay><div class="payment-sheet-backdrop" data-payment-sheet-dismiss></div>' +
        '<section class="payment-sheet" data-payment-sheet data-sheet-size="medium" role="dialog" aria-modal="true" aria-label="ชำระบิล">' +
        '<div class="payment-sheet-grab-zone" data-payment-sheet-drag role="button" tabindex="0" aria-label="ลากเพื่อปรับขนาดหน้าต่าง"><span class="payment-sheet-grabber"></span></div>' +
        paymentSheetHeader() +
        '<div class="payment-sheet-scroll" data-payment-sheet-scroll><section class="payment-page"><div class="payment-page-content">' +
        '<div class="payment-page-empty">ไม่พบรายการที่ต้องชำระ หรือรายการนี้ไม่สามารถชำระได้แล้ว<button type="button" data-payment-page-back>กลับหน้าหลัก</button></div>' +
        '</div></section></div></section></div>';
    }

    const bill = round(charge.round_id);
    const amount = balance(charge);
    const qr = typeof selectPaymentQr === 'function' ? selectPaymentQr(amount) : {url: ''};
    const contentStart = '<div class="' + overlayClass + '" data-payment-sheet-overlay>' +
      '<div class="payment-sheet-backdrop" data-payment-sheet-dismiss></div>' +
      '<section class="payment-sheet" data-payment-sheet data-sheet-size="medium" role="dialog" aria-modal="true" aria-label="ชำระบิล">' +
      '<div class="payment-sheet-grab-zone" data-payment-sheet-drag role="button" tabindex="0" aria-label="ลากขึ้นเพื่อขยายหน้าต่าง หรือลงเพื่อย่อ">' +
      '<span class="payment-sheet-grabber"></span></div>' +
      paymentSheetHeader() +
      '<div class="payment-sheet-scroll" data-payment-sheet-scroll>' +
      '<section class="payment-page"><div class="payment-page-content">';
    const summary = paymentPageSummary(charge, bill, amount);

    if (!paymentPageState.method) {
      return contentStart +
        '<h1 class="payment-page-main-title">เลือกวิธีชำระ</h1>' +
        summary +
        '<section class="payment-page-method-section"><div class="payment-page-section-heading"><h2>เลือกช่องทางชำระเงิน</h2></div>' +
        '<div class="payment-page-method-choices">' +
        paymentPageMethodChoice('qr', 'สแกน QR Code', '', '', 'qr', !qr.url, true) +
        paymentPageMethodChoice('bank', 'โอนผ่านเลขบัญชีธนาคาร', '', '', 'bank', false) +
        '</div></section></div></section></div>';
    }

    const methodPanel = paymentPageState.method === 'bank'
      ? '<article class="payment-page-card payment-page-bank"><div class="payment-page-card-heading"><div><h2>รายละเอียดบัญชีธนาคาร</h2></div>' + paymentPageIcon('bank') + '</div>' +
        '<div class="payment-page-bank-details">' +
        (cfg.accountNumber
          ? '<div class="payment-page-bank-row"><span>ธนาคาร</span><strong>' + esc(cfg.bankName || '—') + '</strong></div><div class="payment-page-bank-row"><span>ชื่อบัญชี</span><strong>' + esc(cfg.accountName || '—') + '</strong></div><div class="payment-page-account-number"><span>เลขที่บัญชี</span><div class="payment-page-account-copy"><strong>' + esc(cfg.accountNumber) + '</strong><button type="button" class="payment-page-copy-account" data-copy-account="' + esc(cfg.accountNumber) + '">คัดลอก</button></div></div>'
          : '<p class="payment-page-bank-unset">ยังไม่ได้ตั้งค่าบัญชีรับเงิน กรุณาติดต่อผู้ดูแลการเงินก่อนโอนเงิน</p>') +
        '</div></article>'
      : '<article class="payment-page-card payment-page-qr"><div class="payment-page-card-heading"><div><h2>สแกน QR Code</h2></div>' + paymentPageIcon('qr') + '</div>' +
        '<div class="payment-page-qr-stage"><div class="payment-page-qr-placeholder" aria-hidden="true"><span>QR</span><small>รหัสชำระเงิน</small></div><img id="payment-qr" class="payment-page-qr-image" alt="QR สำหรับชำระเงิน" hidden></div>' +
        '<p id="payment-qr-hint" class="payment-page-qr-hint" role="status"></p></article>';

    return contentStart +
      '<h1 class="payment-page-main-title">ชำระเงิน</h1>' +
      summary +
      '<div class="payment-page-selected-method"><strong>' + (paymentPageState.method === 'bank' ? paymentPageIcon('bank') + ' โอนผ่านเลขบัญชีธนาคาร' : paymentPageIcon('qr') + ' สแกน QR Code') + '</strong></div>' +
      '<section class="payment-page-method-details">' + methodPanel + '</section>' +
      '<section class="payment-page-card payment-page-upload"><div class="payment-page-card-heading payment-page-upload-heading">' +
      '<div><h2>แนบสลิป</h2></div></div>' +
      '<form id="pay-form" class="payment-page-form" data-id="' + esc(charge.id) + '">' +
      '<input id="pay-amount" name="amount" type="hidden" value="' + esc(amount) + '">' +
      '<div class="dropzone"><div class="payment-page-upload-mark">' + paymentPageIcon('upload') + '</div>' +
      '<div class="payment-page-upload-copy"><strong>เลือกรูปสลิป</strong></div>' +
      '<label for="slip-file">เลือกภาพสลิป</label><input id="slip-file" name="file" type="file" accept="image/jpeg,image/png,image/webp" required>' +
      '<p class="help">ขนาดไฟล์ไม่เกิน 5 MB</p><div id="file-preview"></div></div>' +
      '<p class="help auto-slip-help">ระบบจะส่งสลิปให้อัตโนมัติ</p>' +
      '<div class="actions"><button type="submit" data-slip-retry hidden>ลองส่งอีกครั้ง</button></div><div class="form-error" role="alert"></div></form></section>' +
      '' +
      '</div></section></div></section></div>';
  }

  content = function () {
    if (view === 'payment') {
      const activeView = view;
      view = paymentPageState?.returnView || 'bills';
      const background = baseContent();
      view = activeView;
      return background + paymentPageMarkup();
    }
    return baseContent();
  };

  nav = function (nextView) {
    const leavingPayment = view === 'payment' && nextView !== 'payment';
    if (leavingPayment) paymentPageState = null;
    const result = baseNav(nextView);
    if (leavingPayment) unlockPaymentBackgroundScroll();
    return result;
  };

  function leavePaymentPage() {
    if (!paymentPageState) return;
    const returnView = paymentPageState.returnView || 'bills';
    paymentPageState = null;
    nav(returnView);
  }

  window.paymentPageHasSelectedMethod = () => Boolean(paymentPageState?.method);

  function lockPaymentBackgroundScroll(scrollY) {
    if (paymentBackgroundLock || !document.body) return;
    const body = document.body;
    const root = document.documentElement;
    const bodyProperties = ['position', 'top', 'left', 'right', 'width', 'overflow', 'padding-right'];
    const savedBodyStyles = Object.fromEntries(bodyProperties.map(property => [property, {
      value: body.style.getPropertyValue(property),
      priority: body.style.getPropertyPriority(property)
    }]));
    const scrollTop = Number.isFinite(Number(scrollY)) ? Number(scrollY) : (window.scrollY || window.pageYOffset || 0);
    const scrollbarGap = Math.max(0, window.innerWidth - root.clientWidth);
    paymentBackgroundLock = {
      scrollTop,
      bodyStyles: savedBodyStyles,
      rootOverflow: root.style.getPropertyValue('overflow'),
      rootOverflowPriority: root.style.getPropertyPriority('overflow')
    };
    const computedPadding = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
    body.style.setProperty('position', 'fixed', 'important');
    body.style.setProperty('top', '-' + scrollTop + 'px', 'important');
    body.style.setProperty('left', '0', 'important');
    body.style.setProperty('right', '0', 'important');
    body.style.setProperty('width', 'auto', 'important');
    body.style.setProperty('overflow', 'hidden', 'important');
    if (scrollbarGap) body.style.setProperty('padding-right', (computedPadding + scrollbarGap) + 'px', 'important');
    root.style.setProperty('overflow', 'hidden', 'important');
    body.classList.add('payment-sheet-open');
  }

  function unlockPaymentBackgroundScroll() {
    if (!paymentBackgroundLock || !document.body) return;
    const lock = paymentBackgroundLock;
    paymentBackgroundLock = null;
    const body = document.body;
    const root = document.documentElement;
    for (const [property, saved] of Object.entries(lock.bodyStyles)) {
      if (saved.value) body.style.setProperty(property, saved.value, saved.priority);
      else body.style.removeProperty(property);
    }
    if (lock.rootOverflow) root.style.setProperty('overflow', lock.rootOverflow, lock.rootOverflowPriority);
    else root.style.removeProperty('overflow');
    body.classList.remove('payment-sheet-open');
    window.scrollTo(0, lock.scrollTop);
  }

  function scrollPaymentPageToTop() {
    const scroller = document.querySelector('[data-payment-sheet-scroll]');
    if (scroller) scroller.scrollTop = 0;
  }

  function setPaymentSheetSize(size) {
    const sheet = document.querySelector('[data-payment-sheet]');
    if (!sheet) return;
    const allowed = ['compact', 'medium', 'expanded'];
    sheet.dataset.sheetSize = allowed.includes(size) ? size : 'medium';
  }

  function dismissPaymentSheet(nextView) {
    if (!paymentPageState) return;
    const destination = nextView || paymentPageState.returnView || 'bills';
    const overlay = document.querySelector('[data-payment-sheet-overlay]');
    if (!overlay) {
      paymentPageState = null;
      nav(destination);
      return;
    }
    if (paymentSheetCloseTimer) clearTimeout(paymentSheetCloseTimer);
    overlay.classList.remove('is-open');
    overlay.classList.add('is-closing');
    paymentSheetCloseTimer = setTimeout(() => {
      paymentSheetCloseTimer = null;
      if (view !== 'payment' || !paymentPageState) return;
      paymentPageState = null;
      nav(destination);
    }, 380);
  }

  function resizePaymentSheet(direction) {
    const sheet = document.querySelector('[data-payment-sheet]');
    if (!sheet) return;
    const current = sheet.dataset.sheetSize || 'medium';
    if (direction === 'up') {
      setPaymentSheetSize(current === 'compact' ? 'medium' : 'expanded');
      return;
    }
    if (current === 'expanded') setPaymentSheetSize('medium');
    else if (current === 'medium') setPaymentSheetSize('compact');
    else dismissPaymentSheet(paymentPageState?.returnView || 'bills');
  }

  function finishPaymentSheetDrag(event) {
    if (!paymentSheetDrag) return;
    const drag = paymentSheetDrag;
    paymentSheetDrag = null;
    const sheet = document.querySelector('[data-payment-sheet]');
    if (sheet) {
      sheet.classList.remove('is-dragging');
      sheet.style.removeProperty('transform');
    }
    const delta = (event?.clientY ?? drag.lastY) - drag.startY;
    if (delta < -55) resizePaymentSheet('up');
    else if (delta > 170) dismissPaymentSheet(paymentPageState?.returnView || 'bills');
    else if (delta > 55) resizePaymentSheet('down');
  }

  async function copyPaymentAccount(accountNumber) {
    const value = String(accountNumber || '').trim();
    if (!value) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const field = document.createElement('textarea');
        field.value = value;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        const copied = document.execCommand && document.execCommand('copy');
        field.remove();
        if (!copied) throw new Error('clipboard unavailable');
      }
      toast('คัดลอกเลขบัญชีแล้ว');
    } catch (_) {
      toast('คัดลอกไม่สำเร็จ กรุณาคัดลอกเลขบัญชีด้วยตนเอง');
    }
  }

  window.finishPaymentPageSubmission = function () {
    if (view !== 'payment' || !paymentPageState) return false;
    const returnView = paymentPageState.returnView || 'bills';
    paymentPageState = null;
    view = returnView;
    unlockPaymentBackgroundScroll();
    return true;
  };

  payModal = function (id) {
    if (typeof updateDisplayedFees === 'function') updateDisplayedFees();
    const charge = db?.charges?.find(item => item.id === id);
    if (!charge || charge.profile_id !== user?.id) return;
    if (paymentSheetCloseTimer) clearTimeout(paymentSheetCloseTimer);
    paymentSheetCloseTimer = null;
    paymentPageState = {id: id, method: '', returnView: view, backgroundScrollY: window.scrollY || window.pageYOffset || 0};
    paymentSheetEntrancePending = true;
    view = 'payment';
    render();
    scrollPaymentPageToTop();
  };

  document.addEventListener('click', event => {
    if (event.target.closest('[data-payment-sheet-dismiss]')) {
      dismissPaymentSheet(paymentPageState?.returnView || 'bills');
      return;
    }
    const button = event.target.closest('[data-payment-sheet-back],[data-payment-sheet-close],[data-payment-method],[data-payment-method-back],[data-payment-page-back],[data-copy-account]');
    if (!button) return;
    if (button.hasAttribute('data-copy-account')) {
      event.preventDefault();
      copyPaymentAccount(button.dataset.copyAccount);
      return;
    }
    if (button.hasAttribute('data-payment-page-back')) {
      leavePaymentPage();
      return;
    }
    if (button.hasAttribute('data-payment-sheet-close')) {
      dismissPaymentSheet(paymentPageState?.returnView || 'bills');
      return;
    }
    if (button.hasAttribute('data-payment-sheet-back')) {
      window.paymentPageHandleTopbarBack();
      return;
    }
    if (!paymentPageState) return;
    if (button.hasAttribute('data-payment-method-back')) paymentPageState.method = '';
    else if (!button.disabled) paymentPageState.method = button.dataset.paymentMethod;
    render();
    scrollPaymentPageToTop();
  });

  const baseRender = render;
  render = function () {
    baseRender();
    if (view === 'payment') lockPaymentBackgroundScroll(paymentPageState?.backgroundScrollY);
    else unlockPaymentBackgroundScroll();
    if (view === 'payment' && paymentSheetEntrancePending) {
      const overlay = document.querySelector('[data-payment-sheet-overlay]');
      if (overlay) {
        void overlay.offsetHeight;
        overlay.classList.add('is-open');
        paymentSheetEntrancePending = false;
      }
    }
    if (view === 'payment' && typeof updatePaymentQr === 'function' && paymentPageState?.method === 'qr') {
      updatePaymentQr();
      const qr = document.getElementById('payment-qr');
      const placeholder = document.querySelector('.payment-page-qr-placeholder');
      if (placeholder) placeholder.hidden = !!qr && !qr.hidden;
    }
  };

  window.paymentPageHandleTopbarBack = function () {
    if (view !== 'payment' || !paymentPageState) return false;
    if (paymentPageState.method) {
      paymentPageState.method = '';
      render();
      scrollPaymentPageToTop();
      return true;
    }
    dismissPaymentSheet(paymentPageState.returnView || 'bills');
    return true;
  };

  document.addEventListener('pointerdown', event => {
    const handle = event.target.closest?.('[data-payment-sheet-drag]');
    if (!handle || view !== 'payment' || event.button > 0) return;
    const sheet = document.querySelector('[data-payment-sheet]');
    if (!sheet) return;
    paymentSheetDrag = {startY: event.clientY, lastY: event.clientY};
    sheet.classList.add('is-dragging');
    event.preventDefault();
  }, {passive:false});

  window.addEventListener('pointermove', event => {
    if (!paymentSheetDrag) return;
    paymentSheetDrag.lastY = event.clientY;
    const sheet = document.querySelector('[data-payment-sheet]');
    if (!sheet) return;
    const delta = event.clientY - paymentSheetDrag.startY;
    sheet.style.transform = 'translate3d(0,' + Math.max(-110, Math.min(260, delta)) + 'px,0)';
  });

  window.addEventListener('pointerup', finishPaymentSheetDrag);
  window.addEventListener('pointercancel', finishPaymentSheetDrag);

  document.addEventListener('wheel', event => {
    if (view === 'payment' && !event.target.closest?.('[data-payment-sheet-scroll]')) event.preventDefault();
  }, {passive:false});

  document.addEventListener('touchmove', event => {
    if (view === 'payment' && !event.target.closest?.('[data-payment-sheet-scroll]')) event.preventDefault();
  }, {passive:false});

  document.addEventListener('keydown', event => {
    const handle = event.target.closest?.('[data-payment-sheet-drag]');
    if (view !== 'payment') return;
    if (event.key === 'Escape') {
      event.preventDefault();
      dismissPaymentSheet(paymentPageState?.returnView || 'bills');
      return;
    }
    if (!handle) return;
    if (event.key === 'ArrowUp') { event.preventDefault(); resizePaymentSheet('up'); }
    if (event.key === 'ArrowDown') { event.preventDefault(); resizePaymentSheet('down'); }
  });

  // Intercept the shared header before other delegated navigation handlers.
  window.addEventListener('click', event => {
    const button = event.target?.closest?.('[data-topbar-back]');
    if (!button || view !== 'payment') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.paymentPageHandleTopbarBack();
  }, true);
})();