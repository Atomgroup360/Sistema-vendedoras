import React, { useState, useEffect } from 'react';
import { Activity, AlertTriangle, Bell, CheckCircle2, Clock3, LayoutDashboard, LockKeyhole, LogOut, Package, Radio, ShieldCheck, Sparkles, Users, Wifi, Zap } from 'lucide-react';

const TABS = [
  { id: 'resumen', title: 'Resumen', icon: LayoutDashboard },
  { id: 'pedidos', title: 'Mis pedidos', icon: Package },
  { id: 'alertas', title: 'Alertas IA', icon: Bell },
  { id: 'sistema', title: 'Estado del sistema', icon: Activity },
];
const STATUSES = [
  { name: 'Recepción Shopify', value: 'Activa', detail: 'Webhook → Cloudflare → D1', color: 'cyan', icon: Wifi },
  { name: 'Distribución', value: 'En espera', detail: 'No asigna pedidos todavía', color: 'amber', icon: Users },
  { name: 'WhatsApp', value: 'Manual', detail: 'Contacto desde el móvil de cada asesora', color: 'violet', icon: Radio },
  { name: 'Alertas recientes', value: 'Vista previa', detail: 'Análisis protegido en el Worker', color: 'green', icon: Sparkles },
];
const ORDER_STATUS_LABELS = {assigned:'Pendiente de contacto',contacted:'Contactado',no_answer:'Sin respuesta',needs_correction:'Requiere corrección',confirmed:'Confirmado',cancelled:'Cancelado'};
const ALERTS = [
  { title: 'Cliente con pedido reciente', detail: 'Verifica si está preguntando por el pedido anterior antes de confirmar uno nuevo.', tone: 'cyan', icon: Clock3 },
  { title: 'Posible pedido duplicado', detail: 'Mismo teléfono, productos o dirección: revisar manualmente; no cancelar de forma automática.', tone: 'amber', icon: AlertTriangle },
  { title: 'Compra adicional legítima', detail: 'Un pedido nuevo puede ser una compra válida. Confirmar la intención del cliente.', tone: 'violet', icon: CheckCircle2 },
];

function Atom() {
  return <div className="ao-atom" aria-hidden="true"><div className="ao-orbit ao-one"/><div className="ao-orbit ao-two"/><div className="ao-orbit ao-three"/><div className="ao-nucleus"/></div>;
}

