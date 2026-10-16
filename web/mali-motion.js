'use strict';
(()=>{
 const reduce=matchMedia('(prefers-reduced-motion: reduce)'),animations=new Set();
 const cards='.mp-stat,.mp-card,.mp-bill,.clay-round-card,.individual-bill,.activity-card,.message-card,.fund-category-card,.category-total-strip,.shop-product,.shop-order,.shop-order-card,.mp-history-row,.panel,.recovery-card,.login-form,.login-art';
 let lastPage='',frame=0;
 function remember(animation){animations.add(animation);animation.finished.catch(()=>{}).finally(()=>{animations.delete(animation);animation.cancel()})}
 function stop(){for(const animation of animations)animation.cancel();animations.clear()}
 function enter(){
  frame=0;if(reduce.matches||document.hidden||!Element.prototype.animate)return;
  const key=typeof user==='undefined'?location.pathname:user?`${user.id}:${view}`:'login';
  if(key===lastPage)return;
  const main=document.querySelector('#app main')||document.querySelector('.login-page')||document.querySelector('main');if(!main)return;
  const nodes=[...main.querySelectorAll(cards)];if(main.matches(cards))nodes.unshift(main);
  // Animate leaf cards, never both a card and its parent. Only the first screen staggers.
  const visible=nodes.filter(el=>!el.querySelector(cards)&&!el.closest('[hidden],dialog,.mp-bill-source')).filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.top<innerHeight+80&&r.bottom>0}).slice(0,16);
  if(!visible.length)return;lastPage=key;stop();
  visible.forEach((el,i)=>remember(el.animate([{opacity:0,translate:'0 12px'},{opacity:1,translate:'0 0'}],{duration:380,delay:Math.min(i*48,360),easing:'cubic-bezier(.22,.7,.22,1)',fill:'backwards'})));
 }
 function schedule(){cancelAnimationFrame(frame);frame=requestAnimationFrame(enter)}
 if(typeof render==='function'){const previous=render;render=function(...args){const result=previous(...args);schedule();return result}}
 // Animate the contents of a newly opened dialog, keeping the dialog's position and focus stable.
 const openDialogs=new WeakSet();
 new MutationObserver(records=>{if(reduce.matches)return;for(const record of records){const d=record.target;if(!d.matches?.('dialog')||!d.open){if(d.matches?.('dialog'))openDialogs.delete(d);continue}if(openDialogs.has(d)||!Element.prototype.animate)continue;openDialogs.add(d);const children=[...d.children].filter(el=>el.tagName!=='STYLE'&&el.tagName!=='SCRIPT'&&!el.hidden&&!el.matches('.festival-frame-art,#operation-status')).slice(0,10);children.forEach((el,i)=>remember(el.animate([{opacity:0,translate:'0 7px'},{opacity:1,translate:'0 0'}],{duration:240,delay:Math.min(i*24,120),easing:'ease-out',fill:'backwards'})))}}).observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});
 reduce.addEventListener('change',()=>{if(reduce.matches){stop();cancelAnimationFrame(frame)}});
 window.addEventListener('pagehide',stop);
 schedule();
})();
