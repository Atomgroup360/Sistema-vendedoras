import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, addDoc, setDoc, updateDoc, deleteDoc, doc, onSnapshot,
  Timestamp, serverTimestamp   // ← Agregado para la Agenda
} from 'firebase/firestore';
import {
  LayoutDashboard, ClipboardList, Settings, Plus, Trash2, Calendar,
  TrendingUp, Package, Layers, Truck, Target, Wallet, CheckCircle2,
  Calculator, Eye, Activity, Pencil, Boxes, ToggleLeft, ToggleRight,
  ChevronDown, ChevronUp, X, AlertTriangle, Save, BarChart3, Percent,
  DollarSign, Users, ShoppingBag, ArrowUpRight, ArrowDownRight, Info,
  Coffee, Moon, Award, ListChecks, CalendarDays, Power, PowerOff
} from 'lucide-react';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import Login from './src/components/Login';
import { db } from './src/firebase';

// ─── HELPERS CON ZONA HORARIA COLOMBIA (UTC-5) ───────────────────────────────
const todayColombia = () => {
  const now = new Date();
  const colombiaDate = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  return colombiaDate.toISOString().split('T')[0];
};

const parseColombiaDate = (dateStr) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
};

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

// ─── MOTOR DE CÁLCULO (global, ranking y detalle temporal) ───────────────────
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
    aov: 0,
    cpaEquilibrioPonderado: 0,
    rankingVendedoras: [],
    detalleProductos: []
  };

  let totalCpaEquilibrioPonderado = 0;
  let totalOrdenesParaCpaEq = 0;
  const vendedorasStats = {};
  const productosFechas = {};

  activeRecords.forEach(r => {
    const c = configs.find(x => x.id === r.configId);
    if (!c) return;

    const eff = Math.min(Math.max(parseFloat(c.effectiveness) || 95, 0), 100) / 100;
    const ret = Math.min(Math.max(parseFloat(c.returnRate) || 20, 0), 100) / 100;
    const IER = eff * (1 - ret);

    const orders = parseFloat(r.orders) || 0;
    const units = parseFloat(r.units) || 0;
    const revenue = parseFloat(r.revenue) || 0;
    const ads = parseFloat(r.adSpend) > 0
      ? parseFloat(r.adSpend)
      : (c.fixedAdSpend ? parseFloat(c.dailyAdSpend) || 0 : 0);

    const avgUnits = orders > 0 ? units / orders : 1;
    const shipped = orders * eff;
    const returns_ = shipped * ret;
    const deliveries = shipped * (1 - ret);
    const unitsRegistradas = units;
    const unitsShipped = shipped * avgUnits;
    const unitsReturned = returns_ * avgUnits;
    const unitsDelivered = deliveries * avgUnits;

    const extraUnitCharge = parseFloat(c.extraUnitCharge) || 0;
    const extraUnits = Math.max(avgUnits - 1, 0);
    const fleteBase = parseFloat(c.freight) || 0;
    const fleteUnit = fleteBase + extraUnits * extraUnitCharge;
    const freightTotal = shipped * fleteUnit;
    const fulfillTotal = shipped * (parseFloat(c.fulfillment) || 0);
    const mercanciaNeto = (parseFloat(c.productCost) || 0) * unitsDelivered;
    const commissions = deliveries * (parseFloat(c.commission) || 0);
    const fixedCosts = deliveries * (parseFloat(c.fixedCosts) || 0);
    const realRevenue = revenue * IER;

    s.grossOrd += orders;
    s.grossUnits += units;
    s.grossRev += revenue;
    s.realShipped += shipped;
    s.estimatedReturns += returns_;
    s.finalDeliveries += deliveries;
    s.unitsRegistradas += unitsRegistradas;
    s.unitsShippedReal += unitsShipped;
    s.unitsReturnedReal += unitsReturned;
    s.unitsDeliveredReal += unitsDelivered;
    s.totalFreightCost += freightTotal;
    s.totalFulfillment += fulfillTotal;
    s.productCostTotal += mercanciaNeto;
    s.totalCommissions += commissions;
    s.totalFixedCosts += fixedCosts;
    s.totalAds += ads;
    s.realRev += realRevenue;

    const cpaEq = parseFloat(c.cpaEquilibrio) || 0;
    totalCpaEquilibrioPonderado += cpaEq * orders;
    totalOrdenesParaCpaEq += orders;

    const vendor = c.vendedora;
    if (!vendedorasStats[vendor]) {
      vendedorasStats[vendor] = {
        vendedora: vendor,
        pedidos: 0,
        recaudoNeto: 0,
        utilidad: 0,
        totalGrossOrd: 0,
        totalIER: 0
      };
    }
    vendedorasStats[vendor].pedidos += orders;
    vendedorasStats[vendor].recaudoNeto += realRevenue;
    vendedorasStats[vendor].utilidad += (realRevenue - mercanciaNeto - freightTotal - fulfillTotal - commissions - fixedCosts - ads);
    vendedorasStats[vendor].totalGrossOrd += orders;
    vendedorasStats[vendor].totalIER += IER * orders;

    if (!productosFechas[r.configId]) {
      productosFechas[r.configId] = {
        configId: r.configId,
        vendedora: c.vendedora,
        productName: c.productName,
        primerRegistro: r.date,
        ultimoRegistro: r.date,
        activo: c.activo !== false,
        fechaCreacion: c.fechaCreacion,
        fechaDesactivacion: c.fechaDesactivacion
      };
    } else {
      const p = productosFechas[r.configId];
      if (r.date < p.primerRegistro) p.primerRegistro = r.date;
      if (r.date > p.ultimoRegistro) p.ultimoRegistro = r.date;
    }
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
  s.roas = s.totalAds > 0 ? s.realRev / s.totalAds : 0;
  s.avgUnitsPerOrder = s.grossOrd > 0 ? s.grossUnits / s.grossOrd : 0;
  s.avgUnitsPerDelivery = s.finalDeliveries > 0 ? s.unitsDeliveredReal / s.finalDeliveries : 0;
  s.costMercXEntrega = s.finalDeliveries > 0 ? s.productCostTotal / s.finalDeliveries : 0;
  s.pctProductosEntregados = s.unitsRegistradas > 0 ? (s.unitsDeliveredReal / s.unitsRegistradas) * 100 : 0;
  s.recaudoEficiencia = s.grossRev > 0 ? (s.realRev / s.grossRev) * 100 : 0;
  s.aov = s.grossOrd > 0 ? s.grossRev / s.grossOrd : 0;
  s.cpaEquilibrioPonderado = totalOrdenesParaCpaEq > 0 ? totalCpaEquilibrioPonderado / totalOrdenesParaCpaEq : 0;

  const rankingData = Object.values(vendedorasStats).map(v => ({
    ...v,
    ierPromedio: v.totalGrossOrd > 0 ? (v.totalIER / v.totalGrossOrd) * 100 : 0
  }));
  rankingData.sort((a, b) => b.utilidad - a.utilidad);
  s.rankingVendedoras = rankingData;

  s.detalleProductos = Object.values(productosFechas).sort((a, b) => a.vendedora.localeCompare(b.vendedora) || a.productName.localeCompare(b.productName));

  return s;
}

// ─── COMPONENTES UI ──────────────────────────────────────────────────────────
const Card = ({ children, className = '', dark = false }) => (
  <div className={`rounded-3xl border p-4 md:p-6 ${dark ? 'bg-zinc-950 border-zinc-800 text-white' : 'bg-white border-slate-100 shadow-sm'} ${className}`}>
    {children}
  </div>
);

const Label = ({ children, className = '' }) => (
  <p className={`text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1.5 ${className}`}>{children}</p>
);

const InputField = ({ label, type = 'text', value, onChange, placeholder, className = '', dark = false, disabled = false }) => (
  <div className="space-y-1">
    {label && <Label className={dark ? 'text-zinc-500' : ''}>{label}</Label>}
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      className={`w-full px-4 py-3 rounded-2xl font-semibold text-sm outline-none transition-all
        ${dark
          ? 'bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-600 focus:border-emerald-500 disabled:opacity-50'
          : 'bg-slate-50 border-2 border-transparent focus:border-emerald-400 text-slate-900 disabled:bg-slate-100 disabled:opacity-70'
        } ${className}`}
    />
  </div>
);

const Stat = ({ label, value, sub, accent = false, big = false, dark = false, highlight = false }) => (
  <div className={`p-3 md:p-4 rounded-2xl ${accent ? 'bg-emerald-500 text-white' : highlight ? 'bg-blue-50 border border-blue-100' : dark ? 'bg-zinc-800' : 'bg-slate-50'}`}>
    <p className={`text-[9px] font-black uppercase tracking-widest mb-1 ${accent ? 'text-emerald-100' : highlight ? 'text-blue-500' : dark ? 'text-zinc-500' : 'text-slate-400'}`}>{label}</p>
    <p className={`font-black font-mono leading-none ${big ? 'text-xl md:text-2xl' : 'text-base md:text-lg'} ${accent ? 'text-white' : highlight ? 'text-blue-700' : dark ? 'text-white' : 'text-slate-900'}`}>{value}</p>
    {sub && <p className={`text-[9px] mt-1 font-semibold ${accent ? 'text-emerald-100' : highlight ? 'text-blue-400' : dark ? 'text-zinc-500' : 'text-slate-400'}`}>{sub}</p>}
  </div>
);

// ─── VISTA 1: CONFIGURACIÓN (responsive móvil) ──────────────────────────────
const EMPTY_CONFIG = {
  vendedora: '', productName: '',
  targetProfit: '', productCost: '', freight: '', fulfillment: '',
  commission: '', returnRate: '20', effectiveness: '95',
  fixedCosts: '', priceSingle: '', dailyAdSpend: '', fixedAdSpend: true,
  extraUnitCharge: '',
  cpaEquilibrio: '',
  activo: true,
  fechaCreacion: todayColombia(),
  fechaDesactivacion: ''
};

function VistaConfig({ configs, onSaved }) {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(EMPTY_CONFIG);
  const [expandedV, setExpandedV] = useState({});

  const grouped = useMemo(() => configs.reduce((a, c) => {
    if (!a[c.vendedora]) a[c.vendedora] = [];
    a[c.vendedora].push(c);
    return a;
  }, {}), [configs]);

  const openNew = () => { setEditId(null); setForm({ ...EMPTY_CONFIG, fechaCreacion: todayColombia() }); setShowForm(true); };
  const openNewForVendor = (vendedora) => {
    setEditId(null);
    setForm({ ...EMPTY_CONFIG, vendedora, fechaCreacion: todayColombia() });
    setExpandedV(x => ({ ...x, [vendedora]: true }));
    setShowForm(true);
  };
  const openEdit = (p) => { setEditId(p.id); setForm({ ...p }); setShowForm(true); };
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.vendedora.trim() || !form.productName.trim()) return;
    const data = { ...form };
    
    if (!data.fechaCreacion) data.fechaCreacion = todayColombia();
    if (data.activo === false && !data.fechaDesactivacion) {
      data.fechaDesactivacion = todayColombia();
    }
    if (data.activo === true) {
      data.fechaDesactivacion = '';
    }
    
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
    const costo = parseFloat(form.productCost) || 0;
    const flete = parseFloat(form.freight) || 0;
    const full = parseFloat(form.fulfillment) || 0;
    const com = parseFloat(form.commission) || 0;
    const fijos = parseFloat(form.fixedCosts) || 0;
    const ads = parseFloat(form.dailyAdSpend) || 0;
    const ingreso = precio * IER;
    const costos = costo + (flete / (IER || 1)) + full + com + fijos + ads;
    return ingreso - costos;
  }, [form]);

  const isPrefilledVendor = showForm && !editId && form.vendedora && configs.some(c => c.vendedora === form.vendedora);

  return (
    <div className="space-y-6 md:space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-black italic uppercase tracking-tighter text-zinc-900">Estrategias</h2>
          <p className="text-[10px] text-slate-400 font-semibold mt-1 uppercase tracking-widest">Módulo 1 · Vendedoras y Productos</p>
        </div>
        <button onClick={openNew} className="flex items-center gap-2 bg-zinc-950 text-white px-4 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-zinc-800 active:scale-95 transition-all shadow-md"><Plus size={14} /> Nueva Vendedora + Producto</button>
      </div>

      {Object.keys(grouped).length === 0 ? (
        <Card className="text-center py-16 text-slate-300"><Users size={40} className="mx-auto mb-4 opacity-30" /><p className="font-black uppercase text-sm">Sin estrategias aún</p><p className="text-xs mt-1">Crea la primera estrategia para comenzar</p></Card>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([vendedora, productos]) => (
            <Card key={vendedora} className="overflow-hidden p-0">
              <div className="flex items-center justify-between gap-3 p-4 bg-white">
                <div onClick={() => toggleV(vendedora)} className="flex-1 flex items-center gap-3 cursor-pointer select-none">
                  <div className="w-8 h-8 rounded-xl bg-emerald-500 flex items-center justify-center text-white font-black text-sm shrink-0">{vendedora[0]?.toUpperCase()}</div>
                  <div><p className="font-black text-xs uppercase tracking-wide">{vendedora}</p><p className="text-[9px] text-slate-400 font-semibold">{productos.length} producto{productos.length > 1 ? 's' : ''}</p></div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button type="button" onClick={(e) => { e.stopPropagation(); openNewForVendor(vendedora); }} className="flex items-center gap-1 bg-emerald-500 text-zinc-950 px-3 py-1.5 rounded-lg font-black text-[9px] uppercase tracking-widest hover:bg-emerald-400"><Plus size={10} /> Producto</button>
                  <button type="button" onClick={() => toggleV(vendedora)} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors">{expandedV[vendedora] ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
                </div>
              </div>
              {expandedV[vendedora] && (
                <div className="border-t border-slate-100 divide-y divide-slate-100">
                  {productos.map(p => {
                    const isActive = p.activo !== false;
                    return (
                      <div key={p.id} className={`p-4 flex flex-col gap-3 transition-all ${!isActive ? 'bg-slate-50 opacity-70' : ''}`}>
                        <div className="flex justify-between items-start gap-2">
                          <div>
                            <p className={`font-black uppercase text-sm ${!isActive ? 'text-slate-500 line-through' : 'text-emerald-600'}`}>{p.productName}</p>
                            {!isActive && <span className="inline-flex items-center gap-1 text-[8px] font-black bg-red-100 text-red-600 px-2 py-0.5 rounded-full mt-1"><PowerOff size={8} /> INACTIVO</span>}
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <button onClick={() => openEdit(p)} className="p-1.5 rounded-lg hover:bg-emerald-50 hover:text-emerald-600 text-slate-400 transition-colors"><Pencil size={12} /></button>
                            <button onClick={() => remove(p.id)} className="p-1.5 rounded-lg hover:bg-rose-50 hover:text-rose-500 text-slate-400 transition-colors"><Trash2 size={12} /></button>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <span className="text-[8px] font-black bg-slate-100 text-slate-500 px-2 py-1 rounded-lg uppercase">EFF {p.effectiveness}%</span>
                          <span className="text-[8px] font-black bg-rose-50 text-rose-500 px-2 py-1 rounded-lg uppercase">DEV {p.returnRate}%</span>
                          <span className="text-[8px] font-black bg-emerald-50 text-emerald-600 px-2 py-1 rounded-lg uppercase">IER {(parseFloat(p.effectiveness) / 100 * (1 - parseFloat(p.returnRate) / 100) * 100).toFixed(1)}%</span>
                          <span className="text-[8px] font-black bg-blue-50 text-blue-500 px-2 py-1 rounded-lg uppercase">Flete {fmt(p.freight)}</span>
                          {p.extraUnitCharge && parseFloat(p.extraUnitCharge) > 0 && <span className="text-[8px] font-black bg-yellow-50 text-yellow-600 px-2 py-1 rounded-lg uppercase">Extra {fmt(p.extraUnitCharge)}</span>}
                          <span className="text-[8px] font-black bg-amber-50 text-amber-600 px-2 py-1 rounded-lg uppercase">Meta {fmt(p.targetProfit)}</span>
                          {p.cpaEquilibrio && parseFloat(p.cpaEquilibrio) > 0 && <span className="text-[8px] font-black bg-purple-50 text-purple-600 px-2 py-1 rounded-lg uppercase">CPA Eq {fmt(p.cpaEquilibrio)}</span>}
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div className="bg-slate-50 p-2 rounded-xl text-center"><p className="text-[7px] text-slate-400 uppercase font-black">Costo Unit</p><p className="font-black text-[10px] text-slate-700">{fmt(p.productCost)}</p></div>
                          <div className="bg-slate-50 p-2 rounded-xl text-center"><p className="text-[7px] text-slate-400 uppercase font-black">Comisión</p><p className="font-black text-[10px] text-slate-700">{fmt(p.commission)}</p></div>
                          <div className="bg-slate-50 p-2 rounded-xl text-center"><p className="text-[7px] text-slate-400 uppercase font-black">Fijos/Ent</p><p className="font-black text-[10px] text-slate-700">{fmt(p.fixedCosts)}</p></div>
                        </div>
                        <div className="text-[8px] text-slate-400 font-mono flex gap-2 flex-wrap">
                          {p.fechaCreacion && <span>📅 Creación: {parseColombiaDate(p.fechaCreacion).toLocaleDateString('es-CO')}</span>}
                          {p.fechaDesactivacion && <span className="text-red-400">🔴 Desactivado: {parseColombiaDate(p.fechaDesactivacion).toLocaleDateString('es-CO')}</span>}
                        </div>
                      </div>
                    );
                  })}
                  <div className="p-4 bg-slate-50/60">
                    <button onClick={() => openNewForVendor(vendedora)} className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-emerald-200 text-emerald-600 bg-white px-4 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-50"><Plus size={12} /> Agregar producto a {vendedora}</button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* MODAL RESPONSIVE PARA MÓVIL */}
      {showForm && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-50 p-2 sm:p-4" style={{ overscrollBehavior: 'contain' }}>
          <div className="bg-white w-full max-w-md sm:max-w-2xl rounded-2xl max-h-[95vh] overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-white z-10 px-4 pt-4 pb-2 border-b border-slate-100 flex justify-between items-center">
              <div>
                <h3 className="text-lg sm:text-xl font-black italic uppercase tracking-tighter">{editId ? 'Editar' : isPrefilledVendor ? `Nuevo Producto · ${form.vendedora}` : 'Nueva'} Estrategia</h3>
                <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest">{isPrefilledVendor ? `Agregando producto a vendedora existente` : 'Define parámetros de costo por producto'}</p>
              </div>
              <button onClick={() => setShowForm(false)} className="p-2 -mr-2 rounded-full hover:bg-slate-100"><X size={20} /></button>
            </div>

            <div className="p-4 space-y-4">
              {isPrefilledVendor && (
                <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-xl">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center text-white font-black text-sm shrink-0">{form.vendedora[0]?.toUpperCase()}</div>
                  <div>
                    <p className="text-xs font-black text-emerald-700 uppercase">{form.vendedora}</p>
                    <p className="text-[8px] text-emerald-500 font-semibold">Vendedora ya registrada · solo configura el nuevo producto</p>
                  </div>
                </div>
              )}

              {/* Grid para móvil: 1 columna, en desktop 2 */}
              <div className="grid grid-cols-1 gap-4">
                {!isPrefilledVendor && (
                  <InputField label="Nombre Vendedora" value={form.vendedora} onChange={e => setField('vendedora', e.target.value)} placeholder="Ej: CAMILA PEREIRA" />
                )}
                <InputField label="Nombre Producto" value={form.productName} onChange={e => setField('productName', e.target.value)} placeholder="Ej: CEPILLO PRO X2" />
                
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="Fecha Creación" type="date" value={form.fechaCreacion} onChange={e => setField('fechaCreacion', e.target.value)} />
                  <div className="bg-zinc-100 p-2 rounded-xl">
                    <Label className="text-zinc-500">Estado</Label>
                    <button onClick={() => setField('activo', !form.activo)} className="flex items-center justify-between w-full mt-1">
                      <span className="text-xs font-black">{form.activo ? 'ACTIVO' : 'INACTIVO'}</span>
                      {form.activo ? <ToggleRight size={28} className="text-emerald-500" /> : <ToggleLeft size={28} className="text-red-400" />}
                    </button>
                    {!form.activo && (
                      <input type="date" value={form.fechaDesactivacion} onChange={e => setField('fechaDesactivacion', e.target.value)} className="w-full mt-2 text-xs p-1 border rounded" />
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-emerald-50 p-3 rounded-xl">
                    <Label className="text-emerald-700">% Efectividad</Label>
                    <input type="number" value={form.effectiveness} onChange={e => setField('effectiveness', e.target.value)} className="w-full bg-transparent font-black text-2xl text-emerald-800 outline-none" />
                    <p className="text-[7px] text-emerald-600">Pedidos que salen</p>
                  </div>
                  <div className="bg-rose-50 p-3 rounded-xl">
                    <Label className="text-rose-600">% Devolución</Label>
                    <input type="number" value={form.returnRate} onChange={e => setField('returnRate', e.target.value)} className="w-full bg-transparent font-black text-2xl text-rose-700 outline-none" />
                    <p className="text-[7px] text-rose-500">Del despachado</p>
                  </div>
                </div>

                <div className="bg-zinc-950 text-white p-3 rounded-xl flex justify-between items-center">
                  <div><Label className="text-zinc-500">Índice IER</Label><p className="text-2xl font-black font-mono text-emerald-400">{((parseFloat(form.effectiveness) || 95) / 100 * (1 - (parseFloat(form.returnRate) || 20) / 100) * 100).toFixed(1)}%</p></div>
                  <Info size={24} className="text-zinc-600" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <InputField label="Precio Venta" type="number" value={form.priceSingle} onChange={e => setField('priceSingle', e.target.value)} placeholder="79000" />
                  <InputField label="Costo Unitario" type="number" value={form.productCost} onChange={e => setField('productCost', e.target.value)} placeholder="18000" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <InputField label="Flete Base" type="number" value={form.freight} onChange={e => setField('freight', e.target.value)} placeholder="9500" />
                  <InputField label="Extra por unidad+" type="number" value={form.extraUnitCharge} onChange={e => setField('extraUnitCharge', e.target.value)} placeholder="5000" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <InputField label="Fulfillment" type="number" value={form.fulfillment} onChange={e => setField('fulfillment', e.target.value)} placeholder="1500" />
                  <InputField label="Comisión" type="number" value={form.commission} onChange={e => setField('commission', e.target.value)} placeholder="3000" />
                </div>

                <InputField label="Costos Fijos por Entrega" type="number" value={form.fixedCosts} onChange={e => setField('fixedCosts', e.target.value)} placeholder="2000" />
                <InputField label="Meta Utilidad Mensual" type="number" value={form.targetProfit} onChange={e => setField('targetProfit', e.target.value)} placeholder="4000000" />
                <InputField label="CPA Equilibrio" type="number" value={form.cpaEquilibrio} onChange={e => setField('cpaEquilibrio', e.target.value)} placeholder="15000" />

                <div className="bg-zinc-950 text-white p-3 rounded-xl">
                  <div className="flex justify-between items-center">
                    <Label className="text-zinc-500">Inversión Ads Diaria</Label>
                    <button onClick={() => setField('fixedAdSpend', !form.fixedAdSpend)} className="flex items-center gap-1 text-[9px] font-black">
                      {form.fixedAdSpend ? <><ToggleRight size={20} className="text-emerald-400" /> FIJA</> : <><ToggleLeft size={20} /> MANUAL</>}
                    </button>
                  </div>
                  <input type="number" value={form.dailyAdSpend} onChange={e => setField('dailyAdSpend', e.target.value)} placeholder="$ 0" className="w-full bg-transparent text-emerald-400 font-black text-xl outline-none placeholder:text-zinc-700 mt-1" />
                </div>

                {form.priceSingle && form.productCost && (
                  <div className={`p-3 rounded-xl border-2 ${previewProfit >= 0 ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'}`}>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Utilidad Estimada x Pedido</p>
                    <p className={`text-xl font-black font-mono ${previewProfit >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{fmt(previewProfit)}</p>
                  </div>
                )}
              </div>

              <button onClick={save} disabled={!form.vendedora.trim() || !form.productName.trim()} className="w-full bg-emerald-500 text-zinc-950 py-3 rounded-xl font-black uppercase tracking-widest text-sm hover:bg-emerald-400 active:scale-95 disabled:opacity-30 flex items-center justify-center gap-2 sticky bottom-2">
                <Save size={16} /> {editId ? 'Actualizar' : isPrefilledVendor ? `Agregar Producto` : 'Guardar Estrategia'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── VISTA 2: REGISTRO DIARIO (con filtro de productos activos en la fecha, y resumen de faltantes solo para productos que ya existían) ─────────
function VistaRegistro({ configs, months }) {
  const [selectedDate, setSelectedDate] = useState(todayColombia());
  const [selectedVendor, setSelectedVendor] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [form, setForm] = useState({ orders: '', units: '', revenue: '', adSpend: '', restDay: false });
  const [editingRec, setEditingRec] = useState(null);
  const [savedMsg, setSavedMsg] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [filterVendor, setFilterVendor] = useState('all');

  const grouped = useMemo(() => configs.reduce((a, c) => {
    if (!a[c.vendedora]) a[c.vendedora] = [];
    a[c.vendedora].push(c);
    return a;
  }, {}), [configs]);
  const vendors = useMemo(() => Object.keys(grouped).sort(), [grouped]);

  // PRODUCTOS DISPONIBLES para la vendedora seleccionada, considerando fecha de creación y desactivación
  const productsOfVendor = useMemo(() => {
    if (!selectedVendor) return [];
    const productos = grouped[selectedVendor] || [];
    const selectedDateObj = parseColombiaDate(selectedDate);
    return productos.filter(p => {
      // Fecha de creación: el producto debe haber sido creado en o antes de la fecha seleccionada
      if (p.fechaCreacion && parseColombiaDate(p.fechaCreacion) > selectedDateObj) return false;
      // Fecha de desactivación: si está desactivado y la fecha de desactivación es anterior o igual a la fecha seleccionada, no debe aparecer
      if (p.activo === false) {
        if (p.fechaDesactivacion && parseColombiaDate(p.fechaDesactivacion) <= selectedDateObj) return false;
      }
      return true;
    });
  }, [selectedVendor, grouped, selectedDate]);

  const selectedConfig = useMemo(() => selectedProductId ? configs.find(c => c.id === selectedProductId) : null, [selectedProductId, configs]);
  const extraUnitCharge = parseFloat(selectedConfig?.extraUnitCharge) || 0;

  const monthId = selectedDate.substring(0, 7);
  const monthDoc = months.find(m => m.id === monthId);
  const dayRecords = useMemo(() => (monthDoc?.records || []).filter(r => r.date === selectedDate), [monthDoc, selectedDate]);

  // Resumen de productos registrados vs activos (solo aquellos que deberían estar activos en la fecha)
  const summary = useMemo(() => {
    // Productos que deberían estar activos según fecha de creación y desactivación
    let activeProducts = [];
    if (filterVendor === 'all') {
      activeProducts = configs.filter(c => {
        const fechaCreacion = c.fechaCreacion ? parseColombiaDate(c.fechaCreacion) : null;
        const fechaDesactivacion = c.fechaDesactivacion ? parseColombiaDate(c.fechaDesactivacion) : null;
        const fechaCierre = parseColombiaDate(selectedDate);
        if (fechaCreacion && fechaCreacion > fechaCierre) return false;
        if (c.activo === false && fechaDesactivacion && fechaDesactivacion <= fechaCierre) return false;
        return true;
      });
    } else {
      activeProducts = configs.filter(c => {
        if (c.vendedora !== filterVendor) return false;
        const fechaCreacion = c.fechaCreacion ? parseColombiaDate(c.fechaCreacion) : null;
        const fechaDesactivacion = c.fechaDesactivacion ? parseColombiaDate(c.fechaDesactivacion) : null;
        const fechaCierre = parseColombiaDate(selectedDate);
        if (fechaCreacion && fechaCreacion > fechaCierre) return false;
        if (c.activo === false && fechaDesactivacion && fechaDesactivacion <= fechaCierre) return false;
        return true;
      });
    }
    const registeredProductIds = new Set(dayRecords.map(r => r.configId));
    const registeredActive = activeProducts.filter(p => registeredProductIds.has(p.id)).length;
    const totalActive = activeProducts.length;
    return { totalActive, registeredActive, missing: totalActive - registeredActive };
  }, [dayRecords, configs, filterVendor, selectedDate]);

  const recordsByVendor = useMemo(() => {
    const map = new Map();
    dayRecords.forEach(rec => {
      const config = configs.find(c => c.id === rec.configId);
      if (!config) return;
      const vendor = config.vendedora;
      if (!map.has(vendor)) map.set(vendor, []);
      map.get(vendor).push({ ...rec, config });
    });
    return map;
  }, [dayRecords, configs]);

  const filteredDayRecords = useMemo(() => {
    if (filterVendor === 'all') return dayRecords;
    return recordsByVendor.get(filterVendor) || [];
  }, [dayRecords, recordsByVendor, filterVendor]);

  const { ultimoDia, diasFaltantes } = useMemo(() => {
    let maxDate = null;
    const fechasConRegistros = new Set();
    months.forEach(month => {
      month.records?.forEach(record => {
        if (!record.restDay) {
          fechasConRegistros.add(record.date);
          if (record.date > (maxDate || '')) maxDate = record.date;
        }
      });
    });
    if (!maxDate) return { ultimoDia: null, diasFaltantes: [] };
    const fechaUltimo = maxDate;
    const hoy = todayColombia();
    const allDates = [];
    let current = parseColombiaDate(fechaUltimo);
    const end = parseColombiaDate(hoy);
    while (current <= end) {
      const year = current.getFullYear();
      const month = String(current.getMonth() + 1).padStart(2, '0');
      const day = String(current.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      if (!fechasConRegistros.has(dateStr) && dateStr !== fechaUltimo) {
        allDates.push(dateStr);
      }
      current.setDate(current.getDate() + 1);
    }
    const diasFaltantesFormateados = allDates.map(d => ({
      fecha: d,
      nombre: parseColombiaDate(d).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' })
    }));
    return { ultimoDia: fechaUltimo, diasFaltantes: diasFaltantesFormateados };
  }, [months]);

  const diferenciaDias = ultimoDia ? Math.floor((parseColombiaDate(todayColombia()) - parseColombiaDate(ultimoDia)) / (1000 * 60 * 60 * 24)) : null;

  const setFormField = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const handleVendorChange = (vendor) => {
    setSelectedVendor(vendor);
    setSelectedProductId('');
    setForm({ orders: '', units: '', revenue: '', adSpend: '', restDay: false });
    setErrorMsg('');
  };
  const handleProductChange = (productId) => {
    setSelectedProductId(productId);
    setForm({ orders: '', units: '', revenue: '', adSpend: '', restDay: false });
    setErrorMsg('');
  };

  const save = async () => {
    setErrorMsg('');
    if (!selectedVendor || !selectedProductId) {
      alert("Debes seleccionar una vendedora y un producto.");
      return;
    }
    if (!editingRec) {
      const exists = dayRecords.some(r => r.configId === selectedProductId);
      if (exists) {
        const config = configs.find(c => c.id === selectedProductId);
        const vendorName = config?.vendedora || selectedVendor;
        const productName = config?.productName || 'Desconocido';
        setErrorMsg(`❌ Ya existe un registro para ${vendorName} - ${productName} en esta fecha. Puedes editarlo o eliminarlo.`);
        return;
      }
    }
    let orders = form.orders, units = form.units, revenue = form.revenue, adSpend = form.adSpend;
    if (form.restDay) {
      orders = '0'; units = '0'; revenue = '0'; adSpend = '0';
      setFormField('orders', '0'); setFormField('units', '0'); setFormField('revenue', '0');
      if (!selectedConfig?.fixedAdSpend) setFormField('adSpend', '0');
    } else {
      if (!orders || !units || !revenue) {
        alert("Completa todos los campos obligatorios (guías, unidades y recaudo) o activa 'Día de descanso'.");
        return;
      }
    }
    const rec = {
      configId: selectedProductId, orders, units, revenue, adSpend,
      date: selectedDate, id: editingRec?.id || Date.now().toString(),
      savedAt: Date.now(), restDay: form.restDay
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
    setSelectedVendor(''); setSelectedProductId('');
    setForm({ orders: '', units: '', revenue: '', adSpend: '', restDay: false });
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 2500);
  };

  const startEdit = (r) => {
    const config = configs.find(c => c.id === r.configId);
    if (config) {
      setSelectedVendor(config.vendedora);
      setSelectedProductId(r.configId);
      setForm({ orders: r.orders, units: r.units, revenue: r.revenue, adSpend: r.adSpend || '', restDay: r.restDay || false });
      setEditingRec(r);
      setErrorMsg('');
    }
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
    setSelectedVendor(''); setSelectedProductId('');
    setForm({ orders: '', units: '', revenue: '', adSpend: '', restDay: false });
    setErrorMsg('');
  };

  const avgUnits = (!form.restDay && form.orders && form.units && parseFloat(form.orders) > 0)
    ? (parseFloat(form.units) / parseFloat(form.orders)).toFixed(2) : null;
  const extraPerGuide = avgUnits && parseFloat(avgUnits) > 1 && extraUnitCharge > 0
    ? (parseFloat(avgUnits) - 1) * extraUnitCharge : 0;

  const moveDate = (days) => {
    const date = parseColombiaDate(selectedDate);
    date.setDate(date.getDate() + days);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    setSelectedDate(`${year}-${month}-${day}`);
    setEditingRec(null);
    setSelectedVendor(''); setSelectedProductId('');
    setForm({ orders: '', units: '', revenue: '', adSpend: '', restDay: false });
    setErrorMsg('');
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 anim-slide">
      <div><h2 className="text-2xl md:text-3xl font-black italic uppercase tracking-tighter">Cierre Diario</h2><p className="text-xs text-slate-400 font-black uppercase tracking-widest mt-1">Módulo 2 · Registro de Operación</p></div>

      {ultimoDia && (
        <div className={`rounded-2xl p-3 md:p-4 border-l-8 shadow-sm ${diferenciaDias > 1 ? 'bg-amber-50 border-amber-400 text-amber-800' : 'bg-blue-50 border-blue-400 text-blue-800'}`}>
          <div className="flex flex-col md:flex-row justify-between items-start gap-3">
            <div className="flex items-start gap-3">
              <CalendarDays size={18} className="mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-[9px] md:text-[10px] font-black uppercase tracking-widest opacity-70">Último día registrado</p>
                <p className="font-black text-xs md:text-base">
                  {parseColombiaDate(ultimoDia).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' })}
                </p>
                <p className="text-[8px] md:text-[9px] font-semibold mt-1">
                  {diferenciaDias === 0 && ' ✅ Hoy ya hay actividad.'}
                  {diferenciaDias === 1 && ' ⚠️ Ayer fue el último día. Hoy aún no hay registros.'}
                  {diferenciaDias > 1 && ` ❗ Han pasado ${diferenciaDias} días sin registrar.`}
                </p>
              </div>
            </div>
            {diasFaltantes.length > 0 && (
              <div className="bg-white/80 rounded-xl p-2 max-h-32 overflow-y-auto text-[10px] w-full md:w-auto">
                <p className="font-black uppercase text-[8px] flex items-center gap-1"><ListChecks size={10} /> Días sin registrar:</p>
                <ul className="mt-1 space-y-0.5">
                  {diasFaltantes.slice(0, 4).map(d => (
                    <li key={d.fecha} className="text-[9px]">📅 {d.nombre}</li>
                  ))}
                  {diasFaltantes.length > 4 && <li className="text-[8px] text-amber-600">... y {diasFaltantes.length - 4} más</li>}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      <Card className={`space-y-4 md:space-y-5 ${editingRec ? 'border-2 border-amber-400' : ''}`}>
        {editingRec && (<div className="flex items-center gap-2 text-amber-600 text-[10px] font-black uppercase bg-amber-50 px-3 py-2 rounded-xl"><Pencil size={12} /> Editando registro · <button onClick={cancelEdit} className="text-slate-500 underline ml-auto">Cancelar</button></div>)}
        {errorMsg && (<div className="flex items-center gap-2 text-rose-600 text-[10px] font-black uppercase bg-rose-50 px-3 py-2 rounded-xl border border-rose-200"><AlertTriangle size={12} /> {errorMsg}</div>)}

        <div className="bg-zinc-950 px-4 py-3 rounded-2xl text-white space-y-3">
          <div className="flex items-center gap-2"><Calendar size={16} className="text-emerald-400" /><div><p className="text-[8px] font-black text-zinc-500 uppercase">Fecha del Registro · Selección libre (Hora Colombia)</p><p className="text-[8px] text-zinc-600">Cualquier día pasado, presente o futuro</p></div></div>
          <div className="space-y-2"><input type="date" value={selectedDate} onChange={(e) => { if (e.target.value) { setSelectedDate(e.target.value); setEditingRec(null); setSelectedVendor(''); setSelectedProductId(''); setForm({ orders: '', units: '', revenue: '', adSpend: '', restDay: false }); setErrorMsg(''); } }} className="w-full bg-white text-zinc-950 font-black text-sm md:text-base rounded-xl px-3 py-2 cursor-pointer border-2 border-emerald-400" /><div className="grid grid-cols-3 gap-1"><button onClick={() => moveDate(-1)} className="bg-white/10 text-emerald-400 px-2 py-1.5 rounded-xl text-[9px] font-black">Día anterior</button><button onClick={() => { setSelectedDate(todayColombia()); setEditingRec(null); setSelectedVendor(''); setSelectedProductId(''); setForm({ orders: '', units: '', revenue: '', adSpend: '', restDay: false }); setErrorMsg(''); }} className="bg-emerald-500 text-zinc-950 px-2 py-1.5 rounded-xl text-[9px] font-black">Hoy</button><button onClick={() => moveDate(1)} className="bg-white/10 text-emerald-400 px-2 py-1.5 rounded-xl text-[9px] font-black">Día siguiente</button></div></div>
          <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2"><p className="text-[9px] text-zinc-500 font-black uppercase">Registrando en: <span className="text-emerald-400">{parseColombiaDate(selectedDate).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' })}</span></p></div>
        </div>

        <div className={`rounded-xl p-3 flex items-center justify-between ${form.restDay ? 'bg-amber-100 border-2 border-amber-300' : 'bg-slate-100'}`}>
          <div className="flex items-center gap-2"><Coffee size={16} className="text-amber-600" /><div><p className="text-[9px] font-black uppercase">Día de descanso / Sin campaña</p><p className="text-[8px] text-slate-500">Los campos se guardarán como 0.</p></div></div>
          <button onClick={() => setFormField('restDay', !form.restDay)} className="flex items-center gap-1 text-[8px] font-black">{form.restDay ? (<><ToggleRight size={22} className="text-amber-500" /><span className="text-amber-600">DESCANSO</span></>) : (<><ToggleLeft size={22} className="text-slate-400" /><span className="text-slate-500">Activo</span></>)}</button>
        </div>

        <div className="space-y-1.5"><Label>Vendedora</Label><select value={selectedVendor} onChange={(e) => handleVendorChange(e.target.value)} disabled={!!editingRec} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 font-semibold text-sm outline-none focus:border-emerald-400 disabled:bg-slate-100"><option value="">Seleccionar vendedora...</option>{vendors.map(v => <option key={v} value={v}>{v.toUpperCase()}</option>)}</select></div>
        <div className="space-y-1.5"><Label>Producto</Label><select value={selectedProductId} onChange={(e) => handleProductChange(e.target.value)} disabled={!selectedVendor || !!editingRec} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 font-semibold text-sm outline-none focus:border-emerald-400 disabled:bg-slate-100"><option value="">Seleccionar producto...</option>{productsOfVendor.map(p => <option key={p.id} value={p.id}>{p.productName}</option>)}</select>{editingRec && <p className="text-[8px] text-amber-600 mt-1">⚠ No puedes cambiar vendedora ni producto mientras editas.</p>}</div>

        {selectedConfig && !selectedConfig.fixedAdSpend && (<div className="bg-zinc-950 text-white px-4 py-3 rounded-xl space-y-1"><Label className="text-zinc-500 text-[9px]">Inversión Ads de Hoy (MANUAL)</Label><input type="number" value={form.adSpend} onChange={e => setFormField('adSpend', e.target.value)} placeholder="$ 0" disabled={form.restDay} className={`w-full bg-transparent font-black text-xl outline-none ${form.restDay ? 'text-zinc-500 line-through' : 'text-emerald-400'}`} />{form.restDay && <p className="text-[8px] text-amber-400">Se guardará como 0.</p>}</div>)}
        {selectedConfig?.fixedAdSpend && (<div className="flex items-center gap-2 text-emerald-600 text-[8px] font-black bg-emerald-50 px-3 py-2 rounded-xl uppercase"><ToggleRight size={14} /> Ads fijo: {fmt(selectedConfig.dailyAdSpend)} · Se aplica automático</div>)}

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-50 p-3 rounded-xl space-y-1"><div className="flex items-center gap-2 text-slate-400"><Package size={12} /><Label className="!mb-0">Total Guías</Label></div><input type="number" value={form.orders} onChange={e => setFormField('orders', e.target.value)} placeholder="0" disabled={form.restDay} className={`w-full bg-transparent font-black text-2xl outline-none ${form.restDay ? 'text-slate-400 line-through' : 'text-slate-900'}`} />{form.restDay && <p className="text-[7px] text-amber-500">→ 0</p>}</div>
          <div className="bg-slate-50 p-3 rounded-xl space-y-1"><div className="flex items-center gap-2 text-slate-400"><Layers size={12} /><Label className="!mb-0">Total Unidades</Label></div><input type="number" value={form.units} onChange={e => setFormField('units', e.target.value)} placeholder="0" disabled={form.restDay} className={`w-full bg-transparent font-black text-2xl outline-none ${form.restDay ? 'text-slate-400 line-through' : 'text-slate-900'}`} />{form.restDay && <p className="text-[7px] text-amber-500">→ 0</p>}</div>
        </div>

        {!form.restDay && avgUnits && (<div className="text-center space-y-0.5"><p className="text-[9px] text-slate-400 font-black uppercase">Promedio: <span className="text-emerald-600">{avgUnits} unid/guía</span></p>{extraUnitCharge > 0 && parseFloat(avgUnits) > 1 && (<p className="text-[8px] font-bold text-yellow-600">Extra: {fmt(extraUnitCharge)} × {fmtN(parseFloat(avgUnits) - 1)} = {fmt(extraPerGuide)}</p>)}</div>)}

        <div className="space-y-1.5"><Label>Recaudo Bruto Total del Día</Label><input type="number" value={form.revenue} onChange={e => setFormField('revenue', e.target.value)} placeholder="$ 0" disabled={form.restDay} className={`w-full px-4 py-4 rounded-xl bg-slate-50 border-2 border-emerald-100 focus:border-emerald-400 font-black text-2xl outline-none ${form.restDay ? 'text-slate-400 line-through' : 'text-emerald-700'}`} />{form.restDay && <p className="text-[8px] text-amber-500 text-center">→ 0</p>}</div>

        <button onClick={save} disabled={!selectedVendor || !selectedProductId} className="w-full bg-emerald-500 text-zinc-950 py-3 rounded-xl font-black uppercase text-xs tracking-widest hover:bg-emerald-400 disabled:opacity-30 flex items-center justify-center gap-2"><Save size={14} /> {editingRec ? 'Actualizar' : 'Guardar'}</button>
        {savedMsg && <div className="flex justify-center gap-2 text-emerald-600 text-[10px] font-black"><CheckCircle2 size={12} /> ¡Guardado!</div>}
      </Card>

      {/* Resumen de productos registrados vs activos (solo los que deberían estar activos en esta fecha) */}
      {summary.totalActive > 0 && (
        <Card className={`p-3 text-center ${summary.missing === 0 ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
          <div className="flex items-center justify-center gap-2">
            <CheckCircle2 size={16} className={summary.missing === 0 ? 'text-green-600' : 'text-amber-600'} />
            <span className="text-[11px] font-black uppercase tracking-wider">
              {summary.missing === 0 
                ? '✅ TODOS LOS PRODUCTOS ACTIVOS REGISTRADOS' 
                : `⚠️ FALTAN ${summary.missing} PRODUCTO${summary.missing !== 1 ? 'S' : ''} POR REGISTRAR`}
            </span>
          </div>
          <p className="text-[10px] font-semibold mt-1">
            Registrados hoy: <strong>{summary.registeredActive}</strong> de <strong>{summary.totalActive}</strong> productos activos en esta fecha
          </p>
        </Card>
      )}

      {dayRecords.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Registros del día</p>
            <select
              value={filterVendor}
              onChange={(e) => setFilterVendor(e.target.value)}
              className="text-[10px] font-black uppercase bg-white border border-slate-200 rounded-xl px-3 py-1.5 outline-none focus:border-emerald-400"
            >
              <option value="all">TODAS LAS VENDEDORAS</option>
              {Array.from(recordsByVendor.keys()).sort().map(v => (
                <option key={v} value={v}>{v.toUpperCase()}</option>
              ))}
            </select>
          </div>
          
          {filteredDayRecords.length === 0 ? (
            <Card className="text-center py-8 text-slate-400 text-[10px]">
              No hay registros para la vendedora seleccionada en esta fecha.
            </Card>
          ) : (
            <div className="space-y-2">
              {filteredDayRecords.map(r => {
                const c = configs.find(x => x.id === r.configId);
                const eff = parseFloat(c?.effectiveness || 95) / 100;
                const ret = parseFloat(c?.returnRate || 20) / 100;
                const IER = eff * (1 - ret);
                const orders = parseFloat(r.orders) || 0;
                const units = parseFloat(r.units) || 0;
                const avgU = orders > 0 ? units / orders : 1;
                const deliveries = orders * IER;
                const unitsDelivered = deliveries * avgU;
                return (
                  <Card key={r.id} className={`flex flex-col sm:flex-row sm:items-center gap-2 ${r.restDay ? 'bg-slate-100' : ''}`}>
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="font-black text-emerald-600 text-xs">{c?.vendedora}</span>
                        <span className="text-slate-300">·</span>
                        <span className="font-semibold text-xs">{c?.productName}</span>
                        {r.restDay && <span className="text-[8px] font-black bg-amber-100 text-amber-700 px-1 rounded-full"><Moon size={8} /> DESCANSO</span>}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        <span className="text-[8px] font-black bg-slate-100 px-1.5 py-0.5 rounded">{r.orders} guías</span>
                        <span className="text-[8px] font-black bg-slate-100 px-1.5 py-0.5 rounded">{r.units} unid</span>
                        <span className="text-[8px] font-black bg-emerald-50 px-1.5 py-0.5 rounded">{fmtN(deliveries)} entregas</span>
                        <span className="text-[8px] font-black bg-blue-50 px-1.5 py-0.5 rounded">{fmtN(unitsDelivered)} prod.</span>
                        <span className="text-[8px] font-black bg-zinc-100 px-1.5 py-0.5 rounded">{fmt(r.revenue)}</span>
                      </div>
                    </div>
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => startEdit(r)} className="p-1.5 rounded hover:bg-amber-50"><Pencil size={12} /></button>
                      <button onClick={() => deleteRec(r.id)} className="p-1.5 rounded hover:bg-rose-50"><Trash2 size={12} /></button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── VISTA 3: DASHBOARD (igual que antes, sin cambios) ──────────────────────
function VistaDashboard({ configs, months }) {
  const [filter, setFilter] = useState({ startDate: todayColombia(), endDate: todayColombia() });
  const [selectedVendors, setSelectedVendors] = useState([]);
  const [selectedProductsByVendor, setSelectedProductsByVendor] = useState({});

  const grouped = useMemo(() => configs.reduce((a, c) => { if (!a[c.vendedora]) a[c.vendedora] = []; a[c.vendedora].push(c); return a; }, {}), [configs]);

  // ========== FUNCIÓN PARA SABER SI UN PRODUCTO ESTÁ ACTIVO EN UNA FECHA ==========
  const isProductActiveOnDate = (product, dateStr) => {
    if (!product) return false;
    const active = product.activo !== false;
    const creationDate = product.fechaCreacion ? parseColombiaDate(product.fechaCreacion) : null;
    const deactivationDate = product.fechaDesactivacion ? parseColombiaDate(product.fechaDesactivacion) : null;
    const checkDate = parseColombiaDate(dateStr);
    
    if (creationDate && creationDate > checkDate) return false;
    if (!active && deactivationDate && deactivationDate <= checkDate) return false;
    return true;
  };

  // ========== OBTENER PRODUCTOS ACTIVOS EN EL RANGO DE FECHAS ==========
  const getActiveProductsInRange = useMemo(() => {
    const activeMap = new Map(); // vendor -> array de productos activos en todo el rango
    const startDate = filter.startDate;
    const endDate = filter.endDate;
    
    configs.forEach(product => {
      // Verificar si el producto tiene al menos un día activo dentro del rango
      let hasActiveDay = false;
      let current = parseColombiaDate(startDate);
      const end = parseColombiaDate(endDate);
      while (current <= end) {
        const dateStr = current.toISOString().split('T')[0];
        if (isProductActiveOnDate(product, dateStr)) {
          hasActiveDay = true;
          break;
        }
        current.setDate(current.getDate() + 1);
      }
      if (hasActiveDay) {
        if (!activeMap.has(product.vendedora)) activeMap.set(product.vendedora, []);
        activeMap.get(product.vendedora).push(product);
      }
    });
    return activeMap;
  }, [configs, filter.startDate, filter.endDate]);

  // ========== FILTRAR REGISTROS CONSIDERANDO ACTIVIDAD EN LA FECHA ==========
  const filteredRecords = useMemo(() => {
    const all = months.flatMap(m => m.records || []);
    return all.filter(r => {
      const c = configs.find(x => x.id === r.configId);
      if (!c) return false;
      if (r.date < filter.startDate || r.date > filter.endDate) return false;
      
      // Validar que el producto esté activo en la fecha exacta del registro
      if (!isProductActiveOnDate(c, r.date)) return false;
      
      if (selectedVendors.length > 0 && !selectedVendors.includes(c.vendedora)) return false;
      
      const vendorProducts = selectedProductsByVendor[c.vendedora];
      if (vendorProducts && vendorProducts.length > 0 && !vendorProducts.includes(r.configId)) return false;
      
      return true;
    });
  }, [months, configs, filter.startDate, filter.endDate, selectedVendors, selectedProductsByVendor]);

  // ========== ACTUALIZAR LISTA DE VENDEDORAS DISPONIBLES ==========
  const availableVendors = useMemo(() => {
    return Array.from(getActiveProductsInRange.keys()).sort();
  }, [getActiveProductsInRange]);

  // ========== AL CAMBIAR LAS FECHAS, RESETEAMOS SELECCIÓN DE PRODUCTOS ==========
  useEffect(() => {
    const newSelected = {};
    for (const vendor of selectedVendors) {
      const activeProducts = getActiveProductsInRange.get(vendor) || [];
      const currentSelected = selectedProductsByVendor[vendor] || [];
      const validSelected = currentSelected.filter(pid => activeProducts.some(p => p.id === pid));
      if (validSelected.length > 0) newSelected[vendor] = validSelected;
    }
    setSelectedProductsByVendor(newSelected);
  }, [filter.startDate, filter.endDate, getActiveProductsInRange]);

  const setF = (k, v) => setFilter(f => ({ ...f, [k]: v }));

  const [openSections, setOpenSections] = useState({
    embudo: false,
    costos: false,
    ranking: false,
    proyeccion: false,
    analisisProductos: false,
    comparativaVendedoras: false,
    productosRevision: true
  });
  const toggleSection = (section) => setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));

  const stats = useMemo(() => calcularStats(filteredRecords, configs), [filteredRecords, configs]);
  const activeDays = useMemo(() => {
    const activeRecords = filteredRecords.filter(r => !r.restDay);
    const uniqueDates = new Set(activeRecords.map(r => r.date));
    return uniqueDates.size;
  }, [filteredRecords]);
  const avgDiario = activeDays > 0 ? stats.net / activeDays : 0;
  const proyeccion30 = avgDiario * 30;
  
  const targetProfit = useMemo(() => {
    let total = 0;
    for (const [vendor, productIds] of Object.entries(selectedProductsByVendor)) {
      if (productIds.length) {
        productIds.forEach(pid => {
          const c = configs.find(c => c.id === pid);
          if (c) total += parseFloat(c.targetProfit) || 0;
        });
      } else {
        const prods = getActiveProductsInRange.get(vendor) || [];
        total += prods.reduce((s, p) => s + (parseFloat(p.targetProfit) || 0), 0);
      }
    }
    if (total > 0) return total;
    if (selectedVendors.length === 1 && !Object.keys(selectedProductsByVendor).length) {
      const prods = getActiveProductsInRange.get(selectedVendors[0]) || [];
      return prods.reduce((s, p) => s + (parseFloat(p.targetProfit) || 0), 0);
    }
    let allActiveProfit = 0;
    for (const prods of getActiveProductsInRange.values()) {
      allActiveProfit += prods.reduce((s, p) => s + (parseFloat(p.targetProfit) || 0), 0);
    }
    return allActiveProfit;
  }, [selectedVendors, selectedProductsByVendor, configs, getActiveProductsInRange]);

  let semaforo = { color: 'bg-rose-500', texto: 'REVISIÓN', emoji: '🔴', textColor: 'text-rose-500' };
  if (proyeccion30 >= 1_000_000) semaforo = { color: 'bg-emerald-500', texto: 'EXCELENTE', emoji: '🟢', textColor: 'text-emerald-500' };
  else if (proyeccion30 >= targetProfit && targetProfit > 0) semaforo = { color: 'bg-blue-500', texto: 'BIEN', emoji: '🔵', textColor: 'text-blue-500' };

  let cpaColor = '', cpaMensaje = '';
  if (stats.cpaReal > stats.cpaEquilibrioPonderado) {
    cpaColor = 'bg-red-100 border-red-500 text-red-700';
    cpaMensaje = '⚠️ CPA por encima del equilibrio → No rentable';
  } else if (stats.cpaReal <= stats.cpaEquilibrioPonderado * 0.75) {
    cpaColor = 'bg-green-100 border-green-500 text-green-700';
    cpaMensaje = '🚀 CPA excelente (25%+ por debajo) → ESCALAR';
  } else {
    cpaColor = 'bg-yellow-100 border-yellow-500 text-yellow-700';
    cpaMensaje = '✅ CPA por debajo del equilibrio → Rentable';
  }

  const costItems = [
    { label: 'Costo de Mercancía', value: stats.productCostTotal, note: `${fmtN(stats.unitsDeliveredReal)} unid. entregadas`, icon: Package },
    { label: 'Fletes Totales', value: stats.totalFreightCost, note: 'Incluye cargos extra', icon: Truck },
    { label: 'Fulfillment', value: stats.totalFulfillment, note: 'Por guía despachada', icon: Boxes },
    { label: 'Comisiones', value: stats.totalCommissions, note: 'Solo entregas exitosas', icon: DollarSign },
    { label: 'Costos Fijos', value: stats.totalFixedCosts, note: 'Prorrateo por entrega', icon: Activity },
    { label: 'Publicidad', value: stats.totalAds, note: 'Meta Ads', icon: Target },
  ];
  const totalCostos = costItems.reduce((s, i) => s + i.value, 0);
  const ajustePorIER = stats.grossRev - stats.realRev;
  const eficienciaRecaudo = stats.recaudoEficiencia;

  // Productos en revisión (solo los activos en el rango)
  const productosEnRevision = useMemo(() => {
    if (filteredRecords.length === 0) return [];
    const productosMap = new Map();
    filteredRecords.forEach(record => {
      const config = configs.find(c => c.id === record.configId);
      if (!config) return;
      if (!productosMap.has(record.configId)) {
        productosMap.set(record.configId, {
          configId: record.configId,
          vendedora: config.vendedora,
          productName: config.productName,
          targetProfit: parseFloat(config.targetProfit) || 0,
          records: []
        });
      }
      productosMap.get(record.configId).records.push(record);
    });
    const resultados = [];
    for (const [configId, producto] of productosMap) {
      const { records, vendedora, productName, targetProfit } = producto;
      const statsProd = calcularStats(records, configs);
      const activeRecords = records.filter(r => !r.restDay);
      const uniqueDates = new Set(activeRecords.map(r => r.date));
      const activeDays = uniqueDates.size;
      const avgDiario = activeDays > 0 ? statsProd.net / activeDays : 0;
      const proyeccion30 = avgDiario * 30;
      let estado = { texto: 'REVISIÓN', emoji: '🔴', color: 'bg-rose-500', textColor: 'text-rose-500' };
      if (proyeccion30 >= 1_000_000) estado = { texto: 'EXCELENTE', emoji: '🟢', color: 'bg-emerald-500', textColor: 'text-emerald-500' };
      else if (proyeccion30 >= targetProfit && targetProfit > 0) estado = { texto: 'BIEN', emoji: '🔵', color: 'bg-blue-500', textColor: 'text-blue-500' };
      if (estado.texto === 'REVISIÓN') {
        resultados.push({
          configId, vendedora, productName, targetProfit, proyeccion30, avgDiario,
          utilidadPeriodo: statsProd.net, ier: statsProd.ierGlobal, roas: statsProd.roas,
          cpaReal: statsProd.cpaReal,
          cpaEquilibrio: parseFloat(configs.find(c => c.id === configId)?.cpaEquilibrio) || 0,
          pedidos: statsProd.grossOrd, entregas: statsProd.finalDeliveries, diasActivos: activeDays, estado
        });
      }
    }
    return resultados.sort((a, b) => a.proyeccion30 - b.proyeccion30);
  }, [filteredRecords, configs]);

  const SectionHeader = ({ title, icon: Icon, section, totalItems = null }) => (
    <button onClick={() => toggleSection(section)} className="w-full flex items-center justify-between py-2 px-3 md:py-3 md:px-4 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors">
      <div className="flex items-center gap-1.5 md:gap-2">
        <Icon size={14} className="text-emerald-600" />
        <span className="text-[10px] md:text-xs font-black uppercase tracking-widest text-slate-700">{title}</span>
        {totalItems !== null && totalItems > 0 && <span className="text-[8px] md:text-[9px] font-black bg-slate-300 text-slate-700 px-1.5 py-0.5 rounded-full">{totalItems}</span>}
      </div>
      {openSections[section] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
    </button>
  );

  return (
    <div className="space-y-6 md:space-y-8 anim-fade">
      <div><h2 className="text-2xl md:text-3xl font-black italic uppercase tracking-tighter">Dashboard General</h2><p className="text-[10px] md:text-xs text-slate-400 font-black uppercase tracking-widest mt-1">Módulo 3 · Análisis de Rendimiento</p></div>

      {/* Filtros mejorados con exclusión de inactivos */}
      <Card className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1"><Label><Calendar size={10} className="inline mr-1" />Desde</Label><input type="date" value={filter.startDate} onChange={e => setF('startDate', e.target.value)} className="w-full px-3 py-2 bg-slate-50 rounded-xl font-bold text-sm outline-none" /></div>
          <div className="space-y-1"><Label><Calendar size={10} className="inline mr-1" />Hasta</Label><input type="date" value={filter.endDate} onChange={e => setF('endDate', e.target.value)} className="w-full px-3 py-2 bg-slate-50 rounded-xl font-bold text-sm outline-none" /></div>
        </div>
        
        <div className="space-y-2">
          <Label>Vendedoras (múltiple)</Label>
          <div className="flex flex-wrap gap-2">
            {availableVendors.map(v => (
              <button
                key={v}
                onClick={() => {
                  if (selectedVendors.includes(v)) {
                    setSelectedVendors(selectedVendors.filter(vv => vv !== v));
                    const newSelected = { ...selectedProductsByVendor };
                    delete newSelected[v];
                    setSelectedProductsByVendor(newSelected);
                  } else {
                    setSelectedVendors([...selectedVendors, v]);
                  }
                }}
                className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase transition-all ${selectedVendors.includes(v) ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                {v}
              </button>
            ))}
          </div>
          {availableVendors.length === 0 && <p className="text-[10px] text-amber-600">No hay productos activos en el rango de fechas seleccionado.</p>}
        </div>

        {selectedVendors.length > 0 && (
          <div className="space-y-3 border-t pt-3">
            <Label>Productos específicos (solo activos en el rango)</Label>
            {selectedVendors.map(vendor => {
              const activeProductsForVendor = getActiveProductsInRange.get(vendor) || [];
              return (
                <div key={vendor} className="bg-slate-50 p-3 rounded-xl">
                  <p className="text-[9px] font-black uppercase mb-2">{vendor}</p>
                  <div className="flex flex-wrap gap-1">
                    <button
                      onClick={() => setSelectedProductsByVendor(prev => ({ ...prev, [vendor]: activeProductsForVendor.map(p => p.id) }))}
                      className="text-[8px] font-black bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full"
                    >
                      Todos
                    </button>
                    <button
                      onClick={() => {
                        const newSelected = { ...selectedProductsByVendor };
                        delete newSelected[vendor];
                        setSelectedProductsByVendor(newSelected);
                      }}
                      className="text-[8px] font-black bg-red-100 text-red-700 px-2 py-1 rounded-full"
                    >
                      Ninguno
                    </button>
                    {activeProductsForVendor.map(product => (
                      <button
                        key={product.id}
                        onClick={() => {
                          const current = selectedProductsByVendor[vendor] || [];
                          if (current.includes(product.id)) {
                            setSelectedProductsByVendor(prev => ({ ...prev, [vendor]: current.filter(id => id !== product.id) }));
                          } else {
                            setSelectedProductsByVendor(prev => ({ ...prev, [vendor]: [...current, product.id] }));
                          }
                        }}
                        className={`text-[8px] font-black px-2 py-1 rounded-full ${(selectedProductsByVendor[vendor] || []).includes(product.id) ? 'bg-blue-500 text-white' : 'bg-white border border-slate-300 text-slate-600'}`}
                      >
                        {product.productName}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {filteredRecords.length === 0 || activeDays === 0 ? (
        <Card className="text-center py-12 text-slate-300"><BarChart3 size={32} className="mx-auto mb-3 opacity-30" /><p className="font-black uppercase text-sm">Sin datos activos en este rango</p></Card>
      ) : (
        <>
          {/* CPA */}
          <div className={`rounded-xl p-3 md:p-5 border-2 ${cpaColor} shadow-md`}>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
              <div><Label className="text-inherit opacity-70">CPA REAL PROMEDIO</Label><p className="text-xl md:text-3xl font-black font-mono">{fmt(stats.cpaReal)}</p><p className="text-[8px] md:text-[9px] font-semibold">Costo por adquisición real</p></div>
              <div className="text-center"><Label className="text-inherit opacity-70">CPA EQUILIBRIO PONDERADO</Label><p className="text-lg md:text-2xl font-black font-mono">{fmt(stats.cpaEquilibrioPonderado)}</p><p className="text-[8px] md:text-[9px] font-semibold">Basado en cada producto</p></div>
              <div className="text-right"><div className="inline-block px-2 py-1 rounded-lg bg-white/50 backdrop-blur-sm"><p className="text-[8px] md:text-[10px] font-black">{cpaMensaje}</p></div></div>
            </div>
          </div>

          {/* Resumen rápidos */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
            <Card className="border-l-4 border-l-slate-400"><Label>💰 Recaudo Bruto Total</Label><p className="text-xl md:text-3xl font-black">{fmt(stats.grossRev)}</p></Card>
            <Card className="bg-amber-50 border-l-4 border-l-amber-400"><Label>⚠ Ajuste por IER</Label><p className="text-xl md:text-3xl font-black text-amber-600">- {fmt(ajustePorIER)}</p><p className="text-[8px] md:text-[9px] text-amber-500">{fmtDec(eficienciaRecaudo, 1)}% del bruto se pierde</p></Card>
            <Card className="bg-emerald-50 border-l-4 border-l-emerald-500"><Label>✅ Recaudo Neto Real</Label><p className="text-xl md:text-3xl font-black text-emerald-700">{fmt(stats.realRev)}</p></Card>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
            <Stat label="AOV" value={fmt(stats.aov)} sub={`${fmtN(stats.grossOrd)} pedidos`} highlight />
            <Stat label="Flete x Entrega" value={fmt(stats.freteRealXEntrega)} sub={`${fmtN(stats.finalDeliveries)} entregas`} />
            <Stat label="ROAS" value={`${fmtDec(stats.roas, 4)}x`} />
            <Stat label="Utilidad Neta" value={fmt(stats.net)} sub={`${stats.net >= 0 ? '💰' : '⚠️'}`} />
            <Stat label="Profit / Día" value={fmt(avgDiario)} sub={`${activeDays} días`} highlight />
          </div>

          {/* EMBUDO */}
          <div className="space-y-2">
            <SectionHeader title="EMBUDO OPERATIVO Y PRODUCTOS" icon={Activity} section="embudo" />
            {openSections.embudo && (
              <Card>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-4">
                  <div><Label>Pedidos Registrados</Label><p className="text-xl font-black">{fmtN(stats.grossOrd)}</p><p className="text-[8px]">{fmtN(stats.grossUnits)} unidades</p></div>
                  <div><Label>Guías Despachadas</Label><p className="text-xl font-black text-blue-600">{fmtN(stats.realShipped)}</p></div>
                  <div><Label>Devoluciones Est.</Label><p className="text-xl font-black text-rose-500">{fmtN(stats.estimatedReturns)}</p></div>
                  <div><Label>Entregas Finales</Label><p className="text-xl font-black text-emerald-600">{fmtN(stats.finalDeliveries)}</p><p className="text-[8px]">IER {fmtDec(stats.ierGlobal, 2)}%</p></div>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <p className="text-[8px] font-black uppercase mb-2">📦 Unidades físicas</p>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                    <div><span className="text-[8px] text-slate-500">Registradas:</span> <span className="font-black ml-1">{fmtN(stats.unitsRegistradas)}</span></div>
                    <div><span className="text-[8px] text-slate-500">Enviadas:</span> <span className="font-black ml-1 text-blue-600">{fmtN(stats.unitsShippedReal)}</span></div>
                    <div><span className="text-[8px] text-slate-500">Devueltas:</span> <span className="font-black ml-1 text-rose-500">{fmtN(stats.unitsReturnedReal)}</span></div>
                    <div><span className="text-[8px] text-slate-500">Entregadas:</span> <span className="font-black ml-1 text-emerald-600">{fmtN(stats.unitsDeliveredReal)}</span></div>
                    <div><span className="text-[8px] text-slate-500">% Entregado:</span> <span className="font-black ml-1">{fmtDec(stats.pctProductosEntregados, 1)}%</span></div>
                  </div>
                </div>
              </Card>
            )}
          </div>

          {/* COSTOS */}
          <div className="space-y-2">
            <SectionHeader title="RADIOGRAFÍA DE COSTOS" icon={Calculator} section="costos" />
            {openSections.costos && (
              <Card className="space-y-0 p-0 overflow-hidden">
                {costItems.map((item, i) => (
                  <div key={i} className="flex items-center gap-2 md:gap-4 px-4 py-3 border-b border-slate-50 last:border-0">
                    <div className="w-6 h-6 md:w-8 md:h-8 rounded-xl bg-slate-100 flex items-center justify-center"><item.icon size={12} /></div>
                    <div className="flex-1"><p className="text-[11px] md:text-xs font-black">{item.label}</p><p className="text-[7px] md:text-[9px] text-slate-400">{item.note}</p></div>
                    <p className="font-black font-mono text-xs md:text-sm">{fmt(item.value)}</p>
                  </div>
                ))}
                <div className="flex items-center gap-2 md:gap-4 px-4 py-3 bg-slate-900 text-white">
                  <div className="flex-1"><p className="text-[11px] md:text-xs font-black uppercase">Total Costos</p></div>
                  <p className="font-black font-mono text-sm md:text-lg text-rose-400">{fmt(totalCostos)}</p>
                </div>
              </Card>
            )}
          </div>

          {/* RANKING VENDEDORAS */}
          <div className="space-y-2">
            <SectionHeader title="RANKING DE VENDEDORAS" icon={Award} section="ranking" totalItems={stats.rankingVendedoras?.length} />
            {openSections.ranking && (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs md:text-sm">
                  <thead className="bg-slate-100 text-[8px] md:text-[9px] font-black uppercase text-slate-500">
                    <tr><th className="p-2 rounded-l-xl">#</th><th className="p-2">Vendedora</th><th className="p-2 text-right">Pedidos</th><th className="p-2 text-right">Recaudo Neto</th><th className="p-2 text-right">Utilidad</th><th className="p-2 text-right">IER</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stats.rankingVendedoras?.map((v, idx) => (
                      <tr key={v.vendedora} className="hover:bg-slate-50">
                        <td className="p-2 font-black text-emerald-600">{idx+1}</td>
                        <td className="p-2 font-bold uppercase">{v.vendedora}</td>
                        <td className="p-2 text-right font-mono">{fmtN(v.pedidos)}</td>
                        <td className="p-2 text-right font-mono">{fmt(v.recaudoNeto)}</td>
                        <td className={`p-2 text-right font-mono ${v.utilidad >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{fmt(v.utilidad)}</td>
                        <td className="p-2 text-right font-mono">{fmtDec(v.ierPromedio, 2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* PROYECCIÓN */}
          <div className="space-y-2">
            <SectionHeader title="UTILIDAD Y PROYECCIÓN" icon={TrendingUp} section="proyeccion" />
            {openSections.proyeccion && (
              <div className="flex flex-col md:grid md:grid-cols-2 gap-4">
                <Card dark className="space-y-3">
                  <Label className="text-zinc-500">Utilidad Neta Período</Label>
                  <p className={`text-2xl md:text-4xl font-black font-mono ${stats.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{fmt(stats.net)}</p>
                  <div className="grid grid-cols-2 gap-2 pt-3 border-t border-zinc-800 text-xs">
                    <div><p className="text-[8px] text-zinc-500">Ingresos Reales</p><p className="font-black text-white">{fmt(stats.realRev)}</p></div>
                    <div><p className="text-[8px] text-zinc-500">Total Costos</p><p className="font-black text-rose-400">{fmt(totalCostos)}</p></div>
                    <div><p className="text-[8px] text-zinc-500">Margen Neto</p><p className="font-black text-emerald-400">{stats.realRev > 0 ? fmtDec((stats.net / stats.realRev) * 100) : '0.00'}%</p></div>
                    <div><p className="text-[8px] text-zinc-500">Profit / Día</p><p className="font-black text-white">{fmt(avgDiario)}</p></div>
                  </div>
                </Card>
                <div className={`rounded-2xl p-4 text-white shadow-xl ${semaforo.color === 'bg-emerald-500' ? 'bg-emerald-600' : semaforo.color === 'bg-blue-500' ? 'bg-blue-600' : 'bg-rose-600'}`}>
                  <div><p className="text-[8px] font-black opacity-60">Proyección 30 Días</p><p className="text-[8px] opacity-50 mt-0.5">({fmt(avgDiario)}/día × 30)</p></div>
                  <p className="text-2xl md:text-4xl font-black">{fmt(proyeccion30)}</p>
                  <div className="bg-white/20 px-3 py-2 rounded-xl mt-2"><p className="text-sm md:text-lg font-black">{semaforo.emoji} {semaforo.texto}</p>{targetProfit > 0 && <p className="text-[8px] opacity-70">Meta: {fmt(targetProfit)} · 1M excelente</p>}</div>
                  <div className="flex justify-between text-[8px] font-black opacity-60 mt-3"><span>Días activos: {activeDays}</span><span>IER: {fmtDec(stats.ierGlobal, 2)}%</span></div>
                </div>
                {targetProfit > 0 && (
                  <Card className="col-span-2">
                    <div className="flex justify-between text-xs"><Label>Avance vs Meta</Label><span className={`text-xs font-black ${semaforo.textColor}`}>{fmtDec((proyeccion30 / targetProfit) * 100, 2)}%</span></div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden mt-1"><div className={`h-full rounded-full ${semaforo.color === 'bg-emerald-500' ? 'bg-emerald-500' : semaforo.color === 'bg-blue-500' ? 'bg-blue-500' : 'bg-rose-500'}`} style={{ width: `${Math.min((proyeccion30 / targetProfit) * 100, 100)}%` }} /></div>
                  </Card>
                )}
              </div>
            )}
          </div>

          {/* PRODUCTOS EN REVISIÓN */}
          <div className="space-y-2">
            <button onClick={() => toggleSection('productosRevision')} className="w-full flex items-center justify-between py-2 px-3 md:py-3 md:px-4 bg-red-50 hover:bg-red-100 rounded-xl transition-colors border-l-4 border-red-500">
              <div className="flex items-center gap-1.5 md:gap-2"><AlertTriangle size={14} className="text-red-600" /><span className="text-[10px] md:text-xs font-black uppercase tracking-widest text-red-700">🚨 PRODUCTOS EN REVISIÓN ({productosEnRevision.length})</span></div>
              {openSections.productosRevision ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {openSections.productosRevision && (
              <Card className="overflow-hidden p-0">
                {productosEnRevision.length === 0 ? (
                  <div className="p-6 text-center text-green-600 flex items-center justify-center gap-2"><CheckCircle2 size={20} /><span className="font-black text-sm">✅ No hay productos en revisión en este período</span></div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-[10px] md:text-sm">
                      <thead className="bg-red-50 text-[7px] md:text-[8px] font-black uppercase text-red-700">
                        <tr><th className="p-2 md:p-3">Vendedora</th><th className="p-2 md:p-3">Producto</th><th className="p-2 md:p-3 text-right">Utilidad Período</th><th className="p-2 md:p-3 text-right">Proy. 30 días</th><th className="p-2 md:p-3 text-right">Meta Mensual</th><th className="p-2 md:p-3 text-right">% Meta</th><th className="p-2 md:p-3 text-right">IER</th><th className="p-2 md:p-3 text-right">ROAS</th><th className="p-2 md:p-3 text-right">CPA</th><th className="p-2 md:p-3">⚠️ Alertas</th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {productosEnRevision.map(p => {
                          const porcentajeMeta = p.targetProfit > 0 ? (p.proyeccion30 / p.targetProfit) * 100 : 0;
                          const alertas = [];
                          if (p.utilidadPeriodo < 0) alertas.push('💰 pérdida');
                          if (p.ier < 70) alertas.push(`📉 IER ${fmtDec(p.ier,1)}%`);
                          if (p.roas < 1.5 && p.roas > 0) alertas.push(`📊 ROAS ${fmtDec(p.roas,2)}x`);
                          if (p.cpaEquilibrio > 0 && p.cpaReal > p.cpaEquilibrio) alertas.push('🎯 CPA alto');
                          if (p.pedidos === 0) alertas.push('⚠️ sin pedidos');
                          return (
                            <tr key={p.configId} className="hover:bg-red-50/50 transition">
                              <td className="p-2 md:p-3 font-black text-red-700 uppercase text-[9px] md:text-xs">{p.vendedora}</td>
                              <td className="p-2 md:p-3 font-semibold text-[9px] md:text-xs">{p.productName}</td>
                              <td className={`p-2 md:p-3 text-right font-mono font-black ${p.utilidadPeriodo < 0 ? 'text-red-600' : 'text-amber-600'}`}>{fmt(p.utilidadPeriodo)}</td>
                              <td className="p-2 md:p-3 text-right font-mono font-black text-red-600">{fmt(p.proyeccion30)}</td>
                              <td className="p-2 md:p-3 text-right font-mono">{fmt(p.targetProfit)}</td>
                              <td className="p-2 md:p-3 text-right font-mono font-black"><span className={porcentajeMeta < 50 ? 'text-red-600' : 'text-amber-600'}>{fmtDec(porcentajeMeta, 1)}%</span></td>
                              <td className="p-2 md:p-3 text-right font-mono">{fmtDec(p.ier, 1)}%</td>
                              <td className="p-2 md:p-3 text-right font-mono">{fmtDec(p.roas, 2)}x</td>
                              <td className="p-2 md:p-3 text-right font-mono">{fmt(p.cpaReal)}</td>
                              <td className="p-2 md:p-3"><div className="flex flex-wrap gap-1">{alertas.map((a,i) => <span key={i} className="text-[7px] md:text-[8px] font-black bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">{a}</span>)}</div></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )}
          </div>

          {/* ANÁLISIS TEMPORAL POR PRODUCTO (con fechas de creación/desactivación) */}
          <div className="space-y-2">
            <SectionHeader title="ANÁLISIS TEMPORAL POR PRODUCTO" icon={CalendarDays} section="analisisProductos" totalItems={stats.detalleProductos.length} />
            {openSections.analisisProductos && (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-[10px] md:text-sm">
                  <thead className="bg-slate-100 text-[7px] md:text-[8px] font-black uppercase text-slate-500">
                    <tr><th className="p-2">Vendedora</th><th className="p-2">Producto</th><th className="p-2">Primer registro</th><th className="p-2">Último registro</th><th className="p-2">Fecha creación</th><th className="p-2">Fecha desactivación</th><th className="p-2">Días activos</th><th className="p-2">Estado</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stats.detalleProductos.map(p => {
                      const diasActivos = Math.floor((parseColombiaDate(p.ultimoRegistro) - parseColombiaDate(p.primerRegistro)) / (1000 * 60 * 60 * 24)) + 1;
                      const isActive = p.activo !== false;
                      return (
                        <tr key={p.configId} className="hover:bg-slate-50">
                          <td className="p-2 font-bold uppercase text-[9px] md:text-xs">{p.vendedora}</td>
                          <td className={`p-2 font-semibold text-[9px] md:text-xs ${!isActive ? 'text-slate-400 line-through' : ''}`}>{p.productName}</td>
                          <td className="p-2 font-mono text-[8px] md:text-[10px]">{parseColombiaDate(p.primerRegistro).toLocaleDateString('es-CO')}</td>
                          <td className="p-2 font-mono text-[8px] md:text-[10px]">{parseColombiaDate(p.ultimoRegistro).toLocaleDateString('es-CO')}</td>
                          <td className="p-2 font-mono text-[8px] md:text-[10px]">{p.fechaCreacion ? parseColombiaDate(p.fechaCreacion).toLocaleDateString('es-CO') : '-'}</td>
                          <td className="p-2 font-mono text-[8px] md:text-[10px]">{p.fechaDesactivacion ? parseColombiaDate(p.fechaDesactivacion).toLocaleDateString('es-CO') : '-'}</td>
                          <td className="p-2 font-mono text-[8px] md:text-[10px]">{diasActivos} días</td>
                          <td className="p-2">{!isActive ? <span className="text-[8px] font-black bg-red-100 text-red-600 px-2 py-0.5 rounded-full flex items-center gap-1 w-fit"><PowerOff size={10} /> INACTIVO</span> : <span className="text-[8px] font-black bg-green-100 text-green-600 px-2 py-0.5 rounded-full flex items-center gap-1 w-fit"><Power size={10} /> ACTIVO</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* COMPARATIVA ENTRE VENDEDORAS (solo las activas en el rango) */}
          <div className="space-y-2">
            <button onClick={() => toggleSection('comparativaVendedoras')} className="w-full flex items-center justify-between py-2 px-3 md:py-3 md:px-4 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-colors">
              <div className="flex items-center gap-1.5 md:gap-2"><Users size={14} className="text-indigo-600" /><span className="text-[10px] md:text-xs font-black uppercase tracking-widest text-indigo-700">📊 COMPARATIVA ENTRE VENDEDORAS</span></div>
              {openSections.comparativaVendedoras ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {openSections.comparativaVendedoras && (
              <Card className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-[10px] md:text-sm">
                  <thead className="bg-indigo-50 text-[7px] md:text-[8px] font-black uppercase text-indigo-700">
                    <tr><th className="p-2 md:p-3">Vendedora</th><th className="p-2 md:p-3 text-right">Inversión Ads</th><th className="p-2 md:p-3 text-right">CPA Promedio</th><th className="p-2 md:p-3 text-right">Utilidad Período</th><th className="p-2 md:p-3 text-right">Proy. 30 días</th><th className="p-2 md:p-3 text-right">Facturación Real</th><th className="p-2 md:p-3 text-right">ROAS</th><th className="p-2 md:p-3 text-right">IER</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedVendors.length === 0 ? (
                      <tr><td colSpan="8" className="p-4 text-center text-slate-400">Selecciona al menos una vendedora en los filtros para ver la comparativa.</td></tr>
                    ) : (
                      selectedVendors.map(vendor => {
                        const vendorRecords = filteredRecords.filter(r => {
                          const c = configs.find(x => x.id === r.configId);
                          return c && c.vendedora === vendor;
                        });
                        const vendorStats = calcularStats(vendorRecords, configs);
                        const activeDaysV = new Set(vendorRecords.filter(r => !r.restDay).map(r => r.date)).size;
                        const proy30 = activeDaysV > 0 ? (vendorStats.net / activeDaysV) * 30 : 0;
                        return (
                          <tr key={vendor} className="hover:bg-indigo-50/50">
                            <td className="p-2 md:p-3 font-black uppercase text-indigo-700">{vendor}</td>
                            <td className="p-2 md:p-3 text-right font-mono">{fmt(vendorStats.totalAds)}</td>
                            <td className="p-2 md:p-3 text-right font-mono">{fmt(vendorStats.cpaReal)}</td>
                            <td className={`p-2 md:p-3 text-right font-mono font-black ${vendorStats.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(vendorStats.net)}</td>
                            <td className="p-2 md:p-3 text-right font-mono font-black">{fmt(proy30)}</td>
                            <td className="p-2 md:p-3 text-right font-mono">{fmt(vendorStats.realRev)}</td>
                            <td className="p-2 md:p-3 text-right font-mono">{fmtDec(vendorStats.roas, 2)}x</td>
                            <td className="p-2 md:p-3 text-right font-mono">{fmtDec(vendorStats.ierGlobal, 1)}%</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
                {selectedVendors.length > 0 && (
                  <div className="p-3 bg-indigo-50 text-[8px] font-black text-indigo-600 flex justify-between">
                    <span>Período: {filter.startDate} al {filter.endDate}</span>
                    <span>Registros analizados: {filteredRecords.length}</span>
                  </div>
                )}
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}
// ==================== COMPONENTE AGENDA (ADAPTADO A TU ENTORNO) ====================
const RESPONSIBLES = [
  { id: 'david', name: 'David', color: 'blue', bgLight: 'bg-blue-50', bgDark: 'bg-blue-600', borderColor: 'border-blue-200' },
  { id: 'julian', name: 'Julián', color: 'purple', bgLight: 'bg-purple-50', bgDark: 'bg-purple-600', borderColor: 'border-purple-200' },
  { id: 'william', name: 'William', color: 'green', bgLight: 'bg-green-50', bgDark: 'bg-green-600', borderColor: 'border-green-200' }
];

const TASK_STATUS = {
  pending: { id: 'pending', label: 'Pendiente', emoji: '⏳', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  approved: { id: 'approved', label: 'Aprobado', emoji: '✅', color: 'bg-green-100 text-green-800 border-green-300' },
  rejected: { id: 'rejected', label: 'Rechazado', emoji: '❌', color: 'bg-red-100 text-red-800 border-red-300' }
};

const PRIORITIES = {
  alta: { id: 'alta', label: 'Alta', emoji: '🔴', color: 'bg-red-100 text-red-700 border-red-300' },
  media: { id: 'media', label: 'Media', emoji: '🟡', color: 'bg-yellow-100 text-yellow-700 border-yellow-300' },
  baja: { id: 'baja', label: 'Baja', emoji: '🟢', color: 'bg-green-100 text-green-700 border-green-300' }
};

const AGENDA_TABS = [
  { id: 'pending', label: 'Pendientes', emoji: '📋', color: 'bg-amber-500' },
  { id: 'approved', label: 'Aprobadas', emoji: '✅', color: 'bg-emerald-500' },
  { id: 'rejected', label: 'Rechazadas', emoji: '❌', color: 'bg-rose-500' }
];

function AgendaModule() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [activeTab, setActiveTab] = useState('pending');
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);
  const [filterResponsible, setFilterResponsible] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedComments, setExpandedComments] = useState({});
  const [newComment, setNewComment] = useState({});
  const [sortBy, setSortBy] = useState('dueDate');
  const [approvalModal, setApprovalModal] = useState({ show: false, taskId: null, justification: '', dueDate: null });
  const [formData, setFormData] = useState({
    title: '', description: '', responsible: 'david', priority: 'media', status: 'pending', dueDate: ''
  });

  useEffect(() => {
    if (!user) return;
    const tasksRef = collection(db, 'agenda_tasks');
    const unsubscribe = onSnapshot(tasksRef, (snapshot) => {
      const loaded = snapshot.docs.map(doc => {
        const data = doc.data();
        let createdAtFormatted = '';
        if (data.createdAt?.toDate) {
          const d = data.createdAt.toDate();
          createdAtFormatted = `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getFullYear()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
        }
        let dueDateStr = data.dueDate?.toDate ? data.dueDate.toDate().toISOString().split('T')[0] : '';
        let approvedAtFormatted = '';
        if (data.approvedAt?.toDate) {
          const d = data.approvedAt.toDate();
          approvedAtFormatted = `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getFullYear()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
        }
        return { id: doc.id, ...data, createdAtFormatted, dueDate: dueDateStr, approvedAtFormatted, comments: data.comments || [] };
      });
      setTasks(loaded);
    });
    return () => unsubscribe();
  }, [user]);

  const handleFormChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const saveTask = async () => {
    if (!formData.title.trim()) { alert("El título es obligatorio"); return; }
    const payload = {
      title: formData.title.trim(),
      description: formData.description.trim(),
      responsible: formData.responsible,
      priority: formData.priority,
      status: formData.status,
      dueDate: formData.dueDate ? Timestamp.fromDate(new Date(formData.dueDate)) : null,
      updatedAt: serverTimestamp(),
      createdBy: user?.uid
    };
    try {
      if (editingTask) {
        await updateDoc(doc(db, 'agenda_tasks', editingTask.id), payload);
      } else {
        await addDoc(collection(db, 'agenda_tasks'), { ...payload, createdAt: serverTimestamp(), comments: [] });
      }
      resetForm();
    } catch (err) { console.error(err); alert("Error al guardar la tarea"); }
  };

  const deleteTask = async (id) => {
    if (window.confirm("¿Eliminar esta tarea?")) {
      await deleteDoc(doc(db, 'agenda_tasks', id));
    }
  };

  const handleStatusChange = async (taskId, newStatus, taskDueDate) => {
    if (newStatus === 'approved') {
      setApprovalModal({ show: true, taskId, justification: '', dueDate: taskDueDate });
    } else {
      await updateDoc(doc(db, 'agenda_tasks', taskId), { status: newStatus, updatedAt: serverTimestamp() });
    }
  };

  const confirmApproval = async () => {
    const { taskId, justification, dueDate } = approvalModal;
    if (!justification.trim()) { alert("Debes escribir una justificación"); return; }
    const now = new Date();
    const approvedAt = Timestamp.fromDate(now);
    const approvedAtFormatted = now.toLocaleString('es-CO');
    let delayInfo = null;
    if (dueDate) {
      const diffDays = Math.ceil((now - new Date(dueDate)) / (1000*60*60*24));
      if (diffDays > 0) delayInfo = { status: 'retraso', message: `⚠️ Retraso de ${diffDays} día${diffDays !== 1 ? 's' : ''}` };
      else if (diffDays < 0) delayInfo = { status: 'adelanto', message: `✅ Completado con ${Math.abs(diffDays)} día${Math.abs(diffDays) !== 1 ? 's' : ''} de anticipación` };
      else delayInfo = { status: 'justo', message: '🎯 Completado justo a tiempo' };
    } else delayInfo = { status: 'sin_fecha', message: '📅 Sin fecha límite definida' };
    try {
      await updateDoc(doc(db, 'agenda_tasks', taskId), {
        status: 'approved',
        approvedAt,
        approvedAtFormatted,
        approvalJustification: justification.trim(),
        approvalDelayInfo: delayInfo,
        updatedAt: serverTimestamp()
      });
      setApprovalModal({ show: false, taskId: null, justification: '', dueDate: null });
    } catch (err) { console.error(err); alert("Error al guardar la aprobación"); }
  };

  const addComment = async (taskId) => {
    const commentText = newComment[taskId]?.trim();
    if (!commentText) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const responsibleName = RESPONSIBLES.find(r => r.id === task.responsible)?.name || 'Usuario';
    const comment = {
      id: Date.now().toString(),
      text: commentText,
      author: responsibleName,
      authorId: task.responsible,
      createdAt: new Date().toLocaleString('es-CO')
    };
    const updatedComments = [...(task.comments || []), comment];
    try {
      await updateDoc(doc(db, 'agenda_tasks', taskId), { comments: updatedComments, updatedAt: serverTimestamp() });
      setNewComment(prev => ({ ...prev, [taskId]: '' }));
    } catch (err) { console.error(err); alert("Error al guardar el comentario"); }
  };

  const resetForm = () => {
    setFormData({ title: '', description: '', responsible: 'david', priority: 'media', status: 'pending', dueDate: '' });
    setEditingTask(null); setShowForm(false);
  };

  const editTask = (task) => {
    setFormData({
      title: task.title,
      description: task.description || '',
      responsible: task.responsible,
      priority: task.priority || 'media',
      status: task.status,
      dueDate: task.dueDate || ''
    });
    setEditingTask(task); setShowForm(true);
  };

  const toggleComments = (taskId) => setExpandedComments(prev => ({ ...prev, [taskId]: !prev[taskId] }));

  const filteredTasks = tasks
    .filter(t => t.status === activeTab)
    .filter(t => filterResponsible === 'all' || t.responsible === filterResponsible)
    .filter(t => t.title?.toLowerCase().includes(searchTerm.toLowerCase()) || t.description?.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'dueDate') {
        if (!a.dueDate) return 1; if (!b.dueDate) return -1;
        return new Date(a.dueDate) - new Date(b.dueDate);
      }
      if (sortBy === 'priority') {
        const order = { alta: 0, media: 1, baja: 2 };
        return (order[a.priority] || 1) - (order[b.priority] || 1);
      }
      return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
    });

  const getTaskCount = (status) => tasks.filter(t => t.status === status).length;

  const getComplianceByResponsible = () => {
    return RESPONSIBLES.map(resp => {
      const userTasks = tasks.filter(t => t.responsible === resp.id);
      const total = userTasks.length;
      const approved = userTasks.filter(t => t.status === 'approved').length;
      const rejected = userTasks.filter(t => t.status === 'rejected').length;
      const pending = total - approved - rejected;
      const percent = total === 0 ? 0 : Math.round((approved / total) * 100);
      let barColor = 'bg-emerald-500';
      if (percent < 30) barColor = 'bg-rose-500';
      else if (percent < 70) barColor = 'bg-amber-500';
      return { ...resp, total, approved, rejected, pending, percent, barColor };
    });
  };

  const complianceData = getComplianceByResponsible();
  const overallTotal = tasks.length;
  const overallApproved = tasks.filter(t => t.status === 'approved').length;
  const overallPercent = overallTotal === 0 ? 0 : Math.round((overallApproved / overallTotal) * 100);
  const pendingByResponsible = RESPONSIBLES.map(resp => ({ ...resp, total: tasks.filter(t => t.status === 'pending' && t.responsible === resp.id).length }));

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {approvalModal.show && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4" onClick={() => setApprovalModal({ show: false, taskId: null, justification: '', dueDate: null })}>
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-black text-green-600 mb-4">✅ Aprobar Tarea</h3>
            <textarea value={approvalModal.justification} onChange={(e) => setApprovalModal(prev => ({ ...prev, justification: e.target.value }))} rows={4} placeholder="Describe las acciones realizadas..." className="w-full border rounded-xl p-3 text-sm mb-4" autoFocus />
            <div className="flex gap-3">
              <button onClick={() => setApprovalModal({ show: false, taskId: null, justification: '', dueDate: null })} className="flex-1 border rounded-xl py-2">Cancelar</button>
              <button onClick={confirmApproval} className="flex-1 bg-green-600 text-white rounded-xl py-2">Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {selectedTask && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-40 p-4" onClick={() => setSelectedTask(null)}>
          <div className="bg-white rounded-2xl max-w-md w-full max-h-[85vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white p-4 border-b flex justify-between"><h3 className="font-black">{selectedTask.title}</h3><button onClick={() => setSelectedTask(null)} className="text-2xl">&times;</button></div>
            <div className="p-4 space-y-3">
              <div className="bg-zinc-50 p-3 rounded-xl"><p className="text-xs font-black">📝 Descripción</p><p>{selectedTask.description || 'Sin descripción'}</p></div>
              {selectedTask.status === 'approved' && selectedTask.approvalJustification && (
                <div className="bg-green-50 p-3 rounded-xl border border-green-200">
                  <p className="text-xs font-black text-green-700">✅ Aprobada el: {selectedTask.approvedAtFormatted}</p>
                  <p className="text-xs font-bold">{selectedTask.approvalDelayInfo?.message}</p>
                  <p className="text-xs mt-1">Justificación: {selectedTask.approvalJustification}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="font-black">Responsable:</span> {RESPONSIBLES.find(r => r.id === selectedTask.responsible)?.name}</div>
                <div><span className="font-black">Prioridad:</span> {PRIORITIES[selectedTask.priority]?.emoji} {PRIORITIES[selectedTask.priority]?.label}</div>
                <div><span className="font-black">Estado:</span> {TASK_STATUS[selectedTask.status]?.emoji} {TASK_STATUS[selectedTask.status]?.label}</div>
                <div><span className="font-black">Fecha límite:</span> {selectedTask.dueDate || '-'}</div>
              </div>
              <div className="bg-zinc-50 p-3 rounded-xl">
                <p className="text-xs font-black">💬 Comentarios ({selectedTask.comments?.length || 0})</p>
                <div className="max-h-32 overflow-y-auto space-y-1 my-2">{selectedTask.comments?.map(c => <div key={c.id} className="text-xs border-b pb-1"><b>{c.author}</b> ({c.createdAt}): {c.text}</div>)}</div>
                <div className="flex gap-2 mt-2"><input value={newComment[selectedTask.id] || ''} onChange={(e) => setNewComment(prev => ({ ...prev, [selectedTask.id]: e.target.value }))} placeholder="Escribe un comentario..." className="flex-1 border rounded-xl px-3 py-1 text-sm" /><button onClick={() => addComment(selectedTask.id)} className="bg-blue-600 text-white px-3 rounded-xl text-sm">Enviar</button></div>
              </div>
              <div className="flex gap-2"><button onClick={() => { setSelectedTask(null); editTask(selectedTask); }} className="flex-1 bg-indigo-50 py-2 rounded-xl">✏️ Editar</button><button onClick={() => { deleteTask(selectedTask.id); setSelectedTask(null); }} className="flex-1 bg-rose-50 py-2 rounded-xl">🗑️ Eliminar</button></div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl p-4 shadow-sm border">
        <div className="flex justify-between items-center mb-3"><h3 className="font-black">📊 Cumplimiento por Responsable</h3><span className="text-xs">Total: {overallApproved}/{overallTotal} ({overallPercent}%)</span></div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {complianceData.map(resp => (
            <div key={resp.id} className={`${resp.bgLight} rounded-xl p-3`}>
              <div className="flex justify-between">
                <div><div className="flex gap-1"><div className={`w-3 h-3 rounded-full ${resp.barColor}`}></div><span className="font-black">{resp.name}</span></div><span className="text-2xl font-black">{resp.percent}%</span></div>
                <div className="text-right"><span className="text-xs text-zinc-500">Tareas</span><div className="font-bold">{resp.approved}/{resp.total}</div></div>
              </div>
              <div className="h-2 bg-white rounded-full my-2"><div className={`h-full rounded-full ${resp.barColor}`} style={{ width: `${resp.percent}%` }}></div></div>
              <div className="flex justify-between text-[10px] font-bold"><span>✅ {resp.approved}</span><span>⏳ {resp.pending}</span><span>❌ {resp.rejected}</span></div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {pendingByResponsible.map(resp => (
          <div key={resp.id} className="bg-white rounded-xl p-3 text-center shadow-sm border">
            <p className="text-[10px] font-black uppercase">Pendientes {resp.name}</p>
            <p className="text-3xl font-black" style={{ color: resp.color === 'blue' ? '#2563eb' : (resp.color === 'purple' ? '#9333ea' : '#16a34a') }}>{resp.total}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl p-1 shadow-sm border">
        <div className="flex flex-wrap gap-1 justify-center">
          {AGENDA_TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`px-4 py-2 rounded-xl font-black text-xs uppercase flex items-center gap-1 ${activeTab === tab.id ? `${tab.color} text-white shadow-md` : 'bg-zinc-100'}`}>
              <span>{tab.emoji}</span> {tab.label} <span className="ml-1 px-1 rounded-full bg-white/30">{getTaskCount(tab.id)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <input type="text" placeholder="🔍 Buscar tarea..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="flex-1 border rounded-xl px-3 py-2 text-sm" />
        <select value={filterResponsible} onChange={(e) => setFilterResponsible(e.target.value)} className="border rounded-xl px-3 py-2 text-sm">
          <option value="all">👥 Todos</option>
          {RESPONSIBLES.map(r => <option key={r.id} value={r.id}>👤 {r.name}</option>)}
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="border rounded-xl px-3 py-2 text-sm">
          <option value="dueDate">📅 Fecha límite</option>
          <option value="priority">⚠️ Prioridad</option>
          <option value="createdAt">🕒 Creación</option>
        </select>
      </div>

      <div className="flex justify-end">
        <button onClick={() => { resetForm(); setShowForm(true); }} className="bg-zinc-900 text-white px-5 py-2 rounded-xl text-xs font-black">➕ Nueva Tarea</button>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5">
            <h3 className="font-black mb-4">{editingTask ? 'Editar Tarea' : 'Nueva Tarea'}</h3>
            <div className="space-y-3">
              <input name="title" value={formData.title} onChange={handleFormChange} placeholder="Título *" className="w-full border rounded-xl p-2" />
              <textarea name="description" value={formData.description} onChange={handleFormChange} rows={2} placeholder="Descripción" className="w-full border rounded-xl p-2" />
              <div className="grid grid-cols-2 gap-2">
                <select name="responsible" value={formData.responsible} onChange={handleFormChange} className="border rounded-xl p-2">
                  {RESPONSIBLES.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <select name="priority" value={formData.priority} onChange={handleFormChange} className="border rounded-xl p-2">
                  {Object.entries(PRIORITIES).map(([k,v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select name="status" value={formData.status} onChange={handleFormChange} className="border rounded-xl p-2">
                  {Object.entries(TASK_STATUS).map(([k,v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}
                </select>
                <input type="date" name="dueDate" value={formData.dueDate} onChange={handleFormChange} className="border rounded-xl p-2" />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={resetForm} className="border rounded-xl px-4 py-1">Cancelar</button>
              <button onClick={saveTask} className="bg-zinc-900 text-white rounded-xl px-4 py-1">Guardar</button>
            </div>
          </div>
        </div>
      )}

      <div className="hidden md:block bg-white rounded-2xl shadow-sm border overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-zinc-50 border-b">
            <tr>
              <th className="px-4 py-2 text-[10px] font-black uppercase">Título</th>
              <th className="px-4 py-2 text-[10px] font-black uppercase">Responsable</th>
              <th className="px-4 py-2 text-[10px] font-black uppercase">Prioridad</th>
              <th className="px-4 py-2 text-[10px] font-black uppercase">Estado</th>
              <th className="px-4 py-2 text-[10px] font-black uppercase">Fecha límite</th>
              <th className="px-4 py-2 text-[10px] font-black uppercase">Creada</th>
              <th className="px-4 py-2 text-[10px] font-black uppercase">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filteredTasks.length === 0 ? (
              <tr><td colSpan="7" className="text-center py-8 text-zinc-400">No hay tareas</td></tr>
            ) : (
              filteredTasks.map(task => {
                const resp = RESPONSIBLES.find(r => r.id === task.responsible);
                const priorityConfig = PRIORITIES[task.priority] || PRIORITIES.media;
                const statusConfig = TASK_STATUS[task.status] || TASK_STATUS.pending;
                const isOverdue = task.dueDate && task.status !== 'approved' && new Date(task.dueDate) < new Date();
                const delayInfo = task.approvalDelayInfo;
                const isCommentsOpen = expandedComments[task.id];
                return (
                  <React.Fragment key={task.id}>
                    <tr className="border-b hover:bg-zinc-50 transition">
                      <td className="px-4 py-2">
                        <button onClick={() => setSelectedTask(task)} className="font-bold text-sm text-left hover:text-indigo-600">
                          {task.title}
                          {task.description && <div className="text-[10px] text-zinc-400 font-normal">{task.description}</div>}
                          {task.status === 'approved' && delayInfo && <div className="text-[9px] text-orange-600">{delayInfo.message}</div>}
                        </button>
                      </td>
                      <td className="px-4 py-2">
                        <span className={`inline-block px-2 py-1 rounded-full text-[10px] font-black ${resp?.color === 'blue' ? 'bg-blue-100 text-blue-700' : resp?.color === 'purple' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}`}>
                          {resp?.name}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <span className={`inline-block px-2 py-1 rounded-full text-[10px] font-bold ${priorityConfig.color}`}>
                          {priorityConfig.emoji} {priorityConfig.label}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <select value={task.status} onChange={(e) => handleStatusChange(task.id, e.target.value, task.dueDate)} className={`text-[10px] font-bold rounded-full px-2 py-1 border ${statusConfig.color}`} disabled={task.status === 'approved'}>
                          {Object.entries(TASK_STATUS).map(([k,v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-2 text-sm">
                        {task.dueDate ? <span className={isOverdue ? 'text-rose-600 font-bold' : ''}>{task.dueDate}</span> : '-'}
                      </td>
                      <td className="px-4 py-2 text-xs text-zinc-500">{task.createdAtFormatted || '-'}</td>
                      <td className="px-4 py-2 flex gap-1">
                        <button onClick={() => toggleComments(task.id)} className="text-blue-600 hover:text-blue-800" title="Comentarios">💬 {task.comments?.length || 0}</button>
                        <button onClick={() => editTask(task)} className="text-indigo-600 hover:text-indigo-800" title="Editar">✏️</button>
                        <button onClick={() => deleteTask(task.id)} className="text-rose-600 hover:text-rose-800" title="Eliminar">🗑️</button>
                      </td>
                    </tr>
                    {isCommentsOpen && (
                      <tr className="bg-zinc-50/80">
                        <td colSpan="7" className="px-4 py-3">
                          <div className="space-y-3 max-h-64 overflow-y-auto">
                            <p className="text-[9px] font-black text-zinc-400 uppercase">💬 Comentarios</p>
                            {task.comments && task.comments.length > 0 ? (
                              task.comments.map(comment => {
                                const authorResp = RESPONSIBLES.find(r => r.id === comment.authorId);
                                return (
                                  <div key={comment.id} className={`${authorResp?.bgLight || 'bg-gray-50'} rounded-xl p-2`}>
                                    <div className="flex justify-between items-start mb-1">
                                      <span className={`text-[10px] font-black ${authorResp?.color === 'blue' ? 'text-blue-700' : authorResp?.color === 'purple' ? 'text-purple-700' : 'text-green-700'}`}>👤 {comment.author}</span>
                                      <span className="text-[9px] text-zinc-400">{comment.createdAt}</span>
                                    </div>
                                    <p className="text-xs text-zinc-700">{comment.text}</p>
                                  </div>
                                );
                              })
                            ) : (
                              <div className="text-xs text-zinc-400 text-center py-2">No hay comentarios aún</div>
                            )}
                          </div>
                          <div className="mt-3 flex gap-2">
                            <input type="text" value={newComment[task.id] || ''} onChange={(e) => setNewComment(prev => ({ ...prev, [task.id]: e.target.value }))} placeholder="Escribe un comentario..." className="flex-1 bg-white border rounded-xl px-3 py-2 text-sm" onKeyPress={(e) => e.key === 'Enter' && addComment(task.id)} />
                            <button onClick={() => addComment(task.id)} className="bg-blue-600 text-white px-4 py-2 rounded-xl text-xs font-bold">Enviar</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="md:hidden space-y-3 p-2">
        {filteredTasks.length === 0 ? (
          <div className="text-center py-10 text-zinc-400">No hay tareas</div>
        ) : (
          filteredTasks.map(task => {
            const resp = RESPONSIBLES.find(r => r.id === task.responsible);
            const priorityConfig = PRIORITIES[task.priority] || PRIORITIES.media;
            const statusConfig = TASK_STATUS[task.status] || TASK_STATUS.pending;
            const isOverdue = task.dueDate && task.status !== 'approved' && new Date(task.dueDate) < new Date();
            const delayInfo = task.approvalDelayInfo;
            const isCommentsOpen = expandedComments[task.id];
            return (
              <div key={task.id} className="bg-white border rounded-xl overflow-hidden shadow-sm">
                <div className="p-4">
                  <button onClick={() => setSelectedTask(task)} className="w-full text-left">
                    <h3 className="font-black text-base">{task.title}</h3>
                    {task.description && <p className="text-xs text-zinc-500 mt-1">{task.description}</p>}
                    {task.status === 'approved' && delayInfo && <p className="text-[10px] text-orange-600 mt-1">{delayInfo.message}</p>}
                  </button>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <span className={`inline-block px-2 py-1 rounded-full text-[10px] font-black ${resp?.color === 'blue' ? 'bg-blue-100 text-blue-700' : resp?.color === 'purple' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}`}>{resp?.name}</span>
                    <span className={`inline-block px-2 py-1 rounded-full text-[10px] font-bold ${priorityConfig.color}`}>{priorityConfig.emoji} {priorityConfig.label}</span>
                    <select value={task.status} onChange={(e) => handleStatusChange(task.id, e.target.value, task.dueDate)} className={`text-[10px] font-bold rounded-full px-2 py-1 border ${statusConfig.color}`} disabled={task.status === 'approved'}>
                      {Object.entries(TASK_STATUS).map(([k,v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}
                    </select>
                  </div>
                  <div className="flex justify-between text-xs text-zinc-500 mt-3 pt-2 border-t">
                    <span>📅 {task.dueDate || '-'}</span>
                    <span>🕒 {task.createdAtFormatted || '-'}</span>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => toggleComments(task.id)} className="flex-1 bg-blue-50 text-blue-600 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1">💬 {task.comments?.length || 0}</button>
                    <button onClick={() => editTask(task)} className="flex-1 bg-indigo-50 text-indigo-600 py-2 rounded-xl text-xs font-bold">✏️</button>
                    <button onClick={() => deleteTask(task.id)} className="flex-1 bg-rose-50 text-rose-600 py-2 rounded-xl text-xs font-bold">🗑️</button>
                  </div>
                </div>
                {isCommentsOpen && (
                  <div className="bg-zinc-50/80 px-4 py-3 border-t">
                    <div className="space-y-3 max-h-64 overflow-y-auto">
                      <p className="text-[9px] font-black text-zinc-400 uppercase">💬 Comentarios</p>
                      {task.comments && task.comments.length > 0 ? (
                        task.comments.map(comment => {
                          const authorResp = RESPONSIBLES.find(r => r.id === comment.authorId);
                          return (
                            <div key={comment.id} className={`${authorResp?.bgLight || 'bg-gray-50'} rounded-xl p-2`}>
                              <div className="flex justify-between items-start mb-1">
                                <span className={`text-[10px] font-black ${authorResp?.color === 'blue' ? 'text-blue-700' : authorResp?.color === 'purple' ? 'text-purple-700' : 'text-green-700'}`}>👤 {comment.author}</span>
                                <span className="text-[9px] text-zinc-400">{comment.createdAt}</span>
                              </div>
                              <p className="text-xs text-zinc-700">{comment.text}</p>
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-xs text-zinc-400 text-center py-2">No hay comentarios aún</div>
                      )}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <input type="text" value={newComment[task.id] || ''} onChange={(e) => setNewComment(prev => ({ ...prev, [task.id]: e.target.value }))} placeholder="Escribe un comentario..." className="flex-1 bg-white border rounded-xl px-3 py-2 text-sm" onKeyPress={(e) => e.key === 'Enter' && addComment(task.id)} />
                      <button onClick={() => addComment(task.id)} className="bg-blue-600 text-white px-4 py-2 rounded-xl text-xs font-bold">Enviar</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── APP PRINCIPAL (CON LOGIN INTEGRADO Y NUEVA PESTAÑA AGENDA) ──────────────
export default function App() {
  const { user, loading } = useAuth();
  const [configs, setConfigs] = useState([]);
  const [months, setMonths] = useState([]);
  const [activeTab, setTab] = useState('dashboard');

  useEffect(() => {
    if (!user) return;
    const u1 = onSnapshot(collection(db, 'sales_configs'), snap =>
      setConfigs(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    const u2 = onSnapshot(collection(db, 'sales_months'), snap =>
      setMonths(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    return () => { u1(); u2(); };
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <p className="text-slate-400">Cargando...</p>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  const tabs = [
    { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { id: 'records', icon: ClipboardList, label: 'Cierres' },
    { id: 'config', icon: Settings, label: 'Estrategias' },
    { id: 'agenda', icon: CalendarDays, label: 'Agenda' }  // ← NUEVA
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: "'DM Sans', sans-serif", color: '#0f172a', paddingBottom: '5rem' }}>
      <header style={{ background: '#09090b', position: 'sticky', top: 0, zIndex: 40 }}>
        <div style={{ maxWidth: '72rem', margin: '0 auto', padding: '0.75rem 1rem' }}>
          <div className="flex justify-between items-center">
            <div>
              <p className="font-black italic text-emerald-400 text-sm md:text-base">Winner System 360</p>
              <p className="text-[9px] md:text-[10px] font-bold text-zinc-500 tracking-widest">Control Ventas · Contraentrega CO</p>
            </div>
            <div className="flex items-center gap-3">
              <nav className="flex gap-1 bg-white/5 p-1 rounded-xl border border-white/10">
                {tabs.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`flex items-center gap-1 md:gap-2 px-2 md:px-4 py-1.5 md:py-2 rounded-lg text-[9px] md:text-[10px] font-black uppercase tracking-wider transition-all ${activeTab === t.id ? 'bg-emerald-500 text-zinc-950' : 'text-zinc-500'}`}
                  >
                    <t.icon size={12} />
                    <span className="hidden sm:inline">{t.label}</span>
                  </button>
                ))}
              </nav>
              <button
                onClick={() => { import('./src/firebase').then(({ logout }) => logout()); }}
                className="bg-red-500/20 hover:bg-red-500/30 text-red-300 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase"
              >
                Salir
              </button>
            </div>
          </div>
        </div>
      </header>
      <main style={{ maxWidth: '72rem', margin: '0 auto', padding: '1rem 1rem 3rem' }}>
        {activeTab === 'dashboard' && <VistaDashboard configs={configs} months={months} />}
        {activeTab === 'records' && <VistaRegistro configs={configs} months={months} />}
        {activeTab === 'config' && <VistaConfig configs={configs} />}
        {activeTab === 'agenda' && <AgendaModule />}
      </main>
    </div>
  );
}


