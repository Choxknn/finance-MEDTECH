const fs=require('node:fs');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const root=require('node:path').resolve(__dirname,'..');
const dom=new JSDOM('<div id="app"></div><dialog id="dialog"></dialog><div id="toast"></div>',{url:'https://example.test',runScripts:'outside-only'});
const w=dom.window;
w.FINANCE_CONFIG={mode:'demo',bankName:'พร้อมเพย์',accountName:'ทดสอบ',accountNumber:'001',paymentQrUrl:'./payment-qr.png',lineOaUrl:'https://lin.ee/test'};
w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
w.HTMLDialogElement.prototype.close=function(){this.open=false};
const context=dom.getInternalVMContext(),vm=require('node:vm');
vm.runInContext(fs.readFileSync(root+'/web/app.js','utf8'),context);
vm.runInContext(fs.readFileSync(root+'/web/management.js','utf8'),context);
vm.runInContext(fs.readFileSync(root+'/web/records.js','utf8'),context);
const run=s=>vm.runInContext(s,context);
run("demoLogin('admin')");
for(const view of ['dashboard','members','rounds','fund','reports','audit','settings','review']){
 run(`nav('${view}')`);assert.ok(w.document.querySelector('h1'),view+' renders');assert.ok(!w.document.body.textContent.includes('undefined'),view+' has no undefined labels');
}
run("editRecord('member','u1')");assert.equal(w.document.querySelector('[name=name]').value,'ชวิน เมดเทค');assert.equal(w.document.querySelector('[name=active]').value,'true');
for(const [kind,id] of [['round','r1'],['expense','e1'],['payment','p1'],['charge','c1']]){run(`editRecord('${kind}','${id}')`);assert.equal(w.document.querySelector('#record-edit').dataset.entity,kind)}
const csv='\ufeffstudent_id,name,year,password\r\n00670111,"ชื่อ, ทดสอบ",1,abcdefghijkl\r\n';
const parsed=run(`csvMembers(${JSON.stringify(csv)})`);assert.equal(parsed[0].student_id,'00670111');assert.equal(parsed[0].name,'ชื่อ, ทดสอบ');
assert.throws(()=>run("csvMembers('student_id,name,year,password\\n670111,ชื่อ,1,short')"));
assert.throws(()=>run(`csvMembers(${JSON.stringify(csv+ '00670111,ชื่อซ้ำ,1,abcdefghijkl\r\n')})`));
assert.throws(()=>run("parseCsv('a,\"unclosed')"));
assert.equal(run("monthKey('2026-09-30T18:00:00Z')"),'2026-10');
run("reportMonth='2026-09'");assert.equal(run('reportData().income'),300);assert.equal(run('reportData().expense'),120);
run("db.expenses[0].voided=true");assert.equal(run('reportData().expense'),0);
run("db.rounds[0].archived=true;demoLogin('member');nav('bills')");assert.ok(w.document.body.textContent.includes('ปิดรับชำระ'));assert.ok(!w.document.querySelector('[data-pay=c1]'));
run("db.profiles[0].name='<img src=x onerror=alert(1)>';render()");assert.ok(!w.document.querySelector('img[onerror]'));
run("nav('fund')");assert.ok(!w.document.body.textContent.includes('ซื้ออุปกรณ์ส่วนกลาง'));
assert.equal(run('db.expenses.length'),1,'hidden expense history retained');
(async()=>{
 run("demoLogin('admin');editRecord('member','u1')");
 w.document.querySelector('[name=name]').value='ชื่อที่แก้ไข';
 w.document.querySelector('#record-edit').requestSubmit();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(run("db.profiles[0].name"),'ชื่อที่แก้ไข','member form saves');
 assert.ok(run("db.audit[0].details.before.name")!==run("db.audit[0].details.after.name"),'before/after audit');
 run("editRecord('round','r3')");
 w.document.querySelector('[name=amount]').value='99';
 w.document.querySelector('#record-edit').requestSubmit();
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(w.document.querySelector('.form-error').textContent,/มีการชำระ/);
 assert.equal(run("db.rounds[2].amount"),150,'paid amount remains unchanged');
 console.log('Management screens and forms, CSV, escaping, Bangkok monthly boundaries, financial guards and audit checks passed');
 w.close();
})().catch(e=>{console.error(e);process.exitCode=1;w.close()});
