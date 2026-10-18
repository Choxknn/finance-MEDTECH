'use strict';
// Native modal keeps payment progress above open checkout dialogs and blocks background input.
(()=>{
 let active=0,box;
 const previousPaint=paintBusy;
 paintBusy=function(){
  if(active){const status=document.getElementById('operation-status');if(status)showStatusSurface(status,false);return}
  previousPaint();
 };
 function openProgress(){
  if(!box){
   box=document.createElement('dialog');box.id='payment-loading';
   box.setAttribute('aria-label','กำลังตรวจสอบการชำระเงิน');
   box.innerHTML='<div class="payment-loading-card" role="status" aria-live="polite"><span class="operation-spinner" aria-hidden="true"></span><strong>กำลังตรวจสอบการชำระเงิน</strong><p>กำลังอัปโหลดและตรวจสลิป<br>กรุณารอสักครู่ ไม่ต้องส่งซ้ำ</p></div>';
   box.addEventListener('cancel',e=>e.preventDefault());
   box.addEventListener('touchmove',e=>e.preventDefault(),{passive:false});
   box.addEventListener('wheel',e=>e.preventDefault(),{passive:false});
   document.body.append(box);
  }
  document.activeElement?.blur();
  if(!box.open)box.showModal();
  paintBusy();
 }
 const previousApi=api;
 api=async function(action,...args){
  if(!['submit-payment','retry-payment','shop-pay'].includes(action))return previousApi(action,...args);
  active++;
  try{openProgress();return await previousApi(action,...args)}
  finally{active--;if(!active){box?.close();paintBusy()}}
 };
})();
