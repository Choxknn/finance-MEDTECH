'use strict';

(() => {
  let paymentPageState = null;
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
      '<div class="payment-page-heading"><span class="payment-page-eyebrow">BILL PAYMENT</span>' +
      '<h1 class="payment-page-bill-title">' + esc(bill.title || 'รายการชำระเงิน') + '</h1>' +
      '<p class="payment-page-description">' + esc(bill.description || 'ตรวจสอบยอดและเลือกช่องทางชำระเงิน') + '</p>' +
      '<div class="payment-page-due"><span class="payment-page-due-mark"></span><span>ครบกำหนด</span><strong>' + esc(due) + '</strong></div></div>' +
      '<aside class="payment-page-total"><div class="payment-page-total-label"><span>ยอดที่ต้องชำระ</span><span>THB</span></div>' +
      '<strong class="payment-page-total-value">฿' + money(amount) + '</strong><div class="payment-page-total-divider"></div>' +
      '<div class="payment-page-total-line"><span>ยอดบิล</span><b>฿' + money(charge.amount) + '</b></div>' +
      (feeAmount > 0 ? '<div class="payment-page-total-line"><span>ค่าปรับ</span><b>฿' + money(feeAmount) + '</b></div>' : '') +
      (paidAmount > 0 ? '<div class="payment-page-total-line"><span>ชำระแล้ว</span><b>฿' + money(paidAmount) + '</b></div>' : '') +
      '</aside></section>';
  }

  function paymentPageTopline(stepTitle, stepDescription) {
    return '<div class="payment-page-titlebar"><div><span class="payment-page-eyebrow">FINANCE MEDTECH · SECURE PAYMENT</span>' +
      '<h1>' + stepTitle + '</h1><p>' + stepDescription + '</p></div>' +
      '<button type="button" class="payment-page-back" data-payment-page-back aria-label="กลับหน้าก่อน">' + paymentPageIcon('arrow') + '<span>กลับ</span></button></div>';
  }

  function paymentPageMethodChoice(name, title, description, note, icon, disabled) {
    return '<button type="button" class="payment-page-method-choice" data-payment-method="' + name + '"' +
      (disabled ? ' disabled aria-disabled="true"' : '') + '><span class="payment-page-method-symbol">' + paymentPageIcon(icon) + '</span>' +
      '<span class="payment-page-method-copy"><strong>' + title + '</strong><small>' + description + '</small><em>' + note + '</em></span>' +
      '<span class="payment-page-method-arrow">' + paymentPageIcon('arrow') + '</span></button>';
  }

  function paymentPageMarkup() {
    const charge = paymentPageCharge();
    if (!charge) {
      return '<section class="payment-page"><div class="payment-page-content"><div class="payment-page-empty">ไม่พบรายการที่ต้องชำระ หรือรายการนี้ไม่สามารถชำระได้แล้ว<button type="button" data-payment-page-back>กลับ</button></div></div></section>';
    }

    const bill = round(charge.round_id);
    const amount = balance(charge);
    const qr = typeof selectPaymentQr === 'function' ? selectPaymentQr(amount) : {url: ''};
    const contentStart = '<section class="payment-page"><div class="payment-page-content">';
    const summary = paymentPageSummary(charge, bill, amount);

    if (!paymentPageState.method) {
      return contentStart +
        paymentPageTopline('เลือกวิธีการชำระเงิน', 'เลือกช่องทางที่สะดวก แล้วไปยังรายละเอียดสำหรับชำระเงิน') +
        summary +
        '<section class="payment-page-method-section"><div class="payment-page-section-heading"><div><span>PAYMENT METHOD</span><h2>ช่องทางชำระเงิน</h2><p>เลือกหนึ่งช่องทางเพื่อดูรายละเอียดและแนบสลิป</p></div><span class="payment-page-step">01 / 02</span></div>' +
        '<div class="payment-page-method-choices">' +
        paymentPageMethodChoice('bank', 'โอนผ่านบัญชีธนาคาร', 'โอนเงินไปยังบัญชีรับชำระของ MEDTECH', cfg.accountNumber ? 'พร้อมแสดงชื่อบัญชีและเลขที่บัญชี' : 'ยังไม่ได้ตั้งค่าบัญชีรับเงิน', 'bank', false) +
        paymentPageMethodChoice('qr', 'สแกน QR เพื่อชำระ', 'ชำระผ่านแอปธนาคารด้วย QR Code', qr.url ? 'แสดง QR ตามยอดที่ต้องชำระ' : 'ยังไม่มี QR สำหรับยอดนี้', 'qr', !qr.url) +
        '</div></section></div></section>';
    }

    const methodPanel = paymentPageState.method === 'bank'
      ? '<article class="payment-page-card payment-page-bank"><div class="payment-page-card-heading"><span class="payment-page-step">01</span><div><span>BANK TRANSFER</span><h2>รายละเอียดบัญชีรับเงิน</h2></div>' + paymentPageIcon('bank') + '</div>' +
        '<div class="payment-page-bank-details">' +
        (cfg.accountNumber
          ? '<div class="payment-page-bank-row"><span>ธนาคาร</span><strong>' + esc(cfg.bankName || '—') + '</strong></div><div class="payment-page-bank-row"><span>ชื่อบัญชี</span><strong>' + esc(cfg.accountName || '—') + '</strong></div><div class="payment-page-account-number"><span>เลขที่บัญชี</span><strong>' + esc(cfg.accountNumber) + '</strong></div>'
          : '<p class="payment-page-bank-unset">ยังไม่ได้ตั้งค่าบัญชีรับเงิน กรุณาติดต่อผู้ดูแลการเงินก่อนโอนเงิน</p>') +
        '</div></article>'
      : '<article class="payment-page-card payment-page-qr"><div class="payment-page-card-heading"><span class="payment-page-step">01</span><div><span>SCAN TO PAY</span><h2>สแกน QR เพื่อชำระ</h2></div>' + paymentPageIcon('qr') + '</div>' +
        '<div class="payment-page-qr-stage"><div class="payment-page-qr-placeholder" aria-hidden="true"><span>QR</span><small>รหัสชำระเงิน</small></div><img id="payment-qr" class="payment-page-qr-image" alt="QR สำหรับชำระเงิน" hidden></div>' +
        '<p id="payment-qr-hint" class="payment-page-qr-hint" role="status"></p></article>';

    return contentStart +
      paymentPageTopline('ชำระเงินและแนบสลิป', 'ทำรายการตามรายละเอียดด้านล่าง แล้วแนบหลักฐานเพื่อส่งตรวจสอบ') +
      summary +
      '<div class="payment-page-selected-method"><div><span>วิธีที่เลือก</span><strong>' + (paymentPageState.method === 'bank' ? paymentPageIcon('bank') + ' โอนผ่านบัญชีธนาคาร' : paymentPageIcon('qr') + ' สแกน QR เพื่อชำระ') + '</strong></div><button type="button" class="payment-page-change-method" data-payment-method-back>เปลี่ยนวิธีชำระ</button></div>' +
      '<section class="payment-page-method-details">' + methodPanel + '</section>' +
      '<section class="payment-page-card payment-page-upload"><div class="payment-page-card-heading payment-page-upload-heading">' +
      '<span class="payment-page-step">02</span><div><span>PAYMENT CONFIRMATION</span><h2>แนบหลักฐานการโอน</h2><p>เลือกรูปสลิปหลังจากชำระเงินแล้ว ระบบจะส่งให้ตรวจสอบอัตโนมัติ</p></div>' +
      '<span class="payment-page-file-types">JPG · PNG · WEBP <i>ไม่เกิน 5 MB</i></span></div>' +
      '<form id="pay-form" class="payment-page-form" data-id="' + esc(charge.id) + '">' +
      '<input id="pay-amount" name="amount" type="hidden" value="' + esc(amount) + '">' +
      '<div class="dropzone"><div class="payment-page-upload-mark">' + paymentPageIcon('upload') + '</div>' +
      '<div class="payment-page-upload-copy"><strong>เลือกไฟล์สลิปจากอุปกรณ์</strong><span>แตะเพื่อเลือกรูปภาพ หรือวางไฟล์ลงในกรอบนี้</span></div>' +
      '<label for="slip-file">เลือกภาพสลิป</label><input id="slip-file" name="file" type="file" accept="image/jpeg,image/png,image/webp" required>' +
      '<p class="help">รองรับ JPG, PNG หรือ WEBP · ขนาดไม่เกิน 5 MB</p><div id="file-preview"></div></div>' +
      '<p class="help auto-slip-help">เมื่อเลือกรูปสลิป ระบบจะส่งให้อัตโนมัติ ไม่ต้องกดปุ่มยืนยันอีกครั้ง</p>' +
      '<div class="actions"><button type="submit" data-slip-retry hidden>ลองส่งอีกครั้ง</button></div><div class="form-error" role="alert"></div></form></section>' +
      '<p class="payment-page-footnote">' + paymentPageIcon('lock') + ' ข้อมูลการชำระจะถูกส่งเข้าสู่ระบบตรวจสอบโดยตรง กรุณาอย่าปิดหน้าระหว่างกำลังส่งสลิป</p>' +
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
    view = 'payment';
    render();
  };

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-payment-method],[data-payment-method-back],[data-payment-page-back]');
    if (!button) return;
    if (button.hasAttribute('data-payment-page-back')) {
      leavePaymentPage();
      return;
    }
    if (!paymentPageState) return;
    if (button.hasAttribute('data-payment-method-back')) paymentPageState.method = '';
    else if (!button.disabled) paymentPageState.method = button.dataset.paymentMethod;
    render();
  });

  const baseRender = render;
  render = function () {
    baseRender();
    if (view === 'payment' && typeof updatePaymentQr === 'function' && paymentPageState?.method === 'qr') {
      updatePaymentQr();
      const qr = document.getElementById('payment-qr');
      const placeholder = document.querySelector('.payment-page-qr-placeholder');
      if (placeholder) placeholder.hidden = !!qr && !qr.hidden;
    }
  };

  if (typeof window.clayNavigateBack === 'function') {
    const baseClayNavigateBack = window.clayNavigateBack;
    window.clayNavigateBack = function () {
      if (view === 'payment') return leavePaymentPage();
      return baseClayNavigateBack();
    };
  }
})();