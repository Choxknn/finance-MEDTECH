'use strict';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
window.addEventListener('DOMContentLoaded',()=>{document.getElementById('flex-gallery').innerHTML=flexExamples.map(([k,t,b])=>flexPreviewHtml(t,b,k)).join('')});
