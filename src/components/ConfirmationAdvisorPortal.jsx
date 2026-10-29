import React from 'react';
import {
  Bot,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Cpu,
  LogOut,
  MessageCircleMore,
  Orbit,
  Radar,
  ShieldCheck,
  ShoppingBag,
  Siren,
  Sparkles,
  Wifi,
  XCircle,
  Zap,
  UserCircle2,
  BellRing,
  ArrowRight,
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
    accent: 'from-cyan-400/25 via-sky-400/10 to-transparent',
    badge: 'ONLINE',
  },
  {
    title: 'Asignaciones automáticas',
    value: 'Pausadas',
    helper: 'Aún no se liberan pedidos a asesoras',
    icon: Radar,
    accent: 'from-amber-400/25 via-orange-400/10 to-transparent',
    badge: 'CONTROL',
  },
  {
    title: 'WhatsApp operativo',
    value: 'Manual',
    helper: 'La asesora seguirá enviando al cliente manualmente',
    icon: MessageCircleMore,
    accent: 'from-violet-400/25 via-fuchsia-400/10 to-transparent',
    badge: 'HÍBRIDO',
  },
  {
    title: 'Alertas inteligentes',
    value: 'Lista previa',
    helper: 'Duplicados y pedidos recientes con IA operativa',
    icon: Bot,
    accent: 'from-blue-400/25 via-cyan-300/10 to-transparent',
    badge: 'IA',
  },
];

const alertItems = [
  {
    title: 'Cliente con pedido reciente',
    description:
      'Detecta clientes que hicieron pedidos en días cercanos para aplicar un trato especial y validar si desean una nueva compra o seguimiento.',
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
      'La interfaz queda lista para mostrar historial reciente del cliente, prioridad de atención y recomendación asistida por IA.',
    tone: 'violet',
    icon: Sparkles,
  },
];

const pipelineSteps = [
  {
    title: 'Recepción automática',
    description: 'Shopify entrega el pedido en tiempo real y lo registra en la cola protegida de WINNER OS.',
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
    description: 'La asesora enviará manualmente el mensaje al cliente desde su propio WhatsApp Business.',
    icon: MessageCircleMore,
    status: 'pendiente',
  },
];

const queueStates = [
  { label: 'Pendientes', value: 'Sin exponer', icon: Clock3, tone: 'cyan' },
  { label: 'Confirmados', value: 'Bloqueado', icon: CheckCircle2, tone: 'emerald' },
  { label: 'Cancelados', value: 'Bloqueado', icon: XCircle, tone: 'rose' },
];

const toneClasses = {
  emerald: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200',
  cyan: 'border-cyan-400/40 bg-cyan-500/10 text-cyan-100',
  amber: 'border-amber-400/40 bg-amber-500/10 text-amber-100',
  violet: 'border-violet-400/40 bg-violet-500/10 text-violet-100',
  rose: 'border-rose-400/40 bg-rose-500/10 text-rose-100',
};

