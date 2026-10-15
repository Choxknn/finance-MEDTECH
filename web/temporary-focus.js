'use strict';
(()=>{
 const selector='button,a,input,select,textarea,[tabindex]',timers=new WeakMap();let pressed=null;
 function finish(el){if(!el)return;clearTimeout(timers.get(el));el.classList.remove('temporary-focus','pointer-focus');el.classList.add('focus-finished')}
 function flash(el){if(!el?.matches?.(selector))return;clearTimeout(timers.get(el));el.classList.remove('focus-finished','pointer-focus');el.classList.add('temporary-focus');timers.set(el,setTimeout(()=>finish(el),3000))}
 function release(){finish(pressed);pressed=null}
 document.addEventListener('pointerdown',e=>{release();pressed=e.target.closest(selector);if(pressed){clearTimeout(timers.get(pressed));pressed.classList.remove('focus-finished');pressed.classList.add('temporary-focus','pointer-focus')}},true);
 document.addEventListener('pointerup',release,true);
 document.addEventListener('pointercancel',release,true);
 window.addEventListener('blur',release);
 document.addEventListener('focusin',e=>{if(e.target!==pressed)flash(e.target)});
 document.addEventListener('focusout',e=>finish(e.target));
 if(document.activeElement!==document.body)flash(document.activeElement);
})();
