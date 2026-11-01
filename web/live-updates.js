'use strict';
let financeLiveClient=null,financeLiveScope='',financeLiveToken='',financeLiveTimer=null,financeLiveBusy=false,financeLivePending=false,financeLiveShopPending=false,financeLiveShopChannel=null;
function financeLiveBlocked(){return document.hidden||document.querySelector('dialog[open],.finance-picker-popup')||busyJobs.size||document.activeElement?.matches('input,select,textarea,[contenteditable=true]')||document.querySelector('#material-profile-menu:not([hidden])')}
function scheduleFinanceLiveFlush(){if(!financeLiveTimer)financeLiveTimer=setTimeout(flushFinanceLive,350)}
function financeLiveResource(message){return message?.payload?.resource||message?.resource||''}
function financeLiveIsShopResource(message){return ['shop_products','shop_orders','shop_payments'].includes(financeLiveResource(message))}
function queueFinanceLive(message){if(message&&financeLiveIsShopResource(message))return;financeLivePending=true;scheduleFinanceLiveFlush()}
function queueFinanceShop(){if(!user||!view.startsWith('shop')||document.hidden)return;financeLiveShopPending=true;scheduleFinanceLiveFlush()}
window.queueFinanceShopRefresh=queueFinanceShop;
async function flushFinanceLive(){
 financeLiveTimer=null;
 if(!user||cfg.mode!=='live'||document.hidden)return;
 if(financeLiveBusy||backgroundRefreshRunning||financeLiveBlocked())return;
 const owner=user.id,screen=view,doApp=financeLivePending,doShop=financeLiveShopPending&&screen.startsWith('shop');
 financeLiveShopPending=false;
 if(!doApp&&!doShop)return;
 financeLivePending=false;financeLiveBusy=true;
 try{
  let result=null,shop=null,summary=null,attendance=null;
  if(doApp)result=await api('bootstrap');
  if(doShop){
   shop=await api('shop-list');
   if(screen==='shop-summary'&&user.role==='admin')summary=await api('shop-summary',{paid:shopPaidOnly});
  }
  if(doApp&&screen==='attendance'&&user.role==='admin')attendance=await api('attendance-list',{session_id:attendanceSession||undefined});
  if(user?.id!==owner||(doShop&&!view.startsWith('shop')))return;
  if(financeLiveBlocked()){
   if(doApp)financeLivePending=true;
   if(doShop)financeLiveShopPending=true;
   return;
  }
  const stable=x=>JSON.stringify(x,(k,v)=>k==='last_seen_at'?undefined:v);
  let changed=false;
  if(result){
   changed=stable(db)!==stable(result.data)||stable(user)!==stable(result.profile);
   db=result.data;user=result.profile;
   for(const key of settingKeys)if(typeof db.settings?.[key]==='string')cfg[key]=db.settings[key];
  }
  if(shop){
   if(stable(shopData)!==stable(shop))changed=true;
   shopData=shop;shopLoaded=true;shopOwner=owner;db.shop_orders=shop.orders||[];
   shopSelected=new Set([...shopSelected].filter(id=>(shop.orders||[]).some(o=>o.id===id)));
   if(summary){if(stable(shopSummary)!==stable(summary))changed=true;shopSummary=summary}
  }
  if(attendance){if(stable(attendanceData)!==stable(attendance))changed=true;attendanceData=attendance;attendanceSession=attendance.selected||'';attendanceLoaded=true}
  if(changed)renderInBackground();
 }catch{
  if(doApp)financeLivePending=true;
  if(doShop&&view.startsWith('shop'))financeLiveShopPending=true;
 }finally{
  financeLiveBusy=false;
  if(financeLivePending||(financeLiveShopPending&&view.startsWith('shop')))scheduleFinanceLiveFlush();
 }
}
function stopFinanceLive(){
 if(financeLiveClient){financeLiveClient.removeAllChannels();financeLiveClient.realtime.disconnect()}
 financeLiveClient=null;financeLiveScope='';financeLiveToken='';financeLiveShopChannel=null;
 window.financeShopRealtimeReady=false;
 clearTimeout(financeLiveTimer);financeLiveTimer=null;
 financeLivePending=false;financeLiveShopPending=false;
}
function syncFinanceShopChannel(client){
 const should=!!user&&cfg.mode==='live'&&!document.hidden&&view.startsWith('shop');
 if(!should){
  if(financeLiveShopChannel){const channel=financeLiveShopChannel;financeLiveShopChannel=null;window.financeShopRealtimeReady=false;void client.removeChannel(channel)}
  financeLiveShopPending=false;
  return;
 }
 if(financeLiveShopChannel)return;
 const refreshAfterSubscribe=shopLoaded&&shopOwner===user.id;
 const channel=client.channel('finance:shop',{config:{private:true}})
  .on('broadcast',{event:'changed'},message=>{if(financeLiveIsShopResource(message))queueFinanceShop()})
  .subscribe(status=>{
   if(financeLiveShopChannel!==channel)return;
   if(status==='SUBSCRIBED'){
    window.financeShopRealtimeReady=true;
    if(refreshAfterSubscribe)queueFinanceShop();
   }
   if(status==='CLOSED'||status==='CHANNEL_ERROR'||status==='TIMED_OUT')window.financeShopRealtimeReady=false;
  });
 financeLiveShopChannel=channel;
}
async function syncFinanceLive(){
 if(!user||cfg.mode!=='live'||document.hidden){stopFinanceLive();return}
 const scope=user.id+'|'+user.role;
 try{
  await ensureLiveSession();
  if(!user||scope!==user.id+'|'+user.role)return;
  if(financeLiveScope===scope&&financeLiveClient){
   if(financeLiveToken!==token){financeLiveToken=token;await financeLiveClient.realtime.setAuth(token)}
   syncFinanceShopChannel(financeLiveClient);
   return;
  }
  stopFinanceLive();
  if(!window.supabase?.createClient)return;
  financeLiveScope=scope;financeLiveToken=token;
  const client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},accessToken:async()=>token});
  financeLiveClient=client;
  await client.realtime.setAuth(token);
  if(financeLiveClient!==client)return;
  const onAppChange=message=>{if(!financeLiveIsShopResource(message))queueFinanceLive(message)};
  for(const topic of ['finance:shared',user.role==='admin'?'finance:admin':'finance:user:'+user.id]){
   client.channel(topic,{config:{private:true}}).on('broadcast',{event:'changed'},onAppChange).subscribe(status=>{if(status==='SUBSCRIBED')queueFinanceLive()});
  }
  syncFinanceShopChannel(client);
 }catch{/* Reconnect on browser online/visibility changes; no periodic data polling. */}
}
const liveRender=render;render=function(){liveRender();queueMicrotask(syncFinanceLive)};
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopFinanceLive();else syncFinanceLive()});
window.addEventListener('online',()=>{syncFinanceLive();queueFinanceLive();if(view.startsWith('shop'))queueFinanceShop()});
window.addEventListener('pagehide',stopFinanceLive);
window.addEventListener('pageshow',()=>{if(!document.hidden)syncFinanceLive()});
document.getElementById('dialog').addEventListener('close',()=>{if(financeLivePending||financeLiveShopPending)scheduleFinanceLiveFlush()});
document.addEventListener('focusout',()=>{if(financeLivePending||financeLiveShopPending)scheduleFinanceLiveFlush()});
syncFinanceLive();
