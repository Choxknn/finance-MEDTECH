import {query,validateImage,checkSlip,isRecentSlip,slipRejectionReason,discardRejectedSlip,uploadDrive,readEvidence,secret} from './services.ts';
export async function verifyShopSlip(db:any,payment:any,order:any,image:File){
 let result:any;try{const settings=await query(db.from('site_settings').select('data').eq('id',true).single());result=await checkSlip(image,Number(payment.amount),String(settings.data.accountNumber||''))}
 catch{await query(db.rpc('decide_shop_payment',{p_id:payment.id,p_status:'review',p_ref:null,p_note:'เชื่อมต่อระบบตรวจสลิปไม่สำเร็จ รอผู้ดูแลตรวจสอบ',p_verification:null}));return {status:'review',message:'รับหลักฐานแล้ว รอผู้ดูแลตรวจสอบ'}}
 const detail=result.body.data;
 const rawDate=String(detail?.transDate||''),rawTime=String(detail?.transTime||'');
 const timestamp=detail?.transTimestamp||(/^\d{8}$/.test(rawDate)&&/^\d{2}:\d{2}:\d{2}$/.test(rawTime)?`${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}T${rawTime}+07:00`:'');
 const validDate=isRecentSlip({...detail,transTimestamp:timestamp},order.created_at);
 let status='review',note=String(result.body.message||'ระบบยังยืนยันไม่ได้ รอผู้ดูแลตรวจสอบ');
 const rejection=slipRejectionReason(result.body);
 if(rejection){status='rejected';note=rejection}
 else if(result.ok&&validDate){status='approved';note='ตรวจสอบผ่าน SlipOK'}
 else if((result.ok||timestamp)&&!validDate){status='rejected';note='สลิปต้องเป็นการโอนหลังสั่งซื้อ และไม่เกิน 48 ชั่วโมง'}
 else if((Number.isFinite(Number(detail?.amount))&&Math.round(Number(detail.amount)*100)!==Math.round(Number(payment.amount)*100))||String(result.body.code)==='1013'){status='rejected';note='ยอดโอนไม่ตรงกับคำสั่งซื้อ กรุณาตรวจสอบยอดและอัปโหลดใหม่'}
 else if(String(result.body.code)==='1011'){status='rejected';note='ไม่พบรายการโอนหรือ QR บนสลิปหมดอายุ กรุณาใช้สลิปที่ถูกต้อง'}
 else if(String(result.body.code)==='1012'){status='rejected';note='สลิปนี้เคยใช้แล้ว กรุณาใช้สลิปที่ถูกต้อง'}
 try{await query(db.rpc('decide_shop_payment',{p_id:payment.id,p_status:status,p_ref:status==='approved'?String(detail.transRef):null,p_note:note,p_verification:result.body}))}
 catch(e){if(status!=='approved'||!/ซ้ำ/.test(String(e)))throw e;status='rejected';note='สลิปนี้เคยใช้ชำระบิลหรือคำสั่งซื้อแล้ว';await query(db.rpc('decide_shop_payment',{p_id:payment.id,p_status:status,p_ref:null,p_note:note,p_verification:result.body}))}
 if(status==='rejected')await discardRejectedSlip(db,'shop_payments',payment.id);
 return {status,message:status==='approved'?'ชำระคำสั่งซื้อสำเร็จ':note};
}
export async function shopPaymentAction(db:any,profile:any,input:any,file:File|null){
 const admin=profile.role==='admin';
 if(input.action==='shop-pay'){
  const image=await validateImage(file);for(const k of ['SLIPOK_BRANCH_ID','SLIPOK_API_KEY'])secret(k);
  const order=await query(db.from('shop_orders').select('*').eq('id',input.id).eq('profile_id',profile.id).is('deleted_at',null).single());
  const pid=await query(db.rpc('reserve_shop_payment',{p_order:order.id,p_profile:profile.id}));
  try{const stored=await uploadDrive(image,'shop-slip-'+pid);await query(db.from('shop_payments').update({drive_file_id:stored}).eq('id',pid))}
  catch{await query(db.rpc('decide_shop_payment',{p_id:pid,p_status:'rejected',p_ref:null,p_note:'บันทึกหลักฐานไม่สำเร็จ กรุณาส่งใหม่',p_verification:null}));throw Error('บันทึกหลักฐานไม่สำเร็จ กรุณาส่งใหม่')}
  return verifyShopSlip(db,{id:pid,amount:order.total},order,image);
 }
 if(['shop-payment-retry','shop-payment-review','shop-evidence'].includes(input.action)){
  const payment=await query(db.from('shop_payments').select('*').eq('id',input.payment_id).single());
  const order=await query(db.from('shop_orders').select('*').eq('id',payment.order_id).is('deleted_at',null).single());
  if(!admin&&order.profile_id!==profile.id)throw Error('ไม่มีสิทธิ์เข้าถึง');
  if(input.action==='shop-evidence'){
   if(!payment.drive_file_id?.startsWith('sb:'))throw Error('ยังไม่มีหลักฐาน');const path=payment.drive_file_id.slice(3);
   const f=await query(db.from('evidence_files').select('state').eq('path',path).single());if(f.state!=='active')throw Error('หลักฐานถูกลบแล้ว');return await query(db.storage.from('finance-evidence').createSignedUrl(path,120));
  }
  if(!admin)throw Error('เฉพาะผู้ดูแลระบบ');
  if(!['pending','review'].includes(payment.status))throw Error('รายการนี้ตรวจเสร็จแล้ว');
  if(input.action==='shop-payment-review'){
   if(!['approved','rejected'].includes(input.status)||!String(input.note||'').trim())throw Error('ระบุผลตรวจและหมายเหตุ');
   await query(db.rpc('decide_shop_payment',{p_id:payment.id,p_status:input.status,p_ref:input.status==='approved'?(payment.verification?.data?.transRef||'ADMIN-SHOP-'+payment.id):null,p_note:'ผู้ดูแลตรวจ: '+String(input.note).slice(0,500),p_verification:null}));
   if(input.status==='rejected')await discardRejectedSlip(db,'shop_payments',payment.id);
   if(input.status==='approved')await query(db.from('audit').insert({actor:profile.name,action:'ตรวจชำระร้านค้า '+payment.id+' '+input.status}));return {status:input.status,message:'บันทึกผลตรวจแล้ว'};
  }
  const response=await readEvidence(payment.drive_file_id),blob=await response.blob();return verifyShopSlip(db,payment,order,await validateImage(new File([blob],'slip',{type:blob.type})));
 }
 return null;
}
