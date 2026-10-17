'use strict';
(()=>{
 const key='finance-public-festival-v1',allowed=['none','christmas','songkran','halloween','valentine','loykrathong','exams'];
 function apply(s){if(!s||!allowed.includes(s.theme))return;window.publicFestival=s;const parts=new Intl.DateTimeFormat('en',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const d=['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');const active=(s.start&&Date.now()<Date.parse(s.start+'T'+(s.start_time||'00:00')+':00+07:00'))||(s.end&&Date.now()>Date.parse(s.end+'T'+(s.end_time||'23:59')+':59+07:00'))?'none':s.theme;document.documentElement.dataset.festival=s.decorations===false?'none':active;document.documentElement.classList.toggle('festival-still',s.motion===false);window.dispatchEvent(new Event('festival-public-ready'))}
 try{const cached=JSON.parse(localStorage.getItem(key));if(cached&&Date.now()-cached.at<86400000)apply(cached.settings)}catch{}
 const c=window.FINANCE_CONFIG;if(c?.mode!=='live')return;
 fetch(`${c.supabaseUrl}/functions/v1/finance-api?action=festival-theme`,{headers:{apikey:c.supabaseAnonKey},signal:AbortSignal.timeout(6000)}).then(r=>{if(!r.ok)throw Error('theme unavailable');return r.json()}).then(r=>{apply(r.festival);try{localStorage.setItem(key,JSON.stringify({at:Date.now(),settings:r.festival}))}catch{}}).catch(()=>{});
})();
