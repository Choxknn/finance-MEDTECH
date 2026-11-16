'use strict';
/* Offline Sandbox network boundary.
 * Only same-origin requests are allowed. External API, storage, LINE and realtime
 * connections are rejected here; the CSP in index.html provides a second boundary.
 */
(()=>{
 const origin=location.origin;
 const blocked=value=>{
  let target='external destination';
  try{target=String(value?.url||value); }catch{}
  const error=new TypeError('Offline Sandbox: ปิดกั้นการเชื่อมต่อภายนอกแล้ว ('+target+')');
  try{console.warn(error.message)}catch{}
  return error;
 };
 function allowed(value){
  try{
   const raw=value&&typeof value==='object'&&'url'in value?value.url:value;
   const url=new URL(String(raw),location.href);
   return url.origin===origin||url.protocol==='blob:'||url.protocol==='data:';
  }catch{return false}
 }
 window.FINANCE_OFFLINE_SANDBOX=true;
 window.FINANCE_OFFLINE_NETWORK_POLICY='same-origin-only';
 const nativeFetch=window.fetch?.bind(window);
 if(nativeFetch)window.fetch=function(input,options){
  if(!allowed(input))return Promise.reject(blocked(input));
  return nativeFetch(input,options);
 };
 const XHR=window.XMLHttpRequest;
 if(XHR?.prototype){
  const open=XHR.prototype.open,send=XHR.prototype.send,blockedRequests=new WeakMap();
  XHR.prototype.open=function(method,url,...args){
   if(!allowed(url)){blockedRequests.set(this,blocked(url));return}
   blockedRequests.delete(this);
   return open.call(this,method,url,...args);
  };
  XHR.prototype.send=function(...args){
   const error=blockedRequests.get(this);
   if(error)throw error;
   return send.apply(this,args);
  };
 }
 if(window.WebSocket){
  const Original=window.WebSocket;
  const OfflineWebSocket=function(url){throw blocked(url)};
  OfflineWebSocket.prototype=Original.prototype;
  Object.assign(OfflineWebSocket,{CONNECTING:Original.CONNECTING,OPEN:Original.OPEN,CLOSING:Original.CLOSING,CLOSED:Original.CLOSED});
  window.WebSocket=OfflineWebSocket;
 }
 if(window.EventSource){
  const Original=window.EventSource;
  const OfflineEventSource=function(url){throw blocked(url)};
  OfflineEventSource.prototype=Original.prototype;
  window.EventSource=OfflineEventSource;
 }
 const beacon=window.navigator?.sendBeacon?.bind(window.navigator);
 if(beacon)try{Object.defineProperty(window.navigator,'sendBeacon',{configurable:true,value:(url,data)=>allowed(url)?beacon(url,data):false})}catch{}
 const nativeOpen=window.open?.bind(window);
 if(nativeOpen)window.open=function(url,...args){if(url&&!allowed(url)){blocked(url);return null}return nativeOpen(url,...args)};
 document.addEventListener('click',event=>{
  const link=event.target?.closest?.('a[href]');
  if(link&&!allowed(link.href)){event.preventDefault();event.stopImmediatePropagation();blocked(link.href)}
 },true);
})();