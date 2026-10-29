import React, { useState } from 'react';
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
        {tab==='resumen'&&<><div className="ao-section-head"><h3>Estado operativo</h3><span className="ao-tag cyan"><Zap size={12}/> Información de configuración</span></div><section className="ao-stats">{STATUSES.map(s=>{const Icon=s.icon;return <article className={`ao-card ${s.color}`} key={s.name}><div className="ao-cardhead"><h4>{s.name}</h4><Icon className="ao-ic" size={23}/></div><div className="ao-value">{s.value}</div><p className="ao-helper">{s.detail}</p></article>})}</section><div className="ao-grid"><section className="ao-panel"><div className="ao-section-head"><h3>Mi operación</h3><span className="ao-tag amber">Sin acceso a datos todavía</span></div><p>El área quedará preparada para pedidos asignados, confirmaciones y cancelaciones, sin inventar indicadores de ventas.</p><div className="ao-minis"><div className="ao-mini"><h4>Pendientes</h4><strong>—</strong><p>Sin lectura autorizada</p></div><div className="ao-mini"><h4>Confirmados</h4><strong>—</strong><p>Sin lectura autorizada</p></div><div className="ao-mini"><h4>Cancelados</h4><strong>—</strong><p>Sin lectura autorizada</p></div></div><div className="ao-note">Distribución automática desactivada. Ninguna asesora recibirá pedidos hasta validar su cuenta y su autorización en Cloudflare.</div></section><section className="ao-panel"><div className="ao-section-head"><h3>Inteligencia para atender mejor</h3><span className="ao-tag violet"><Sparkles size={12}/> Alertas preventivas</span></div>{ALERTS.slice(0,2).map(a=>{const Icon=a.icon;return <article key={a.title} className={`ao-alert ${a.tone}`}><Icon className="ao-ai" size={19}/><div><h4>{a.title}</h4><p>{a.detail}</p></div></article>})}</section></div></>}
        {tab==='pedidos'&&<section className="ao-panel"><div className="ao-section-head"><h3>{admin?'Bandeja general de confirmaciones':'Mis pedidos asignados'}</h3><span className="ao-tag amber">Conexión pendiente</span></div><div className="ao-empty"><LockKeyhole size={30}/><h3>Pedidos protegidos</h3><p>El Worker todavía no dispone de un endpoint autenticado que entregue únicamente los pedidos autorizados. Aquí aparecerá la bandeja real cuando esa seguridad esté implementada. No se muestran datos ficticios de clientes.</p></div></section>}
        {tab==='alertas'&&<section className="ao-panel"><div className="ao-section-head"><h3>Alertas inteligentes para trato especial</h3><span className="ao-tag cyan"><Bell size={12}/> Reglas de revisión</span></div><p>Señales que WINNER OS revisará con los pedidos recibidos. Las alertas reales por cliente se mostrarán aquí cuando el servidor autorice la consulta.</p><div className="ao-grid" style={{marginTop:16}}>{ALERTS.map(a=>{const Icon=a.icon;return <article key={a.title} className={`ao-alert ${a.tone}`}><Icon size={21} className="ao-ai"/><div><h4>{a.title}</h4><p>{a.detail}</p></div></article>})}</div></section>}
        {tab==='sistema'&&<section className="ao-panel"><div className="ao-section-head"><h3>Conectividad y fases de operación</h3><span className="ao-tag green"><ShieldCheck size={12}/> Modo seguro</span></div><div className="ao-flowgrid">{STATUSES.map(s=>{const Icon=s.icon;return <article key={s.name} className={`ao-card ${s.color}`}><div className="ao-cardhead"><h4>{s.name}</h4><Icon className="ao-ic" size={24}/></div><div className="ao-value">{s.value}</div><p className="ao-helper">{s.detail}</p></article>})}</div><div className="ao-note">Estos estados reflejan la configuración previamente verificada, no una comprobación en vivo del servicio. No hay conexión de lectura de pedidos de asesoras en esta versión.</div></section>}
      </main>
    </div>
  </div>;
}
