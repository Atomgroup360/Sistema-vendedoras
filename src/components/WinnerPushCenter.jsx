import React,{useEffect,useRef,useState} from 'react';
import {Bell,BellRing,ShieldCheck,Wifi,ChevronRight,X,Check,AlertTriangle} from 'lucide-react';
import {getApp} from 'firebase/app';
import {getMessaging,getToken,deleteToken,onMessage,isSupported} from 'firebase/messaging';

/* Optional, isolated UI. Never throws into the order-management flow. */
const ENDPOINT=import.meta.env.VITE_WINNER_PUSH_WORKER_URL||'';
const VAPID=import.meta.env.VITE_FIREBASE_VAPID_KEY||'';
const safeName=s=>String(s||'').slice(0,80);
export default function WinnerPushCenter({user,onOpenOrder}){
 const [modal,setModal]=useState(null);
 const [state,setState]=useState('idle');
 const [error,setError]=useState('');
 const lastSeen=useRef(new Set());
 const openOrder=(num)=>{setModal(null);onOpenOrder?.(num);};
 useEffect(()=>{
  let alive=true,unsub=()=>{};
  const key=`winner-push-activated:${user?.uid||''}`;
  try{if(localStorage.getItem(key)==='1')setState('enabled');}catch{}
  isSupported().then(ok=>{
   if(!alive||!ok)return;
   unsub=onMessage(getMessaging(getApp()),payload=>{
    if(!alive)return;
    const d=payload.data||{},id=String(d.orderId||''),tag=`${d.type}:${id}`;
    if(lastSeen.current.has(tag))return;
    lastSeen.current.add(tag);
    if(lastSeen.current.size>70)lastSeen.current.clear();
    setModal({kind:'arrival',title:safeName(d.title)||'Nuevo pedido asignado',message:safeName(d.body)||'Un pedido necesita tu confirmación.',orderId:id,orderNumber:String(d.orderNumber||'')});
   });
  }).catch(()=>{});
  return()=>{alive=false;unsub();};
 },[user?.uid]);
 const enable=async()=>{
  setState('busy');setError('');
  try{
   if(!ENDPOINT||!ENDPOINT.startsWith('https://'))throw Error('Falta VITE_WINNER_PUSH_WORKER_URL');
   if(!VAPID)throw Error('Falta VITE_FIREBASE_VAPID_KEY');
   if(!('Notification'in window)||!('serviceWorker'in navigator)||!(await isSupported()))throw Error('Este navegador no admite notificaciones push');
   if((await Notification.requestPermission())!=='granted')throw Error('No se concedió permiso para notificaciones');
   const reg=await navigator.serviceWorker.register('/firebase-messaging-sw.js',{scope:'/'});
   const token=await getToken(getMessaging(getApp()),{vapidKey:VAPID,serviceWorkerRegistration:reg});
   if(!token)throw Error('No se pudo registrar el dispositivo');
   const auth=await user.getIdToken();
   const resp=await fetch(`${ENDPOINT.replace(/\/$/,'')}/api/push/devices`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${auth}`},body:JSON.stringify({token})});
   const result=await resp.json();if(!resp.ok||!result.ok)throw Error(result.code||'No se pudo vincular este teléfono');
   localStorage.setItem(`winner-push-activated:${user.uid}`,'1');setState('enabled');
   setModal({kind:'success',title:'Conexión establecida',message:'Este teléfono recibirá avisos de pedidos asignados, incluso cuando WINNER OS no esté abierto.'});
  }catch(e){setState('error');setError(String(e.message||e));setModal({kind:'error',title:'Notificaciones no activadas',message:String(e.message||e)});}
 };
 const disable=async()=>{
  setState('busy');setError('');
  try{
   const messaging=getMessaging(getApp());
   const reg=await navigator.serviceWorker.getRegistration('/');
   const token=await getToken(messaging,{vapidKey:VAPID,serviceWorkerRegistration:reg});
   if(token){const auth=await user.getIdToken();const resp=await fetch(`${ENDPOINT.replace(/\/$/,'')}/api/push/devices`,{method:'DELETE',headers:{'Content-Type':'application/json',Authorization:`Bearer ${auth}`},body:JSON.stringify({token})});if(!resp.ok)throw Error('No se pudo desvincular el dispositivo');}
   await deleteToken(messaging);localStorage.removeItem(`winner-push-activated:${user.uid}`);setState('idle');setModal({kind:'success',title:'Avisos desactivados',message:'Este dispositivo dejó de recibir avisos de WINNER OS.'});
  }catch(e){setState('error');setError(String(e.message||e));setModal({kind:'error',title:'No fue posible desactivar',message:String(e.message||e)});}
 };
 return <>
 <style>{`
 .wpush-fab{position:fixed;z-index:1100;bottom:16px;right:16px;border:1px solid #4ecfe787;border-radius:999px;background:linear-gradient(120deg,#08263a,#134363);box-shadow:0 13px 34px #0007,0 0 24px #13baff25;color:#e8fcff;display:flex;align-items:center;gap:9px;padding:11px 16px;font:800 12px system-ui;cursor:pointer;max-width:calc(100vw - 24px)}
 .wpush-dot{width:8px;height:8px;border-radius:50%;background:#ffcb67;box-shadow:0 0 10px #ffc25a}.wpush-dot.active{background:#55e8b0;box-shadow:0 0 12px #24ffb6}
 .wpush-overlay{position:fixed;z-index:99999;inset:0;display:grid;place-items:center;padding:18px;background:#010a18df;backdrop-filter:blur(13px)}
 .wpush-card{position:relative;isolation:isolate;overflow:hidden;width:min(100%,480px);border:1px solid #73d9f769;border-radius:22px;background:radial-gradient(ellipse at 17% 4%,#235388,#081c36 52%,#061627 100%);box-shadow:0 36px 90px #000b,0 0 38px #1bbcff2b;padding:24px;color:white;font:14px system-ui;animation:wpush-appear .32s cubic-bezier(.2,.8,.2,1)}
 .wpush-card:before{content:'';position:absolute;inset:-80px -50px auto auto;width:260px;height:260px;background:repeating-radial-gradient(circle at center,transparent 0 13px,#6eeaff19 14px 15px);border-radius:50%;pointer-events:none;animation:wpush-rotate 18s linear infinite}
 .wpush-header{display:flex;gap:12px;align-items:center;position:relative}.wpush-symbol{display:grid;place-items:center;width:50px;height:50px;border:1px solid #91e8ff85;border-radius:16px;background:#164879;box-shadow:0 0 23px #20dfff44}
 .wpush-eyebrow{font-size:10px;letter-spacing:1.9px;color:#89f3ff;font-weight:900}.wpush-title{font-size:24px;line-height:1.1;margin:17px 0 9px;font-weight:900;letter-spacing:-.5px}.wpush-desc{margin:0;color:#c6def0;line-height:1.65;font-size:14px;max-width:390px}
 .wpush-signal{position:relative;margin-top:21px;padding:13px;background:#062a36aa;border:1px solid #5affc74c;border-radius:13px;color:#9bf0c7;display:flex;gap:10px;align-items:center;font-weight:750;font-size:12px}.wpush-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:19px}.wpush-actions button{cursor:pointer;border-radius:11px;padding:12px 15px;font-weight:800;border:1px solid #5896b3;background:#112f48;color:#e6f6ff;min-height:44px}.wpush-actions .primary{border-color:#19cf9d;background:linear-gradient(120deg,#087e67,#087baa);color:white}.wpush-close{position:absolute;right:15px;top:15px;cursor:pointer;background:#13364a;border:1px solid #66869b;border-radius:50%;width:31px;height:31px;color:#dff;display:grid;place-items:center}
 @keyframes wpush-appear{from{opacity:0;transform:translateY(16px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}@keyframes wpush-rotate{to{transform:rotate(360deg)}}
 @media(prefers-reduced-motion:reduce){.wpush-card,.wpush-card:before{animation:none}}@media(max-width:500px){.wpush-fab{right:10px;bottom:12px;font-size:11px}.wpush-card{padding:19px}.wpush-title{font-size:21px}}
 `}</style>
 <button type="button" className="wpush-fab" onClick={()=>setModal({kind:'settings',title:'Centro de notificaciones',message:state==='enabled'?'Este teléfono está vinculado al motor de avisos.':'Activa los avisos de pedidos para recibirlos aunque salgas de WINNER OS.'})}><Bell size={16}/><span>{state==='enabled'?'Avisos activos':'Notificaciones'}</span><span className={`wpush-dot ${state==='enabled'?'active':''}`}/></button>
 {modal&&<div className="wpush-overlay" role="dialog" aria-modal="true" aria-label="WINNER OS Notificaciones" onClick={e=>{if(e.target===e.currentTarget)setModal(null)}}><div className="wpush-card">
 <button type="button" className="wpush-close" onClick={()=>setModal(null)} aria-label="Cerrar"><X size={16}/></button>
 <div className="wpush-header"><div className="wpush-symbol"><BellRing size={23} color="#a7f5ff"/></div><div><div className="wpush-eyebrow">WINNER OS INTELLIGENCE</div><div style={{color:'#e3f8ff',fontSize:12,fontWeight:700}}>Centro de avisos · Confirmaciones IA</div></div></div>
 <h3 className="wpush-title">{modal.title}</h3><p className="wpush-desc">{modal.message}</p>
 <div className="wpush-signal">{modal.kind==='error'?<AlertTriangle size={17}/>:modal.kind==='success'?<Check size={17}/>:<Wifi size={17}/>}<span>{modal.kind==='arrival'?'Nuevo pedido detectado en tu cuenta':modal.kind==='error'?'Se requiere revisar la configuración':state==='enabled'?'Dispositivo vinculado y listo':'Conexión privada y segura'}</span></div>
 {error&&modal.kind==='settings'&&<p style={{fontSize:12,color:'#ffb0ae'}}>{error}</p>}
 <div className="wpush-actions">{modal.kind==='arrival'&&<button type="button" className="primary" onClick={()=>openOrder(modal.orderNumber||modal.orderId)}>Ver pedido <ChevronRight size={15} style={{verticalAlign:'middle'}}/></button>}{modal.kind!=='arrival'&&state!=='enabled'&&<button type="button" className="primary" disabled={state==='busy'} onClick={enable}>{state==='busy'?'Conectando…':'Activar avisos'}</button>}{modal.kind!=='arrival'&&state==='enabled'&&<button type="button" onClick={disable}>Desactivar en este teléfono</button>}<button type="button" onClick={()=>setModal(null)}>Cerrar</button></div>
 </div></div>}
 </>;
}
