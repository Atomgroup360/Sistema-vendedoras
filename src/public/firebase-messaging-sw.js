/* Firebase config below is PUBLIC client configuration; never put service-account JSON here. */
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
messaging.onBackgroundMessage(payload=>{
 const data=payload.data||{};
 const title=String(data.title||'WINNER OS · Nuevo pedido').slice(0,80);
 self.registration.showNotification(title,{
  body:String(data.body||'Un pedido necesita tu gestión').slice(0,140),
  icon:'/icons/winner-192.png',badge:'/icons/winner-192.png',
  tag:`winner-push-${data.type||'assignment'}-${data.orderId||'new'}`,
  data:{url:String(data.url||'/?confirmacionesPedido=1')},
  vibrate:[120,60,120]
 });
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const target=new URL(event.notification.data?.url||'/',self.location.origin).href;
 event.waitUntil((async()=>{
  const wins=await clients.matchAll({type:'window',includeUncontrolled:true});
  for(const w of wins){if(w.url.startsWith(self.location.origin)){await w.navigate(target);return w.focus();}}
  return clients.openWindow(target);
 })());
});
