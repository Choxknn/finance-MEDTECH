const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');

const source=fs.readFileSync(require('node:path').resolve(__dirname,'../web/navigation-upgrade.js'),'utf8');
const dom=new JSDOM('<div class="material-shell"><header class="topbar"><div class="user"></div></header></div>',{
 url:'https://example.test',runScripts:'outside-only'
});
const w=dom.window;
const context=dom.getInternalVMContext();
context.user=null;
context.cfg={mode:'demo'};
context.db={};
context.icons={};
context.icon=()=>'<svg aria-hidden="true"></svg>';
context.render=()=>{};
context.nav=()=>{};
vm.runInContext(source,context,{filename:'navigation-upgrade.js'});

(async()=>{
 context.user={id:'admin-test',role:'admin'};
 vm.runInContext('installNavigationUpgrade()',context);
 const top=w.document.querySelector('.topbar');
 const field=top.querySelector('.admin-search-field');
 const button=field.querySelector('.admin-camera-button');
 assert.ok(button,'admin search installs one QR camera button');
 assert.equal(top.querySelectorAll('.admin-camera-button').length,1);

 let mutationCount=0;
 const observer=new w.MutationObserver(records=>{mutationCount+=records.length});
 observer.observe(top,{childList:true,subtree:true});
 for(let i=0;i<5;i++)vm.runInContext('adminSearchKeepSingleCamera(document.querySelector(".topbar"))',context);
 await new Promise(resolve=>setTimeout(resolve,80));
 observer.disconnect();

 assert.equal(mutationCount,0,'rechecking an unchanged camera button must not mutate the header');
 assert.equal(top.querySelectorAll('.admin-camera-button').length,1,'repeated checks keep exactly one camera button');
 console.log('Admin search QR observer remains stable without self-triggering mutation loops');
 w.close();
})().catch(error=>{console.error(error);w.close();process.exitCode=1});
