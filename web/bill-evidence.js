'use strict';
function billEvidenceFields(charge){
 const previous=(db.payments||[]).filter(p=>p.charge_id===charge.id&&!p.deleted_at&&p.drive_file_id).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
 const proofs=[...(charge.drive_file_id?[proofHtml('charge',charge,true)]:[]),...previous.map(p=>proofHtml('payment',p,true))];
 queueMicrotask(watchProofs);
 return `<section class="bill-evidence-fields">${proofs.length?`<h3>สลิปที่มีอยู่</h3><div class="bill-existing-evidence">${proofs.join('')}</div>`:''}<label for="bill-admin-slip">${icon('document')} แนบรูปสลิป (ไม่บังคับ)</label><input id="bill-admin-slip" name="file" type="file" accept="image/jpeg,image/png,image/webp" data-bill-slip><p class="help">JPG, PNG หรือ WEBP ไม่เกิน 5 MB · ไม่เลือกรูปใหม่จะเก็บหลักฐานเดิมไว้</p><figure class="bill-slip-preview" hidden><img alt="ตัวอย่างสลิปใหม่"><figcaption class="help"></figcaption><button type="button" class="secondary small" data-clear-bill-slip>เอารูปที่เลือกออก</button></figure><p class="error" data-bill-slip-error role="alert" hidden></p></section>`;
}
let billSlipPreviewUrl='';
function clearBillSlipPreview(){if(billSlipPreviewUrl)URL.revokeObjectURL(billSlipPreviewUrl);billSlipPreviewUrl=''}
document.addEventListener('change',e=>{if(!e.target.matches('[data-bill-slip]'))return;const input=e.target,section=input.closest('.bill-evidence-fields'),preview=section.querySelector('.bill-slip-preview'),error=section.querySelector('[data-bill-slip-error]');clearBillSlipPreview();preview.hidden=true;error.hidden=true;const file=input.files[0];if(!file)return;try{validateFile(file);billSlipPreviewUrl=URL.createObjectURL(file);preview.querySelector('img').src=billSlipPreviewUrl;preview.querySelector('figcaption').textContent=file.name;preview.hidden=false}catch(err){input.value='';error.textContent=err.message;error.hidden=false}});
document.addEventListener('click',e=>{const b=e.target.closest('[data-clear-bill-slip]');if(!b)return;const section=b.closest('.bill-evidence-fields');section.querySelector('[data-bill-slip]').value='';section.querySelector('.bill-slip-preview').hidden=true;clearBillSlipPreview()});
document.getElementById('dialog').addEventListener('close',clearBillSlipPreview);
