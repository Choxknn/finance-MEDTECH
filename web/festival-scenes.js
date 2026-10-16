'use strict';
(()=>{
 let current={settings:{},active:'none'},frame=0,signature='';
 const motifs={
 christmas:'<path d="M20 3v34M5 11l30 18M5 29l30-18M15 6l5 5 5-5M15 34l5-5 5 5" fill="none" stroke="#a5c9dd" stroke-width="2.5" stroke-linecap="round"/>',
 songkran:'<g fill="#f2c9da"><ellipse cx="20" cy="13" rx="6" ry="10"/><ellipse cx="20" cy="13" rx="6" ry="10" transform="rotate(72 20 20)"/><ellipse cx="20" cy="13" rx="6" ry="10" transform="rotate(144 20 20)"/><ellipse cx="20" cy="13" rx="6" ry="10" transform="rotate(216 20 20)"/><ellipse cx="20" cy="13" rx="6" ry="10" transform="rotate(288 20 20)"/></g><circle cx="20" cy="20" r="5" fill="#e9bf72"/>',
 halloween:'<path d="m20 11 3-7" stroke="#8ea484" stroke-width="3"/><ellipse cx="20" cy="24" rx="17" ry="13" fill="#e8af75"/><ellipse cx="20" cy="24" rx="8" ry="13" fill="none" stroke="#ce8d57"/><path d="m10 22 5-5 3 6m4 0 4-6 4 5M16 29q4 4 8 0" fill="#866347"/>',
 valentine:'<path d="M20 12C4-5-8 20 20 36C48 20 36-5 20 12" fill="#e9b0c7"/><path d="m8 14 3-3" stroke="#fff" stroke-width="3" stroke-linecap="round"/>',
 loykrathong:'<path d="M4 26q16 18 32 0M8 25 4 13q12 2 16 13M32 25l4-12q-12 2-16 13" fill="#adc9ad"/><path d="M20 29Q3 15 20 7Q37 15 20 29" fill="#e7bad1"/><path d="M20 25V12" stroke="#e7ba64" stroke-width="3"/><path d="M20 10q-5-4 0-8q5 4 0 8" fill="#e7ba64"/>',
 exams:'<path d="m20 3 5 11 12 2-9 9 2 12-10-6-10 6 2-12-9-9 12-2Z" fill="#e9ce86"/><path d="m16 20 3 3 6-6" fill="none" stroke="#fff" stroke-width="2"/>'
 };
 function svg(theme){return `<svg viewBox="0 0 40 40" aria-hidden="true">${motifs[theme]||''}</svg>`}
 function apply(){frame=0;const {settings:s,active}=current,on=active!=='none'&&s.decorations!==false,moving=s.motion!==false;document.documentElement.dataset.festival=on?active:'none';document.documentElement.classList.toggle('festival-still',!moving);
  document.querySelectorAll('.meddy-character').forEach(el=>{el.dataset.festivalPose=active;el.classList.toggle('festival-pose',active!=='none'&&moving)});
  const sig=`${active}:${on}:${moving}`;
  if(signature!==sig){document.querySelectorAll('.festival-scene,.festival-frame-art').forEach(el=>el.remove());document.querySelectorAll('[data-festival-frame]').forEach(el=>delete el.dataset.festivalFrame);signature=sig}
  if(!on)return;
  if(!document.querySelector('.festival-scene')){const layer=document.createElement('div');layer.className='festival-scene';layer.setAttribute('aria-hidden','true');layer.innerHTML=Array.from({length:8},(_,i)=>`<span class="festival-float ${moving?'is-floating':''}" style="--x:${[3,94,9,89,2,96,14,84][i]}%;--y:${10+i*11}%;--delay:-${i*3}s;--duration:${19+i*2}s;--size:${18+i%3*7}px">${svg(active)}</span>`).join('');document.body.append(layer)}
  document.querySelectorAll('dialog[open]:not(.finance-picker-popup),.mp-card,.mp-stat,.mp-bill,.login-art,.login-form,.boot-card').forEach(el=>{if(el.dataset.festivalFrame===sig)return;el.dataset.festivalFrame=sig;el.classList.add('festival-frame');const art=document.createElement('span');art.className='festival-frame-art';art.setAttribute('aria-hidden','true');art.innerHTML=svg(active)+svg(active);el.append(art)});
 }
 function schedule(){if(!frame)frame=requestAnimationFrame(apply)}
 window.addEventListener('festival-change',e=>{current=e.detail;schedule()});
 // Dialog contents are frequently replaced without a page render.
 new MutationObserver(records=>{if(records.some(r=>r.type==='attributes'||[...r.addedNodes].some(n=>n.nodeType===1&&!n.matches('.festival-scene,.festival-frame-art,.festival-costume,.festival-corner,.festival-greeting'))))schedule()}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});
})();
