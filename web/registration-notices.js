'use strict';
(()=>{const el=document.getElementById('register-status');if(!el)return;const decorate=()=>{const t=el.textContent.trim();el.hidden=!t;el.classList.add('status-notice');el.dataset.tone=/ไม่ถูกต้อง|ไม่ตรง|ไม่สำเร็จ|หมดอายุ|ผิดพลาด|ไม่พบ|ต้องมี/.test(t)?'error':/สำเร็จ|เชื่อม LINE แล้ว|สร้างบัญชีแล้ว|คัดลอกแล้ว/.test(t)?'success':/กรุณา|ยังไม่ได้/.test(t)?'warning':'info'};new MutationObserver(decorate).observe(el,{childList:true,characterData:true,subtree:true});decorate()})();

(()=>{const form=document.getElementById('register-form');let dirty=false;form?.addEventListener('input',()=>{dirty=true});form?.addEventListener('reset',()=>{dirty=false});addEventListener('beforeunload',e=>{if(dirty&&form&&!form.hidden){e.preventDefault();e.returnValue=''}})})();
