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
  DollarSign, Users, ShoppingBag, ArrowUpRight, ArrowDownRight, Info,
  Coffee, Moon, ShoppingCart
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

const fmtDec = (v, d = 2, max = null) => new Intl.NumberFormat('es-CO', {
  minimumFractionDigits: d,
  maximumFractionDigits: max !== null ? max : d
}).format(v || 0);

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

// ─── MOTOR DE CÁLCULO (incluye AOV) ───────────────────────────────────────────
function calcularStats(records, configs) {
  const activeRecords = records.filter(r => !r.restDay);
  let s = {
    grossOrd: 0, grossUnits: 0, grossRev: 0,
    realShipped: 0, estimatedReturns: 0, finalDeliveries: 0,
    unitsRegistradas: 0,
    unitsShippedReal: 0,
    unitsReturnedReal: 0,
    unitsDeliveredReal: 0,
    totalFreightCost: 0, totalFulfillment: 0,
    productCostTotal: 0, totalCommissions: 0, totalFixedCosts: 0, totalAds: 0,
    realRev: 0,
    net: 0,
    aov: 0
  };

  activeRecords.forEach(r => {
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

    const avgUnits     = orders > 0 ? units / orders : 1;
    const shipped      = orders * eff;
    const returns_     = shipped * ret;
    const deliveries   = shipped * (1 - ret);

    const unitsRegistradas   = units;
    const unitsShipped       = shipped * avgUnits;
    const unitsReturned      = returns_ * avgUnits;
    const unitsDelivered     = deliveries * avgUnits;

    const extraUnitCharge = parseFloat(c.extraUnitCharge) || 0;
    const extraUnits      = Math.max(avgUnits - 1, 0);
    const fleteBase       = parseFloat(c.freight) || 0;
    const fleteUnit       = fleteBase + extraUnits * extraUnitCharge;

    const freightTotal   = shipped * fleteUnit;
    const fulfillTotal   = shipped * (parseFloat(c.fulfillment) || 0);
    const mercanciaNeto  = (parseFloat(c.productCost) || 0) * unitsDelivered;
    const commissions    = deliveries * (parseFloat(c.commission) || 0);
    const fixedCosts     = deliveries * (parseFloat(c.fixedCosts) || 0);
    const realRevenue    = revenue * IER;

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
  s.freteRealXEntrega = s.finalDeliveries > 0 ? s.totalFreightCost / s.finalDeliveries : 0;
  s.cpaReal = s.finalDeliveries > 0 ? s.totalAds / s.finalDeliveries : 0;
  s.roas    = s.totalAds > 0 ? s.realRev / s.totalAds : 0;
  s.avgUnitsPerOrder       = s.grossOrd > 0 ? s.grossUnits / s.grossOrd : 0;
  s.avgUnitsPerDelivery    = s.finalDeliveries > 0 ? s.unitsDeliveredReal / s.finalDeliveries : 0;
  s.costMercXEntrega       = s.finalDeliveries > 0 ? s.productCostTotal / s.finalDeliveries : 0;
  s.pctProductosEntregados = s.unitsRegistradas > 0 ? (s.unitsDeliveredReal / s.unitsRegistradas) * 100 : 0;
  s.recaudoEficiencia      = s.grossRev > 0 ? (s.realRev / s.grossRev) * 100 : 0;
  s.aov                    = s.grossOrd > 0 ? s.grossRev / s.grossOrd : 0;

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

// ─── VISTA 1: CONFIGURACIÓN (igual) ───────────────────────────────────────────
const EMPTY_CONFIG = {
  vendedora: '', productName: '',
  targetProfit: '', productCost: '', freight: '', fulfillment: '',
  commission: '', returnRate: '20', effectiveness: '95',
  fixedCosts: '', priceSingle: '', dailyAdSpend: '', fixedAdSpend: true,
  extraUnitCharge: ''
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

  const isPrefilledVendor = showForm && !editId && form.vendedora && configs.some(c => c.vendedora === form.vendedora);

  return (
    <div className="space-y-8 anim-fade">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-black italic uppercase tracking-tighter text-zinc-900">Estrategias</h2>
          <p className="text-xs text-slate-400 font-semibold mt-1 uppercase tracking-widest">Módulo 1 · Vendedoras y Productos</p>
        </div>
        <button onClick={openNew} className="flex items-center gap-2 bg-zinc-950 text-white px-6 py-3.5 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-zinc-800 active:scale-95 transition-all shadow-lg"><Plus size={16} /> Nueva Vendedora + Producto</button>
      </div>
      {Object.keys(grouped).length === 0 ? (
        <Card className="text-center py-16 text-slate-300"><Users size={48} className="mx-auto mb-4 opacity-30" /><p className="font-black uppercase text-sm">Sin estrategias aún</p><p className="text-xs mt-1">Crea la primera estrategia para comenzar</p></Card>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([vendedora, productos]) => (
            <Card key={vendedora} className="overflow-hidden p-0">
              <div className="flex items-center justify-between gap-3 p-5 bg-white">
                <div onClick={() => toggleV(vendedora)} className="flex-1 flex items-center gap-3 cursor-pointer select-none">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-500 flex items-center justify-center text-white font-black text-sm shrink-0">{vendedora[0]?.toUpperCase()}</div>
                  <div><p className="font-black text-sm uppercase tracking-wide">{vendedora}</p><p className="text-[10px] text-slate-400 font-semibold">{productos.length} producto{productos.length > 1 ? 's' : ''} · click para {expandedV[vendedora] ? 'cerrar' : 'ver'}</p></div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button type="button" onClick={(e) => { e.stopPropagation(); openNewForVendor(vendedora); }} className="flex items-center gap-1.5 bg-emerald-500 text-zinc-950 px-4 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-400 active:scale-95 transition-all shadow-sm"><Plus size={14} /> + Producto</button>
                  <button type="button" onClick={() => toggleV(vendedora)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 transition-colors">{expandedV[vendedora] ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>
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
                          {p.extraUnitCharge && parseFloat(p.extraUnitCharge) > 0 && <span className="text-[9px] font-black bg-yellow-50 text-yellow-600 px-2 py-1 rounded-lg uppercase">Extra x2+ {fmt(p.extraUnitCharge)}</span>}
                          <span className="text-[9px] font-black bg-amber-50 text-amber-600 px-2 py-1 rounded-lg uppercase">Meta {fmt(p.targetProfit)}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 mt-2">
                          <div className="text-center bg-slate-50 p-2 rounded-xl"><p className="text-[8px] text-slate-400 uppercase font-black">Costo Unit</p><p className="font-black text-xs text-slate-700">{fmt(p.productCost)}</p></div>
                          <div className="text-center bg-slate-50 p-2 rounded-xl"><p className="text-[8px] text-slate-400 uppercase font-black">Comisión</p><p className="font-black text-xs text-slate-700">{fmt(p.commission)}</p></div>
                          <div className="text-center bg-slate-50 p-2 rounded-xl"><p className="text-[8px] text-slate-400 uppercase font-black">Fijos/Ent</p><p className="font-black text-xs text-slate-700">{fmt(p.fixedCosts)}</p></div>
                        </div>
                      </div>
                      <div className="flex gap-2 justify-end"><button onClick={() => openEdit(p)} className="p-2.5 rounded-xl hover:bg-emerald-50 hover:text-emerald-600 text-slate-400 transition-colors"><Pencil size={16} /></button><button onClick={() => remove(p.id)} className="p-2.5 rounded-xl hover:bg-rose-50 hover:text-rose-500 text-slate-400 transition-colors"><Trash2 size={16} /></button></div>
                    </div>
                  ))}
                  <div className="p-5 bg-slate-50/60"><button onClick={() => openNewForVendor(vendedora)} className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-emerald-200 text-emerald-600 bg-white px-5 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-emerald-50 hover:border-emerald-400 active:scale-95 transition-all"><Plus size={16} /> Agregar nuevo producto a {vendedora}</button></div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      {showForm && (
        <div className="fixed inset-0 bg-zinc-950/90 backdrop-blur-xl flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-3xl rounded-3xl p-8 max-h-[92vh] overflow-y-auto anim-zoom shadow-2xl">
            <div className="flex justify-between items-center mb-8 pb-6 border-b border-slate-100">
              <div><h3 className="text-2xl font-black italic uppercase">{editId ? 'Editar' : isPrefilledVendor ? `Nuevo Producto · ${form.vendedora}` : 'Nueva'} Estrategia</h3><p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mt-1">{isPrefilledVendor ? `Agregando producto a vendedora existente` : 'Define parámetros de costo por producto'}</p></div>
              <button onClick={() => setShowForm(false)} className="p-2 rounded-xl hover:bg-slate-100 transition-colors"><X size={20} /></button>
            </div>
            {isPrefilledVendor && (<div className="mb-6 flex items-center gap-3 bg-emerald-50 border border-emerald-200 px-5 py-4 rounded-2xl"><div className="w-8 h-8 rounded-xl bg-emerald-500 flex items-center justify-center text-white font-black text-sm shrink-0">{form.vendedora[0]?.toUpperCase()}</div><div><p className="text-xs font-black text-emerald-700 uppercase">{form.vendedora}</p><p className="text-[9px] text-emerald-500 font-semibold">Vendedora ya registrada · solo configura el nuevo producto</p></div></div>)}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {isPrefilledVendor ? (<div className="sm:col-span-2 bg-zinc-950 text-white px-5 py-4 rounded-2xl flex items-center gap-3"><Users size={16} className="text-emerald-400 shrink-0" /><div><p className="text-[9px] text-zinc-500 font-black uppercase tracking-widest">Vendedora</p><p className="font-black text-emerald-400 text-base uppercase">{form.vendedora}</p></div></div>) : (<InputField label="Nombre Vendedora" value={form.vendedora} onChange={e => set('vendedora', e.target.value)} placeholder="Ej: CAMILA PEREIRA" />)}
              <InputField label="Nombre Producto" value={form.productName} onChange={e => set('productName', e.target.value)} placeholder="Ej: CEPILLO PRO X2" className={isPrefilledVendor ? 'sm:col-span-1' : ''} />
              <div className="bg-emerald-50 border border-emerald-100 p-5 rounded-2xl space-y-2"><Label className="text-emerald-700">% Efectividad (pedidos que salen)</Label><input type="number" value={form.effectiveness} onChange={e => set('effectiveness', e.target.value)} className="w-full bg-transparent font-black text-4xl text-emerald-800 outline-none" /><p className="text-[9px] text-emerald-600 font-semibold">Pedidos cancelados o sin cobertura que NO salen</p></div>
              <div className="bg-rose-50 border border-rose-100 p-5 rounded-2xl space-y-2"><Label className="text-rose-600">% Devolución transportadora</Label><input type="number" value={form.returnRate} onChange={e => set('returnRate', e.target.value)} className="w-full bg-transparent font-black text-4xl text-rose-700 outline-none" /><p className="text-[9px] text-rose-500 font-semibold">Del total despachado, % que regresa sin pagar</p></div>
              <div className="sm:col-span-2 bg-zinc-950 text-white p-5 rounded-2xl flex items-center justify-between"><div><p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Índice de Efectividad Real (IER)</p><p className="text-xs text-zinc-400 mt-0.5">De cada 100 pedidos registrados, ¿cuántos se pagan?</p></div><div className="text-right"><p className="text-4xl font-black font-mono text-emerald-400">{((parseFloat(form.effectiveness)||95)/100 * (1-(parseFloat(form.returnRate)||20)/100) * 100).toFixed(1)}%</p></div></div>
              <InputField label="Precio de Venta (1 unidad)" type="number" value={form.priceSingle} onChange={e => set('priceSingle', e.target.value)} placeholder="Ej: 79000" />
              <InputField label="Costo Unitario de Producto" type="number" value={form.productCost} onChange={e => set('productCost', e.target.value)} placeholder="Ej: 18000" />
              <InputField label="Flete Base por Guía" type="number" value={form.freight} onChange={e => set('freight', e.target.value)} placeholder="Ej: 9500" />
              <InputField label="Cargo extra por unidad adicional (por pedido)" type="number" value={form.extraUnitCharge} onChange={e => set('extraUnitCharge', e.target.value)} placeholder="Ej: 5000 (0 si no aplica)" />
              <InputField label="Fulfillment / Alistamiento por guía" type="number" value={form.fulfillment} onChange={e => set('fulfillment', e.target.value)} placeholder="Ej: 1500" />
              <InputField label="Comisión por Entrega Exitosa" type="number" value={form.commission} onChange={e => set('commission', e.target.value)} placeholder="Ej: 3000" />
              <InputField label="Costos Fijos Operativos por Entrega" type="number" value={form.fixedCosts} onChange={e => set('fixedCosts', e.target.value)} placeholder="Ej: 2000" />
              <InputField label="Meta de Utilidad Mensual" type="number" value={form.targetProfit} onChange={e => set('targetProfit', e.target.value)} placeholder="Ej: 4000000" />
              <div className="bg-zinc-950 text-white p-5 rounded-2xl space-y-3"><div className="flex justify-between items-center"><Label className="text-zinc-500">Inversión Ads Diaria</Label><button onClick={() => set('fixedAdSpend', !form.fixedAdSpend)} className="flex items-center gap-1.5 text-[9px] font-black uppercase">{form.fixedAdSpend ? <><ToggleRight size={22} className="text-emerald-400" /> <span className="text-emerald-400">FIJA</span></> : <><ToggleLeft size={22} className="text-zinc-500" /> <span className="text-zinc-500">MANUAL</span></>}</button></div><input type="number" value={form.dailyAdSpend} onChange={e => set('dailyAdSpend', e.target.value)} placeholder="$ 0" className="w-full bg-transparent text-emerald-400 font-black text-3xl outline-none placeholder:text-zinc-700" /><p className="text-[9px] text-zinc-600 font-semibold">{form.fixedAdSpend ? '✓ FIJA: Se aplica automáticamente a cada registro diario' : '⚠ MANUAL: Debes ingresar el valor en cada cierre diario'}</p></div>
              {form.priceSingle && form.productCost && (<div className={`sm:col-span-2 p-5 rounded-2xl border-2 ${previewProfit >= 0 ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'}`}><p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Preview Utilidad Estimada por Pedido Registrado</p><p className={`text-3xl font-black font-mono ${previewProfit >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{fmt(previewProfit)}</p><p className="text-[9px] text-slate-400 mt-1">Aplicando IER, fletes y todos los costos configurados</p></div>)}
            </div>
            <button onClick={save} disabled={!form.vendedora.trim() || !form.productName.trim()} className="w-full mt-8 bg-emerald-500 text-zinc-950 py-5 rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-emerald-400 active:scale-95 transition-all disabled:opacity-30 flex items-center justify-center gap-2"><Save size={18} /> {editId ? 'Actualizar Estrategia' : isPrefilledVendor ? `Agregar Producto a ${form.vendedora}` : 'Guardar Estrategia'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── VISTA 2: REGISTRO DIARIO (con validación de duplicados) ──────────────────
function VistaRegistro({ configs, months }) {
  const [selectedDate, setSelectedDate] = useState(today());
  const [form, setForm] = useState({ configId: '', orders: '', units: '', revenue: '', adSpend: '', restDay: false });
  const [editingRec, setEditingRec] = useState(null);
  const [savedMsg, setSavedMsg] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const grouped = useMemo(() => configs.reduce((a, c) => {
    if (!a[c.vendedora]) a[c.vendedora] = [];
    a[c.vendedora].push(c);
    return a;
  }, {}), [configs]);

  const monthId = selectedDate.substring(0, 7);
  const monthDoc = months.find(m => m.id === monthId);
  const dayRecords = useMemo(() => (monthDoc?.records || []).filter(r => r.date === selectedDate), [monthDoc, selectedDate]);

  const selectedConfig = configs.find(c => c.id === form.configId);
  const extraUnitCharge = parseFloat(selectedConfig?.extraUnitCharge) || 0;

  const setFormField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleProductChange = (value) => {
    setFormField('configId', value);
    if (!editingRec) {
      setFormField('restDay', false);
    }
    setErrorMsg('');
  };

  const save = async () => {
    setErrorMsg('');
    if (!form.configId) {
      alert("Debes seleccionar una vendedora y producto.");
      return;
    }

    if (!editingRec) {
      const exists = dayRecords.some(r => r.configId === form.configId);
      if (exists) {
        const config = configs.find(c => c.id === form.configId);
        const vendorName = config?.vendedora || 'Desconocida';
        const productName = config?.productName || 'Desconocido';
        setErrorMsg(`❌ Ya existe un registro para ${vendorName} - ${productName} en esta fecha. Puedes editarlo o eliminarlo.`);
        return;
      }
    }

    let orders = form.orders;
    let units = form.units;
    let revenue = form.revenue;
    let adSpend = form.adSpend;

    if (form.restDay) {
      orders = '0';
      units = '0';
      revenue = '0';
      adSpend = '0';
      setFormField('orders', '0');
      setFormField('units', '0');
      setFormField('revenue', '0');
      if (!selectedConfig?.fixedAdSpend) setFormField('adSpend', '0');
    } else {
      if (!orders || !units || !revenue) {
        alert("Completa todos los campos obligatorios (guías, unidades y recaudo) o activa 'Día de descanso'.");
        return;
      }
    }

    const rec = {
      configId: form.configId,
      orders: orders,
      units: units,
      revenue: revenue,
      adSpend: adSpend,
      date: selectedDate,
      id: editingRec?.id || Date.now().toString(),
      savedAt: Date.now(),
      restDay: form.restDay
    };

    const ref = doc(db, 'sales_months', monthId);
    const existing = months.find(m => m.id === monthId);
    let records = existing?.records || [];

    if (editingRec) {
      records = records.map(r => r.id === editingRec.id ? rec : r);
      await setDoc(ref, { records });
      setEditingRec(null);
    } else {
      records = [...records, rec];
      if (existing) await updateDoc(ref, { records });
      else await setDoc(ref, { records });
    }

    setForm({ configId: '', orders: '', units: '', revenue: '', adSpend: '', restDay: false });
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 2500);
  };

  const startEdit = (r) => {
    setEditingRec(r);
    setForm({
      configId: r.configId,
      orders: r.orders,
      units: r.units,
      revenue: r.revenue,
      adSpend: r.adSpend || '',
      restDay: r.restDay || false
    });
    setErrorMsg('');
  };

  const deleteRec = async (id) => {
    if (!window.confirm('¿Eliminar este registro?')) return;
    const ref = doc(db, 'sales_months', monthId);
    const existing = months.find(m => m.id === monthId);
    const records = (existing?.records || []).filter(r => r.id !== id);
    await setDoc(ref, { records });
    if (editingRec?.id === id) cancelEdit();
  };

  const cancelEdit = () => {
    setEditingRec(null);
    setForm({ configId: '', orders: '', units: '', revenue: '', adSpend: '', restDay: false });
    setErrorMsg('');
  };

  const avgUnits = (!form.restDay && form.orders && form.units && parseFloat(form.orders) > 0)
    ? (parseFloat(form.units) / parseFloat(form.orders)).toFixed(2)
    : null;
  const extraPerGuide = avgUnits && parseFloat(avgUnits) > 1 && extraUnitCharge > 0
    ? (parseFloat(avgUnits) - 1) * extraUnitCharge
    : 0;

  const moveDate = (days) => {
    const date = new Date(selectedDate + 'T12:00:00');
    date.setDate(date.getDate() + days);
    setSelectedDate(date.toISOString().split('T')[0]);
    setEditingRec(null);
    setForm({ configId: '', orders: '', units: '', revenue: '', adSpend: '', restDay: false });
    setErrorMsg('');
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 anim-slide">
      <div><h2 className="text-3xl font-black italic uppercase tracking-tighter">Cierre Diario</h2><p className="text-xs text-slate-400 font-black uppercase tracking-widest mt-1">Módulo 2 · Registro de Operación</p></div>
      <Card className={`space-y-5 ${editingRec ? 'border-2 border-amber-400' : ''}`}>
        {editingRec && (<div className="flex items-center gap-2 text-amber-600 text-xs font-black uppercase bg-amber-50 px-4 py-2.5 rounded-xl"><Pencil size={14} /> Editando registro · <button onClick={cancelEdit} className="text-slate-500 underline ml-auto">Cancelar</button></div>)}
        
        {errorMsg && (
          <div className="flex items-center gap-2 text-rose-600 text-xs font-black uppercase bg-rose-50 px-4 py-2.5 rounded-xl border border-rose-200">
            <AlertTriangle size={14} /> {errorMsg}
          </div>
        )}

        <div className="bg-zinc-950 px-5 py-4 rounded-2xl text-white space-y-4">
          <div className="flex items-center gap-3"><Calendar size={18} className="text-emerald-400 shrink-0" /><div><p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Fecha del Registro · Selección libre</p><p className="text-[9px] text-zinc-600 font-semibold">Cualquier día pasado, presente o futuro</p></div></div>
          <div className="space-y-3"><input type="date" value={selectedDate} onChange={(e) => { if (e.target.value) { setSelectedDate(e.target.value); setEditingRec(null); setForm({ configId: '', orders: '', units: '', revenue: '', adSpend: '', restDay: false }); setErrorMsg(''); } }} className="w-full bg-white text-zinc-950 font-black text-base rounded-xl px-4 py-3 cursor-pointer border-2 border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-300" /><div className="grid grid-cols-3 gap-2"><button onClick={() => moveDate(-1)} className="bg-white/10 text-emerald-400 px-3 py-2 rounded-xl text-[10px] font-black uppercase hover:bg-white/20 transition">Día anterior</button><button onClick={() => { setSelectedDate(today()); setEditingRec(null); setForm({ configId: '', orders: '', units: '', revenue: '', adSpend: '', restDay: false }); setErrorMsg(''); }} className="bg-emerald-500 text-zinc-950 px-3 py-2 rounded-xl text-[10px] font-black uppercase hover:bg-emerald-400 transition">Hoy</button><button onClick={() => moveDate(1)} className="bg-white/10 text-emerald-400 px-3 py-2 rounded-xl text-[10px] font-black uppercase hover:bg-white/20 transition">Día siguiente</button></div></div>
          <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3"><p className="text-[10px] text-zinc-500 font-black uppercase">Registrando en: <span className="text-emerald-400">{new Date(selectedDate + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span></p></div>
        </div>

        <div className={`rounded-2xl p-4 flex items-center justify-between ${form.restDay ? 'bg-amber-100 border-2 border-amber-300' : 'bg-slate-100'}`}>
          <div className="flex items-center gap-3">
            <Coffee size={20} className="text-amber-600" />
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest">Día de descanso / Sin campaña</p>
              <p className="text-[9px] text-slate-500">Activa este interruptor si la vendedora no trabajó o no hubo campañas. Los campos de ventas se guardarán como 0.</p>
            </div>
          </div>
          <button onClick={() => setFormField('restDay', !form.restDay)} className="flex items-center gap-1.5 text-[9px] font-black uppercase">
            {form.restDay ? (<><ToggleRight size={28} className="text-amber-500" /><span className="text-amber-600">DESCANSO ACTIVADO</span></>) : (<><ToggleLeft size={28} className="text-slate-400" /><span className="text-slate-500">Activo</span></>)}
          </button>
        </div>

        <div className="space-y-1.5">
          <Label>Vendedora → Producto</Label>
          <select value={form.configId} onChange={e => handleProductChange(e.target.value)} disabled={!!editingRec} className={`w-full px-4 py-3.5 rounded-2xl font-semibold text-sm outline-none ${editingRec ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : 'bg-slate-50 border-2 border-transparent focus:border-emerald-400'}`}>
            <option value="">Seleccionar estrategia...</option>
            {Object.entries(grouped).map(([v, ps]) => (<optgroup key={v} label={`── ${v.toUpperCase()} ──`}>{ps.map(p => <option key={p.id} value={p.id}>{p.productName}</option>)}</optgroup>))}
          </select>
          {editingRec && <p className="text-[9px] text-amber-600 mt-1">⚠ No puedes cambiar el producto mientras editas un registro existente.</p>}
        </div>

        {selectedConfig && !selectedConfig.fixedAdSpend && (
          <div className="bg-zinc-950 text-white px-5 py-4 rounded-2xl space-y-1">
            <Label className="text-zinc-500">Inversión Ads de Hoy (MANUAL)</Label>
            <input type="number" value={form.adSpend} onChange={e => setFormField('adSpend', e.target.value)} placeholder="$ 0" disabled={form.restDay} className={`w-full bg-transparent font-black text-2xl outline-none placeholder:text-zinc-700 ${form.restDay ? 'text-zinc-500 line-through' : 'text-emerald-400'}`} />
            {form.restDay && <p className="text-[9px] text-amber-400">Se guardará como 0 por ser día de descanso.</p>}
          </div>
        )}
        {selectedConfig?.fixedAdSpend && (<div className="flex items-center gap-2 text-emerald-600 text-[9px] font-black bg-emerald-50 px-4 py-2.5 rounded-xl uppercase"><ToggleRight size={16} /> Ads fijo: {fmt(selectedConfig.dailyAdSpend)} · Se aplica automático</div>)}

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-slate-50 p-5 rounded-2xl space-y-1">
            <div className="flex items-center gap-2 text-slate-400"><Package size={14} /><Label>Total Guías</Label></div>
            <input type="number" value={form.orders} onChange={e => setFormField('orders', e.target.value)} placeholder="0" disabled={form.restDay} className={`w-full bg-transparent font-black text-4xl outline-none placeholder:text-slate-200 ${form.restDay ? 'text-slate-400 line-through' : 'text-slate-900'}`} />
            {form.restDay && <p className="text-[9px] text-amber-500">Se guardará como 0.</p>}
          </div>
          <div className="bg-slate-50 p-5 rounded-2xl space-y-1">
            <div className="flex items-center gap-2 text-slate-400"><Layers size={14} /><Label>Total Unidades</Label></div>
            <input type="number" value={form.units} onChange={e => setFormField('units', e.target.value)} placeholder="0" disabled={form.restDay} className={`w-full bg-transparent font-black text-4xl outline-none placeholder:text-slate-200 ${form.restDay ? 'text-slate-400 line-through' : 'text-slate-900'}`} />
            {form.restDay && <p className="text-[9px] text-amber-500">Se guardará como 0.</p>}
          </div>
        </div>

        {!form.restDay && avgUnits && (
          <div className="text-center space-y-1">
            <p className="text-[10px] text-slate-400 font-black uppercase">Promedio: <span className="text-emerald-600">{avgUnits} unidades/guía</span></p>
            {extraUnitCharge > 0 && parseFloat(avgUnits) > 1 && (<p className="text-[9px] font-bold text-yellow-600 bg-yellow-50 inline-block px-3 py-1 rounded-full">Extra por unidad adicional: {fmt(extraUnitCharge)} × {fmtN(parseFloat(avgUnits)-1)} = {fmt(extraPerGuide)} extra por guía</p>)}
            {extraUnitCharge === 0 && parseFloat(avgUnits) > 1 && (<p className="text-[9px] text-amber-500 font-semibold">⚠ Sin cargo extra por múltiples unidades (configurado en 0)</p>)}
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Recaudo Bruto Total del Día</Label>
          <input type="number" value={form.revenue} onChange={e => setFormField('revenue', e.target.value)} placeholder="$ 0" disabled={form.restDay} className={`w-full px-6 py-5 rounded-2xl bg-slate-50 border-2 border-emerald-100 focus:border-emerald-400 font-black text-3xl outline-none placeholder:text-slate-200 transition-all ${form.restDay ? 'text-slate-400 line-through' : 'text-emerald-700'}`} />
          {form.restDay && <p className="text-[9px] text-amber-500 text-center">Se guardará como $0.</p>}
        </div>

        <button onClick={save} disabled={!form.configId} className="w-full bg-emerald-500 text-zinc-950 py-5 rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-emerald-400 active:scale-95 transition-all disabled:opacity-30 flex items-center justify-center gap-2"><Save size={18} /> {editingRec ? 'Actualizar Registro' : 'Guardar Cierre Diario'}</button>
        {savedMsg && <div className="flex items-center justify-center gap-2 text-emerald-600 text-xs font-black uppercase animate-pulse"><CheckCircle2 size={16} /> ¡Guardado exitosamente!</div>}
      </Card>

      {dayRecords.length > 0 && (
        <div className="space-y-3">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Registros de {new Date(selectedDate + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          {dayRecords.map(r => {
            const c = configs.find(x => x.id === r.configId);
            const eff = parseFloat(c?.effectiveness||95)/100;
            const ret = parseFloat(c?.returnRate||20)/100;
            const IER = eff*(1-ret);
            const orders = parseFloat(r.orders)||0;
            const units = parseFloat(r.units)||0;
            const avgU = orders > 0 ? units / orders : 1;
            const deliveries = orders * IER;
            const unitsDelivered = deliveries * avgU;
            return (
              <Card key={r.id} className={`flex flex-col sm:flex-row sm:items-center gap-4 ${r.restDay ? 'bg-slate-100 border-slate-200' : ''}`}>
                <div className="flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-black text-sm text-emerald-600 uppercase">{c?.vendedora}</span>
                    <span className="text-slate-300">·</span>
                    <span className="font-semibold text-sm text-slate-600">{c?.productName}</span>
                    {r.restDay && (<span className="flex items-center gap-1 text-[9px] font-black bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full"><Moon size={10} /> DESCANSO</span>)}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="text-[9px] font-black bg-slate-100 text-slate-500 px-2 py-1 rounded-lg">{r.orders} guías</span>
                    <span className="text-[9px] font-black bg-slate-100 text-slate-500 px-2 py-1 rounded-lg">{r.units} unid. registradas</span>
                    <span className="text-[9px] font-black bg-emerald-50 text-emerald-600 px-2 py-1 rounded-lg">{fmtN(deliveries)} entregas est.</span>
                    <span className="text-[9px] font-black bg-blue-50 text-blue-600 px-2 py-1 rounded-lg">{fmtN(unitsDelivered)} prod. entregados</span>
                    <span className="text-[9px] font-black bg-zinc-100 text-zinc-600 px-2 py-1 rounded-lg">{fmt(r.revenue)}</span>
                  </div>
                </div>
                <div className="flex gap-2 justify-end"><button onClick={() => startEdit(r)} className="p-2 rounded-xl hover:bg-amber-50 hover:text-amber-600 text-slate-300 transition-colors"><Pencil size={16} /></button><button onClick={() => deleteRec(r.id)} className="p-2 rounded-xl hover:bg-rose-50 hover:text-rose-500 text-slate-300 transition-colors"><Trash2 size={16} /></button></div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── VISTA 3: DASHBOARD (CON AOV) ─────────────────────────────────────────────
function VistaDashboard({ configs, months }) {
  const [filter, setFilter] = useState({ startDate: today(), endDate: today(), vendedora: 'all', producto: 'all' });
  const grouped = useMemo(() => configs.reduce((a, c) => { if (!a[c.vendedora]) a[c.vendedora] = []; a[c.vendedora].push(c); return a; }, {}), [configs]);
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

  const activeDays = useMemo(() => {
    const activeRecords = filteredRecords.filter(r => !r.restDay);
    const uniqueDates = new Set(activeRecords.map(r => r.date));
    return uniqueDates.size;
  }, [filteredRecords]);

  const avgDiario = activeDays > 0 ? stats.net / activeDays : 0;
  const proyeccion30 = avgDiario * 30;

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

  let semaforo = { color: 'bg-rose-500', texto: 'REVISIÓN', emoji: '🔴', textColor: 'text-rose-500' };
  if (proyeccion30 >= 1_000_000) semaforo = { color: 'bg-emerald-500', texto: 'EXCELENTE', emoji: '🟢', textColor: 'text-emerald-500' };
  else if (proyeccion30 >= targetProfit && targetProfit > 0) semaforo = { color: 'bg-blue-500', texto: 'BIEN', emoji: '🔵', textColor: 'text-blue-500' };

  const costItems = [
    { label: 'Costo de Mercancía', value: stats.productCostTotal, note: `${fmtN(stats.unitsDeliveredReal)} unid. entregadas × costo unit. · devueltas no cuentan`, icon: Package },
    { label: 'Fletes Totales (ida+vuelta)', value: stats.totalFreightCost, note: `Incluye cargos extra configurados`, icon: Truck },
    { label: 'Fulfillment / Alistamiento', value: stats.totalFulfillment, note: 'Por cada guía despachada', icon: Boxes },
    { label: 'Comisiones Vendedoras', value: stats.totalCommissions, note: 'Solo sobre entregas exitosas', icon: DollarSign },
    { label: 'Costos Fijos Operativos', value: stats.totalFixedCosts, note: 'Prorrateo por entrega', icon: Activity },
    { label: 'Inversión en Publicidad', value: stats.totalAds, note: 'Meta Ads / pauta total', icon: Target },
  ];
  const totalCostos = costItems.reduce((s, i) => s + i.value, 0);
  const ajustePorIER = stats.grossRev - stats.realRev;
  const eficienciaRecaudo = stats.recaudoEficiencia;

  return (
    <div className="space-y-8 anim-fade">
      <div><h2 className="text-3xl font-black italic uppercase tracking-tighter">Dashboard General</h2><p className="text-xs text-slate-400 font-black uppercase tracking-widest mt-1">Módulo 3 · Análisis de Rendimiento</p></div>
      <Card className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="space-y-1.5"><Label><Calendar size={11} className="inline mr-1" />Desde</Label><input type="date" value={filter.startDate} onChange={e => setF('startDate', e.target.value)} className="w-full px-3 py-2.5 bg-slate-50 rounded-xl font-bold text-xs outline-none focus:ring-2 focus:ring-emerald-300" /></div>
        <div className="space-y-1.5"><Label><Calendar size={11} className="inline mr-1" />Hasta</Label><input type="date" value={filter.endDate} onChange={e => setF('endDate', e.target.value)} className="w-full px-3 py-2.5 bg-slate-50 rounded-xl font-bold text-xs outline-none focus:ring-2 focus:ring-emerald-300" /></div>
        <div className="space-y-1.5"><Label>Vendedora</Label><select value={filter.vendedora} onChange={e => setF('vendedora', e.target.value) || setF('producto', 'all')} className="w-full px-3 py-2.5 bg-slate-50 rounded-xl font-bold text-xs outline-none"><option value="all">TODAS</option>{Object.keys(grouped).map(v => <option key={v} value={v}>{v.toUpperCase()}</option>)}</select></div>
        <div className="space-y-1.5"><Label>Producto</Label><select value={filter.producto} onChange={e => setF('producto', e.target.value)} disabled={filter.vendedora === 'all'} className="w-full px-3 py-2.5 bg-slate-50 rounded-xl font-bold text-xs outline-none disabled:opacity-40"><option value="all">TODOS</option>{filter.vendedora !== 'all' && (grouped[filter.vendedora] || []).map(p => <option key={p.id} value={p.id}>{p.productName}</option>)}</select></div>
        <div className="col-span-2 md:col-span-4 flex items-center gap-2 bg-slate-50 px-4 py-2 rounded-xl"><Info size={12} className="text-slate-400" /><p className="text-[9px] font-black text-slate-400 uppercase">Analizando <span className="text-emerald-600">{activeDays} día{activeDays !== 1 ? 's' : ''} activo{activeDays !== 1 ? 's' : ''}</span> (excluye días de descanso) · Proyección a 30 días = promedio diario × 30</p></div>
      </Card>
      {filteredRecords.length === 0 || activeDays === 0 ? (
        <Card className="text-center py-16 text-slate-300"><BarChart3 size={48} className="mx-auto mb-4 opacity-30" /><p className="font-black uppercase text-sm">Sin datos activos en este rango</p><p className="text-[9px] mt-1">Los días de descanso no generan métricas.</p></Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="bg-white border-l-4 border-l-slate-400"><Label>💰 Recaudo Bruto Total</Label><p className="text-3xl font-black font-mono text-slate-800">{fmt(stats.grossRev)}</p><p className="text-[9px] text-slate-400 mt-1">Suma de todos los cierres diarios (sin ajustes)</p></Card>
            <Card className="bg-amber-50 border-l-4 border-l-amber-400"><Label>⚠ Ajuste por Inefectividad + Devoluciones</Label><p className="text-3xl font-black font-mono text-amber-600">- {fmt(ajustePorIER)}</p><p className="text-[9px] text-amber-500 mt-1">{fmtDec(eficienciaRecaudo,1)}% del bruto se pierde por IER</p></Card>
            <Card className="bg-emerald-50 border-l-4 border-l-emerald-500"><Label>✅ Recaudo Neto Real (después de IER)</Label><p className="text-3xl font-black font-mono text-emerald-700">{fmt(stats.realRev)}</p><p className="text-[9px] text-emerald-500 mt-1">Lo que realmente ingresa después de cancelaciones y devoluciones</p></Card>
          </div>

          {/* Nueva fila de métricas clave incluido AOV */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Stat label="AOV (Valor Promedio Venta)" value={fmt(stats.aov)} sub={`Sobre ${fmtN(stats.grossOrd)} pedidos brutos`} highlight />
            <Stat label="Flete Real x Entrega" value={fmt(stats.freteRealXEntrega)} sub={`Sobre ${fmtN(stats.finalDeliveries)} entregas`} />
            <Stat label="CPA Real x Entrega" value={fmt(stats.cpaReal)} sub="Costo adquisición real" />
            <Stat label="ROAS Real" value={`${fmtDec(stats.roas, 4)}x`} sub="Ingreso neto / ads" />
            <Stat label="Recaudo Neto Real" value={fmt(stats.realRev)} sub={`Bruto × IER ${fmtDec(stats.ierGlobal,4)}%`} accent />
          </div>

          <section className="space-y-3">
            <h3 className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em] flex items-center gap-2 ml-1"><Activity size={14} /> Embudo Operativo Contraentrega</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="border-l-4 border-l-slate-300"><Label>Pedidos Registrados</Label><p className="text-3xl font-black font-mono">{fmtN(stats.grossOrd)}</p><p className="text-[9px] text-slate-400 mt-1 font-semibold">{fmtN(stats.grossUnits)} unidades totales</p></Card>
              <Card className="border-l-4 border-l-blue-400"><Label>Guías Despachadas</Label><p className="text-3xl font-black font-mono text-blue-600">{fmtN(stats.realShipped)}</p><p className="text-[9px] text-slate-400 mt-1 font-semibold">EFF aplicada · -{fmtN(stats.grossOrd - stats.realShipped)} por cancel/cobertura</p></Card>
              <Card className="border-l-4 border-l-rose-400"><Label>Devoluciones Est.</Label><p className="text-3xl font-black font-mono text-rose-500">{fmtN(stats.estimatedReturns)}</p><p className="text-[9px] text-slate-400 mt-1 font-semibold">Flete de ida perdido en estas</p></Card>
              <Card className="border-l-4 border-l-emerald-500"><Label>Entregas Finales</Label><p className="text-3xl font-black font-mono text-emerald-600">{fmtN(stats.finalDeliveries)}</p><p className="text-[9px] text-emerald-500 mt-1 font-semibold">IER {fmtDec(stats.ierGlobal, 4)}% del total registrado</p></Card>
            </div>
            <div className="mt-2"><p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.18em] flex items-center gap-1.5 ml-1 mb-3"><Layers size={11} /> Embudo de Productos (unidades físicas)</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm border-l-4 border-l-slate-200"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Productos Registrados</p><p className="text-2xl font-black font-mono text-slate-800">{fmtN(stats.unitsRegistradas)}</p><p className="text-[9px] text-slate-400 mt-1 font-semibold">Prom. <span className="text-slate-600">{fmtDec(stats.avgUnitsPerOrder, 4)} unid/pedido</span></p></div>
              <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm border-l-4 border-l-blue-300"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Productos Enviados</p><p className="text-2xl font-black font-mono text-blue-600">{fmtN(stats.unitsShippedReal)}</p><p className="text-[9px] text-slate-400 mt-1 font-semibold">-{fmtN(stats.unitsRegistradas - stats.unitsShippedReal)} por inefectividad</p></div>
              <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4 border-l-4 border-l-rose-400"><p className="text-[9px] font-black text-rose-400 uppercase tracking-widest mb-1">Devueltos a Bodega</p><p className="text-2xl font-black font-mono text-rose-500">{fmtN(stats.unitsReturnedReal)}</p><p className="text-[9px] text-rose-400 mt-1 font-semibold">Regresan al stock · NO son pérdida</p></div>
              <div className="bg-emerald-500 rounded-2xl p-4 text-white relative overflow-hidden"><CheckCircle2 className="absolute -bottom-3 -right-3 opacity-15" size={56} /><p className="text-[9px] font-black text-emerald-100 uppercase tracking-widest mb-1">Productos Entregados</p><p className="text-2xl font-black font-mono text-white">{fmtN(stats.unitsDeliveredReal)}</p><p className="text-[9px] text-emerald-100 mt-1 font-semibold">Prom. <span className="font-black">{fmtDec(stats.avgUnitsPerDelivery, 4)} unid/entrega</span></p><div className="mt-2 bg-emerald-600/50 rounded-xl px-2 py-1"><p className="text-[9px] font-black text-emerald-100">{fmtDec(stats.pctProductosEntregados, 4)}% de productos registrados llegaron</p></div></div>
            </div>
            <div className="mt-3 bg-white border border-slate-100 rounded-2xl p-5 shadow-sm space-y-3"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Flujo de productos: de registrados a entregados</p>
              <div className="space-y-1"><div className="flex justify-between text-[8px] font-black text-slate-400 uppercase"><span>Registrados</span><span>{fmtN(stats.unitsRegistradas)} unidades (100%)</span></div><div className="h-2.5 bg-slate-100 rounded-full"><div className="h-full bg-slate-300 rounded-full" style={{width:'100%'}} /></div></div>
              <div className="space-y-1"><div className="flex justify-between text-[8px] font-black text-blue-400 uppercase"><span>Enviados (× efectividad)</span><span>{fmtN(stats.unitsShippedReal)} unid. · {stats.unitsRegistradas > 0 ? fmtDec(stats.unitsShippedReal/stats.unitsRegistradas*100,4) : 0}%</span></div><div className="h-2.5 bg-blue-50 rounded-full overflow-hidden"><div className="h-full bg-blue-400 rounded-full transition-all duration-700" style={{width: stats.unitsRegistradas > 0 ? `${Math.min(stats.unitsShippedReal/stats.unitsRegistradas*100,100)}%` : '0%'}} /></div></div>
              <div className="space-y-1"><div className="flex justify-between text-[8px] font-black text-emerald-600 uppercase"><span>Entregados y Pagados (× IER)</span><span>{fmtN(stats.unitsDeliveredReal)} unid. · {fmtDec(stats.pctProductosEntregados,4)}%</span></div><div className="h-2.5 bg-emerald-50 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full transition-all duration-700" style={{width: stats.unitsRegistradas > 0 ? `${Math.min(stats.pctProductosEntregados,100)}%` : '0%'}} /></div></div>
              <div className="space-y-1"><div className="flex justify-between text-[8px] font-black text-rose-400 uppercase"><span>Devueltos a Bodega</span><span>{fmtN(stats.unitsReturnedReal)} unid. · {stats.unitsRegistradas > 0 ? fmtDec(stats.unitsReturnedReal/stats.unitsRegistradas*100,4) : 0}%</span></div><div className="h-2.5 bg-rose-50 rounded-full overflow-hidden"><div className="h-full bg-rose-400 rounded-full transition-all duration-700" style={{width: stats.unitsRegistradas > 0 ? `${Math.min(stats.unitsReturnedReal/stats.unitsRegistradas*100,100)}%` : '0%'}} /></div></div>
              <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-50"><div className="text-center"><p className="text-[8px] font-black text-slate-400 uppercase">Prom. Unid/Pedido</p><p className="text-sm font-black text-slate-700 font-mono">{fmtDec(stats.avgUnitsPerOrder, 4)}</p></div><div className="text-center"><p className="text-[8px] font-black text-slate-400 uppercase">Prom. Unid/Entrega Real</p><p className="text-sm font-black text-emerald-600 font-mono">{fmtDec(stats.avgUnitsPerDelivery, 4)}</p></div><div className="text-center"><p className="text-[8px] font-black text-slate-400 uppercase">Costo Merc/Entrega</p><p className="text-sm font-black text-slate-700 font-mono">{fmt(stats.costMercXEntrega)}</p></div></div>
            </div></div>
          </section>
          <section className="space-y-3"><h3 className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em] flex items-center gap-2 ml-1"><Calculator size={14} /> Radiografía de Costos Reales</h3>
            <Card className="space-y-0 p-0 overflow-hidden">{costItems.map((item,i) => (<div key={i} className="flex items-center gap-4 px-6 py-4 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors"><div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 shrink-0"><item.icon size={14} /></div><div className="flex-1"><p className="text-xs font-black text-slate-700">{item.label}</p><p className="text-[9px] text-slate-400 font-semibold">{item.note}</p></div><p className="font-black font-mono text-sm text-slate-900">{fmt(item.value)}</p></div>))}<div className="flex items-center gap-4 px-6 py-4 bg-slate-900 text-white"><div className="flex-1"><p className="text-xs font-black uppercase tracking-widest">Total Costos</p></div><p className="font-black font-mono text-lg text-rose-400">{fmt(totalCostos)}</p></div></Card>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4"><Stat label="Costo Mercancía Total" value={fmt(stats.productCostTotal)} sub={`Sobre ${fmtN(stats.unitsDeliveredReal)} unid. entregadas`} highlight /><Stat label="Costo Merc. x Unidad Entregada" value={fmt(stats.costMercXEntrega)} sub={`Prom. ${fmtDec(stats.avgUnitsPerDelivery,4)} unid/entrega × costo`} highlight /><Stat label="Unidades Devueltas (stock)" value={fmtN(stats.unitsReturnedReal)} sub="No generan costo de mercancía" dark={false} /></div>
          </section>
          <section className="space-y-3"><h3 className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em] flex items-center gap-2 ml-1"><TrendingUp size={14} /> Utilidad y Proyección</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6"><Card dark className="space-y-4"><Label className="text-zinc-500">Utilidad Neta Período</Label><p className={`text-4xl font-black font-mono ${stats.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{fmt(stats.net)}</p><div className="grid grid-cols-2 gap-3 pt-4 border-t border-zinc-800"><div><p className="text-[9px] text-zinc-500 font-black uppercase">Ingresos Reales</p><p className="font-black text-white font-mono">{fmt(stats.realRev)}</p></div><div><p className="text-[9px] text-zinc-500 font-black uppercase">Total Costos</p><p className="font-black text-rose-400 font-mono">{fmt(totalCostos)}</p></div><div><p className="text-[9px] text-zinc-500 font-black uppercase">Margen Neto</p><p className="font-black text-emerald-400">{stats.realRev > 0 ? fmtDec((stats.net / stats.realRev) * 100) : '0.00'}%</p></div><div><p className="text-[9px] text-zinc-500 font-black uppercase">Profit / Día</p><p className="font-black text-white font-mono">{fmt(avgDiario)}</p></div></div></Card>
            <div className={`rounded-3xl p-6 text-white space-y-4 shadow-2xl relative overflow-hidden ${semaforo.color === 'bg-emerald-500' ? 'bg-emerald-600' : semaforo.color === 'bg-blue-500' ? 'bg-blue-600' : 'bg-rose-600'}`}><TrendingUp className="absolute -bottom-4 -right-4 opacity-10" size={120} /><div><p className="text-[9px] font-black opacity-60 uppercase tracking-widest">Proyección 30 Días</p><p className="text-[9px] font-semibold opacity-50 mt-0.5">({fmt(avgDiario)}/día × 30)</p></div><p className="text-4xl font-black font-mono tracking-tighter">{fmt(proyeccion30)}</p><div className="bg-white/20 px-4 py-3 rounded-2xl"><p className="text-lg font-black uppercase tracking-wider">{semaforo.emoji} {semaforo.texto}</p>{targetProfit > 0 && (<p className="text-[9px] font-semibold opacity-70 mt-0.5">Meta: {fmt(targetProfit)} · 1M excelente</p>)}</div><div className="grid grid-cols-2 gap-3 text-[9px] font-black uppercase opacity-60"><div>Días activos: <span className="text-white opacity-100">{activeDays}</span></div><div>IER: <span className="text-white opacity-100">{fmtDec(stats.ierGlobal,4)}%</span></div></div></div></div>
            {targetProfit > 0 && (<Card className="space-y-3"><div className="flex justify-between items-center"><Label>Avance vs Meta Mensual</Label><span className={`text-xs font-black ${semaforo.textColor}`}>{fmtDec((proyeccion30 / targetProfit) * 100, 4)}% de la meta</span></div><div className="h-3 bg-slate-100 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all duration-700 ${semaforo.color === 'bg-emerald-500' ? 'bg-emerald-500' : semaforo.color === 'bg-blue-500' ? 'bg-blue-500' : 'bg-rose-500'}`} style={{ width: `${Math.min((proyeccion30 / targetProfit) * 100, 100)}%` }} /></div><div className="flex justify-between text-[9px] font-black text-slate-400 uppercase"><span>$0</span><span>Meta {fmt(targetProfit)}</span><span className="text-emerald-500">Excelente $1.000.000+</span></div></Card>)}
          </section>
        </>
      )}
    </div>
  );
}

// ─── APP PRINCIPAL ─────────────────────────────────────────────────────────────
export default function App() {
  const [configs, setConfigs] = useState([]);
  const [months, setMonths] = useState([]);
  const [activeTab, setTab] = useState('dashboard');

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'sales_configs'), snap => setConfigs(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u2 = onSnapshot(collection(db, 'sales_months'), snap => setMonths(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
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
          <div><p style={{ fontFamily: "'DM Sans', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: '1.1rem', color: '#10b981', textTransform: 'uppercase', letterSpacing: '-0.03em', lineHeight: 1 }}>Winner System 360</p><p style={{ fontSize: '0.55rem', fontWeight: 700, color: '#3f3f46', textTransform: 'uppercase', letterSpacing: '0.2em', marginTop: '0.2rem' }}>Control Ventas · Contraentrega CO</p></div>
          <nav style={{ display: 'flex', gap: '0.25rem', background: 'rgba(255,255,255,0.05)', padding: '0.25rem', borderRadius: '1rem', border: '1px solid rgba(255,255,255,0.08)' }}>
            {tabs.map(t => (<button key={t.id} onClick={() => setTab(t.id)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', borderRadius: '0.75rem', border: 'none', background: activeTab === t.id ? '#10b981' : 'transparent', color: activeTab === t.id ? '#09090b' : '#71717a', fontFamily: "'DM Sans', sans-serif", fontWeight: 900, fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', transition: 'all 0.2s' }}><t.icon size={14} /><span style={{ display: window.innerWidth < 640 ? 'none' : 'inline' }}>{t.label}</span></button>))}
          </nav>
        </div>
      </header>
      <main style={{ maxWidth: '72rem', margin: '0 auto', padding: '2rem 1.5rem' }}>
        {activeTab === 'dashboard' && <VistaDashboard configs={configs} months={months} />}
        {activeTab === 'records'   && <VistaRegistro  configs={configs} months={months} />}
        {activeTab === 'config'    && <VistaConfig    configs={configs} />}
      </main>
    </div>
  );
}