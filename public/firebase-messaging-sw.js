/* WINNER OS Push UX PRO 1.24.1. Public Firebase web configuration only. */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
firebase.initializeApp({
 apiKey:'AIzaSyCAGEmzg7k6RCOoqOPqcpOVgws4W2pasDg',
 authDomain:'vendedoras-winner-360.firebaseapp.com',
 projectId:'vendedoras-winner-360',
 messagingSenderId:'460355470202',
 appId:'1:460355470202:web:bfa880f95d25192e814cc3'
});
const messaging=firebase.messaging();
const ORIGIN=self.location.origin;
const safeOrderNumber=v=>String(v||'').replace(/[^0-9A-Za-z-]/g,'').slice(0,50);
const toLocalUrl=(incoming,order)=>{
 // Only navigate to WINNER OS itself. Never trust a remote target from the push payload.
 let target;
 try{target=new URL(String(incoming||'/'),ORIGIN);}catch{target=new URL('/',ORIGIN);}
 if(target.origin!==ORIGIN)target=new URL('/',ORIGIN);
 const q=safeOrderNumber(order);
 if(q)target.searchParams.set('confirmacionesPedido',q);
 return target.href;
};
messaging.onBackgroundMessage(payload=>{
 const d=payload?.data||{};
 const orderNumber=safeOrderNumber(d.orderNumber);
 const orderId=safeOrderNumber(d.orderId);
 const order=orderNumber||orderId;
 const isTransfer=d.type==='transfer';
 const heading=isTransfer?'WINNER OS · Pedido transferido':'WINNER OS · Nuevo pedido';
 const detail=order?`Pedido ${orderNumber ? '#'+orderNumber : '#'+orderId} asignado. Revisa tu bandeja de confirmaciones.`:'Tienes un pedido nuevo para gestionar.';
 const orderUrl=toLocalUrl(d.url,order);
 const inboxUrl=toLocalUrl('/',null);
 const tag='winner-order-'+(orderId||order||'new');
 const actions=[
  {action:'open-order',title:'Abrir pedido'},
  {action:'open-inbox',title:'Ver bandeja'}
 ];
 return self.registration.showNotification(heading,{
  body:detail,
  icon:'/icons/winner-192.png',
  badge:'/icons/winner-notification-badge.png',
  tag,renotify:true,
  timestamp:Date.now(),
  vibrate:[140,70,140],
  actions,
  data:{orderUrl,inboxUrl,orderId,orderNumber}
 });
});
self.addEventListener('notificationclick',event=>{
 const notification=event.notification;
 const data=notification?.data||{};
 notification.close();
 const url=event.action==='open-inbox' ? toLocalUrl(data.inboxUrl,null) : toLocalUrl(data.orderUrl,data.orderNumber||data.orderId);
 event.waitUntil((async()=>{
  const list=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of list){
   if(!client.url.startsWith(ORIGIN))continue;
   try{
    // Navigate existing WINNER OS tab, then focus. If navigation fails, open a new one.
    const navigated=await client.navigate(url);
    if(navigated){await navigated.focus();return;}
   }catch(e){ /* fallback below */ }
  }
  if(self.clients.openWindow)await self.clients.openWindow(url);
 })());
});
