'use strict';
/* Offline Sandbox network boundary.
 * The application may load same-origin static assets, but runtime network APIs are denied.
 * CSP and the local-only dev server add independent barriers.
 */
(()=>{
 const origin=location.origin;
 const pagePath=location.pathname;
 const rootPath=pagePath.slice(0,pagePath.lastIndexOf('/')+1)||'/';
 const blocked=value=>{
  let target='network request';
  try{target=String(value?.url||value)}catch{}
  const error=new TypeError('Offline Sandbox: ปิดกั้นเครือข่ายแล้ว ('+target+')');
  try{console.warn(error.message)}catch{}
  return error;
 };
 function safeNavigation(value){
  try{
   const raw=value&&typeof value==='object'&&'url'in value?value.url:value;
   const url=new URL(String(raw),location.href);
   if(url.protocol==='blob:'||url.protocol==='data:')return true;
   return url.origin===origin&&(url.pathname===pagePath||url.pathname===rootPath||url.pathname===rootPath+'index.html');
  }catch{return false}
 }
 window.FINANCE_OFFLINE_SANDBOX=true;
 window.FINANCE_OFFLINE_NETWORK_POLICY='no-runtime-network';
 const nativeFetch=window.fetch?.bind(window);
 if(nativeFetch)window.fetch=function(input){return Promise.reject(blocked(input))};
 const XHR=window.XMLHttpRequest;
 if(XHR?.prototype){
  XHR.prototype.open=function(method,url){throw blocked(url)};
  XHR.prototype.send=function(){throw blocked('XMLHttpRequest')};
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
 if(window.navigator?.sendBeacon)try{Object.defineProperty(window.navigator,'sendBeacon',{configurable:true,value:url=>{blocked(url);return false}})}catch{}
 if(window.open)window.open=function(url){if(safeNavigation(url))return null;blocked(url);return null};
 const stopUnsafeNavigation=event=>{
  const link=event.target?.closest?.('a[href]');
  if(link&&!safeNavigation(link.href)){event.preventDefault();event.stopImmediatePropagation();blocked(link.href)}
 };
 document.addEventListener('click',stopUnsafeNavigation,true);
 document.addEventListener('auxclick',stopUnsafeNavigation,true);
})();