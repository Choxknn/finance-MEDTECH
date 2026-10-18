let meddySpokenKey='';
const meddySpeechFrames=new WeakMap();
function animateMeddyWords(bubble,force=false){
 if(!bubble)return;const target=bubble.querySelector('.meddy-speech-text')||bubble,text=target.textContent,key=(user?.id||'')+'|'+text;
 const previous=meddySpeechFrames.get(bubble);if(previous)cancelAnimationFrame(previous);
 if(!force&&key===meddySpokenKey)return;meddySpokenKey=key;if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const action=bubble.querySelector('[data-meddy-go]');if(action){action.hidden=true;action.classList.remove('meddy-action-ready')}
 const parts=typeof Intl.Segmenter==='function'?[...new Intl.Segmenter('th',{granularity:'grapheme'}).segment(text)].map(x=>x.segment):Array.from(text);
 const accessible=document.createElement('span');accessible.className='sr-only';accessible.textContent=text;
 const visual=document.createElement('span');visual.className='meddy-spoken-text';visual.setAttribute('aria-hidden','true');target.replaceChildren(accessible,visual);
 const delay=Math.min(32,2200/Math.max(parts.length,1));let start,last=-1;
 function tick(now){if(!target.isConnected)return;if(start===undefined)start=now;const count=Math.min(parts.length,1+Math.floor((now-start)/delay));if(count!==last){visual.textContent=parts.slice(0,count).join('');last=count}if(count<parts.length)meddySpeechFrames.set(bubble,requestAnimationFrame(tick));else{meddySpeechFrames.delete(bubble);if(action){action.hidden=false;action.classList.add('meddy-action-ready')}}}
 meddySpeechFrames.set(bubble,requestAnimationFrame(tick));
}
const finishingRender=render;render=function(){finishingRender();if(view!=='dashboard'||!user){meddySpokenKey='';return}animateMeddyWords(document.querySelector('.meddy-bubble'))};
if(user)render();
