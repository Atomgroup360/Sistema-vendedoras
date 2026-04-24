import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, addDoc, setDoc, updateDoc, deleteDoc, doc, onSnapshot
} from 'firebase/firestore';
import {
  LayoutDashboard, ClipboardList, Settings, Plus, Trash2, Calendar,
  TrendingUp, Package, Layers, Truck, Target, Wallet, CheckCircle2,
  Calculator, Eye, Activity, Pencil, Boxes, ToggleLeft, ToggleRight,
  ChevronDown, ChevronUp, X, AlertTriangle, Save, BarChart3, Percent,
  DollarSign, Users, ShoppingBag, ArrowUpRight, ArrowDownRight, Info
} from 'lucide-react';
 
// ─── FIREBASE CONFIG ──────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyCAGEmzg7k6RCOoqOPqcpOVgws4W2pasDg",
  authDomain: "vendedoras-winner-360.firebaseapp.com",
  projectId: "vendedoras-winner-360",
  storageBucket: "vendedoras-winner-360.firebasestorage.app",
  messagingSenderId: "460355470202",
  appId: "1:460355470202:web:bfa880f95d25192e814cc3"
};
 
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
 
// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmt = (v) => new Intl.NumberFormat('es-CO', {
  style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0
}).format(v || 0);
 
// Número exacto: muestra los decimales reales sin redondear a una cifra fija
// d = mínimo de decimales, max = máximo (si se omite, usa d)
const fmtDec = (v, d = 2, max = null) => new Intl.NumberFormat('es-CO', {
  minimumFractionDigits: d,
  maximumFractionDigits: max !== null ? max : d
}).format(v || 0);
 
// Número exacto sin forzar decimales (muestra solo los necesarios)
const fmtN = (v) => new Intl.NumberFormat('es-CO', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 6
}).format(v || 0);
 
const today = () => new Date().toISOString().split('T')[0];
 
const daysBetween = (a, b) => {
  const d1 = new Date(a + 'T00:00:00');
  const d2 = new Date(b + 'T00:00:00');
  return Math.ceil(Math.abs(d2 - d1) / 86400000) + 1;
};
 
// ─── MOTOR DE CÁLCULO ─────────────────────────────────────────────────────────
//
// PRODUCTOS: Las guías pueden llevar 1, 2 o más unidades (multi-producto).
//   avgUnitsPerOrder = totalUnits / totalOrders
//
// PRODUCTOS REGISTRADOS BRUTOS:
//   grossUnits = suma de todas las unidades registradas
//
// PRODUCTOS QUE SALEN (despachos):
//   unitsShippedReal = shipped_orders × avgUnitsPerOrder
//   (se descuentan los pedidos cancelados / sin cobertura por efectividad)
//
// PRODUCTOS DEVUELTOS A BODEGA:
//   unitsReturnedReal = returns × avgUnitsPerOrder
//   (vuelven al stock, NO son pérdida de producto)
//
// PRODUCTOS REALMENTE ENTREGADOS Y PAGADOS:
//   unitsDeliveredReal = deliveries × avgUnitsPerOrder
//   = grossOrders × IER × avgUnitsPerOrder
//
// COSTO DE MERCANCÍA:
//   Se calcula SOLO sobre unitsDeliveredReal (lo que el cliente pagó)
//   productCostTotal = costUnitario × unitsDeliveredReal
//
// PROMEDIO DE PRODUCTOS POR ENTREGA REAL:
//   avgUnitsPerDelivery = unitsDeliveredReal / finalDeliveries
//   (métrica de eficiencia comercial)
 
function calcularStats(records, configs) {
  let s = {
    // Brutos (raw input)
    grossOrd: 0, grossUnits: 0, grossRev: 0,
    // Operativo
    realShipped: 0, estimatedReturns: 0, finalDeliveries: 0,
    // Unidades físicas — NUEVO DETALLE
    unitsRegistradas: 0,       // Total unidades ingresadas en el sistema
    unitsShippedReal: 0,       // Unidades que realmente salieron (× efectividad)
    unitsReturnedReal: 0,      // Unidades que volvieron a bodega (× devolución)
    unitsDeliveredReal: 0,     // Unidades PAGADAS por el cliente (= costo mercancía)
    // Costos
    totalFreightCost: 0, totalFulfillment: 0,
    productCostTotal: 0, totalCommissions: 0, totalFixedCosts: 0, totalAds: 0,
    // Ingresos
    realRev: 0,
    // Resultado
    net: 0
  };
 
  records.forEach(r => {
    const c = configs.find(x => x.id === r.configId);
    if (!c) return;
 
    const eff     = Math.min(Math.max(parseFloat(c.effectiveness) || 95, 0), 100) / 100;
    const ret     = Math.min(Math.max(parseFloat(c.returnRate)   || 20, 0), 100) / 100;
    const IER     = eff * (1 - ret);
 
    const orders  = parseFloat(r.orders)  || 0;
    const units   = parseFloat(r.units)   || 0;
    const revenue = parseFloat(r.revenue) || 0;
    const ads     = parseFloat(r.adSpend) > 0
                      ? parseFloat(r.adSpend)
                      : (c.fixedAdSpend ? parseFloat(c.dailyAdSpend) || 0 : 0);
 
    // Promedio de unidades por guía en este registro
    const avgUnits     = orders > 0 ? units / orders : 1;
 
    const shipped      = orders * eff;
    const returns_     = shipped * ret;
    const deliveries   = shipped * (1 - ret);  // = orders × IER
 
    // ── UNIDADES FÍSICAS ──────────────────────────────────────────────────────
    // Registradas: lo que se ingresó al sistema (bruto total)
    const unitsRegistradas   = units;
    // Enviadas: solo las guías que salieron × promedio unidades/guía
    const unitsShipped       = shipped * avgUnits;
    // Devueltas: guías devueltas × promedio → regresan al stock
    const unitsReturned      = returns_ * avgUnits;
    // Entregadas y PAGADAS: guías entregadas × promedio → sobre estas se paga mercancía
    const unitsDelivered     = deliveries * avgUnits;
 
    // Fletes: se paga por cada guía despachada (ida + vuelta en devoluciones)
    const extraUnits     = Math.max(avgUnits - 1, 0);
    const fleteUnit      = (parseFloat(c.freight) || 0) + extraUnits * 5000;
    const freightTotal   = shipped * fleteUnit;
    const fulfillTotal   = shipped * (parseFloat(c.fulfillment) || 0);
 
    // ── COSTO MERCANCÍA ───────────────────────────────────────────────────────
    // SOLO sobre unidades entregadas y pagadas (las devueltas regresan al stock)
    const mercanciaNeto  = (parseFloat(c.productCost) || 0) * unitsDelivered;
 
    // Variable por entrega
    const commissions    = deliveries * (parseFloat(c.commission) || 0);
    const fixedCosts     = deliveries * (parseFloat(c.fixedCosts) || 0);
 
    // Recaudo neto
    const realRevenue    = revenue * IER;
 
    // Acumular
    s.grossOrd              += orders;
    s.grossUnits            += units;
    s.grossRev              += revenue;
    s.realShipped           += shipped;
    s.estimatedReturns      += returns_;
    s.finalDeliveries       += deliveries;
    s.unitsRegistradas      += unitsRegistradas;
    s.unitsShippedReal      += unitsShipped;
    s.unitsReturnedReal     += unitsReturned;
    s.unitsDeliveredReal    += unitsDelivered;
    s.totalFreightCost      += freightTotal;
    s.totalFulfillment      += fulfillTotal;
    s.productCostTotal      += mercanciaNeto;
    s.totalCommissions      += commissions;
    s.totalFixedCosts       += fixedCosts;
    s.totalAds              += ads;
    s.realRev               += realRevenue;
  });
 
  s.net = s.realRev
        - s.productCostTotal
        - s.totalFreightCost
        - s.totalFulfillment
        - s.totalCommissions
        - s.totalFixedCosts
        - s.totalAds;
 
  s.ierGlobal = s.grossOrd > 0 ? (s.finalDeliveries / s.grossOrd) * 100 : 0;
  s.freteRealXEntrega = s.finalDeliveries > 0
    ? s.totalFreightCost / s.finalDeliveries : 0;
  s.cpaReal = s.finalDeliveries > 0 ? s.totalAds / s.finalDeliveries : 0;
  s.roas    = s.totalAds > 0 ? s.realRev / s.totalAds : 0;
 
  // ── PROMEDIOS DE PRODUCTOS ─────────────────────────────────────────────────
  // Promedio de unidades por pedido registrado
  s.avgUnitsPerOrder       = s.grossOrd > 0 ? s.grossUnits / s.grossOrd : 0;
  // Promedio de unidades por entrega real (métrica de eficiencia comercial)
  s.avgUnitsPerDelivery    = s.finalDeliveries > 0 ? s.unitsDeliveredReal / s.finalDeliveries : 0;
  // Costo promedio de mercancía por entrega
  s.costMercXEntrega       = s.finalDeliveries > 0 ? s.productCostTotal / s.finalDeliveries : 0;
  // % de productos que llegaron vs registrados
  s.pctProductosEntregados = s.unitsRegistradas > 0 ? (s.unitsDeliveredReal / s.unitsRegistradas) * 100 : 0;
 
  return s;
}
 
