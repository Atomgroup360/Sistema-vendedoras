import React from 'react';
import {
  ArrowRight,
  BellRing,
  Bot,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Cpu,
  Eye,
  Layers3,
  LogOut,
  MessageCircleMore,
  Orbit,
  Radar,
  ShieldCheck,
  ShoppingBag,
  Siren,
  Sparkles,
  UserCircle2,
  Wifi,
  XCircle,
  Zap,
} from 'lucide-react';

const statusPills = [
  { label: 'Shopify conectado', tone: 'emerald', icon: Wifi },
  { label: 'IA recurrente activa', tone: 'cyan', icon: BrainCircuit },
  { label: 'Asignación protegida', tone: 'amber', icon: ShieldCheck },
];

const kpiCards = [
  {
    title: 'Recepción de pedidos',
    value: 'Activa',
    helper: 'Shopify → Worker → D1 funcionando',
    icon: ShoppingBag,
    tone: 'cyan',
    badge: 'ONLINE',
  },
  {
    title: 'Asignaciones automáticas',
    value: 'Pausadas',
    helper: 'Se activarán solo cuando las asesoras tengan acceso seguro',
    icon: Radar,
    tone: 'amber',
    badge: 'CONTROL',
  },
  {
    title: 'WhatsApp operativo',
    value: 'Manual',
    helper: 'La asesora enviará el mensaje desde su propio WhatsApp Business',
    icon: MessageCircleMore,
    tone: 'violet',
    badge: 'HÍBRIDO',
  },
  {
    title: 'Alertas inteligentes',
    value: 'Lista previa',
    helper: 'Pedidos repetidos, clientes recientes y revisión premium',
    icon: Bot,
    tone: 'blue',
    badge: 'IA',
  },
];

const alertItems = [
  {
    title: 'Cliente con pedido reciente',
    description:
      'Detecta clientes que hicieron pedidos en días cercanos para aplicar un trato especial y validar si quieren una nueva compra o seguimiento.',
    tone: 'cyan',
    icon: BellRing,
  },
  {
    title: 'Posible duplicado',
    description:
      'Cruza teléfono y dirección para alertar sobre pedidos repetidos que deben revisarse antes de consumir un nuevo cupo de WhatsApp.',
    tone: 'amber',
    icon: Siren,
  },
  {
    title: 'Seguimiento premium',
    description:
      'La interfaz queda lista para mostrar historial reciente, prioridad de atención y recomendación asistida por IA.',
    tone: 'violet',
    icon: Sparkles,
  },
];

const pipelineSteps = [
  {
    title: 'Recepción automática',
    description: 'Shopify entrega el pedido en tiempo real y se registra en la cola protegida de WINNER OS.',
    icon: Wifi,
    status: 'activo',
  },
  {
    title: 'Análisis IA',
    description: 'Se revisan reincidencias, duplicados potenciales y señales para trato especial del cliente.',
    icon: BrainCircuit,
    status: 'activo',
  },
  {
    title: 'Asignación segura',
    description: 'Se habilitará cuando las asesoras estén conectadas con sus cuentas y permisos individuales.',
    icon: ShieldCheck,
    status: 'pendiente',
  },
  {
    title: 'Contacto por WhatsApp',
    description: 'La asesora seguirá enviando manualmente el mensaje al cliente desde su propio WhatsApp Business.',
    icon: MessageCircleMore,
    status: 'pendiente',
  },
];

const queueStates = [
  { label: 'Pendientes', value: 'Sin exponer', helper: 'Se mostrarán cuando el backend autorice pedidos reales por asesora.', icon: Clock3, tone: 'cyan' },
  { label: 'Confirmados', value: 'Bloqueado', helper: 'Solo visible con autorización completa y trazabilidad.', icon: CheckCircle2, tone: 'emerald' },
  { label: 'Cancelados', value: 'Bloqueado', helper: 'Preparado para control operativo y análisis posterior.', icon: XCircle, tone: 'rose' },
];

