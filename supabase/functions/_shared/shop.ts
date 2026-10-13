import {shopPaymentAction} from './shop-payment.ts';
import {query,validateImage} from './services.ts';
export async function shopAction(db:any,profile:any,input:any,file:File|null){
 const admin=profile.role==='admin',action=input.action;
 if(!action.startsWith('shop-'))return null;
 if(['shop-pay','shop-payment-retry','shop-payment-review','shop-evidence'].includes(action))return shopPaymentAction(db,profile,input,file);
 const requireAdmin=()=>{if(!admin)throw Error('เฉพาะผู้ดูแลระบบ')};
 if(action==='shop-list'){
  let products=db.from('shop_products').select('*').is('deleted_at',null).order('created_at',{ascending:false});if(!admin)products=products.eq('active',true);
  let orders=db.from('shop_orders').select('*').is('deleted_at',null).order('created_at',{ascending:false}).order('id');if(!admin)orders=orders.eq('profile_id',profile.id);
  const rows=await query(orders.range(0,999));return {products:await query(products),orders:rows.filter((o:any)=>!o.checkout_draft),checkouts:rows.filter((o:any)=>o.checkout_draft)};
 }
 if(action==='shop-export'){requireAdmin();const page=Number(input.page)||0;if(!Number.isInteger(page)||page<0)throw Error('หน้าไม่ถูกต้อง');return {orders:await query(db.from('shop_orders').select('*').is('deleted_at',null).eq('checkout_draft',false).order('created_at',{ascending:false}).order('id').range(page*500,page*500+499))}}
 if(action==='shop-cancel-checkout'){await query(db.rpc('cancel_shop_checkout',{p_id:input.id,p_profile:profile.id}));return {ok:true}}
 if(action==='shop-order')return {order:await query(db.rpc('place_shop_order',{p_id:input.request_id,p_profile:profile.id,p_product:input.product_id,p_quantity:Number(input.quantity),p_note:String(input.note||''),p_choices:input.choices||{}}))};
 if(action==='shop-get'){
  let q=db.from('shop_orders').select('*').is('deleted_at',null);q=input.scan_token?q.eq('scan_token',input.scan_token):q.eq('id',input.id);if(!admin)q=q.eq('profile_id',profile.id);
  const order=await query(q.single());const payments=await query(db.from('shop_payments').select('id,amount,status,note,drive_file_id,created_at,reviewed_at').eq('order_id',order.id).order('created_at',{ascending:false}));return {order,payments};
 }
 requireAdmin();
 if(action==='shop-upload'){
  const product=await query(db.from('shop_products').select('id,images').eq('id',input.id).is('deleted_at',null).single());if(product.images.length>=8)throw Error('เพิ่มรูปได้สูงสุด 8 รูป');
  const image=await validateImage(file),path=product.id+'/'+crypto.randomUUID()+'.'+({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[image.type]||'jpg');
  await query(db.storage.from('shop-products').upload(path,image,{contentType:image.type,upsert:false}));
  try{await query(db.from('shop_products').update({images:[...product.images,path]}).eq('id',product.id))}catch(e){await db.storage.from('shop-products').remove([path]);throw e}return {ok:true};
 }
 if(action==='shop-image-remove'){
  const p=await query(db.from('shop_products').select('id,images').eq('id',input.id).single());if(!p.images.includes(input.path))throw Error('ไม่พบรูป');await query(db.from('shop_products').update({images:p.images.filter((x:string)=>x!==input.path)}).eq('id',p.id));await query(db.storage.from('shop-products').remove([input.path]));return {ok:true};
 }
 if(action==='shop-save'){
  const title=String(input.title||'').trim(),price=Number(input.price),stock=Number(input.stock),description=String(input.description||'');
  if(!title||title.length>120||!Number.isFinite(price)||price<0||price>9999999||!Number.isInteger(stock)||stock<0||stock>1000000||description.length>4000)throw Error('ตรวจสอบชื่อ ราคา จำนวนสินค้า และรายละเอียด');
  const priorGroups=input.option_groups===undefined&&input.id?(await query(db.from('shop_products').select('option_groups').eq('id',input.id).single())).option_groups:[];
  const option_groups=validateShopGroups(input.option_groups??priorGroups);
  const record={option_groups,title,price:Math.round(price*100)/100,stock,description,active:input.active===true};
  return {product:await query(input.id?db.from('shop_products').update(record).eq('id',input.id).is('deleted_at',null).select().single():db.from('shop_products').insert(record).select().single())};
 }
 if(action==='shop-delete'){const p=await query(db.from('shop_products').select('images').eq('id',input.id).single());await query(db.from('shop_products').update({deleted_at:new Date().toISOString(),active:false}).eq('id',input.id));if(p.images.length){await query(db.storage.from('shop-products').remove(p.images));await query(db.from('shop_products').update({images:[]}).eq('id',input.id))}return {ok:true}}
 if(action==='shop-status'){await query(db.rpc('bulk_shop_status',{p_ids:[input.id],p_status:input.status,p_actor:profile.id}));return {ok:true}}
 if(action==='shop-status-bulk'){if(!Array.isArray(input.ids)||!input.ids.length||input.ids.length>1000)throw Error('เลือก 1–1000 รายการ');return {count:await query(db.rpc('bulk_shop_status',{p_ids:input.ids,p_status:input.status,p_actor:profile.id}))}}
 if(action==='shop-order-edit'||action==='shop-order-delete'){await query(db.rpc('manage_shop_order',{p_id:input.id,p_patch:input.patch||{},p_delete:action==='shop-order-delete',p_expected:input.expected,p_actor:profile.id}));return {ok:true}}
 if(action==='shop-summary')return await query(db.rpc('shop_sales_summary',{p_paid:input.paid===true}));
 throw Error('ไม่พบคำสั่งร้านค้า');
}

function validateShopGroups(value:any){
 if(!Array.isArray(value)||value.length>12)throw Error('เพิ่มหมวดตัวเลือกได้สูงสุด 12 หมวด');const groups=new Set();
 return value.map((g:any)=>{const id=String(g.id||''),name=String(g.name||'').trim();if(!/^[a-zA-Z0-9-]{1,64}$/.test(id)||groups.has(id)||!name||name.length>80||!Array.isArray(g.options)||!g.options.length||g.options.length>50)throw Error('ตรวจสอบหมวดตัวเลือก และเพิ่มอย่างน้อย 1 ตัวเลือกต่อหมวด');groups.add(id);const choices=new Set();
 return {id,name,required:g.required!==false,options:g.options.map((o:any)=>{const id=String(o.id||''),name=String(o.name||'').trim(),price_delta=Number(o.price_delta||0);if(!Number.isFinite(price_delta)||price_delta<0||price_delta>1000000||Math.abs(price_delta*100-Math.round(price_delta*100))>0.00001)throw Error('ราคาบวกของตัวเลือกต้องเป็น 0–1,000,000 บาท และไม่เกิน 2 ตำแหน่ง');if(!/^[a-zA-Z0-9-]{1,64}$/.test(id)||choices.has(id)||!name||name.length>80)throw Error('ชื่อตัวเลือกไม่ถูกต้องหรือซ้ำ');choices.add(id);return {id,name,price_delta}})}
 });
}