// ─── COMPONENTES UI ──────────────────────────────────────────────────────────
const Card = ({ children, className = '', dark = false }) => (
  <div className={`rounded-3xl border p-6 ${dark ? 'bg-zinc-950 border-zinc-800 text-white' : 'bg-white border-slate-100 shadow-sm'} ${className}`}>
    {children}
  </div>
);
 
const Label = ({ children, className = '' }) => (
  <p className={`text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1.5 ${className}`}>{children}</p>
);
 
const InputField = ({ label, type = 'text', value, onChange, placeholder, className = '', dark = false }) => (
  <div className="space-y-1">
    {label && <Label className={dark ? 'text-zinc-500' : ''}>{label}</Label>}
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={`w-full px-4 py-3.5 rounded-2xl font-semibold text-sm outline-none transition-all
        ${dark
          ? 'bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-600 focus:border-emerald-500'
          : 'bg-slate-50 border-2 border-transparent focus:border-emerald-400 text-slate-900'
        } ${className}`}
    />
  </div>
);
 
const Stat = ({ label, value, sub, accent = false, big = false, dark = false, highlight = false }) => (
  <div className={`p-4 rounded-2xl ${accent ? 'bg-emerald-500 text-white' : highlight ? 'bg-blue-50 border border-blue-100' : dark ? 'bg-zinc-800' : 'bg-slate-50'}`}>
    <p className={`text-[9px] font-black uppercase tracking-widest mb-1 ${accent ? 'text-emerald-100' : highlight ? 'text-blue-500' : dark ? 'text-zinc-500' : 'text-slate-400'}`}>{label}</p>
    <p className={`font-black font-mono leading-none ${big ? 'text-2xl' : 'text-lg'} ${accent ? 'text-white' : highlight ? 'text-blue-700' : dark ? 'text-white' : 'text-slate-900'}`}>{value}</p>
    {sub && <p className={`text-[9px] mt-1 font-semibold ${accent ? 'text-emerald-100' : highlight ? 'text-blue-400' : dark ? 'text-zinc-500' : 'text-slate-400'}`}>{sub}</p>}
  </div>
);
 
// ─── VISTA 1: CONFIGURACIÓN ────────────────────────────────────────────────────
const EMPTY_CONFIG = {
  vendedora: '', productName: '',
  targetProfit: '', productCost: '', freight: '', fulfillment: '',
  commission: '', returnRate: '20', effectiveness: '95',
  fixedCosts: '', priceSingle: '', dailyAdSpend: '', fixedAdSpend: true
};
 