const toneStyles = {
  cyan: {
    ring: 'border-cyan-300/40 bg-cyan-500/14 text-cyan-100',
    glow: 'shadow-[0_0_40px_rgba(34,211,238,.18)]',
    icon: 'bg-cyan-400/15 text-cyan-100 border-cyan-300/30',
    border: 'border-cyan-300/22',
    title: 'text-cyan-100',
    label: 'text-cyan-200',
    line: 'from-cyan-400 via-sky-400 to-blue-500',
    soft: 'from-cyan-500/20 via-sky-500/6 to-transparent',
  },
  amber: {
    ring: 'border-amber-300/40 bg-amber-500/14 text-amber-100',
    glow: 'shadow-[0_0_40px_rgba(251,191,36,.16)]',
    icon: 'bg-amber-400/15 text-amber-100 border-amber-300/30',
    border: 'border-amber-300/22',
    title: 'text-amber-50',
    label: 'text-amber-200',
    line: 'from-amber-300 via-orange-400 to-amber-500',
    soft: 'from-amber-500/20 via-orange-500/6 to-transparent',
  },
  violet: {
    ring: 'border-violet-300/40 bg-violet-500/14 text-violet-100',
    glow: 'shadow-[0_0_40px_rgba(168,85,247,.16)]',
    icon: 'bg-violet-400/15 text-violet-100 border-violet-300/30',
    border: 'border-violet-300/22',
    title: 'text-violet-50',
    label: 'text-violet-200',
    line: 'from-violet-300 via-fuchsia-400 to-indigo-400',
    soft: 'from-violet-500/20 via-fuchsia-500/6 to-transparent',
  },
  emerald: {
    ring: 'border-emerald-300/40 bg-emerald-500/14 text-emerald-100',
    glow: 'shadow-[0_0_40px_rgba(16,185,129,.16)]',
    icon: 'bg-emerald-400/15 text-emerald-100 border-emerald-300/30',
    border: 'border-emerald-300/22',
    title: 'text-emerald-50',
    label: 'text-emerald-200',
    line: 'from-emerald-300 via-green-400 to-cyan-400',
    soft: 'from-emerald-500/20 via-green-500/6 to-transparent',
  },
  blue: {
    ring: 'border-sky-300/40 bg-sky-500/14 text-sky-100',
    glow: 'shadow-[0_0_40px_rgba(59,130,246,.16)]',
    icon: 'bg-sky-400/15 text-sky-100 border-sky-300/30',
    border: 'border-sky-300/22',
    title: 'text-sky-50',
    label: 'text-sky-200',
    line: 'from-blue-300 via-sky-400 to-cyan-400',
    soft: 'from-blue-500/20 via-sky-500/6 to-transparent',
  },
  rose: {
    ring: 'border-rose-300/40 bg-rose-500/14 text-rose-100',
    glow: 'shadow-[0_0_40px_rgba(244,63,94,.16)]',
    icon: 'bg-rose-400/15 text-rose-100 border-rose-300/30',
    border: 'border-rose-300/22',
    title: 'text-rose-50',
    label: 'text-rose-200',
    line: 'from-rose-300 via-pink-400 to-red-400',
    soft: 'from-rose-500/20 via-pink-500/6 to-transparent',
  },
};

