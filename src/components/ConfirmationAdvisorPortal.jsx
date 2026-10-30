import React, { useState, useEffect, useRef } from 'react';
import { Activity, AlertTriangle, Bell, CheckCircle2, Clock3, LayoutDashboard, LockKeyhole, LogOut, Package, Radio, ShieldCheck, Sparkles, Users, Wifi, Zap } from 'lucide-react';

const TABS = [
  { id: 'resumen', title: 'Resumen', icon: LayoutDashboard },
  { id: 'pedidos', title: 'Mis pedidos', icon: Package },
  { id: 'estadisticas', title: 'Estadísticas', icon: Activity },
  { id: 'eliminar', title: 'Eliminar pruebas', icon: LockKeyhole },
  { id: 'asesoras', title: 'Ver asesoras y pedidos', icon: Users },
  { id: 'distribucion', title: 'Distribución', icon: Zap },
  { id: 'administrar', title: 'Administrar asesoras', icon: Users },
  { id: 'alertas', title: 'Alertas IA', icon: Bell },
  { id: 'sistema', title: 'Estado del sistema', icon: Activity },
];
const STATUSES = [
  { name: 'Recepción Shopify', value: 'Activa', detail: 'Webhook → Cloudflare → D1', color: 'cyan', icon: Wifi },
  { name: 'Distribución', value: 'Según Worker', detail: 'La asignación depende de la configuración real de Cloudflare', color: 'amber', icon: Users },
  { name: 'WhatsApp', value: 'Manual', detail: 'Contacto desde el móvil de cada asesora', color: 'violet', icon: Radio },
  { name: 'Alertas recientes', value: 'Vista previa', detail: 'Análisis protegido en el Worker', color: 'green', icon: Sparkles },
];
const ORDER_STATUS_LABELS = {pending:'Pendiente',sent:'Enviado',confirmed:'Confirmado',cancelled:'Cancelado',duplicate:'Pedido duplicado'};
const STATUS_STYLES={pending:{border:'#e5ac40',background:'rgba(226,166,53,.08)',tag:'#e5ac40'},sent:{border:'#47b9ef',background:'rgba(71,185,239,.08)',tag:'#47b9ef'},confirmed:{border:'#45cd96',background:'rgba(69,205,150,.08)',tag:'#45cd96'},cancelled:{border:'#f26b77',background:'rgba(242,107,119,.10)',tag:'#f26b77'},duplicate:{border:'#c17cf4',background:'rgba(180,105,230,.13)',tag:'#c17cf4'}};
const isOverdueOrder=o=>['pending','sent','confirmed'].includes(o.status)&&Number.isFinite(Date.parse(o.stateChangedAt||o.createdAt))&&(Date.now()-Date.parse(o.stateChangedAt||o.createdAt)>48*3600000);
const ALERTS = [
  { title: 'Cliente con pedido reciente', detail: 'Verifica si está preguntando por el pedido anterior antes de confirmar uno nuevo.', tone: 'cyan', icon: Clock3 },
  { title: 'Posible pedido duplicado', detail: 'Mismo teléfono, productos o dirección: revisar manualmente; no cancelar de forma automática.', tone: 'amber', icon: AlertTriangle },
  { title: 'Compra adicional legítima', detail: 'Un pedido nuevo puede ser una compra válida. Confirmar la intención del cliente.', tone: 'violet', icon: CheckCircle2 },
];

function Atom() {
  return <div className="ao-atom" aria-hidden="true"><div className="ao-orbit ao-one"/><div className="ao-orbit ao-two"/><div className="ao-orbit ao-three"/><div className="ao-nucleus"/></div>;
}