function VistaConfig({ configs, onSaved }) {
  const [showForm, setShowForm]     = useState(false);
  const [editId, setEditId]         = useState(null);
  const [form, setForm]             = useState(EMPTY_CONFIG);
  const [expandedV, setExpandedV]   = useState({});
 
  const grouped = useMemo(() => configs.reduce((a, c) => {
    if (!a[c.vendedora]) a[c.vendedora] = [];
    a[c.vendedora].push(c);
    return a;
  }, {}), [configs]);
 
  const openNew = () => { setEditId(null); setForm(EMPTY_CONFIG); setShowForm(true); };
 
  // Abre el form con la vendedora pre-llenada y la sección expandida
  const openNewForVendor = (vendedora) => {
    setEditId(null);
    setForm({ ...EMPTY_CONFIG, vendedora });
    setExpandedV(x => ({ ...x, [vendedora]: true }));
    setShowForm(true);
  };
 
  const openEdit = (p) => { setEditId(p.id); setForm({ ...p }); setShowForm(true); };
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
 
  const save = async () => {
    if (!form.vendedora.trim() || !form.productName.trim()) return;
    const data = { ...form };
    if (editId) await updateDoc(doc(db, 'sales_configs', editId), data);
    else await addDoc(collection(db, 'sales_configs'), { ...data, createdAt: Date.now() });
    setShowForm(false);
    onSaved?.();
  };
 
  const remove = async (id) => {
    if (window.confirm('¿Eliminar esta estrategia?')) await deleteDoc(doc(db, 'sales_configs', id));
  };
 
  const toggleV = (v) => setExpandedV(x => ({ ...x, [v]: !x[v] }));
 
  // Preview de profit unitario estimado
  const previewProfit = useMemo(() => {
    const eff = parseFloat(form.effectiveness) / 100 || 0.95;
    const ret = parseFloat(form.returnRate) / 100 || 0.20;
    const IER = eff * (1 - ret);
    const precio = parseFloat(form.priceSingle) || 0;
    const costo  = parseFloat(form.productCost) || 0;
    const flete  = parseFloat(form.freight) || 0;
    const full   = parseFloat(form.fulfillment) || 0;
    const com    = parseFloat(form.commission) || 0;
    const fijos  = parseFloat(form.fixedCosts) || 0;
    const ads    = parseFloat(form.dailyAdSpend) || 0;
 
    const ingreso = precio * IER;
    const costos  = costo + (flete / (IER || 1)) + full + com + fijos + ads;
    return ingreso - costos;
  }, [form]);
 
  // Nombre de la vendedora pre-llenada (para el modal)
  const isPrefilledVendor = showForm && !editId && form.vendedora && configs.some(c => c.vendedora === form.vendedora);
 
  return (
    <div className="space-y-8 anim-fade">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-black italic uppercase tracking-tighter text-zinc-900">Estrategias</h2>
          <p className="text-xs text-slate-400 font-semibold mt-1 uppercase tracking-widest">Módulo 1 · Vendedoras y Productos</p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 bg-zinc-950 text-white px-6 py-3.5 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-zinc-800 active:scale-95 transition-all shadow-lg"
        >
          <Plus size={16} /> Nueva Vendedora + Producto
        </button>
      </div>
 
      {/* Lista de vendedoras */}
      {Object.keys(grouped).length === 0 ? (
        <Card className="text-center py-16 text-slate-300">
          <Users size={48} className="mx-auto mb-4 opacity-30" />
          <p className="font-black uppercase text-sm">Sin estrategias aún</p>
          <p className="text-xs mt-1">Crea la primera estrategia para comenzar</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([vendedora, productos]) => (
            <Card key={vendedora} className="overflow-hidden p-0">
              <div className="flex items-center justify-between gap-3 p-5 bg-white">
                {/* Zona click para expandir/colapsar */}
                <div
                  onClick={() => toggleV(vendedora)}
                  className="flex-1 flex items-center gap-3 cursor-pointer select-none"
                >
                  <div className="w-10 h-10 rounded-2xl bg-emerald-500 flex items-center justify-center text-white font-black text-sm shrink-0">
                    {vendedora[0]?.toUpperCase()}
                  </div>
                  <div>
                    <p className="font-black text-sm uppercase tracking-wide">{vendedora}</p>
                    <p className="text-[10px] text-slate-400 font-semibold">{productos.length} producto{productos.length > 1 ? 's' : ''} · click para {expandedV[vendedora] ? 'cerrar' : 'ver'}</p>
                  </div>
                </div>
 
                <div className="flex items-center gap-2 shrink-0">
                  {/* ── BOTÓN AGREGAR PRODUCTO A VENDEDORA EXISTENTE ── */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); openNewForVendor(vendedora); }}
                    title={`Agregar nuevo producto a ${vendedora}`}
                    className="flex items-center gap-1.5 bg-emerald-500 text-zinc-950 px-4 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-400 active:scale-95 transition-all shadow-sm"
                  >
                    <Plus size={14} /> + Producto
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleV(vendedora)}
                    className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 transition-colors"
                  >
                    {expandedV[vendedora] ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </button>
                </div>
              </div>
 
              {expandedV[vendedora] && (
                <div className="border-t border-slate-100 divide-y divide-slate-100">
                  {productos.map(p => (
                    <div key={p.id} className="p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                      <div className="flex-1 space-y-2">
                        <p className="font-black text-emerald-600 uppercase text-sm">{p.productName}</p>
                        <div className="flex flex-wrap gap-2">
                          <span className="text-[9px] font-black bg-slate-100 text-slate-500 px-2 py-1 rounded-lg uppercase">EFF {p.effectiveness}%</span>
                          <span className="text-[9px] font-black bg-rose-50 text-rose-500 px-2 py-1 rounded-lg uppercase">DEV {p.returnRate}%</span>
                          <span className="text-[9px] font-black bg-emerald-50 text-emerald-600 px-2 py-1 rounded-lg uppercase">IER {(parseFloat(p.effectiveness)/100*(1-parseFloat(p.returnRate)/100)*100).toFixed(1)}%</span>
                          <span className="text-[9px] font-black bg-blue-50 text-blue-500 px-2 py-1 rounded-lg uppercase">Flete {fmt(p.freight)}</span>
                          <span className="text-[9px] font-black bg-amber-50 text-amber-600 px-2 py-1 rounded-lg uppercase">Meta {fmt(p.targetProfit)}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 mt-2">
                          <div className="text-center bg-slate-50 p-2 rounded-xl">
                            <p className="text-[8px] text-slate-400 uppercase font-black">Costo Unit</p>
                            <p className="font-black text-xs text-slate-700">{fmt(p.productCost)}</p>
                          </div>
                          <div className="text-center bg-slate-50 p-2 rounded-xl">
                            <p className="text-[8px] text-slate-400 uppercase font-black">Comisión</p>
                            <p className="font-black text-xs text-slate-700">{fmt(p.commission)}</p>
                          </div>
                          <div className="text-center bg-slate-50 p-2 rounded-xl">
                            <p className="text-[8px] text-slate-400 uppercase font-black">Fijos/Ent</p>
                            <p className="font-black text-xs text-slate-700">{fmt(p.fixedCosts)}</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => openEdit(p)} className="p-2.5 rounded-xl hover:bg-emerald-50 hover:text-emerald-600 text-slate-400 transition-colors"><Pencil size={16} /></button>
                        <button onClick={() => remove(p.id)} className="p-2.5 rounded-xl hover:bg-rose-50 hover:text-rose-500 text-slate-400 transition-colors"><Trash2 size={16} /></button>
                      </div>
                    </div>
                  ))}
 
                  {/* ── BOTÓN INLINE DENTRO DEL PANEL EXPANDIDO ── */}
                  <div className="p-5 bg-slate-50/60">
                    <button
                      onClick={() => openNewForVendor(vendedora)}
                      className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-emerald-200 text-emerald-600 bg-white px-5 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-emerald-50 hover:border-emerald-400 active:scale-95 transition-all"
                    >
                      <Plus size={16} /> Agregar nuevo producto a {vendedora}
                    </button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
 
      {/* Modal formulario */}
      {showForm && (
        <div className="fixed inset-0 bg-zinc-950/90 backdrop-blur-xl flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-3xl rounded-3xl p-8 max-h-[92vh] overflow-y-auto anim-zoom shadow-2xl">
            <div className="flex justify-between items-center mb-8 pb-6 border-b border-slate-100">
              <div>
                <h3 className="text-2xl font-black italic uppercase">
                  {editId ? 'Editar' : isPrefilledVendor ? `Nuevo Producto · ${form.vendedora}` : 'Nueva'} Estrategia
                </h3>
                <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mt-1">
                  {isPrefilledVendor
                    ? `Agregando producto a vendedora existente`
                    : 'Define parámetros de costo por producto'}
                </p>
              </div>
              <button onClick={() => setShowForm(false)} className="p-2 rounded-xl hover:bg-slate-100 transition-colors"><X size={20} /></button>
            </div>
 
            {/* Aviso si es producto nuevo para vendedora existente */}
            {isPrefilledVendor && (
              <div className="mb-6 flex items-center gap-3 bg-emerald-50 border border-emerald-200 px-5 py-4 rounded-2xl">
                <div className="w-8 h-8 rounded-xl bg-emerald-500 flex items-center justify-center text-white font-black text-sm shrink-0">
                  {form.vendedora[0]?.toUpperCase()}
                </div>
                <div>
                  <p className="text-xs font-black text-emerald-700 uppercase">{form.vendedora}</p>
                  <p className="text-[9px] text-emerald-500 font-semibold">Vendedora ya registrada · solo configura el nuevo producto</p>
                </div>
              </div>
            )}
 
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {/* Si es vendedora nueva, muestra campo editable; si ya existe, muestra solo el nombre */}
              {isPrefilledVendor ? (
                <div className="sm:col-span-2 bg-zinc-950 text-white px-5 py-4 rounded-2xl flex items-center gap-3">
                  <Users size={16} className="text-emerald-400 shrink-0" />
                  <div>
                    <p className="text-[9px] text-zinc-500 font-black uppercase tracking-widest">Vendedora</p>
                    <p className="font-black text-emerald-400 text-base uppercase">{form.vendedora}</p>
                  </div>
                </div>
              ) : (
                <InputField label="Nombre Vendedora" value={form.vendedora} onChange={e => set('vendedora', e.target.value)} placeholder="Ej: CAMILA PEREIRA" />
              )}
              <InputField
                label="Nombre Producto"
                value={form.productName}
                onChange={e => set('productName', e.target.value)}
                placeholder="Ej: CEPILLO PRO X2"
                className={isPrefilledVendor ? 'sm:col-span-1' : ''}
              />
 
              {/* Efectividad y Devolución */}
              <div className="bg-emerald-50 border border-emerald-100 p-5 rounded-2xl space-y-2">
                <Label className="text-emerald-700">% Efectividad (pedidos que salen)</Label>
                <input type="number" value={form.effectiveness} onChange={e => set('effectiveness', e.target.value)}
                  className="w-full bg-transparent font-black text-4xl text-emerald-800 outline-none" />
                <p className="text-[9px] text-emerald-600 font-semibold">Pedidos cancelados o sin cobertura que NO salen</p>
              </div>
              <div className="bg-rose-50 border border-rose-100 p-5 rounded-2xl space-y-2">
                <Label className="text-rose-600">% Devolución transportadora</Label>
                <input type="number" value={form.returnRate} onChange={e => set('returnRate', e.target.value)}
                  className="w-full bg-transparent font-black text-4xl text-rose-700 outline-none" />
                <p className="text-[9px] text-rose-500 font-semibold">Del total despachado, % que regresa sin pagar</p>
              </div>
 
              {/* IER calculado en tiempo real */}
              <div className="sm:col-span-2 bg-zinc-950 text-white p-5 rounded-2xl flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Índice de Efectividad Real (IER)</p>
                  <p className="text-xs text-zinc-400 mt-0.5">De cada 100 pedidos registrados, ¿cuántos se pagan?</p>
                </div>
                <div className="text-right">
                  <p className="text-4xl font-black font-mono text-emerald-400">
                    {((parseFloat(form.effectiveness)||95)/100 * (1-(parseFloat(form.returnRate)||20)/100) * 100).toFixed(1)}%
                  </p>
                </div>
              </div>
 
              <InputField label="Precio de Venta (1 unidad)" type="number" value={form.priceSingle} onChange={e => set('priceSingle', e.target.value)} placeholder="Ej: 79000" />
              <InputField label="Costo Unitario de Producto" type="number" value={form.productCost} onChange={e => set('productCost', e.target.value)} placeholder="Ej: 18000" />
              <InputField label="Flete Base por Guía" type="number" value={form.freight} onChange={e => set('freight', e.target.value)} placeholder="Ej: 9500" />
              <InputField label="Fulfillment / Alistamiento por guía" type="number" value={form.fulfillment} onChange={e => set('fulfillment', e.target.value)} placeholder="Ej: 1500" />
              <InputField label="Comisión por Entrega Exitosa" type="number" value={form.commission} onChange={e => set('commission', e.target.value)} placeholder="Ej: 3000" />
              <InputField label="Costos Fijos Operativos por Entrega" type="number" value={form.fixedCosts} onChange={e => set('fixedCosts', e.target.value)} placeholder="Ej: 2000" />
              <InputField label="Meta de Utilidad Mensual" type="number" value={form.targetProfit} onChange={e => set('targetProfit', e.target.value)} placeholder="Ej: 4000000" />
 
              {/* ADS con toggle */}
              <div className="bg-zinc-950 text-white p-5 rounded-2xl space-y-3">
                <div className="flex justify-between items-center">
                  <Label className="text-zinc-500">Inversión Ads Diaria</Label>
                  <button
                    onClick={() => set('fixedAdSpend', !form.fixedAdSpend)}
                    className="flex items-center gap-1.5 text-[9px] font-black uppercase"
                  >
                    {form.fixedAdSpend
                      ? <><ToggleRight size={22} className="text-emerald-400" /> <span className="text-emerald-400">FIJA</span></>
                      : <><ToggleLeft size={22} className="text-zinc-500" /> <span className="text-zinc-500">MANUAL</span></>
                    }
                  </button>
                </div>
                <input
                  type="number"
                  value={form.dailyAdSpend}
                  onChange={e => set('dailyAdSpend', e.target.value)}
                  placeholder="$ 0"
                  className="w-full bg-transparent text-emerald-400 font-black text-3xl outline-none placeholder:text-zinc-700"
                />
                <p className="text-[9px] text-zinc-600 font-semibold">
                  {form.fixedAdSpend
                    ? '✓ FIJA: Se aplica automáticamente a cada registro diario'
                    : '⚠ MANUAL: Debes ingresar el valor en cada cierre diario'}
                </p>
              </div>
 
              {/* Preview utilidad */}
              {form.priceSingle && form.productCost && (
                <div className={`sm:col-span-2 p-5 rounded-2xl border-2 ${previewProfit >= 0 ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'}`}>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Preview Utilidad Estimada por Pedido Registrado</p>
                  <p className={`text-3xl font-black font-mono ${previewProfit >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {fmt(previewProfit)}
                  </p>
                  <p className="text-[9px] text-slate-400 mt-1">Aplicando IER, fletes y todos los costos configurados</p>
                </div>
              )}
            </div>
 
            <button
              onClick={save}
              disabled={!form.vendedora.trim() || !form.productName.trim()}
              className="w-full mt-8 bg-emerald-500 text-zinc-950 py-5 rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-emerald-400 active:scale-95 transition-all disabled:opacity-30 flex items-center justify-center gap-2"
            >
              <Save size={18} /> {editId ? 'Actualizar Estrategia' : isPrefilledVendor ? `Agregar Producto a ${form.vendedora}` : 'Guardar Estrategia'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
 
// ─── VISTA 2: REGISTRO DIARIO ─────────────────────────────────────────────────
function VistaRegistro({ configs, months }) {
  const [selectedDate, setSelectedDate]     = useState(today());
  const [form, setForm]                     = useState({ configId: '', orders: '', units: '', revenue: '', adSpend: '' });
  const [editingRec, setEditingRec]         = useState(null);
  const [savedMsg, setSavedMsg]             = useState(false);
 
  const grouped = useMemo(() => configs.reduce((a, c) => {
    if (!a[c.vendedora]) a[c.vendedora] = [];
    a[c.vendedora].push(c);
    return a;
  }, {}), [configs]);
 
  const monthId = selectedDate.substring(0, 7);
  const monthDoc = months.find(m => m.id === monthId);
  const dayRecords = useMemo(() =>
    (monthDoc?.records || []).filter(r => r.date === selectedDate)
  , [monthDoc, selectedDate]);
 
  const selectedConfig = configs.find(c => c.id === form.configId);
 
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
 
  const save = async () => {
    if (!form.configId || !form.orders || !form.units || !form.revenue) return;
    const rec = {
      ...form,
      date: selectedDate,
      id: editingRec?.id || Date.now().toString(),
      savedAt: Date.now()
    };
 
    const ref = doc(db, 'sales_months', monthId);
    const existing = months.find(m => m.id === monthId);
    let recs = existing?.records || [];
 
    if (editingRec) {
      recs = recs.map(r => r.id === editingRec.id ? rec : r);
      await setDoc(ref, { records: recs });
    } else {
      recs = [...recs, rec];
      if (existing) await updateDoc(ref, { records: recs });
      else await setDoc(ref, { records: recs });
    }
 
    setForm({ configId: '', orders: '', units: '', revenue: '', adSpend: '' });
    setEditingRec(null);
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 2500);
  };
 
  const startEdit = (r) => {
    setEditingRec(r);
    setForm({ configId: r.configId, orders: r.orders, units: r.units, revenue: r.revenue, adSpend: r.adSpend || '' });
  };
 
  const deleteRec = async (id) => {
    const ref = doc(db, 'sales_months', monthId);
    const existing = months.find(m => m.id === monthId);
    const recs = (existing?.records || []).filter(r => r.id !== id);
    await setDoc(ref, { records: recs });
  };
 
  const cancelEdit = () => {
    setEditingRec(null);
    setForm({ configId: '', orders: '', units: '', revenue: '', adSpend: '' });
  };
 
  const avgUnits = form.orders && form.units && parseFloat(form.orders) > 0
    ? (parseFloat(form.units) / parseFloat(form.orders)).toFixed(2)
    : null;
 
  return (
    <div className="max-w-2xl mx-auto space-y-6 anim-slide">
      <div>
        <h2 className="text-3xl font-black italic uppercase tracking-tighter">Cierre Diario</h2>
        <p className="text-xs text-slate-400 font-black uppercase tracking-widest mt-1">Módulo 2 · Registro de Operación</p>
      </div>
 
      <Card className={`space-y-5 ${editingRec ? 'border-2 border-amber-400' : ''}`}>
        {editingRec && (
          <div className="flex items-center gap-2 text-amber-600 text-xs font-black uppercase bg-amber-50 px-4 py-2.5 rounded-xl">
            <Pencil size={14} /> Editando registro · <button onClick={cancelEdit} className="text-slate-500 underline ml-auto">Cancelar</button>
          </div>
        )}
 
        {/* Fecha — selector libre para registrar ventas en cualquier fecha */}
        <div className="bg-zinc-950 px-5 py-4 rounded-2xl text-white space-y-4">
          <div className="flex items-center gap-3">
            <Calendar size={18} className="text-emerald-400 shrink-0" />
            <div className="flex-1">
              <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">
                Fecha del Registro · Selección libre
              </p>
              <p className="text-[9px] text-zinc-600 font-semibold mt-0.5">
                Puedes registrar ventas en fechas pasadas, actuales o futuras.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 items-end">
            <div>
              <Label className="text-zinc-500">Calendario</Label>
              <input
                type="date"
                value={selectedDate || today()}
                min="2000-01-01"
                max="2099-12-31"
                onChange={(e) => {
                  const nuevaFecha = e.target.value;
                  if (!nuevaFecha) return;
                  setSelectedDate(nuevaFecha);
                  setEditingRec(null);
                }}
                onInput={(e) => {
                  const nuevaFecha = e.currentTarget.value;
                  if (!nuevaFecha) return;
                  setSelectedDate(nuevaFecha);
                  setEditingRec(null);
                }}
                className="w-full bg-white text-zinc-950 font-black text-base outline-none rounded-xl px-4 py-3 cursor-pointer border-2 border-emerald-400"
                style={{ colorScheme: 'light', appearance: 'auto', WebkitAppearance: 'auto' }}
              />
            </div>

            <button
              type="button"
              onClick={() => {
                const base = new Date((selectedDate || today()) + 'T12:00:00');
                base.setDate(base.getDate() - 1);
                setSelectedDate(base.toISOString().split('T')[0]);
                setEditingRec(null);
              }}
              className="bg-white/10 text-emerald-400 px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-white/20 transition-all"
            >
              Día anterior
            </button>

            <button
              type="button"
              onClick={() => {
                const base = new Date((selectedDate || today()) + 'T12:00:00');
                base.setDate(base.getDate() + 1);
                setSelectedDate(base.toISOString().split('T')[0]);
                setEditingRec(null);
              }}
              className="bg-white/10 text-emerald-400 px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-white/20 transition-all"
            >
              Día siguiente
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
            <div>
              <Label className="text-zinc-500">Fecha manual</Label>
              <input
                type="text"
                inputMode="numeric"
                value={selectedDate || today()}
                placeholder="AAAA-MM-DD"
                onChange={(e) => {
                  const value = e.target.value;
                  setSelectedDate(value);
                  setEditingRec(null);
                }}
                onBlur={(e) => {
                  const value = e.target.value;
                  const isValid = /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value + 'T12:00:00').getTime());
                  if (!isValid) setSelectedDate(today());
                }}
                className="w-full bg-zinc-800 border border-zinc-700 text-white font-black text-base outline-none rounded-xl px-4 py-3 focus:border-emerald-500"
              />
            </div>

            <button
              type="button"
              onClick={() => {
                setSelectedDate(today());
                setEditingRec(null);
              }}
              className="bg-emerald-500 text-zinc-950 px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-400 transition-all"
            >
              Usar hoy
            </button>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
            <p className="text-[10px] text-zinc-500 font-black uppercase">
              Registrando en:{' '}
              <span className="text-emerald-400">
                {new Date((selectedDate || today()) + 'T12:00:00').toLocaleDateString('es-CO', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric'
                })}
              </span>
            </p>
          </div>
        </div>
 
        <div className="space-y-1.5">
          <Label>Vendedora → Producto</Label>
          <select
            value={form.configId}
            onChange={e => set('configId', e.target.value)}
            className="w-full px-4 py-3.5 rounded-2xl bg-slate-50 border-2 border-transparent focus:border-emerald-400 font-semibold text-sm outline-none"
          >
            <option value="">Seleccionar estrategia...</option>
            {Object.entries(grouped).map(([v, ps]) => (
              <optgroup key={v} label={`── ${v.toUpperCase()} ──`}>
                {ps.map(p => <option key={p.id} value={p.id}>{p.productName}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
 
        {selectedConfig && !selectedConfig.fixedAdSpend && (
          <div className="bg-zinc-950 text-white px-5 py-4 rounded-2xl space-y-1">
            <Label className="text-zinc-500">Inversión Ads de Hoy (MANUAL)</Label>
            <input
              type="number" value={form.adSpend} onChange={e => set('adSpend', e.target.value)}
              placeholder="$ 0"
              className="w-full bg-transparent text-emerald-400 font-black text-2xl outline-none placeholder:text-zinc-700"
            />
          </div>
        )}
        {selectedConfig?.fixedAdSpend && (
          <div className="flex items-center gap-2 text-emerald-600 text-[9px] font-black bg-emerald-50 px-4 py-2.5 rounded-xl uppercase">
            <ToggleRight size={16} /> Ads fijo: {fmt(selectedConfig.dailyAdSpend)} · Se aplica automático
          </div>
        )}
 
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-slate-50 p-5 rounded-2xl space-y-1">
            <div className="flex items-center gap-2 text-slate-400"><Package size={14} /><Label>Total Guías</Label></div>
            <input
              type="number" value={form.orders} onChange={e => set('orders', e.target.value)}
              placeholder="0"
              className="w-full bg-transparent font-black text-4xl text-slate-900 outline-none placeholder:text-slate-200"
            />
          </div>
          <div className="bg-slate-50 p-5 rounded-2xl space-y-1">
            <div className="flex items-center gap-2 text-slate-400"><Layers size={14} /><Label>Total Unidades</Label></div>
            <input
              type="number" value={form.units} onChange={e => set('units', e.target.value)}
              placeholder="0"
              className="w-full bg-transparent font-black text-4xl text-slate-900 outline-none placeholder:text-slate-200"
            />
          </div>
        </div>
 
        {avgUnits && (
          <p className="text-[10px] text-slate-400 font-black uppercase text-center">
            Promedio: <span className="text-emerald-600">{avgUnits} unidades/guía</span>
            {parseFloat(avgUnits) > 1 && <span className="text-amber-500 ml-2">· Flete +{fmt((parseFloat(avgUnits)-1)*5000)} extra/guía</span>}
          </p>
        )}
 
        <div className="space-y-1.5">
          <Label>Recaudo Bruto Total del Día</Label>
          <input
            type="number" value={form.revenue} onChange={e => set('revenue', e.target.value)}
            placeholder="$ 0"
            className="w-full px-6 py-5 rounded-2xl bg-slate-50 border-2 border-emerald-100 focus:border-emerald-400 text-emerald-700 font-black text-3xl outline-none placeholder:text-slate-200 transition-all"
          />
        </div>
 
        <button
          onClick={save}
          disabled={!form.configId || !form.orders || !form.units || !form.revenue}
          className="w-full bg-emerald-500 text-zinc-950 py-5 rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-emerald-400 active:scale-95 transition-all disabled:opacity-30 flex items-center justify-center gap-2"
        >
          <Save size={18} /> {editingRec ? 'Actualizar Registro' : 'Guardar Cierre Diario'}
        </button>
 
        {savedMsg && (
          <div className="flex items-center justify-center gap-2 text-emerald-600 text-xs font-black uppercase animate-pulse">
            <CheckCircle2 size={16} /> ¡Guardado exitosamente!
          </div>
        )}
      </Card>
 
      {dayRecords.length > 0 && (
        <div className="space-y-3">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
            Registros de {new Date(selectedDate + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          {dayRecords.map(r => {
            const c = configs.find(x => x.id === r.configId);
            const eff = parseFloat(c?.effectiveness||95)/100;
            const ret = parseFloat(c?.returnRate||20)/100;
            const IER = eff*(1-ret);
            const orders = parseFloat(r.orders)||0;
            const units  = parseFloat(r.units)||0;
            const avgU   = orders > 0 ? units / orders : 1;
            const deliveries = orders * IER;
            const unitsDelivered = deliveries * avgU;
            return (
              <Card key={r.id} className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-black text-sm text-emerald-600 uppercase">{c?.vendedora}</span>
                    <span className="text-slate-300">·</span>
                    <span className="font-semibold text-sm text-slate-600">{c?.productName}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="text-[9px] font-black bg-slate-100 text-slate-500 px-2 py-1 rounded-lg">{r.orders} guías</span>
                    <span className="text-[9px] font-black bg-slate-100 text-slate-500 px-2 py-1 rounded-lg">{r.units} unid. registradas</span>
                    <span className="text-[9px] font-black bg-emerald-50 text-emerald-600 px-2 py-1 rounded-lg">{fmtN(deliveries)} entregas est.</span>
                    <span className="text-[9px] font-black bg-blue-50 text-blue-600 px-2 py-1 rounded-lg">{fmtN(unitsDelivered)} prod. entregados</span>
                    <span className="text-[9px] font-black bg-zinc-100 text-zinc-600 px-2 py-1 rounded-lg">{fmt(r.revenue)}</span>
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => startEdit(r)} className="p-2 rounded-xl hover:bg-amber-50 hover:text-amber-600 text-slate-300 transition-colors"><Pencil size={16} /></button>
                  <button onClick={() => deleteRec(r.id)} className="p-2 rounded-xl hover:bg-rose-50 hover:text-rose-500 text-slate-300 transition-colors"><Trash2 size={16} /></button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
 
// ─── VISTA 3: DASHBOARD ───────────────────────────────────────────────────────
function VistaDashboard({ configs, months }) {
  const [filter, setFilter] = useState({
    startDate: today(), endDate: today(),
    vendedora: 'all', producto: 'all'
  });
 
  const grouped = useMemo(() => configs.reduce((a, c) => {
    if (!a[c.vendedora]) a[c.vendedora] = [];
    a[c.vendedora].push(c);
    return a;
  }, {}), [configs]);
 
  const setF = (k, v) => setFilter(f => ({ ...f, [k]: v }));
 
  const filteredRecords = useMemo(() => {
    const all = months.flatMap(m => m.records || []);
    return all.filter(r => {
      const c = configs.find(x => x.id === r.configId);
      if (!c) return false;
      if (r.date < filter.startDate || r.date > filter.endDate) return false;
      if (filter.vendedora !== 'all' && c.vendedora !== filter.vendedora) return false;
      if (filter.producto !== 'all' && r.configId !== filter.producto) return false;
      return true;
    });
  }, [months, configs, filter]);
 
  const stats = useMemo(() => calcularStats(filteredRecords, configs), [filteredRecords, configs]);
 
  const targetProfit = useMemo(() => {
    if (filter.producto !== 'all') {
      const c = configs.find(x => x.id === filter.producto);
      return parseFloat(c?.targetProfit) || 0;
    }
    if (filter.vendedora !== 'all') {
      const prods = grouped[filter.vendedora] || [];
      return prods.reduce((s, p) => s + (parseFloat(p.targetProfit) || 0), 0);
    }
    return configs.reduce((s, p) => s + (parseFloat(p.targetProfit) || 0), 0);
  }, [filter, configs, grouped]);
 
  const dias = daysBetween(filter.startDate, filter.endDate);
  const avgDiario = stats.net / dias;
  const proyeccion30 = avgDiario * 30;
 
  let semaforo = { color: 'bg-rose-500', texto: 'REVISIÓN', emoji: '🔴', textColor: 'text-rose-500' };
  if (proyeccion30 >= 1_000_000) {
    semaforo = { color: 'bg-emerald-500', texto: 'EXCELENTE', emoji: '🟢', textColor: 'text-emerald-500' };
  } else if (proyeccion30 >= targetProfit && targetProfit > 0) {
    semaforo = { color: 'bg-blue-500', texto: 'BIEN', emoji: '🔵', textColor: 'text-blue-500' };
  }
 
  const costItems = [
    { label: 'Costo de Mercancía', value: stats.productCostTotal, note: `${fmtN(stats.unitsDeliveredReal)} unid. entregadas × costo unit. · devueltas no cuentan`, icon: Package },
    { label: 'Fletes Totales (ida+vuelta)', value: stats.totalFreightCost, note: `${fmtN(stats.realShipped)} guías desp. × flete unit`, icon: Truck },
    { label: 'Fulfillment / Alistamiento', value: stats.totalFulfillment, note: 'Por cada guía despachada', icon: Boxes },
    { label: 'Comisiones Vendedoras', value: stats.totalCommissions, note: 'Solo sobre entregas exitosas', icon: DollarSign },
    { label: 'Costos Fijos Operativos', value: stats.totalFixedCosts, note: 'Prorrateo por entrega', icon: Activity },
    { label: 'Inversión en Publicidad', value: stats.totalAds, note: 'Meta Ads / pauta total', icon: Target },
  ];
 
  const totalCostos = costItems.reduce((s, i) => s + i.value, 0);
 
  // ── ANÁLISIS POR DÍA: mejor, peor, CPA promedio diario ────────────────────
  const dayAnalysis = useMemo(() => {
    // Agrupar registros por fecha
    const byDate = {};
    filteredRecords.forEach(r => {
      if (!byDate[r.date]) byDate[r.date] = [];
      byDate[r.date].push(r);
    });
 
    const days = Object.entries(byDate).map(([date, recs]) => {
      const s = calcularStats(recs, configs);
      return { date, ...s };
    }).sort((a, b) => a.date.localeCompare(b.date));
 
    if (days.length === 0) return { days: [], best: null, worst: null, avgCpaPerDay: 0 };
 
    const best  = days.reduce((a, b) => b.net > a.net ? b : a);
    const worst = days.reduce((a, b) => b.net < a.net ? b : a);
 
    // CPA promedio diario = suma de todos los ads diarios / suma de todas las entregas diarias
    // (equivalente al CPA global del período, pero lo mostramos como "por día")
    const totalAdsSum        = days.reduce((s, d) => s + d.totalAds, 0);
    const totalDelivSum      = days.reduce((s, d) => s + d.finalDeliveries, 0);
    const avgCpaPerDay       = totalDelivSum > 0 ? totalAdsSum / totalDelivSum : 0;
    // Promedio de CPA de cada día individualmente
    const daysWithAds        = days.filter(d => d.finalDeliveries > 0);
    const cpaDiarioPromedio  = daysWithAds.length > 0
      ? daysWithAds.reduce((s, d) => s + d.cpaReal, 0) / daysWithAds.length
      : 0;
 
    return { days, best, worst, avgCpaPerDay, cpaDiarioPromedio };
  }, [filteredRecords, configs]);
 
  const fmtDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
 

  return (
    <div className="space-y-8 anim-fade">
      <div>
        <h2 className="text-3xl font-black italic uppercase tracking-tighter">Dashboard General</h2>
        <p className="text-xs text-slate-400 font-black uppercase tracking-widest mt-1">Módulo 3 · Análisis de Rendimiento</p>
      </div>
 
      {/* Filtros */}
      <Card className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="space-y-1.5">
          <Label><Calendar size={11} className="inline mr-1" />Desde</Label>
          <input type="date" value={filter.startDate} onChange={e => setF('startDate', e.target.value)}
            className="w-full px-3 py-2.5 bg-slate-50 rounded-xl font-bold text-xs outline-none focus:ring-2 focus:ring-emerald-300" />
        </div>
        <div className="space-y-1.5">
          <Label><Calendar size={11} className="inline mr-1" />Hasta</Label>
          <input type="date" value={filter.endDate} onChange={e => setF('endDate', e.target.value)}
            className="w-full px-3 py-2.5 bg-slate-50 rounded-xl font-bold text-xs outline-none focus:ring-2 focus:ring-emerald-300" />
        </div>
        <div className="space-y-1.5">
          <Label>Vendedora</Label>
          <select value={filter.vendedora} onChange={e => setF('vendedora', e.target.value) || setF('producto', 'all')}
            className="w-full px-3 py-2.5 bg-slate-50 rounded-xl font-bold text-xs outline-none">
            <option value="all">TODAS</option>
            {Object.keys(grouped).map(v => <option key={v} value={v}>{v.toUpperCase()}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Producto</Label>
          <select value={filter.producto} onChange={e => setF('producto', e.target.value)}
            disabled={filter.vendedora === 'all'}
            className="w-full px-3 py-2.5 bg-slate-50 rounded-xl font-bold text-xs outline-none disabled:opacity-40">
            <option value="all">TODOS</option>
            {filter.vendedora !== 'all' && (grouped[filter.vendedora] || []).map(p =>
              <option key={p.id} value={p.id}>{p.productName}</option>
            )}
          </select>
        </div>
        <div className="col-span-2 md:col-span-4 flex items-center gap-2 bg-slate-50 px-4 py-2 rounded-xl">
          <Info size={12} className="text-slate-400" />
          <p className="text-[9px] font-black text-slate-400 uppercase">
            Analizando <span className="text-emerald-600">{dias} día{dias > 1 ? 's' : ''}</span> ·
            Proyección a 30 días = promedio diario × 30
          </p>
        </div>
      </Card>
 
      {filteredRecords.length === 0 ? (
        <Card className="text-center py-16 text-slate-300">
          <BarChart3 size={48} className="mx-auto mb-4 opacity-30" />
          <p className="font-black uppercase text-sm">Sin datos en este rango</p>
        </Card>
      ) : (
        <>
          {/* BLOQUE 1: EMBUDO OPERATIVO */}
          <section className="space-y-3">
            <h3 className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em] flex items-center gap-2 ml-1">
              <Activity size={14} /> Embudo Operativo Contraentrega
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="border-l-4 border-l-slate-300">
                <Label>Pedidos Registrados</Label>
                <p className="text-3xl font-black font-mono">{fmtN(stats.grossOrd)}</p>
                <p className="text-[9px] text-slate-400 mt-1 font-semibold">{fmtN(stats.grossUnits)} unidades totales</p>
              </Card>
              <Card className="border-l-4 border-l-blue-400">
                <Label>Guías Despachadas</Label>
                <p className="text-3xl font-black font-mono text-blue-600">{fmtN(stats.realShipped)}</p>
                <p className="text-[9px] text-slate-400 mt-1 font-semibold">
                  EFF aplicada · -{fmtN(stats.grossOrd - stats.realShipped)} por cancel/cobertura
                </p>
              </Card>
              <Card className="border-l-4 border-l-rose-400">
                <Label>Devoluciones Est.</Label>
                <p className="text-3xl font-black font-mono text-rose-500">{fmtN(stats.estimatedReturns)}</p>
                <p className="text-[9px] text-slate-400 mt-1 font-semibold">Flete de ida perdido en estas</p>
              </Card>
              <Card className="border-l-4 border-l-emerald-500">
                <Label>Entregas Finales</Label>
                <p className="text-3xl font-black font-mono text-emerald-600">{fmtN(stats.finalDeliveries)}</p>
                <p className="text-[9px] text-emerald-500 mt-1 font-semibold">
                  IER {fmtDec(stats.ierGlobal, 4)}% del total registrado
                </p>
              </Card>
            </div>
 
            {/* ── BLOQUE NUEVO: EMBUDO DE PRODUCTOS ──────────────────────────── */}
            <div className="mt-2">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.18em] flex items-center gap-1.5 ml-1 mb-3">
                <Layers size={11} /> Embudo de Productos (unidades físicas)
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
 
                {/* Col 1: Productos registrados */}
                <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm border-l-4 border-l-slate-200">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Productos Registrados</p>
                  <p className="text-2xl font-black font-mono text-slate-800">{fmtN(stats.unitsRegistradas)}</p>
                  <p className="text-[9px] text-slate-400 mt-1 font-semibold">
                    Prom. <span className="text-slate-600">{fmtDec(stats.avgUnitsPerOrder, 4)} unid/pedido</span>
                  </p>
                </div>
 
                {/* Col 2: Productos que salieron */}
                <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm border-l-4 border-l-blue-300">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Productos Enviados</p>
                  <p className="text-2xl font-black font-mono text-blue-600">{fmtN(stats.unitsShippedReal)}</p>
                  <p className="text-[9px] text-slate-400 mt-1 font-semibold">
                    -{fmtN(stats.unitsRegistradas - stats.unitsShippedReal)} por inefectividad
                  </p>
                </div>
 
                {/* Col 3: Productos devueltos a bodega */}
                <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4 border-l-4 border-l-rose-400">
                  <p className="text-[9px] font-black text-rose-400 uppercase tracking-widest mb-1">Devueltos a Bodega</p>
                  <p className="text-2xl font-black font-mono text-rose-500">{fmtN(stats.unitsReturnedReal)}</p>
                  <p className="text-[9px] text-rose-400 mt-1 font-semibold">
                    Regresan al stock · NO son pérdida
                  </p>
                </div>
 
                {/* Col 4: Productos realmente entregados y pagados — MÉTRICA ESTRELLA */}
                <div className="bg-emerald-500 rounded-2xl p-4 text-white relative overflow-hidden">
                  <CheckCircle2 className="absolute -bottom-3 -right-3 opacity-15" size={56} />
                  <p className="text-[9px] font-black text-emerald-100 uppercase tracking-widest mb-1">Productos Entregados</p>
                  <p className="text-2xl font-black font-mono text-white">{fmtN(stats.unitsDeliveredReal)}</p>
                  <p className="text-[9px] text-emerald-100 mt-1 font-semibold">
                    Prom. <span className="font-black">{fmtDec(stats.avgUnitsPerDelivery, 4)} unid/entrega</span>
                  </p>
                  <div className="mt-2 bg-emerald-600/50 rounded-xl px-2 py-1">
                    <p className="text-[9px] font-black text-emerald-100">
                      {fmtDec(stats.pctProductosEntregados, 4)}% de productos registrados llegaron
                    </p>
                  </div>
                </div>
              </div>
 
              {/* Barra visual del embudo de productos */}
              <div className="mt-3 bg-white border border-slate-100 rounded-2xl p-5 shadow-sm space-y-3">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Flujo de productos: de registrados a entregados</p>
 
                {/* Barra de registrados */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[8px] font-black text-slate-400 uppercase">
                    <span>Registrados</span><span>{fmtN(stats.unitsRegistradas)} unidades (100%)</span>
                  </div>
                  <div className="h-2.5 bg-slate-100 rounded-full"><div className="h-full bg-slate-300 rounded-full" style={{width:'100%'}} /></div>
                </div>
 
                {/* Barra de enviados */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[8px] font-black text-blue-400 uppercase">
                    <span>Enviados (× efectividad)</span>
                    <span>{fmtN(stats.unitsShippedReal)} unid. · {stats.unitsRegistradas > 0 ? fmtDec(stats.unitsShippedReal/stats.unitsRegistradas*100,4) : 0}%</span>
                  </div>
                  <div className="h-2.5 bg-blue-50 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-400 rounded-full transition-all duration-700"
                      style={{width: stats.unitsRegistradas > 0 ? `${Math.min(stats.unitsShippedReal/stats.unitsRegistradas*100,100)}%` : '0%'}} />
                  </div>
                </div>
 
                {/* Barra de entregados */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[8px] font-black text-emerald-600 uppercase">
                    <span>Entregados y Pagados (× IER)</span>
                    <span>{fmtN(stats.unitsDeliveredReal)} unid. · {fmtDec(stats.pctProductosEntregados,4)}%</span>
                  </div>
                  <div className="h-2.5 bg-emerald-50 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full transition-all duration-700"
                      style={{width: stats.unitsRegistradas > 0 ? `${Math.min(stats.pctProductosEntregados,100)}%` : '0%'}} />
                  </div>
                </div>
 
                {/* Barra de devueltos */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[8px] font-black text-rose-400 uppercase">
                    <span>Devueltos a Bodega</span>
                    <span>{fmtN(stats.unitsReturnedReal)} unid. · {stats.unitsRegistradas > 0 ? fmtDec(stats.unitsReturnedReal/stats.unitsRegistradas*100,4) : 0}%</span>
                  </div>
                  <div className="h-2.5 bg-rose-50 rounded-full overflow-hidden">
                    <div className="h-full bg-rose-400 rounded-full transition-all duration-700"
                      style={{width: stats.unitsRegistradas > 0 ? `${Math.min(stats.unitsReturnedReal/stats.unitsRegistradas*100,100)}%` : '0%'}} />
                  </div>
                </div>
 
                {/* Resumen numérico abajo */}
                <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-50">
                  <div className="text-center">
                    <p className="text-[8px] font-black text-slate-400 uppercase">Prom. Unid/Pedido</p>
                    <p className="text-sm font-black text-slate-700 font-mono">{fmtDec(stats.avgUnitsPerOrder, 4)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[8px] font-black text-slate-400 uppercase">Prom. Unid/Entrega Real</p>
                    <p className="text-sm font-black text-emerald-600 font-mono">{fmtDec(stats.avgUnitsPerDelivery, 4)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[8px] font-black text-slate-400 uppercase">Costo Merc/Entrega</p>
                    <p className="text-sm font-black text-slate-700 font-mono">{fmt(stats.costMercXEntrega)}</p>
                  </div>
                </div>
              </div>
            </div>
          </section>
 
          {/* BLOQUE 2: RADIOGRAFÍA DE COSTOS */}
          <section className="space-y-3">
            <h3 className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em] flex items-center gap-2 ml-1">
              <Calculator size={14} /> Radiografía de Costos Reales
            </h3>
            <Card className="space-y-0 p-0 overflow-hidden">
              {costItems.map((item, i) => (
                <div key={i} className="flex items-center gap-4 px-6 py-4 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
                  <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 shrink-0">
                    <item.icon size={14} />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-black text-slate-700">{item.label}</p>
                    <p className="text-[9px] text-slate-400 font-semibold">{item.note}</p>
                  </div>
                  <p className="font-black font-mono text-sm text-slate-900">{fmt(item.value)}</p>
                </div>
              ))}
              <div className="flex items-center gap-4 px-6 py-4 bg-slate-900 text-white">
                <div className="flex-1">
                  <p className="text-xs font-black uppercase tracking-widest">Total Costos</p>
                </div>
                <p className="font-black font-mono text-lg text-rose-400">{fmt(totalCostos)}</p>
              </div>
            </Card>
 
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="Flete Real x Entrega" value={fmt(stats.freteRealXEntrega)} sub={`Sobre ${fmtN(stats.finalDeliveries)} entregas`} />
              <Stat label="CPA Real x Entrega" value={fmt(stats.cpaReal)} sub="Costo adquisición real" />
              <Stat label="ROAS Real" value={`${fmtDec(stats.roas, 4)}x`} sub="Ingreso neto / ads" />
              <Stat label="Recaudo Neto Real" value={fmt(stats.realRev)} sub={`Bruto × IER ${fmtDec(stats.ierGlobal,4)}%`} accent />
            </div>
 
            {/* Métricas de costo de mercancía ajustadas por productos */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Stat
                label="Costo Mercancía Total"
                value={fmt(stats.productCostTotal)}
                sub={`Sobre ${fmtN(stats.unitsDeliveredReal)} unid. entregadas`}
                highlight
              />
              <Stat
                label="Costo Merc. x Unidad Entregada"
                value={fmt(stats.costMercXEntrega)}
                sub={`Prom. ${fmtDec(stats.avgUnitsPerDelivery,4)} unid/entrega × costo`}
                highlight
              />
              <Stat
                label="Unidades Devueltas (stock)"
                value={fmtN(stats.unitsReturnedReal)}
                sub="No generan costo de mercancía"
                dark={false}
              />
            </div>
          </section>
 
          {/* BLOQUE 4: CPA DIARIO + MEJOR Y PEOR DÍA */}
          <section className="space-y-3">
            <h3 className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em] flex items-center gap-2 ml-1">
              <TrendingUp size={14} /> Utilidad y Proyección
            </h3>
 
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card dark className="space-y-4">
                <Label className="text-zinc-500">Utilidad Neta Período</Label>
                <p className={`text-4xl font-black font-mono ${stats.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {fmt(stats.net)}
                </p>
                <div className="grid grid-cols-2 gap-3 pt-4 border-t border-zinc-800">
                  <div>
                    <p className="text-[9px] text-zinc-500 font-black uppercase">Ingresos Reales</p>
                    <p className="font-black text-white font-mono">{fmt(stats.realRev)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-zinc-500 font-black uppercase">Total Costos</p>
                    <p className="font-black text-rose-400 font-mono">{fmt(totalCostos)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-zinc-500 font-black uppercase">Margen Neto</p>
                    <p className="font-black text-emerald-400">
                      {stats.realRev > 0 ? fmtDec((stats.net / stats.realRev) * 100) : '0.00'}%
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] text-zinc-500 font-black uppercase">Profit / Día</p>
                    <p className="font-black text-white font-mono">{fmt(avgDiario)}</p>
                  </div>
                </div>
              </Card>
 
              <div className={`rounded-3xl p-6 text-white space-y-4 shadow-2xl relative overflow-hidden
                ${semaforo.color === 'bg-emerald-500' ? 'bg-emerald-600'
                  : semaforo.color === 'bg-blue-500' ? 'bg-blue-600'
                  : 'bg-rose-600'}`}>
                <TrendingUp className="absolute -bottom-4 -right-4 opacity-10" size={120} />
                <div>
                  <p className="text-[9px] font-black opacity-60 uppercase tracking-widest">Proyección 30 Días</p>
                  <p className="text-[9px] font-semibold opacity-50 mt-0.5">
                    ({fmt(avgDiario)}/día × 30)
                  </p>
                </div>
                <p className="text-4xl font-black font-mono tracking-tighter">{fmt(proyeccion30)}</p>
                <div className="bg-white/20 px-4 py-3 rounded-2xl">
                  <p className="text-lg font-black uppercase tracking-wider">{semaforo.emoji} {semaforo.texto}</p>
                  {targetProfit > 0 && (
                    <p className="text-[9px] font-semibold opacity-70 mt-0.5">
                      Meta: {fmt(targetProfit)} · 1M excelente
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 text-[9px] font-black uppercase opacity-60">
                  <div>Días analizados: <span className="text-white opacity-100">{dias}</span></div>
                  <div>IER: <span className="text-white opacity-100">{fmtDec(stats.ierGlobal,4)}%</span></div>
                </div>
              </div>
            </div>
 
            {targetProfit > 0 && (
              <Card className="space-y-3">
                <div className="flex justify-between items-center">
                  <Label>Avance vs Meta Mensual</Label>
                  <span className={`text-xs font-black ${semaforo.textColor}`}>
                    {fmtDec((proyeccion30 / targetProfit) * 100, 4)}% de la meta
                  </span>
                </div>
                <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700
                      ${semaforo.color === 'bg-emerald-500' ? 'bg-emerald-500'
                        : semaforo.color === 'bg-blue-500' ? 'bg-blue-500'
                        : 'bg-rose-500'}`}
                    style={{ width: `${Math.min((proyeccion30 / targetProfit) * 100, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[9px] font-black text-slate-400 uppercase">
                  <span>$0</span>
                  <span>Meta {fmt(targetProfit)}</span>
                  <span className="text-emerald-500">Excelente $1.000.000+</span>
                </div>
              </Card>
            )}
          </section>
        </>
      )}
    </div>
  );
}
 
// ─── APP PRINCIPAL ─────────────────────────────────────────────────────────────
export default function App() {
  const [configs, setConfigs]   = useState([]);
  const [months, setMonths]     = useState([]);
  const [activeTab, setTab]     = useState('dashboard');
 
  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'sales_configs'), snap =>
      setConfigs(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    const u2 = onSnapshot(collection(db, 'sales_months'), snap =>
      setMonths(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    return () => { u1(); u2(); };
  }, []);
 
  const tabs = [
    { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { id: 'records',   icon: ClipboardList,   label: 'Cierres'   },
    { id: 'config',    icon: Settings,         label: 'Estrategias' },
  ];
 
  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: "'DM Sans', sans-serif", color: '#0f172a', paddingBottom: '5rem' }}>
      <header style={{ background: '#09090b', position: 'sticky', top: 0, zIndex: 40, boxShadow: '0 4px 32px rgba(0,0,0,0.4)' }}>
        <div style={{ maxWidth: '72rem', margin: '0 auto', padding: '1rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: '1.1rem', color: '#10b981', textTransform: 'uppercase', letterSpacing: '-0.03em', lineHeight: 1 }}>
              Winner System 360
            </p>
            <p style={{ fontSize: '0.55rem', fontWeight: 700, color: '#3f3f46', textTransform: 'uppercase', letterSpacing: '0.2em', marginTop: '0.2rem' }}>
              Control Ventas · Contraentrega CO
            </p>
          </div>
          <nav style={{ display: 'flex', gap: '0.25rem', background: 'rgba(255,255,255,0.05)', padding: '0.25rem', borderRadius: '1rem', border: '1px solid rgba(255,255,255,0.08)' }}>
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                  padding: '0.5rem 1rem', borderRadius: '0.75rem', border: 'none',
                  background: activeTab === t.id ? '#10b981' : 'transparent',
                  color: activeTab === t.id ? '#09090b' : '#71717a',
                  fontFamily: "'DM Sans', sans-serif", fontWeight: 900, fontSize: '0.6rem',
                  textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                <t.icon size={14} />
                <span style={{ display: window.innerWidth < 640 ? 'none' : 'inline' }}>{t.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>
 
      <main style={{ maxWidth: '72rem', margin: '0 auto', padding: '2rem 1.5rem' }}>
        {activeTab === 'dashboard' && <VistaDashboard configs={configs} months={months} />}
        {activeTab === 'records'   && <VistaRegistro  configs={configs} months={months} />}
        {activeTab === 'config'    && <VistaConfig     configs={configs} />}
      </main>
    </div>
  );
}