export default function ConfirmationAdvisorPortal({ user, onLogout, role = 'confirmaciones' }) {
  const [tab, setTab] = useState('resumen');
  const [inbox, setInbox] = useState({status:'idle',orders:[],error:''});
  const [actionEnabled, setActionEnabled] = useState(false);
  const [actionState,setActionState]=useState({busy:0,message:''});
  const [notes,setNotes]=useState({});
  const [advisorName,setAdvisorName]=useState('');
  const [messagePreview,setMessagePreview]=useState(null);
  const fetchInbox = async () => {
    if (!user?.getIdToken) {setInbox({status:'error',orders:[],error:'Sesión Firebase no disponible'});return;}
    setInbox(prev=>({...prev,status:'loading',error:''}));
    try {
      const token=await user.getIdToken();
      const res=await fetch('https://winner-os-confirmaciones.julian-1818.workers.dev/api/v1/advisor/inbox',{
        method:'GET', headers:{Authorization:`Bearer ${token}`}, cache:'no-store'
      });
      const data=await res.json();
      if(!res.ok || !data.ok)throw new Error(data.code||'ERROR_DE_CONEXION');
      setActionEnabled(data.orderActionsEnabled===true);
      setInbox({status:'ready',orders:Array.isArray(data.orders)?data.orders:[],error:''});
    }catch(e){setInbox({status:'error',orders:[],error:String(e.message||'ERROR')});}
  };
  const updateOrder = async (o, action) => {
    if (!actionEnabled) return;
    const note=notes[o.id]||'';
    if (action==='no_answer' && !note.trim()) {setActionState({busy:0,message:'Escribe una nota para registrar el intento sin respuesta.'});return;}
    if ((action==='cancelled'||action==='confirmed') && !window.confirm(`¿Registrar pedido ${o.number} como ${action==='confirmed'?'CONFIRMADO':'CANCELADO'}? Esta acción es definitiva.`)) return;
    setActionState({busy:o.id,message:''});
    try {
      const token=await user.getIdToken();
      const res=await fetch('https://winner-os-confirmaciones.julian-1818.workers.dev/api/v1/advisor/order-action',{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({incomingId:o.id,action,note})});
      const data=await res.json();
      if (!res.ok||!data.ok) throw new Error(data.code||'No se pudo registrar');
      setActionState({busy:0,message:'Gestión guardada con auditoría.'});
      await fetchInbox();
    }catch(e){setActionState({busy:0,message:String(e.message||'Error')});}
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
  useEffect(()=>{if(['pedidos','resumen','alertas'].includes(tab))fetchInbox();},[tab,user?.uid]);
  const stats=inbox.orders.reduce((a,o)=>{a.total++;a[o.status]=(a[o.status]||0)+1;return a;},{total:0});
  const admin = role === 'admin';
  const current = TABS.find(t => t.id === tab);
  return <div className="ao-root">
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
      @media(prefers-reduced-motion:reduce){.ao-root *{animation:none!important;transition:none!important}}
    `}</style>
    <div className="ao-back"/><svg className="ao-path" viewBox="0 0 1200 720" preserveAspectRatio="none" aria-hidden="true"><path d="M0 160 H150 V100 H390 V270 H590 V80 H800 V170 H1200" stroke="#56e5ff" fill="none" strokeWidth="1.5"/><path d="M0 610 H180 V450 H460 V590 H800 V420 H1200" stroke="#a68cfa" fill="none" strokeWidth="1.3"/><path d="M1200 90 H1000 V320 H740 V240 H500 V420 H100 V680" stroke="#4ceac2" fill="none" strokeWidth="1.3"/></svg>
    <div className="ao-content">
      <header className="ao-head">
        <div style={{minWidth:0,flex:1}}><div className="ao-eyebrow">WINNER OS / ATOM PREMIUM · CONFIRMACIONES IA</div><h2 className="ao-title">Centro de <span className="ao-gradient">Confirmaciones Inteligentes</span></h2><p className="ao-desc">Panel operativo con prioridades claras, alertas de reincidencia y seguimiento de pedidos. Los datos personales permanecerán protegidos hasta completar la autorización del backend.</p></div>
        <div className="ao-atom-wrap"><Atom/></div>
        <div className="ao-user"><div><small style={{color:'#8cdaed',fontWeight:800}}>{admin?'ADMINISTRADOR':'ASESORA'}</small><span>{user?.email||'Sesión activa'}</span></div>{!admin&&<button type="button" onClick={onLogout}><LogOut size={15}/> Salir</button>}</div>
      </header>
      <nav className="ao-nav" aria-label="Secciones del módulo de confirmaciones" role="tablist">
        {TABS.map(item=>{const Icon=item.icon;return <button key={item.id} id={`ao-tab-${item.id}`} role="tab" type="button" aria-selected={tab===item.id} aria-controls="ao-tabpanel" onClick={()=>setTab(item.id)}><Icon size={15}/>{item.title}</button>})}
      </nav>
      <main role="tabpanel" id="ao-tabpanel" aria-labelledby={`ao-tab-${current.id}`}>
        {tab==='resumen'&&<><section className="ao-panel" style={{marginBottom:14}}><div className="ao-section-head"><h3>Indicadores de pedidos asignados</h3><span className="ao-tag cyan">{inbox.status==='ready'?'Datos reales · hasta 100 asignaciones':'Consultando bandeja'}</span></div><div className="ao-minis"><div className="ao-mini"><h4>Asignados visibles</h4><strong>{inbox.status==='ready'?stats.total:'—'}</strong></div><div className="ao-mini"><h4>Confirmados</h4><strong>{inbox.status==='ready'?(stats.confirmed||0):'—'}</strong></div><div className="ao-mini"><h4>Sin respuesta</h4><strong>{inbox.status==='ready'?(stats.no_answer||0):'—'}</strong></div></div><p style={{fontSize:12,color:'#a5d9ec'}}>Cifras de la bandeja autorizada, no del total de pedidos Shopify ni de cohortes mensuales.</p></section><div className="ao-section-head"><h3>Estado operativo</h3><span className="ao-tag cyan"><Zap size={12}/> Información de configuración</span></div><section className="ao-stats">{STATUSES.map(s=>{const Icon=s.icon;return <article className={`ao-card ${s.color}`} key={s.name}><div className="ao-cardhead"><h4>{s.name}</h4><Icon className="ao-ic" size={23}/></div><div className="ao-value">{s.value}</div><p className="ao-helper">{s.detail}</p></article>})}</section><div className="ao-grid"><section className="ao-panel"><div className="ao-section-head"><h3>Mi operación</h3><span className="ao-tag amber">Datos de bandeja autorizada</span></div><p>Los indicadores superiores utilizan exclusivamente los pedidos asignados visibles para esta cuenta.</p><div className="ao-minis"><div className="ao-mini"><h4>Pendientes</h4><strong>—</strong><p>Sin lectura autorizada</p></div><div className="ao-mini"><h4>Confirmados</h4><strong>—</strong><p>Sin lectura autorizada</p></div><div className="ao-mini"><h4>Cancelados</h4><strong>—</strong><p>Sin lectura autorizada</p></div></div><div className="ao-note">La recepción Shopify sigue independiente; no se activa el reparto automático en esta entrega.</div></section><section className="ao-panel"><div className="ao-section-head"><h3>Inteligencia para atender mejor</h3><span className="ao-tag violet"><Sparkles size={12}/> Alertas preventivas</span></div>{ALERTS.slice(0,2).map(a=>{const Icon=a.icon;return <article key={a.title} className={`ao-alert ${a.tone}`}><Icon className="ao-ai" size={19}/><div><h4>{a.title}</h4><p>{a.detail}</p></div></article>})}</section></div></>}
        {tab==='pedidos'&&<section className="ao-panel"><div className="ao-section-head"><h3>{admin?'Bandeja general de confirmaciones':'Mis pedidos asignados'}</h3><button type="button" className="ao-tag cyan" onClick={fetchInbox} disabled={inbox.status==='loading'}>{inbox.status==='loading'?'Consultando…':'Actualizar bandeja'}</button></div>
          <div style={{margin:'12px 0',display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
            <label htmlFor="ao-advisor-name" style={{fontSize:13,color:'#9bdff0',fontWeight:700}}>Nombre que aparecerá en el WhatsApp:</label>
            <input id="ao-advisor-name" value={advisorName} onChange={e=>setAdvisorName(e.target.value.slice(0,80))} placeholder="Ej. Camila Londoño" style={{border:'1px solid #447a97',background:'#061c30',color:'#fff',borderRadius:9,padding:'9px 12px',width:260,maxWidth:'100%'}}/>
            <span style={{color:'#c1d4df',fontSize:12}}>Se usa solo en este navegador y no cambia tu usuario de Firebase.</span>
          </div>
          {inbox.status==='error'&&<div className="ao-note">Conexión pendiente o acceso no autorizado: {inbox.error}. No se muestran datos de clientes.</div>}
          {inbox.status==='loading'&&<div className="ao-empty"><Clock3 size={28}/><h3>Consultando pedidos autorizados…</h3></div>}
          {inbox.status==='ready'&&inbox.orders.length===0&&<div className="ao-empty"><LockKeyhole size={30}/><h3>No tienes pedidos asignados por ahora</h3><p>La bandeja está conectada y autorizada. Los pedidos aparecerán aquí cuando el reparto seguro sea habilitado.</p></div>}
          {inbox.status==='ready'&&inbox.orders.length>0&&<div style={{display:'grid',gap:14}}>{inbox.orders.map(o=><article key={o.id} className="ao-mini" style={{padding:18,border:'1px solid #3f728c',borderRadius:14}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap'}}><strong style={{fontSize:18,color:'#e9faff'}}>Pedido {o.number}</strong><span className="ao-tag cyan">{ORDER_STATUS_LABELS[o.status]||o.status}</span></div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))',gap:13,marginTop:16}}>
              <div><p><b style={{color:'#6de7ff'}}>CLIENTE</b></p><p style={{color:'#e6f4ff'}}>{o.customerName||'No registrado'}</p><p>Teléfono: {o.customerPhone||'No registrado'}</p><p>Ciudad: {o.city||'No registrada'}</p></div>
              <div><p><b style={{color:'#f9c56b'}}>DIRECCIÓN DE ENTREGA</b></p><p>{[o.address?.address1,o.address?.address2].filter(Boolean).join(', ')||'No registrada'}</p><p>{[o.address?.city,o.address?.province,o.address?.zip].filter(Boolean).join(' · ')||'Ubicación incompleta'}</p><p style={{fontSize:11,color:'#a8becf'}}>Dirección original Shopify; verificar antes de confirmar.</p></div>
              <div><p><b style={{color:'#c7a4ff'}}>PEDIDO</b></p><p>{(o.items||[]).map(i=>`${i.quantity} × ${i.title}${i.variant?' ('+i.variant+')':''}`).join(' · ')||'Sin detalle'}</p><p>Valor: {o.total||'—'}</p><p>Fecha: {o.createdAt}</p></div>
            </div>
            {o.recentOrders?.length>0&&<div className="ao-note" style={{marginTop:12,borderColor:'#edb65a'}} role="status"><strong>⚠️ Cliente con pedidos recientes: {o.recentOrders.length}</strong><p style={{marginTop:6}}>Coincide el teléfono en los últimos 7 días. Revisar antes de confirmar: {o.recentOrders.map(r=>r.number).join(', ')}. Esto no significa necesariamente duplicación.</p></div>}
            {o.timeline?.length>0&&<details style={{marginTop:14,border:'1px solid #34576d',padding:12,borderRadius:10}}><summary style={{cursor:'pointer',fontWeight:750,color:'#8fe5f7'}}>Historial de gestiones ({o.timeline.length})</summary>{o.timeline.map((event,i)=><div key={i} style={{borderTop:'1px solid #25445b',padding:'9px 0',fontSize:12}}><b>{ORDER_STATUS_LABELS[event.action]||event.action}</b> · {new Date(event.at).toLocaleString('es-CO')} · {event.note||'Sin nota'}</div>)}</details>}
            <div style={{display:'flex',flexWrap:'wrap',gap:10,marginTop:16,alignItems:'center'}}>
              <button type="button" onClick={()=>setMessagePreview(messagePreview===o.id?null:o.id)} className="ao-tag cyan" style={{padding:'10px 14px'}}>Vista previa del mensaje</button><button type="button" onClick={()=>copyMessage(o)} className="ao-tag violet" style={{padding:'10px 14px'}}>Copiar mensaje</button>{whatsAppLink(o)?<a href={whatsAppLink(o)} target="_blank" rel="noopener noreferrer" className="ao-tag green" style={{padding:'10px 14px',textDecoration:'none'}}>Abrir WhatsApp (envío manual)</a>:<span className="ao-tag amber">Teléfono no válido para enlace WhatsApp</span>}
              <span style={{color:'#b1cddd',fontSize:11}}>La asesora revisa y envía manualmente. Abrir WhatsApp no registra contacto.</span>
            </div>
            {messagePreview===o.id&&<div style={{marginTop:10,padding:16,border:'1px solid #3886a7',background:'#09263d',borderRadius:12}}><div style={{fontWeight:800,color:'#74e8fa',marginBottom:10}}>Mensaje preparado para revisar y copiar</div><textarea readOnly value={formatConfirmMessage(o)} rows={15} style={{width:'100%',padding:12,whiteSpace:'pre-wrap',background:'#061b2b',color:'#f2fbff',border:'1px solid #3b7188',borderRadius:10}}/><p style={{fontSize:12,color:'#ffd483'}}>Comprueba nombre de asesora, dirección y valor. No promete una fecha de entrega ni descuentos no verificados.</p></div>}
            <div style={{marginTop:14,display:'grid',gap:9}}>
              <label style={{fontSize:12,color:'#d0e7fa'}}>Nota de gestión (máximo 500 caracteres)</label>
              <textarea value={notes[o.id]||''} maxLength={500} onChange={e=>setNotes(s=>({...s,[o.id]:e.target.value}))} rows={2} placeholder="Qué respondió el cliente o qué se debe corregir…" style={{width:'100%',background:'#06192c',border:'1px solid #41647b',borderRadius:9,padding:11,color:'#f0faff'}}/>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{[['contacted','Contactado'],['no_answer','Sin respuesta'],['needs_correction','Corregir datos'],['confirmed','Confirmado'],['cancelled','Cancelado']].map(([action,label])=><button type="button" key={action} disabled={!actionEnabled||actionState.busy!==0||['confirmed','cancelled'].includes(o.status)} onClick={()=>updateOrder(o,action)} style={{padding:'9px 12px',border:'1px solid #40718e',borderRadius:9,background:'#123454',color:'#e7f9ff',opacity:!actionEnabled?.5:1,cursor:actionEnabled?'pointer':'not-allowed'}}>{label}</button>)}</div>
              {!actionEnabled&&<p style={{fontSize:12,color:'#ffd58c'}}>Las acciones están en modo protegido hasta activar ORDER_ACTIONS_ENABLED y validar la migración de auditoría.</p>}
            </div>
          </article>)}</div>}
          {actionState.message&&<div className="ao-note" role="status">{actionState.message}</div>}
          {inbox.status==='idle'&&<div className="ao-empty"><LockKeyhole size={30}/><h3>Consulta segura</h3><p>Los pedidos solo se obtienen usando tu sesión de Firebase, con verificación del servidor.</p></div>}
        </section>}
        {tab==='alertas'&&<section className="ao-panel"><div className="ao-section-head"><h3>Alertas inteligentes para trato especial</h3><span className="ao-tag cyan"><Bell size={12}/> Reglas de revisión</span></div>{inbox.status==='ready'&&<div style={{display:'grid',gap:8,margin:'12px 0'}}>{inbox.orders.filter(o=>o.recentOrders?.length>0).length===0?<div className="ao-note">No se detectaron coincidencias telefónicas recientes entre los pedidos de esta bandeja.</div>:inbox.orders.filter(o=>o.recentOrders?.length>0).map(o=><div className="ao-note" key={o.id}>⚠️ <strong>{o.number}</strong> · {o.recentOrders.length} pedido(s) coincidentes: {o.recentOrders.map(r=>r.number).join(', ')}. Revisar con el cliente.</div>)}</div>}<p>Señales que WINNER OS revisará con los pedidos recibidos. Las coincidencias telefónicas de los últimos siete días se muestran arriba cuando existen; requieren revisión humana.</p><div className="ao-grid" style={{marginTop:16}}>{ALERTS.map(a=>{const Icon=a.icon;return <article key={a.title} className={`ao-alert ${a.tone}`}><Icon size={21} className="ao-ai"/><div><h4>{a.title}</h4><p>{a.detail}</p></div></article>})}</div></section>}
        {tab==='sistema'&&<section className="ao-panel"><div className="ao-section-head"><h3>Conectividad y fases de operación</h3><span className="ao-tag green"><ShieldCheck size={12}/> Modo seguro</span></div><div className="ao-flowgrid">{STATUSES.map(s=>{const Icon=s.icon;return <article key={s.name} className={`ao-card ${s.color}`}><div className="ao-cardhead"><h4>{s.name}</h4><Icon className="ao-ic" size={24}/></div><div className="ao-value">{s.value}</div><p className="ao-helper">{s.detail}</p></article>})}</div><div className="ao-note">Estos estados reflejan la configuración previamente verificada, no una comprobación en vivo del servicio. No hay conexión de lectura de pedidos de asesoras en esta versión.</div></section>}
      </main>
    </div>
  </div>;
}
