'use strict';

(() => {
  let paymentPageState = null;
  let paymentPageEntrancePending = false;
  const baseContent = content;
  const baseNav = nav;

  function paymentPageIcon(name) {
    const paths = {
      arrow: '<path d="M19 12H5m7 7-7-7 7-7"/>',
      bank: '<path d="M3 10h18M5 10v9m4-9v9m6-9v9m4-9v9M3 20h18M12 3 2 8v2h20V8z"/>',
      qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zm5 0h2v2h-2zm-5 5h2v2h-2zm5 0h2v2h-2z"/>',
      lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3"/>',
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

  function paymentPageMethodChoice(name, title, description, note, icon, disabled) {
    return '<button type="button" class="payment-page-method-choice" data-payment-method="' + name + '"' +
      (disabled ? ' disabled aria-disabled="true"' : '') + '><span class="payment-page-method-symbol">' + paymentPageIcon(icon) + '</span>' +
      '<span class="payment-page-method-copy"><strong>' + title + '</strong></span>' +
      '<span class="payment-page-method-arrow">' + paymentPageIcon('arrow') + '</span></button>';
  }

  function paymentPageMarkup() {
    const charge = paymentPageCharge();
    if (!charge) {
      return '<section class="payment-page"><div class="payment-page-content"><div class="payment-page-empty">ไม่พบรายการที่ต้องชำระ หรือรายการนี้ไม่สามารถชำระได้แล้ว<button type="button" data-payment-page-back>กลับหน้าหลัก</button></div></div></section>';
    }

    const bill = round(charge.round_id);
    const amount = balance(charge);
    const qr = typeof selectPaymentQr === 'function' ? selectPaymentQr(amount) : {url: ''};
    const contentStart = '<section class="payment-page"><div class="payment-page-content">';
    const summary = paymentPageSummary(charge, bill, amount);

    if (!paymentPageState.method) {
      return contentStart +
        '<h1 class="payment-page-main-title">เลือกวิธีชำระ</h1>' +
        summary +
        '<section class="payment-page-method-section"><div class="payment-page-section-heading"><h2>เลือกช่องทางชำระเงิน</h2></div>' +
        '<div class="payment-page-method-choices">' +
        paymentPageMethodChoice('bank', 'โอนผ่านเลขบัญชีธนาคาร', '', '', 'bank', false) +
        paymentPageMethodChoice('qr', 'สแกน QR Code', '', '', 'qr', !qr.url) +
        '</div></section></div></section>';
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
      '</div></section>';
  }

  content = function () {
    if (view === 'payment') return paymentPageMarkup();
    return baseContent();
  };

  nav = function (nextView) {
    if (view === 'payment' && nextView !== 'payment') paymentPageState = null;
    return baseNav(nextView);
  };

  function leavePaymentPage() {
    if (!paymentPageState) return;
    const returnView = paymentPageState.returnView || 'bills';
    paymentPageState = null;
    nav(returnView);
  }

  window.paymentPageHasSelectedMethod = () => Boolean(paymentPageState?.method);

  function scrollPaymentPageToTop() {
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    const app = document.getElementById('app');
    if (app) app.scrollTop = 0;
    const workspace = document.querySelector('.workspace');
    if (workspace) workspace.scrollTop = 0;
    window.scrollTo(0, 0);
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
    return true;
  };

  payModal = function (id) {
    if (typeof updateDisplayedFees === 'function') updateDisplayedFees();
    const charge = db?.charges?.find(item => item.id === id);
    if (!charge || charge.profile_id !== user?.id) return;
    paymentPageState = {id: id, method: '', returnView: view};
    paymentPageEntrancePending = true;
    view = 'payment';
    render();
    scrollPaymentPageToTop();
  };

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-payment-method],[data-payment-method-back],[data-payment-page-back],[data-copy-account]');
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
    if (!paymentPageState) return;
    if (button.hasAttribute('data-payment-method-back')) paymentPageState.method = '';
    else if (!button.disabled) paymentPageState.method = button.dataset.paymentMethod;
    render();
    scrollPaymentPageToTop();
  });

  const baseRender = render;
  render = function () {
    baseRender();
    if (view === 'payment' && paymentPageEntrancePending) {
      const page = document.querySelector('.payment-page');
      if (page) {
        page.classList.add('payment-page-entering');
        page.addEventListener('animationend', event => {
          if (event.animationName === 'payment-page-slide-in') page.classList.remove('payment-page-entering');
        }, {once:true});
        paymentPageEntrancePending = false;
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
    paymentPageState = null;
    nav('dashboard');
    scrollPaymentPageToTop();
    return true;
  };

  // Intercept the shared header before other delegated navigation handlers.
  window.addEventListener('click', event => {
    const button = event.target?.closest?.('[data-topbar-back]');
    if (!button || view !== 'payment') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.paymentPageHandleTopbarBack();
  }, true);
})();