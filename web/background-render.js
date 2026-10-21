// Refresh data without replaying page entrance effects or losing reading position.
function renderInBackground(){
 const x=window.scrollX,y=window.scrollY;
 const positions=[...document.querySelectorAll('#app *')].filter(el=>el.scrollTop||el.scrollLeft).map(el=>({id:el.id,cls:el.className,top:el.scrollTop,left:el.scrollLeft}));
 const details=[...document.querySelectorAll('#app details')].map(el=>({text:el.querySelector('summary')?.textContent,open:el.open}));
 const stage=document.querySelector('.meddy-stage');
 render();
 const nextStage=document.querySelector('.meddy-stage');if(stage&&nextStage)nextStage.replaceWith(stage);
 document.querySelectorAll('#app details').forEach(el=>{const saved=details.find(d=>d.text===el.querySelector('summary')?.textContent);if(saved)el.open=saved.open});
 // Finish only finite entry animations. Keep mascot, overdue pulses and festival loops.
 document.querySelectorAll('#app *').forEach(el=>{if(!el.getAnimations)return;for(const animation of el.getAnimations()){if(animation.effect?.getTiming().iterations!==Infinity){try{animation.finish()}catch{}}}});
 for(const saved of positions){const el=saved.id?document.getElementById(saved.id):[...document.querySelectorAll('#app *')].find(el=>el.className===saved.cls);if(el){el.scrollTop=saved.top;el.scrollLeft=saved.left}}
 window.scrollTo({top:y,left:x,behavior:'instant'});
}
