const HOUR=60*60*1000;
export function createAppUpdates({api}){
 let state={available:false,downloadState:{status:'idle'}},timer,flight,downloading,poll,revision=0;
 const listeners=new Set(),emit=()=>{paint();for(const fn of listeners)fn(state);};
 function paint(){for(const button of document.querySelectorAll('[data-action="help"]')){button.classList.toggle('has-app-update',state.available===true);button.setAttribute('aria-label',state.available?'软件信息，有新版本可更新':'软件信息与更新检查');}}
 function followDownload(){
  if(!timer||downloading||poll||state.downloadState?.status!=='downloading')return;
  poll=setTimeout(async()=>{poll=null;try{await refresh();}catch{followDownload();}},1500);
 }
 function accept(next){revision++;state=next;emit();followDownload();return state;}
 function check(automatic=false){if(flight)return flight;flight=api('/api/settings/check-update',{automatic}).then(accept).finally(()=>{flight=null;});return flight;}
 async function refresh(){const before=revision,next=await api('/api/settings/update-status');return before===revision?accept(next):state;}
 function download(){if(downloading)return downloading;
  downloading=(async()=>{
   accept(await api('/api/settings/download-update',{background:true}));
   while(state.downloadState?.status==='downloading'){
    await new Promise(resolve=>setTimeout(resolve,1000));await refresh();
   }
   if(state.downloadState?.status==='error')throw Error(state.downloadState.message);
   return state;
  })().finally(()=>{downloading=null;followDownload();});return downloading;
 }
 function start(){if(timer)return;void check(true).catch(()=>{});timer=setInterval(()=>void check(true).catch(()=>{}),HOUR);}
 function stop(){clearInterval(timer);clearTimeout(poll);timer=null;poll=null;}
 window.addEventListener('pagehide',stop);window.addEventListener('pageshow',event=>{if(event.persisted)start();});
 return {start,stop,paint,check,refresh,download,get state(){return state;},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
}
