'use strict';
/* Deterministic in-memory fixtures for the Offline Sandbox. Nothing is persisted. */
(()=>{
 const now=()=>new Date().toISOString();
 const copy=value=>JSON.parse(JSON.stringify(value));
 const fileDataUrl=file=>new Promise((resolve,reject)=>{if(!file){resolve(null);return}const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(new Error('อ่านไฟล์ตัวอย่างไม่สำเร็จ'));reader.readAsDataURL(file)});
 const products=[
  {id:'sandbox-product-shirt',title:'เสื้อ MEDTECH รุ่นทดลอง',description:'สินค้าตัวอย่างสำหรับทดสอบหน้าร้านและขั้นตอนเลือกสินค้า',price:250,stock:24,active:true,images:[],sale_starts_at:null,sale_ends_at:null,option_groups:[{id:'sandbox-size',name:'ขนาด',required:true,options:[{id:'sandbox-size-s',name:'S',price_delta:0},{id:'sandbox-size-m',name:'M',price_delta:0},{id:'sandbox-size-l',name:'L',price_delta:20}]}]},
  {id:'sandbox-product-mug',title:'แก้ว MEDTECH รุ่นทดลอง',description:'สินค้าตัวอย่างอีกหนึ่งรายการ ใช้ทดสอบการ์ดสินค้าและสต็อก',price:120,stock:12,active:true,images:[],sale_starts_at:null,sale_ends_at:null,option_groups:[]},
  {id:'sandbox-product-closed',title:'สินค้าปิดขายตัวอย่าง',description:'ใช้ทดสอบสถานะปิดการขาย',price:80,stock:0,active:false,images:[],sale_starts_at:null,sale_ends_at:null,option_groups:[]}
 ];
 const orders=[
  {id:'d0000000-0000-4000-8000-000000000001',product_id:'sandbox-product-shirt',profile_id:'u1',product_title:'เสื้อ MEDTECH รุ่นทดลอง',quantity:1,unit_price:250,base_unit_price:250,total:250,selected_options:[{group_id:'sandbox-size',option_id:'sandbox-size-m',group_name:'ขนาด',option_name:'M',price_delta:0}],status:'ready',payment_status:'approved',buyer_name:'ชวิน เมดเทค',student_id:'69010001',created_at:'2026-11-10T03:30:00.000Z',updated_at:'2026-11-10T03:30:00.000Z',note:'ออเดอร์ตัวอย่างที่ชำระแล้ว',scan_token:'sandbox-scan-0001',checkout_draft:false,reservation_expires_at:null,payments:[]},
  {id:'d0000000-0000-4000-8000-000000000002',product_id:'sandbox-product-mug',profile_id:'u2',product_title:'แก้ว MEDTECH รุ่นทดลอง',quantity:2,unit_price:120,base_unit_price:120,total:240,selected_options:[],status:'pending',payment_status:'review',buyer_name:'พิมพ์ชนก ใจดี',student_id:'69010002',created_at:'2026-11-12T05:15:00.000Z',updated_at:'2026-11-12T05:15:00.000Z',note:'ออเดอร์ตัวอย่างรอตรวจสอบ',scan_token:'sandbox-scan-0002',checkout_draft:false,reservation_expires_at:null,payments:[{id:'sandbox-payment-2',status:'review',note:'จำลองการส่งสลิป · ไม่มีไฟล์จริง',created_at:'2026-11-12T05:15:00.000Z'}]}
 ];
 let serial=10;
 const currentUser=()=>{try{return user||null}catch{return null}};
 const orderFor=data=>orders.find(item=>item.id===data?.id||item.scan_token===data?.scan_token);
 function visibleOrders(){
  const active=currentUser();
  return orders.filter(item=>active?.role==='admin'||item.profile_id===active?.id);
 }
 function summary(paidOnly=false){
  const rows=orders.filter(o=>o.status!=='cancelled'&&(!paidOnly||o.payment_status==='approved'));
  return {
   products:products.map(p=>{const items=rows.filter(o=>o.product_id===p.id);return {product_id:p.id,title:p.title,people:new Set(items.map(o=>o.profile_id)).size,quantity:items.reduce((n,o)=>n+Number(o.quantity||0),0),total:items.reduce((n,o)=>n+Number(o.total||0),0)}}).filter(p=>p.people||p.quantity),
   options:[],
   combinations:[]
  };
 }
 function requireProduct(id){const p=products.find(item=>item.id===id);if(!p)throw new Error('ไม่พบสินค้าตัวอย่าง');return p}
 function requireOrder(id){const o=orders.find(item=>item.id===id);if(!o)throw new Error('ไม่พบคำสั่งซื้อตัวอย่าง');return o}
 window.financeOfflineApi=async function(action,data={},file=null){
  const payload=data||{};
  switch(action){
   case 'shop-list': return copy({products,orders:visibleOrders(),checkouts:[]});
   case 'shop-summary': return copy(summary(payload.paid===true));
   case 'shop-get': {
    const order=orderFor(payload);if(!order)throw new Error('ไม่พบคำสั่งซื้อตัวอย่าง');
    return copy({order,payments:order.payments||[]});
   }
   case 'shop-set-active': {
    const p=requireProduct(payload.id);
    if(typeof payload.expected_active==='boolean'&&p.active!==payload.expected_active)throw new Error('ข้อมูลตัวอย่างเปลี่ยนแล้ว กรุณาลองใหม่');
    p.active=!!payload.active;return copy({product:p});
   }
   case 'shop-save': {
    let p=payload.id?requireProduct(payload.id):null;
    if(!p){p={id:'sandbox-product-new-'+(++serial),images:[],option_groups:[]};products.unshift(p)}
    Object.assign(p,{title:String(payload.title||'สินค้าใหม่'),description:String(payload.description||''),price:Number(payload.price)||0,stock:Number(payload.stock)||0,active:!!payload.active,sale_starts_at:payload.sale_starts_at||null,sale_ends_at:payload.sale_ends_at||null,option_groups:copy(payload.option_groups||[])});
    return copy({product:p});
   }
   case 'shop-upload': {
    const product=requireProduct(payload.id);if(!file)return {uploaded:false,simulated:true,message:'ไม่มีไฟล์ตัวอย่าง'};
    const image=await fileDataUrl(file);product.images=product.images||[];product.images.push(image);
    return {uploaded:true,path:image,simulated:true,message:'เก็บรูปไว้ในหน่วยความจำของ Sandbox เท่านั้น'};
   }
   case 'shop-image-remove': {
    const p=requireProduct(payload.id);p.images=(p.images||[]).filter(path=>path!==payload.path);return {removed:true};
   }
   case 'shop-order': {
    const p=requireProduct(payload.product_id),quantity=Math.max(1,Math.trunc(Number(payload.quantity)||1));
    if(!p.active||p.stock<quantity)throw new Error('สินค้าตัวอย่างไม่เปิดขายหรือมีจำนวนไม่พอ');
    const selected_options=(p.option_groups||[]).map(group=>{
     const option=group.options.find(item=>item.id===payload.choices?.[group.id]);
     if(group.required&&!option)throw new Error('กรุณาเลือก'+group.name);
     return option?{group_id:group.id,option_id:option.id,group_name:group.name,option_name:option.name,price_delta:Number(option.price_delta)||0}:null;
    }).filter(Boolean);
    const unit_price=Number(p.price)+selected_options.reduce((n,o)=>n+o.price_delta,0);
    const active=currentUser()||{};
    const order={id:'d0000000-0000-4000-8000-'+String(++serial).padStart(12,'0'),product_id:p.id,profile_id:active.id||'u1',product_title:p.title,quantity,unit_price,base_unit_price:Number(p.price),total:unit_price*quantity,selected_options,status:'pending',payment_status:'unpaid',buyer_name:active.name||'สมาชิกตัวอย่าง',student_id:active.student_id||'69010001',created_at:now(),updated_at:now(),note:String(payload.note||''),scan_token:'sandbox-scan-'+serial,checkout_draft:false,reservation_expires_at:null,payments:[]};
    orders.unshift(order);p.stock-=quantity;return copy({order});
   }
   case 'shop-order-edit': {
    const o=requireOrder(payload.id),patch=payload.patch||{};
    if(patch.quantity!==undefined)o.quantity=Math.max(1,Math.trunc(Number(patch.quantity)||1));
    if(patch.base_unit_price!==undefined)o.base_unit_price=Math.max(0,Number(patch.base_unit_price)||0);
    if(patch.note!==undefined)o.note=String(patch.note);
    if(patch.choices){const p=requireProduct(o.product_id);o.selected_options=(p.option_groups||[]).map(group=>{const option=group.options.find(item=>item.id===patch.choices[group.id]);return option?{group_id:group.id,option_id:option.id,group_name:group.name,option_name:option.name,price_delta:Number(option.price_delta)||0}:null}).filter(Boolean)}
    o.unit_price=Number(o.base_unit_price||o.unit_price)+ (o.selected_options||[]).reduce((n,item)=>n+Number(item.price_delta||0),0);o.total=o.unit_price*o.quantity;o.updated_at=now();return {order:copy(o)};
   }
   case 'shop-status-bulk': {
    for(const id of payload.ids||[])requireOrder(id).status=payload.status;
    return {updated:(payload.ids||[]).length,simulated:true};
   }
   case 'shop-order-delete': {
    const index=orders.findIndex(o=>o.id===payload.id);if(index<0)throw new Error('ไม่พบคำสั่งซื้อตัวอย่าง');
    orders.splice(index,1);return {deleted:true,simulated:true};
   }
   case 'shop-delete': {
    const p=requireProduct(payload.id);p.active=false;products.splice(products.indexOf(p),1);return {deleted:true,simulated:true};
   }
   case 'shop-cancel-checkout': {
    const o=requireOrder(payload.id);o.status='cancelled';return {cancelled:true,simulated:true};
   }
   case 'shop-pay': {
    const o=requireOrder(payload.id);o.payment_status='review';o.updated_at=now();
    o.payments=o.payments||[];o.payments.unshift({id:'sandbox-payment-'+(++serial),status:'review',note:'จำลองการส่งไฟล์สลิป · ไม่มีการอัปโหลดหรือตรวจสอบจริง',created_at:now()});
    return {status:'review',message:'โหมดทดลอง: จำลองการรับสลิปแล้ว ไม่มีการอัปโหลด ตรวจ SlipOK หรือโอนเงินจริง',simulated:true};
   }
   case 'shop-payment-review': {
    const payment=orders.flatMap(o=>(o.payments||[]).map(p=>({order:o,payment:p}))).find(x=>x.payment.id===payload.payment_id);
    if(!payment)throw new Error('ไม่พบสลิปตัวอย่าง');
    payment.payment.status=payload.status;payment.payment.note=String(payload.note||'');payment.order.payment_status=payload.status;return {updated:true,simulated:true};
   }
   case 'shop-payment-retry': return {status:'review',message:'Offline Sandbox ไม่เรียก SlipOK · ใช้ข้อมูลตัวอย่างเท่านั้น',simulated:true};
   case 'shop-evidence': throw new Error('ไม่มีไฟล์หลักฐานจริงใน Offline Sandbox');
   case 'shop-export': {
    const page=Math.max(0,Math.trunc(Number(payload.page)||0));
    return copy({orders:visibleOrders().slice(page*500,(page+1)*500)});
   }
   case 'publish-announcement': {
    let rows=[];try{db.announcements??=[];rows=db.announcements}catch{}
    const row={id:'sandbox-announcement-'+(++serial),title:String(payload.title||'ประกาศตัวอย่าง'),body:String(payload.body||''),show_on_entry:!!payload.show_on_entry,dismissed_at:null,created_at:now(),image_url:await fileDataUrl(file)};
    rows.unshift(row);return copy({announcement:row,simulated:true,message:'เผยแพร่ประกาศจำลองแล้ว'});
   }
   case 'edit-announcement': {
    let rows=[];try{rows=db.announcements||[]}catch{}
    const row=rows.find(item=>item.id===payload.id);if(!row)throw new Error('ไม่พบประกาศตัวอย่าง');
    Object.assign(row,{title:String(payload.title||row.title),body:String(payload.body||''),show_on_entry:!!payload.show_on_entry});
    if(file)row.image_url=await fileDataUrl(file);return copy({announcement:row,simulated:true});
   }
   case 'delete-announcement': {
    try{db.announcements=(db.announcements||[]).filter(item=>item.id!==payload.id)}catch{}
    return {deleted:true,simulated:true};
   }
   case 'dismiss-announcement': {
    try{const row=(db.announcements||[]).find(item=>item.id===payload.id);if(row)row.dismissed_at=now()}catch{}
    return {dismissed:true,simulated:true};
   }
   case 'announcements-list': {
    let rows=[];try{rows=db.announcements||[]}catch{}
    return copy({announcements:rows});
   }
   case 'announcement-entry-setting': {
    let rows=[];try{rows=db.announcements||[]}catch{}
    const item=rows.find(row=>row.id===payload.id);if(item)item.show_on_entry=!!payload.show_on_entry;
    return {updated:!!item,simulated:true};
   }
   case 'read-notification': {
    try{const row=(db.notifications||[]).find(item=>item.id===payload.id);if(row)row.seen_at=now()}catch{}
    return {updated:true,simulated:true};
   }
   default: throw new Error('Offline Sandbox ปิดคำสั่ง "'+action+'" ไว้ เพราะไม่มีตัวจำลองและจะไม่ส่งคำขอไปยังระบบจริง');
  }
 };
})();