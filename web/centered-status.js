'use strict';
// One native modal surface for foreground operations and their results.
statusSurface=function(id){
 let el=document.getElementById(id);
 if(el&&el.tagName!=='DIALOG'){if(el.hasAttribute('popover')){try{el.hidePopover()}catch{}}el.remove();el=null}
 if(!el){
  el=document.createElement('dialog');el.id=id;el.hidden=true;
  el.setAttribute('aria-live','polite');
  el.setAttribute('aria-label',id==='operation-status'?'กำลังดำเนินการ':'ผลการทำรายการ');
  if(id==='operation-status'){
   el.addEventListener('cancel',e=>e.preventDefault());
   el.addEventListener('touchmove',e=>e.preventDefault(),{passive:false});
   el.addEventListener('wheel',e=>e.preventDefault(),{passive:false});
  }
  document.body.append(el);
 }
 return el;
};
showStatusSurface=function(el,visible){
 if(!el)return;
 if(el.tagName!=='DIALOG'){el.hidden=!visible;return}
 if(visible){el.hidden=false;if(!el.open)el.showModal()}
 else{if(el.open)el.close();el.hidden=true}
};
paintBusy=function(){
 const el=statusSurface('operation-status'),job=[...busyJobs.values()].at(-1);
 if(job)el.innerHTML=`<span class="operation-spinner" aria-hidden="true"></span><div><strong>${esc(job)}</strong><small>กรุณารอสักครู่</small></div>`;
 showStatusSurface(el,!!job);
};
// Keep the current surface through the promise continuation and any follow-up refresh.
startBusy=function(label){
 const id=++busySerial;busyJobs.set(id,label);clearTimeout(busyTimer);paintBusy();
 return()=>{busyJobs.delete(id);clearTimeout(busyTimer);if(busyJobs.size)paintBusy();else busyTimer=setTimeout(paintBusy,0)};
};
operationLabels['shop-pay']='กำลังอัปโหลดและตรวจสอบสลิป';

// Background refreshes stay silent; foreground refreshes inherit the existing loader.
function continueStatusRefresh(run){
 return async function(...args){
  const current=document.getElementById('operation-status');
  const done=current?.open?startBusy(current.querySelector('strong')?.textContent||'กำลังอัปเดตข้อมูล'):null;
  try{return await run.apply(this,args)}finally{done?.()}
 };
}
refresh=continueStatusRefresh(refresh);
if(typeof shopLoad==='function')shopLoad=continueStatusRefresh(shopLoad);
function finishStatusHandoff(){
 clearTimeout(busyTimer);
 const loading=document.getElementById('operation-status');
 if(loading)showStatusSurface(loading,false);
}
const statusResultToast=toast;
toast=function(...args){const result=statusResultToast(...args);finishStatusHandoff();return result};
const statusPaymentPopup=paymentStatusPopup;
paymentStatusPopup=function(...args){const result=statusPaymentPopup(...args);finishStatusHandoff();return result};
