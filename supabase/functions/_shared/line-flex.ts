export const financeSite='https://choxknn.github.io/finance-MEDTECH/';
const txt=(text:string,size='sm',color='#334155',extra:any={})=>({type:'text',text:text||' ',size,color,wrap:true,...extra});
const box=(contents:any[],extra:any={})=>({type:'box',layout:'vertical',contents,...extra});
const picture=(kind:string,size='40px')=>({type:'image',url:financeSite+'assets/flex-'+kind+'.png',size,aspectRatio:'1:1',aspectMode:'fit',flex:0});
const iconTile=(kind:string,size='40px')=>box([picture(kind,size)],{backgroundColor:'#FFFFFF',paddingAll:'10px',cornerRadius:'16px',flex:0});
const separator=(color='#E2E8F0')=>({type:'separator',color});
const footer=(label:string,url:string,color:string,secondary=false)=>box([{type:'button',style:secondary?'secondary':'primary',color:secondary?'#EAF0F7':color,height:'sm',action:{type:'uri',label,uri:url}},txt('Finance · MEDTECH','xxs','#94A3B8',{align:'center'})],{paddingAll:'24px',paddingTop:'8px',spacing:'md'});
function noticeFacts(body:string){const lines=body.split('\n');const amount=lines.findIndex(s=>/^(ยอดชำระ:|ยอดค้าง\s)/.test(s));const due=lines.findIndex(s=>/^ครบกำหนด[:\s]/.test(s));return {amount:amount<0?'':lines[amount].replace(/^(ยอดชำระ:|ยอดค้าง)\s*/,''),due:due<0?'':lines[due].replace(/^ครบกำหนด[:\s]+/,''),rest:lines.filter((_,i)=>i!==amount&&i!==due).join('\n')}}
export function financeFlex(title:string,body:string,kind='message',actionUrl=''){
 const labels:Record<string,string>={new_bill:'บิลใหม่',reminder:'เตือนครบกำหนด',correction:'ต้องแก้ไขหลักฐาน',announcement:'ประกาศ',password:'ความปลอดภัยบัญชี',message:'ข้อความถึงคุณ'};
 const k=labels[kind]?kind:'message',heading=(title||labels[k]).slice(0,120),clean=(body||'').replace(/^finance MEDTECH\s*\n?/i,'').trim().slice(0,2000)||'เปิดเว็บเพื่อตรวจสอบรายละเอียด';
 let header:any,content:any,foot:any;
 if(k==='new_bill'){
  const facts=noticeFacts(clean);
  header=box([txt('FINANCE / BILL','xxs','#FFE0E6',{weight:'bold'}),box([txt('บิลใหม่สำหรับคุณ','lg','#FFFFFF',{weight:'bold',flex:1}),txt('฿','xxl','#FFFFFF',{weight:'bold',flex:0})],{layout:'horizontal',alignItems:'center',spacing:'md'})],{paddingAll:'22px',backgroundColor:'#AF2448',spacing:'sm'});
  content=box([txt(heading,'lg','#3E2631',{weight:'bold'}),...(facts.amount?[box([txt('ยอดที่ต้องชำระ','xs','#986573'),txt(facts.amount,'xxl','#AF2448',{weight:'bold'})],{paddingAll:'20px',backgroundColor:'#FFF1F4',cornerRadius:'16px',spacing:'sm'})]:[]),...(facts.due?[box([txt('วันครบกำหนด','xs','#8B6370'),txt(facts.due,'md','#3E2631',{weight:'bold'})],{spacing:'xs'})]:[]),separator('#EDD9DF'),txt(facts.rest||clean,'sm','#735762')],{paddingAll:'24px',spacing:'lg'});
  foot=footer('ดูรายการชำระเงิน',actionUrl||financeSite+'?view=bills','#AF2448');
 }else if(k==='reminder'){
  const facts=noticeFacts(clean);
  header=box([picture('reminder','48px'),box([txt('เตือนกำหนดชำระ','xs','#966318',{weight:'bold'}),txt(heading,'xl','#684213',{weight:'bold'})],{flex:1,spacing:'xs'})],{layout:'horizontal',paddingAll:'24px',spacing:'lg',alignItems:'center',backgroundColor:'#FFF3D8'});
  content=box([...(facts.due?[box([txt('ครบกำหนด','xs','#88652A'),txt(facts.due,'xl','#684213',{weight:'bold'})],{paddingAll:'18px',borderColor:'#E8C684',borderWidth:'1px',cornerRadius:'12px',spacing:'sm'})]:[]),...(facts.amount?[box([txt('ยอดค้างชำระ','sm','#85683C'),txt(facts.amount,'lg','#684213',{weight:'bold'})],{spacing:'sm'})]:[]),txt(facts.rest||clean,'sm','#6D5C41')],{paddingAll:'24px',spacing:'lg'});
  foot=footer('ตรวจสอบยอดและชำระ',actionUrl||financeSite+'?view=bills','#A66B16');
 }else if(k==='correction'){
  header=box([iconTile('correction','30px'),box([txt('ต้องดำเนินการ','xs','#FFFFFF',{weight:'bold'}),txt('แก้ไขหลักฐานการชำระ','md','#FFFFFF',{weight:'bold'})],{flex:1,spacing:'xs'})],{layout:'horizontal',alignItems:'center',spacing:'md',paddingAll:'20px',backgroundColor:'#BB4434'});
  content=box([txt(heading,'xl','#672D27',{weight:'bold'}),box([txt('รายละเอียดจากผู้ตรวจ','xs','#A3493C',{weight:'bold'}),txt(clean,'sm','#773F36')],{paddingAll:'18px',backgroundColor:'#FFF0EB',borderColor:'#EDC4BA',borderWidth:'1px',cornerRadius:'12px',spacing:'md'}),box([txt('1  ตรวจรายละเอียดที่ต้องแก้ไข','sm','#673F38'),txt('2  เปิดรายการและส่งหลักฐานใหม่','sm','#673F38')],{spacing:'sm'})],{paddingAll:'24px',spacing:'lg'});
  foot=footer('แก้ไขและส่งหลักฐาน',actionUrl||financeSite+'?view=bills','#BB4434');
 }else if(k==='announcement'){
  header=box([box([txt('MEDTECH / NOTICE','xxs','#D9CCF9',{weight:'bold',flex:1}),iconTile('announcement','42px')],{layout:'horizontal',alignItems:'center',spacing:'md'}),txt('ประกาศ','sm','#E9DEFF',{weight:'bold'}),txt(heading,'xxl','#FFFFFF',{weight:'bold'})],{paddingAll:'26px',backgroundColor:'#62419A',spacing:'md'});
  content=box([txt(clean,'md','#574A68',{lineSpacing:'7px'})],{paddingAll:'26px',backgroundColor:'#FAF7FF'});
  foot=footer('อ่านประกาศ',actionUrl||financeSite+'?view=notifications','#62419A');
 }else if(k==='password'){
  header=box([txt('ACCOUNT SECURITY','xxs','#A4C5D0',{weight:'bold',align:'center'}),iconTile('password','52px')],{paddingAll:'26px',paddingBottom:'12px',backgroundColor:'#173F50',alignItems:'center',spacing:'lg'});
  content=box([txt(heading,'xl','#FFFFFF',{weight:'bold',align:'center'}),txt(clean,'sm','#D8E8EE',{align:'center',lineSpacing:'6px'}),box([txt('ลิงก์ส่วนตัว · ใช้ได้ครั้งเดียว','xs','#F0D99C',{weight:'bold',align:'center'}),txt('หากไม่ได้ขอเปลี่ยนรหัส สามารถละเว้นข้อความนี้','xs','#AFC9D4',{align:'center'})],{paddingAll:'16px',backgroundColor:'#214D5E',cornerRadius:'12px',spacing:'sm'})],{paddingAll:'24px',backgroundColor:'#173F50',spacing:'lg'});
  foot=footer('ตั้งรหัสผ่านใหม่',actionUrl||financeSite,'#287B85');
 }else{
  header=box([picture('message','42px'),box([txt('ข้อความถึงคุณ','xs','#526C8D',{weight:'bold'}),txt('จากผู้ดูแล MEDTECH','sm','#334E70')],{spacing:'xs',flex:1})],{layout:'horizontal',paddingAll:'24px',paddingBottom:'12px',alignItems:'center',spacing:'md'});
  content=box([txt(heading,'xl','#243C59',{weight:'bold'}),box([txt(clean,'sm','#49627C',{lineSpacing:'6px'})],{paddingAll:'18px',backgroundColor:'#F0F5FC',cornerRadius:'18px'})],{paddingAll:'24px',paddingTop:'12px',spacing:'lg'});
  foot=footer('เปิดอ่านข้อความ',actionUrl||financeSite+'?view=notifications','#476A94',true);
 }
 return {type:'flex',altText:(labels[k]+' · '+heading).slice(0,400),contents:{type:'bubble',size:'mega',styles:{header:{backgroundColor:'#FFFFFF'},body:{backgroundColor:'#FFFFFF'},footer:{backgroundColor:'#FFFFFF'}},header,body:content,footer:foot}};
}
export function automaticTitle(body:string){return /กรุณาแก้ไข/.test(body)?'กรุณาแก้ไขหลักฐาน':/ยอดค้าง/.test(body)?'แจ้งเตือนยอดค้างชำระ':'ข้อความจาก finance MEDTECH'}
