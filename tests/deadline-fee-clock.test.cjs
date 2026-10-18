const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('displayed fee follows time, daily increments, legacy midnight, cap and snapshots',()=>{
 const s=fs.readFileSync('web/bills.js','utf8'),app=fs.readFileSync('web/app.js','utf8'),ctx=vm.createContext({Date,Intl,Math,Number});
 vm.runInContext(app.match(/const billDeadline=.*?;\n/)[0]+s.slice(s.indexOf('function billPenaltyDays'),s.indexOf('const feeRender')),ctx);
 const r={due_date:'2026-10-21',due_time:'15:30:00'},d=Date.parse('2026-10-21T15:30:00+07:00');assert.equal(ctx.billPenaltyDays(r,d),0);assert.equal(ctx.billPenaltyDays(r,d+1),1);assert.equal(ctx.billPenaltyDays(r,d+86400001),2);
 assert.equal(ctx.billPenaltyDays({due_date:r.due_date},Date.parse('2026-10-21T23:59:59+07:00')),0);assert.equal(ctx.billPenaltyDays({due_date:r.due_date},Date.parse('2026-10-22T00:00:00+07:00')),1);
 ctx.db={charges:[{id:'c',amount:100}],payments:[]};ctx.round=()=>({...r,due_date:'2020-01-01',penalty_enabled:true,penalty_per_day:10,penalty_max:25});ctx.paid=()=>0;ctx.updateDisplayedFees();assert.equal(ctx.db.charges[0].fee_amount,25);
 ctx.db.payments=[{charge_id:'c',status:'pending',amount:110,fee_snapshot:10}];ctx.updateDisplayedFees();assert.equal(ctx.db.charges[0].fee_amount,10);
 ctx.db.payments=[];ctx.db.charges[0].fee_settled=5;ctx.paid=()=>105;ctx.updateDisplayedFees();assert.equal(ctx.db.charges[0].fee_amount,5);
});
