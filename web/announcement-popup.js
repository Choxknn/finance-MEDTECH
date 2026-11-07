'use strict';
(()=>{
 const originalCompose=composeMessage;composeMessage=function(kind,webOnly,...rest){if(!webOnly)return originalCompose(kind,webOnly,...rest);modal('สร้างประกาศในเว็บ',`<form id="announcement-compose"><label for="announcement-title">หัวข้อประกาศ</label><input id="announcement-title" name="title" maxlength="120" required><label for="announcement-body">ข้อความ (เว้นว่างได้เมื่อแนบรูป)</label><textarea id="announcement-body" name="body" maxlength="2000" rows="4"></textarea><label class="announcement-upload">${icon('image')||''} รูปประกาศ<input name="image" type="file" accept="image/jpeg,image/png,image/webp"><small>JPG, PNG หรือ WEBP ไม่เกิน 5 MB</small></label><div id="announcement-image-preview"></div><label class="announcement-entry-option"><input name="show_on_entry" type="checkbox"> แสดงประกาศเป็นหน้าต่างเมื่อเข้าเว็บ</label><p class="help">ประกาศถึงสมาชิกทุกคนในเว็บ · ไม่ส่ง LINE</p><div class="actions"><button type="button" class="secondary" data-action="close">ยกเลิก</button><button type="submit">เผยแพร่ประกาศ</button></div><p class="form-error" role="alert"></p></form>`)};
 let previewUrl=null;
 function editAnnouncement(a){
  const currentImage=a.image_url||'',hasImage=!!(a.drive_file_id||currentImage);
  modal('แก้ไขประกาศในเว็บ',`<form id="announcement-edit" data-id="${esc(a.id)}" data-has-image="${hasImage?'true':'false'}" data-current-image="${esc(currentImage)}">
   <label for="announcement-edit-title">หัวข้อประกาศ</label><input id="announcement-edit-title" name="title" maxlength="120" required value="${esc(a.title)}">
   <label for="announcement-edit-body">ข้อความ (เว้นว่างได้เมื่อมีรูปประกาศ)</label><textarea id="announcement-edit-body" name="body" maxlength="2000" rows="4">${esc(a.body||'')}</textarea>
   <div class="announcement-current-image">${currentImage?'<p class="help">รูปประกาศปัจจุบัน</p><img src="'+esc(currentImage)+'" alt="รูปประกาศปัจจุบัน">':hasImage?'<p class="help">มีรูปประกาศเดิมอยู่ · สามารถเก็บรูปเดิมไว้ได้</p>':'<p class="help">ยังไม่มีรูปประกาศ</p>'}</div>
   <label class="announcement-upload">${icon('image')||''} เปลี่ยนรูปประกาศ<input name="image" type="file" accept="image/jpeg,image/png,image/webp"><small>เลือกไฟล์ใหม่เมื่อต้องการแทนรูปเดิม · JPG, PNG หรือ WEBP ไม่เกิน 5 MB</small></label>
   <div id="announcement-image-preview"></div>
   <label class="announcement-entry-option"><input name="show_on_entry" type="checkbox" ${a.show_on_entry?'checked':''}> แสดงประกาศเป็นหน้าต่างเมื่อเข้าเว็บ</label>
   <p class="help">แก้ไขประกาศเดิมให้ผู้รับทุกคนเห็น · ไม่ส่ง LINE</p>
   <div class="actions"><button type="button" class="secondary" data-action="close">ยกเลิก</button><button type="submit">บันทึกการแก้ไข</button></div><p class="form-error" role="alert"></p>
  </form>`);
 }
 function fileDataUrl(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(new Error('อ่านไฟล์รูปไม่สำเร็จ'));reader.readAsDataURL(file)})}
 document.addEventListener('click',e=>{const b=e.target.closest('[data-edit-announcement]');if(!b)return;e.preventDefault();if(user?.role!=='admin'){toast('ไม่มีสิทธิ์');return}const a=(db.announcements||[]).find(row=>row.id===b.dataset.editAnnouncement);if(!a){toast('ไม่พบประกาศนี้แล้ว กรุณาโหลดข้อมูลใหม่');return}editAnnouncement(a)});
 document.addEventListener('change',async e=>{
  const input=e.target,form=input.form;
  if(['announcement-compose','announcement-edit'].includes(form?.id)&&input.name==='image'){
   if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;
   const box=document.getElementById('announcement-image-preview');box.replaceChildren();const file=input.files[0];
   if(file){try{validateFile(file);previewUrl=URL.createObjectURL(file);const img=document.createElement('img');img.src=previewUrl;img.alt='ตัวอย่างรูปประกาศใหม่';box.append(img)}
   catch(err){input.value='';form.querySelector('.form-error').textContent=err.message}}

  }
  if(input.matches('[data-announcement-entry]')){input.disabled=true;try{await api('announcement-entry-setting',{id:input.dataset.announcementEntry,show_on_entry:input.checked});const a=db.announcements.find(a=>a.id===input.dataset.announcementEntry);if(a)a.show_on_entry=input.checked;toast('บันทึกการแสดงประกาศแล้ว')}catch(err){input.checked=!input.checked;toast(err.message)}finally{input.disabled=false}}
 });
 document.getElementById('dialog').addEventListener('close',()=>{if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null});
 window.addEventListener('submit',async e=>{
  const f=e.target;if(!['announcement-compose','announcement-edit'].includes(f.id))return;
  e.preventDefault();e.stopImmediatePropagation();if(f.dataset.saving)return;f.dataset.saving='true';
  const b=f.querySelector('[type=submit]');b.disabled=true;
  try{
   const editing=f.id==='announcement-edit',file=f.elements.image.files[0]||null,title=f.elements.title.value.trim(),body=f.elements.body.value.trim();
   if(file)validateFile(file);
   const existing=editing?(db.announcements||[]).find(a=>a.id===f.dataset.id):null;
   if(editing&&!existing)throw Error('ไม่พบประกาศนี้แล้ว กรุณาโหลดข้อมูลใหม่');
   const hasExistingImage=editing&&(f.dataset.hasImage==='true'||!!existing?.drive_file_id);
   if(!body&&!file&&!hasExistingImage)throw Error('ระบุข้อความหรือแนบรูปประกาศ');
   if(editing){
    const payload={id:f.dataset.id,title,body,show_on_entry:f.elements.show_on_entry.checked};
    if(cfg.mode==='live')await api('edit-announcement',payload,file);
    else{Object.assign(existing,{title,body,show_on_entry:payload.show_on_entry});if(file){existing.image_url=await fileDataUrl(file);existing.drive_file_id='demo'}}
    await refresh();document.getElementById('dialog').close();render();toast('บันทึกการแก้ไขประกาศแล้ว');
   }else{
    await api('publish-announcement',{title,body,show_on_entry:f.elements.show_on_entry.checked},file);
    document.getElementById('dialog').close();await refresh();render();toast('เผยแพร่ประกาศแล้ว');
   }
  }catch(err){f.querySelector('.form-error').textContent=err.message}
  finally{delete f.dataset.saving;b.disabled=false}
 },true);
 const popup=document.createElement('dialog');popup.id='announcement-popup';popup.setAttribute('aria-label','ประกาศจากผู้ดูแล');document.body.append(popup);const seen=new Set();let current=null,locked=false,scheduled=false;
 function showAnnouncement(a){current=a;popup.innerHTML=`<article class="announcement-poster">${a.image_url?`<img class="announcement-poster-image" src="${esc(a.image_url)}" alt="${esc(a.title)}">`:''}<div class="announcement-poster-copy"><small>ประกาศจากผู้ดูแล</small><h2>${esc(a.title)}</h2>${a.body?`<p>${esc(a.body)}</p>`:''}</div></article><button type="button" class="announcement-popup-close">ปิดหน้าต่าง</button>`;popup.querySelector('button').onclick=()=>popup.close();if(!popup.open){locked=!document.querySelector('#dialog[open]');if(locked)lockModalPage();popup.showModal()}}
 function next(){scheduled=false;if(!user||popup.open||document.querySelector('#dialog[open]')||document.hidden)return;const a=(db.announcements||[]).find(a=>a.show_on_entry&&!a.dismissed_at&&!seen.has(user.id+':'+a.id));if(a){seen.add(user.id+':'+a.id);showAnnouncement(a)}}
 function schedule(){if(!scheduled){scheduled=true;setTimeout(next,350)}}
 popup.addEventListener('close',()=>{current=null;if(locked)unlockModalPage();locked=false;schedule()});document.getElementById('dialog').addEventListener('close',schedule);
 document.addEventListener('click',e=>{const b=e.target.closest('[data-open-announcement]');if(b){const a=(db.announcements||[]).find(a=>a.id===b.dataset.openAnnouncement);if(a){seen.add(user.id+':'+a.id);showAnnouncement(a)}}});
 const previousRender=render;render=function(){previousRender();document.querySelectorAll('.announcement-card').forEach((card,i)=>{const a=announcementRows()[i];if(!a)return;if(a.image_url){const img=document.createElement('img');img.src=a.image_url;img.alt=a.title;img.className='announcement-card-image';const button=document.createElement('button');button.type='button';button.className='announcement-image-button';button.dataset.openAnnouncement=a.id;button.append(img);card.querySelector('h3')?.after(button)}if(user?.role==='admin')card.insertAdjacentHTML('beforeend',`<label class="announcement-entry-option"><input type="checkbox" data-announcement-entry="${esc(a.id)}" ${a.show_on_entry?'checked':''}> แสดงเมื่อเข้าเว็บ</label>`)});document.querySelectorAll('[data-announcement-pane]').forEach(pane=>{const a=(db.announcements||[]).find(a=>a.id===pane.dataset.announcementPane);if(a?.image_url)pane.querySelector('h3')?.insertAdjacentHTML('afterend',`<button type="button" class="announcement-image-button" data-open-announcement="${esc(a.id)}"><img class="announcement-banner-image" src="${esc(a.image_url)}" alt="${esc(a.title)}"></button>`)});schedule()};document.addEventListener('visibilitychange',schedule);if(user)render();
})();