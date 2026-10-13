'use strict';
// Presentation-only extension. Financial totals and permissions stay in the existing application.
const materialAmount=n=>Number(n||0).toLocaleString('th-TH',{maximumFractionDigits:2});
function materialDay(at=new Date()){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at);return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-')}
function materialBillState(at=new Date()){
 const today=materialDay(at),tomorrow=materialDay(new Date(at.getTime()+86400000));
 const all=(db.charges||[]).filter(c=>!c.deleted_at&&(user.role==='admin'||c.profile_id===user.id));
 const active=all.filter(c=>{const r=round(c.round_id);return !r.archived&&!r.deleted_at});
 const unpaid=active.filter(c=>balance(c)>0&&!hasPending(c)).sort((a,b)=>String(round(a.round_id).due_date||'9999').localeCompare(String(round(b.round_id).due_date||'9999'))||String(a.id).localeCompare(String(b.id)));
 const overdue=unpaid.filter(c=>round(c.round_id).due_date&&round(c.round_id).due_date<today);
 const pending=(db.payments||[]).filter(p=>!p.deleted_at&&['pending','review'].includes(p.status)&&(user.role==='admin'||p.profile_id===user.id));
 const base={overdue,overdueAmount:overdue.reduce((n,c)=>n+balance(c),0),today};
 if(user.role==='admin'){
  if(pending.length)return {...base,mood:'review',text:`มีสลิปรอตรวจ ${pending.length} รายการนะ มาช่วยดูแลเพื่อน ๆ ให้เรียบร้อยกัน`,label:'เปิดรายการรอตรวจ',destination:'review'};
  if(overdue.length)return {...base,mood:'overdue',text:`มีบิลเกินกำหนด ${overdue.length} รายการ รวม ฿${money(base.overdueAmount)} ลองเข้าไปติดตามรายคนกันนะ`,label:'จัดการบิลรายบุคคล',destination:'individual-bills'};
  return {...base,mood:'calm',text:'ตอนนี้ไม่มีสลิปรอตรวจหรือบิลเกินกำหนดแล้ว ขอบคุณที่ช่วยดูแลการเงินของพวกเรานะ',label:'ดูรายการบิล',destination:'rounds'};
 }
 if(overdue.length){const c=overdue[0];return {...base,mood:'overdue',chargeId:c.id,text:`บิลนี้เลยกำหนดแล้วนะ 🥺 ตอนนี้รวม ${materialAmount(balance(c))} บาท${overdue.length>1?' และมีบิลเกินกำหนดทั้งหมด '+overdue.length+' รายการ':''} ถ้าติดปัญหา ให้ผู้ดูแลช่วยได้เลย`,label:'ดูบิลเกินกำหนด',destination:'bills'}}
 const rejected=unpaid.find(c=>{const ps=db.payments.filter(p=>p.charge_id===c.id&&!p.deleted_at).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));return ps[0]?.status==='rejected'});
 if(rejected)return {...base,mood:'rejected',chargeId:rejected.id,text:'มีสลิปที่ต้องแก้ไขนะ 📷 เข้าไปดูเหตุผลและส่งหลักฐานใหม่ได้เลย ถ้าโอนแล้ว ไม่ต้องโอนซ้ำนะ',label:'ดูบิลที่ต้องแก้ไข',destination:'bills'};
 const soon=unpaid.find(c=>{const due=round(c.round_id).due_date;return due&&due<=tomorrow});
 if(soon)return {...base,mood:'soon',chargeId:soon.id,text:`แวะมาเตือนเบา ๆ 🔔 บิล ${materialAmount(balance(soon))} บาทครบกำหนด${round(soon.round_id).due_date===today?'วันนี้':'พรุ่งนี้'}แล้วนะ พร้อมให้เราพาไปชำระไหม?`,label:'ดูบิลใกล้ครบกำหนด',destination:'bills'};
 if(unpaid.length){const c=unpaid[0],due=round(c.round_id).due_date,days=due?Math.max(0,Math.round((Date.parse(due)-Date.parse(today))/86400000)):null;return {...base,mood:'open',chargeId:c.id,text:`ฮัลโหล${user.name?' '+user.name.split(' ')[0]:''}! 💗 มีบิล ${materialAmount(balance(c))} บาทรออยู่นะ ${days!==null?'ยังมีเวลาอีก '+days+' วัน ':''}ค่อย ๆ เตรียมตัวได้เลย`,label:'ไปดูบิล · ฿'+materialAmount(balance(c)),destination:'bills'}};
 if(pending.length)return {...base,mood:'review',chargeId:pending.find(p=>all.some(c=>c.id===p.charge_id))?.charge_id,text:`ได้รับสลิปแล้ว! 📨 ${pending.length} รายการกำลังรอตรวจสอบอยู่นะ ยังไม่ต้องโอนซ้ำ เดี๋ยวผลจะอัปเดตที่นี่`,label:'ติดตามผลตรวจสลิป',destination:'history'};
 if(all.length&&all.every(c=>balance(c)===0))return {...base,mood:'paid',text:'เย้! ชำระเรียบร้อยครบแล้ว 🎉 ขอบคุณที่ช่วยดูแลส่วนกลางนะ วันนี้สบายใจได้เลย!',label:'ดูประวัติและหลักฐาน',destination:'history'};
 return {...base,mood:'calm',text:'ตอนนี้ไม่มีบิลที่เปิดรอให้ชำระนะ ถ้ามีรายการใหม่ เราจะช่วยบอกตรงนี้เอง',label:'ดูรายการบิล',destination:'bills'};
}
const materialPaused=false; // Motion follows the device accessibility preference.
let materialScope='',materialDismissed=new Set(),materialAlertKey='';
function materialMascotSvg(mood){return MATERIAL_MASCOT_SVG.replace('id="material-mouth" d="M72 91q8 10 16 0"',`id="material-mouth" d="${mood==='paid'?'M69 89q11 19 22 0Z':['overdue','rejected'].includes(mood)?'M73 96q7-6 14 0':mood==='review'?'M76 93h8':'M72 91q8 10 16 0'}"`).replace('fill="none" stroke="#7c3c52" stroke-width="3"',`fill="${mood==='paid'?'#7c3c52':'none'}" stroke="#7c3c52" stroke-width="3"`).replace('id="material-worry" visibility="hidden"',`id="material-worry" visibility="${['overdue','rejected'].includes(mood)?'visible':'hidden'}"`).replace('id="material-stars" visibility="hidden"',`id="material-stars" visibility="${mood==='paid'?'visible':'hidden'}"`)}
// Keep the selected reply through quiet data refreshes, but reset when its bill changes.
let materialConversation={key:'',question:''};
function materialChatKey(s){const c=(db.charges||[]).find(c=>c.id===s.chargeId);return JSON.stringify([user.id,user.role,s.mood,s.chargeId,s.today,s.text,c&&balance(c),c&&round(c.round_id).due_date,c?.fee_amount]);}
function materialReply(s,question){
 const c=(db.charges||[]).find(c=>c.id===s.chargeId&&(user.role==='admin'||c.profile_id===user.id)),r=c?round(c.round_id):null;
 if(user.role==='admin'){
  if(question==='amount')return s.overdue.length?`มีบิลเกินกำหนด ${s.overdue.length} รายการ รวม ${materialAmount(s.overdueAmount)} บาทนะ 💗 เปิดจัดการบิลรายบุคคลเพื่อติดตามได้เลย`:'ตอนนี้ไม่มีบิลเกินกำหนดนะ 💚 ดูยอดรวมได้ในการ์ดสรุปด้านล่าง';
  if(question==='date')return 'เปิดรายการบิลเพื่อดูวันครบกำหนดของแต่ละรายการได้เลยนะ 💌';
  return s.mood==='review'?'กด “เปิดรายการรอตรวจ” เพื่อดูหลักฐานและตรวจสอบทีละรายการได้เลย 📩':'กดปุ่มด้านล่างเพื่อดูและจัดการบิลของสมาชิกได้เลย เราอยู่ช่วยตรงนี้นะ 💗';
 }
 if(question==='amount'){
  if(s.mood==='paid')return 'ตอนนี้ไม่มียอดค้างแล้วนะ ชำระครบทุกบิลแล้ว 💚 ดูหลักฐานในประวัติได้เลย';
  if(s.mood==='review'){const ps=(db.payments||[]).filter(p=>p.profile_id===user.id&&!p.deleted_at&&['pending','review'].includes(p.status)&&(!c||p.charge_id===c.id));return `ส่งสลิปแล้ว${ps.length?' ยอด '+materialAmount(ps.reduce((n,p)=>n+Number(p.amount||0),0))+' บาท':''} กำลังรอตรวจ ไม่ต้องโอนซ้ำนะ 💜`;}
  if(c)return `ยอดบิลนี้ ${materialAmount(balance(c))} บาท${Number(c.fee_amount)>0?' รวมค่าปรับ '+materialAmount(c.fee_amount)+' บาท':''} นะ 💗${s.mood==='rejected'?' ถ้าโอนแล้ว ส่งหลักฐานใหม่ได้เลย ไม่ต้องโอนซ้ำ':''}`;
  return 'ตอนนี้ไม่มีบิลที่เปิดรอให้ชำระนะ 💚 ถ้ามีรายการใหม่ เราจะช่วยบอกตรงนี้เอง';
 }
 if(question==='date'){
  if(s.mood==='paid')return 'ชำระครบแล้ว ไม่มีบิลค้างให้กังวลนะ 💚 วันเวลาที่แจ้งชำระและสลิปอยู่ในหน้าประวัติ';
  if(!r?.due_date)return 'ตอนนี้ยังไม่มีวันครบกำหนดของบิลที่เปิดอยู่ ถ้ามีรายการใหม่ เราจะช่วยเตือนนะ 💌';
  return `บิล “${r.title}” ครบกำหนด ${date(r.due_date)} 💌${s.mood==='review'?' ส่งหลักฐานแล้ว รอผลตรวจได้เลย ไม่ต้องโอนซ้ำนะ':s.mood==='overdue'?' เลยกำหนดแล้ว กดดูรายละเอียดเพื่อจัดการต่อได้เลย':''}`;
 }
 const replies={open:'พร้อมเมื่อไหร่ กดปุ่มด้านล่างเพื่อไปชำระบิลได้เลยนะ เราจะอยู่เป็นเพื่อนตรงนี้ 💗',soon:'ชำระก่อนครบกำหนดจะได้ไม่ต้องกังวลทีหลัง กดปุ่มด้านล่างให้เราพาไปได้เลย 🔔',overdue:'กดดูบิลเกินกำหนดเพื่อตรวจยอดและชำระได้เลย ถ้าติดปัญหา ติดต่อผู้ดูแลให้ช่วยได้นะ 🥺',review:'ตอนนี้รอผลตรวจได้เลย ไม่ต้องโอนหรือส่งสลิปซ้ำนะ เราจะอัปเดตสถานะให้เมื่อมีผล 💜',paid:'ดูหลักฐานในประวัติได้เลย หรือพักผ่อนให้เต็มที่ เราไม่มีบิลค้างแล้ว! 🎉',rejected:'กดดูบิลที่ต้องแก้ไข อ่านเหตุผล แล้วแนบสลิปที่เห็นยอดเงินและวันเวลาชัด ๆ ได้เลย 📷',calm:'พักได้เลยนะ ตอนนี้ยังไม่มีบิลที่เปิดรอชำระ ดูรายการบิลหรือประวัติได้จากเมนู 💗'};
 return replies[s.mood]||s.text;
}
function materialSay(s,question=''){
 materialConversation={key:materialChatKey(s),question};
 const bubble=document.querySelector('.meddy-bubble');if(!bubble)return;
 bubble.textContent=question?materialReply(s,question):s.mood==='paid'?'ไฮไฟฟ์! 🙌 วันนี้ไม่มีบิลค้างแล้ว ขอบคุณนะ':s.text;
 if(typeof animateMeddyWords==='function')animateMeddyWords(bubble,true);
 bubble.classList.remove('chat-arrive');void bubble.offsetWidth;bubble.classList.add('chat-arrive');
 document.querySelectorAll('[data-meddy-question]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.meddyQuestion===question)));
}
function materialHero(s){
 const key=materialChatKey(s);if(materialConversation.key!==key)materialConversation={key,question:''};
 const questions=user.role==='admin'?[]:[['amount','ต้องจ่ายเท่าไหร่?'],['date','ครบกำหนดเมื่อไหร่?'],['next','ทำยังไงต่อ?']];
 return `<section class="meddy-hero meddy-${s.mood}" aria-label="สถานะบิลของคุณ"><div class="meddy-layout"><div class="meddy-stage"><div class="meddy-shadow" aria-hidden="true"></div><button type="button" class="meddy-character" data-meddy-wave aria-label="ทักทายน้องเม็ดเลือด">${materialMascotSvg(s.mood)}</button><span class="meddy-spark" aria-hidden="true">✦</span></div><div class="meddy-talk"><p class="meddy-name">MEDDY · ${user.role==='admin'?'เพื่อนช่วยดูแลการเงิน':'เพื่อนดูแลบิลของคุณ'}</p><div class="meddy-bubble" role="status" aria-live="polite" aria-atomic="true">${esc(materialConversation.question?materialReply(s,materialConversation.question):s.text)}</div>${user.role==='admin'?'':`<div class="quick-replies" role="group" aria-label="คุยกับน้องเม็ดเลือด">${questions.map(([q,label])=>`<button type="button" data-meddy-question="${q}" aria-pressed="${materialConversation.question===q}">${label}</button>`).join('')}</div><button type="button" class="meddy-link" data-meddy-go>${esc(s.label)} ${icon('arrow')}</button>`}</div></div></section>`;
}
function materialProfileMenu(){return `<div class="material-profile-menu" id="material-profile-menu" role="menu" aria-label="เมนูโปรไฟล์" hidden><div class="material-profile-heading"><strong>${esc(user.name)}</strong><small>${esc(user.student_id)} · ${user.role==='admin'?'ผู้ดูแลระบบ':'นักศึกษา'}</small></div><button role="menuitem" data-material-profile="profile">${icon('person')}<span>ข้อมูลโปรไฟล์</span></button><button role="menuitem" data-material-profile="line">${icon('chat')}<span>บัญชี LINE</span></button><button role="menuitem" data-material-profile="password">${icon('key')}<span>เปลี่ยนรหัสผ่าน</span></button><button role="menuitem" class="material-profile-logout" data-material-profile="logout">${icon('logout')}<span>ออกจากระบบ</span></button></div>`}
Object.assign(icons,{arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',chat:'<path d="M4 4h16v13H9l-5 4Z M8 8h8M8 12h5"/>',spark:'<path d="m12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z"/>'});
function materialApply(){
 document.body.classList.toggle('material-motion-paused',materialPaused);
 if(!user){document.querySelectorAll('.clay-sculpture').forEach(e=>e.remove());materialScope='';materialDismissed.clear();return}
 if(materialScope!==user.id+'|'+user.role){materialScope=user.id+'|'+user.role;materialDismissed.clear()}
 const layout=document.querySelector('.layout');if(!layout)return;
 const box=layout.querySelector('.topbar .user');
 if(box){const avatar=box.querySelector('.avatar');if(avatar){avatar.removeAttribute('data-view');avatar.dataset.materialProfileToggle='';avatar.setAttribute('aria-label','เปิดเมนูโปรไฟล์');avatar.setAttribute('aria-expanded','false');avatar.setAttribute('aria-haspopup','menu');avatar.setAttribute('aria-controls','material-profile-menu');avatar.title='เมนูโปรไฟล์'}const name=box.querySelector('div');if(name){const trigger=document.createElement('button');trigger.className='material-profile-name';trigger.dataset.materialProfileToggle='';trigger.setAttribute('aria-label','เปิดเมนูโปรไฟล์');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-haspopup','menu');trigger.setAttribute('aria-controls','material-profile-menu');trigger.innerHTML=name.innerHTML+'<span class="material-chevron" aria-hidden="true">⌄</span>';name.replaceWith(trigger)}box.insertAdjacentHTML('beforeend',materialProfileMenu())}
 // Remove only decorative clay sculptures; retain functional wrappers and established actions.
 layout.querySelectorAll('.clay-sculpture').forEach(e=>e.remove());
 const s=materialBillState();
 if(view==='dashboard'){
  const heading=layout.querySelector('main .page-head');if(heading){heading.classList.add('material-dashboard-heading');heading.insertAdjacentHTML('beforebegin',materialHero(s));}
 }
 materialAlertKey=user.id+'|'+s.today+'|'+s.overdue.map(c=>c.id+':'+Math.round(balance(c)*100)).sort().join(',');
}
function materialToggleProfile(open){const menu=document.getElementById('material-profile-menu');if(!menu)return;menu.hidden=!open;document.querySelectorAll('[data-material-profile-toggle]').forEach(b=>b.setAttribute('aria-expanded',String(open)))}
const materialRender=render;render=function(){const menu=document.getElementById('material-profile-menu'),keepOpen=!!menu&&!menu.hidden,owner=user?.id,oldView=view,scrollTop=menu?.scrollTop||0;materialRender();materialApply();if(keepOpen&&user?.id===owner&&view===oldView){materialToggleProfile(true);const next=document.getElementById('material-profile-menu');if(next)next.scrollTop=scrollTop}};
function materialOpenCharge(id){nav('bills');const c=db.charges.find(c=>c.id===id&&c.profile_id===user.id);if(!c)return;const card=[...document.querySelectorAll('[data-clay-bill]')].find(e=>e.dataset.clayBill===id);if(card){card.querySelector('summary')?.click();return}const holder=document.createElement('div');holder.innerHTML=billRow(c);modal(round(c.round_id).title,holder.querySelector('.clay-bill-body')?.innerHTML||holder.innerHTML)}
function materialFollow(overdue=false){const s=materialBillState();materialToggleProfile(false);if(user.role==='admin'){if(overdue||s.destination==='individual-bills'){openIndividualBills();return}nav(s.destination);return}const id=overdue?s.overdue[0]?.id:s.chargeId;if(id){materialOpenCharge(id);return}nav(s.destination)}
document.addEventListener('click',e=>{
 const button=e.target.closest('button');if(!button)return;
 if(button.hasAttribute('data-material-profile-toggle')){e.preventDefault();e.stopImmediatePropagation();materialToggleProfile(document.getElementById('material-profile-menu')?.hidden);return}
 if(button.dataset.materialProfile){e.preventDefault();e.stopImmediatePropagation();const action=button.dataset.materialProfile;materialToggleProfile(false);if(action==='logout'){logoutSession();return}if(action==='password'){nav('profile');document.querySelector('[data-action="password"]')?.click();return}nav('profile');if(action==='line')document.querySelector('.line-account-status')?.scrollIntoView({behavior:materialPaused?'instant':'smooth',block:'center'});return}
 if(button.hasAttribute('data-meddy-go')||button.hasAttribute('data-meddy-overdue')){e.preventDefault();e.stopImmediatePropagation();materialFollow(button.hasAttribute('data-meddy-overdue'));return}
 if(button.hasAttribute('data-meddy-dismiss')){materialDismissed.add(materialAlertKey);document.querySelector('.meddy-overdue[role=status]')?.remove();return}
 if(button.dataset.meddyQuestion){e.preventDefault();e.stopImmediatePropagation();materialSay(materialBillState(),button.dataset.meddyQuestion);return}
 if(button.hasAttribute('data-meddy-wave')){materialSay(materialBillState());const svg=button.querySelector('svg');if(!materialPaused&&!matchMedia('(prefers-reduced-motion: reduce)').matches)svg?.animate?.([{transform:'rotate(-8deg)'},{transform:'rotate(8deg)'},{transform:'rotate(0)'}],{duration:450});}
},true);
document.addEventListener('click',e=>{if(!e.target.closest('.topbar .user'))materialToggleProfile(false)});
document.addEventListener('keydown',e=>{const menu=document.getElementById('material-profile-menu');if(!menu)return;if(e.key==='Escape'&&!menu.hidden){materialToggleProfile(false);document.querySelector('[data-material-profile-toggle]')?.focus();return}if(e.target.closest?.('.topbar .user')&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();materialToggleProfile(true);const buttons=[...menu.querySelectorAll('button')];let i=buttons.indexOf(document.activeElement);i=e.key==='Home'?0:e.key==='End'?buttons.length-1:i<0?(e.key==='ArrowDown'?0:buttons.length-1):(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[i]?.focus()}});
document.addEventListener('focusin',e=>{if(!e.target.closest?.('.topbar .user'))materialToggleProfile(false)});

const MATERIAL_MASCOT_SVG="<svg class=\"meddy-svg\"  viewBox=\"0 0 160 170\" aria-hidden=\"true\"  ><defs><radialGradient id=\"meddy-cell-color\" cx=\"35%\" cy=\"28%\" r=\"80%\"><stop stop-color=\"#f36e88\"></stop><stop offset=\".65\" stop-color=\"#df3f66\"></stop><stop offset=\"1\" stop-color=\"#bd254c\"></stop></radialGradient></defs><g><path d=\"M49 137q-12 14 3 15q13 0 16-10\" fill=\"#b02a4b\"></path><path d=\"M94 142q4 14 18 9q8-4-4-14\" fill=\"#b02a4b\"></path><path d=\"M33 100q-25 1-19 18q3 10 13 2l12-13\" fill=\"#f17492\"></path><g class=\"arm-r\"><path d=\"M125 103q16-19 22-12q8 11-13 23\" fill=\"#f17492\"></path><path d=\"m143 92 1-8m3 8 5-6\" stroke=\"#f17492\" stroke-width=\"5\" stroke-linecap=\"round\"></path></g><path d=\"M80 24C116 22 139 48 138 85c-1 39-18 60-56 60S24 123 24 87C24 50 43 26 80 24Z\" fill=\"url(#meddy-cell-color)\"></path><ellipse cx=\"80\" cy=\"78\" rx=\"39\" ry=\"37\" fill=\"#ffe6eb\" opacity=\".94\"></ellipse><path d=\"M41 56q6-13 20-18\" fill=\"none\" stroke=\"#ffc1d0\" stroke-width=\"7\" stroke-linecap=\"round\" opacity=\".6\"></path><g class=\"eye-pair\"><ellipse cx=\"65\" cy=\"76\" rx=\"4\" ry=\"6\" fill=\"#612f43\"></ellipse><ellipse cx=\"96\" cy=\"76\" rx=\"4\" ry=\"6\" fill=\"#612f43\"></ellipse></g><ellipse cx=\"53\" cy=\"89\" rx=\"8\" ry=\"4\" fill=\"#f6a9bc\"></ellipse><ellipse cx=\"106\" cy=\"89\" rx=\"8\" ry=\"4\" fill=\"#f6a9bc\"></ellipse><path id=\"material-mouth\" d=\"M72 91q8 10 16 0\" fill=\"none\" stroke=\"#7c3c52\" stroke-width=\"3\" stroke-linecap=\"round\"></path><g id=\"material-worry\" visibility=\"hidden\"><path d=\"m59 62 11-3m21 0 11 3\" fill=\"none\" stroke=\"#7c3c52\" stroke-width=\"2.5\" stroke-linecap=\"round\"></path><path d=\"M121 47q-8 10 0 12q8-2 0-12\" fill=\"#bce0ed\"></path></g><g id=\"material-stars\" visibility=\"hidden\" fill=\"#eab75d\"><path d=\"m14 40 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z\"></path><path d=\"m139 28 2 5 6 1-4 4 1 5-5-2-5 2 1-5-4-4 6-1Z\"></path></g></g></svg>";
if(user)render();else materialApply();

// Move pupils independently of the existing blink animation.
(()=>{
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 let frame=0,point=null;
 function draw(){frame=0;document.querySelectorAll('.meddy-svg').forEach(svg=>{
  const rect=svg.getBoundingClientRect();let dx=0,dy=0;
  if(point&&!reduced.matches&&rect.width){const x=point.x-(rect.left+rect.width/2),y=point.y-(rect.top+rect.height*76/170),distance=Math.max(100,Math.hypot(x,y));dx=x/distance*3.5;dy=y/distance*2.5}
  svg.querySelectorAll('.eye-pair ellipse').forEach((eye,i)=>{eye.setAttribute('cx',String((i===0?65:96)+dx));eye.setAttribute('cy',String(76+dy))});
 })}
 function schedule(){if(!frame)frame=requestAnimationFrame(draw)}
 document.addEventListener('pointermove',e=>{if(e.pointerType!=='mouse'||reduced.matches)return;point={x:e.clientX,y:e.clientY};schedule()},{passive:true});
 function reset(){point=null;schedule()}
 document.documentElement.addEventListener('pointerleave',reset);window.addEventListener('blur',reset);reduced.addEventListener('change',reset);
})();