function TonePill({ tone = 'cyan', children }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-bold tracking-[0.18em] uppercase ${toneClasses[tone] || toneClasses.cyan}`}>
      {children}
    </span>
  );
}

export default function ConfirmationAdvisorPortal({ user, onLogout }) {
  return (
    <div className="min-h-screen overflow-hidden bg-[#020816] text-slate-100">
      <style>{`
        @keyframes atomSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes atomSpinReverse {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }
        @keyframes pulseGlow {
          0%,100% { opacity: .35; transform: scale(1); }
          50% { opacity: .9; transform: scale(1.08); }
        }
        @keyframes floatPanel {
          0%,100% { transform: translateY(0px); }
          50% { transform: translateY(-6px); }
        }
        @keyframes scanLine {
          0% { transform: translateX(-100%); opacity: 0; }
          25% { opacity: .7; }
          100% { transform: translateX(140%); opacity: 0; }
        }
        .atom-shell { position: absolute; inset: 0; border-radius: 9999px; border: 1px solid rgba(90, 211, 255, 0.55); box-shadow: 0 0 30px rgba(26, 196, 255, 0.16); }
        .atom-shell.one { transform: rotate(18deg) scaleX(1.15); animation: atomSpin 12s linear infinite; }
        .atom-shell.two { transform: rotate(78deg) scaleX(1.2); animation: atomSpinReverse 15s linear infinite; }
        .atom-shell.three { transform: rotate(-42deg) scaleX(1.05); animation: atomSpin 18s linear infinite; }
        .atom-core { animation: pulseGlow 3.2s ease-in-out infinite; }
        .floating-premium { animation: floatPanel 6s ease-in-out infinite; }
        .scan-line::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, transparent, rgba(130,240,255,.16), transparent);
          transform: translateX(-120%);
          animation: scanLine 6s linear infinite;
        }
        .circuit-layer {
          background-image:
            linear-gradient(rgba(76, 175, 255, 0.16) 1px, transparent 1px),
            linear-gradient(90deg, rgba(76, 175, 255, 0.16) 1px, transparent 1px);
          background-size: 72px 72px;
          mask-image: radial-gradient(circle at center, rgba(0,0,0,.95), rgba(0,0,0,.2) 66%, transparent 100%);
        }
        .circuit-svg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          opacity: .55;
        }
        .circuit-svg path {
          stroke-dasharray: 8 12;
          animation: atomSpinReverse 40s linear infinite;
        }
      `}</style>

      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(44,140,255,0.18),_transparent_38%),radial-gradient(circle_at_bottom_right,_rgba(0,255,240,0.12),_transparent_28%),linear-gradient(135deg,_#020817_0%,_#031127_32%,_#071a37_58%,_#041121_100%)]" />
        <div className="absolute inset-0 circuit-layer opacity-35" />
        <svg className="circuit-svg" viewBox="0 0 1440 900" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M0 180H220V120H430V260H680V80H980V340H1440" stroke="rgba(112,202,255,.42)" strokeWidth="1.4" />
          <path d="M0 620H210V490H470V680H720V520H1020V740H1440" stroke="rgba(71,242,255,.34)" strokeWidth="1.3" />
          <path d="M70 820V560H300V460H540V640H900V470H1190V650H1370" stroke="rgba(118,162,255,.30)" strokeWidth="1.1" />
          <path d="M1400 90H1160V210H930V140H700V280H430V220H180V390H20" stroke="rgba(155,221,255,.28)" strokeWidth="1.1" />
          <circle cx="430" cy="260" r="4" fill="rgba(125,236,255,.75)" />
          <circle cx="980" cy="340" r="4" fill="rgba(125,236,255,.75)" />
          <circle cx="300" cy="460" r="4" fill="rgba(125,236,255,.65)" />
          <circle cx="1020" cy="740" r="4" fill="rgba(125,236,255,.65)" />
        </svg>
      </div>

      <div className="relative z-10 flex min-h-screen">
        <aside className="hidden xl:flex w-[290px] shrink-0 flex-col border-r border-white/10 bg-slate-950/45 backdrop-blur-2xl px-6 py-7">
          <div className="rounded-3xl border border-cyan-400/20 bg-white/5 p-5 shadow-[0_0_50px_rgba(0,145,255,0.08)]">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 via-sky-400 to-blue-600 shadow-[0_0_30px_rgba(56,189,248,.35)]">
                <Orbit className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-200/90">ATOM · IA</p>
                <h1 className="text-lg font-black tracking-wide text-white">Confirmaciones</h1>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              Centro premium para operación de pedidos, alertas inteligentes y seguimiento de clientes dentro de WINNER OS.
            </p>
          </div>

          <div className="mt-8 space-y-3">
            {[
              { label: 'Centro de mando', icon: Cpu, active: true },
              { label: 'Bandeja operativa', icon: ShoppingBag },
              { label: 'Alertas de IA', icon: BrainCircuit },
              { label: 'Estado de conexión', icon: Wifi },
            ].map(item => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold ${item.active ? 'border-cyan-400/35 bg-cyan-500/10 text-cyan-50 shadow-[0_0_24px_rgba(34,211,238,.12)]' : 'border-white/10 bg-white/[0.03] text-slate-300'}`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </div>
              );
            })}
          </div>

          <div className="mt-8 rounded-3xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-200">Estados del sistema</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {statusPills.map(item => {
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

          <div className="mt-auto rounded-3xl border border-indigo-400/20 bg-gradient-to-br from-white/[0.06] to-cyan-500/[0.04] p-5 floating-premium">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-indigo-200">Seguridad de acceso</p>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Este portal está aislado del resto de WINNER OS. Las asesoras verán únicamente su módulo de confirmaciones cuando el backend libere la autorización completa.
            </p>
            <div className="mt-4 flex items-center gap-3 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-emerald-100">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span className="text-sm font-semibold">Acceso por rol validado en Firebase</span>
            </div>
          </div>
        </aside>

        <div className="relative flex-1">
          <div className="absolute right-[-10rem] top-[-8rem] hidden h-[26rem] w-[26rem] xl:block">
            <div className="absolute inset-0 rounded-full bg-cyan-400/10 blur-3xl" />
            <div className="relative mx-auto mt-16 h-72 w-72">
              <div className="atom-shell one" />
              <div className="atom-shell two" />
              <div className="atom-shell three" />
              <div className="atom-core absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300 shadow-[0_0_45px_rgba(103,232,249,.85)]" />
              <div className="absolute left-1/2 top-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-300/25 bg-cyan-400/5 blur-[1px]" />
            </div>
          </div>

          <div className="relative mx-auto max-w-[1650px] px-4 py-4 sm:px-6 lg:px-8">
            <header className="rounded-[2rem] border border-white/12 bg-white/[0.055] px-5 py-5 shadow-[0_0_60px_rgba(2,12,36,.35)] backdrop-blur-2xl">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <TonePill tone="cyan">Winner OS · ATOM Premium</TonePill>
                    <TonePill tone="violet">Portal protegido de asesora</TonePill>
                  </div>
                  <h2 className="mt-4 text-3xl font-black tracking-tight text-white sm:text-4xl">
                    Centro de Confirmaciones Inteligentes
                  </h2>
                  <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300 sm:text-[15px]">
                    Interfaz premium para operar pedidos, detectar reincidencias y preparar el contacto manual por WhatsApp con la mejor lectura visual y control de seguridad.
                  </p>
                </div>

                <div className="flex flex-col gap-3 lg:min-w-[360px]">
                  <div className="rounded-3xl border border-cyan-400/25 bg-gradient-to-br from-slate-950/80 to-slate-900/40 p-4 shadow-[0_0_30px_rgba(34,211,238,.12)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/8 border border-white/10">
                          <UserCircle2 className="h-7 w-7 text-cyan-200" />
                        </div>
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">Sesión activa</p>
                          <p className="mt-1 text-sm font-bold text-white">{user?.email || 'Asesora Winner'}</p>
                          <p className="text-xs text-slate-400">Rol protegido: Confirmaciones</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={onLogout}
                        className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-cyan-300/40 hover:bg-cyan-500/10"
                      >
                        <LogOut className="h-4 w-4" />
                        Salir
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </header>

            <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {kpiCards.map(card => {
                const Icon = card.icon;
                return (
                  <article
                    key={card.title}
                    className={`relative overflow-hidden rounded-[1.8rem] border border-white/10 bg-gradient-to-br ${card.accent} from-white/[0.08] to-white/[0.03] p-5 backdrop-blur-xl shadow-[0_12px_40px_rgba(2,12,36,.28)]`}
                  >
                    <div className="scan-line absolute inset-0 opacity-70" />
                    <div className="relative flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{card.title}</p>
                        <p className="mt-4 text-2xl font-black text-white">{card.value}</p>
                        <p className="mt-2 text-sm leading-6 text-slate-300">{card.helper}</p>
                      </div>
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.08] shadow-[0_0_28px_rgba(76,203,255,.15)]">
                        <Icon className="h-7 w-7 text-cyan-100" />
                      </div>
                    </div>
                    <div className="relative mt-5 flex items-center justify-between">
                      <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-bold tracking-[0.18em] text-cyan-100">
                        {card.badge}
                      </span>
                      <span className="text-xs text-slate-400">Vista premium</span>
                    </div>
                  </article>
                );
              })}
            </section>

            <div className="mt-6 grid gap-6 xl:grid-cols-[1.25fr_.95fr]">
              <section className="rounded-[2rem] border border-white/10 bg-white/[0.05] p-5 backdrop-blur-2xl shadow-[0_0_60px_rgba(0,0,0,.22)]">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-cyan-200">
                      <Sparkles className="h-4 w-4" />
                      <span className="text-xs font-bold uppercase tracking-[0.22em]">Centro de mando</span>
                    </div>
                    <h3 className="mt-3 text-2xl font-black text-white">Panel operativo premium para asesoras</h3>
                    <p className="mt-2 text-sm leading-7 text-slate-300">
                      Diseñado para una lectura inmediata: foco en pedidos, alertas visuales, estados claros y una experiencia futurista alineada con ATOM y WINNER OS.
                    </p>
                  </div>
                  <TonePill tone="amber">Datos sensibles aún protegidos</TonePill>
                </div>

                <div className="mt-6 grid gap-4 lg:grid-cols-3">
                  {queueStates.map(item => {
                    const Icon = item.icon;
                    return (
                      <div key={item.label} className="rounded-[1.6rem] border border-white/10 bg-slate-950/45 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
                            <p className="mt-3 text-xl font-black text-white">{item.value}</p>
                            <p className="mt-2 text-xs leading-6 text-slate-400">Se mostrará cuando el backend autorice pedidos por asesora.</p>
                          </div>
                          <div className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${toneClasses[item.tone].replace('text-', 'border-').split(' ')[0]} bg-white/[0.04]`}>
                            <Icon className="h-5 w-5 text-white" />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-6 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-[1.7rem] border border-cyan-400/18 bg-gradient-to-br from-cyan-500/[0.10] to-blue-500/[0.04] p-5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-400/10">
                        <Orbit className="h-5 w-5 text-cyan-100" />
                      </div>
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-200">Vista de asesora</p>
                        <h4 className="text-lg font-black text-white">Bandeja premium protegida</h4>
                      </div>
                    </div>
                    <p className="mt-4 text-sm leading-7 text-slate-200/90">
                      Esta versión prepara la experiencia final de trabajo: pedidos, alertas, botones de acción y trazabilidad, pero sin exponer clientes reales hasta completar la validación del backend por identidad.
                    </p>
                    <div className="mt-5 flex flex-wrap gap-3">
                      <button type="button" className="inline-flex items-center gap-2 rounded-2xl border border-cyan-300/30 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-50">
                        Vista prioritaria
                        <ArrowRight className="h-4 w-4" />
                      </button>
                      <button type="button" className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-200">
                        Modo lectura segura
                      </button>
                    </div>
                  </div>

                  <div className="rounded-[1.7rem] border border-white/10 bg-slate-950/45 p-5">
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Pipeline operativo</p>
                    <div className="mt-4 space-y-4">
                      {pipelineSteps.map(step => {
                        const Icon = step.icon;
                        return (
                          <div key={step.title} className="flex gap-4 rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                            <div className={`mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${step.status === 'activo' ? 'border-emerald-300/20 bg-emerald-500/10 text-emerald-200' : 'border-amber-300/20 bg-amber-500/10 text-amber-100'}`}>
                              <Icon className="h-4.5 w-4.5" />
                            </div>
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <h5 className="text-sm font-bold text-white">{step.title}</h5>
                                <TonePill tone={step.status === 'activo' ? 'emerald' : 'amber'}>
                                  {step.status === 'activo' ? 'Activo' : 'Pendiente'}
                                </TonePill>
                              </div>
                              <p className="mt-2 text-sm leading-6 text-slate-300">{step.description}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </section>

              <section className="space-y-6">
                <div className="rounded-[2rem] border border-white/10 bg-white/[0.05] p-5 backdrop-blur-2xl shadow-[0_0_60px_rgba(0,0,0,.18)]">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-200">Alertas inteligentes</p>
                      <h3 className="mt-2 text-xl font-black text-white">Tratamiento especial del cliente</h3>
                    </div>
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-violet-300/20 bg-violet-500/10">
                      <BrainCircuit className="h-5 w-5 text-violet-100" />
                    </div>
                  </div>
                  <div className="mt-5 space-y-4">
                    {alertItems.map(item => {
                      const Icon = item.icon;
                      return (
                        <article key={item.title} className="rounded-[1.5rem] border border-white/10 bg-slate-950/50 p-4">
                          <div className="flex items-start gap-3">
                            <div className={`mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${item.tone === 'cyan' ? 'border-cyan-300/25 bg-cyan-500/10 text-cyan-100' : item.tone === 'amber' ? 'border-amber-300/25 bg-amber-500/10 text-amber-100' : 'border-violet-300/25 bg-violet-500/10 text-violet-100'}`}>
                              <Icon className="h-5 w-5" />
                            </div>
                            <div>
                              <h4 className="text-sm font-bold text-white">{item.title}</h4>
                              <p className="mt-2 text-sm leading-6 text-slate-300">{item.description}</p>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-[2rem] border border-white/10 bg-white/[0.05] p-5 backdrop-blur-2xl shadow-[0_0_60px_rgba(0,0,0,.18)]">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">Resumen técnico</p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-[1.4rem] border border-white/10 bg-slate-950/45 p-4">
                      <div className="flex items-center gap-3">
                        <Wifi className="h-4 w-4 text-cyan-100" />
                        <p className="text-sm font-bold text-white">Estado de conexión</p>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-300">Shopify y el Worker de confirmaciones ya están conectados y recibiendo pedidos en tiempo real.</p>
                    </div>
                    <div className="rounded-[1.4rem] border border-white/10 bg-slate-950/45 p-4">
                      <div className="flex items-center gap-3">
                        <Zap className="h-4 w-4 text-cyan-100" />
                        <p className="text-sm font-bold text-white">Siguiente liberación</p>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-300">Asignación por asesora y bandeja real una vez se complete la validación de identidad en backend.</p>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <footer className="mt-6 rounded-[2rem] border border-white/10 bg-white/[0.04] px-5 py-4 text-sm text-slate-300 backdrop-blur-2xl">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <p>
                  <span className="font-bold text-white">ATOM Premium UI</span> · Interfaz futurista con lectura optimizada, fondo animado y jerarquía clara para el nuevo módulo de confirmaciones.
                </p>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">WINNER OS · Tu Pedido Colombia</p>
              </div>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}
