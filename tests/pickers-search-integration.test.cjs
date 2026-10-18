const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const tick=()=>new Promise(resolve=>setTimeout(resolve,50));
function app(){
 const dom=new JSDOM(fs.readFileSync('web/index.html','utf8'),{url:'https://finance.test',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,d=w.document,context=dom.getInternalVMContext(),run=source=>vm.runInContext(source,context),errors=[],observers=[];
 const OriginalObserver=w.MutationObserver;w.MutationObserver=class extends OriginalObserver{constructor(callback){super(callback);observers.push(this)}};
 w.FINANCE_CONFIG={mode:'demo'};w.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
 w.scrollTo=()=>{};w.Element.prototype.scrollIntoView=()=>{};w.Element.prototype.scrollTo=()=>{};w.Element.prototype.animate=()=>({cancel(){}});
 w.confirm=()=>true;w.fetch=async()=>{throw Error('Unexpected network request')};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};
 w.addEventListener('error',e=>errors.push(e.message));
 for(const tag of d.querySelectorAll('script[src]')){const name=tag.getAttribute('src').split('?')[0].replace('./','');if(name!=='config.js')run(fs.readFileSync('web/'+name,'utf8'))}
 return {w,d,run,errors,async close(){await tick();w.dispatchEvent(new w.Event('pagehide'));observers.forEach(o=>o.disconnect());await tick();w.close()}};
}
test('actual extension chain: month/year/day navigation, native form values and parent dialog survive',async()=>{
 const a=app();try{await tick();a.run("demoLogin('admin');newRound()");await tick();const {d,w}=a;
 const input=d.querySelector('[name=due_date]');input.value='2026-10-16';input.dispatchEvent(new w.Event('change',{bubbles:true}));await tick();
 d.querySelector('[name=due_date]').parentElement.querySelector('.finance-picker-trigger').click();
 const popup=d.querySelector('.finance-picker-popup');assert.equal(popup.tagName,'DIALOG');assert(popup.open);assert.equal(popup.parentElement.id,'dialog');
 const next=popup.querySelector('[aria-label="ถัดไป"]');next.focus();next.click();next.click();assert.equal(popup.querySelector('[aria-label="เลือกเดือน"]').textContent,'ธันวาคม');
 assert.equal(d.activeElement,next,'navigation keeps the focused button instead of removing it');
 popup.querySelector('[aria-label="เลือกปี"]').click();assert(popup.querySelector('.picker-years'));assert(popup.querySelectorAll('.picker-years button').length>100,'years can scroll');
 popup.querySelector('[aria-label="ปี 2570"]').click();[...popup.querySelectorAll('.picker-months button')].find(b=>b.textContent==='กุมภาพันธ์').click();
 popup.querySelector('[aria-label="7 กุมภาพันธ์ 2570"]').click();assert.equal(input.value,'2027-02-07');assert.equal(new w.FormData(d.querySelector('#bill-create')).get('due_date'),'2027-02-07');
 assert(!d.querySelector('.finance-picker-popup'));assert(d.querySelector('#dialog').open);assert(d.documentElement.classList.contains('modal-page-open'));
 input.parentElement.querySelector('.finance-picker-trigger').click();d.querySelector('#dialog').close();await tick();assert(!d.querySelector('.finance-picker-popup'),'parent close removes picker');
 assert.deepEqual(a.errors,[]);
 }finally{await a.close()}
});
test('admin search covers new domains, notes and all results; sidebar removal keeps shop tabs',async()=>{
 const a=app();try{await tick();a.run("demoLogin('admin')");
 a.run(`db.prepared_members=[{id:'invite',student_id:'6701110999999',first_name:'รอสมัครทดสอบ',last_name:'สมาชิก',name_prefix:'นาย',year:1}];
 db.incomes=[{id:'income-note',title:'ค่าเสื้อ',amount:10,note:'หมายเหตุทดสอบ <script>bad()</script>',category:'เสื้อรุ่น',received_on:'2026-10-17'}];
 adminSearchCache.products=[{id:'product',title:'เสื้อทดสอบค้นหา',price:150,stock:4,active:true,option_groups:[{name:'ขนาด',options:[{name:'ไซซ์พิเศษ'}]}]}];
 adminSearchCache.orders=[{id:'order-search',product_title:'เสื้อทดสอบค้นหา',buyer_name:'สมชาย',student_id:'6701110999999',total:150,status:'ready',payment_status:'approved'}];
 adminSearchCache.sessions=[{id:'session',title:'เช็คชื่อห้องปฏิบัติการ',held_on:'2026-10-17',active:true}];
 db.profiles.push(...Array.from({length:55},(_,i)=>({id:'search-'+i,student_id:'670123'+i,name:'สมาชิกจำนวนมาก '+i,role:'member'})));render();`);
 assert(!a.d.querySelector('.sidebar [data-view=shop-orders]'));
 for(const [query,kind] of [['ไซซ์พิเศษ','สินค้า'],['พร้อมรับสินค้า','คำสั่งซื้อ'],['รอสมัครทดสอบ','สมาชิกที่รอสมัคร'],['ห้องปฏิบัติการ','เช็คชื่อ'],['หมายเหตุทดสอบ','รายรับ'],['เสื้อรุ่น','หมวดหมู่การเงิน']]){
  const input=a.d.querySelector('#admin-global-search');input.value=query;a.run('updateAdminSearch(false)');assert(a.run('adminSearchRows').some(r=>r.kind===kind),query);
 }
 a.d.querySelector('#admin-global-search').value='สมาชิกจำนวนมาก';a.run('updateAdminSearch(false)');assert.equal(a.run('adminSearchRows.length'),55);assert.equal(a.d.querySelectorAll('[data-search-result]').length,40);a.d.querySelector('[data-search-more]').click();assert.equal(a.d.querySelectorAll('[data-search-result]').length,55);
 assert.equal(a.run("adminSearchNormalize('๖๗๐๑๑๑')"),'670111');
 a.run("nav('fund')");const note=a.d.querySelector('.mp-fund-note');assert(note);assert.equal(note.textContent,'หมายเหตุทดสอบ <script>bad()</script>');assert(!note.querySelector('script'));assert(note.previousElementSibling.classList.contains('mp-record-title'));
 assert(a.run('shopTabs()').includes('data-view="shop-orders"'));
 a.run("user=null;db=null;render()");assert.equal(a.run('adminSearchCache.products.length'),0,'logout clears private search cache');assert.equal(a.run('adminSearchRows.length'),0);
 assert.deepEqual(a.errors,[]);
 }finally{await a.close()}
});
test('background search does not publish results from a previous admin session',async()=>{
 const dom=new JSDOM('<input id="admin-global-search"><div id="admin-search-results"></div>',{runScripts:'outside-only'}),w=dom.window,c=dom.getInternalVMContext(),run=s=>vm.runInContext(s,c);const resolvers=[];
 Object.assign(w,{icons:{},user:{id:'admin-1',role:'admin'},cfg:{mode:'live'},render(){},nav(){},operationsApi:()=>new Promise(r=>{resolvers.push(r)})});
 // Exercise the session-scoped loader in isolation, with independent delayed reads.
 run(fs.readFileSync('web/navigation-upgrade.js','utf8').split('function adminSearchIndex(){')[0]);
 const pending=run('loadAdminSearchExtras()');w.user={id:'admin-2',role:'admin'};run('adminSearchScope()');resolvers[0]({products:[{id:'private-old-product'}],orders:[]});resolvers[1]({sessions:[{id:'private-old-session'}]});
 await pending;assert.equal(run('adminSearchCache.sessions.length'),0);assert.equal(run('adminSearchCache.owner'),'admin-2');assert.equal(run('adminSearchCache.products.length'),0);w.close();
});
test('individual bill detail previews only that bill and does not send without confirmation',async()=>{
 const a=app();try{await tick();a.run("demoLogin('admin');db.profiles.find(p=>p.id==='u1').line_linked=true;openIndividualBills('u1')");
 a.d.querySelector('[data-individual-id="c1"]>summary').click();const b=a.d.querySelector('#dialog [data-individual-remind="c1"]');assert(b);assert(!b.disabled);b.click();await tick();
 const form=a.d.querySelector('#due-reminder-send');assert(form);assert.equal(form.dataset.profileId,'u1');assert.equal(form.querySelectorAll('[name=charge_ids]:checked').length,1);assert.equal(form.querySelector('[name=charge_ids]').value,'c1');assert.match(form.textContent,/ยืนยันส่ง LINE/);
 a.run("db.profiles.find(p=>p.id==='u1').line_linked=false");assert.match(a.run("individualReminderReason(db.charges.find(c=>c.id==='c1'))"),/เชื่อม LINE/);
 assert.deepEqual(a.errors,[]);
 }finally{await a.close()}
});
