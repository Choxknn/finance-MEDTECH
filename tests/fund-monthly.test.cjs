const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),esbuild=require('esbuild');
const src=fs.readFileSync('supabase/functions/finance-api/index.ts','utf8');
const helper=src.slice(src.indexOf('function fundMonthly('),src.indexOf('const text='));
const ctx={};vm.createContext(ctx);vm.runInContext(esbuild.transformSync(helper,{loader:'ts'}).code,ctx);
const rows=JSON.parse(JSON.stringify(ctx.fundMonthly([
 {status:'approved',amount:10.1,created_at:'2026-09-30T18:00:00Z'},
 {status:'approved',amount:0.2,created_at:'2026-10-01'},
 {status:'pending',amount:999,created_at:'2026-10-01'},
 {status:'approved',amount:999,created_at:'2026-10-01',deleted_at:'x'}
],[{amount:4,received_on:'2026-09-30'},{amount:999,received_on:'2026-10-01',workflow_status:'pending'}],[{amount:3,spent_on:'2026-10-01'},{amount:999,spent_on:'2026-10-01',voided:true}],new Date('2026-10-11T00:00:00Z'))));
assert.equal(rows.length,6);assert.equal(rows[0].month,'2026-05');assert.deepEqual(rows[4],{month:'2026-09',income:4,expense:0});assert.deepEqual(rows[5],{month:'2026-10',income:10.3,expense:3});
console.log('Monthly chart: Bangkok boundaries, cents, settled-only totals and deleted/voided exclusion passed');
