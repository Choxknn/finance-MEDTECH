'use strict';

(() => {
  const legacyPaymentPagePayModal = payModal;
  const paymentPageDialog = document.getElementById('dialog');

  function paymentPageIcon(name) {
    const paths = {
      arrow: '<path d="M19 12H5m7 7-7-7 7-7"/>',
      lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3"/>',
      upload: '<path d="M12 16V4m-5 7 5-7 5 7"/><path d="M4 16v4h16v-4"/>',
      bank: '<path d="M3 10h18M5 10v9m4-9v9m6-9v9m4-9v9M3 20h18M12 3 2 8v2h20V8z"/>'
    };
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || paths.bank) + '</svg>';
  }

  function buildPaymentPage(id) {
    legacyPaymentPagePayModal(id);

    const dialog = paymentPageDialog;
    const form = dialog.querySelector('#pay-form');
    if (!dialog.open || !form) return;

    const charge = db.charges.find(item => item.id === id);
    if (!charge || charge.profile_id !== user?.id) return;

    const bill = round(charge.round_id);
    const amount = Number(form.elements.amount.value);
    const due = bill.due_date ? recordTime(bill, 'due_date') : 'ไม่ระบุวันครบกำหนด';
    const paidAmount = paid(charge);
    const feeAmount = Number(charge.fee_amount || 0);

    const page = document.createElement('div');
    page.className = 'payment-page';
    page.innerHTML = `
      <header class="modal-head payment-page-header">
        <button type="button" class="payment-page-back" data-action="close" aria-label="กลับ">
          ${paymentPageIcon('arrow')}
        </button>
        <div class="payment-page-header-title">
          <span>FINANCE MEDTECH</span>
          <strong>ชำระบิล</strong>
        </div>
        <div class="payment-page-secure">${paymentPageIcon('lock')}<span>SECURE</span></div>
      </header>

      <main class="payment-page-content">
        <section class="payment-page-overview" aria-label="สรุปรายการชำระเงิน">
          <div class="payment-page-heading">
            <span class="payment-page-eyebrow">BILL PAYMENT</span>
            <h1 class="payment-page-bill-title">${esc(bill.title || 'รายการชำระเงิน')}</h1>
            <p class="payment-page-description">${esc(bill.description || 'ตรวจสอบยอดและโอนเงินตามรายละเอียดด้านล่าง')}</p>
            <div class="payment-page-due">
              <span class="payment-page-due-mark"></span>
              <span>ครบกำหนด</span>
              <strong>${esc(due)}</strong>
            </div>
          </div>

          <aside class="payment-page-total">
            <div class="payment-page-total-label"><span>ยอดที่ต้องชำระ</span><span>THB</span></div>
            <strong class="payment-page-total-value">฿${money(amount)}</strong>
            <div class="payment-page-total-divider"></div>
            <div class="payment-page-total-line"><span>ยอดบิล</span><b>฿${money(charge.amount)}</b></div>
            ${feeAmount > 0 ? `<div class="payment-page-total-line"><span>ค่าปรับ</span><b>฿${money(feeAmount)}</b></div>` : ''}
            ${paidAmount > 0 ? `<div class="payment-page-total-line"><span>ชำระแล้ว</span><b>฿${money(paidAmount)}</b></div>` : ''}
          </aside>
        </section>

        <section class="payment-page-methods" aria-label="ช่องทางชำระเงิน">
          <article class="payment-page-card payment-page-bank">
            <div class="payment-page-card-heading">
              <span class="payment-page-step">01</span>
              <div><span>TRANSFER DETAILS</span><h2>โอนเงินเข้าบัญชี</h2></div>
              ${paymentPageIcon('bank')}
            </div>
            <div class="payment-page-bank-details">
              ${cfg.accountNumber
                ? `<div class="payment-page-bank-row"><span>ธนาคาร</span><strong>${esc(cfg.bankName || '—')}</strong></div>
                   <div class="payment-page-bank-row"><span>ชื่อบัญชี</span><strong>${esc(cfg.accountName || '—')}</strong></div>
                   <div class="payment-page-account-number"><span>เลขที่บัญชี</span><strong>${esc(cfg.accountNumber)}</strong></div>`
                : '<p class="payment-page-bank-unset">ยังไม่ได้ตั้งค่าบัญชีรับเงิน กรุณาทดลองด้วยภาพตัวอย่างเท่านั้น</p>'}
            </div>
          </article>

          <article class="payment-page-card payment-page-qr">
            <div class="payment-page-card-heading">
              <span class="payment-page-step">02</span>
              <div><span>SCAN TO PAY</span><h2>สแกน QR เพื่อชำระ</h2></div>
            </div>
            <div class="payment-page-qr-stage">
              <div class="payment-page-qr-placeholder" aria-hidden="true">
                <span>QR</span><small>รหัสชำระเงิน</small>
              </div>
            </div>
          </article>
        </section>

        <section class="payment-page-card payment-page-upload">
          <div class="payment-page-card-heading payment-page-upload-heading">
            <span class="payment-page-step">03</span>
            <div><span>PAYMENT CONFIRMATION</span><h2>แนบหลักฐานการโอน</h2><p>เลือกรูปสลิปจากอุปกรณ์เพื่อส่งให้ระบบตรวจสอบ</p></div>
            <span class="payment-page-file-types">JPG · PNG · WEBP <i>ไม่เกิน 5 MB</i></span>
          </div>
          <div class="payment-page-upload-slot"></div>
        </section>

        <p class="payment-page-footnote">${paymentPageIcon('lock')} ข้อมูลการชำระจะถูกส่งเข้าสู่ระบบตรวจสอบโดยตรง กรุณาอย่าปิดหน้าระหว่างกำลังส่งสลิป</p>
      </main>`;

    const qr = dialog.querySelector('#payment-qr');
    const qrHint = dialog.querySelector('#payment-qr-hint');
    const hiddenAmount = form.querySelector('#pay-amount');
    const dropzone = form.querySelector('.dropzone');
    const autoHelp = form.querySelector('.auto-slip-help');
    const actions = form.querySelector('.actions');
    const formError = form.querySelector('.form-error');
    const cancelButton = form.querySelector('[data-action="close"]');

    cancelButton?.remove();

    if (dropzone) {
      dropzone.insertAdjacentHTML('afterbegin', `<div class="payment-page-upload-mark">${paymentPageIcon('upload')}</div><div class="payment-page-upload-copy"><strong>เลือกไฟล์สลิปจากอุปกรณ์</strong><span>แตะเพื่อเลือกรูปภาพ หรือวางไฟล์ลงในกรอบนี้</span></div>`);
      const fileLabel = dropzone.querySelector('label[for="slip-file"]');
      if (fileLabel) fileLabel.textContent = 'เลือกภาพสลิป';
      const fileHelp = dropzone.querySelector('p.help');
      if (fileHelp) fileHelp.textContent = 'รองรับ JPG, PNG หรือ WEBP · ขนาดไม่เกิน 5 MB';
    }

    form.classList.add('payment-page-form');
    form.dataset.paymentPage = 'true';
    form.replaceChildren(...[hiddenAmount, dropzone, autoHelp, formError, actions].filter(Boolean));

    page.querySelector('.payment-page-qr-stage').append(qr);
    page.querySelector('.payment-page-qr-stage').append(qrHint);
    page.querySelector('.payment-page-upload-slot').append(form);

    dialog.replaceChildren(page);
    dialog.classList.add('payment-page-dialog');
    dialog.setAttribute('aria-label', 'ชำระบิล ' + String(bill.title || ''));
    dialog.scrollTop = 0;

    const qrPlaceholder = page.querySelector('.payment-page-qr-placeholder');
    if (qrPlaceholder) qrPlaceholder.hidden = !!qr && !qr.hidden;

    if (!dialog.dataset.paymentPageCleanup) {
      dialog.dataset.paymentPageCleanup = 'true';
      dialog.addEventListener('close', () => {
        dialog.classList.remove('payment-page-dialog');
        dialog.removeAttribute('data-payment-page-active');
      });
    }
    dialog.setAttribute('data-payment-page-active', 'true');
    updatePaymentQr();
    if (qrPlaceholder) qrPlaceholder.hidden = !!qr && !qr.hidden;
    page.querySelector('.payment-page-back')?.focus({preventScroll: true});
  }

  payModal = buildPaymentPage;
})();