export default function ConfirmationAdvisorPortal({ user, onLogout, role = 'confirmaciones' }) {
  const [tab, setTab] = useState(() => role === 'admin' ? 'estadisticas' : 'resumen');
  const [dashboard, setDashboard] = useState({status:'idle',data:null,error:''});
  const [dateRange,setDateRange]=useState({from:'',to:''});
  const [adminAdvisor,setAdminAdvisor]=useState('');
  const [adminPage,setAdminPage]=useState(0);
  const [adminOrders,setAdminOrders]=useState({status:'idle',orders:[],hasMore:false,error:''});
  const [adminOpenedOrder,setAdminOpenedOrder]=useState(null);
  const [distribution,setDistribution]=useState({status:'idle',data:null,error:'',notice:''});
  const [advisorAdmin,setAdvisorAdmin]=useState({advisors:[],reviews:[],error:'',message:'',loading:false});
  const [deleteDraft,setDeleteDraft]=useState(null);
  const [deleteSearch,setDeleteSearch]=useState('');
  const [deleteList,setDeleteList]=useState({loading:false,items:[],error:''});
  const [deleteBusy,setDeleteBusy]=useState(false);
  const [atomBusy,setAtomBusy]=useState(0);
  const [atomMessage,setAtomMessage]=useState('');
  const [renameDraft,setRenameDraft]=useState({advisorId:'',displayName:''});
  const [advisorDraft,setAdvisorDraft]=useState({advisorId:'',displayName:'',priority:2,enabled:false});

  const [inbox, setInbox] = useState({status:'idle',orders:[],error:'',hasMore:false,totals:null});
  const colombiaToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const colombiaYesterday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()-86400000));
  const [advisorDates,setAdvisorDates]=useState(()=>({from:colombiaToday(),to:colombiaToday()}));
  const [advisorPreset,setAdvisorPreset]=useState('today');
  const [advisorStatus,setAdvisorStatus]=useState('all');
  const [advisorPage,setAdvisorPage]=useState(0);
  const [expandedOrder,setExpandedOrder]=useState(null);
  const [shopifyHealth,setShopifyHealth]=useState('checking');
  const inboxBusyRef = useRef(false);
  const knownOrderIdsRef = useRef(null);
  const [newOrderCount,setNewOrderCount] = useState(0);
  const [lastSync,setLastSync] = useState(null);
  const [pollError,setPollError] = useState('');
  const [actionEnabled, setActionEnabled] = useState(false);
  const [actionState,setActionState]=useState({busy:0,message:''});
  const [notes,setNotes]=useState({});
  const [confirmAction,setConfirmAction]=useState(null);
  const [advisorName,setAdvisorName]=useState('');
  const [rememberAdvisorName,setRememberAdvisorName]=useState(false);
  const advisorNameStorageKey = `winner-confirmaciones-advisor-name-v1:${user?.uid||'unknown'}`;
  useEffect(()=>{
    if(role==='admin'||!user?.uid)return;
    try{
      const raw=localStorage.getItem(advisorNameStorageKey);
      if(!raw)return;
      const saved=JSON.parse(raw);
      if(saved?.locked===true && typeof saved.name==='string' && saved.name.trim()){
        setAdvisorName(saved.name.slice(0,80));
        setRememberAdvisorName(true);
      }
    }catch(e){console.warn('Nombre local no disponible',e);}
  },[role,user?.uid,advisorNameStorageKey]);
  const changeAdvisorNameLock=(locked)=>{
    if(locked&&!advisorName.trim()){
      setActionState(s=>({...s,message:'Escribe el nombre de la asesora antes de activar la permanencia.'}));
      return;
    }
    try{
      if(locked)localStorage.setItem(advisorNameStorageKey,JSON.stringify({locked:true,name:advisorName.trim()}));
      else localStorage.removeItem(advisorNameStorageKey);
      setRememberAdvisorName(locked);
      setActionState(s=>({...s,message:locked?'Nombre guardado en este navegador para futuras sesiones.':'Nombre desbloqueado. Puedes editarlo.'}));
    }catch(e){setActionState(s=>({...s,message:'Este navegador no permite guardar el nombre. Revisa sus permisos de almacenamiento.'}));}
  };
  const [messagePreview,setMessagePreview]=useState(null);
  const [transferModal,setTransferModal]=useState(null);
  const [transferNote,setTransferNote]=useState('');
  const [directory,setDirectory]=useState([]);
  const [transferHistory,setTransferHistory]=useState({items:[],hasMore:false,page:0,error:''});
  const fetchInbox = async (silent = false) => {
    if (inboxBusyRef.current) return;
    if (!user?.getIdToken) {
      if (!silent) setInbox({status:'error',orders:[],error:'Sesión Firebase no disponible'});
      return;
    }
    inboxBusyRef.current = true;
    if (!silent) setInbox(prev=>({...prev,status:'loading',error:''}));
    try {
      const token=await user.getIdToken();
      const params=new URLSearchParams();
      if(role!=='admin'){params.set('from',advisorDates.from);params.set('to',advisorDates.to);params.set('status',advisorStatus);params.set('page',String(advisorPage));}
      const res=await fetch(`https://winner-os-confirmaciones.julian-1818.workers.dev/api/v1/advisor/inbox?${params}`,{
        method:'GET',headers:{Authorization:`Bearer ${token}`},cache:'no-store'
      });
      const data=await res.json();
      if (!res.ok || !data.ok) throw new Error(data.code||'ERROR_DE_CONEXION');
      const orders=Array.isArray(data.orders)?data.orders:[];
      const nextIds=new Set(orders.map(o=>o.id));
      if (knownOrderIdsRef.current !== null) {
        const added=orders.filter(o=>!knownOrderIdsRef.current.has(o.id)).length;
        if (added>0) setNewOrderCount(count=>count+added);
      }
      knownOrderIdsRef.current=nextIds;
      setActionEnabled(data.orderActionsEnabled===true);
      setInbox({status:'ready',orders,error:'',hasMore:!!data.hasMore,totals:data.totals||null});
      setLastSync(new Date());
      setPollError('');
    }catch(e){
      const message=String(e.message||'ERROR');
      if (silent) setPollError(message);
      else setInbox(prev=>({...prev,status:'error',error:message}));
    }finally{inboxBusyRef.current=false;}
  };
  const loadDirectory=async()=>{try{const token=await user.getIdToken();const res=await fetch('https://winner-os-confirmaciones.julian-1818.workers.dev/api/v1/advisor/directory',{headers:{Authorization:`Bearer ${token}`}});const d=await res.json();if(d.ok)setDirectory(d.advisors||[]);}catch{}};
  const executeTransfer=async()=>{if(!transferModal?.target)return;setActionState(s=>({...s,busy:transferModal.id}));try{const token=await user.getIdToken();const r=await fetch('https://winner-os-confirmaciones.julian-1818.workers.dev/api/v1/advisor/transfer',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({incomingId:transferModal.id,toAdvisorId:transferModal.target,note:transferNote})});const d=await r.json();if(!d.ok)throw Error(d.code||'TRANSFER_FAILED');setTransferModal(null);setTransferNote('');await fetchInbox(true);if(role==='admin')await fetchAdminOrders();}catch(e){setActionState(s=>({...s,message:String(e.message||e)}));}finally{setActionState(s=>({...s,busy:0}));}};
  const loadTransferHistory=async(page=0)=>{if(role!=='admin')return;try{const token=await user.getIdToken();const r=await fetch(`https://winner-os-confirmaciones.julian-1818.workers.dev/api/v1/admin/transfer-history?page=${page}`,{headers:{Authorization:`Bearer ${token}`}});const d=await r.json();if(!d.ok)throw Error(d.code);setTransferHistory({...d,error:''});}catch(e){setTransferHistory(s=>({...s,error:String(e.message)}));}};
  useEffect(()=>{if(user?.getIdToken)void loadDirectory();},[user?.uid]);
  useEffect(()=>{if(tab==='asesoras'&&role==='admin')void loadTransferHistory(0);},[tab,role,user?.uid]);
  const fetchDashboard = async () => {
    if(role!=='admin')return;
    setDashboard(s=>({...s,status:'loading',error:''}));
    try{
      const token=await user.getIdToken();
      const params=new URLSearchParams();
      if(dateRange.from)params.set('from',dateRange.from);
      if(dateRange.to)params.set('to',dateRange.to);
      const res=await fetch(`https://winner-os-confirmaciones.julian-1818.workers.dev/api/v1/admin/confirmations-dashboard?${params}`,{
        headers:{Authorization:`Bearer ${token}`},cache:'no-store'
      });
      const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.code||'ERROR_DASHBOARD');
      setDashboard({status:'ready',data,error:''});
    }catch(e){setDashboard({status:'error',data:null,error:String(e.message||'ERROR')});}
  };
  const fetchAdminOrders = async (advisorId=adminAdvisor,page=adminPage) => {
    if(role!=='admin'||!user?.getIdToken)return;
    setAdminOrders(s=>({...s,status:'loading',error:''}));
    try{
      const token=await user.getIdToken();
      const params=new URLSearchParams({page:String(page)});
      if(advisorId)params.set('advisorId',advisorId);
      const res=await fetch(`https://winner-os-confirmaciones.julian-1818.workers.dev/api/v1/advisor/inbox?${params}`,{
        headers:{Authorization:`Bearer ${token}`},cache:'no-store'
      });
      const data=await res.json();
      if(!res.ok||!data.ok||data.role!=='admin')throw new Error(data.code||'ADMIN_READ_FAILED');
      setAdminOrders({status:'ready',orders:data.orders||[],hasMore:!!data.hasMore,error:''});
    }catch(e){setAdminOrders({status:'error',orders:[],hasMore:false,error:String(e.message||'Error')});}
  };
  const fetchDistribution = async () => {
    if(role!=='admin'||!user?.getIdToken)return;
    setDistribution(s=>({...s,status:'loading',error:'',notice:''}));
    try{
      const token=await user.getIdToken();
      const res=await fetch('https://winner-os-confirmaciones.julian-1818.workers.dev/api/v1/admin/distribution',{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
      const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.code||'PREVIEW_FAILED');
      setDistribution({status:'ready',data,error:'',notice:''});
    }catch(e){setDistribution(s=>({...s,status:'error',error:String(e.message||'Error'),notice:''}));}
  };
  const runDistribution = async () => {
    if(role!=='admin'||!distribution.data?.assignmentsEnabled)return;
    if(!window.confirm('¿Asignar hasta 30 pedidos elegibles, respetando el límite de 30 nuevos por asesora y día? Los pedidos sospechosos se retendrán.'))return;
    setDistribution(s=>({...s,status:'loading',error:'',notice:''}));
    try{
      const token=await user.getIdToken();
      const res=await fetch('https://winner-os-confirmaciones.julian-1818.workers.dev/api/v1/admin/distribution',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({confirmation:'ASIGNAR_PEDIDOS'})});
      const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.code||'ASSIGNMENT_FAILED');
      await fetchDistribution();
      setDistribution(s=>({...s,notice:`Se asignaron ${data.assigned||0} pedidos; ${data.held||0} retenidos para revisión; ${data.capacityBlocked||0} sin cupo.`}));
    }catch(e){setDistribution(s=>({...s,status:'error',error:String(e.message||'Error')}));}
  };
  const adminV114 = async (path, body=null) => {
    const token=await user.getIdToken();
    const res=await fetch(`https://winner-os-confirmaciones.julian-1818.workers.dev/api/v1/admin/${path}`,{
      method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'
    });
    const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.code||'OPERACION_RECHAZADA');return data;
  };
  const saveVisibleAdvisorName=async()=>{
    const name=renameDraft.displayName.trim();
    if(!renameDraft.advisorId||name.length<2){setAdvisorAdmin(s=>({...s,error:'Escribe un nombre válido de al menos 2 caracteres.'}));return;}
    try{
      await adminV114('advisor-display-name',{advisorId:renameDraft.advisorId,displayName:name});
      setRenameDraft({advisorId:'',displayName:''});
      await refreshAdvisorsV114();
      await fetchDashboard();
      setAdvisorAdmin(s=>({...s,message:'Nombre visible actualizado para el sistema y los reportes.',error:''}));
    }catch(e){setAdvisorAdmin(s=>({...s,error:String(e.message||e)}));}
  };
  const refreshAdvisorsV114=async()=>{
    if(role!=='admin')return;
    setAdvisorAdmin(s=>({...s,loading:true,error:''}));
    try{const [a,r]=await Promise.all([adminV114('advisors'),adminV114('reviews')]);
      setAdvisorAdmin(s=>({...s,loading:false,advisors:a.advisors||[],reviews:r.reviews||[]}));
    }catch(e){setAdvisorAdmin(s=>({...s,loading:false,error:String(e.message)}));}
  };
  const saveAdvisorV114=async()=>{
    try{await adminV114('advisors',advisorDraft);
      setAdvisorAdmin(s=>({...s,message:'Asesora vinculada y configurada.'}));await refreshAdvisorsV114();
    }catch(e){setAdvisorAdmin(s=>({...s,error:String(e.message)}));}
  };
  const backfillImmediateV114=async()=>{
    try{const r=await adminV114('backfill',{});setAdvisorAdmin(s=>({...s,message:`Índice: ${r.processed} procesados; ${r.remaining} pendientes. Repite hasta que queden 0.`}));}
    catch(e){setAdvisorAdmin(s=>({...s,error:String(e.message)}));}
  };
  const retryImmediateV114=async()=>{
    try{const r=await adminV114('immediate-retry',{});await Promise.all([fetchDistribution(),refreshAdvisorsV114()]);
      setAdvisorAdmin(s=>({...s,message:`Recuperación: ${r.assigned} asignados, ${r.review} en revisión, ${r.blocked} bloqueados.`}));
    }catch(e){setAdvisorAdmin(s=>({...s,error:String(e.message)}));}
  };
  const updateOrder = async (o, action) => {
    if(!actionEnabled){setActionState({busy:0,message:'Las acciones están deshabilitadas en Cloudflare.'});return;}
    const note=notes[o.id]||'';
    setActionState({busy:o.id,message:''});
    try{
      const token=await user.getIdToken();
      const res=await fetch('https://winner-os-confirmaciones.julian-1818.workers.dev/api/v1/advisor/order-action',{
        method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        body:JSON.stringify({incomingId:o.id,action,note})
      });
      const data=await res.json();
      if(!res.ok||!data.ok)throw new Error(data.code||'No se pudo registrar');
      setActionState({busy:0,message:'Estado guardado y auditado.'});
      setConfirmAction(null);
      await fetchInbox();
      if(role==='admin')fetchDashboard();
    }catch(e){setActionState({busy:0,message:String(e.message||'Error')});}
  };
  const changeAtomStatus=async(o,status)=>{
    if(!window.confirm(status==='processed'?`¿Confirmas que el pedido ${o.number} YA fue registrado en ATOM?`:`¿Marcar ${o.number} como pendiente de registrar en ATOM?`))return;
    setAtomBusy(o.id);setAtomMessage('');
    try{const token=await user.getIdToken();const r=await fetch('https://winner-os-confirmaciones.julian-1818.workers.dev/api/v1/advisor/atom-processing',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({incomingId:o.id,status})});const d=await r.json();if(!r.ok||!d.ok)throw Error(d.code||'NO_GUARDADO');setAtomMessage('Gestión ATOM guardada.');await fetchInbox(true);if(role==='admin')await fetchDashboard();}
    catch(e){setAtomMessage(String(e.message||e));}finally{setAtomBusy(0);}
  };
  const searchDeletableOrders=async(query=deleteSearch)=>{
    if(role!=='admin')return;
    setDeleteList(s=>({...s,loading:true,error:''}));
    try{
      const token=await user.getIdToken();
      const res=await fetch('https://winner-os-confirmaciones.julian-1818.workers.dev/api/v1/admin/search-orders?search='+encodeURIComponent(query.trim()),{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
      const data=await res.json();if(!res.ok||!data.ok)throw Error(data.code||'CONSULTA_FALLIDA');
      setDeleteList({loading:false,items:data.orders||[],error:''});
    }catch(e){setDeleteList({loading:false,items:[],error:String(e.message||e)});}
  };
  const deleteTestOrder=async()=>{
    if(!deleteDraft||deleteBusy)return;
    const orderNumber=deleteDraft.number;
    if(!window.confirm(`Eliminación irreversible en Confirmaciones D1: pedido ${orderNumber}.\n\nNo se borrará de Shopify ni ATOM. ¿Confirmas que verificaste que es una prueba?`))return;
    setDeleteBusy(true);setAtomMessage('');
    try{
      const token=await user.getIdToken();
      const r=await fetch('https://winner-os-confirmaciones.julian-1818.workers.dev/api/v1/admin/delete-test-order',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({incomingId:deleteDraft.id,reason:'test',confirmText:`ELIMINAR ${orderNumber}`})});
      const d=await r.json();if(!r.ok||!d.ok)throw Error(d.code||'NO_ELIMINADO');
      setDeleteDraft(null);setAdminOpenedOrder(null);setAtomMessage(`Pedido ${d.deletedOrder} eliminado de Confirmaciones D1.`);
      await Promise.all([fetchDashboard(),fetchAdminOrders(),searchDeletableOrders(deleteSearch)]);
    }catch(e){setAtomMessage(`No se pudo eliminar: ${String(e.message||e)}`);}
    finally{setDeleteBusy(false);}
  };
  const money = value => {
    const n=Number(String(value||'').replace(/[^0-9.]/g,''));
    return Number.isFinite(n)&&n>0 ? '$'+Math.round(n).toLocaleString('es-CO') : 'Valor por verificar';
  };
  const clean = value => String(value||'').trim();
  const formatConfirmMessage = (o) => {
    const seller=clean(advisorName)||clean(o.advisorName)||clean(user?.displayName)||'ASESORA';
    const customer=clean(o.customerName)||'CLIENTE';
    const details=(o.items||[]).map((item,i)=>`${i+1}️⃣ ${String(item.title||'PRODUCTO').toUpperCase()}${item.variant?' ('+item.variant+')':''}${Number(item.quantity)>1?' — CANTIDAD: '+item.quantity:''}`).join('\n\n')||'Producto por verificar';
    const address=[o.address?.address1,o.address?.address2,o.address?.city,o.address?.province].map(clean).filter(Boolean).join(' / ');
    const phone=clean(o.customerPhone)||'Por verificar';
    return `📦 ¡PEDIDO ${o.number} RECIBIDO!\n\n👋 Hola, ${customer}. Hablas con ${seller} de la tienda TU PEDIDO COLOMBIA 🇨🇴, recibimos la siguiente solicitud de pedido a tu nombre en nuestra página WEB:\n\n${details}\n\n💰 Valor total a pagar al momento de recibir en casa: ${money(o.total)}\n\n📱 ${phone}\n\n🏡 Dirección para el envío:\n${address||'DIRECCIÓN PENDIENTE DE VERIFICAR'}\n\n✅ YA ESTAMOS PROCESANDO TU PEDIDO. Por favor, confírmanos que los datos están correctos para que la transportadora pueda realizar la entrega sin retrasos. ⏱️`;
  };
  const whatsAppLink=o=>{
    const digits=String(o.customerPhone||'').replace(/\D/g,'');
    const valid=/^(57)?3\d{9}$/.test(digits);
    if(!valid)return null;
    const normalized=digits.startsWith('57')?digits:'57'+digits;
    return `https://wa.me/${normalized}?text=${encodeURIComponent(formatConfirmMessage(o))}`;
  };
  const copyMessage = async o=>{
    try{await navigator.clipboard.writeText(formatConfirmMessage(o));setActionState({busy:0,message:'Mensaje copiado. Revísalo antes de enviarlo.'});}
    catch{setMessagePreview(o.id);setActionState({busy:0,message:'Selecciona el mensaje de vista previa para copiarlo.'});}
  };
  useEffect(()=>{if(['pedidos','resumen'].includes(tab))fetchInbox();},[tab,user?.uid,advisorDates.from,advisorDates.to,advisorStatus,advisorPage]);
  useEffect(()=>{if(role==='admin')return; const check=async()=>{try{const r=await fetch('https://winner-os-confirmaciones.julian-1818.workers.dev/health',{cache:'no-store'});const d=await r.json();setShopifyHealth(r.ok&&d.ingestEnabled&&d.dbBound?'active':'inactive');}catch{setShopifyHealth('inactive');}};check();const t=setInterval(check,60000);return()=>clearInterval(t);},[role]);
  // Asesora: actualiza sin recargar la página ni cerrar sesión. No interrumpe notas o mensajes.
  useEffect(()=>{
    if(role==='admin'||!user?.getIdToken)return;
    const refresh=()=>{if(document.visibilityState==='visible'&&navigator.onLine)void fetchInbox(true);};
    const timer=window.setInterval(refresh,15000);
    document.addEventListener('visibilitychange',refresh);
    window.addEventListener('focus',refresh);
    window.addEventListener('online',refresh);
    return ()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);};
  },[role,user?.uid,advisorDates.from,advisorDates.to,advisorStatus,advisorPage]);
  useEffect(()=>{if(tab==='pedidos')setNewOrderCount(0);},[tab]);
  useEffect(()=>{if(tab==='estadisticas'&&role==='admin')fetchDashboard();},[tab,user?.uid,dateRange.from,dateRange.to]);
  useEffect(()=>{if(tab!=='estadisticas'||role!=='admin')return; const t=window.setInterval(()=>{if(document.visibilityState==='visible')void fetchDashboard();},30000);return()=>window.clearInterval(t);},[tab,role,user?.uid,dateRange.from,dateRange.to]);
  useEffect(()=>{if(tab==='asesoras'&&role==='admin')fetchAdminOrders(adminAdvisor,adminPage);},[tab,user?.uid,adminAdvisor,adminPage]);
  useEffect(()=>{if(tab==='asesoras'&&role==='admin'&&!dashboard.data)fetchDashboard();},[tab,user?.uid]);
  useEffect(()=>{if(tab==='distribucion'&&role==='admin')fetchDistribution();},[tab,user?.uid]);
  useEffect(()=>{if(tab==='administrar'&&role==='admin')refreshAdvisorsV114();},[tab,user?.uid]);
  useEffect(()=>{if(tab==='eliminar'&&role==='admin')searchDeletableOrders('');},[tab,user?.uid]);
  const stats=inbox.orders.reduce((a,o)=>{a.total++;a[o.status]=(a[o.status]||0)+1;return a;},{total:0});
  const admin = role === 'admin';
  const visibleTabs = admin ? TABS.filter(item => ['estadisticas','asesoras','distribucion','administrar','eliminar','alertas','sistema'].includes(item.id)) : TABS.filter(item => ['resumen','pedidos'].includes(item.id));
  const counts=inbox.totals||{pending:0,sent:0,confirmed:0,cancelled:0,total:0};
  const chooseDates=(preset)=>{setAdvisorPreset(preset);setAdvisorPage(0);setExpandedOrder(null);const today=colombiaToday();if(preset==='today')setAdvisorDates({from:today,to:today});if(preset==='yesterday'){const y=colombiaYesterday();setAdvisorDates({from:y,to:y});}if(preset==='week'){const d=new Date(Date.now()-6*86400000);setAdvisorDates({from:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit'}).format(d),to:today});}};
  const filterControls=()=> <div className="ao-filter-bar"><div className="ao-presets">{[['today','Hoy'],['yesterday','Ayer'],['week','7 días'],['custom','Personalizado']].map(([v,label])=><button key={v} type="button" aria-pressed={advisorPreset===v} onClick={()=>chooseDates(v)}>{label}</button>)}</div><div className="ao-dates"><label>Desde<input type="date" value={advisorDates.from} onChange={e=>{setAdvisorDates(s=>({...s,from:e.target.value}));setAdvisorPreset('custom');setAdvisorPage(0);setExpandedOrder(null);}}/></label><label>Hasta<input type="date" value={advisorDates.to} onChange={e=>{setAdvisorDates(s=>({...s,to:e.target.value}));setAdvisorPreset('custom');setAdvisorPage(0);setExpandedOrder(null);}}/></label></div></div>;
  const current = visibleTabs.find(t => t.id === tab) || visibleTabs[0];
  return <div className={`ao-root ${admin?'ao-admin':'ao-advisor'}`}>
    <style>{`
      .ao-root{--ao-text:#eaf5ff;--ao-muted:#b4cbe0;--ao-cyan:#51e5ff;--ao-amber:#ffd37a;--ao-violet:#d2a2ff;--ao-green:#76f3bc;position:relative;isolation:isolate;width:100%;min-width:0;min-height:calc(100vh - 90px);overflow:hidden;border-radius:18px;color:var(--ao-text);font-family:Inter,system-ui,sans-serif;background:radial-gradient(ellipse at 75% 0%,#173f68 0%,transparent 34%),linear-gradient(135deg,#061426,#071a32 60%,#071222);}
      .ao-root *, .ao-root *:before,.ao-root *:after{box-sizing:border-box}
      .ao-back{pointer-events:none;position:absolute;inset:0;opacity:.75;background-image:linear-gradient(90deg,transparent 97%,rgba(56,189,248,.10) 100%),linear-gradient(transparent 97%,rgba(56,189,248,.10) 100%);background-size:62px 62px;mask-image:linear-gradient(to bottom,#000,transparent 85%)}
      .ao-path{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:.48}
      .ao-path path{stroke-dasharray:16 22;animation:ao-flow 13s linear infinite}
      @keyframes ao-flow{to{stroke-dashoffset:-304}}
      .ao-atom{width:185px;height:185px;position:relative;filter:drop-shadow(0 0 13px #36dfff8a);flex-shrink:0;transform:rotate(-15deg)}
      .ao-orbit{position:absolute;inset:42px 0;border:2px solid #74e7ff;border-radius:50%;box-shadow:0 0 12px #00cfff5c;transform:rotate(35deg)}
      .ao-one{animation:ao-spin 10s linear infinite}.ao-two{animation:ao-spin 13s linear infinite reverse;transform:rotate(95deg)}.ao-three{animation:ao-spin 16s linear infinite;transform:rotate(155deg)}
      .ao-nucleus{position:absolute;top:calc(50% - 12px);left:calc(50% - 12px);width:24px;height:24px;border-radius:50%;background:#a7f8ff;box-shadow:0 0 16px #22e7ff,0 0 38px #22e7ff;animation:ao-pulse 3s ease-in-out infinite}
      @keyframes ao-spin{to{transform:rotate(395deg)}}@keyframes ao-pulse{50%{box-shadow:0 0 30px #22e7ff,0 0 70px #22e7ff}}
      .ao-content{position:relative;z-index:1;padding:clamp(14px,2.3vw,28px);max-width:1550px;margin:auto;min-width:0}
      .ao-head{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:22px 25px;border:1px solid #4ddcff4d;background:linear-gradient(105deg,#0c2b49e9,#0a1930ee);border-radius:18px;box-shadow:0 12px 40px #02071380}
      .ao-eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:2px;font-weight:800;color:#7be9ff}.ao-title{font-size:clamp(24px,2.8vw,36px);line-height:1.1;font-weight:900;letter-spacing:-.6px;margin:9px 0}.ao-gradient{background:linear-gradient(90deg,#5deaff,#c1a1ff);-webkit-background-clip:text;background-clip:text;color:transparent}.ao-desc{font-size:13px;line-height:1.65;color:#c8dbed;max-width:710px;margin:0}
      .ao-user{display:flex;align-items:center;gap:12px;min-width:0;font-size:12px;color:#dbeaff}.ao-user span{display:block;word-break:break-all}.ao-user button{border-radius:10px;border:1px solid #476585;background:#0d2846;color:white;padding:9px 12px;cursor:pointer;display:flex;align-items:center;gap:6px;flex-shrink:0}
      .ao-nav{display:flex;gap:9px;overflow-x:auto;margin:18px 0 19px;padding:5px 0}.ao-nav button{white-space:nowrap;display:flex;align-items:center;gap:8px;border-radius:11px;border:1px solid #32516d;padding:10px 14px;background:#0b2541;color:#bed9f0;font-weight:750;font-size:12px;cursor:pointer;transition:background .2s,border-color .2s}.ao-nav button:hover{background:#153f64}.ao-nav button[aria-selected=true]{border-color:#49dafa;background:#0a405a;color:white;box-shadow:inset 0 0 0 1px #39dcff44}
      .ao-section-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:0 0 13px}.ao-section-head h3{margin:0;font-size:17px;font-weight:850;color:#eef8ff}.ao-tag{display:inline-flex;align-items:center;gap:5px;font-size:10px;letter-spacing:.65px;font-weight:850;border-radius:20px;padding:5px 9px;border:1px solid currentColor}
      .ao-tag.cyan{color:#75e9ff;background:#063c52}.ao-tag.amber{color:#ffd78e;background:#49320e}.ao-tag.violet{color:#dec0ff;background:#38224f}.ao-tag.green{color:#95ffd0;background:#123f33}
      .ao-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px;margin-bottom:22px}
      .ao-card{min-width:0;min-height:143px;overflow:hidden;background:#0b2139ec;border:1px solid #2d526f;border-radius:14px;padding:16px;box-shadow:0 7px 25px #0005;position:relative}.ao-card.cyan{border-top:3px solid #50e8ff}.ao-card.amber{border-top:3px solid #f6ba51}.ao-card.violet{border-top:3px solid #bb8aff}.ao-card.green{border-top:3px solid #58e6ad}
      .ao-cardhead{display:flex;align-items:center;justify-content:space-between;gap:10px}.ao-cardhead h4{font-size:11px;letter-spacing:1.1px;font-weight:850;color:#c3d4e5;text-transform:uppercase;margin:0}.ao-card.cyan .ao-ic{color:#5cf0ff}.ao-card.amber .ao-ic{color:#ffce7a}.ao-card.violet .ao-ic{color:#d2afff}.ao-card.green .ao-ic{color:#8ef7c4}
      .ao-value{font-size:clamp(19px,2vw,26px);font-weight:900;color:white;line-height:1.12;margin:14px 0 7px}.ao-helper{font-size:12px;color:#b9d1e4;line-height:1.5;margin:0}
      .ao-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:15px;align-items:start}.ao-panel{min-width:0;background:linear-gradient(125deg,#09233eea,#081729f5);border:1px solid #305779;border-radius:16px;padding:18px;margin:0}.ao-panel h3{font-size:17px;font-weight:850;margin:0 0 6px}.ao-panel p{font-size:12px;line-height:1.6;color:#bdd2e3}.ao-minis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:17px}.ao-mini{min-width:0;border-radius:12px;background:#06182c;border:1px solid #254762;padding:13px}.ao-mini h4{font-size:11px;color:#8de3f5;margin:0 0 7px}.ao-mini strong{font-size:18px;color:white}.ao-mini p{margin:7px 0 0}.ao-alert{border-radius:12px;border:1px solid #355a74;background:#0b2943a8;padding:14px;display:flex;gap:11px;margin-top:10px}.ao-alert.amber{border-color:#9d7937;background:#3529136e}.ao-alert.violet{border-color:#7955a5;background:#30234570}.ao-alert .ao-ai{flex-shrink:0;color:#6ee8ff}.ao-alert.amber .ao-ai{color:#ffd37a}.ao-alert.violet .ao-ai{color:#d5afff}.ao-alert h4{font-size:13px;font-weight:850;margin:0}.ao-alert p{margin:5px 0 0}
      .ao-empty{padding:28px 20px;border:1px dashed #53819b;border-radius:15px;text-align:center;background:#0927418c}.ao-empty svg{color:#66e8ff;margin:auto}.ao-empty h3{font-size:17px;margin:11px 0 5px;font-weight:850}.ao-empty p{font-size:13px;max-width:540px;margin:auto;color:#bbd2e5;line-height:1.65}.ao-flowgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:16px}
      .ao-note{border-left:3px solid #ffc46b;border-radius:8px;background:#49300f6e;padding:12px 14px;color:#ffe4b7;font-size:12px;line-height:1.6;margin-top:15px}
      @media(max-width:1150px){.ao-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.ao-grid{grid-template-columns:1fr}.ao-atom{width:130px;height:130px}.ao-orbit{inset:30px 0}}
      @media(max-width:700px){.ao-content{padding:12px}.ao-head{padding:17px}.ao-atom{display:none}.ao-user{margin-top:13px}.ao-head{display:block}.ao-stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.ao-card{padding:12px;min-height:154px}.ao-minis{grid-template-columns:1fr}.ao-flowgrid{grid-template-columns:1fr}.ao-panel{padding:14px}}
      @media(max-width:390px){.ao-stats{grid-template-columns:1fr}}

      .ao-root.ao-advisor{background:linear-gradient(135deg,#071727,#0c2238);min-height:calc(100vh - 80px)}
      .ao-advisor .ao-content{max-width:1270px;padding:clamp(12px,2vw,24px)}
      .ao-advisor .ao-head{padding:14px 18px;border-radius:13px;gap:16px}
      .ao-advisor .ao-title{font-size:clamp(17px,2vw,22px);line-height:1.3;margin:4px 0}
      .ao-advisor .ao-eyebrow{font-size:9px;letter-spacing:1.1px}
      .ao-advisor .ao-user{font-size:12px}
      .ao-advisor .ao-user span{word-break:normal}
      .ao-advisor .ao-nav{margin:12px 0 14px}
      .ao-advisor .ao-nav button[aria-selected=true]{background:#f9a32b;color:#1a1209;border-color:#ffd78b;box-shadow:0 0 0 1px #ffc67066,0 0 16px #ff9b2d66}
      .ao-filter-bar{display:flex;gap:12px;align-items:end;justify-content:space-between;flex-wrap:wrap;margin:12px 0 16px}
      .ao-presets,.ao-state-filters{display:flex;gap:7px;flex-wrap:wrap}
      .ao-presets button,.ao-state-filters button{padding:9px 12px;border:1px solid #365b75;background:#09253d;color:#d1e9f6;border-radius:9px;font-size:12px;font-weight:750;cursor:pointer}
      .ao-presets button[aria-pressed=true],.ao-state-filters button[aria-pressed=true]{border-color:#ffb148;background:#4a2b13;color:#ffcc89}
      .ao-dates{display:flex;flex-wrap:wrap;gap:9px}
      .ao-dates label{font-size:11px;color:#a9d7eb;display:grid;gap:4px}
      .ao-dates input{color:#eef9ff;color-scheme:dark;background:#092239;border:1px solid #416a84;border-radius:8px;padding:9px;min-width:0;max-width:170px}
      .ao-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}
      .ao-kpi{border:1px solid #35546b;background:#0b243a;border-radius:11px;padding:14px;min-width:0}
      .ao-kpi strong{display:block;font-size:26px;margin:6px 0;color:#f5fbff}
      .ao-order-row{width:100%;background:#0b2236;color:#effaff;border:1px solid #406078;border-radius:11px;padding:12px 13px;display:flex;gap:12px;align-items:center;text-align:left;cursor:pointer;min-width:0}
      .ao-order-row strong{font-size:14px;white-space:nowrap}.ao-order-client{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
      .ao-order-detail{border:1px solid #355c75;border-top:0;border-radius:0 0 12px 12px;background:#092035;padding:15px;margin-top:-5px}
      .ao-order-status{font-size:11px;display:inline-flex;align-items:center;gap:5px;border-radius:40px;padding:6px 10px;border:1px solid currentColor;white-space:nowrap;font-weight:800}
      .ao-shopify-dot{display:inline-flex;align-items:center;gap:7px;font-size:11px;font-weight:750}
      .ao-shopify-dot:before{content:'';display:block;height:8px;width:8px;background:#46e79d;border-radius:50%;box-shadow:0 0 8px #46e79d}
      .ao-shopify-dot.off:before{background:#f26b77;box-shadow:0 0 8px #f26b77}
      @media(max-width:650px){.ao-advisor .ao-head{padding:11px 12px;display:flex;align-items:flex-start;flex-direction:column;gap:6px}.ao-advisor .ao-user{width:100%;margin-top:0;justify-content:space-between}.ao-advisor .ao-desc{display:none}.ao-advisor .ao-nav button{flex:1;justify-content:center}.ao-advisor .ao-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.ao-filter-bar{display:grid;gap:10px}.ao-dates{display:grid;grid-template-columns:1fr 1fr}.ao-dates input{width:100%;max-width:none}.ao-order-row{gap:7px;padding:11px 9px}.ao-order-row strong{font-size:12px}.ao-order-client{font-size:12px}.ao-order-status{font-size:10px;padding:5px 7px}.ao-order-detail{padding:12px}.ao-advisor .ao-panel{padding:12px}}
      @media(prefers-reduced-motion:reduce){.ao-root *{animation:none!important;transition:none!important}}
    `}</style>
    {admin&&<div className="ao-back"/>}{admin&&<svg className="ao-path" viewBox="0 0 1200 720" preserveAspectRatio="none" aria-hidden="true"><path d="M0 160 H150 V100 H390 V270 H590 V80 H800 V170 H1200" stroke="#56e5ff" fill="none" strokeWidth="1.5"/><path d="M0 610 H180 V450 H460 V590 H800 V420 H1200" stroke="#a68cfa" fill="none" strokeWidth="1.3"/><path d="M1200 90 H1000 V320 H740 V240 H500 V420 H100 V680" stroke="#4ceac2" fill="none" strokeWidth="1.3"/></svg>}
    <div className="ao-content">
      <header className="ao-head">
        <div style={{minWidth:0,flex:1}}><div className="ao-eyebrow">WINNER OS · {admin?'ADMINISTRACIÓN':'CONFIRMACIONES'}</div><h2 className="ao-title">{admin?'Dashboard de Confirmaciones IA':'Centro de Confirmaciones Inteligentes'}</h2>{admin&&<p className="ao-desc">Cohortes de Shopify y rendimiento de asesoras</p>}</div>
        {admin&&<div className="ao-atom-wrap"><Atom/></div>}
        <div className="ao-user"><div><small style={{color:'#8cdaed',fontWeight:800}}>{admin?'ADMINISTRADOR':'ASESORA'}</small><span>{!admin?(advisorName||user?.displayName||user?.email||'Sesión activa'):(user?.email||'Sesión activa')}</span></div>{!admin&&<button type="button" onClick={onLogout}><LogOut size={15}/> Salir</button>}</div>
      </header>
      {!admin&&<div role="status" aria-live="polite" style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',marginTop:12,fontSize:12,color:'#c9e5f1'}}>
        
        
        {pollError&&<span className="ao-tag amber">Sin conexión temporal; reintentando automáticamente</span>}
        {newOrderCount>0&&<button type="button" className="ao-tag amber" onClick={()=>{setTab('pedidos');setNewOrderCount(0);}} style={{cursor:'pointer',padding:'9px 13px'}}>🔔 {newOrderCount} pedido(s) nuevo(s) · Ver ahora</button>}
      </div>}
      <nav className="ao-nav" aria-label="Secciones del módulo de confirmaciones" role="tablist">
        {visibleTabs.map(item=>{const Icon=item.icon;return <button key={item.id} id={`ao-tab-${item.id}`} role="tab" type="button" aria-selected={tab===item.id} aria-controls="ao-tabpanel" onClick={()=>setTab(item.id)}><Icon size={15}/>{item.title}</button>})}
      </nav>
      <main role="tabpanel" id="ao-tabpanel" aria-labelledby={`ao-tab-${current.id}`}>
        {tab==='resumen'&&!admin&&<section className="ao-panel">
          <div className="ao-section-head"><h3>Mi operación</h3><span className={`ao-shopify-dot ${shopifyHealth==='active'?'':'off'}`}>Recepción Shopify: {shopifyHealth==='checking'?'verificando':shopifyHealth==='active'?'activa':'sin conexión verificada'}</span></div>
          {filterControls()}
          {inbox.status==='error'&&<div className="ao-note">No se pudieron consultar los pedidos: {inbox.error}</div>}
          <div className="ao-kpis">{[['Pendientes',counts.pending,'#ffd37a'],['Enviados',counts.sent,'#47b9ef'],['Confirmados',counts.confirmed,'#45cd96'],['Cancelados',counts.cancelled,'#f26b77'],['Duplicados',counts.duplicate||0,'#c17cf4']].map(([label,num,color])=><div className="ao-kpi" key={label}><span style={{color,fontSize:12,fontWeight:800}}>{label}</span><strong>{num}</strong></div>)}</div>
          <p style={{fontSize:11,color:'#93b8ca',margin:'12px 0 0'}}>Resultados de tus pedidos por fecha de asignación · {advisorDates.from} a {advisorDates.to}.</p>
        </section>}
        {tab==='pedidos'&&!admin&&<section className="ao-panel">
          <div className="ao-section-head"><h3>Mis pedidos</h3><span className="ao-shopify-dot">Bandeja automática · 15 s</span></div>
          {filterControls()}
          <div style={{display:'flex',gap:10,flexWrap:'wrap',margin:'10px 0',fontSize:12}}><span className="ao-tag amber">ATOM pendientes: {inbox.totals?.atomPending||0}</span><span className="ao-tag green">ATOM procesadas: {inbox.totals?.atomProcessed||0}</span></div>
          <div className="ao-state-filters" style={{margin:'8px 0 16px'}}>{[['all','Todos'],['pending','Pendientes'],['sent','Enviados'],['confirmed','Confirmados'],['cancelled','Cancelados'],['duplicate','Duplicados']].map(([v,label])=><button key={v} type="button" aria-pressed={advisorStatus===v} onClick={()=>{setAdvisorStatus(v);setAdvisorPage(0);setExpandedOrder(null);}}>{label} {v==='all'?counts.total:counts[v]}</button>)}</div>
          <details style={{marginBottom:14,color:'#a7d2e7',fontSize:12}}><summary style={{cursor:'pointer'}}>Nombre de asesora en WhatsApp {rememberAdvisorName?'🔒':''}</summary><div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',marginTop:9}}><input aria-label="Nombre de asesora para mensaje de WhatsApp" value={advisorName} disabled={rememberAdvisorName} onChange={e=>setAdvisorName(e.target.value.slice(0,80))} placeholder="Ej. Camila Londoño" style={{padding:10,borderRadius:8,color:'#fff',background:'#09263b',border:'1px solid #42738d',width:'100%',maxWidth:300,opacity:rememberAdvisorName?.73:1}}/><label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,cursor:'pointer'}}><input type="checkbox" checked={rememberAdvisorName} onChange={e=>changeAdvisorNameLock(e.target.checked)} style={{accentColor:'#45cd96',width:17,height:17}}/>Mantener este nombre en futuras sesiones</label></div><p style={{fontSize:11,color:'#89afc6',marginTop:7}}>{rememberAdvisorName?'Nombre bloqueado. Desmarca la casilla para cambiarlo.':'Al marcar, queda guardado en este navegador y para esta cuenta. No afecta a otras asesoras.'}</p></details>
          {inbox.status==='error'&&<div className="ao-note" role="alert">Error al consultar: {inbox.error}</div>}
          {inbox.status==='loading'&&<div className="ao-empty">Consultando pedidos…</div>}
          {inbox.status==='ready'&&inbox.orders.length===0&&<div className="ao-empty"><Package size={25}/><h3>Sin pedidos en este filtro</h3><p>Prueba otra fecha o estado.</p></div>}
          {inbox.status==='ready'&&inbox.orders.length>0&&<div style={{display:'grid',gap:9}}>{inbox.orders.map(o=><article key={o.id} style={{minWidth:0}}>
            <button type="button" className="ao-order-row" aria-expanded={expandedOrder===o.id} aria-controls={`ao-order-detail-${o.id}`} onClick={()=>{setExpandedOrder(v=>v===o.id?null:o.id);setMessagePreview(null);}} style={{borderLeft:`4px solid ${STATUS_STYLES[o.status]?.border||'#4b7188'}`,borderRadius:expandedOrder===o.id?'11px 11px 0 0':11}}>
              <strong>Pedido {o.number}</strong><span className="ao-order-client">{o.customerName||'Cliente sin nombre'}</span>
              <span className="ao-order-status" style={{color:STATUS_STYLES[o.status]?.tag||'#fff'}}>{(isOverdueOrder(o)||o.recentOrders?.length>0)&&<AlertTriangle size={13}/>} {ORDER_STATUS_LABELS[o.status]||o.status}</span>{o.risk&&<span className="ao-order-status" style={{color:'#edb0ff',borderColor:'#b94ce5'}}><AlertTriangle size={13}/> Riesgo duplicado</span>}{o.wasTransferred&&<span className="ao-order-status" style={{color:'#e9adff'}}>{['confirmed','cancelled','duplicate'].includes(o.status)?'Transferencia resuelta':'Transferido'}</span>}
              <span style={{fontSize:15,color:'#9ac6dc'}}>{expandedOrder===o.id?'▴':'▾'}</span>
            </button>
            {expandedOrder===o.id&&<div id={`ao-order-detail-${o.id}`} className="ao-order-detail" style={{borderLeft:`4px solid ${STATUS_STYLES[o.status]?.border||'#4b7188'}`}}>
              {o.risk&&<div className="ao-note" style={{borderLeft:'3px solid #c769ef',background:'#2a1739'}}><b>⚠ Riesgo duplicado</b> · {o.risk.details?.similarOrderIds?.length||0} pedido(s) relacionados. {o.risk.details?.previousAdvisorId?`Pedido previo asignado a ${directory.find(a=>a.advisor_id===o.risk.details.previousAdvisorId)?.display_name||'otra asesora'}. No implica que ya haya contactado al cliente.`:'No hay historial verificado de una asesora que haya atendido antes; este pedido permanece Pendiente.'} Confirmar con el cliente antes de cerrar la gestión.</div>}{o.transfers?.length>0&&<details style={{marginTop:8}}><summary>Historial de transferencias ({o.transfers.length})</summary>{o.transfers.map((t,i)=><p key={i}>{t.from} → {t.to} · {new Date(t.at).toLocaleString('es-CO')} · {t.note||'Sin nota'}</p>)}</details>}{isOverdueOrder(o)&&<div className="ao-note" role="status">⚠️ Este pedido lleva más de 48 horas en estado {ORDER_STATUS_LABELS[o.status]||o.status}. Validar seguimiento.</div>}
              {o.recentOrders?.length>0&&<div className="ao-note" role="status">⚠️ Cliente con {o.recentOrders.length} pedido(s) adicional(es) registrados en los últimos 7 días: {o.recentOrders.map(x=>x.number).join(', ')}. Confirmar que la compra es intencional.</div>}
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))',gap:13,marginTop:16}}>
              <div><p><b style={{color:'#6de7ff'}}>CLIENTE</b></p><p style={{color:'#e6f4ff'}}>{o.customerName||'No registrado'}</p><p>Teléfono: {o.customerPhone||'No registrado'}</p><p>Ciudad: {o.city||'No registrada'}</p></div>
              <div><p><b style={{color:'#f9c56b'}}>DIRECCIÓN DE ENTREGA</b></p><p>{[o.address?.address1,o.address?.address2].filter(Boolean).join(', ')||'No registrada'}</p><p>{[o.address?.city,o.address?.province,o.address?.zip].filter(Boolean).join(' · ')||'Ubicación incompleta'}</p><p style={{fontSize:11,color:'#a8becf'}}>Dirección original Shopify; verificar antes de confirmar.</p></div>
              <div><p><b style={{color:'#c7a4ff'}}>PEDIDO</b></p><p>{(o.items||[]).map(i=>`${i.quantity} × ${i.title}${i.variant?' ('+i.variant+')':''}`).join(' · ')||'Sin detalle'}</p><p>Valor: {o.total||'—'}</p><p>Fecha: {o.createdAt}</p></div>
            </div>

            {o.status==='confirmed'&&<div style={{marginTop:14,padding:13,border:'1px solid #438971',borderRadius:12,background:'#0a302c'}}><b style={{color:'#78edb8'}}>Control de carga a ATOM</b><div style={{marginTop:8,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}><span style={{color:o.atomProcessingStatus==='processed'?'#6befb3':'#ffd78c',fontWeight:800}}>{o.atomProcessingStatus==='processed'?'✓ Procesada en ATOM':'● Pendiente por procesar'}</span><button type="button" disabled={atomBusy!==0} onClick={()=>changeAtomStatus(o,o.atomProcessingStatus==='processed'?'pending':'processed')} className="ao-tag green" style={{padding:'9px 13px'}}>{o.atomProcessingStatus==='processed'?'Volver a pendiente':'Marcar procesada'}</button></div></div>}
            {!['confirmed','cancelled','duplicate'].includes(o.status)&&<button type="button" className="ao-tag cyan" style={{padding:11,marginTop:10}} onClick={()=>{setTransferModal({id:o.id,target:''});setTransferNote('');}}>Transferir a otra asesora</button>}{o.timeline?.length>0&&<details style={{marginTop:14,border:'1px solid #34576d',padding:12,borderRadius:10}}><summary style={{cursor:'pointer',fontWeight:750,color:'#8fe5f7'}}>Historial de gestiones ({o.timeline.length})</summary>{o.timeline.map((event,i)=><div key={i} style={{borderTop:'1px solid #25445b',padding:'9px 0',fontSize:12}}><b>{ORDER_STATUS_LABELS[event.action]||event.action}</b> · {new Date(event.at).toLocaleString('es-CO')} · {event.note||'Sin nota'}</div>)}</details>}
            <div style={{display:'flex',flexWrap:'wrap',gap:10,marginTop:16,alignItems:'center'}}>
              <button type="button" onClick={()=>setMessagePreview(messagePreview===o.id?null:o.id)} className="ao-tag cyan" style={{padding:'10px 14px'}}>Vista previa del mensaje</button><button type="button" onClick={()=>copyMessage(o)} className="ao-tag violet" style={{padding:'10px 14px'}}>Copiar mensaje</button>{whatsAppLink(o)?<a href={whatsAppLink(o)} target="_blank" rel="noopener noreferrer" className="ao-tag green" style={{padding:'10px 14px',textDecoration:'none'}}>Abrir WhatsApp (envío manual)</a>:<span className="ao-tag amber">Teléfono no válido para enlace WhatsApp</span>}
              <span style={{color:'#b1cddd',fontSize:11}}>La asesora envía por WhatsApp y después marca «Enviado». Abrir WhatsApp por sí solo no cambia el estado.</span>
            </div>
            {messagePreview===o.id&&<div style={{marginTop:10,padding:16,border:'1px solid #3886a7',background:'#09263d',borderRadius:12}}><div style={{fontWeight:800,color:'#74e8fa',marginBottom:10}}>Mensaje preparado para revisar y copiar</div><textarea readOnly value={formatConfirmMessage(o)} rows={15} style={{width:'100%',padding:12,whiteSpace:'pre-wrap',background:'#061b2b',color:'#f2fbff',border:'1px solid #3b7188',borderRadius:10}}/><p style={{fontSize:12,color:'#ffd483'}}>Comprueba nombre de asesora, dirección y valor. No promete una fecha de entrega ni descuentos no verificados.</p></div>}
            <div style={{marginTop:14,display:'grid',gap:9}}>
              <label style={{fontSize:12,color:'#d0e7fa'}}>Nota de gestión opcional (máximo 500 caracteres)</label>
              <textarea value={notes[o.id]||''} maxLength={500} onChange={e=>setNotes(s=>({...s,[o.id]:e.target.value}))} rows={2} placeholder="Qué respondió el cliente o qué se debe corregir…" style={{width:'100%',background:'#06192c',border:'1px solid #41647b',borderRadius:9,padding:11,color:'#f0faff'}}/>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{[['sent','Enviado'],['confirmed','Confirmado'],['cancelled','Cancelado'],['duplicate','Pedido duplicado']].map(([action,label])=><button type="button" key={action} disabled={!actionEnabled||actionState.busy!==0||(['confirmed','cancelled','duplicate'].includes(o.status)||(action==='sent'&&o.status!=='pending'))} onClick={()=>setConfirmAction({order:o,action})} style={{padding:'9px 12px',border:'1px solid #40718e',borderRadius:9,background:'#123454',color:'#e7f9ff',opacity:!actionEnabled?.5:1,cursor:actionEnabled?'pointer':'not-allowed'}}>{label}</button>)}</div>
              {!actionEnabled&&<p style={{fontSize:12,color:'#ffd58c'}}>Las acciones están en modo protegido hasta activar ORDER_ACTIONS_ENABLED y validar la migración de auditoría.</p>}
            </div>
            </div>}
          </article>)}</div>}
          {inbox.status==='ready'&&<div style={{display:'flex',gap:9,alignItems:'center',justifyContent:'space-between',marginTop:16}}><button type="button" className="ao-tag cyan" style={{padding:10,opacity:advisorPage===0?.45:1}} disabled={advisorPage===0} onClick={()=>{setAdvisorPage(p=>Math.max(0,p-1));setExpandedOrder(null);}}>← Anterior</button><span style={{fontSize:12,color:'#a9d4e8'}}>Página {advisorPage+1}</span><button type="button" className="ao-tag cyan" style={{padding:10,opacity:inbox.hasMore?1:.45}} disabled={!inbox.hasMore} onClick={()=>{setAdvisorPage(p=>p+1);setExpandedOrder(null);}}>Siguiente →</button></div>}
          {atomMessage&&<div className="ao-note" role="status">{atomMessage}</div>}
          {actionState.message&&<div className="ao-note" role="status">{actionState.message}</div>}
          {confirmAction&&<div role="presentation" style={{position:'fixed',inset:0,zIndex:99999,background:'rgba(0,8,19,.79)',display:'grid',placeItems:'center',padding:18}} onClick={()=>actionState.busy===0&&setConfirmAction(null)}>
            <div role="dialog" aria-modal="true" aria-label="Confirmar cambio de estado" onClick={e=>e.stopPropagation()} style={{maxWidth:450,width:'100%',border:`1px solid ${STATUS_STYLES[confirmAction.action]?.border||'#47b9ef'}`,background:'linear-gradient(145deg,#102c43,#061725)',boxShadow:'0 24px 80px #000a',borderRadius:20,padding:26,color:'#eefbff'}}>
              <ShieldCheck size={35} color={STATUS_STYLES[confirmAction.action]?.tag||'#47b9ef'}/>
              <h3 style={{fontSize:23,margin:'12px 0 6px'}}>Confirmar {ORDER_STATUS_LABELS[confirmAction.action]}</h3>
              <p style={{color:'#a9cfe3'}}>Pedido {confirmAction.order.number} · {confirmAction.order.customerName||'Cliente'}</p>
              {confirmAction.action==='duplicate'&&<p style={{color:'#e5baff',fontWeight:700}}>Marca esta opción solo después de verificar con el cliente que el pedido repite otra solicitud. No se contabilizará como confirmación válida.</p>}<p>¿Deseas cambiar el estado a <strong style={{color:STATUS_STYLES[confirmAction.action]?.tag}}>{ORDER_STATUS_LABELS[confirmAction.action]}</strong>?</p>
              {['confirmed','cancelled','duplicate'].includes(confirmAction.action)&&<p style={{color:'#ffd28b',fontSize:13}}>Esta acción cierra la tarea y no podrá modificarse después.</p>}
              <p style={{color:'#a4bfd2',fontSize:12}}>La nota es opcional. El cambio quedará registrado en la auditoría.</p>{actionState.message&&<div role="alert" style={{padding:12,marginTop:12,borderRadius:10,background:'#4b2429',border:'1px solid #f26b77',color:'#fff1f1',fontSize:13}}>No se pudo guardar: {actionState.message}</div>}
              <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:22}}><button type="button" disabled={actionState.busy!==0} onClick={()=>setConfirmAction(null)} style={{padding:'11px 17px',borderRadius:10,border:'1px solid #507189',color:'#ecf8ff',background:'#1a3548'}}>Volver</button><button type="button" disabled={actionState.busy!==0} onClick={()=>updateOrder(confirmAction.order,confirmAction.action)} style={{padding:'11px 17px',borderRadius:10,border:0,fontWeight:800,color:'#051724',background:STATUS_STYLES[confirmAction.action]?.tag||'#47b9ef'}}>Sí, guardar estado</button></div>
            </div>
          </div>}
        </section>}
        {tab==='eliminar'&&admin&&<section className="ao-panel">
          <div className="ao-section-head"><h3>Eliminar pedidos de prueba</h3><span className="ao-tag amber">Solo administrador</span></div>
          <p style={{color:'#b9d2e2',fontSize:13}}>Busca el número de pedido y selecciónalo. Se eliminará únicamente de Confirmaciones D1; no de Shopify ni de ATOM. Esta operación no se puede deshacer.</p>
          <div style={{display:'flex',gap:9,flexWrap:'wrap',margin:'15px 0'}}>
            <input aria-label="Buscar número de pedido" placeholder="Ej. #26618" value={deleteSearch} onChange={e=>setDeleteSearch(e.target.value.slice(0,70))} onKeyDown={e=>{if(e.key==='Enter')searchDeletableOrders();}} style={{flex:'1 1 190px',minWidth:0,padding:12,background:'#0a273e',color:'#fff',border:'1px solid #416983',borderRadius:9}} />
            <button type="button" className="ao-tag cyan" onClick={()=>searchDeletableOrders()} disabled={deleteList.loading}>{deleteList.loading?'Buscando…':'Buscar pedidos'}</button>
          </div>
          {deleteList.error&&<div className="ao-note" role="alert">{deleteList.error}</div>}
          <div style={{display:'grid',gap:8}}>{deleteList.items.map(o=><button type="button" key={o.id} onClick={()=>{setDeleteDraft({id:o.id,number:o.number});setAtomMessage('');}} style={{padding:12,textAlign:'left',cursor:'pointer',borderRadius:10,border:`1px solid ${deleteDraft?.id===o.id?'#ef9b83':'#33536e'}`,background:deleteDraft?.id===o.id?'#382326':'#0b263d',color:'#effaff',display:'flex',gap:12,alignItems:'center',justifyContent:'space-between'}}><span><strong>{o.number}</strong> <span style={{fontSize:11,color:'#b5cad9'}}>· {new Date(o.createdAt).toLocaleDateString('es-CO')}</span></span><span style={{fontSize:12,color:'#ffd6ae'}}>{deleteDraft?.id===o.id?'Seleccionado':'Seleccionar'}</span></button>)}</div>
          {deleteList.items.length===0&&!deleteList.loading&&!deleteList.error&&<p style={{fontSize:12,color:'#a2bfce'}}>Escribe el número del pedido y pulsa Buscar.</p>}
          {deleteDraft&&<div style={{border:'1px solid #c77d77',borderRadius:12,padding:15,marginTop:18,background:'#301d2b'}}><strong style={{color:'#ffd4c5'}}>Eliminar {deleteDraft.number}</strong><p style={{fontSize:12,color:'#f0c2b8'}}>Esta acción elimina definitivamente el pedido seleccionado y sus gestiones de Confirmaciones D1. Verifica que sea de prueba.</p><div style={{display:'flex',gap:10,flexWrap:'wrap'}}><button type="button" className="ao-tag amber" onClick={deleteTestOrder} disabled={deleteBusy}>{deleteBusy?'Eliminando…':'Eliminar pedido seleccionado'}</button><button type="button" className="ao-tag cyan" onClick={()=>setDeleteDraft(null)}>Cancelar</button></div></div>}
          {atomMessage&&<div className="ao-note" role="status" style={{marginTop:12}}>{atomMessage}</div>}
        </section>}
        {tab==='estadisticas'&&admin&&<section className="ao-panel">
          <div className="ao-section-head"><h3>Confirmaciones · Dashboard administrativo</h3><span className="ao-tag violet">Cohortes por fecha de pedido</span></div>
          <p style={{fontSize:13,color:'#b4cbe0'}}>Datos reales de D1, separados del Dashboard comercial de WINNER OS. Los pedidos confirmados después siguen atribuidos a su fecha original.</p>
          <div style={{display:'flex',gap:12,alignItems:'end',flexWrap:'wrap',margin:'18px 0'}}>
            <label style={{fontSize:12,color:'#87e6fa'}}>Desde <input type="date" value={dateRange.from} onChange={e=>setDateRange(x=>({...x,from:e.target.value}))} style={{display:'block',color:'#fff',background:'#09243a',border:'1px solid #47748f',borderRadius:9,padding:9}}/></label>
            <label style={{fontSize:12,color:'#87e6fa'}}>Hasta <input type="date" value={dateRange.to} onChange={e=>setDateRange(x=>({...x,to:e.target.value}))} style={{display:'block',color:'#fff',background:'#09243a',border:'1px solid #47748f',borderRadius:9,padding:9}}/></label>
            <button type="button" onClick={fetchDashboard} disabled={dashboard.status==='loading'} className="ao-tag cyan" style={{padding:11}}>Consultar estadísticas</button>
          </div>
          {dashboard.status==='loading'&&<div className="ao-note">Consultando estadísticas de D1…</div>}
          {dashboard.status==='error'&&<div className="ao-note" role="alert">Error de consulta: {dashboard.error}</div>}
          {dashboard.status==='ready'&&dashboard.data&&<>
            <p style={{fontSize:12,color:'#98c8e1'}}>Período: {dashboard.data.from} a {dashboard.data.to} · Zona horaria Colombia</p>
            {dashboard.data.daily.some(d=>d.date===colombiaToday())&&<div style={{display:'flex',flexWrap:'wrap',gap:10,margin:'12px 0'}}><span className="ao-tag cyan">Facturación apta HOY: {money(dashboard.data.daily.find(d=>d.date===colombiaToday())?.eligibleBilling||0)}</span><span className="ao-tag green">Confirmados HOY: {money(dashboard.data.daily.find(d=>d.date===colombiaToday())?.confirmedBilling||0)}</span></div>}
            <div className="ao-grid" style={{margin:'15px 0'}}>{[
              ['Pedidos recibidos (período)',dashboard.data.totals.received,'cyan'],
              ['Pedidos recibidos (histórico)',dashboard.data.totals.allTimeReceived??dashboard.data.totals.received,'cyan'],
              ['Válidos para rendimiento',dashboard.data.totals.validForPerformance??dashboard.data.totals.eligible,'green'],
              ['Facturación apta para rendimiento',money(dashboard.data.totals.eligibleBilling),'cyan'],
              ['Facturación de pedidos confirmados',money(dashboard.data.totals.confirmedBilling),'green'],
              ['Confirmados pendientes de subir a ATOM',dashboard.data.totals.atomPending||0,'amber'],
              ['Confirmados procesados en ATOM',dashboard.data.totals.atomProcessed||0,'green'],
              ['Pendientes',dashboard.data.totals.pending||0,'amber'],
              ['Enviados',dashboard.data.totals.sent||0,'cyan'],
              ['Alertas +48 h',dashboard.data.totals.overdue||0,'amber'],
              ['Confirmados',dashboard.data.totals.confirmed,'green'],
              ['Cancelados',dashboard.data.totals.cancelled,'amber'],
              ['Duplicados verificados',dashboard.data.totals.duplicate||0,'violet'],

              ['Sin asignar',dashboard.data.totals.unassigned,'cyan'],
              ['Tasa de confirmación',`${dashboard.data.totals.confirmationRate}%`,'green'],
              ['Tiempo medio hasta confirmar',dashboard.data.totals.averageConfirmationHours===null?'Sin datos':`${dashboard.data.totals.averageConfirmationHours} h`,'violet'],
            ].map(([label,val,tone])=><div key={label} className={`ao-card ${tone}`}><h4 style={{fontSize:12,color:'#b2daea'}}>{label}</h4><div className="ao-value" style={{fontSize:25}}>{val}</div></div>)}</div>
            <div style={{overflowX:'auto',marginTop:20}}><h4 style={{fontSize:17,color:'#7ce7fa',marginBottom:10}}>Rendimiento por asesora</h4><table style={{width:'100%',borderCollapse:'collapse',fontSize:13,minWidth:600}}><thead><tr>{['Asesora','Recibidos','Confirmados','Cancelados','Duplicados','Pendientes','Enviados','+48 h'].map(h=><th key={h} style={{padding:10,borderBottom:'1px solid #41657a',textAlign:'left',color:'#93dbe9'}}>{h}</th>)}</tr></thead><tbody>{dashboard.data.advisors.map(a=><tr key={a.advisorId}><td style={{padding:10,borderBottom:'1px solid #25445b'}}><button type="button" className="ao-tag cyan" style={{padding:'7px 10px'}} onClick={()=>{setAdminAdvisor(a.advisorId);setAdminPage(0);setAdminOpenedOrder(null);setTab('asesoras')}}>Ver asesora · {a.name}</button></td>{[a.received,a.confirmed,a.cancelled,a.duplicate||0,a.pending,a.sent,a.overdue].map((v,i)=><td key={i} style={{padding:10,borderBottom:'1px solid #25445b',color:'#f1faff'}}>{v}</td>)}</tr>)}</tbody></table>{!dashboard.data.advisors.length&&<p style={{color:'#b4cbe0'}}>No hay asignaciones en este período.</p>}</div>
            <div style={{overflowX:'auto',marginTop:24}}><h4 style={{fontSize:17,color:'#cba9ff',marginBottom:10}}>Evolución diaria por fecha original</h4><table style={{width:'100%',borderCollapse:'collapse',fontSize:13,minWidth:500}}><thead><tr>{['Fecha','Recibidos','Confirmados','Cancelados','Duplicados','Pendientes','Enviados','+48 h','Sin asignar'].map(h=><th key={h} style={{padding:10,textAlign:'left',borderBottom:'1px solid #41657a',color:'#cba9ff'}}>{h}</th>)}</tr></thead><tbody>{dashboard.data.daily.map(d=><tr key={d.date}>{[d.date,d.received,d.confirmed,d.cancelled,d.duplicate||0,d.pending,d.sent,d.overdue,d.unassigned].map((v,i)=><td key={i} style={{padding:9,color:'#f0faff',borderBottom:'1px solid #25445b'}}>{v}</td>)}</tr>)}</tbody></table></div>
            <p style={{fontSize:12,color:'#a7c4d6',marginTop:15}}>Pruebas o descartes dentro de recibidos (excluidos únicamente del rendimiento): {dashboard.data.totals.excluded}. Las cohortes pendientes pueden cambiar al confirmar pedidos posteriormente.</p>
          </>}
        </section>}
        {tab==='asesoras'&&admin&&<section className="ao-panel"><div style={{padding:14,marginBottom:12,border:'1px solid #a45bd4',borderRadius:12}}><h3>Historial de transferencias</h3><button className="ao-tag cyan" onClick={()=>loadTransferHistory(0)}>Actualizar historial</button>{transferHistory.error&&<p>{transferHistory.error}</p>}{(transferHistory.items||[]).map(t=><p key={t.id} style={{padding:'8px 0',borderBottom:'1px solid #364960'}}>Pedido {t.order_number}: {t.from_name} → {t.to_name} · {new Date(t.created_at).toLocaleString('es-CO')} · {t.current_status} · {t.note||'Sin nota'}</p>)}{transferHistory.hasMore&&<button className="ao-tag cyan" onClick={()=>loadTransferHistory(transferHistory.page+1)}>Siguientes transferencias</button>}</div>
          <div className="ao-section-head"><h3>Pedidos y gestiones por asesora</h3><span className="ao-tag cyan">Administrador · Solo lectura</span></div>
          <p style={{fontSize:13,color:'#b4cbe0'}}>Consulta las órdenes asignadas, su resultado y el historial de acciones. No modifica estados, no abre WhatsApp ni envía mensajes.</p>
          <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center',margin:'16px 0'}}>
            <label style={{fontSize:12,color:'#95e3f2'}}>Asesora <select value={adminAdvisor} onChange={e=>{setAdminAdvisor(e.target.value);setAdminPage(0);setAdminOpenedOrder(null)}} style={{display:'block',padding:10,background:'#09243a',color:'#fff',border:'1px solid #47748f',borderRadius:9,minWidth:220}}>
              <option value="">Todas las asesoras</option>
              {(dashboard.data?.advisors||[]).map(a=><option key={a.advisorId} value={a.advisorId}>{a.name}</option>)}
            </select></label>
            <button type="button" className="ao-tag cyan" style={{padding:11}} onClick={()=>fetchAdminOrders(adminAdvisor,adminPage)}>Actualizar pedidos</button>
            <span style={{color:'#a9d3e9',fontSize:12}}>Página {adminPage+1} · hasta 50 pedidos por página</span>
          </div>
          {adminOrders.status==='loading'&&<div className="ao-note">Consultando pedidos de D1…</div>}
          {adminOrders.status==='error'&&<div className="ao-note" role="alert">Error: {adminOrders.error}</div>}
          {adminOrders.status==='ready'&&<>
            {!adminOrders.orders.length&&<div className="ao-note">No hay pedidos asignados a esta asesora en esta página.</div>}
            <div style={{display:'grid',gap:9}}>{adminOrders.orders.map(o=><article key={o.id} style={{padding:14,background:STATUS_STYLES[o.status]?.background||'#09243a',border:`2px solid ${STATUS_STYLES[o.status]?.border||'#31536a'}`,borderRadius:12}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10}}>
                <div><strong style={{color:'#f0fbff'}}>Pedido {o.number}</strong> <span className="ao-tag cyan" style={{marginLeft:8}}>{isOverdueOrder(o)&&"⚠ +48h · "}{ORDER_STATUS_LABELS[o.status]||o.status}</span><div style={{fontSize:12,color:'#a4c9dc',marginTop:5}}>{o.advisorName||'Asesora'} · {o.createdAt?new Date(o.createdAt).toLocaleString('es-CO'): 'Sin fecha'} · {money(o.total)}</div></div>
                <button type="button" className="ao-tag violet" style={{padding:'10px 12px'}} onClick={()=>setAdminOpenedOrder(adminOpenedOrder===o.id?null:o.id)}>{adminOpenedOrder===o.id?'Ocultar pedido':'Ver pedido y gestiones'}</button>
              </div>
              {adminOpenedOrder===o.id&&<div style={{marginTop:14,padding:12,background:'#061b2b',border:'1px solid #365c72',borderRadius:10}}>
                <p><b>Cliente:</b> {o.customerName||'Sin dato'} · <b>Teléfono:</b> {o.customerPhone||'Sin dato'}</p>
                <p><b>Dirección:</b> {[o.address?.address1,o.address?.address2,o.address?.city,o.address?.province].filter(Boolean).join(' / ')||'Sin dato'}</p>
                <p><b>Productos:</b></p><ul style={{paddingLeft:20}}>{(o.items||[]).map((item,i)=><li key={i}>{item.quantity||1} × {item.title}{item.variant?' · '+item.variant:''}</li>)}</ul>
                <h4 style={{marginTop:14,color:'#85e5f7'}}>Historial de gestiones</h4>
                {!o.timeline?.length?<p style={{fontSize:12,color:'#b4cbe0'}}>Todavía no tiene acciones registradas.</p>:(o.timeline||[]).map((event,i)=><div key={i} style={{padding:'10px 0',borderTop:'1px solid #31536a',fontSize:12}}><strong>{ORDER_STATUS_LABELS[event.action]||event.action}</strong> · {event.at?new Date(event.at).toLocaleString('es-CO'):'Sin fecha'}<div style={{color:'#c8dfed',marginTop:3}}>Nota: {event.note||'Sin nota'}</div><div style={{color:'#8baebf'}}>Registró: {event.actorUid===o.advisorId?o.advisorName:(event.actorUid||'Usuario')}</div></div>)}
                {o.timeline?.length>=10&&<p style={{color:'#ffd18a',fontSize:12}}>Se muestran las últimas 10 gestiones de este pedido.</p>}
              </div>}
            </article>)}</div>
            <div style={{display:'flex',gap:10,marginTop:17}}><button type="button" disabled={adminPage===0||adminOrders.status==='loading'} className="ao-tag cyan" style={{padding:11,opacity:adminPage===0?.5:1}} onClick={()=>{setAdminPage(p=>Math.max(0,p-1));setAdminOpenedOrder(null)}}>Anterior</button><button type="button" disabled={!adminOrders.hasMore||adminOrders.status==='loading'} className="ao-tag cyan" style={{padding:11,opacity:adminOrders.hasMore?1:.5}} onClick={()=>{setAdminPage(p=>p+1);setAdminOpenedOrder(null)}}>Siguiente</button></div>
          </>}
        </section>}
        {tab==='alertas'&&<section className="ao-panel"><div className="ao-section-head"><h3>Alertas inteligentes para trato especial</h3><span className="ao-tag cyan"><Bell size={12}/> Reglas de revisión</span></div>{inbox.status==='ready'&&<div style={{display:'grid',gap:8,margin:'12px 0'}}>{inbox.orders.filter(o=>o.recentOrders?.length>0).length===0?<div className="ao-note">No se detectaron coincidencias telefónicas recientes entre los pedidos de esta bandeja.</div>:inbox.orders.filter(o=>o.recentOrders?.length>0).map(o=><div className="ao-note" key={o.id}>⚠️ <strong>{o.number}</strong> · {o.recentOrders.length} pedido(s) coincidentes: {o.recentOrders.map(r=>r.number).join(', ')}. Revisar con el cliente.</div>)}</div>}<p>Señales que WINNER OS revisará con los pedidos recibidos. Las coincidencias telefónicas de los últimos siete días se muestran arriba cuando existen; requieren revisión humana.</p><div className="ao-grid" style={{marginTop:16}}>{ALERTS.map(a=>{const Icon=a.icon;return <article key={a.title} className={`ao-alert ${a.tone}`}><Icon size={21} className="ao-ai"/><div><h4>{a.title}</h4><p>{a.detail}</p></div></article>})}</div></section>}
        {tab==='distribucion'&&admin&&<section className="ao-panel">
          <div className="ao-section-head"><h3>Distribución automática · Supervisión</h3><button type="button" className="ao-tag cyan" onClick={fetchDistribution}>Actualizar estado</button></div>
          <p>Orden de prioridad de las asesoras, máximo 30 pedidos NUEVOS por asesora cada día de Colombia. No reasigna pedidos confirmados o ya asignados. WhatsApp permanece manual.</p>
          {distribution.status==='loading'&&<div className="ao-note">Consultando datos en D1…</div>}
          {distribution.error&&<div className="ao-note" role="alert">{distribution.error}</div>}
          {distribution.notice&&<div className="ao-note" role="status">{distribution.notice}</div>}
          {distribution.data&&<>
            <div className="ao-minis"><div className="ao-mini"><h4>Pendientes analizados</h4><strong>{distribution.data.preview.pendingCount}</strong></div><div className="ao-mini"><h4>Elegibles</h4><strong>{distribution.data.preview.eligible}</strong></div><div className="ao-mini"><h4>En revisión</h4><strong>{distribution.data.preview.held}</strong></div></div>
            <p style={{marginTop:12,color:'#ffda98'}}>Análisis de hasta 100 pendientes. El historial se compara mediante índice persistente de coincidencias. Los riesgos se notifican a las asesoras.</p>
            <div style={{overflowX:'auto',marginTop:15}}><table style={{width:'100%',minWidth:440,fontSize:13,borderCollapse:'collapse'}}><thead><tr><th style={{textAlign:'left'}}>Asesora</th><th>Prioridad</th><th>Asignaciones de hoy</th><th>Cupo disponible</th></tr></thead><tbody>{(distribution.data.capacity.advisors||[]).map(a=><tr key={a.advisor_id}><td style={{padding:10}}>{a.display_name}</td><td style={{textAlign:'center'}}>{a.priority}</td><td style={{textAlign:'center'}}>{a.used_today}</td><td style={{textAlign:'center'}}>{Math.max(0,30-Number(a.used_today||0))}</td></tr>)}</tbody></table></div>
            <div style={{display:'flex',gap:12,alignItems:'center',marginTop:18,flexWrap:'wrap'}}><span className={`ao-tag ${distribution.data.assignmentsEnabled?'green':'amber'}`}>{distribution.data.assignmentsEnabled?'Reparto habilitado':'Reparto desactivado en Cloudflare'}</span></div>
            <p>Los pedidos elegibles se asignan automáticamente al llegar desde Shopify. Cloudflare revisa y recupera asignaciones pendientes cada minuto. Las asesoras resuelven los riesgos de duplicado.</p>
          </>}
        </section>}
        {tab==='administrar'&&admin&&<section className="ao-panel">
          <div className="ao-section-head"><h3>Administrar asesoras · Operación inmediata</h3><button type="button" className="ao-tag cyan" onClick={refreshAdvisorsV114}>Actualizar</button></div>
          <p>Supervisa las asesoras y sus cupos. La distribución y recuperación de pedidos funcionan automáticamente. Puedes pausar asesoras o cambiar prioridades cuando lo necesites.</p>
          {advisorAdmin.error&&<div className="ao-note" role="alert">{advisorAdmin.error}</div>}
          {advisorAdmin.message&&<div className="ao-note" role="status">{advisorAdmin.message}</div>}
          <details style={{marginTop:15}}><summary style={{cursor:'pointer',color:'#8adfec'}}>Configuración avanzada · vincular cuenta existente</summary><div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:15}}>
            <input aria-label="UID Firebase asesora" placeholder="UID de Firebase" value={advisorDraft.advisorId} onChange={e=>setAdvisorDraft(s=>({...s,advisorId:e.target.value}))} style={{padding:10,borderRadius:8,color:'#fff',background:'#09243a'}}/>
            <input aria-label="Nombre asesora" placeholder="Nombre de asesora" value={advisorDraft.displayName} onChange={e=>setAdvisorDraft(s=>({...s,displayName:e.target.value}))} style={{padding:10,borderRadius:8,color:'#fff',background:'#09243a'}}/>
            <label>Prioridad <input type="number" min="1" max="100" value={advisorDraft.priority} onChange={e=>setAdvisorDraft(s=>({...s,priority:Number(e.target.value)}))} style={{width:70,padding:8,background:'#09243a',color:'#fff'}}/></label>
            <label><input type="checkbox" checked={advisorDraft.enabled} onChange={e=>setAdvisorDraft(s=>({...s,enabled:e.target.checked}))}/> Habilitada</label>
            <button type="button" className="ao-tag green" onClick={saveAdvisorV114}>Guardar asesora</button>
          </div></details>
          <div style={{marginTop:20}}><h4>Asesoras registradas</h4>
          {(advisorAdmin.advisors||[]).map(a=><div key={a.advisor_id} style={{padding:12,borderBottom:'1px solid #3b5d70',display:'flex',justifyContent:'space-between',gap:8,flexWrap:'wrap'}}><div><strong>{a.display_name}</strong> · Prioridad {a.priority} · {a.used_today}/30 hoy · {a.enabled?'Activa':'Pausada'}</div><div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}><button type="button" className="ao-tag cyan" onClick={()=>setRenameDraft({advisorId:a.advisor_id,displayName:a.display_name})}>Cambiar nombre</button><button type="button" className="ao-tag cyan" onClick={()=>setAdvisorDraft({advisorId:a.advisor_id,displayName:a.display_name,priority:Number(a.priority),enabled:!!a.enabled})}>Configuración avanzada</button></div>{renameDraft.advisorId===a.advisor_id&&<div style={{display:'flex',gap:8,flexWrap:'wrap',width:'100%'}}><input aria-label="Nuevo nombre visible" value={renameDraft.displayName} onChange={e=>setRenameDraft(s=>({...s,displayName:e.target.value.slice(0,80)}))} placeholder="Nombre real de la asesora" style={{minWidth:200,flex:1,padding:12,background:'#09243a',border:'1px solid #4a7795',borderRadius:8,color:'#fff'}}/><button type="button" className="ao-tag green" onClick={saveVisibleAdvisorName}>Guardar nombre</button><button type="button" className="ao-tag cyan" onClick={()=>setRenameDraft({advisorId:'',displayName:''})}>Cancelar</button></div>}</div>)}</div>
          <p>Las nuevas órdenes se distribuyen en el momento de llegar, cuando la automatización está habilitada. WhatsApp continúa manual.</p>
        </section>}
        {tab==='sistema'&&<section className="ao-panel"><div className="ao-section-head"><h3>Conectividad y fases de operación</h3><span className="ao-tag green"><ShieldCheck size={12}/> Modo seguro</span></div><div className="ao-flowgrid">{STATUSES.map(s=>{const Icon=s.icon;return <article key={s.name} className={`ao-card ${s.color}`}><div className="ao-cardhead"><h4>{s.name}</h4><Icon className="ao-ic" size={24}/></div><div className="ao-value">{s.value}</div><p className="ao-helper">{s.detail}</p></article>})}</div><div className="ao-note">Estos estados reflejan la configuración previamente verificada, no una comprobación en vivo del servicio. El administrador tiene consulta de pedidos y auditoría por asesora. No se modifica el pedido desde esa consulta.</div></section>}
      {transferModal&&<div role="dialog" aria-modal="true" aria-label="Transferir pedido" style={{position:'fixed',inset:0,zIndex:9999,background:'#020914df',display:'grid',placeItems:'center',padding:15}}><div style={{width:'min(100%,440px)',padding:22,background:'#102439',color:'#fff',border:'1px solid #ae7bdb',borderRadius:18}}><h3>Transferir pedido</h3><p>Pedido #{transferModal.id} · Se conservarán las notas, alertas y el historial.</p><label>Asesora de destino<select value={transferModal.target} onChange={e=>setTransferModal(s=>({...s,target:e.target.value}))} style={{width:'100%',padding:12,color:'#fff',background:'#19394e',borderRadius:8}}><option value="">Selecciona asesora</option>{directory.map(a=><option key={a.advisor_id} value={a.advisor_id}>{a.display_name}</option>)}</select></label><label>Comentario (opcional)<textarea value={transferNote} onChange={e=>setTransferNote(e.target.value.slice(0,500))} style={{width:'100%',padding:12,color:'#fff',background:'#19394e',borderRadius:8}}/></label><div style={{display:'flex',gap:12,marginTop:18}}><button type="button" className="ao-tag cyan" onClick={()=>setTransferModal(null)}>Cancelar</button><button type="button" className="ao-tag green" disabled={!transferModal.target||actionState.busy===transferModal.id} onClick={executeTransfer}>Confirmar transferencia</button></div></div></div>}
      </main>
    </div>
  </div>;
}