function TonePill({ tone = 'cyan', children }) {
  const t = toneStyles[tone] || toneStyles.cyan;
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] ${t.ring}`}>
      {children}
    </span>
  );
}

function AccentCard({ tone = 'cyan', children, className = '' }) {
  const t = toneStyles[tone] || toneStyles.cyan;
  return (
    <div className={`relative overflow-hidden rounded-[1.75rem] border bg-slate-950/60 backdrop-blur-2xl ${t.border} ${t.glow} ${className}`}>
      <div className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r ${t.line}`} />
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${t.soft}`} />
      {children}
    </div>
  );
}

export default function ConfirmationAdvisorPortal({ user, onLogout }) {
  return (
    <div className="min-h-screen overflow-hidden bg-[#03111f] text-slate-100">
      <style>{`
        @keyframes atomSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes atomSpinReverse { from { transform: rotate(360deg); } to { transform: rotate(0deg); } }
        @keyframes pulseGlow { 0%,100% { opacity: .5; transform: scale(1); } 50% { opacity: 1; transform: scale(1.08); } }
        @keyframes floatPanel { 0%,100% { transform: translateY(0px); } 50% { transform: translateY(-8px); } }
        @keyframes scanLine { 0% { transform: translateX(-120%); opacity: 0; } 15% { opacity: .9; } 100% { transform: translateX(140%); opacity: 0; } }
        @keyframes circuitFlow { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -260; } }
        @keyframes particleFloat { 0%,100% { transform: translateY(0px) scale(1); opacity: .45; } 50% { transform: translateY(-16px) scale(1.15); opacity: .95; } }
        .atom-shell { position: absolute; inset: 0; border-radius: 9999px; border: 2px solid rgba(108, 229, 255, 0.72); box-shadow: 0 0 38px rgba(57,189,255,.28), inset 0 0 20px rgba(72,226,255,.10); }
        .atom-shell.one { transform: rotate(18deg) scaleX(1.18); animation: atomSpin 9s linear infinite; }
        .atom-shell.two { transform: rotate(78deg) scaleX(1.25); animation: atomSpinReverse 11s linear infinite; }
        .atom-shell.three { transform: rotate(-38deg) scaleX(1.08); animation: atomSpin 13s linear infinite; }
        .atom-core { animation: pulseGlow 2.8s ease-in-out infinite; }
        .floating-premium { animation: floatPanel 7s ease-in-out infinite; }
        .scan-line::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(155,239,255,.16), transparent); transform: translateX(-120%); animation: scanLine 5.8s linear infinite; }
        .circuit-svg { position: absolute; inset: 0; width: 100%; height: 100%; opacity: .84; }
        .circuit-svg path { stroke-dasharray: 14 10; animation: circuitFlow 18s linear infinite; }
        .particle { position: absolute; border-radius: 9999px; animation: particleFloat 5s ease-in-out infinite; }
        .mesh-glow { background: radial-gradient(circle at 20% 20%, rgba(63,220,255,.25), transparent 26%), radial-gradient(circle at 80% 10%, rgba(119,92,255,.18), transparent 22%), radial-gradient(circle at 70% 75%, rgba(255,170,66,.12), transparent 18%), linear-gradient(135deg, #03111f 0%, #071833 28%, #0b2043 46%, #07162d 100%); }
      `}</style>

      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-0 mesh-glow" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_16%,rgba(0,220,255,.16),transparent_22%),radial-gradient(circle_at_85%_9%,rgba(119,92,255,.15),transparent_18%),radial-gradient(circle_at_78%_78%,rgba(255,184,77,.12),transparent_16%)]" />
        <svg className="circuit-svg" viewBox="0 0 1600 1200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M0 180H260V120H500V280H820V90H1140V340H1600" stroke="rgba(87,219,255,.45)" strokeWidth="1.8" />
          <path d="M0 540H220V440H440V660H780V500H1080V770H1600" stroke="rgba(77,161,255,.40)" strokeWidth="1.5" />
          <path d="M1600 150H1320V260H1060V190H740V320H440V260H160V430H0" stroke="rgba(170,222,255,.28)" strokeWidth="1.2" />
          <path d="M90 1160V760H360V620H620V850H980V640H1270V840H1500" stroke="rgba(255,190,86,.22)" strokeWidth="1.3" />
          <circle cx="500" cy="280" r="5" fill="rgba(115,241,255,.9)" />
          <circle cx="1140" cy="340" r="5" fill="rgba(115,241,255,.9)" />
          <circle cx="620" cy="850" r="5" fill="rgba(255,190,86,.72)" />
          <circle cx="1270" cy="840" r="5" fill="rgba(255,190,86,.72)" />
        </svg>
        <div className="particle left-[12%] top-[18%] h-2 w-2 bg-cyan-300 shadow-[0_0_16px_rgba(103,232,249,.9)]" style={{ animationDelay: '0s' }} />
        <div className="particle left-[30%] top-[70%] h-2.5 w-2.5 bg-violet-300 shadow-[0_0_18px_rgba(196,181,253,.85)]" style={{ animationDelay: '1.2s' }} />
        <div className="particle right-[14%] top-[22%] h-2 w-2 bg-sky-300 shadow-[0_0_18px_rgba(125,211,252,.9)]" style={{ animationDelay: '2.1s' }} />
        <div className="particle right-[28%] bottom-[15%] h-3 w-3 bg-amber-300 shadow-[0_0_22px_rgba(252,211,77,.85)]" style={{ animationDelay: '2.8s' }} />
      </div>

      <div className="relative z-10 flex min-h-screen gap-6 p-3 sm:p-4 xl:p-5">
        <aside className="hidden xl:flex w-[300px] shrink-0 flex-col rounded-[2rem] border border-cyan-300/16 bg-slate-950/55 px-6 py-6 shadow-[0_18px_70px_rgba(0,0,0,.32)] backdrop-blur-3xl">
          <AccentCard tone="cyan" className="p-5">
            <div className="relative">
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-400/14 shadow-[0_0_28px_rgba(34,211,238,.24)]">
                  <Orbit className="h-7 w-7 text-cyan-100" />
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-200">ATOM · IA</p>
                  <h1 className="text-xl font-black text-white">Confirmaciones</h1>
                </div>
              </div>
              <p className="mt-4 text-sm leading-7 text-slate-300">
                Centro premium para operación de pedidos, alertas inteligentes y seguimiento estratégico de clientes dentro de WINNER OS.
              </p>
            </div>
          </AccentCard>

          <div className="mt-5 grid gap-3">
            {[
              { label: 'Centro de mando', icon: Cpu, active: true, tone: 'cyan' },
              { label: 'Bandeja operativa', icon: Layers3, active: false, tone: 'blue' },
              { label: 'Alertas de IA', icon: BrainCircuit, active: false, tone: 'violet' },
              { label: 'Estado de conexión', icon: Wifi, active: false, tone: 'amber' },
            ].map((item) => {
              const Icon = item.icon;
              const t = toneStyles[item.tone] || toneStyles.cyan;
              return (
                <div
                  key={item.label}
                  className={`group relative overflow-hidden rounded-2xl border px-4 py-3 transition ${item.active ? `${t.border} bg-white/[0.07] ${t.glow}` : 'border-white/8 bg-white/[0.03] hover:border-cyan-300/18 hover:bg-white/[0.05]'}`}
                >
                  <div className={`absolute inset-y-0 left-0 w-1 bg-gradient-to-b ${item.active ? t.line : 'from-transparent via-transparent to-transparent'}`} />
                  <div className="relative flex items-center gap-3">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-xl border ${item.active ? t.icon : 'border-white/10 bg-white/[0.04] text-slate-300'}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className={`text-sm font-semibold ${item.active ? 'text-white' : 'text-slate-300'}`}>{item.label}</p>
                      <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Panel premium</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <AccentCard tone="emerald" className="mt-5 p-4">
            <div className="relative">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-200">Estados del sistema</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {statusPills.map((item) => {
                  const Icon = item.icon;
                  return (
                    <TonePill key={item.label} tone={item.tone}>
                      <Icon className="h-3.5 w-3.5" />
                      {item.label}
                    </TonePill>
                  );
                })}
              </div>
            </div>
          </AccentCard>

          <AccentCard tone="violet" className="mt-auto p-5 floating-premium">
            <div className="relative">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-violet-200">Seguridad de acceso</p>
              <p className="mt-4 text-sm leading-7 text-slate-300">
                El portal de confirmaciones queda visualmente premium, pero sigue protegido. Las asesoras verán únicamente este módulo cuando el backend libere la autorización completa.
              </p>
              <div className="mt-5 flex items-center gap-3 rounded-2xl border border-emerald-300/26 bg-emerald-500/12 px-4 py-3 text-emerald-100 shadow-[0_0_24px_rgba(16,185,129,.10)]">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                <span className="text-sm font-semibold">Acceso por rol validado en Firebase</span>
              </div>
            </div>
          </AccentCard>
        </aside>

        <div className="relative flex-1 overflow-hidden rounded-[2rem] border border-cyan-300/14 bg-slate-950/45 shadow-[0_24px_80px_rgba(0,0,0,.32)] backdrop-blur-3xl">
          <div className="absolute right-[-6rem] top-[-5rem] hidden h-[24rem] w-[24rem] xl:block">
            <div className="absolute inset-0 rounded-full bg-cyan-400/10 blur-3xl" />
            <div className="relative mx-auto mt-14 h-72 w-72">
              <div className="atom-shell one" />
              <div className="atom-shell two" />
              <div className="atom-shell three" />
              <div className="atom-core absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300 shadow-[0_0_55px_rgba(103,232,249,.95)]" />
              <div className="absolute left-1/2 top-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-300/25 bg-cyan-400/5 blur-[1px]" />
            </div>
          </div>

          <div className="relative px-4 py-4 sm:px-6 sm:py-5 lg:px-7 lg:py-6">
            <header className="rounded-[1.85rem] border border-cyan-300/18 bg-gradient-to-r from-slate-950/80 via-[#081a37]/85 to-slate-950/75 p-5 shadow-[0_0_55px_rgba(0,0,0,.22)]">
              <div className="absolute inset-x-0 top-0 hidden h-px bg-gradient-to-r from-cyan-400/0 via-cyan-300/80 to-violet-300/0 sm:block" />
              <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="max-w-3xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <TonePill tone="cyan">WINNER OS · ATOM PREMIUM</TonePill>
                    <TonePill tone="violet">Portal protegido de asesora</TonePill>
                  </div>
                  <h2 className="mt-4 max-w-2xl text-4xl font-black leading-[1.03] tracking-tight text-white sm:text-5xl">
                    Centro de <span className="bg-gradient-to-r from-cyan-300 via-sky-200 to-violet-200 bg-clip-text text-transparent">Confirmaciones Inteligentes</span>
                  </h2>
                  <p className="mt-4 max-w-2xl text-[15px] leading-7 text-slate-300">
                    Interfaz premium para operar pedidos, detectar reincidencias y preparar el contacto manual por WhatsApp con lectura clara, acentos visuales y una experiencia de inteligencia artificial realmente profesional.
                  </p>
                </div>

                <AccentCard tone="blue" className="max-w-[360px] p-4">
                  <div className="relative flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-sky-300/30 bg-sky-400/15 shadow-[0_0_24px_rgba(56,189,248,.16)]">
                        <UserCircle2 className="h-6 w-6 text-sky-100" />
                      </div>
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Sesión activa</p>
                        <p className="mt-1 text-sm font-bold text-white break-all">{user?.email || 'Asesora Winner'}</p>
                        <p className="text-xs text-sky-200">Rol protegido: Confirmaciones</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={onLogout}
                      className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-cyan-300/35 hover:bg-cyan-500/10"
                    >
                      <LogOut className="h-4 w-4" />
                      Salir
                    </button>
                  </div>
                </AccentCard>
              </div>
            </header>

            <section className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {kpiCards.map((card) => {
                const Icon = card.icon;
                const t = toneStyles[card.tone] || toneStyles.cyan;
                return (
                  <AccentCard key={card.title} tone={card.tone} className="p-5 scan-line">
                    <div className="relative flex items-start justify-between gap-4">
                      <div>
                        <p className={`text-[11px] font-bold uppercase tracking-[0.2em] ${t.label}`}>{card.title}</p>
                        <p className="mt-4 text-3xl font-black text-white">{card.value}</p>
                        <p className="mt-2 text-sm leading-6 text-slate-300">{card.helper}</p>
                      </div>
                      <div className={`flex h-14 w-14 items-center justify-center rounded-2xl border ${t.icon}`}>
                        <Icon className="h-7 w-7" />
                      </div>
                    </div>
                    <div className="relative mt-5 flex items-center justify-between">
                      <TonePill tone={card.tone}>{card.badge}</TonePill>
                      <span className="text-xs text-slate-500">Vista premium</span>
                    </div>
                  </AccentCard>
                );
              })}
            </section>

            <div className="mt-5 grid gap-5 2xl:grid-cols-[1.2fr_0.92fr]">
              <AccentCard tone="cyan" className="p-5 lg:p-6">
                <div className="relative">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-cyan-200">
                        <Sparkles className="h-4 w-4" />
                        <span className="text-[11px] font-bold uppercase tracking-[0.2em]">Centro de mando</span>
                      </div>
                      <h3 className="mt-3 text-2xl font-black text-white sm:text-[2rem]">Panel operativo premium para asesoras</h3>
                      <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-300">
                        Ahora sí con mayor contraste, acentos visibles, bloques bien separados y lectura realmente organizada para una operación rápida y elegante.
                      </p>
                    </div>
                    <TonePill tone="amber">Datos sensibles aún protegidos</TonePill>
                  </div>

                  <div className="mt-6 grid gap-4 lg:grid-cols-3">
                    {queueStates.map((item) => {
                      const Icon = item.icon;
                      const t = toneStyles[item.tone] || toneStyles.cyan;
                      return (
                        <AccentCard key={item.label} tone={item.tone} className="p-4">
                          <div className="relative">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className={`text-[11px] font-bold uppercase tracking-[0.18em] ${t.label}`}>{item.label}</p>
                                <p className="mt-3 text-2xl font-black text-white">{item.value}</p>
                                <p className="mt-2 text-sm leading-6 text-slate-300">{item.helper}</p>
                              </div>
                              <div className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${t.icon}`}>
                                <Icon className="h-5 w-5" />
                              </div>
                            </div>
                          </div>
                        </AccentCard>
                      );
                    })}
                  </div>

                  <div className="mt-6 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                    <AccentCard tone="blue" className="p-5">
                      <div className="relative">
                        <div className="flex items-center gap-3">
                          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-sky-300/30 bg-sky-500/15 text-sky-100">
                            <Eye className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-sky-200">Vista de asesora</p>
                            <h4 className="text-2xl font-black text-white">Bandeja premium protegida</h4>
                          </div>
                        </div>
                        <p className="mt-4 text-sm leading-7 text-slate-300">
                          Esta versión prepara la experiencia final: pedidos, alertas, botones de acción y trazabilidad, sin exponer todavía datos reales hasta completar la validación del backend por identidad.
                        </p>
                        <div className="mt-5 grid gap-3 sm:grid-cols-2">
                          <button type="button" className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-300/30 bg-gradient-to-r from-cyan-500/18 to-sky-500/18 px-4 py-3 text-sm font-semibold text-cyan-50 shadow-[0_0_22px_rgba(34,211,238,.12)] transition hover:from-cyan-500/24 hover:to-sky-500/24">
                            Vista prioritaria
                            <ArrowRight className="h-4 w-4" />
                          </button>
                          <button type="button" className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-slate-100 transition hover:border-violet-300/25 hover:bg-violet-500/10">
                            Modo lectura segura
                          </button>
                        </div>
                      </div>
                    </AccentCard>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {pipelineSteps.map((step) => {
                        const Icon = step.icon;
                        const tone = step.status === 'activo' ? 'emerald' : 'amber';
                        const t = toneStyles[tone];
                        return (
                          <AccentCard key={step.title} tone={tone} className="p-4">
                            <div className="relative h-full">
                              <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${t.icon}`}>
                                <Icon className="h-5 w-5" />
                              </div>
                              <div className="mt-4 flex flex-wrap items-center gap-2">
                                <h5 className="text-sm font-bold text-white">{step.title}</h5>
                                <TonePill tone={tone}>{step.status === 'activo' ? 'Activo' : 'Pendiente'}</TonePill>
                              </div>
                              <p className="mt-3 text-sm leading-6 text-slate-300">{step.description}</p>
                            </div>
                          </AccentCard>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </AccentCard>

              <div className="grid gap-5">
                <AccentCard tone="violet" className="p-5 lg:p-6">
                  <div className="relative">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-200">Alertas inteligentes</p>
                        <h3 className="mt-2 text-2xl font-black text-white">Tratamiento especial del cliente</h3>
                      </div>
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-violet-300/30 bg-violet-500/15 text-violet-100">
                        <BrainCircuit className="h-5 w-5" />
                      </div>
                    </div>
                    <div className="mt-5 grid gap-4">
                      {alertItems.map((item) => {
                        const Icon = item.icon;
                        const t = toneStyles[item.tone] || toneStyles.cyan;
                        return (
                          <AccentCard key={item.title} tone={item.tone} className="p-4">
                            <div className="relative flex items-start gap-4">
                              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${t.icon}`}>
                                <Icon className="h-5 w-5" />
                              </div>
                              <div>
                                <h4 className={`text-base font-bold ${t.title}`}>{item.title}</h4>
                                <p className="mt-2 text-sm leading-7 text-slate-300">{item.description}</p>
                              </div>
                            </div>
                          </AccentCard>
                        );
                      })}
                    </div>
                  </div>
                </AccentCard>

                <AccentCard tone="amber" className="p-5 lg:p-6">
                  <div className="relative">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-amber-300/28 bg-amber-500/15 text-amber-100">
                        <Cpu className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-200">Resumen técnico</p>
                        <h3 className="text-2xl font-black text-white">Estado de la plataforma</h3>
                      </div>
                    </div>
                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                      <AccentCard tone="cyan" className="p-4">
                        <div className="relative">
                          <p className="text-sm font-bold text-white">Estado de conexión</p>
                          <p className="mt-3 text-sm leading-7 text-slate-300">Shopify y el Worker de confirmaciones ya están conectados y reciben pedidos en tiempo real.</p>
                        </div>
                      </AccentCard>
                      <AccentCard tone="amber" className="p-4">
                        <div className="relative">
                          <p className="text-sm font-bold text-white">Siguiente liberación</p>
                          <p className="mt-3 text-sm leading-7 text-slate-300">Asignación por asesora y bandeja real una vez se complete la validación de identidad en backend.</p>
                        </div>
                      </AccentCard>
                    </div>
                  </div>
                </AccentCard>
              </div>
            </div>

            <footer className="mt-5 rounded-[1.75rem] border border-cyan-300/12 bg-slate-950/45 px-5 py-4 text-sm backdrop-blur-2xl">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <p className="text-slate-300">
                  <span className="font-bold text-cyan-100">ATOM Premium UI 2.0</span> · Más contraste, acentos visibles, animación perceptible y jerarquía clara para el módulo de confirmaciones.
                </p>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">WINNER OS · Tu Pedido Colombia</p>
              </div>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}
