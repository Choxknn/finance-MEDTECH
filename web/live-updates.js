'use strict';
let financeLiveClient=null,financeLiveScope='',financeLiveToken='',financeLiveTimer=null,financeAnnouncementUrlTimer=null,financeLiveBusy=false,financeLivePending=false,financeLiveDeferredApp=false,financeAnnouncementPending=false,financeLiveShopPending=false,financeLiveShopChannel=null;
function financeLiveBlocked(){return document.hidden||document.querySelector('dialog[open],.finance-picker-popup')||busyJobs.size||document.activeElement?.matches('input,select,textarea,[contenteditable=true]')||document.querySelector('#material-profile-menu:not([hidden])')}
function scheduleFinanceLiveFlush(){if(!financeLiveTimer)financeLiveTimer=setTimeout(flushFinanceLive,350)}
function scheduleFinanceAnnouncementUrlRefresh(){
 clearTimeout(financeAnnouncementUrlTimer);financeAnnouncementUrlTimer=null;
 if(!user||cfg.mode!=='live')return;
 const expiries=(db.announcements||[]).map(item=>Date.parse(item.image_url_expires_at||'')).filter(value=>Number.isFinite(value));
 if(!expiries.length)return;
 const wait=Math.max(1000,Math.min(...expiries)-Date.now()-5*60*1000);
 financeAnnouncementUrlTimer=setTimeout(()=>{financeAnnouncementPending=true;scheduleFinanceLiveFlush()},wait);
}
function financeLiveResource(message){return message?.payload?.resource||message?.resource||''}
function financeLiveIsShopResource(message){return ['shop_products','shop_orders','shop_payments'].includes(financeLiveResource(message))}
function queueFinanceLive(message){
 if(message&&financeLiveIsShopResource(message))return;
 const resource=financeLiveResource(message);
 if(!resource){financeLivePending=true;financeAnnouncementPending=true}
 else if(resource==='web_announcements'||resource==='web_announcement_recipients')financeAnnouncementPending=true;
 else financeLivePending=true;
 scheduleFinanceLiveFlush();
}
function queueFinanceShop(){if(!user||document.hidden)return;financeLiveShopPending=true;scheduleFinanceLiveFlush()}
window.queueFinanceShopRefresh=queueFinanceShop;
async function flushFinanceLive(){
 financeLiveTimer=null;
 if(!user||cfg.mode!=='live'||document.hidden)return;
 if(financeLiveBusy||financeLiveBlocked())return;
 if(backgroundRefreshRunning){setTimeout(()=>{if(financeLivePending||financeAnnouncementPending||financeLiveShopPending)scheduleFinanceLiveFlush()},500);return}
 const owner=user.id,screen=view,deferApp=screen==='attendance'&&financeLivePending,doApp=financeLivePending&&!deferApp,doAnnouncements=financeAnnouncementPending,doShop=financeLiveShopPending;
 financeLiveShopPending=false;
 if(deferApp)financeLiveDeferredApp=true;
 if(!doApp&&!doAnnouncements&&!doShop)return;
 financeLivePending=false;financeAnnouncementPending=false;financeLiveBusy=true;
 try{
  let result=null,announcements=null,shop=null,summary=null;
  if(doApp)result=await api('bootstrap',{skip_announcements:true});
  if(doAnnouncements)announcements=await api('announcements-list');
  if(doShop){
   shop=await api('shop-list');
   if(screen==='shop-summary'&&user.role==='admin')summary=await api('shop-summary',{paid:shopPaidOnly});
  }
  if(user?.id!==owner)return;
  if(financeLiveBlocked()){
   if(doApp)financeLivePending=true;
   if(doShop)financeLiveShopPending=true;
   return;
  }
  const stable=x=>JSON.stringify(x,(k,v)=>k==='last_seen_at'?undefined:v);
  let changed=false;
  if(result){
   const cachedAnnouncements=db.announcements||[];
   const nextData=result.data;
   nextData.announcements=cachedAnnouncements;
   const stableWithoutAnnouncements=x=>{const copy={...x};delete copy.announcements;return stable(copy)};
   changed=stableWithoutAnnouncements(db)!==stableWithoutAnnouncements(nextData)||stable(user)!==stable(result.profile);
   db=nextData;user=result.profile;
   for(const key of settingKeys)if(typeof db.settings?.[key]==='string')cfg[key]=db.settings[key];
  }
  if(announcements){
   const nextAnnouncements=reuseCachedAnnouncementImages(announcements.announcements||[],db.announcements||[]);
   if(stable(db.announcements||[])!==stable(nextAnnouncements))changed=true;
   db.announcements=nextAnnouncements;
   scheduleFinanceAnnouncementUrlRefresh();
  }
  if(shop){
   if(!shopLoaded||shopOwner!==owner||stable(shopData)!==stable(shop))changed=true;
   shopData=shop;shopLoaded=true;shopOwner=owner;db.shop_orders=shop.orders||[];
   shopSelected=new Set([...shopSelected].filter(id=>(shop.orders||[]).some(o=>o.id===id)));
   if(summary){if(stable(shopSummary)!==stable(summary))changed=true;shopSummary=summary}
  }
  if(changed)renderInBackground();
 }catch{
  if(doApp)financeLivePending=true;
  if(doShop)financeLiveShopPending=true;
 }finally{
  financeLiveBusy=false;
  if(financeLivePending||financeAnnouncementPending||financeLiveShopPending)scheduleFinanceLiveFlush();
 }
}
function stopFinanceLive(){
 if(financeLiveClient){financeLiveClient.removeAllChannels();financeLiveClient.realtime.disconnect()}
 financeLiveClient=null;financeLiveScope='';financeLiveToken='';financeLiveShopChannel=null;
 window.financeShopRealtimeReady=false;
 clearTimeout(financeLiveTimer);financeLiveTimer=null;clearTimeout(financeAnnouncementUrlTimer);financeAnnouncementUrlTimer=null;
 financeLivePending=false;financeLiveDeferredApp=false;financeAnnouncementPending=false;financeLiveShopPending=false;
}
function syncFinanceShopChannel(client){
 const should=!!user&&cfg.mode==='live'&&!document.hidden;
 if(!should){
  if(financeLiveShopChannel){const channel=financeLiveShopChannel;financeLiveShopChannel=null;window.financeShopRealtimeReady=false;void client.removeChannel(channel)}
  financeLiveShopPending=false;
  return;
 }
 if(financeLiveShopChannel)return;
 const channel=client.channel('finance:shop',{config:{private:true}})
  .on('broadcast',{event:'changed'},message=>{if(financeLiveIsShopResource(message))queueFinanceShop()})
  .subscribe(status=>{
   if(financeLiveShopChannel!==channel)return;
   if(status==='SUBSCRIBED'){
    window.financeShopRealtimeReady=true;
    queueFinanceShop();
   }
   if(status==='CLOSED'||status==='CHANNEL_ERROR'||status==='TIMED_OUT')window.financeShopRealtimeReady=false;
  });
 financeLiveShopChannel=channel;
 queueFinanceShop();
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
const financeLiveBaseNav=nav;nav=function(next){const fromAttendance=view==='attendance',result=financeLiveBaseNav(next);if(fromAttendance&&view!=='attendance'&&financeLiveDeferredApp){financeLiveDeferredApp=false;financeLivePending=true;scheduleFinanceLiveFlush()}return result};
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopFinanceLive();else syncFinanceLive()});
window.addEventListener('online',()=>{syncFinanceLive();queueFinanceLive();queueFinanceShop()});
window.addEventListener('pagehide',stopFinanceLive);
window.addEventListener('pageshow',()=>{if(!document.hidden)syncFinanceLive()});
document.getElementById('dialog').addEventListener('close',()=>{if(financeLivePending||financeAnnouncementPending||financeLiveShopPending)scheduleFinanceLiveFlush()});
document.addEventListener('focusout',()=>{if(financeLivePending||financeAnnouncementPending||financeLiveShopPending)scheduleFinanceLiveFlush()});
syncFinanceLive();
