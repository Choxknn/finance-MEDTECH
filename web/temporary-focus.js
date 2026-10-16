'use strict';
(()=>{
 const selector='button,a,input,select,textarea,[tabindex]',timers=new WeakMap();let pressed=null,pointerTargets=new WeakSet();
 function finish(el){if(!el)return;clearTimeout(timers.get(el));el.classList.remove('temporary-focus','pointer-focus');el.classList.add('focus-finished')}
 function flash(el){if(!el?.matches?.(selector))return;clearTimeout(timers.get(el));el.classList.remove('focus-finished','pointer-focus');el.classList.add('temporary-focus');timers.set(el,setTimeout(()=>finish(el),3000))}
 function release(){finish(pressed);pressed=null}
 document.addEventListener('pointerdown',e=>{release();pressed=e.target.closest(selector)||(e.target.closest("label")?.control);if(pressed){pointerTargets.add(pressed);clearTimeout(timers.get(pressed));pressed.classList.remove('focus-finished');pressed.classList.add('temporary-focus','pointer-focus')}},true);
 document.addEventListener('pointerup',release,true);
 document.addEventListener('pointercancel',release,true);
 window.addEventListener('blur',release);
 // Safari may deliver focusin after pointerup; keep the pointer origin until keyboard use.
 document.addEventListener('keydown',()=>{pointerTargets=new WeakSet()},true);
 document.addEventListener('focusin',e=>{if(e.target===pressed)return;if(pointerTargets.has(e.target)){finish(e.target);return}flash(e.target)});
 document.addEventListener('focusout',e=>finish(e.target));
 if(document.activeElement!==document.body)flash(document.activeElement);
})();
