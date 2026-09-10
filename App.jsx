import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, addDoc, setDoc, updateDoc, deleteDoc, doc, onSnapshot,
  Timestamp, serverTimestamp, query, where, writeBatch
} from 'firebase/firestore';
import {
  LayoutDashboard, ClipboardList, Settings, Plus, Trash2, Calendar,
  TrendingUp, Package, Layers, Truck, Target, Wallet, CheckCircle2,
  Calculator, Eye, Activity, Pencil, Boxes, ToggleLeft, ToggleRight,
  ChevronDown, ChevronUp, X, AlertTriangle, Save, BarChart3, Percent,
  DollarSign, Users, ShoppingBag, ArrowUpRight, ArrowDownRight, Info,
  Coffee, Moon, Award, ListChecks, CalendarDays, Power, PowerOff,
  Archive, ArchiveRestore, CircleDollarSign, FileUp, Gauge, RefreshCcw,
  Settings2, ShieldCheck, TrendingDown
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
function getConfigAtDate(configs, productId, dateStr) {
  const allVersions = configs.filter(c => c.id === productId || c.previousVersionId === productId);
  if (allVersions.length <= 1) return configs.find(c => c.id === productId);
  const date = parseColombiaDate(dateStr);
  let activeConfig = null;
  let closestValidFrom = null;
  for (const config of allVersions) {
    const validFrom = config.validFrom ? parseColombiaDate(config.validFrom) : null;
    if (!validFrom) { if (!activeConfig) activeConfig = config; continue; }
    if (validFrom <= date) {
      if (!closestValidFrom || validFrom > closestValidFrom) {
        closestValidFrom = validFrom;
        activeConfig = config;
      }
    }
  }
  return activeConfig || configs.find(c => c.id === productId);
}

function isProductActiveOnDate(product, dateStr) {
  if (!product) return false;
  const active = product.activo !== false;
  const deactivationDate = product.fechaDesactivacion ? parseColombiaDate(product.fechaDesactivacion) : null;
  const checkDate = parseColombiaDate(dateStr);
  if (!active && deactivationDate && deactivationDate <= checkDate) return false;
  return true;
}

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
    const c = getConfigAtDate(configs, r.configId, r.date);
    if (!c) return;

    const recordMonth = r.date.substring(0, 7);
    let effectiveness = parseFloat(c.effectiveness) || 95;
    let returnRate = parseFloat(c.returnRate) || 20;
    if (c.monthlyIER && Array.isArray(c.monthlyIER)) {
      const monthlyAdjust = c.monthlyIER.find(adj => adj.month === recordMonth);
      if (monthlyAdjust) {
        effectiveness = parseFloat(monthlyAdjust.effectiveness) || effectiveness;
        returnRate = parseFloat(monthlyAdjust.returnRate) || returnRate;
      }
    }
    const eff = Math.min(Math.max(effectiveness, 0), 100) / 100;
    const ret = Math.min(Math.max(returnRate, 0), 100) / 100;
    const IER = eff * (1 - ret);

    const orders = parseFloat(r.orders) || 0;
    const units = parseFloat(r.units) || 0;
    const revenue = parseFloat(r.revenue) || 0;

    const wasActive = isProductActiveOnDate(c, r.date);

    let ads = 0;
    if (wasActive) {
      ads = parseFloat(r.adSpend) > 0
        ? parseFloat(r.adSpend)
        : (c.fixedAdSpend ? parseFloat(c.dailyAdSpend) || 0 : 0);
    }

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
        fechaDesactivacion: c.fechaDesactivacion,
        fixedAdSpend: c.fixedAdSpend === true
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
  if (s.finalDeliveries > 0) {
    s.cpaReal = s.totalAds / s.finalDeliveries;
  } else if (s.totalAds > 0 && s.finalDeliveries === 0) {
    s.cpaReal = s.totalAds;
  } else {
    s.cpaReal = 0;
  }
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
  s.totalOrders = s.grossOrd;
  s.totalAdsValue = s.totalAds;

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

// ─── VISTA 1: CONFIGURACIÓN (ESTRATEGIAS) ────────────────────────────────────
const EMPTY_CONFIG = {
  vendedora: '', productName: '',
  targetProfit: '', productCost: '', freight: '', fulfillment: '',
  commission: '', returnRate: '20', effectiveness: '95',
  fixedCosts: '', priceSingle: '', dailyAdSpend: '', fixedAdSpend: true,
  extraUnitCharge: '',
  cpaEquilibrio: '',
  activo: true,
  fechaCreacion: todayColombia(),
  fechaDesactivacion: '',
  monthlyIER: [],
  permiteRegistrosResiduales: false
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

  const openNew = () => { setEditId(null); setForm({ ...EMPTY_CONFIG, fechaCreacion: todayColombia(), monthlyIER: [] }); setShowForm(true); };
  const openNewForVendor = (vendedora) => {
    setEditId(null);
    setForm({ ...EMPTY_CONFIG, vendedora, fechaCreacion: todayColombia(), monthlyIER: [] });
    setExpandedV(x => ({ ...x, [vendedora]: true }));
    setShowForm(true);
  };
  const openEdit = (p) => { setEditId(p.id); setForm({ ...p }); setShowForm(true); };
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.vendedora.trim() || !form.productName.trim()) return;
    const data = { ...form };
    if (!data.fechaCreacion) data.fechaCreacion = todayColombia();
    if (data.activo === false && !data.fechaDesactivacion) data.fechaDesactivacion = todayColombia();
    if (data.activo === true) data.fechaDesactivacion = '';
    if (editId) await updateDoc(doc(db, 'sales_configs', editId), data);
    else await addDoc(collection(db, 'sales_configs'), { ...data, createdAt: Date.now() });
    setShowForm(false);
    onSaved?.();
  };

  const remove = async (id) => {
    if (window.confirm('¿Eliminar esta estrategia?')) await deleteDoc(doc(db, 'sales_configs', id));
    onSaved?.();
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
    <div className="space-y-6 md:space-y-8 anim-fade">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-black italic uppercase tracking-tighter text-zinc-900">Estrategias</h2>
          <p className="text-xs text-slate-400 font-semibold mt-1 uppercase tracking-widest">Módulo 1 · Vendedoras y Productos</p>
        </div>
        <button onClick={openNew} className="flex items-center gap-2 bg-zinc-950 text-white px-4 md:px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-zinc-800 active:scale-95 transition-all shadow-lg"><Plus size={16} /> Nueva Vendedora + Producto</button>
      </div>

      {Object.keys(grouped).length === 0 ? (
        <Card className="text-center py-16 text-slate-300"><Users size={48} className="mx-auto mb-4 opacity-30" /><p className="font-black uppercase text-sm">Sin estrategias aún</p><p className="text-xs mt-1">Crea la primera estrategia para comenzar</p></Card>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([vendedora, productos]) => (
            <Card key={vendedora} className="overflow-hidden p-0">
              <div className="flex items-center justify-between gap-3 p-4 md:p-5 bg-white">
                <div onClick={() => toggleV(vendedora)} className="flex-1 flex items-center gap-3 cursor-pointer select-none">
                  <div className="w-8 h-8 md:w-10 md:h-10 rounded-2xl bg-emerald-500 flex items-center justify-center text-white font-black text-sm shrink-0">{vendedora[0]?.toUpperCase()}</div>
                  <div><p className="font-black text-xs md:text-sm uppercase tracking-wide">{vendedora}</p><p className="text-[10px] text-slate-400 font-semibold">{productos.length} producto{productos.length > 1 ? 's' : ''}</p></div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button type="button" onClick={(e) => { e.stopPropagation(); openNewForVendor(vendedora); }} className="flex items-center gap-1 bg-emerald-500 text-zinc-950 px-3 py-2 rounded-xl font-black text-[9px] md:text-[10px] uppercase tracking-widest hover:bg-emerald-400"><Plus size={12} /> Producto</button>
                  <button type="button" onClick={() => toggleV(vendedora)} className="p-1 rounded-xl hover:bg-slate-100 text-slate-400 transition-colors">{expandedV[vendedora] ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
                </div>
              </div>
              {expandedV[vendedora] && (
                <div className="border-t border-slate-100 divide-y divide-slate-100">
                  {[...productos].sort((a, b) => {
  const aActive = a.activo !== false;
  const bActive = b.activo !== false;
  if (aActive && !bActive) return -1;
  if (!aActive && bActive) return 1;
  return (a.productName || '').localeCompare(b.productName || '');
}).map(p => {
  const isActive = p.activo !== false;
  return (
    <div key={p.id} className={`p-4 md:p-5 flex flex-col sm:flex-row sm:items-center gap-3 transition-all ${!isActive ? 'bg-slate-100 opacity-70' : ''}`}>
      <div className="flex-1 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <p className={`font-black uppercase text-xs md:text-sm ${!isActive ? 'text-slate-500 line-through' : 'text-emerald-600'}`}>{p.productName}</p>
          {!isActive && <span className="flex items-center gap-1 text-[9px] font-black bg-red-100 text-red-600 px-2 py-0.5 rounded-full"><PowerOff size={10} /> INACTIVO</span>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[8px] md:text-[9px] font-black bg-slate-100 text-slate-500 px-2 py-1 rounded-lg uppercase">EFF {p.effectiveness}%</span>
          <span className="text-[8px] md:text-[9px] font-black bg-rose-50 text-rose-500 px-2 py-1 rounded-lg uppercase">DEV {p.returnRate}%</span>
          <span className="text-[8px] md:text-[9px] font-black bg-emerald-50 text-emerald-600 px-2 py-1 rounded-lg uppercase">IER {(parseFloat(p.effectiveness) / 100 * (1 - parseFloat(p.returnRate) / 100) * 100).toFixed(1)}%</span>
          <span className="text-[8px] md:text-[9px] font-black bg-blue-50 text-blue-500 px-2 py-1 rounded-lg uppercase">Flete {fmt(p.freight)}</span>
          {p.extraUnitCharge && parseFloat(p.extraUnitCharge) > 0 && <span className="text-[8px] md:text-[9px] font-black bg-yellow-50 text-yellow-600 px-2 py-1 rounded-lg uppercase">Extra x2+ {fmt(p.extraUnitCharge)}</span>}
          <span className="text-[8px] md:text-[9px] font-black bg-amber-50 text-amber-600 px-2 py-1 rounded-lg uppercase">Meta {fmt(p.targetProfit)}</span>
          {p.cpaEquilibrio && parseFloat(p.cpaEquilibrio) > 0 && <span className="text-[8px] md:text-[9px] font-black bg-purple-50 text-purple-600 px-2 py-1 rounded-lg uppercase">CPA Eq {fmt(p.cpaEquilibrio)}</span>}
        </div>
        <div className="grid grid-cols-3 gap-1 md:gap-2">
          <div className="text-center bg-slate-50 p-1 md:p-2 rounded-xl"><p className="text-[7px] md:text-[8px] text-slate-400 uppercase font-black">Costo Unit</p><p className="font-black text-[10px] md:text-xs text-slate-700">{fmt(p.productCost)}</p></div>
          <div className="text-center bg-slate-50 p-1 md:p-2 rounded-xl"><p className="text-[7px] md:text-[8px] text-slate-400 uppercase font-black">Comisión</p><p className="font-black text-[10px] md:text-xs text-slate-700">{fmt(p.commission)}</p></div>
          <div className="text-center bg-slate-50 p-1 md:p-2 rounded-xl"><p className="text-[7px] md:text-[8px] text-slate-400 uppercase font-black">Fijos/Ent</p><p className="font-black text-[10px] md:text-xs text-slate-700">{fmt(p.fixedCosts)}</p></div>
        </div>
        <div className="text-[8px] text-slate-400 font-mono flex gap-2 flex-wrap">
          {p.fechaCreacion && <span>📅 Creación: {parseColombiaDate(p.fechaCreacion).toLocaleDateString('es-CO')}</span>}
          {p.fechaDesactivacion && <span className="text-red-400">🔴 Desactivado: {parseColombiaDate(p.fechaDesactivacion).toLocaleDateString('es-CO')}</span>}
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={() => openEdit(p)} className="p-2 rounded-xl hover:bg-emerald-50 hover:text-emerald-600 text-slate-400 transition-colors"><Pencil size={14} /></button>
        <button onClick={() => remove(p.id)} className="p-2 rounded-xl hover:bg-rose-50 hover:text-rose-500 text-slate-400 transition-colors"><Trash2 size={14} /></button>
      </div>
    </div>
  );
})}

                  
                  <div className="p-4 bg-slate-50/60"><button onClick={() => openNewForVendor(vendedora)} className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-emerald-200 text-emerald-600 bg-white px-4 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-50"><Plus size={14} /> Agregar nuevo producto a {vendedora}</button></div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-zinc-950/90 backdrop-blur-xl flex items-center justify-center z-50 p-2 sm:p-4">
          <div className="bg-white w-full max-w-4xl rounded-2xl sm:rounded-3xl p-3 sm:p-6 md:p-8 max-h-[95vh] overflow-y-auto shadow-2xl">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-100">
              <div>
                <h3 className="text-base sm:text-xl md:text-2xl font-black italic uppercase">
                  {editId ? 'Editar' : isPrefilledVendor ? `Nuevo Producto · ${form.vendedora}` : 'Nueva'} Estrategia
                </h3>
                <p className="text-[8px] sm:text-[10px] text-slate-400 font-black uppercase tracking-widest mt-1">
                  {isPrefilledVendor ? `Agregando producto a vendedora existente` : 'Define parámetros de costo por producto'}
                </p>
              </div>
              <button onClick={() => setShowForm(false)} className="p-2 rounded-xl hover:bg-slate-100"><X size={20} /></button>
            </div>

            {isPrefilledVendor && (
              <div className="mb-4 flex items-center gap-2 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-xl">
                <div className="w-6 h-6 rounded-lg bg-emerald-500 flex items-center justify-center text-white font-black text-xs shrink-0">{form.vendedora[0]?.toUpperCase()}</div>
                <div>
                  <p className="text-[10px] font-black text-emerald-700 uppercase">{form.vendedora}</p>
                  <p className="text-[8px] text-emerald-500 font-semibold">Vendedora ya registrada · solo configura el nuevo producto</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              {!isPrefilledVendor && <InputField label="Nombre Vendedora" value={form.vendedora} onChange={e => setField('vendedora', e.target.value)} placeholder="Ej: CAMILA PEREIRA" />}
              <InputField label="Nombre Producto" value={form.productName} onChange={e => setField('productName', e.target.value)} placeholder="Ej: CEPILLO PRO X2" />
              <InputField label="Fecha de Creación" type="date" value={form.fechaCreacion} onChange={e => setField('fechaCreacion', e.target.value)} />

              <div className="bg-zinc-950 text-white p-3 sm:p-4 rounded-xl flex flex-col gap-2 sm:col-span-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {form.activo ? <Power size={16} className="text-emerald-400" /> : <PowerOff size={16} className="text-red-400" />}
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest">Estado del Producto</p>
                      <p className="text-[7px] text-zinc-400">Si lo desactivas, podrás elegir la fecha</p>
                    </div>
                  </div>
                  <button onClick={() => setField('activo', !form.activo)} className="flex items-center gap-1 text-[8px] font-black uppercase">
                    {form.activo ? <><ToggleRight size={24} className="text-emerald-400" /><span className="text-emerald-400">ACTIVO</span></> : <><ToggleLeft size={24} className="text-red-400" /><span className="text-red-400">INACTIVO</span></>}
                  </button>
                </div>
                {!form.activo && (
                  <>
                    <InputField label="Fecha de Desactivación" type="date" value={form.fechaDesactivacion} onChange={e => setField('fechaDesactivacion', e.target.value)} />
                    <div className="flex items-center justify-between bg-white/10 rounded-xl p-3">
                      <div className="flex items-center gap-2">
                        <Package size={14} className="text-yellow-400" />
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-widest">Permitir registros residuales</p>
                          <p className="text-[7px] text-zinc-400">Ventas que llegan después de la desactivación</p>
                        </div>
                      </div>
                      <button onClick={() => setField('permiteRegistrosResiduales', !form.permiteRegistrosResiduales)} className="flex items-center gap-1 text-[8px] font-black uppercase">
                        {form.permiteRegistrosResiduales ? <><ToggleRight size={22} className="text-emerald-400" /><span className="text-emerald-400">SÍ</span></> : <><ToggleLeft size={22} className="text-zinc-500" /><span className="text-zinc-500">NO</span></>}
                      </button>
                    </div>
                  </>
                )}
              </div>

              <div className="bg-emerald-50 border border-emerald-100 p-3 rounded-xl space-y-1">
                <Label className="text-emerald-700 text-[9px]">% Efectividad</Label>
                <input type="number" value={form.effectiveness} onChange={e => setField('effectiveness', e.target.value)} className="w-full bg-transparent font-black text-2xl text-emerald-800 outline-none" />
                <p className="text-[7px] text-emerald-600 font-semibold">Pedidos que salen</p>
              </div>

              <div className="bg-rose-50 border border-rose-100 p-3 rounded-xl space-y-1">
                <Label className="text-rose-600 text-[9px]">% Devolución</Label>
                <input type="number" value={form.returnRate} onChange={e => setField('returnRate', e.target.value)} className="w-full bg-transparent font-black text-2xl text-rose-700 outline-none" />
                <p className="text-[7px] text-rose-500 font-semibold">Del despachado, % que regresa</p>
              </div>

              <div className="bg-zinc-950 text-white p-3 rounded-xl flex flex-col sm:flex-row justify-between items-center gap-2 sm:col-span-2">
                <div>
                  <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Índice de Efectividad Real (IER)</p>
                  <p className="text-[8px] text-zinc-400">De cada 100 pedidos, ¿cuántos se pagan?</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-black font-mono text-emerald-400">{((parseFloat(form.effectiveness) || 95) / 100 * (1 - (parseFloat(form.returnRate) || 20) / 100) * 100).toFixed(1)}%</p>
                </div>
              </div>

              <InputField label="Precio Venta (1 und)" type="number" value={form.priceSingle} onChange={e => setField('priceSingle', e.target.value)} placeholder="Ej: 79000" />
              <InputField label="Costo Unitario Producto" type="number" value={form.productCost} onChange={e => setField('productCost', e.target.value)} placeholder="Ej: 18000" />
              <InputField label="Flete Base por Guía" type="number" value={form.freight} onChange={e => setField('freight', e.target.value)} placeholder="Ej: 9500" />
              <InputField label="Cargo extra x unidad adicional" type="number" value={form.extraUnitCharge} onChange={e => setField('extraUnitCharge', e.target.value)} placeholder="Ej: 5000" />
              <InputField label="Fulfillment por guía" type="number" value={form.fulfillment} onChange={e => setField('fulfillment', e.target.value)} placeholder="Ej: 1500" />
              <InputField label="Comisión por Entrega" type="number" value={form.commission} onChange={e => setField('commission', e.target.value)} placeholder="Ej: 3000" />
              <InputField label="Costos Fijos x Entrega" type="number" value={form.fixedCosts} onChange={e => setField('fixedCosts', e.target.value)} placeholder="Ej: 2000" />
              <InputField label="Meta Utilidad Mensual" type="number" value={form.targetProfit} onChange={e => setField('targetProfit', e.target.value)} placeholder="Ej: 4000000" />
              <InputField label="CPA Equilibrio (por pedido)" type="number" value={form.cpaEquilibrio} onChange={e => setField('cpaEquilibrio', e.target.value)} placeholder="Ej: 15000" />

              <div className="bg-zinc-950 text-white p-3 rounded-xl space-y-2 sm:col-span-2">
                <div className="flex justify-between items-center">
                  <Label className="text-zinc-500 text-[9px]">Inversión Ads Diaria</Label>
                  <button onClick={() => setField('fixedAdSpend', !form.fixedAdSpend)} className="flex items-center gap-1 text-[8px] font-black uppercase">
                    {form.fixedAdSpend ? <><ToggleRight size={20} className="text-emerald-400" /><span className="text-emerald-400">FIJA</span></> : <><ToggleLeft size={20} className="text-zinc-500" /><span className="text-zinc-500">MANUAL</span></>}
                  </button>
                </div>
                <input type="number" value={form.dailyAdSpend} onChange={e => setField('dailyAdSpend', e.target.value)} placeholder="$ 0" className="w-full bg-transparent text-emerald-400 font-black text-xl outline-none placeholder:text-zinc-700" />
                <p className="text-[7px] text-zinc-600 font-semibold">
                  {form.fixedAdSpend ? '✓ FIJA: Se aplica automáticamente a cada registro diario' : '⚠ MANUAL: Debes ingresar el valor en cada cierre diario'}
                </p>
              </div>

              {form.priceSingle && form.productCost && (
                <div className={`p-3 rounded-xl border-2 ${previewProfit >= 0 ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'} sm:col-span-2`}>
                  <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mb-1">Preview Utilidad Estimada por Pedido Registrado</p>
                  <p className={`text-xl md:text-2xl font-black font-mono ${previewProfit >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{fmt(previewProfit)}</p>
                  <p className="text-[7px] text-slate-400 mt-1">Aplicando IER, fletes y todos los costos</p>
                </div>
              )}

              <div className="sm:col-span-2 border-t border-slate-200 pt-3 mt-1">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                  <Label className="text-slate-600 text-[9px] flex items-center gap-1">📅 Ajustes mensuales (Efectividad/Devolución)</Label>
                  <button type="button" onClick={() => {
                    const newMonth = prompt("Ingrese el mes (formato YYYY-MM, ej: 2025-04):");
                    if (newMonth && /^\d{4}-\d{2}$/.test(newMonth)) {
                      const current = form.monthlyIER || [];
                      if (!current.find(a => a.month === newMonth)) {
                        setForm(prev => ({ ...prev, monthlyIER: [...current, { month: newMonth, effectiveness: prev.effectiveness, returnRate: prev.returnRate }] }));
                      } else alert("Ya existe un ajuste para ese mes");
                    } else if (newMonth) alert("Formato inválido. Use YYYY-MM");
                  }} className="text-[8px] font-black bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full flex items-center justify-center gap-1">
                    <Plus size={10} /> Agregar mes
                  </button>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {(form.monthlyIER && form.monthlyIER.length > 0) ? (
                    form.monthlyIER.map((adj, idx) => (
                      <div key={idx} className="flex flex-wrap items-center gap-2 bg-slate-50 p-2 rounded-xl">
                        <span className="text-[9px] font-black bg-slate-200 px-2 py-1 rounded-lg w-16 text-center">{adj.month}</span>
                        <input type="number" value={adj.effectiveness} onChange={(e) => { const newAdj = [...form.monthlyIER]; newAdj[idx].effectiveness = e.target.value; setForm(prev => ({ ...prev, monthlyIER: newAdj })); }} className="flex-1 min-w-[70px] px-2 py-1 rounded-lg text-xs bg-white border" placeholder="Eff %" />
                        <input type="number" value={adj.returnRate} onChange={(e) => { const newAdj = [...form.monthlyIER]; newAdj[idx].returnRate = e.target.value; setForm(prev => ({ ...prev, monthlyIER: newAdj })); }} className="flex-1 min-w-[70px] px-2 py-1 rounded-lg text-xs bg-white border" placeholder="Ret %" />
                        <button onClick={() => { const newAdj = form.monthlyIER.filter((_, i) => i !== idx); setForm(prev => ({ ...prev, monthlyIER: newAdj })); }} className="text-rose-500 hover:text-rose-700 p-1"><Trash2 size={12} /></button>
                      </div>
                    ))
                  ) : (
                    <p className="text-[8px] text-slate-400 text-center py-2">Sin ajustes mensuales. Se usarán los valores base.</p>
                  )}
                </div>
                <p className="text-[7px] text-slate-400 mt-2">💡 Los ajustes mensuales sobrescriben la efectividad y devolución para ese mes completo.</p>
              </div>
            </div>

            <button onClick={save} disabled={!form.vendedora.trim() || !form.productName.trim()} className="w-full mt-5 bg-emerald-500 text-zinc-950 py-3 rounded-xl font-black uppercase tracking-widest text-xs hover:bg-emerald-400 active:scale-95 disabled:opacity-30 flex items-center justify-center gap-2"><Save size={16} /> {editId ? 'Actualizar Estrategia' : isPrefilledVendor ? `Agregar Producto a ${form.vendedora}` : 'Guardar Estrategia'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── VISTA 2: REGISTRO DIARIO (CIERRES) ──────────────────────────────────────
function VistaRegistro({ configs, months, activeTab }) {
  const [selectedDate, setSelectedDate] = useState(todayColombia());
  const [selectedVendor, setSelectedVendor] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [form, setForm] = useState({ orders: '', units: '', revenue: '', adSpend: '', restDay: false });
  const [editingRec, setEditingRec] = useState(null);
  const [savedMsg, setSavedMsg] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [filterVendor, setFilterVendor] = useState('all');
  const [mostrarInactivos, setMostrarInactivos] = useState(false);

  const grouped = useMemo(() => configs.reduce((a, c) => {
    if (!a[c.vendedora]) a[c.vendedora] = [];
    a[c.vendedora].push(c);
    return a;
  }, {}), [configs]);
  const vendors = useMemo(() => Object.keys(grouped).sort(), [grouped]);

  const productsOfVendor = useMemo(() => {
    if (!selectedVendor) return [];
    const productos = grouped[selectedVendor] || [];
    const fechaRegistro = selectedDate;
    const activosEnFecha = [];
    const residuales = [];
    productos.forEach(p => {
      if (p.fechaCreacion && p.fechaCreacion > fechaRegistro) return;
      const estabaActivo = isProductActiveOnDate(p, fechaRegistro);
      if (estabaActivo) activosEnFecha.push(p);
      else if (p.permiteRegistrosResiduales === true) residuales.push({ ...p, esResidual: true });
    });
    if (mostrarInactivos) return [...activosEnFecha, ...residuales];
    return activosEnFecha;
  }, [selectedVendor, grouped, selectedDate, mostrarInactivos]);

  const selectedConfig = useMemo(() => selectedProductId ? configs.find(c => c.id === selectedProductId) : null, [selectedProductId, configs]);
  const extraUnitCharge = parseFloat(selectedConfig?.extraUnitCharge) || 0;

  const monthId = selectedDate.substring(0, 7);
  const monthDoc = months.find(m => m.id === monthId);
  const dayRecords = useMemo(() => (monthDoc?.records || []).filter(r => r.date === selectedDate), [monthDoc, selectedDate]);

  const summary = useMemo(() => {
    let activeProducts = [];
    const filterFn = (c) => {
      const fechaCreacion = c.fechaCreacion ? parseColombiaDate(c.fechaCreacion) : null;
      const fechaCierre = parseColombiaDate(selectedDate);
      if (fechaCreacion && fechaCreacion > fechaCierre) return false;
      if (c.activo === false && c.fechaDesactivacion && parseColombiaDate(c.fechaDesactivacion) <= fechaCierre) return false;
      return true;
    };
    if (filterVendor === 'all') activeProducts = configs.filter(filterFn);
    else activeProducts = configs.filter(c => c.vendedora === filterVendor && filterFn(c));
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
    const hoy = todayColombia();
    const allDates = [];
    let current = parseColombiaDate(maxDate);
    const end = parseColombiaDate(hoy);
    while (current <= end) {
      const year = current.getFullYear();
      const month = String(current.getMonth() + 1).padStart(2, '0');
      const day = String(current.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      if (!fechasConRegistros.has(dateStr) && dateStr !== maxDate) allDates.push(dateStr);
      current.setDate(current.getDate() + 1);
    }
    return {
      ultimoDia: maxDate,
      diasFaltantes: allDates.map(d => ({ fecha: d, nombre: parseColombiaDate(d).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' }) }))
    };
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
    if (!selectedVendor || !selectedProductId) { alert("Debes seleccionar una vendedora y un producto."); return; }
    if (!editingRec) {
      const exists = dayRecords.some(r => r.configId === selectedProductId);
      if (exists) {
        const config = configs.find(c => c.id === selectedProductId);
        setErrorMsg(`❌ Ya existe un registro para ${config?.vendedora || selectedVendor} - ${config?.productName || 'Desconocido'} en esta fecha. Puedes editarlo o eliminarlo.`);
        return;
      }
    }
    let orders = form.orders, units = form.units, revenue = form.revenue, adSpend = form.adSpend;
    if (selectedConfig?.fixedAdSpend) adSpend = selectedConfig.dailyAdSpend || "0";
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
    const rec = { configId: selectedProductId, orders, units, revenue, adSpend, date: selectedDate, id: editingRec?.id || Date.now().toString(), savedAt: Date.now(), restDay: form.restDay };
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

  const avgUnits = (!form.restDay && form.orders && form.units && parseFloat(form.orders) > 0) ? (parseFloat(form.units) / parseFloat(form.orders)).toFixed(2) : null;
  const extraPerGuide = avgUnits && parseFloat(avgUnits) > 1 && extraUnitCharge > 0 ? (parseFloat(avgUnits) - 1) * extraUnitCharge : 0;

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
            <div className="flex items-start gap-3"><CalendarDays size={18} className="mt-0.5 flex-shrink-0" /><div>
              <p className="text-[9px] md:text-[10px] font-black uppercase tracking-widest opacity-70">Último día registrado</p>
              <p className="font-black text-xs md:text-base">{parseColombiaDate(ultimoDia).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' })}</p>
              <p className="text-[8px] md:text-[9px] font-semibold mt-1">{diferenciaDias === 0 && ' ✅ Hoy ya hay actividad.'}{diferenciaDias === 1 && ' ⚠️ Ayer fue el último día. Hoy aún no hay registros.'}{diferenciaDias > 1 && ` ❗ Han pasado ${diferenciaDias} días sin registrar.`}</p>
            </div></div>
            {diasFaltantes.length > 0 && <div className="bg-white/80 rounded-xl p-2 max-h-32 overflow-y-auto text-[10px] w-full md:w-auto"><p className="font-black uppercase text-[8px] flex items-center gap-1"><ListChecks size={10} /> Días sin registrar:</p><ul className="mt-1 space-y-0.5">{diasFaltantes.slice(0, 4).map(d => <li key={d.fecha} className="text-[9px]">📅 {d.nombre}</li>)}{diasFaltantes.length > 4 && <li className="text-[8px] text-amber-600">... y {diasFaltantes.length - 4} más</li>}</ul></div>}
          </div>
        </div>
      )}

      <Card className={`space-y-4 md:space-y-5 ${editingRec ? 'border-2 border-amber-400' : ''}`}>
        {editingRec && <div className="flex items-center gap-2 text-amber-600 text-[10px] font-black uppercase bg-amber-50 px-3 py-2 rounded-xl"><Pencil size={12} /> Editando registro · <button onClick={cancelEdit} className="text-slate-500 underline ml-auto">Cancelar</button></div>}
        {errorMsg && <div className="flex items-center gap-2 text-rose-600 text-[10px] font-black uppercase bg-rose-50 px-3 py-2 rounded-xl border border-rose-200"><AlertTriangle size={12} /> {errorMsg}</div>}

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
        <div className="space-y-1.5"><Label>Producto</Label><select value={selectedProductId} onChange={(e) => handleProductChange(e.target.value)} disabled={!selectedVendor || !!editingRec} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 font-semibold text-sm outline-none focus:border-emerald-400 disabled:bg-slate-100"><option value="">Seleccionar producto...</option>{productsOfVendor.map(p => <option key={p.id} value={p.id} className={p.esResidual ? 'text-red-500 line-through' : ''}>{p.productName} {p.esResidual && '(INACTIVO - residual)'}</option>)}</select>{editingRec && <p className="text-[8px] text-amber-600 mt-1">⚠ No puedes cambiar vendedora ni producto mientras editas.</p>}</div>

        <div className="flex items-center gap-2 mt-2 mb-2"><input type="checkbox" id="mostrarInactivos" checked={mostrarInactivos} onChange={(e) => setMostrarInactivos(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-500" /><label htmlFor="mostrarInactivos" className="text-[10px] font-black uppercase text-slate-500">📦 Mostrar productos inactivos (ventas residuales)</label></div>

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

      {summary.totalActive > 0 && (
        <Card className={`p-3 text-center ${summary.missing === 0 ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
          <div className="flex items-center justify-center gap-2"><CheckCircle2 size={16} className={summary.missing === 0 ? 'text-green-600' : 'text-amber-600'} /><span className="text-[11px] font-black uppercase tracking-wider">{summary.missing === 0 ? '✅ TODOS LOS PRODUCTOS ACTIVOS REGISTRADOS' : `⚠️ FALTAN ${summary.missing} PRODUCTO${summary.missing !== 1 ? 'S' : ''} POR REGISTRAR`}</span></div>
          <p className="text-[10px] font-semibold mt-1">Registrados hoy: <strong>{summary.registeredActive}</strong> de <strong>{summary.totalActive}</strong> productos activos en esta fecha</p>
        </Card>
      )}

      {dayRecords.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Registros del día</p><select value={filterVendor} onChange={(e) => setFilterVendor(e.target.value)} className="text-[10px] font-black uppercase bg-white border border-slate-200 rounded-xl px-3 py-1.5 outline-none focus:border-emerald-400"><option value="all">TODAS LAS VENDEDORAS</option>{Array.from(recordsByVendor.keys()).sort().map(v => <option key={v} value={v}>{v.toUpperCase()}</option>)}</select></div>
          {filteredDayRecords.length === 0 ? <Card className="text-center py-8 text-slate-400 text-[10px]">No hay registros para la vendedora seleccionada en esta fecha.</Card> : <div className="space-y-2">{filteredDayRecords.map(r => {
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
                  <div className="flex flex-wrap items-center gap-1"><span className="font-black text-emerald-600 text-xs">{c?.vendedora}</span><span className="text-slate-300">·</span><span className="font-semibold text-xs">{c?.productName}</span>{r.restDay && <span className="text-[8px] font-black bg-amber-100 text-amber-700 px-1 rounded-full"><Moon size={8} /> DESCANSO</span>}</div>
                  <div className="flex flex-wrap gap-1 mt-1"><span className="text-[8px] font-black bg-slate-100 px-1.5 py-0.5 rounded">{r.orders} guías</span><span className="text-[8px] font-black bg-slate-100 px-1.5 py-0.5 rounded">{r.units} unid</span><span className="text-[8px] font-black bg-emerald-50 px-1.5 py-0.5 rounded">{fmtN(deliveries)} entregas</span><span className="text-[8px] font-black bg-blue-50 px-1.5 py-0.5 rounded">{fmtN(unitsDelivered)} prod.</span><span className="text-[8px] font-black bg-zinc-100 px-1.5 py-0.5 rounded">{fmt(r.revenue)}</span></div>
                </div>
                <div className="flex gap-1 justify-end"><button onClick={() => startEdit(r)} className="p-1.5 rounded hover:bg-amber-50"><Pencil size={12} /></button><button onClick={() => deleteRec(r.id)} className="p-1.5 rounded hover:bg-rose-50"><Trash2 size={12} /></button></div>
              </Card>
            );
          })}</div>}
        </div>
      )}
    </div>
  );
}

// ─── VISTA 3: DASHBOARD (CORREGIDO) ─────────────────────────────────────────
function VistaDashboard({ configs, months }) {
  const [filter, setFilter] = useState({ startDate: todayColombia(), endDate: todayColombia() });
  const [selectedVendors, setSelectedVendors] = useState([]);
  const [selectedProductsByVendor, setSelectedProductsByVendor] = useState({});

  useEffect(() => {
    const savedStartDate = localStorage.getItem('dashboard_filters_startDate');
    const savedEndDate = localStorage.getItem('dashboard_filters_endDate');
    const savedVendors = localStorage.getItem('dashboard_selectedVendors');
    const savedProducts = localStorage.getItem('dashboard_selectedProductsByVendor');
    if (savedStartDate) setFilter(f => ({ ...f, startDate: savedStartDate }));
    if (savedEndDate) setFilter(f => ({ ...f, endDate: savedEndDate }));
    if (savedVendors) setSelectedVendors(JSON.parse(savedVendors));
    if (savedProducts) setSelectedProductsByVendor(JSON.parse(savedProducts));
  }, []);

  useEffect(() => {
    localStorage.setItem('dashboard_filters_startDate', filter.startDate);
    localStorage.setItem('dashboard_filters_endDate', filter.endDate);
    localStorage.setItem('dashboard_selectedVendors', JSON.stringify(selectedVendors));
    localStorage.setItem('dashboard_selectedProductsByVendor', JSON.stringify(selectedProductsByVendor));
  }, [filter.startDate, filter.endDate, selectedVendors, selectedProductsByVendor]);

  const getProductsWithRecordsInRange = useMemo(() => {
    const productsMap = new Map();
    const allRecords = months.flatMap(m => m.records || []);
    const startDate = filter.startDate;
    const endDate = filter.endDate;
    allRecords.forEach(record => {
      if (record.date < startDate || record.date > endDate) return;
      const config = configs.find(c => c.id === record.configId);
      if (!config) return;
      const vendor = config.vendedora;
      if (!productsMap.has(vendor)) productsMap.set(vendor, new Map());
      if (!productsMap.get(vendor).has(config.id)) productsMap.get(vendor).set(config.id, config);
    });
    const result = new Map();
    for (const [vendor, productMap] of productsMap.entries()) result.set(vendor, Array.from(productMap.values()));
    return result;
  }, [months, configs, filter.startDate, filter.endDate]);

  const availableVendors = useMemo(() => Array.from(getProductsWithRecordsInRange.keys()).sort(), [getProductsWithRecordsInRange]);

  const filteredRecords = useMemo(() => {
    const all = months.flatMap(m => m.records || []);
    return all.filter(r => {
      const c = configs.find(x => x.id === r.configId);
      if (!c) return false;
      if (r.date < filter.startDate || r.date > filter.endDate) return false;
      if (selectedVendors.length > 0 && !selectedVendors.includes(c.vendedora)) return false;
      const vendorProducts = selectedProductsByVendor[c.vendedora];
      if (vendorProducts && vendorProducts.length > 0 && !vendorProducts.includes(r.configId)) return false;
      return true;
    });
  }, [months, configs, filter.startDate, filter.endDate, selectedVendors, selectedProductsByVendor]);

  const { targetProfit, cantidadProductos } = useMemo(() => {
    const productIds = new Set();
    filteredRecords.forEach(r => productIds.add(r.configId));
    let totalMetas = 0;
    for (const pid of productIds) {
      const producto = configs.find(c => c.id === pid);
      if (producto) totalMetas += parseFloat(producto.targetProfit) || 0;
    }
    return { targetProfit: totalMetas, cantidadProductos: productIds.size };
  }, [filteredRecords, configs]);

  useEffect(() => {
    const newSelected = {};
    for (const vendor of selectedVendors) {
      const availableProducts = getProductsWithRecordsInRange.get(vendor) || [];
      const currentSelected = selectedProductsByVendor[vendor] || [];
      const validSelected = currentSelected.filter(pid => availableProducts.some(p => p.id === pid));
      if (validSelected.length > 0) newSelected[vendor] = validSelected;
    }
    setSelectedProductsByVendor(newSelected);
  }, [filter.startDate, filter.endDate, getProductsWithRecordsInRange, selectedVendors]);

  const setF = (k, v) => setFilter(f => ({ ...f, [k]: v }));

  const [openSections, setOpenSections] = useState({
    embudo: false, costos: false, ranking: false, proyeccion: false,
    analisisProductos: false, comparativaVendedoras: false, productosRevision: true
  });
  const toggleSection = (section) => setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));

  const stats = useMemo(() => calcularStats(filteredRecords, configs), [filteredRecords, configs]);

  // Días activos corregidos
  const activeDays = useMemo(() => {
    const activeRecords = filteredRecords.filter(r => {
      if (r.restDay) return false;
      const orders = parseFloat(r.orders) || 0;
      if (orders > 0) return true;
      const producto = configs.find(c => c.id === r.configId);
      if (producto?.fixedAdSpend === true) return true;
      const ads = parseFloat(r.adSpend) || 0;
      return ads > 0;
    });
    const uniqueDates = new Set(activeRecords.map(r => r.date));
    return uniqueDates.size;
  }, [filteredRecords, configs]);

  const avgDiario = activeDays > 0 ? stats.net / activeDays : 0;
  const proyeccion30 = avgDiario * 30;

  let semaforo = { color: 'bg-rose-500', texto: 'REVISIÓN', emoji: '🔴', textColor: 'text-rose-500' };
  const umbralExcelente = cantidadProductos * 1_000_000;
  if (proyeccion30 >= umbralExcelente) semaforo = { color: 'bg-emerald-500', texto: 'EXCELENTE', emoji: '🟢', textColor: 'text-emerald-500' };
  else if (proyeccion30 >= targetProfit && targetProfit > 0) semaforo = { color: 'bg-blue-500', texto: 'BIEN', emoji: '🔵', textColor: 'text-blue-500' };

  let cpaColor = '', cpaMensaje = '';
  if (stats.cpaReal > stats.cpaEquilibrioPonderado) { cpaColor = 'bg-red-100 border-red-500 text-red-700'; cpaMensaje = '⚠️ CPA por encima del equilibrio → No rentable'; }
  else if (stats.cpaReal <= stats.cpaEquilibrioPonderado * 0.75) { cpaColor = 'bg-green-100 border-green-500 text-green-700'; cpaMensaje = '🚀 CPA excelente (25%+ por debajo) → ESCALAR'; }
  else { cpaColor = 'bg-yellow-100 border-yellow-500 text-yellow-700'; cpaMensaje = '✅ CPA por debajo del equilibrio → Rentable'; }

  const costItems = [
    { label: 'Costo de Mercancía', value: stats.productCostTotal, note: `${fmtN(stats.unitsDeliveredReal)} unid. entregadas`, icon: Package },
    { label: 'Fletes Totales', value: stats.totalFreightCost, note: 'Incluye cargos extra', icon: Truck },
    { label: 'Fulfillment', value: stats.totalFulfillment, note: 'Por guía despachada', icon: Boxes },
    { label: 'Comisiones', value: stats.totalCommissions, note: 'Solo entregas exitosas', icon: DollarSign },
    { label: 'Costos Fijos', value: stats.totalFixedCosts, note: 'Prorrateo por entrega', icon: Activity },
    { label: 'Publicidad', value: stats.totalAds, note: 'Meta Ads', icon: Target }
  ];
  const totalCostos = costItems.reduce((s, i) => s + i.value, 0);

  // PRODUCTOS EN REVISIÓN (con días activos corregidos)
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
          isActive: config.activo !== false,
          fixedAdSpend: config.fixedAdSpend === true,
          records: []
        });
      }
      productosMap.get(record.configId).records.push(record);
    });
    const resultados = [];
    for (const [configId, producto] of productosMap) {
      const { records, vendedora, productName, targetProfit, isActive, fixedAdSpend } = producto;
      const statsProd = calcularStats(records, configs);
      // Días activos del producto con la misma regla
      const activeRecords = records.filter(r => {
        if (r.restDay) return false;
        const orders = parseFloat(r.orders) || 0;
        if (orders > 0) return true;
        if (fixedAdSpend) return true;
        const ads = parseFloat(r.adSpend) || 0;
        return ads > 0;
      });
      const activeDaysProd = new Set(activeRecords.map(r => r.date)).size;
      const avgDiarioProd = activeDaysProd > 0 ? statsProd.net / activeDaysProd : 0;
      const proyeccion30Prod = avgDiarioProd * 30;
      let estado = { texto: 'REVISIÓN', emoji: '🔴', color: 'bg-rose-500', textColor: 'text-rose-500' };
      if (proyeccion30Prod >= 1_000_000) estado = { texto: 'EXCELENTE', emoji: '🟢', color: 'bg-emerald-500', textColor: 'text-emerald-500' };
      else if (proyeccion30Prod >= targetProfit && targetProfit > 0) estado = { texto: 'BIEN', emoji: '🔵', color: 'bg-blue-500', textColor: 'text-blue-500' };
      if (estado.texto === 'REVISIÓN') {
        resultados.push({
          configId, vendedora, productName, targetProfit,
          proyeccion30: proyeccion30Prod, avgDiario: avgDiarioProd,
          utilidadPeriodo: statsProd.net, ier: statsProd.ierGlobal, roas: statsProd.roas,
          cpaReal: statsProd.cpaReal,
          cpaEquilibrio: parseFloat(configs.find(c => c.id === configId)?.cpaEquilibrio) || 0,
          pedidos: statsProd.grossOrd, entregas: statsProd.finalDeliveries,
          diasActivos: activeDaysProd, estado, isActive
        });
      }
    }
    const activos = resultados.filter(p => p.isActive).sort((a, b) => a.proyeccion30 - b.proyeccion30);
    const inactivos = resultados.filter(p => !p.isActive).sort((a, b) => a.proyeccion30 - b.proyeccion30);
    return [...activos, ...inactivos];
  }, [filteredRecords, configs, targetProfit]);

  const SectionHeader = ({ title, icon: Icon, section, totalItems = null }) => (
    <button onClick={() => toggleSection(section)} className="w-full flex items-center justify-between py-2 px-3 md:py-3 md:px-4 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors">
      <div className="flex items-center gap-1.5 md:gap-2"><Icon size={14} className="text-emerald-600" /><span className="text-[10px] md:text-xs font-black uppercase tracking-widest text-slate-700">{title}</span>{totalItems !== null && totalItems > 0 && <span className="text-[8px] md:text-[9px] font-black bg-slate-300 text-slate-700 px-1.5 py-0.5 rounded-full">{totalItems}</span>}</div>
      {openSections[section] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
    </button>
  );

  return (
    <div className="space-y-6 md:space-y-8 anim-fade">
      <div><h2 className="text-2xl md:text-3xl font-black italic uppercase tracking-tighter">Dashboard General</h2><p className="text-[10px] md:text-xs text-slate-400 font-black uppercase tracking-widest mt-1">Módulo 3 · Análisis de Rendimiento</p></div>

      <Card className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1"><Label><Calendar size={10} className="inline mr-1" />Desde</Label><input type="date" value={filter.startDate} onChange={e => setF('startDate', e.target.value)} className="w-full px-3 py-2 bg-slate-50 rounded-xl font-bold text-sm outline-none" /></div>
          <div className="space-y-1"><Label><Calendar size={10} className="inline mr-1" />Hasta</Label><input type="date" value={filter.endDate} onChange={e => setF('endDate', e.target.value)} className="w-full px-3 py-2 bg-slate-50 rounded-xl font-bold text-sm outline-none" /></div>
        </div>
        <div className="space-y-2"><Label>Vendedoras (múltiple)</Label><div className="flex flex-wrap gap-2">{availableVendors.map(v => (<button key={v} onClick={() => { if (selectedVendors.includes(v)) { setSelectedVendors(selectedVendors.filter(vv => vv !== v)); const ns = { ...selectedProductsByVendor }; delete ns[v]; setSelectedProductsByVendor(ns); } else { setSelectedVendors([...selectedVendors, v]); } }} className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase transition-all ${selectedVendors.includes(v) ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-600'}`}>{v}</button>))}</div></div>
        {selectedVendors.length > 0 && (<div className="space-y-3 border-t pt-3"><Label>Productos con registros en el período (inactivos se muestran tachados)</Label>{selectedVendors.map(vendor => { const productsForVendor = getProductsWithRecordsInRange.get(vendor) || []; return (<div key={vendor} className="bg-slate-50 p-3 rounded-xl"><p className="text-[9px] font-black uppercase mb-2">{vendor}</p><div className="flex flex-wrap gap-1"><button onClick={() => setSelectedProductsByVendor(prev => ({ ...prev, [vendor]: productsForVendor.map(p => p.id) }))} className="text-[8px] font-black bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full">Todos</button><button onClick={() => { const ns = { ...selectedProductsByVendor }; delete ns[vendor]; setSelectedProductsByVendor(ns); }} className="text-[8px] font-black bg-red-100 text-red-700 px-2 py-1 rounded-full">Ninguno</button>{productsForVendor.map(product => { const isActiveNow = product.activo !== false; return (<button key={product.id} onClick={() => { const curr = selectedProductsByVendor[vendor] || []; if (curr.includes(product.id)) setSelectedProductsByVendor(prev => ({ ...prev, [vendor]: curr.filter(id => id !== product.id) })); else setSelectedProductsByVendor(prev => ({ ...prev, [vendor]: [...curr, product.id] })); }} className={`text-[8px] font-black px-2 py-1 rounded-full flex items-center gap-1 transition-all ${(selectedProductsByVendor[vendor] || []).includes(product.id) ? 'bg-blue-500 text-white' : isActiveNow ? 'bg-white border border-slate-300 text-slate-600' : 'bg-gray-200 border border-gray-400 text-gray-500 line-through'}`}>{!isActiveNow && <PowerOff size={10} />}{product.productName}{!isActiveNow && <span className="text-[6px] font-black ml-1">(inactivo)</span>}</button>); })}</div><p className="text-[7px] text-slate-400 mt-2">* Productos inactivos visibles para revisar su historial en el rango seleccionado.</p></div>); })}</div>)}
        <div className="col-span-2 flex flex-wrap items-center gap-1 bg-slate-50 px-3 py-2 rounded-xl"><Info size={12} className="text-slate-400 shrink-0" /><p className="text-[8px] md:text-[9px] font-black text-slate-400">Analizando <span className="text-emerald-600">{activeDays} día{activeDays !== 1 ? 's' : ''} activo{activeDays !== 1 ? 's' : ''}</span> (excluye descansos) · Proyección a 30 días = promedio diario × 30</p></div>
        <div className="col-span-2 flex justify-end mt-2"><button onClick={() => { localStorage.removeItem('dashboard_filters_startDate'); localStorage.removeItem('dashboard_filters_endDate'); localStorage.removeItem('dashboard_selectedVendors'); localStorage.removeItem('dashboard_selectedProductsByVendor'); window.location.reload(); }} className="w-full sm:w-auto text-[10px] sm:text-[9px] font-black bg-red-100 text-red-600 px-3 py-2 sm:py-1.5 rounded-full hover:bg-red-200 transition-colors flex items-center justify-center gap-1"><span>🗑️</span> Resetear filtros guardados</button></div>
      </Card>

      {filteredRecords.length === 0 || activeDays === 0 ? <Card className="text-center py-12 text-slate-300"><BarChart3 size={32} className="mx-auto mb-3 opacity-30" /><p className="font-black uppercase text-sm">Sin datos activos en este rango</p></Card> : (<>
        <div className={`rounded-xl p-3 md:p-5 border-2 ${cpaColor} shadow-md`}>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
            <div><Label className="text-inherit opacity-70">CPA REAL PROMEDIO</Label><p className="text-xl md:text-3xl font-black font-mono">{fmt(stats.cpaReal)}</p><p className="text-[8px] md:text-[9px] font-semibold">Costo por adquisición real</p></div>
            <div className="text-center"><Label className="text-inherit opacity-70">CPA EQUILIBRIO PONDERADO</Label>{stats.totalOrders === 0 && stats.totalAdsValue > 0 ? (<div className="flex flex-col items-center"><p className="text-lg md:text-2xl font-black font-mono text-amber-600">N/A</p><p className="text-[8px] md:text-[9px] font-semibold text-amber-600">⚠️ Sin pedidos en el período</p></div>) : (<><p className="text-lg md:text-2xl font-black font-mono">{fmt(stats.cpaEquilibrioPonderado)}</p><p className="text-[8px] md:text-[9px] font-semibold">Basado en cada producto</p></>)}</div>
            <div className="text-right"><div className="inline-block px-2 py-1 rounded-lg bg-white/50 backdrop-blur-sm"><p className="text-[8px] md:text-[10px] font-black">{cpaMensaje}</p></div></div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
          <Card className="border-l-4 border-l-slate-400"><Label>💰 Recaudo Bruto Total</Label><p className="text-xl md:text-3xl font-black">{fmt(stats.grossRev)}</p></Card>
          <Card className="bg-amber-50 border-l-4 border-l-amber-400"><Label>⚠ Ajuste por IER</Label><p className="text-xl md:text-3xl font-black text-amber-600">- {fmt(stats.grossRev - stats.realRev)}</p></Card>
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
        <div className="space-y-2"><SectionHeader title="EMBUDO OPERATIVO Y PRODUCTOS" icon={Activity} section="embudo" />{openSections.embudo && (<Card><div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-4"><div><Label>Pedidos Registrados</Label><p className="text-xl font-black">{fmtN(stats.grossOrd)}</p><p className="text-[8px]">{fmtN(stats.grossUnits)} unidades</p></div><div><Label>Guías Despachadas</Label><p className="text-xl font-black text-blue-600">{fmtN(stats.realShipped)}</p></div><div><Label>Devoluciones Est.</Label><p className="text-xl font-black text-rose-500">{fmtN(stats.estimatedReturns)}</p></div><div><Label>Entregas Finales</Label><p className="text-xl font-black text-emerald-600">{fmtN(stats.finalDeliveries)}</p><p className="text-[8px]">IER {fmtDec(stats.ierGlobal, 2)}%</p></div></div><div className="p-3 bg-slate-50 rounded-xl"><p className="text-[8px] font-black uppercase mb-2">📦 Unidades físicas</p><div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs"><div><span className="text-[8px] text-slate-500">Registradas:</span> <span className="font-black ml-1">{fmtN(stats.unitsRegistradas)}</span></div><div><span className="text-[8px] text-slate-500">Enviadas:</span> <span className="font-black ml-1 text-blue-600">{fmtN(stats.unitsShippedReal)}</span></div><div><span className="text-[8px] text-slate-500">Devueltas:</span> <span className="font-black ml-1 text-rose-500">{fmtN(stats.unitsReturnedReal)}</span></div><div><span className="text-[8px] text-slate-500">Entregadas:</span> <span className="font-black ml-1 text-emerald-600">{fmtN(stats.unitsDeliveredReal)}</span></div><div><span className="text-[8px] text-slate-500">% Entregado:</span> <span className="font-black ml-1">{fmtDec(stats.pctProductosEntregados, 1)}%</span></div></div></div></Card>)}</div>

        {/* COSTOS */}
        <div className="space-y-2"><SectionHeader title="RADIOGRAFÍA DE COSTOS" icon={Calculator} section="costos" />{openSections.costos && (<Card className="space-y-0 p-0 overflow-hidden">{costItems.map((item,i) => (<div key={i} className="flex items-center gap-2 md:gap-4 px-4 py-3 border-b border-slate-50 last:border-0"><div className="w-6 h-6 md:w-8 md:h-8 rounded-xl bg-slate-100 flex items-center justify-center"><item.icon size={12} /></div><div className="flex-1"><p className="text-[11px] md:text-xs font-black">{item.label}</p><p className="text-[7px] md:text-[9px] text-slate-400">{item.note}</p></div><p className="font-black font-mono text-xs md:text-sm">{fmt(item.value)}</p></div>))}<div className="flex items-center gap-2 md:gap-4 px-4 py-3 bg-slate-900 text-white"><div className="flex-1"><p className="text-[11px] md:text-xs font-black uppercase">Total Costos</p></div><p className="font-black font-mono text-sm md:text-lg text-rose-400">{fmt(totalCostos)}</p></div></Card>)}</div>

        {/* RANKING */}
        <div className="space-y-2"><SectionHeader title="RANKING DE VENDEDORAS" icon={Award} section="ranking" totalItems={stats.rankingVendedoras?.length} />{openSections.ranking && (<div className="overflow-x-auto"><table className="w-full text-left border-collapse text-xs md:text-sm"><thead className="bg-slate-100 text-[8px] md:text-[9px] font-black uppercase text-slate-500"><tr><th className="p-2 rounded-l-xl">#</th><th className="p-2">Vendedora</th><th className="p-2 text-right">Pedidos</th><th className="p-2 text-right">Recaudo Neto</th><th className="p-2 text-right">Utilidad</th><th className="p-2 text-right">IER</th></tr></thead><tbody className="divide-y divide-slate-100">{stats.rankingVendedoras?.map((v,idx) => (<tr key={v.vendedora} className="hover:bg-slate-50"><td className="p-2 font-black text-emerald-600">{idx+1}</td><td className="p-2 font-bold uppercase">{v.vendedora}</td><td className="p-2 text-right font-mono">{fmtN(v.pedidos)}</td><td className="p-2 text-right font-mono">{fmt(v.recaudoNeto)}</td><td className={`p-2 text-right font-mono ${v.utilidad >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{fmt(v.utilidad)}</td><td className="p-2 text-right font-mono">{fmtDec(v.ierPromedio,2)}%</td></tr>))}</tbody></table></div>)}</div>

        {/* PROYECCIÓN */}
        <div className="space-y-2"><SectionHeader title="UTILIDAD Y PROYECCIÓN" icon={TrendingUp} section="proyeccion" />{openSections.proyeccion && (<div className="flex flex-col md:grid md:grid-cols-2 gap-4"><Card dark className="space-y-3"><Label className="text-zinc-500">Utilidad Neta Período</Label><p className={`text-2xl md:text-4xl font-black font-mono ${stats.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{fmt(stats.net)}</p><div className="grid grid-cols-2 gap-2 pt-3 border-t border-zinc-800 text-xs"><div><p className="text-[8px] text-zinc-500">Ingresos Reales</p><p className="font-black text-white">{fmt(stats.realRev)}</p></div><div><p className="text-[8px] text-zinc-500">Total Costos</p><p className="font-black text-rose-400">{fmt(totalCostos)}</p></div><div><p className="text-[8px] text-zinc-500">Margen Neto</p><p className="font-black text-emerald-400">{stats.realRev > 0 ? fmtDec((stats.net / stats.realRev) * 100) : '0.00'}%</p></div><div><p className="text-[8px] text-zinc-500">Profit / Día</p><p className="font-black text-white">{fmt(avgDiario)}</p></div></div></Card><div className={`rounded-2xl p-4 text-white shadow-xl ${semaforo.color === 'bg-emerald-500' ? 'bg-emerald-600' : semaforo.color === 'bg-blue-500' ? 'bg-blue-600' : 'bg-rose-600'}`}><div><p className="text-[8px] font-black opacity-60">Proyección 30 Días</p><p className="text-[8px] opacity-50 mt-0.5">({fmt(avgDiario)}/día × 30)</p></div><p className="text-2xl md:text-4xl font-black">{fmt(proyeccion30)}</p><div className="bg-white/20 px-3 py-2 rounded-xl mt-2"><p className="text-sm md:text-lg font-black">{semaforo.emoji} {semaforo.texto}</p>{targetProfit > 0 && <p className="text-[8px] opacity-70">Meta: {fmt(targetProfit)} · 1M excelente</p>}</div><div className="flex justify-between text-[8px] font-black opacity-60 mt-3"><span>Días activos: {activeDays}</span><span>IER: {fmtDec(stats.ierGlobal, 2)}%</span></div></div>{targetProfit > 0 && (<Card className="col-span-2"><div className="flex justify-between text-xs"><Label>Avance vs Meta</Label><span className={`text-xs font-black ${semaforo.textColor}`}>{fmtDec((proyeccion30 / targetProfit) * 100, 2)}%</span></div><div className="h-2 bg-slate-100 rounded-full overflow-hidden mt-1"><div className={`h-full rounded-full ${semaforo.color === 'bg-emerald-500' ? 'bg-emerald-500' : semaforo.color === 'bg-blue-500' ? 'bg-blue-500' : 'bg-rose-500'}`} style={{ width: `${Math.min((proyeccion30 / targetProfit) * 100, 100)}%` }} /></div></Card>)}</div>)}</div>

        {/* PRODUCTOS EN REVISIÓN */}
        <div className="space-y-2"><button onClick={() => toggleSection('productosRevision')} className="w-full flex items-center justify-between py-2 px-3 md:py-3 md:px-4 bg-red-50 hover:bg-red-100 rounded-xl transition-colors border-l-4 border-red-500"><div className="flex items-center gap-1.5 md:gap-2"><AlertTriangle size={14} className="text-red-600" /><span className="text-[10px] md:text-xs font-black uppercase tracking-widest text-red-700">🚨 PRODUCTOS EN REVISIÓN ({productosEnRevision.length})</span></div>{openSections.productosRevision ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>{openSections.productosRevision && (<Card className="overflow-hidden p-0">{productosEnRevision.length === 0 ? <div className="p-6 text-center text-green-600 flex items-center justify-center gap-2"><CheckCircle2 size={20} /><span className="font-black text-sm">✅ No hay productos en revisión en este período</span></div> : (<div className="overflow-x-auto"><table className="w-full text-left border-collapse text-[10px] md:text-sm"><thead className="bg-red-50 text-[7px] md:text-[8px] font-black uppercase text-red-700"><tr><th className="p-2 md:p-3">Vendedora</th><th className="p-2 md:p-3">Producto</th><th className="p-2 md:p-3 text-right">Utilidad Período</th><th className="p-2 md:p-3 text-right">Proy. 30 días</th><th className="p-2 md:p-3 text-right">Meta Mensual</th><th className="p-2 md:p-3 text-right">% Meta</th><th className="p-2 md:p-3 text-right">IER</th><th className="p-2 md:p-3 text-right">ROAS</th><th className="p-2 md:p-3 text-right">CPA</th><th className="p-2 md:p-3">⚠️ Alertas</th></tr></thead><tbody className="divide-y divide-slate-100">{productosEnRevision.map(p => { const porcentajeMeta = p.targetProfit > 0 ? (p.proyeccion30 / p.targetProfit) * 100 : 0; const alertas = []; if (p.utilidadPeriodo < 0) alertas.push('💰 pérdida'); if (p.ier < 70) alertas.push(`📉 IER ${fmtDec(p.ier,1)}%`); if (p.roas < 1.5 && p.roas > 0) alertas.push(`📊 ROAS ${fmtDec(p.roas,2)}x`); if (p.cpaEquilibrio > 0 && p.cpaReal > p.cpaEquilibrio) alertas.push('🎯 CPA alto'); if (p.pedidos === 0) alertas.push('⚠️ sin pedidos'); if (!p.isActive) alertas.push('🔴 PRODUCTO DESACTIVADO'); return (<tr key={p.configId} className={`hover:bg-red-50/50 transition ${!p.isActive ? 'opacity-75 bg-gray-50' : ''}`}><td className="p-2 md:p-3 font-black text-red-700 uppercase text-[9px] md:text-xs">{p.vendedora}</td><td className={`p-2 md:p-3 font-semibold text-[9px] md:text-xs ${!p.isActive ? 'line-through text-gray-500' : ''}`}>{p.productName}{!p.isActive && <span className="ml-2 text-[8px] font-black bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">⚠️ DESACTIVADO</span>}</td><td className={`p-2 md:p-3 text-right font-mono font-black ${p.utilidadPeriodo < 0 ? 'text-red-600' : 'text-amber-600'}`}>{fmt(p.utilidadPeriodo)}</td><td className="p-2 md:p-3 text-right font-mono font-black text-red-600">{fmt(p.proyeccion30)}</td><td className="p-2 md:p-3 text-right font-mono">{fmt(p.targetProfit)}</td><td className="p-2 md:p-3 text-right font-mono font-black"><span className={porcentajeMeta < 50 ? 'text-red-600' : 'text-amber-600'}>{fmtDec(porcentajeMeta, 1)}%</span></td><td className="p-2 md:p-3 text-right font-mono">{fmtDec(p.ier, 1)}%</td><td className="p-2 md:p-3 text-right font-mono">{fmtDec(p.roas, 2)}x</td><td className="p-2 md:p-3 text-right font-mono">{fmt(p.cpaReal)}</td><td className="p-2 md:p-3"><div className="flex flex-wrap gap-1">{alertas.map((a,i) => <span key={i} className={`text-[7px] md:text-[8px] font-black px-1.5 py-0.5 rounded-full ${a.includes('DESACTIVADO') ? 'bg-gray-300 text-gray-700' : 'bg-red-100 text-red-600'}`}>{a}</span>)}</div></td></tr>); })}</tbody></table>{productosEnRevision.some(p => !p.isActive) && (<div className="p-3 bg-gray-100 text-[8px] font-black text-gray-600 flex items-center gap-2 border-t"><Info size={12} /><span>📌 Los productos tachados están DESACTIVADOS. Su historial se muestra solo para referencia, pero ya no requieren acción.</span></div>)}</div>)}</Card>)}</div>

        {/* ANÁLISIS TEMPORAL POR PRODUCTO */}
        <div className="space-y-2"><SectionHeader title="ANÁLISIS TEMPORAL POR PRODUCTO" icon={CalendarDays} section="analisisProductos" totalItems={stats.detalleProductos.length} />{openSections.analisisProductos && (<div className="overflow-x-auto"><table className="w-full text-left border-collapse text-[10px] md:text-sm"><thead className="bg-slate-100 text-[7px] md:text-[8px] font-black uppercase text-slate-500"><tr><th className="p-2">Vendedora</th><th className="p-2">Producto</th><th className="p-2">Primer registro</th><th className="p-2">Último registro</th><th className="p-2">Fecha creación</th><th className="p-2">Fecha desactivación</th><th className="p-2">Días activos</th><th className="p-2">Estado</th></tr></thead><tbody className="divide-y divide-slate-100">{stats.detalleProductos.map(p => { const diasActivos = Math.floor((parseColombiaDate(p.ultimoRegistro) - parseColombiaDate(p.primerRegistro)) / (1000*60*60*24)) + 1; const isActive = p.activo !== false; return (<tr key={p.configId} className="hover:bg-slate-50"><td className="p-2 font-bold uppercase text-[9px] md:text-xs">{p.vendedora}</td><td className={`p-2 font-semibold text-[9px] md:text-xs ${!isActive ? 'text-slate-400 line-through' : ''}`}>{p.productName}</td><td className="p-2 font-mono text-[8px] md:text-[10px]">{parseColombiaDate(p.primerRegistro).toLocaleDateString('es-CO')}</td><td className="p-2 font-mono text-[8px] md:text-[10px]">{parseColombiaDate(p.ultimoRegistro).toLocaleDateString('es-CO')}</td><td className="p-2 font-mono text-[8px] md:text-[10px]">{p.fechaCreacion ? parseColombiaDate(p.fechaCreacion).toLocaleDateString('es-CO') : '-'}</td><td className="p-2 font-mono text-[8px] md:text-[10px]">{p.fechaDesactivacion ? parseColombiaDate(p.fechaDesactivacion).toLocaleDateString('es-CO') : '-'}</td><td className="p-2 font-mono text-[8px] md:text-[10px]">{diasActivos} días</td><td className="p-2">{!isActive ? <span className="text-[8px] font-black bg-red-100 text-red-600 px-2 py-0.5 rounded-full flex items-center gap-1 w-fit"><PowerOff size={10} /> INACTIVO</span> : <span className="text-[8px] font-black bg-green-100 text-green-600 px-2 py-0.5 rounded-full flex items-center gap-1 w-fit"><Power size={10} /> ACTIVO</span>}</td></tr>); })}</tbody></table></div>)}</div>

        {/* COMPARATIVA ENTRE VENDEDORAS */}
        <div className="space-y-2"><button onClick={() => toggleSection('comparativaVendedoras')} className="w-full flex items-center justify-between py-2 px-3 md:py-3 md:px-4 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-colors"><div className="flex items-center gap-1.5 md:gap-2"><Users size={14} className="text-indigo-600" /><span className="text-[10px] md:text-xs font-black uppercase tracking-widest text-indigo-700">📊 COMPARATIVA ENTRE VENDEDORAS</span></div>{openSections.comparativaVendedoras ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>{openSections.comparativaVendedoras && (<Card className="overflow-x-auto"><table className="w-full text-left border-collapse text-[10px] md:text-sm"><thead className="bg-indigo-50 text-[7px] md:text-[8px] font-black uppercase text-indigo-700"><tr><th className="p-2 md:p-3">Vendedora</th><th className="p-2 md:p-3 text-right">Inversión Ads</th><th className="p-2 md:p-3 text-right">CPA Promedio</th><th className="p-2 md:p-3 text-right">Utilidad Período</th><th className="p-2 md:p-3 text-right">Proy. 30 días</th><th className="p-2 md:p-3 text-right">Facturación Real</th><th className="p-2 md:p-3 text-right">ROAS</th><th className="p-2 md:p-3 text-right">IER</th></tr></thead><tbody className="divide-y divide-slate-100">{selectedVendors.length === 0 ? (<tr><td colSpan="8" className="p-4 text-center text-slate-400">Selecciona al menos una vendedora en los filtros para ver la comparativa.</td></tr>) : selectedVendors.map(vendor => { const vendorRecords = filteredRecords.filter(r => { const c = configs.find(x => x.id === r.configId); return c && c.vendedora === vendor; }); const vendorStats = calcularStats(vendorRecords, configs); const activeDaysV = new Set(vendorRecords.filter(r => !r.restDay).map(r => r.date)).size; const proy30 = activeDaysV > 0 ? (vendorStats.net / activeDaysV) * 30 : 0; return (<tr key={vendor} className="hover:bg-indigo-50/50"><td className="p-2 md:p-3 font-black uppercase text-indigo-700">{vendor}</td><td className="p-2 md:p-3 text-right font-mono">{fmt(vendorStats.totalAds)}</td><td className="p-2 md:p-3 text-right font-mono">{fmt(vendorStats.cpaReal)}</td><td className={`p-2 md:p-3 text-right font-mono font-black ${vendorStats.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(vendorStats.net)}</td><td className="p-2 md:p-3 text-right font-mono font-black">{fmt(proy30)}</td><td className="p-2 md:p-3 text-right font-mono">{fmt(vendorStats.realRev)}</td><td className="p-2 md:p-3 text-right font-mono">{fmtDec(vendorStats.roas, 2)}x</td><td className="p-2 md:p-3 text-right font-mono">{fmtDec(vendorStats.ierGlobal, 1)}%</td></tr>); })}</tbody></table>{selectedVendors.length > 0 && (<div className="p-3 bg-indigo-50 text-[8px] font-black text-indigo-600 flex justify-between"><span>Período: {filter.startDate} al {filter.endDate}</span><span>Registros analizados: {filteredRecords.length}</span></div>)}</Card>)}</div>
      </>)}
    </div>
  );
}

// ==================== AGENDA ====================
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
    const unsubscribe = onSnapshot(collection(db, 'agenda_tasks'), (snapshot) => {
      const loaded = snapshot.docs.map(doc => {
        const data = doc.data();
        let createdAtFormatted = '';
        if (data.createdAt?.toDate) { const d = data.createdAt.toDate(); createdAtFormatted = `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getFullYear()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`; }
        let dueDateStr = data.dueDate?.toDate ? data.dueDate.toDate().toISOString().split('T')[0] : '';
        let approvedAtFormatted = '';
        if (data.approvedAt?.toDate) { const d = data.approvedAt.toDate(); approvedAtFormatted = `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getFullYear()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`; }
        return { id: doc.id, ...data, createdAtFormatted, dueDate: dueDateStr, approvedAtFormatted, comments: data.comments || [] };
      });
      setTasks(loaded);
    });
    return () => unsubscribe();
  }, [user]);

  const handleFormChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const saveTask = async () => {
    if (!formData.title.trim()) { alert("El título es obligatorio"); return; }
    const payload = { title: formData.title.trim(), description: formData.description.trim(), responsible: formData.responsible, priority: formData.priority, status: formData.status, dueDate: formData.dueDate ? Timestamp.fromDate(new Date(formData.dueDate)) : null, updatedAt: serverTimestamp(), createdBy: user?.uid };
    try {
      if (editingTask) await updateDoc(doc(db, 'agenda_tasks', editingTask.id), payload);
      else await addDoc(collection(db, 'agenda_tasks'), { ...payload, createdAt: serverTimestamp(), comments: [] });
      resetForm();
    } catch (err) { console.error(err); alert("Error al guardar la tarea"); }
  };

  const deleteTask = async (id) => { if (window.confirm("¿Eliminar esta tarea?")) await deleteDoc(doc(db, 'agenda_tasks', id)); };
  const handleStatusChange = async (taskId, newStatus, taskDueDate) => {
    if (newStatus === 'approved') setApprovalModal({ show: true, taskId, justification: '', dueDate: taskDueDate });
    else await updateDoc(doc(db, 'agenda_tasks', taskId), { status: newStatus, updatedAt: serverTimestamp() });
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
      await updateDoc(doc(db, 'agenda_tasks', taskId), { status: 'approved', approvedAt, approvedAtFormatted, approvalJustification: justification.trim(), approvalDelayInfo: delayInfo, updatedAt: serverTimestamp() });
      setApprovalModal({ show: false, taskId: null, justification: '', dueDate: null });
    } catch (err) { console.error(err); alert("Error al guardar la aprobación"); }
  };

  const addComment = async (taskId) => {
    const commentText = newComment[taskId]?.trim();
    if (!commentText) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const responsibleName = RESPONSIBLES.find(r => r.id === task.responsible)?.name || 'Usuario';
    const comment = { id: Date.now().toString(), text: commentText, author: responsibleName, authorId: task.responsible, createdAt: new Date().toLocaleString('es-CO') };
    try {
      await updateDoc(doc(db, 'agenda_tasks', taskId), { comments: [...(task.comments || []), comment], updatedAt: serverTimestamp() });
      setNewComment(prev => ({ ...prev, [taskId]: '' }));
    } catch (err) { console.error(err); alert("Error al guardar el comentario"); }
  };

  const resetForm = () => { setFormData({ title: '', description: '', responsible: 'david', priority: 'media', status: 'pending', dueDate: '' }); setEditingTask(null); setShowForm(false); };
  const editTask = (task) => { setFormData({ title: task.title, description: task.description || '', responsible: task.responsible, priority: task.priority || 'media', status: task.status, dueDate: task.dueDate || '' }); setEditingTask(task); setShowForm(true); };
  const toggleComments = (taskId) => setExpandedComments(prev => ({ ...prev, [taskId]: !prev[taskId] }));

  const filteredTasks = tasks.filter(t => t.status === activeTab).filter(t => filterResponsible === 'all' || t.responsible === filterResponsible).filter(t => t.title?.toLowerCase().includes(searchTerm.toLowerCase()) || t.description?.toLowerCase().includes(searchTerm.toLowerCase())).sort((a,b) => {
    if (sortBy === 'dueDate') { if (!a.dueDate) return 1; if (!b.dueDate) return -1; return new Date(a.dueDate) - new Date(b.dueDate); }
    if (sortBy === 'priority') { const order = { alta:0, media:1, baja:2 }; return (order[a.priority]||1) - (order[b.priority]||1); }
    return (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0);
  });

  const getTaskCount = (status) => tasks.filter(t => t.status === status).length;
  const getComplianceByResponsible = () => RESPONSIBLES.map(resp => {
    const userTasks = tasks.filter(t => t.responsible === resp.id);
    const total = userTasks.length; const approved = userTasks.filter(t => t.status === 'approved').length;
    const rejected = userTasks.filter(t => t.status === 'rejected').length; const pending = total - approved - rejected;
    const percent = total === 0 ? 0 : Math.round((approved / total) * 100);
    let barColor = 'bg-emerald-500'; if (percent < 30) barColor = 'bg-rose-500'; else if (percent < 70) barColor = 'bg-amber-500';
    return { ...resp, total, approved, rejected, pending, percent, barColor };
  });

  const complianceData = getComplianceByResponsible();
  const overallTotal = tasks.length; const overallApproved = tasks.filter(t => t.status === 'approved').length;
  const overallPercent = overallTotal === 0 ? 0 : Math.round((overallApproved / overallTotal) * 100);
  const pendingByResponsible = RESPONSIBLES.map(resp => ({ ...resp, total: tasks.filter(t => t.status === 'pending' && t.responsible === resp.id).length }));

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {approvalModal.show && (<div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4" onClick={() => setApprovalModal({ show: false, taskId: null, justification: '', dueDate: null })}><div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}><h3 className="text-xl font-black text-green-600 mb-4">✅ Aprobar Tarea</h3><textarea value={approvalModal.justification} onChange={(e) => setApprovalModal(prev => ({ ...prev, justification: e.target.value }))} rows={4} placeholder="Describe las acciones realizadas..." className="w-full border rounded-xl p-3 text-sm mb-4" autoFocus /><div className="flex gap-3"><button onClick={() => setApprovalModal({ show: false, taskId: null, justification: '', dueDate: null })} className="flex-1 border rounded-xl py-2">Cancelar</button><button onClick={confirmApproval} className="flex-1 bg-green-600 text-white rounded-xl py-2">Confirmar</button></div></div></div>)}

      {selectedTask && (<div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-40 p-4" onClick={() => setSelectedTask(null)}><div className="bg-white rounded-2xl max-w-md w-full max-h-[85vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}><div className="sticky top-0 bg-white p-4 border-b flex justify-between"><h3 className="font-black">{selectedTask.title}</h3><button onClick={() => setSelectedTask(null)} className="text-2xl">&times;</button></div><div className="p-4 space-y-3"><div className="bg-zinc-50 p-3 rounded-xl"><p className="text-xs font-black">📝 Descripción</p><p>{selectedTask.description || 'Sin descripción'}</p></div>{selectedTask.status === 'approved' && selectedTask.approvalJustification && (<div className="bg-green-50 p-3 rounded-xl border border-green-200"><p className="text-xs font-black text-green-700">✅ Aprobada el: {selectedTask.approvedAtFormatted}</p><p className="text-xs font-bold">{selectedTask.approvalDelayInfo?.message}</p><p className="text-xs mt-1">Justificación: {selectedTask.approvalJustification}</p></div>)}<div className="grid grid-cols-2 gap-2 text-sm"><div><span className="font-black">Responsable:</span> {RESPONSIBLES.find(r => r.id === selectedTask.responsible)?.name}</div><div><span className="font-black">Prioridad:</span> {PRIORITIES[selectedTask.priority]?.emoji} {PRIORITIES[selectedTask.priority]?.label}</div><div><span className="font-black">Estado:</span> {TASK_STATUS[selectedTask.status]?.emoji} {TASK_STATUS[selectedTask.status]?.label}</div><div><span className="font-black">Fecha límite:</span> {selectedTask.dueDate || '-'}</div></div><div className="bg-zinc-50 p-3 rounded-xl"><p className="text-xs font-black">💬 Comentarios ({selectedTask.comments?.length || 0})</p><div className="max-h-32 overflow-y-auto space-y-1 my-2">{selectedTask.comments?.map(c => <div key={c.id} className="text-xs border-b pb-1"><b>{c.author}</b> ({c.createdAt}): {c.text}</div>)}</div><div className="flex gap-2 mt-2"><input value={newComment[selectedTask.id] || ''} onChange={(e) => setNewComment(prev => ({ ...prev, [selectedTask.id]: e.target.value }))} placeholder="Escribe un comentario..." className="flex-1 border rounded-xl px-3 py-1 text-sm" /><button onClick={() => addComment(selectedTask.id)} className="bg-blue-600 text-white px-3 rounded-xl text-sm">Enviar</button></div></div><div className="flex gap-2"><button onClick={() => { setSelectedTask(null); editTask(selectedTask); }} className="flex-1 bg-indigo-50 py-2 rounded-xl">✏️ Editar</button><button onClick={() => { deleteTask(selectedTask.id); setSelectedTask(null); }} className="flex-1 bg-rose-50 py-2 rounded-xl">🗑️ Eliminar</button></div></div></div></div>)}

      <div className="bg-white rounded-2xl p-4 shadow-sm border"><div className="flex justify-between items-center mb-3"><h3 className="font-black">📊 Cumplimiento por Responsable</h3><span className="text-xs">Total: {overallApproved}/{overallTotal} ({overallPercent}%)</span></div><div className="grid grid-cols-1 md:grid-cols-3 gap-4">{complianceData.map(resp => (<div key={resp.id} className={`${resp.bgLight} rounded-xl p-3`}><div className="flex justify-between"><div><div className="flex gap-1"><div className={`w-3 h-3 rounded-full ${resp.barColor}`}></div><span className="font-black">{resp.name}</span></div><span className="text-2xl font-black">{resp.percent}%</span></div><div className="text-right"><span className="text-xs text-zinc-500">Tareas</span><div className="font-bold">{resp.approved}/{resp.total}</div></div></div><div className="h-2 bg-white rounded-full my-2"><div className={`h-full rounded-full ${resp.barColor}`} style={{ width: `${resp.percent}%` }}></div></div><div className="flex justify-between text-[10px] font-bold"><span>✅ {resp.approved}</span><span>⏳ {resp.pending}</span><span>❌ {resp.rejected}</span></div></div>))}</div></div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">{pendingByResponsible.map(resp => (<div key={resp.id} className="bg-white rounded-xl p-3 text-center shadow-sm border"><p className="text-[10px] font-black uppercase">Pendientes {resp.name}</p><p className="text-3xl font-black" style={{ color: resp.color === 'blue' ? '#2563eb' : (resp.color === 'purple' ? '#9333ea' : '#16a34a') }}>{resp.total}</p></div>))}</div>

      <div className="bg-white rounded-xl p-1 shadow-sm border"><div className="flex flex-wrap gap-1 justify-center">{AGENDA_TABS.map(tab => (<button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`px-4 py-2 rounded-xl font-black text-xs uppercase flex items-center gap-1 ${activeTab === tab.id ? `${tab.color} text-white shadow-md` : 'bg-zinc-100'}`}><span>{tab.emoji}</span> {tab.label} <span className="ml-1 px-1 rounded-full bg-white/30">{getTaskCount(tab.id)}</span></button>))}</div></div>

      <div className="flex flex-col md:flex-row gap-3"><input type="text" placeholder="🔍 Buscar tarea..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="flex-1 border rounded-xl px-3 py-2 text-sm" /><select value={filterResponsible} onChange={(e) => setFilterResponsible(e.target.value)} className="border rounded-xl px-3 py-2 text-sm"><option value="all">👥 Todos</option>{RESPONSIBLES.map(r => <option key={r.id} value={r.id}>👤 {r.name}</option>)}</select><select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="border rounded-xl px-3 py-2 text-sm"><option value="dueDate">📅 Fecha límite</option><option value="priority">⚠️ Prioridad</option><option value="createdAt">🕒 Creación</option></select></div>

      <div className="flex justify-end"><button onClick={() => { resetForm(); setShowForm(true); }} className="bg-zinc-900 text-white px-5 py-2 rounded-xl text-xs font-black">➕ Nueva Tarea</button></div>

      {showForm && (<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"><div className="bg-white rounded-2xl max-w-lg w-full p-5"><h3 className="font-black mb-4">{editingTask ? 'Editar Tarea' : 'Nueva Tarea'}</h3><div className="space-y-3"><input name="title" value={formData.title} onChange={handleFormChange} placeholder="Título *" className="w-full border rounded-xl p-2" /><textarea name="description" value={formData.description} onChange={handleFormChange} rows={2} placeholder="Descripción" className="w-full border rounded-xl p-2" /><div className="grid grid-cols-2 gap-2"><select name="responsible" value={formData.responsible} onChange={handleFormChange} className="border rounded-xl p-2">{RESPONSIBLES.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select><select name="priority" value={formData.priority} onChange={handleFormChange} className="border rounded-xl p-2">{Object.entries(PRIORITIES).map(([k,v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}</select></div><div className="grid grid-cols-2 gap-2"><select name="status" value={formData.status} onChange={handleFormChange} className="border rounded-xl p-2">{Object.entries(TASK_STATUS).map(([k,v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}</select><input type="date" name="dueDate" value={formData.dueDate} onChange={handleFormChange} className="border rounded-xl p-2" /></div></div><div className="flex justify-end gap-3 mt-5"><button onClick={resetForm} className="border rounded-xl px-4 py-1">Cancelar</button><button onClick={saveTask} className="bg-zinc-900 text-white rounded-xl px-4 py-1">Guardar</button></div></div></div>)}

      <div className="hidden md:block bg-white rounded-2xl shadow-sm border overflow-x-auto"><table className="w-full text-left"><thead className="bg-zinc-50 border-b"><tr><th className="px-4 py-2 text-[10px] font-black uppercase">Título</th><th className="px-4 py-2 text-[10px] font-black uppercase">Responsable</th><th className="px-4 py-2 text-[10px] font-black uppercase">Prioridad</th><th className="px-4 py-2 text-[10px] font-black uppercase">Estado</th><th className="px-4 py-2 text-[10px] font-black uppercase">Fecha límite</th><th className="px-4 py-2 text-[10px] font-black uppercase">Creada</th><th className="px-4 py-2 text-[10px] font-black uppercase">Acciones</th></tr></thead><tbody>{filteredTasks.length === 0 ? <tr><td colSpan="7" className="text-center py-8 text-zinc-400">No hay tareas</td></tr> : filteredTasks.map(task => { const resp = RESPONSIBLES.find(r => r.id === task.responsible); const priorityConfig = PRIORITIES[task.priority] || PRIORITIES.media; const statusConfig = TASK_STATUS[task.status] || TASK_STATUS.pending; const isOverdue = task.dueDate && task.status !== 'approved' && new Date(task.dueDate) < new Date(); const isCommentsOpen = expandedComments[task.id]; return (<React.Fragment key={task.id}><tr className="border-b hover:bg-zinc-50 transition"><td className="px-4 py-2"><button onClick={() => setSelectedTask(task)} className="font-bold text-sm text-left hover:text-indigo-600">{task.title}{task.description && <div className="text-[10px] text-zinc-400 font-normal">{task.description}</div>}{task.status === 'approved' && task.approvalDelayInfo && <div className="text-[9px] text-orange-600">{task.approvalDelayInfo.message}</div>}</button></td><td className="px-4 py-2"><span className={`inline-block px-2 py-1 rounded-full text-[10px] font-black ${resp?.color === 'blue' ? 'bg-blue-100 text-blue-700' : resp?.color === 'purple' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}`}>{resp?.name}</span></td><td className="px-4 py-2"><span className={`inline-block px-2 py-1 rounded-full text-[10px] font-bold ${priorityConfig.color}`}>{priorityConfig.emoji} {priorityConfig.label}</span></td><td className="px-4 py-2"><select value={task.status} onChange={(e) => handleStatusChange(task.id, e.target.value, task.dueDate)} className={`text-[10px] font-bold rounded-full px-2 py-1 border ${statusConfig.color}`} disabled={task.status === 'approved'}>{Object.entries(TASK_STATUS).map(([k,v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}</select></td><td className="px-4 py-2 text-sm">{task.dueDate ? <span className={isOverdue ? 'text-rose-600 font-bold' : ''}>{task.dueDate}</span> : '-'}</td><td className="px-4 py-2 text-xs text-zinc-500">{task.createdAtFormatted || '-'}</td><td className="px-4 py-2 flex gap-1"><button onClick={() => toggleComments(task.id)} className="text-blue-600 hover:text-blue-800" title="Comentarios">💬 {task.comments?.length || 0}</button><button onClick={() => editTask(task)} className="text-indigo-600 hover:text-indigo-800" title="Editar">✏️</button><button onClick={() => deleteTask(task.id)} className="text-rose-600 hover:text-rose-800" title="Eliminar">🗑️</button></td></tr>{isCommentsOpen && (<tr className="bg-zinc-50/80"><td colSpan="7" className="px-4 py-3"><div className="space-y-3 max-h-64 overflow-y-auto"><p className="text-[9px] font-black text-zinc-400 uppercase">💬 Comentarios</p>{task.comments && task.comments.length > 0 ? task.comments.map(comment => { const authorResp = RESPONSIBLES.find(r => r.id === comment.authorId); return (<div key={comment.id} className={`${authorResp?.bgLight || 'bg-gray-50'} rounded-xl p-2`}><div className="flex justify-between items-start mb-1"><span className={`text-[10px] font-black ${authorResp?.color === 'blue' ? 'text-blue-700' : authorResp?.color === 'purple' ? 'text-purple-700' : 'text-green-700'}`}>👤 {comment.author}</span><span className="text-[9px] text-zinc-400">{comment.createdAt}</span></div><p className="text-xs text-zinc-700">{comment.text}</p></div>); }) : <div className="text-xs text-zinc-400 text-center py-2">No hay comentarios aún</div>}</div><div className="mt-3 flex gap-2"><input type="text" value={newComment[task.id] || ''} onChange={(e) => setNewComment(prev => ({ ...prev, [task.id]: e.target.value }))} placeholder="Escribe un comentario..." className="flex-1 bg-white border rounded-xl px-3 py-2 text-sm" onKeyPress={(e) => e.key === 'Enter' && addComment(task.id)} /><button onClick={() => addComment(task.id)} className="bg-blue-600 text-white px-4 py-2 rounded-xl text-xs font-bold">Enviar</button></div></td></tr>)}</React.Fragment>); })}</tbody></table></div>

      <div className="md:hidden space-y-3 p-2">{filteredTasks.length === 0 ? <div className="text-center py-10 text-zinc-400">No hay tareas</div> : filteredTasks.map(task => { const resp = RESPONSIBLES.find(r => r.id === task.responsible); const priorityConfig = PRIORITIES[task.priority] || PRIORITIES.media; const statusConfig = TASK_STATUS[task.status] || TASK_STATUS.pending; const isOverdue = task.dueDate && task.status !== 'approved' && new Date(task.dueDate) < new Date(); const isCommentsOpen = expandedComments[task.id]; return (<div key={task.id} className="bg-white border rounded-xl overflow-hidden shadow-sm"><div className="p-4"><button onClick={() => setSelectedTask(task)} className="w-full text-left"><h3 className="font-black text-base">{task.title}</h3>{task.description && <p className="text-xs text-zinc-500 mt-1">{task.description}</p>}{task.status === 'approved' && task.approvalDelayInfo && <p className="text-[10px] text-orange-600 mt-1">{task.approvalDelayInfo.message}</p>}</button><div className="flex flex-wrap gap-2 mt-3"><span className={`inline-block px-2 py-1 rounded-full text-[10px] font-black ${resp?.color === 'blue' ? 'bg-blue-100 text-blue-700' : resp?.color === 'purple' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}`}>{resp?.name}</span><span className={`inline-block px-2 py-1 rounded-full text-[10px] font-bold ${priorityConfig.color}`}>{priorityConfig.emoji} {priorityConfig.label}</span><select value={task.status} onChange={(e) => handleStatusChange(task.id, e.target.value, task.dueDate)} className={`text-[10px] font-bold rounded-full px-2 py-1 border ${statusConfig.color}`} disabled={task.status === 'approved'}>{Object.entries(TASK_STATUS).map(([k,v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}</select></div><div className="flex justify-between text-xs text-zinc-500 mt-3 pt-2 border-t"><span>📅 {task.dueDate || '-'}</span><span>🕒 {task.createdAtFormatted || '-'}</span></div><div className="flex gap-2 mt-3"><button onClick={() => toggleComments(task.id)} className="flex-1 bg-blue-50 text-blue-600 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1">💬 {task.comments?.length || 0}</button><button onClick={() => editTask(task)} className="flex-1 bg-indigo-50 text-indigo-600 py-2 rounded-xl text-xs font-bold">✏️</button><button onClick={() => deleteTask(task.id)} className="flex-1 bg-rose-50 text-rose-600 py-2 rounded-xl text-xs font-bold">🗑️</button></div></div>{isCommentsOpen && (<div className="bg-zinc-50/80 px-4 py-3 border-t"><div className="space-y-3 max-h-64 overflow-y-auto"><p className="text-[9px] font-black text-zinc-400 uppercase">💬 Comentarios</p>{task.comments && task.comments.length > 0 ? task.comments.map(comment => { const authorResp = RESPONSIBLES.find(r => r.id === comment.authorId); return (<div key={comment.id} className={`${authorResp?.bgLight || 'bg-gray-50'} rounded-xl p-2`}><div className="flex justify-between items-start mb-1"><span className={`text-[10px] font-black ${authorResp?.color === 'blue' ? 'text-blue-700' : authorResp?.color === 'purple' ? 'text-purple-700' : 'text-green-700'}`}>👤 {comment.author}</span><span className="text-[9px] text-zinc-400">{comment.createdAt}</span></div><p className="text-xs text-zinc-700">{comment.text}</p></div>); }) : <div className="text-xs text-zinc-400 text-center py-2">No hay comentarios aún</div>}</div><div className="mt-3 flex gap-2"><input type="text" value={newComment[task.id] || ''} onChange={(e) => setNewComment(prev => ({ ...prev, [task.id]: e.target.value }))} placeholder="Escribe un comentario..." className="flex-1 bg-white border rounded-xl px-3 py-2 text-sm" onKeyPress={(e) => e.key === 'Enter' && addComment(task.id)} /><button onClick={() => addComment(task.id)} className="bg-blue-600 text-white px-4 py-2 rounded-xl text-xs font-bold">Enviar</button></div></div>)}</div>); })}</div>
    </div>
  );
}



// ============================================================================
// CAMPAIGN CONTROL CENTER
// Módulo totalmente independiente de sales_configs / sales_months / agenda_tasks
// ============================================================================

const COLLECTIONS = {
  products: 'campaign_control_products',
  campaigns: 'campaign_control_campaigns',
  ads: 'campaign_control_ads',
  dailyCampaigns: 'campaign_control_daily_campaigns',
  dailyAds: 'campaign_control_daily_ads',
  budgetChanges: 'campaign_control_budget_changes',
  recommendations: 'campaign_control_recommendations',
  decisions: 'campaign_control_decisions',
  imports: 'campaign_control_imports'
};

const PERIODS = [
  { id: 'last', label: 'Último día', size: 1, previousSize: 3 },
  { id: '3d', label: '3D', size: 3, previousSize: 3 },
  { id: '7d', label: '7D', size: 7, previousSize: 7 },
  { id: '14d', label: '14D', size: 14, previousSize: 14 },
  { id: '30d', label: '30D', size: 30, previousSize: 30 }
];

const META_CSV_ALIASES = {
  adName: ['Nombre del anuncio', 'Ad name', 'Anuncio'],
  spend: ['Importe gastado (COP)', 'Importe gastado', 'Amount spent (COP)', 'Amount spent', 'Gasto'],
  impressions: ['Impresiones', 'Impressions'],
  clicks: ['Clics en el enlace', 'Link clicks', 'Clics únicos en el enlace'],
  purchases: ['Compras', 'Compras en el sitio web', 'Purchases', 'Website purchases'],
  ctr: ['CTR (tasa de clics en el enlace)', 'CTR (porcentaje de clics en el enlace)', 'CTR (link click-through rate)', 'CTR'],
  cpc: ['CPC (Coste por clic en el enlace) (COP)', 'CPC (costo por clic en el enlace)', 'CPC (cost per link click)', 'CPC'],
  cpm: ['CPM (coste por 1000 impresiones) (COP)', 'CPM (costo por 1000 impresiones)', 'CPM (cost per 1,000 impressions)', 'CPM'],
  frequency: ['Frecuencia', 'Frequency'],
  landingViews: ['Visitas a la página de destino', 'Visitas a la página de destino del sitio web', 'Landing page views', 'Visitas landing'],
  atc: ['Artículos añadidos al carrito', 'Artículos añadidos al carrito en el sitio web', 'Añadir al carrito', 'Adds to cart', 'ATC'],
  roas: ['ROAS (retorno del gasto publicitario) de compras', 'ROAS (retorno del gasto publicitario) de compras en el sitio web', 'Purchase ROAS', 'ROAS'],
  startDate: ['Inicio del informe', 'Reporting starts', 'Fecha de inicio'],
  endDate: ['Fin del informe', 'Reporting ends', 'Fecha de fin']
};

function todayColombiaCC() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc - 5 * 60 * 60000).toISOString().slice(0, 10);
}

function parseDateSafe(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    const [y, m, d] = String(value).split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  }
  const m = String(value).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12, 0, 0);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateToIso(value) {
  const d = parseDateSafe(value);
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtMoney(v) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(Number(v) || 0);
}

function fmtNum(v, decimals = 2) {
  return new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(Number(v) || 0);
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let s = String(value).trim().replace(/\s/g, '').replace(/[$%]/g, '');
  if (!s) return 0;
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (s.includes(',')) {
    const p = s.split(',');
    if (p.length === 2 && p[1].length <= 2) s = `${p[0].replace(/\./g, '')}.${p[1]}`;
    else s = s.replace(/,/g, '');
  }
  const n = Number(s.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function normalizeAdName(name = '') {
  return String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeHeader(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function resolveCsvValue(row, aliases) {
  const normalized = {};
  Object.entries(row).forEach(([key, value]) => { normalized[normalizeHeader(key)] = value; });
  for (const alias of aliases) {
    const key = normalizeHeader(alias);
    if (Object.prototype.hasOwnProperty.call(normalized, key)) return normalized[key];
  }
  return '';
}

function parseCsvText(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (quoted && next === '"') { field += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(field); field = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(field); field = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map(h => String(h).replace(/^\uFEFF/, '').trim());
  return rows.slice(1).map(cols => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = cols[idx] ?? ''; });
    return obj;
  });
}

function calcCpa(spend, purchases) {
  const s = toNumber(spend);
  const p = toNumber(purchases);
  return p > 0 ? s / p : (s > 0 ? s : 0);
}

function safeRate(numerator, denominator) {
  const n = toNumber(numerator);
  const d = toNumber(denominator);
  return d > 0 ? (n / d) * 100 : 0;
}

function pctChange(current, previous) {
  const c = toNumber(current);
  const p = toNumber(previous);
  if (p === 0) return c === 0 ? 0 : null;
  return ((c - p) / p) * 100;
}

function variationBand(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'neutral';
  const a = Math.abs(value);
  if (a <= 10) return 'normal';
  if (a <= 15) return 'attention';
  if (a <= 20) return 'alert';
  return 'critical';
}

function aggregateRecords(records = []) {
  if (!records.length) return {
    days: 0, spend: 0, purchases: 0, cpa: 0, ctr: 0, cpc: 0, cpm: 0,
    frequency: 0, landingViews: 0, atc: 0, roas: 0,
    visitToAtc: 0, visitToPurchase: 0, atcToPurchase: 0
  };

  const spend = records.reduce((s, r) => s + toNumber(r.spend), 0);
  const purchases = records.reduce((s, r) => s + toNumber(r.purchases), 0);
  const landingViews = records.reduce((s, r) => s + toNumber(r.landingViews), 0);
  const atc = records.reduce((s, r) => s + toNumber(r.atc), 0);
  const impressions = records.reduce((s, r) => s + toNumber(r.impressions), 0);
  const clicks = records.reduce((s, r) => s + toNumber(r.clicks), 0);

  const weighted = key => {
    const valid = records.filter(r => toNumber(r.spend) > 0 && Number.isFinite(toNumber(r[key])));
    const denom = valid.reduce((s, r) => s + toNumber(r.spend), 0);
    if (!denom) return valid.length ? valid.reduce((s, r) => s + toNumber(r[key]), 0) / valid.length : 0;
    return valid.reduce((s, r) => s + toNumber(r[key]) * toNumber(r.spend), 0) / denom;
  };

  const ctr = impressions > 0 ? (clicks / impressions) * 100 : weighted('ctr');
  const cpc = clicks > 0 ? spend / clicks : weighted('cpc');
  const cpm = impressions > 0 ? (spend / impressions) * 1000 : weighted('cpm');

  return {
    days: records.length,
    spend,
    purchases,
    cpa: calcCpa(spend, purchases),
    ctr,
    cpc,
    cpm,
    frequency: weighted('frequency'),
    landingViews,
    atc,
    roas: weighted('roas'),
    visitToAtc: safeRate(atc, landingViews),
    visitToPurchase: safeRate(purchases, landingViews),
    atcToPurchase: safeRate(purchases, atc)
  };
}

function splitPeriodRecords(records, periodId) {
  const period = PERIODS.find(p => p.id === periodId) || PERIODS[0];
  const today = todayColombiaCC();

  // El diagnóstico solo usa días completos: cualquier registro de HOY queda fuera.
  const sorted = [...records]
    .filter(r => String(r.date) < today)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  if (periodId === 'last') {
    const current = sorted.slice(0, 1);
    const previous = sorted.slice(1, 4);
    return {
      current,
      previous,
      currentStats: aggregateRecords(current),
      previousStats: aggregateRecords(previous)
    };
  }

  const current = sorted.slice(0, period.size);
  const previous = sorted.slice(period.size, period.size + period.previousSize);
  return {
    current,
    previous,
    currentStats: aggregateRecords(current),
    previousStats: aggregateRecords(previous)
  };
}

function confidenceLabel(purchases, ageDays) {
  let level = purchases < 5 ? 1 : purchases < 15 ? 2 : purchases < 30 ? 3 : 4;
  if (ageDays < 3) level = Math.min(level, 1);
  else if (ageDays < 7) level = Math.min(level, 2);
  return ['Baja', 'Baja', 'Media', 'Alta', 'Muy alta'][level];
}

function daysBetween(from, to = todayColombiaCC()) {
  const a = parseDateSafe(from);
  const b = parseDateSafe(to);
  if (!a || !b) return 0;
  return Math.max(0, Math.floor((b - a) / 86400000));
}

function entityActiveOnDate(entity, date) {
  if (!entity || !date) return true;
  const effectiveStart = entity.effectiveStartDate || entity.createdDate;
  if (effectiveStart && String(date) < String(effectiveStart)) return false;
  const history = Array.isArray(entity.stateHistory) ? [...entity.stateHistory] : [];
  if (!history.length) return true;
  history.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  let state = true;
  for (const event of history) {
    if (!event?.date || String(event.date) > String(date)) break;
    state = event.active !== false;
  }
  return state;
}

function eligibleAdRecords(records, ad, campaign) {
  return (records || []).filter(r => entityActiveOnDate(ad, r.date) && entityActiveOnDate(campaign, r.date));
}

function countEntityActiveDays(entity, asOfDate = todayColombiaCC(), parentEntity = null) {
  if (!entity) return 0;
  const start = parseDateSafe(entity.effectiveStartDate || entity.createdDate || asOfDate);
  const end = parseDateSafe(asOfDate);
  if (!start || !end || start > end) return 0;
  let count = 0;
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12, 0, 0);
  const finish = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 12, 0, 0);
  while (cursor <= finish) {
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    if (entityActiveOnDate(entity, iso) && (!parentEntity || entityActiveOnDate(parentEntity, iso))) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

function eligibleCampaignRecords(records, campaign) {
  return (records || []).filter(r => entityActiveOnDate(campaign, r.date));
}

function variationExplanation(periodId) {
  const map = {
    last: 'ÚLTIMO DÍA toma el registro activo completo más reciente anterior a hoy y lo compara contra los 3 días activos completos inmediatamente anteriores.',
    '3d': '3D toma los últimos 3 días activos completos anteriores a hoy y los compara contra los 3 días activos completos anteriores a ese bloque.',
    '7d': '7D toma los últimos 7 días activos completos anteriores a hoy y los compara contra los 7 días activos completos anteriores.',
    '14d': '14D toma los últimos 14 días activos completos anteriores a hoy y los compara contra los 14 anteriores para detectar cambios de tendencia intermedia.',
    '30d': '30D toma los últimos 30 días activos completos anteriores a hoy y los compara contra los 30 anteriores para mostrar tendencia y estabilidad de largo plazo.'
  };
  return map[periodId] || map.last;
}

function adVariationDiagnosisFromDelta(delta) {
  const cpa = Number(delta?.cpa) || 0;
  const ctr = Number(delta?.ctr) || 0;
  const cpc = Number(delta?.cpc) || 0;
  const cpm = Number(delta?.cpm) || 0;
  const freq = Number(delta?.frequency) || 0;
  const cvr = Number(delta?.visitToPurchase) || 0;
  if (cpa > 20 && ctr < -20 && cpc > 20 && freq > 20) return { diagnosis: 'Fatiga confirmada', action: 'Apagar/reemplazar si no rentable', tone: 'critical' };
  if (cpa > 15 && ctr < -15 && cpc > 15 && freq > 15) return { diagnosis: 'Fatiga probable', action: 'Lanzar test creativo y detener escalado', tone: 'alert' };
  if (cpa > 10 && ctr < -10 && cpc > 10 && freq > 10) return { diagnosis: 'Fatiga temprana', action: 'Preparar 3–5 creativos', tone: 'attention' };
  if (cpa > 10 && Math.abs(ctr) <= 10 && Math.abs(cpc) <= 10 && cvr < -10) return { diagnosis: 'Problema post-clic', action: 'Revisar landing/oferta', tone: 'alert' };
  if (cpm > 15 && Math.abs(ctr) <= 10 && Math.abs(cvr) <= 10) return { diagnosis: 'Subasta más cara', action: 'Mantener y observar', tone: 'attention' };
  return { diagnosis: 'Estable', action: 'Mantener', tone: 'normal' };
}

function funnelVariationDiagnosisFromDelta(delta) {
  const vta = Number(delta?.visitToAtc) || 0;
  const vtp = Number(delta?.visitToPurchase) || 0;
  const atp = Number(delta?.atcToPurchase) || 0;
  if (vta <= -20 && vtp <= -20) return { diagnosis: 'Tráfico post-clic deteriorado', action: 'Apagar/reemplazar si CPA no es rentable', tone: 'critical' };
  if (vta <= -15 && vtp <= -15) return { diagnosis: 'Calidad de tráfico cayendo', action: 'Revisar creativo y coherencia anuncio→landing', tone: 'alert' };
  if (vta > -10 && vtp <= -15 && atp <= -15) return { diagnosis: 'Fuga al cierre', action: 'Revisar formulario/oferta', tone: 'alert' };
  if (vta <= -10 && vtp > -10) return { diagnosis: 'Menor intención inicial', action: 'Preparar variaciones creativas', tone: 'attention' };
  if (Math.abs(vta) <= 10 && Math.abs(vtp) <= 10 && Math.abs(atp) <= 10) return { diagnosis: 'Post-clic estable', action: 'Mantener', tone: 'normal' };
  return { diagnosis: 'Post-clic en observación', action: 'Monitorear', tone: 'attention' };
}

function diagnoseAd(records, product, ad, periodId = '3d', campaign = null) {
  const eligible = eligibleAdRecords(records, ad, campaign);
  const { currentStats: c, previousStats: p } = splitPeriodRecords(eligible, periodId);
  const maxCpa = Math.max(1, toNumber(product?.maxCpa));
  const scaleCpa = maxCpa * 0.8;
  const today = todayColombiaCC();
  const completeEligible = eligible.filter(r => String(r.date) < today);
  const latestEligibleDate = completeEligible.length
    ? [...completeEligible].sort((a,b) => String(b.date).localeCompare(String(a.date)))[0].date
    : today;
  const activeDays = countEntityActiveDays(ad, latestEligibleDate, campaign);
  const ageDays = activeDays;
  const confidence = confidenceLabel(c.purchases, activeDays);
  const delta = {
    cpa: pctChange(c.cpa, p.cpa), ctr: pctChange(c.ctr, p.ctr), cpc: pctChange(c.cpc, p.cpc),
    cpm: pctChange(c.cpm, p.cpm), frequency: pctChange(c.frequency, p.frequency),
    visitToAtc: pctChange(c.visitToAtc, p.visitToAtc), visitToPurchase: pctChange(c.visitToPurchase, p.visitToPurchase),
    atcToPurchase: pctChange(c.atcToPurchase, p.atcToPurchase)
  };
  const dynamic = adVariationDiagnosisFromDelta(delta);
  const post = funnelVariationDiagnosisFromDelta(delta);
  const guardrails = {
    cpaMargin: c.cpa > 0 && c.cpa <= scaleCpa,
    stability: delta.cpa === null || Math.abs(delta.cpa) <= 15,
    volume: c.purchases >= 15,
    creative: !['Fatiga probable', 'Fatiga confirmada'].includes(dynamic.diagnosis),
    postClick: !['Tráfico post-clic deteriorado', 'Calidad de tráfico cayendo', 'Fuga al cierre'].includes(post.diagnosis)
  };
  const canScale = Object.values(guardrails).every(Boolean);
  let finalDiagnosis = 'Sin suficiente información';
  let action = 'Monitorear';
  let priority = 'monitor';
  let reason = 'Todavía no existe suficiente historial comparable.';
  if (c.days > 0) {
    if (c.cpa > maxCpa && dynamic.diagnosis === 'Fatiga confirmada') {
      finalDiagnosis = 'Anuncio deteriorado y no rentable'; action = 'Apagar / reemplazar'; priority = 'critical'; reason = 'CPA fuera de objetivo + fatiga confirmada en CTR/CPC/frecuencia.';
    } else if (c.cpa > maxCpa && post.diagnosis === 'Tráfico post-clic deteriorado') {
      finalDiagnosis = 'Tráfico de baja calidad'; action = 'Apagar / reemplazar creativo'; priority = 'critical'; reason = 'CPA fuera de objetivo y el embudo post-clic también se deteriora.';
    } else if (c.cpa <= maxCpa && dynamic.diagnosis === 'Fatiga temprana') {
      finalDiagnosis = 'Rentable con fatiga temprana'; action = 'Mantener y preparar creativos'; priority = 'alert'; reason = 'Todavía rentable, pero CTR/CPC/frecuencia empiezan a deteriorarse.';
    } else if (c.cpa <= maxCpa && dynamic.diagnosis === 'Fatiga probable') {
      finalDiagnosis = 'Rentable pero en deterioro'; action = 'Detener escala y lanzar test creativo'; priority = 'alert'; reason = 'CPA aún rentable, pero el patrón de fatiga ya es consistente.';
    } else if (post.diagnosis === 'Fuga al cierre') {
      finalDiagnosis = 'Problema post-clic'; action = 'Mantener anuncio y revisar cierre'; priority = 'alert'; reason = 'El anuncio genera intención, pero se pierde conversión después del ATC.';
    } else if (post.diagnosis === 'Calidad de tráfico cayendo') {
      finalDiagnosis = 'Calidad de tráfico deteriorándose'; action = c.cpa <= maxCpa ? 'Preparar reemplazo' : 'Apagar / reemplazar'; priority = 'alert'; reason = 'Las tasas visita→ATC y visita→compra empeoran frente a su ventana anterior.';
    } else if (c.cpa <= scaleCpa && dynamic.diagnosis === 'Estable' && post.diagnosis === 'Post-clic estable' && canScale) {
      finalDiagnosis = 'Ganador estable'; action = 'Escalar +20%'; priority = 'monitor'; reason = 'CPA con margen ≥20%, variaciones sanas, volumen suficiente y post-clic estable.';
    } else if (c.cpa <= maxCpa) {
      finalDiagnosis = 'Rentable / mantener'; action = 'Mantener'; priority = 'monitor'; reason = 'CPA dentro del máximo y sin señales críticas combinadas.';
    } else {
      finalDiagnosis = 'No rentable / observar'; action = 'No escalar'; priority = 'critical'; reason = `CPA ${fmtMoney(c.cpa)} supera el máximo ${fmtMoney(maxCpa)}.`;
    }
  }
  return {
    diagnosis: finalDiagnosis, finalDiagnosis, action, priority, reason, confidence, delta, stats: c, previous: p,
    guardrails, canScale, dynamicDiagnosis: dynamic.diagnosis, dynamicAction: dynamic.action,
    postDiagnosis: post.diagnosis, postAction: post.action, dynamicTone: dynamic.tone, postTone: post.tone,
    maxCpa, scaleCpa, ageDays
  };
}

function StateBadge({ active, archived = false }) {
  if (archived) return <span className="px-2 py-1 rounded-full bg-slate-200 text-slate-500 text-[9px] font-black uppercase">Archivada</span>;
  return active
    ? <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[9px] font-black uppercase">Activa</span>
    : <span className="px-2 py-1 rounded-full bg-rose-100 text-rose-600 text-[9px] font-black uppercase">Apagada</span>;
}

function MiniCard({ label, value, sub, tone = 'default' }) {
  const toneClass = tone === 'good' ? 'bg-emerald-50 border-emerald-100' : tone === 'bad' ? 'bg-rose-50 border-rose-100' : 'bg-white border-slate-100';
  return (
    <div className={`rounded-2xl border p-3 ${toneClass}`}>
      <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className="text-lg font-black text-zinc-900 mt-1">{value}</p>
      {sub && <p className="text-[8px] font-semibold text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

function SectionCard({ children, className = '', accent = null, soft = null }) {
  return (
    <div
      className={`bg-white border shadow-sm rounded-3xl p-4 md:p-5 ${className}`}
      style={accent ? {
        borderColor: accent,
        borderWidth: '2px',
        backgroundColor: soft || '#ffffff',
        boxShadow: `0 8px 24px ${accent}12`
      } : undefined}
    >
      {children}
    </div>
  );
}

const CC_VISUAL_ACCENTS = [
  { border: '#2563eb', soft: '#eff6ff', text: '#1d4ed8' },
  { border: '#7c3aed', soft: '#f5f3ff', text: '#6d28d9' },
  { border: '#059669', soft: '#ecfdf5', text: '#047857' },
  { border: '#ea580c', soft: '#fff7ed', text: '#c2410c' },
  { border: '#db2777', soft: '#fdf2f8', text: '#be185d' },
  { border: '#0891b2', soft: '#ecfeff', text: '#0e7490' },
  { border: '#ca8a04', soft: '#fefce8', text: '#a16207' }
];

function ccVisualAccent(seed = '', offset = 0) {
  const value = String(seed || '');
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  return CC_VISUAL_ACCENTS[(Math.abs(hash) + offset) % CC_VISUAL_ACCENTS.length];
}

function EmptyState({ children }) {
  return <div className="border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center text-slate-400 text-xs font-bold">{children}</div>;
}

function metricDirectionClass(metric, delta) {
  if (delta === null || delta === undefined || Number.isNaN(Number(delta))) return 'text-slate-300';
  const value = Number(delta);
  if (Math.abs(value) < 0.005) return 'text-slate-400';
  const lowerIsGood = ['cpa', 'cpc', 'cpm', 'frequency'].includes(metric);
  const improvement = lowerIsGood ? value < 0 : value > 0;
  return improvement ? 'text-emerald-600' : 'text-rose-600';
}

function Delta({ metric, value }) {
  if (value === null || value === undefined) return <span className="text-slate-300">—</span>;
  return <span className={`font-black ${metricDirectionClass(metric, value)}`}>{value > 0 ? '+' : ''}{fmtNum(value, 2)}%</span>;
}

function parseMetaRows(rows, existingAds, selectedDate) {
  const existingMap = new Map(existingAds.map(a => [normalizeAdName(a.name), a]));
  const parsed = rows.map(row => {
    const adName = String(resolveCsvValue(row, META_CSV_ALIASES.adName) || '').trim();
    if (!adName) return null;
    const normalizedName = normalizeAdName(adName);
    const spend = toNumber(resolveCsvValue(row, META_CSV_ALIASES.spend));
    const impressions = toNumber(resolveCsvValue(row, META_CSV_ALIASES.impressions));
    const clicks = toNumber(resolveCsvValue(row, META_CSV_ALIASES.clicks));
    const purchases = toNumber(resolveCsvValue(row, META_CSV_ALIASES.purchases));
    const ctrRaw = toNumber(resolveCsvValue(row, META_CSV_ALIASES.ctr));
    const cpcRaw = toNumber(resolveCsvValue(row, META_CSV_ALIASES.cpc));
    const cpmRaw = toNumber(resolveCsvValue(row, META_CSV_ALIASES.cpm));
    const frequency = toNumber(resolveCsvValue(row, META_CSV_ALIASES.frequency));
    const landingViews = toNumber(resolveCsvValue(row, META_CSV_ALIASES.landingViews));
    const atc = toNumber(resolveCsvValue(row, META_CSV_ALIASES.atc));
    const roas = toNumber(resolveCsvValue(row, META_CSV_ALIASES.roas));
    const reportDate = dateToIso(resolveCsvValue(row, META_CSV_ALIASES.endDate)) || dateToIso(resolveCsvValue(row, META_CSV_ALIASES.startDate)) || selectedDate;
    return {
      adName,
      normalizedName,
      existingAd: existingMap.get(normalizedName) || null,
      reportDate,
      metrics: {
        spend,
        impressions,
        clicks,
        purchases,
        ctr: impressions > 0 && clicks > 0 ? (clicks / impressions) * 100 : ctrRaw,
        cpc: clicks > 0 ? spend / clicks : cpcRaw,
        cpm: impressions > 0 ? (spend / impressions) * 1000 : cpmRaw,
        frequency,
        landingViews,
        atc,
        roas
      }
    };
  }).filter(Boolean);

  const counts = {};
  parsed.forEach(item => { counts[item.normalizedName] = (counts[item.normalizedName] || 0) + 1; });
  parsed.forEach(item => {
    item.status = counts[item.normalizedName] > 1 ? 'conflict' : item.existingAd ? 'existing' : 'new';
  });
  return parsed;
}

function CampaignControlModule() {
  const { user } = useAuth();
  const ownerUid = user?.uid || null;

  const [subTab, setSubTab] = useState('dashboard');
  const [products, setProducts] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [ads, setAds] = useState([]);
  const [dailyCampaigns, setDailyCampaigns] = useState([]);
  const [dailyAds, setDailyAds] = useState([]);
  const [budgetChanges, setBudgetChanges] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [loading, setLoading] = useState(true);

  const [period, setPeriod] = useState('last');
  const [selectedCampaignId, setSelectedCampaignId] = useState('');

  useEffect(() => {
    if (!ownerUid) return undefined;
    setLoading(true);
    const listeners = [];
    const listen = (collectionName, setter) => {
      const q = query(collection(db, collectionName), where('ownerUid', '==', ownerUid));
      listeners.push(onSnapshot(q, snap => {
        setter(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoading(false);
      }));
    };
    listen(COLLECTIONS.products, setProducts);
    listen(COLLECTIONS.campaigns, setCampaigns);
    listen(COLLECTIONS.ads, setAds);
    listen(COLLECTIONS.dailyCampaigns, setDailyCampaigns);
    listen(COLLECTIONS.dailyAds, setDailyAds);
    listen(COLLECTIONS.budgetChanges, setBudgetChanges);
    listen(COLLECTIONS.recommendations, setRecommendations);
    listen(COLLECTIONS.decisions, setDecisions);
    return () => listeners.forEach(unsub => unsub());
  }, [ownerUid]);

  const activeProducts = useMemo(() => products.filter(p => p.active !== false), [products]);
  const activeCampaigns = useMemo(() => campaigns.filter(c => !c.archived), [campaigns]);
  const activeAds = useMemo(() => ads.filter(a => a.active !== false && campaigns.some(c => c.id === a.campaignId && c.active !== false && !c.archived) && products.some(p => p.id === a.productId && p.active !== false)), [ads, campaigns, products]);

  const latestDate = todayColombiaCC();

  const attentionRows = useMemo(() => {
    const rows = [];
    for (const ad of ads.filter(a => a.active !== false)) {
      const campaign = campaigns.find(c => c.id === ad.campaignId && c.active !== false && !c.archived);
      if (!campaign) continue;
      const product = products.find(p => p.id === ad.productId && p.active !== false);
      if (!product) continue;
      const recs = dailyAds.filter(r => r.adId === ad.id).sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const diag = diagnoseAd(recs, product, ad, 'last', campaign);
      if (diag.stats.days <= 0) continue;
      rows.push({ ad, campaign, product, diag });
    }
    return rows.sort((a, b) => ({ critical: 0, alert: 1, monitor: 2 }[a.diag.priority] ?? 9) - ({ critical: 0, alert: 1, monitor: 2 }[b.diag.priority] ?? 9));
  }, [ads, campaigns, products, dailyAds]);

  const selectedCampaign = campaigns.find(c => c.id === selectedCampaignId) || activeCampaigns[0] || null;

  useEffect(() => {
    if (!selectedCampaignId && activeCampaigns.length) setSelectedCampaignId(activeCampaigns[0].id);
  }, [activeCampaigns, selectedCampaignId]);

  if (loading) return <div className="py-20 text-center text-slate-400 font-black uppercase text-xs">Cargando Campaign Control...</div>;

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
    { id: 'campaigns', label: 'Ver campañas', icon: Layers },
    { id: 'register', label: 'Registro diario', icon: CalendarDays }
  ];

  return (
    <div className="space-y-5 anim-fade">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500 flex items-center justify-center text-zinc-950"><Activity size={20} /></div>
            <div>
              <h2 className="text-2xl md:text-3xl font-black italic uppercase tracking-tighter text-zinc-900">Campaign Control</h2>
              <p className="text-[9px] md:text-[10px] text-slate-400 font-black uppercase tracking-widest">Módulo Meta Ads · Datos totalmente independientes</p>
            </div>
          </div>
        </div>
        <div className="flex bg-zinc-950 p-1 rounded-2xl overflow-x-auto">
          {tabs.map(t => <button key={t.id} onClick={() => setSubTab(t.id)} className={`flex items-center gap-2 px-3 md:px-4 py-2 rounded-xl text-[9px] font-black uppercase whitespace-nowrap ${subTab === t.id ? 'bg-emerald-500 text-zinc-950' : 'text-zinc-500'}`}><t.icon size={13} />{t.label}</button>)}
        </div>
      </div>

      {subTab === 'dashboard' && (
        <CampaignDashboard
          ownerUid={ownerUid}
          products={products}
          campaigns={campaigns}
          ads={ads}
          dailyCampaigns={dailyCampaigns}
          dailyAds={dailyAds}
          budgetChanges={budgetChanges}
          decisions={decisions}
          recommendations={recommendations}
          attentionRows={attentionRows}
          activeProducts={activeProducts}
          activeCampaigns={activeCampaigns}
          activeAds={activeAds}
          latestDate={latestDate}
          period={period}
          setPeriod={setPeriod}
          selectedCampaign={selectedCampaign}
          setSelectedCampaignId={setSelectedCampaignId}
          setSubTab={setSubTab}
        />
      )}

      {subTab === 'register' && (
        <DailyRegisterFull
          ownerUid={ownerUid}
          products={products}
          campaigns={campaigns}
          ads={ads}
          dailyCampaigns={dailyCampaigns}
          dailyAds={dailyAds}
          recommendations={recommendations}
        />
      )}

      {subTab === 'campaigns' && (
        <CampaignManager
          ownerUid={ownerUid}
          products={products}
          campaigns={campaigns}
          ads={ads}
          dailyCampaigns={dailyCampaigns}
          dailyAds={dailyAds}
          budgetChanges={budgetChanges}
          recommendations={recommendations}
          decisions={decisions}
        />
      )}
    </div>
  );
}


function CampaignCpaMiniChart({ campaign, product, dailyCampaigns }) {
  const today = todayColombiaCC();
  const history = eligibleCampaignRecords(
    dailyCampaigns.filter(r => r.campaignId === campaign.id),
    campaign
  ).filter(r => String(r.date) < today)
   .sort((a,b) => String(a.date).localeCompare(String(b.date))).slice(-14);

  if (!history.length) return <EmptyState>Sin histórico suficiente.</EmptyState>;

  const maxCpa = Math.max(1, toNumber(product?.maxCpa));
  const target = maxCpa * 0.8;
  const data = history.map(r => ({ date:r.date, cpa:calcCpa(r.spend,r.purchases) }));
  const valid = data.map(x=>x.cpa).filter(x=>x>0);
  const chartMax = Math.max(maxCpa*1.35, ...(valid.length?valid.map(v=>v*1.1):[maxCpa]));
  const W=620,H=180,px=16,py=15,bottom=28;
  const iw=W-px*2, ih=H-py-bottom;
  const x=i=>data.length<=1?W/2:px+i*iw/(data.length-1);
  const y=v=>py+ih-(Math.min(Math.max(v,0),chartMax)/chartMax)*ih;
  const points=data.map((d,i)=>`${x(i)},${y(d.cpa)}`).join(' ');

  return <div>
    <div className="rounded-2xl border bg-slate-50 p-2 overflow-hidden">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[180px]" preserveAspectRatio="none">
        <line x1={px} x2={W-px} y1={y(maxCpa)} y2={y(maxCpa)} stroke="#ef4444" strokeWidth="1.5" strokeDasharray="6 5"/>
        <line x1={px} x2={W-px} y1={y(target)} y2={y(target)} stroke="#10b981" strokeWidth="1.5" strokeDasharray="6 5"/>
        <polyline points={points} fill="none" stroke="#2563eb" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round"/>
        {data.map((d,i)=><circle key={`${d.date}-${i}`} cx={x(i)} cy={y(d.cpa)} r="4" fill="#2563eb"/>)}
      </svg>
    </div>
    <div className="flex flex-wrap gap-4 text-[8px] font-black text-slate-500 mt-2">
      <span>🔴 CPA máximo {fmtMoney(maxCpa)}</span>
      <span>🟢 CPA operativo {fmtMoney(target)}</span>
      <span>🔵 CPA diario</span>
    </div>
  </div>;
}

function CampaignDashboard({
  ownerUid, products, campaigns, ads, dailyCampaigns, dailyAds, budgetChanges, decisions, recommendations,
  attentionRows, activeProducts, activeCampaigns, activeAds, latestDate,
  period, setPeriod, selectedCampaign, setSelectedCampaignId, setSubTab
}) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [drawerCampaignId, setDrawerCampaignId] = useState('');
  const [drawerPeriod, setDrawerPeriod] = useState(period || 'last');

  const activeCampaignList = activeCampaigns.filter(c => !c.archived);

  const campaignRows = useMemo(() => activeCampaignList.map(c => {
    const product = products.find(p => p.id === c.productId);
    const history = eligibleCampaignRecords(
      dailyCampaigns.filter(r => r.campaignId === c.id),
      c
    ).sort((a,b)=>String(a.date).localeCompare(String(b.date)));

    const today = todayColombiaCC();
    const todayRecord = history.find(r => String(r.date) === today) || null;
    const completeHistory = history.filter(r => String(r.date) < today);
    const lastComplete = completeHistory[completeHistory.length - 1] || null;
    const lastStats = lastComplete ? aggregateRecords([lastComplete]) : aggregateRecords([]);

    const split3 = splitPeriodRecords(history, '3d');
    const split7 = splitPeriodRecords(history, '7d');
    const stats3 = split3.currentStats;
    const stats7 = split7.currentStats;
    const delta3 = pctChange(split3.currentStats.cpa, split3.previousStats.cpa);
    const delta7 = pctChange(split7.currentStats.cpa, split7.previousStats.cpa);

    const maxCpa = Math.max(1,toNumber(product?.maxCpa));
    const campaignAds = ads.filter(a => a.campaignId === c.id && a.active !== false);
    const adDiags = campaignAds.map(ad => diagnoseAd(
      dailyAds.filter(r=>r.adId===ad.id), product, ad, 'last', c
    )).filter(d => d.stats.days > 0);

    const hasCritical = adDiags.some(d=>d.priority==='critical');
    const hasAlert = adDiags.some(d=>d.priority==='alert');
    const hasScalable = adDiags.some(d=>d.canScale);
    const cpa = lastStats.cpa;

    let state='Sin cierre previo', tone='attention', diagnosis='Pendiente', action='Registrar histórico';
    if (lastComplete) {
      if (hasCritical || cpa > maxCpa) {
        state='Crítico'; tone='critical';
        diagnosis=cpa>maxCpa?'CPA fuera de objetivo':'Anuncio crítico';
        action='Optimizar / no escalar';
      } else if (hasAlert) {
        state='Alerta'; tone='alert';
        diagnosis='Variación fuera de rango';
        action='Revisar diagnóstico';
      } else if (hasScalable && cpa <= maxCpa*0.8) {
        state='Escalable'; tone='normal';
        diagnosis='Estable + margen';
        action='Escalar controladamente';
      } else {
        state='Mantener'; tone='attention';
        diagnosis='Rentable / observar';
        action='Mantener';
      }
    }

    const creativeHealth = hasCritical ? 'Reemplazar creativo'
      : hasAlert ? 'Vigilar fatiga'
      : 'Creativo sano';

    return {
      campaign:c, product, todayRecord, lastComplete, lastStats, stats3, stats7, delta3, delta7,
      maxCpa, state, tone, diagnosis, action, creativeHealth,
      purchases:lastStats.purchases, frequency:lastStats.frequency
    };
  }), [activeCampaignList, products, dailyCampaigns, ads, dailyAds]);

  const filteredRows = campaignRows.filter(r => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || `${r.product?.name||''} ${r.campaign.name}`.toLowerCase().includes(q);
    const matchesStatus = statusFilter==='all'
      || (statusFilter==='critical' && r.state==='Crítico')
      || (statusFilter==='alert' && r.state==='Alerta')
      || (statusFilter==='scalable' && r.state==='Escalable')
      || (statusFilter==='testing' && /test/i.test(r.campaign.name))
      || (statusFilter==='scaled' && /escala|escalad/i.test(r.campaign.name));
    return matchesSearch && matchesStatus;
  });

  const totalSpend = campaignRows.reduce((sum,r)=>sum+toNumber(r.lastComplete?.spend),0);
  const totalPurchases = campaignRows.reduce((sum,r)=>sum+toNumber(r.lastComplete?.purchases),0);
  const globalCpa = calcCpa(totalSpend,totalPurchases);

  const today = todayColombiaCC();
  const todayCampaignRecords = dailyCampaigns.filter(r =>
    String(r.date) === today &&
    campaigns.some(c => c.id === r.campaignId && c.active !== false && !c.archived)
  );
  const provisionalToday = aggregateRecords(todayCampaignRecords);
  const scalableCount = campaignRows.filter(r=>r.state==='Escalable').length;
  const maintainCount = campaignRows.filter(r=>r.state==='Mantener').length;
  const alertCount = campaignRows.filter(r=>r.state==='Alerta').length;
  const criticalCount = campaignRows.filter(r=>r.state==='Crítico').length;

  const drawerCampaign = campaigns.find(c=>c.id===drawerCampaignId) || null;
  const drawerProduct = drawerCampaign ? products.find(p=>p.id===drawerCampaign.productId) : null;
  const drawerHistory = drawerCampaign ? eligibleCampaignRecords(
    dailyCampaigns.filter(r=>r.campaignId===drawerCampaign.id), drawerCampaign
  ).sort((a,b)=>String(a.date).localeCompare(String(b.date))) : [];
  const drawerToday = drawerHistory.find(r => String(r.date) === today) || null;
  const drawerCompleteHistory = drawerHistory.filter(r => String(r.date) < today);
  const drawerLastComplete = drawerCompleteHistory[drawerCompleteHistory.length - 1] || null;
  const drawerCurrent = drawerLastComplete ? aggregateRecords([drawerLastComplete]) : aggregateRecords([]);
  const drawerPrev3 = aggregateRecords(drawerCompleteHistory.slice(Math.max(0, drawerCompleteHistory.length - 4), Math.max(0, drawerCompleteHistory.length - 1)));
  const drawerDelta = drawerLastComplete ? pctChange(drawerCurrent.cpa, drawerPrev3.cpa) : null;
  const drawerTodayStats = drawerToday ? aggregateRecords([drawerToday]) : aggregateRecords([]);

  const openDrawer = campaignId => {
    setSelectedCampaignId(campaignId);
    setDrawerCampaignId(campaignId);
    setDrawerPeriod(period || '3d');
  };

  return (
    <div className="space-y-5">
      {/* TOPBAR VALIDADO */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl md:text-2xl font-black uppercase tracking-tight">Dashboard de campañas</h3>
          <p className="text-[9px] md:text-[10px] text-slate-400 font-semibold mt-1">Control diario, variaciones, acciones recomendadas y techo rentable por producto</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={()=>setSubTab('register')} className="bg-white border px-4 py-2 rounded-xl text-[9px] font-black uppercase">+ Registrar día</button>
          <button onClick={()=>setSubTab('campaigns')} className="bg-zinc-950 text-white px-4 py-2 rounded-xl text-[9px] font-black uppercase">+ Nuevo producto</button>
        </div>
      </div>

      {/* QUE REQUIERE ATENCION: UNA SOLA VEZ */}
      <SectionCard accent="#f59e0b" soft="#fffbeb">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="font-black uppercase text-sm text-amber-800">Qué requiere mi atención hoy</h3>
            <p className="text-[9px] text-slate-400 mt-1">Acciones para hoy basadas en el último día completo registrado. Cada anuncio muestra la campaña que lo contiene.</p>
          </div>
          <span className="px-2 py-1 rounded-full bg-zinc-950 text-white text-[8px] font-black uppercase">Prioridad automática</span>
        </div>
        {attentionRows.length===0 ? <EmptyState>Sin anuncios activos con diagnóstico disponible.</EmptyState> :
          <div className="space-y-2">{attentionRows.slice(0,12).map(({ad,campaign,product,diag})=>(
            <button key={ad.id} onClick={()=>openDrawer(campaign.id)} className={`w-full text-left rounded-2xl border p-3 ${diag.priority==='critical'?'bg-rose-50 border-rose-200':diag.priority==='alert'?'bg-orange-50 border-orange-200':'bg-slate-50'}`}>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                <div>
                  <p className="text-[9px] font-black uppercase text-slate-500">{product.name} → {campaign.name} → {ad.name}</p>
                  <p className="font-black text-xs mt-1">{diag.finalDiagnosis || diag.diagnosis}</p>
                  <p className="text-[9px] text-slate-500 mt-1">{diag.reason}</p>
                </div>
                <div className="md:text-right">
                  <p className="text-[8px] uppercase font-black text-slate-400">Acción</p>
                  <p className="text-[10px] font-black">{diag.action}</p>
                </div>
              </div>
            </button>
          ))}</div>
        }
      </SectionCard>

      {/* KPIs VALIDADO */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <MiniCard label="Productos activos" value={activeProducts.length} />
        <MiniCard label="Escalables" value={scalableCount} tone={scalableCount?'good':'default'} />
        <MiniCard label="Mantener" value={maintainCount} />
        <MiniCard label="En alerta" value={alertCount} />
        <MiniCard label="Críticos" value={criticalCount} tone={criticalCount?'bad':'default'} />
        <MiniCard label="Gasto último cierre" value={fmtMoney(totalSpend)} />
      </div>

      <SectionCard className="border-dashed" accent="#2563eb" soft="#eff6ff">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <p className="text-[9px] font-black uppercase text-blue-700">Hoy · monitor provisional intradía</p>
            <p className="text-[8px] text-slate-500 mt-1">Solo informativo. Estos datos NO participan en diagnósticos, alertas, fatiga, guardrails ni decisiones de escala.</p>
          </div>
          <div className="grid grid-cols-4 gap-2 min-w-full lg:min-w-[440px]">
            <MiniCard label="Gasto hoy" value={fmtMoney(provisionalToday.spend)} />
            <MiniCard label="Compras hoy" value={fmtNum(provisionalToday.purchases, 2)} />
            <MiniCard label="CPA provisional" value={provisionalToday.purchases > 0 ? fmtMoney(provisionalToday.cpa) : '—'} />
            <MiniCard label="ROAS provisional" value={fmtNum(provisionalToday.roas, 2)} />
          </div>
        </div>
      </SectionCard>

      {/* FILTROS + BUSQUEDA */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex gap-2 flex-wrap">
          {[
            ['all','Todos'],['critical','🔴 Críticos'],['alert','🟠 Alertas'],
            ['scalable','🟢 Escalables'],['testing','Testing'],['scaled','Escaladas']
          ].map(([id,label])=>(
            <button key={id} onClick={()=>setStatusFilter(id)} className={`px-3 py-2 rounded-full text-[9px] font-black ${statusFilter===id?'bg-zinc-950 text-white':'bg-white border text-slate-500'}`}>{label}</button>
          ))}
        </div>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar producto o campaña..." className="w-full lg:w-[300px] border rounded-xl px-3 py-2.5 text-[10px] font-semibold outline-none focus:border-emerald-400"/>
      </div>

      {/* TABLA PRINCIPAL DE CAMPAÑAS - CLIC ABRE DRAWER */}
      <SectionCard className="p-0 overflow-hidden" accent="#6366f1" soft="#eef2ff">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1350px] text-[10px]">
            <thead className="bg-slate-50">
              <tr className="text-left uppercase text-[8px] text-slate-400">
                <th className="p-3">Estado</th><th>Producto / campaña</th><th>Presupuesto</th><th>CPA último día</th>
                <th>CPA 3D</th><th>Δ vs 3D</th><th>CPA 7D</th><th>Δ 7D</th>
                <th>Compras</th><th>Frecuencia</th><th>Salud tráfico/creativo</th><th>Diagnóstico</th><th>Acción hoy</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length===0 ? <tr><td colSpan="13" className="p-8 text-center text-slate-400">No hay campañas que coincidan con el filtro.</td></tr> :
                filteredRows.map(r=>(
                  <tr key={r.campaign.id} onClick={()=>openDrawer(r.campaign.id)} className="border-t hover:bg-slate-50 cursor-pointer">
                    <td className="p-3"><span className={`px-2 py-1 rounded-full font-black ${r.state==='Crítico'?'bg-rose-100 text-rose-700':r.state==='Alerta'?'bg-orange-100 text-orange-700':r.state==='Escalable'?'bg-emerald-100 text-emerald-700':'bg-amber-100 text-amber-700'}`}>● {r.state}</span></td>
                    <td><p className="font-black">{r.product?.name||'Producto'}</p><p className="text-[8px] text-slate-400">{r.campaign.name}</p></td>
                    <td className="font-black">{r.lastComplete?fmtMoney(r.lastComplete.budget):'—'}</td>
                    <td className={`font-black ${r.lastStats.cpa>r.maxCpa?'text-rose-600':''}`}>{r.lastComplete?fmtMoney(r.lastStats.cpa):'—'}</td>
                    <td>{r.stats3.purchases>0?fmtMoney(r.stats3.cpa):'—'}</td>
                    <td><span className={`font-black ${metricDirectionClass('cpa', r.delta3)}`}>{r.delta3===null?'—':`${r.delta3>0?'▲':'▼'} ${fmtNum(Math.abs(r.delta3), 2)}%`}</span></td>
                    <td>{r.stats7.purchases>0?fmtMoney(r.stats7.cpa):'—'}</td>
                    <td><span className={`font-black ${metricDirectionClass('cpa', r.delta7)}`}>{r.delta7===null?'—':`${r.delta7>0?'▲':'▼'} ${fmtNum(Math.abs(r.delta7), 2)}%`}</span></td>
                    <td>{fmtNum(r.purchases, 2)}</td>
                    <td>{fmtNum(r.frequency,2)}</td>
                    <td><span className="font-black">{r.creativeHealth}</span></td>
                    <td><span className="font-black">{r.diagnosis}</span></td>
                    <td><span className="font-black text-blue-600">{r.action}</span></td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* PRIORIDADES DE ACCION HOY */}
      <SectionCard accent="#ea580c" soft="#fff7ed">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-black uppercase text-sm text-orange-800">Prioridades de acción hoy</h3>
          <span className="text-[8px] text-slate-400 font-black uppercase">Lo más importante primero</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {campaignRows.filter(r=>r.lastComplete && ['Crítico','Alerta','Escalable'].includes(r.state)).slice(0,3).map(r=>(
            <button key={r.campaign.id} onClick={()=>openDrawer(r.campaign.id)} className={`text-left rounded-2xl border p-3 ${r.state==='Crítico'?'bg-rose-50 border-rose-200':r.state==='Alerta'?'bg-orange-50 border-orange-200':'bg-emerald-50 border-emerald-200'}`}>
              <p className="font-black text-xs">{r.state==='Crítico'?'🔴':r.state==='Alerta'?'🟠':'🟢'} {r.product?.name} — {r.campaign.name}</p>
              <p className="text-[9px] text-slate-600 mt-1">CPA {r.lastComplete?fmtMoney(r.lastStats.cpa):'—'}. Acción: {r.action}.</p>
            </button>
          ))}
          {!campaignRows.some(r=>r.lastComplete && ['Crítico','Alerta','Escalable'].includes(r.state)) && <EmptyState>Sin prioridades especiales según el último día completo registrado.</EmptyState>}
        </div>
      </SectionCard>

      {/* DRAWER LATERAL COMO EN LA VERSION VALIDADA */}
      {drawerCampaign && (
        <>
          <div className="fixed inset-0 bg-black/35 z-[80]" onClick={()=>setDrawerCampaignId('')}></div>
          <aside className="fixed right-0 top-0 w-[730px] max-w-[96vw] h-screen bg-white shadow-2xl z-[90] overflow-y-auto p-4 md:p-6">
            <button onClick={()=>setDrawerCampaignId('')} className="absolute right-4 top-4 w-9 h-9 rounded-xl bg-slate-100 font-black">✕</button>

            <div className="pr-12">
              <h3 className="text-xl md:text-2xl font-black uppercase">{drawerProduct?.name}</h3>
              <p className="text-[10px] text-slate-400 mt-1">{drawerCampaign.name} · Historial, variaciones y capacidad de escala</p>
            </div>

            <div className="flex gap-2 mt-5 mb-4 flex-wrap">
              {PERIODS.map(p=><button key={p.id} onClick={()=>{setDrawerPeriod(p.id);setPeriod(p.id)}} className={`px-3 py-2 rounded-lg text-[9px] font-black ${drawerPeriod===p.id?'bg-zinc-950 text-white':'bg-slate-100 text-slate-500'}`}>{p.label}</button>)}
            </div>

            <CampaignCpaMiniChart campaign={drawerCampaign} product={drawerProduct} dailyCampaigns={dailyCampaigns}/>

            <div className="mt-4 rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50/50 p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-[9px] font-black uppercase text-blue-700">Hoy · provisional</p>
                <span className="text-[7px] font-black uppercase text-blue-500">No influye en decisiones</span>
              </div>
              {drawerToday ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <MiniCard label="Gasto" value={fmtMoney(drawerTodayStats.spend)} />
                  <MiniCard label="Compras" value={fmtNum(drawerTodayStats.purchases, 2)} />
                  <MiniCard label="CPA" value={drawerTodayStats.purchases > 0 ? fmtMoney(drawerTodayStats.cpa) : '—'} />
                  <MiniCard label="Frecuencia" value={fmtNum(drawerTodayStats.frequency, 2)} />
                </div>
              ) : (
                <p className="text-[9px] text-slate-500">Sin registro intradía para hoy. El diagnóstico continúa usando el último día completo disponible.</p>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
              <MiniCard label="CPA último día" value={drawerLastComplete?fmtMoney(drawerCurrent.cpa):'—'} />
              <MiniCard label="CPA 3 días anteriores" value={drawerPrev3.purchases>0?fmtMoney(drawerPrev3.cpa):'—'} />
              <MiniCard label="Variación vs prev. 3D" value={<span className={metricDirectionClass('cpa', drawerDelta)}>{drawerDelta===null?'—':`${drawerDelta>0?'+':''}${fmtNum(drawerDelta, 2)}%`}</span>} />
              <MiniCard label="Frecuencia último día" value={drawerLastComplete?fmtNum(drawerCurrent.frequency,2):'—'} />
              <MiniCard label="Compras último día" value={drawerLastComplete?fmtNum(drawerCurrent.purchases, 2):'—'} />
              <MiniCard label="Presupuesto último cierre" value={drawerLastComplete?fmtMoney(drawerLastComplete.budget):'—'} />
              <MiniCard label="CPA máximo" value={fmtMoney(drawerProduct?.maxCpa)} />
              <MiniCard label="CPA operativo" value={fmtMoney(toNumber(drawerProduct?.maxCpa)*0.8)} />
            </div>

            <div className="mt-5">
              <CampaignDiagnosticDetail
                ownerUid={ownerUid}
                campaign={drawerCampaign}
                product={drawerProduct}
                ads={ads.filter(a=>a.campaignId===drawerCampaign.id)}
                allAds={ads}
                allCampaigns={campaigns}
                dailyAds={dailyAds}
                dailyCampaigns={dailyCampaigns}
                budgetChanges={budgetChanges}
                decisions={decisions}
                recommendations={recommendations}
                period={drawerPeriod}
              />
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

function toneText(tone) {
  return tone === 'critical' ? 'text-rose-600' : tone === 'alert' ? 'text-orange-600' : tone === 'attention' ? 'text-amber-600' : 'text-emerald-600';
}

function toneBg(tone) {
  return tone === 'critical' ? 'bg-rose-50 border-rose-200' : tone === 'alert' ? 'bg-orange-50 border-orange-200' : tone === 'attention' ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200';
}

function GuardrailPill({ ok, label }) {
  return <span className={`inline-flex px-2 py-1 rounded-full text-[8px] font-black uppercase ${ok ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'}`}>{ok ? '✓' : '✕'} {label}</span>;
}

function buildProductBenchmark(productId, dailyAds, maxCpa, allAds = [], allCampaigns = []) {
  const max = Math.max(1, toNumber(maxCpa));
  const selected = [];

  const productAds = allAds.filter(a => a.productId === productId);
  for (const ad of productAds) {
    const campaign = allCampaigns.find(c => c.id === ad.campaignId);
    if (!campaign) continue;

    const today = todayColombiaCC();
    const history = eligibleAdRecords(
      (dailyAds || []).filter(r => r.adId === ad.id && r.productId === productId),
      ad,
      campaign
    ).filter(r => String(r.date) < today)
     .sort((a,b) => String(a.date).localeCompare(String(b.date)));

    history.forEach((record, idx) => {
      if (toNumber(record.purchases) <= 0) return;
      const dayCpa = calcCpa(record.spend, record.purchases);
      if (dayCpa <= 0 || dayCpa > max) return;

      const previous = history.slice(Math.max(0, idx - 3), idx);
      if (previous.length < 3) return;
      const prevStats = aggregateRecords(previous);
      const dayStats = aggregateRecords([record]);

      const cpaDelta = pctChange(dayStats.cpa, prevStats.cpa);
      const ctrDelta = pctChange(dayStats.ctr, prevStats.ctr);
      const cpcDelta = pctChange(dayStats.cpc, prevStats.cpc);
      const cvrDelta = pctChange(dayStats.visitToPurchase, prevStats.visitToPurchase);

      const stable =
        (cpaDelta === null || Math.abs(cpaDelta) <= 15) &&
        (ctrDelta === null || Math.abs(ctrDelta) <= 15) &&
        (cpcDelta === null || Math.abs(cpcDelta) <= 15) &&
        (cvrDelta === null || Math.abs(cvrDelta) <= 15);

      if (stable) selected.push(record);
    });
  }

  const stats = aggregateRecords(selected);
  return { ...stats, sampleDays: selected.length, criteria: 'Días activos + rentables + estables' };
}

function buildCampaignDecision(campaign, product, campaignHistory, adRows, scaleRows) {
  const latest = [...campaignHistory].sort((a,b) => String(b.date).localeCompare(String(a.date)))[0];
  if (!latest) return { status: 'Sin datos', action: 'Registrar datos', reason: 'Aún no existe un registro diario para esta campaña.', recommendedBudget: null };
  const maxCpa = Math.max(1, toNumber(product?.maxCpa));
  const latestCpa = calcCpa(latest.spend, latest.purchases);
  const critical = adRows.filter(x => x.diag.priority === 'critical').length;
  const scalable = adRows.filter(x => x.diag.canScale).length;
  if (critical > 0) return { status: 'Atención', action: 'Optimizar antes de escalar', reason: `${critical} anuncio(s) presentan señal crítica.`, recommendedBudget: null };
  if (latestCpa <= maxCpa * 0.8 && scalable > 0 && toNumber(latest.budget) > 0) {
    return { status: 'Escalable', action: 'Escalar +20%', reason: 'CPA de campaña con margen y al menos un anuncio supera todos los guardrails.', recommendedBudget: Math.round((toNumber(latest.budget) * 1.2) / 1000) * 1000 };
  }
  if (latestCpa > maxCpa) {
    const candidates = scaleRows.filter(r => r.budget < toNumber(latest.budget) && r.cpa > 0 && r.cpa <= maxCpa);
    const best = candidates.sort((a,b) => b.budget - a.budget)[0];
    return { status: 'Sobreescalado / no rentable', action: best ? 'Reducir al último nivel rentable' : 'No escalar · optimizar', reason: `CPA actual ${fmtMoney(latestCpa)} supera el máximo ${fmtMoney(maxCpa)}.`, recommendedBudget: best?.budget || null };
  }
  return { status: 'Mantener', action: 'Mantener presupuesto', reason: 'Rentable, pero todavía falta algún guardrail para una escala fuerte.', recommendedBudget: null };
}

function CampaignDiagnosticDetail({ ownerUid, campaign, product, ads, allAds, allCampaigns, dailyAds, dailyCampaigns, budgetChanges, decisions, recommendations, period }) {
  const MONITOR_PERIODS = [
    { id: 'last', label: 'ÚLTIMO DÍA' },
    { id: '3d', label: '3D' },
    { id: '7d', label: '7D' },
    { id: '14d', label: '14D' },
    { id: '30d', label: '30D' }
  ];
  const [monitorPeriod, setMonitorPeriod] = useState(
    ['last', '3d', '7d', '14d', '30d'].includes(period) ? period : 'last'
  );

  useEffect(() => {
    if (['last', '3d', '7d', '14d', '30d'].includes(period)) setMonitorPeriod(period);
  }, [period]);

  const visibleAds = ads.filter(a => a.active !== false && campaign.active !== false && !campaign.archived);
  const adRows = visibleAds.map(ad => {
    const records = dailyAds.filter(r => r.adId === ad.id);
    return { ad, diag: diagnoseAd(records, product, ad, monitorPeriod, campaign) };
  }).sort((a, b) => (a.diag.stats.cpa || 999999999) - (b.diag.stats.cpa || 999999999));

  const today = todayColombiaCC();
  const campaignHistory = eligibleCampaignRecords(
    dailyCampaigns.filter(r => r.campaignId === campaign.id),
    campaign
  ).filter(r => String(r.date) < today)
   .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const scaleRows = useMemo(() => buildScaleHistory(campaignHistory, product?.maxCpa), [campaignHistory, product?.maxCpa]);
  const budgetRows = budgetChanges.filter(b => b.campaignId === campaign.id).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const decisionRows = decisions.filter(d => d.campaignId === campaign.id).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const benchmark = useMemo(
    () => buildProductBenchmark(product?.id, dailyAds, product?.maxCpa, allAds || ads, allCampaigns || [campaign]),
    [product?.id, product?.maxCpa, dailyAds, allAds, allCampaigns, ads, campaign]
  );
  const campaignDecision = useMemo(() => buildCampaignDecision(campaign, product, campaignHistory, adRows, scaleRows), [campaign, product, campaignHistory, adRows, scaleRows]);

  useEffect(() => {
    if (!ownerUid || !campaignDecision.recommendedBudget || !campaign?.id) return;
    const existing = recommendations.find(r => r.campaignId === campaign.id && r.type === 'budget' && r.status === 'active' && toNumber(r.recommendedBudget) === toNumber(campaignDecision.recommendedBudget));
    if (existing) return;
    const ref = doc(db, COLLECTIONS.recommendations, `${campaign.id}_budget_active`);
    setDoc(ref, {
      ownerUid, productId: campaign.productId, campaignId: campaign.id, type: 'budget',
      currentBudget: toNumber(campaignHistory[campaignHistory.length - 1]?.budget),
      recommendedBudget: toNumber(campaignDecision.recommendedBudget), status: 'active',
      reason: campaignDecision.reason, createdDate: todayColombiaCC(), updatedAt: serverTimestamp()
    }, { merge: true }).catch(console.error);
  }, [ownerUid, campaign.id, campaign.productId, campaignDecision.recommendedBudget, campaignDecision.reason, campaignHistory, recommendations]);

  const dynamicCounts = adRows.reduce((acc, x) => { acc[x.diag.dynamicDiagnosis] = (acc[x.diag.dynamicDiagnosis] || 0) + 1; return acc; }, {});
  const maxCpa = toNumber(product?.maxCpa);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className={`rounded-2xl p-3 ${toneBg(campaignDecision.status === 'Sobreescalado / no rentable' ? 'critical' : campaignDecision.status === 'Atención' ? 'alert' : 'normal')}`} style={{border:'2px solid #0f766e'}}>
          <p className="text-[8px] font-black uppercase text-slate-400">Motor de decisión de campaña</p>
          <p className="font-black text-sm mt-1">{campaignDecision.status}</p><p className="text-[9px] text-slate-500 mt-1">{campaignDecision.reason}</p>
          <p className="text-[10px] font-black mt-2">Acción: {campaignDecision.action}</p>
          {campaignDecision.recommendedBudget ? <p className="text-[10px] font-black text-emerald-700 mt-1">Presupuesto recomendado: {fmtMoney(campaignDecision.recommendedBudget)}</p> : null}
        </div>
        <div className="rounded-2xl p-3 bg-blue-50" style={{border:'2px solid #2563eb'}}><p className="text-[8px] font-black uppercase text-blue-700">Salud de tráfico y creativo</p><p className="font-black text-sm mt-1">{adRows.length} anuncios activos</p><p className="text-[9px] text-slate-500 mt-1">Estables: {dynamicCounts['Estable'] || 0} · Fatiga temprana: {dynamicCounts['Fatiga temprana'] || 0} · Probable/confirmada: {(dynamicCounts['Fatiga probable'] || 0) + (dynamicCounts['Fatiga confirmada'] || 0)}</p></div>
        <div className="rounded-2xl p-3 bg-orange-50" style={{border:'2px solid #ea580c'}}><p className="text-[8px] font-black uppercase text-orange-700">Motor de fatiga y saturación</p><p className="text-[9px] text-slate-600 mt-1">CTR ↓ + CPC ↑ + Frecuencia ↑ + CPA ↑ = fatiga. CPM ↑ con CTR/CVR estables = subasta cara, no necesariamente fatiga.</p></div>
      </div>

      <div className="rounded-2xl p-3 md:p-4 bg-cyan-50" style={{border:'2px solid #0891b2'}}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <p className="text-[9px] font-black uppercase text-cyan-800">Período de monitoreo por anuncio</p>
            <p className="text-[8px] text-slate-500 mt-1">Controla Variaciones dinámicas, Embudo post-clic, diagnóstico consolidado y guardrails.</p>
          </div>
          <div className="flex bg-slate-100 p-1 rounded-xl w-fit">
            {MONITOR_PERIODS.map(p => (
              <button
                key={p.id}
                onClick={() => setMonitorPeriod(p.id)}
                className={`px-4 py-2 rounded-lg text-[9px] font-black transition ${monitorPeriod === p.id ? 'bg-zinc-950 text-white shadow-sm' : 'text-slate-500 hover:text-zinc-900'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[8px] text-slate-500 mt-3">
          <strong>{monitorPeriod === 'last' ? 'ÚLTIMO DÍA' : monitorPeriod.toUpperCase()}:</strong> {variationExplanation(monitorPeriod)} Los días OFF se excluyen completamente del período y no cuentan como cero. Los registros de HOY también se excluyen del diagnóstico por ser intradía.
        </p>
      </div>

      <div className="bg-blue-50 rounded-2xl p-3" style={{border:'2px solid #3b82f6'}}><p className="text-[9px] font-black uppercase text-blue-700">Cómo funcionan las variaciones por anuncio</p><p className="text-[9px] text-blue-600 mt-1">{variationExplanation(monitorPeriod)} Bandas: 0–10% normal · &gt;10–15% atención · &gt;15–20% alerta · &gt;20% crítica. La dirección se interpreta según la métrica.</p></div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="rounded-2xl p-3 bg-cyan-50" style={{border:'2px solid #0891b2'}}>
          <p className="text-[8px] font-black uppercase text-cyan-700">Regla de inclusión de datos</p>
          <p className="text-[9px] text-slate-600 mt-1">Los días en que la campaña o el anuncio estuvo OFF se excluyen totalmente de Hoy/3D/7D/14D/30D, benchmark y escala rentable. No se convierten en ceros.</p>
        </div>
        <div className="rounded-2xl p-3 bg-indigo-50" style={{border:'2px solid #6366f1'}}>
          <p className="text-[8px] font-black uppercase text-indigo-700">Jerarquía ON/OFF</p>
          <p className="text-[9px] text-slate-600 mt-1">Apagar campaña apaga sus anuncios. Al encenderla se restaura el estado individual previo. Apagar un anuncio no afecta a los demás.</p>
        </div>
        <div className="rounded-2xl p-3 bg-amber-50" style={{border:'2px solid #d97706'}}>
          <p className="text-[8px] font-black uppercase text-amber-700">Confianza del diagnóstico</p>
          <p className="text-[9px] text-slate-600 mt-1">&lt;5 compras baja · 5–14 media · 15–29 alta · 30+ muy alta. La antigüedad se calcula con días realmente activos: &lt;3 limita a baja y 3–6 limita a media.</p>
        </div>
      </div>

      <div className="rounded-2xl border-2 p-3 md:p-4 bg-white shadow-sm" style={{ borderColor: '#2563eb' }}>
        <div className="flex items-center justify-between gap-2 mb-3 pb-2 border-b" style={{ borderColor: '#bfdbfe' }}><h4 className="text-xs font-black uppercase text-blue-800">Variaciones dinámicas por anuncio</h4><span className="px-2 py-1 rounded-full bg-zinc-950 text-white text-[8px] font-black">{monitorPeriod === 'last' ? 'ÚLTIMO DÍA' : monitorPeriod.toUpperCase()}</span></div>
        {adRows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1250px] text-left text-[10px] border-separate border-spacing-y-1"><thead><tr className="border-b text-[8px] font-black uppercase text-slate-400"><th className="py-2">Anuncio</th><th>CPA</th><th>Δ CPA</th><th>CTR</th><th>Δ CTR</th><th>CPC</th><th>Δ CPC</th><th>CPM</th><th>Δ CPM</th><th>Frecuencia</th><th>Δ Frec.</th><th>CVR</th><th>Δ CVR</th><th>Diagnóstico dinámico</th><th>Acción</th></tr></thead><tbody>{adRows.map(({ad,diag}) => <tr
          key={ad.id}
          className="border-b-4 border-white"
          style={{ backgroundColor: ccVisualAccent(ad.id || ad.name).soft, boxShadow: `inset 5px 0 0 ${ccVisualAccent(ad.id || ad.name).border}` }}
        ><td className="py-3 pl-3 font-black" style={{ color: ccVisualAccent(ad.id || ad.name).text }}>{ad.name}</td><td>{fmtMoney(diag.stats.cpa)}</td><td><Delta metric="cpa" value={diag.delta.cpa}/></td><td>{fmtNum(diag.stats.ctr,2)}%</td><td><Delta metric="ctr" value={diag.delta.ctr}/></td><td>{fmtMoney(diag.stats.cpc)}</td><td><Delta metric="cpc" value={diag.delta.cpc}/></td><td>{fmtMoney(diag.stats.cpm)}</td><td><Delta metric="cpm" value={diag.delta.cpm}/></td><td>{fmtNum(diag.stats.frequency,2)}</td><td><Delta metric="frequency" value={diag.delta.frequency}/></td><td>{fmtNum(diag.stats.visitToPurchase, 2)}%</td><td><Delta metric="visitToPurchase" value={diag.delta.visitToPurchase}/></td><td className={`font-black ${toneText(diag.dynamicTone)}`}>{diag.dynamicDiagnosis}</td><td className="font-black">{diag.dynamicAction}</td></tr>)}</tbody></table></div> : <EmptyState>No hay anuncios activos con datos para esta campaña.</EmptyState>}
      </div>

      <div className="rounded-2xl border-2 p-3 md:p-4 bg-white shadow-sm" style={{ borderColor: '#7c3aed' }}>
        <div className="flex items-center justify-between gap-2 mb-3 pb-2 border-b" style={{ borderColor: '#ddd6fe' }}><h4 className="text-xs font-black uppercase text-violet-800">Embudo post-clic dinámico por anuncio</h4><span className="px-2 py-1 rounded-full bg-zinc-950 text-white text-[8px] font-black">{monitorPeriod === 'last' ? 'ÚLTIMO DÍA' : monitorPeriod.toUpperCase()}</span></div>
        {adRows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1250px] text-left text-[10px] border-separate border-spacing-y-1"><thead><tr className="border-b text-[8px] font-black uppercase text-slate-400"><th className="py-2">Anuncio</th><th>Visitas</th><th>ATC</th><th>Compras</th><th>V→ATC</th><th>Δ</th><th>V→Compra</th><th>Δ</th><th>ATC→Compra</th><th>Δ</th><th>Diagnóstico post-clic</th><th>Acción</th></tr></thead><tbody>{adRows.map(({ad,diag}) => <tr
          key={ad.id}
          className="border-b-4 border-white"
          style={{ backgroundColor: ccVisualAccent(ad.id || ad.name, 1).soft, boxShadow: `inset 5px 0 0 ${ccVisualAccent(ad.id || ad.name, 1).border}` }}
        ><td className="py-3 pl-3 font-black" style={{ color: ccVisualAccent(ad.id || ad.name, 1).text }}>{ad.name}</td><td>{fmtNum(diag.stats.landingViews, 2)}</td><td>{fmtNum(diag.stats.atc, 2)}</td><td>{fmtNum(diag.stats.purchases, 2)}</td><td className="font-black">{fmtNum(diag.stats.visitToAtc, 2)}%</td><td><Delta metric="visitToAtc" value={diag.delta.visitToAtc}/></td><td className="font-black">{fmtNum(diag.stats.visitToPurchase, 2)}%</td><td><Delta metric="visitToPurchase" value={diag.delta.visitToPurchase}/></td><td className="font-black">{fmtNum(diag.stats.atcToPurchase, 2)}%</td><td><Delta metric="atcToPurchase" value={diag.delta.atcToPurchase}/></td><td className={`font-black ${toneText(diag.postTone)}`}>{diag.postDiagnosis}</td><td className="font-black">{diag.postAction}</td></tr>)}</tbody></table></div> : <EmptyState>Sin datos post-clic disponibles.</EmptyState>}
      </div>

      <div className="rounded-2xl border-2 p-3 md:p-4 bg-white shadow-sm" style={{ borderColor: '#059669' }}>
        <div className="flex items-center justify-between gap-2 mb-3 pb-2 border-b" style={{ borderColor: '#a7f3d0' }}><h4 className="text-xs font-black uppercase text-emerald-800">Optimización por anuncio — diagnóstico consolidado</h4><span className="text-[8px] font-black uppercase text-slate-400">Ventana {monitorPeriod === 'last' ? 'ÚLTIMO DÍA' : monitorPeriod.toUpperCase()}</span></div>
        {adRows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1250px] text-left text-[10px] border-separate border-spacing-y-1"><thead><tr className="border-b text-[8px] font-black uppercase text-slate-400"><th className="py-2">Anuncio</th><th>CPA</th><th>Dinámico</th><th>Post-clic</th><th>Diagnóstico final</th><th>Confianza</th><th>Por qué</th><th>Acción recomendada</th></tr></thead><tbody>{adRows.map(({ad,diag}) => <tr
          key={ad.id}
          className="border-b-4 border-white"
          style={{ backgroundColor: ccVisualAccent(ad.id || ad.name, 2).soft, boxShadow: `inset 5px 0 0 ${ccVisualAccent(ad.id || ad.name, 2).border}` }}
        ><td className="py-3 pl-3"><p className="font-black" style={{ color: ccVisualAccent(ad.id || ad.name, 2).text }}>{ad.name}</p><p className="text-[8px] text-slate-400">{diag.ageDays} días activos</p></td><td className="font-black">{fmtMoney(diag.stats.cpa)}</td><td>{diag.dynamicDiagnosis}</td><td>{diag.postDiagnosis}</td><td className={`font-black ${diag.priority === 'critical' ? 'text-rose-600' : diag.priority === 'alert' ? 'text-orange-600' : 'text-emerald-600'}`}>{diag.finalDiagnosis}</td><td className="font-black">{diag.confidence}</td><td className="max-w-[330px] text-slate-500">{diag.reason}</td><td className="font-black">{diag.action}</td></tr>)}</tbody></table></div> : <EmptyState>Sin anuncios activos.</EmptyState>}
      </div>

      <div className="rounded-2xl p-3 md:p-4 bg-cyan-50/40 shadow-sm" style={{border:'2px solid #0891b2'}}>
        <h4 className="text-xs font-black uppercase mb-3 text-cyan-800">Historial de cambios de presupuesto</h4>
        {budgetRows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-[10px]"><thead><tr className="text-left text-slate-400 uppercase text-[8px]"><th>Fecha</th><th>Anterior</th><th>Nuevo</th><th>Cambio</th><th>Origen</th></tr></thead><tbody>{budgetRows.map((r,i) => <tr key={r.id} className="border-t" style={{backgroundColor:i%2===0?'#ecfeff':'#ffffff'}}><td className="py-2">{r.date}</td><td>{fmtMoney(r.previousBudget)}</td><td>{fmtMoney(r.newBudget)}</td><td className="font-black">{fmtNum(r.changePct, 2)}%</td><td>{r.origin === 'recommendation' ? 'Recomendación aplicada' : 'Cambio manual'}</td></tr>)}</tbody></table></div> : <EmptyState>Se construirá automáticamente al detectar cambios entre registros diarios.</EmptyState>}
      </div>

      <div className="rounded-2xl p-3 md:p-4 bg-emerald-50/40 shadow-sm" style={{border:'2px solid #059669'}}>
        <h4 className="text-xs font-black uppercase mb-3 text-emerald-800">Historial de escala rentable</h4>
        {scaleRows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-[10px]"><thead><tr className="text-left text-slate-400 uppercase text-[8px]"><th>Presupuesto</th><th>Días</th><th>Gasto</th><th>Compras</th><th>CPA ponderado</th><th>ROAS</th><th>CPA marginal</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{scaleRows.map((r,i) => <tr key={r.budget} className="border-t" style={{backgroundColor:i%2===0?'#ecfdf5':'#ffffff'}}><td className="py-2 font-black">{fmtMoney(r.budget)}</td><td>{r.days}</td><td>{fmtMoney(r.spend)}</td><td>{fmtNum(r.purchases, 2)}</td><td>{fmtMoney(r.cpa)}</td><td>{fmtNum(r.roas,2)}</td><td>{r.marginalCpa === null ? '—' : fmtMoney(r.marginalCpa)}</td><td className={`font-black ${r.status === 'Rentable' ? 'text-emerald-600' : r.status.includes('Sobreescalado') || r.status.includes('ineficiente') ? 'text-rose-600' : 'text-amber-600'}`}>{r.status}</td><td className="font-black">{r.action}</td></tr>)}</tbody></table></div> : <EmptyState>Se construirá automáticamente con los datos diarios registrados.</EmptyState>}
      </div>

      <div className="rounded-2xl p-3 md:p-4 bg-indigo-50/40 shadow-sm" style={{border:'2px solid #6366f1'}}>
        <h4 className="text-xs font-black uppercase mb-3 text-indigo-800">Línea de tiempo de decisiones</h4>
        {decisionRows.length ? <div className="space-y-2">{decisionRows.slice(0,30).map((r,i) => <div key={r.id} className="flex gap-3 rounded-xl pl-3 py-2" style={{border:`2px solid ${ccVisualAccent(r.id||r.action,i).border}`,backgroundColor:ccVisualAccent(r.id||r.action,i).soft}}><div className="text-[9px] text-slate-400 w-20 shrink-0">{r.date}</div><div><p className="text-[10px] font-black">{r.action}</p>{r.detail && <p className="text-[9px] text-slate-500">{r.detail}</p>}</div></div>)}</div> : <EmptyState>Sin decisiones registradas todavía.</EmptyState>}
      </div>

      <div className="rounded-2xl p-3 md:p-4 bg-pink-50/40 shadow-sm" style={{border:'2px solid #db2777'}}>
        <h4 className="text-xs font-black uppercase mb-3 text-pink-800">Benchmark propio del producto</h4>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2"><MiniCard label="Días rentables" value={benchmark.days}/><MiniCard label="CPA ponderado" value={fmtMoney(benchmark.cpa)}/><MiniCard label="CTR" value={`${fmtNum(benchmark.ctr,2)}%`}/><MiniCard label="CPC" value={fmtMoney(benchmark.cpc)}/><MiniCard label="Frecuencia" value={fmtNum(benchmark.frequency,2)}/><MiniCard label="Visita→Compra" value={`${fmtNum(benchmark.visitToPurchase, 2)}%`}/></div>
        <p className="text-[8px] text-slate-400 mt-2">Benchmark calculado únicamente con días del producto cuyo CPA estuvo dentro del máximo configurado.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-2xl p-3 bg-slate-50" style={{border:'2px solid #475569'}}><h4 className="text-xs font-black uppercase mb-2 text-slate-700">Cómo se dispara cada diagnóstico</h4><div className="space-y-2 text-[9px] text-slate-600"><p><strong>Fatiga:</strong> CPA ↑ + CTR ↓ + CPC ↑ + frecuencia ↑.</p><p><strong>Subasta cara:</strong> CPM ↑ mientras CTR/CVR permanecen estables.</p><p><strong>Problema post-clic:</strong> CPA ↑ con CTR/CPC estables y conversión post-clic ↓.</p><p><strong>Fuga al cierre:</strong> intención inicial sana pero ATC→Compra y Visita→Compra caen.</p></div></div>
        <div className="rounded-2xl p-3 bg-violet-50" style={{border:'2px solid #7c3aed'}}><h4 className="text-xs font-black uppercase mb-2 text-violet-800">Matriz de diagnóstico por combinación de métricas</h4><div className="space-y-2 text-[9px] text-slate-600"><p>CTR ↓ + CPC ↑ + Frecuencia ↑ + CPA ↑ → <strong>Fatiga / saturación</strong></p><p>CPM ↑ + CTR estable + CVR estable → <strong>Subasta más cara</strong></p><p>CTR estable + CPC estable + CVR ↓ → <strong>Landing/oferta/cierre</strong></p><p>V→ATC ↓ + V→Compra ↓ → <strong>Calidad de tráfico deteriorada</strong></p></div></div>
      </div>

      <div className="rounded-2xl p-3 md:p-4 bg-orange-50/40 shadow-sm" style={{border:'2px solid #ea580c'}}>
        <h4 className="text-xs font-black uppercase mb-3 text-orange-800">Guardrails de escalado</h4>
        {adRows.length ? <div className="space-y-2">{adRows.map(({ad,diag}) => {const adAccent=ccVisualAccent(ad.id||ad.name,3);return <div key={ad.id} className="rounded-xl p-2.5 flex flex-col md:flex-row md:items-center gap-2 justify-between" style={{border:`2px solid ${adAccent.border}`,backgroundColor:adAccent.soft}}><div><p className="text-[10px] font-black" style={{color:adAccent.text}}>{ad.name}</p><p className="text-[8px] text-slate-400">Para escala fuerte deben pasar los 5 controles.</p></div><div className="flex flex-wrap gap-1"><GuardrailPill ok={diag.guardrails.cpaMargin} label={`CPA ≤ ${fmtMoney(maxCpa*0.8)}`}/><GuardrailPill ok={diag.guardrails.stability} label="3D estable"/><GuardrailPill ok={diag.guardrails.volume} label="15+ compras"/><GuardrailPill ok={diag.guardrails.creative} label="Creativo sano"/><GuardrailPill ok={diag.guardrails.postClick} label="Post-clic sano"/></div><span className={`px-2 py-1 rounded-full text-[8px] font-black ${diag.canScale ? 'bg-emerald-500 text-zinc-950' : 'bg-zinc-100 text-zinc-500'}`}>{diag.canScale ? 'ESCALA PERMITIDA' : 'NO ESCALAR'}</span></div>})}</div> : <EmptyState>Sin anuncios activos.</EmptyState>}
      </div>

      <div className="rounded-2xl p-3 md:p-4 bg-blue-50/40 shadow-sm" style={{border:'2px solid #2563eb'}}>
        <h4 className="text-xs font-black uppercase mb-3 text-blue-800">Nivel de confianza del diagnóstico</h4>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-[9px]"><div className="bg-rose-50 rounded-xl p-3 border-2 border-rose-200"><strong className="text-rose-700">&lt;5 compras</strong><br/>Baja</div><div className="bg-amber-50 rounded-xl p-3 border-2 border-amber-200"><strong className="text-amber-700">5–14</strong><br/>Media</div><div className="bg-blue-50 rounded-xl p-3 border-2 border-blue-200"><strong className="text-blue-700">15–29</strong><br/>Alta</div><div className="bg-emerald-50 rounded-xl p-3 border-2 border-emerald-200"><strong className="text-emerald-700">30+</strong><br/>Muy alta</div></div>
        <p className="text-[8px] text-slate-400 mt-2">Antigüedad: &lt;3 días limita la confianza a Baja; 3–6 días la limita a Media; 7+ días no aplica penalización.</p>
      </div>
    </div>
  );
}

function buildScaleHistory(records, maxCpa) {
  const groups = new Map();
  (records || []).forEach(r => {
    const budget = toNumber(r.budget);
    if (budget <= 0) return;
    if (!groups.has(budget)) groups.set(budget, []);
    groups.get(budget).push(r);
  });
  const rows = [...groups.entries()].map(([budget, recs]) => {
    const stats = aggregateRecords(recs);
    return { budget, days: recs.length, spend: stats.spend, purchases: stats.purchases, cpa: stats.cpa, roas: stats.roas, marginalCpa: null };
  }).sort((a, b) => a.budget - b.budget);
  rows.forEach((r, idx) => {
    if (idx === 0) return;
    const prev = rows[idx - 1];
    const extraSpend = r.spend - prev.spend;
    const extraPurchases = r.purchases - prev.purchases;
    r.marginalCpa = extraSpend > 0 && extraPurchases > 0 ? extraSpend / extraPurchases : null;
  });
  const max = Math.max(1, toNumber(maxCpa));
  return rows.map(r => {
    let status = 'Observación', action = 'Mantener';
    if (r.cpa > 0 && r.cpa <= max * 0.8) { status = 'Rentable'; action = 'Escala candidata'; }
    else if (r.cpa > 0 && r.cpa <= max) { status = 'Límite rentable'; action = 'Mantener'; }
    else if (r.cpa > 0) { status = 'Sobreescalado'; action = 'Reducir'; }
    if (r.marginalCpa !== null && r.marginalCpa > max) { status = 'Escala ineficiente'; action = 'Volver al nivel anterior'; }
    return { ...r, status, action };
  });
}

function CampaignManager({ ownerUid, products, campaigns, ads, dailyCampaigns, dailyAds, budgetChanges, recommendations, decisions }) {
  const [productForm, setProductForm] = useState({ name: '', maxCpa: '20000', createdDate: todayColombiaCC() });
  const [campaignNameByProduct, setCampaignNameByProduct] = useState({});
  const [adNameByCampaign, setAdNameByCampaign] = useState({});
  const [expanded, setExpanded] = useState({});
  const [showArchived, setShowArchived] = useState(false);
  const [managerMessage, setManagerMessage] = useState(null);
  const [busyKey, setBusyKey] = useState('');
  const today = todayColombiaCC();

  const showManagerMessage = (type, text) => {
    setManagerMessage({ type, text });
    window.setTimeout(() => setManagerMessage(null), 4500);
  };

  const readableFirebaseError = (error, action) => {
    const code = error?.code || '';
    if (code.includes('permission-denied')) return `${action}: Firestore bloqueó la escritura. Debes permitir la colección correspondiente en las reglas de Firebase.`;
    if (code.includes('unavailable')) return `${action}: Firebase no está disponible temporalmente.`;
    return `${action}: ${error?.message || 'No fue posible completar la operación.'}`;
  };

  const addProduct = async () => {
    if (!productForm.name.trim() || toNumber(productForm.maxCpa) <= 0) return;
    const startDate = productForm.createdDate || today;
    if (startDate > today) return alert('La fecha de inicio del producto no puede ser posterior a hoy.');
    await addDoc(collection(db, COLLECTIONS.products), {
      ownerUid,
      name: productForm.name.trim(),
      maxCpa: toNumber(productForm.maxCpa),
      active: true,
      createdDate: startDate,
      stateChangedDate: startDate,
      stateHistory: [{ date: startDate, active: true }],
      createdAt: serverTimestamp()
    });
    setProductForm({ name: '', maxCpa: '20000', createdDate: todayColombiaCC() });
  };
  const editProduct = async product => {
    const name = window.prompt('Nombre del producto:', product.name); if (!name) return;
    const maxCpa = window.prompt('CPA máximo Meta:', String(product.maxCpa || 20000)); if (!maxCpa || toNumber(maxCpa) <= 0) return;
    await updateDoc(doc(db, COLLECTIONS.products, product.id), { name: name.trim(), maxCpa: toNumber(maxCpa), updatedAt: serverTimestamp() });
  };
  const toggleProduct = async product => {
    const next = product.active === false;
    await updateDoc(doc(db, COLLECTIONS.products, product.id), { active: next, stateChangedDate: today, stateHistory: [...(product.stateHistory || []), { date: today, active: next }], stateChangedAt: serverTimestamp() });
  };
  const deleteProduct = async product => {
    if (campaigns.some(c => c.productId === product.id)) return alert('Primero archiva o elimina las campañas de este producto.');
    if (!window.confirm(`¿Eliminar definitivamente ${product.name}?`)) return;
    await deleteDoc(doc(db, COLLECTIONS.products, product.id));
  };
  const addCampaign = async productId => {
    const name = String(campaignNameByProduct[productId] || '').trim();
    if (!name) {
      showManagerMessage('error', 'Escribe el nombre de la campaña antes de crearla.');
      return;
    }
    if (!ownerUid) {
      showManagerMessage('error', 'No hay una sesión autenticada disponible para guardar la campaña.');
      return;
    }
    const parentProduct = products.find(p => p.id === productId);
    if (!parentProduct) {
      showManagerMessage('error', 'No se encontró el producto al que pertenece la campaña.');
      return;
    }
    if (campaigns.some(c => c.productId === productId && !c.archived && String(c.name || '').trim().toLowerCase() === name.toLowerCase())) {
      showManagerMessage('error', `Ya existe una campaña llamada "${name}" dentro de este producto.`);
      return;
    }

    const effectiveStartDate = dateToIso(parentProduct.createdDate) || today;
    const ref = doc(collection(db, COLLECTIONS.campaigns));
    setBusyKey(`campaign:${productId}`);
    try {
      await setDoc(ref, {
        ownerUid,
        productId,
        name,
        active: true,
        archived: false,
        // Fecha técnica de alta: hoy. Fecha efectiva: permite cargar histórico.
        createdDate: today,
        effectiveStartDate,
        stateChangedDate: effectiveStartDate,
        stateHistory: [{ date: effectiveStartDate, active: true }],
        createdAt: serverTimestamp(),
        previousAdStates: {}
      });
      setCampaignNameByProduct(x => ({ ...x, [productId]: '' }));
      setExpanded(x => ({ ...x, [ref.id]: true }));
      showManagerMessage('success', `Campaña "${name}" creada correctamente.`);
    } catch (error) {
      console.error('Campaign Control · crear campaña', error);
      showManagerMessage('error', readableFirebaseError(error, 'No se pudo crear la campaña'));
    } finally {
      setBusyKey('');
    }
  };
  const toggleCampaign = async campaign => {
    const campaignAds = ads.filter(a => a.campaignId === campaign.id);
    const batch = writeBatch(db);
    if (campaign.active !== false) {
      const previousAdStates = {};
      campaignAds.forEach(a => { previousAdStates[a.id] = a.active !== false; });
      batch.update(doc(db, COLLECTIONS.campaigns, campaign.id), { active: false, previousAdStates, stateChangedDate: today, stateHistory: [...(campaign.stateHistory || []), { date: today, active: false }], stateChangedAt: serverTimestamp() });
      campaignAds.forEach(a => batch.update(doc(db, COLLECTIONS.ads, a.id), { active: false, savedActiveBeforeCampaignOff: a.active !== false, disabledByCampaign: true, stateChangedDate: today, stateHistory: [...(a.stateHistory || []), { date: today, active: false }], stateChangedAt: serverTimestamp() }));
      await batch.commit(); await addDecision(ownerUid, campaign, null, 'Campaña apagada', 'Todos los anuncios fueron apagados por jerarquía.');
    } else {
      const previous = campaign.previousAdStates || {};
      batch.update(doc(db, COLLECTIONS.campaigns, campaign.id), { active: true, stateChangedDate: today, stateHistory: [...(campaign.stateHistory || []), { date: today, active: true }], stateChangedAt: serverTimestamp() });
      campaignAds.forEach(a => { const restored = previous[a.id] !== undefined ? previous[a.id] : (a.savedActiveBeforeCampaignOff === true); batch.update(doc(db, COLLECTIONS.ads, a.id), { active: restored, disabledByCampaign: false, stateChangedDate: today, stateHistory: [...(a.stateHistory || []), { date: today, active: restored }], stateChangedAt: serverTimestamp() }); });
      await batch.commit(); await addDecision(ownerUid, campaign, null, 'Campaña encendida', 'Se restauró el estado individual previo de los anuncios.');
    }
  };
  const archiveCampaign = async campaign => {
    if (!window.confirm(`¿Archivar ${campaign.name}? Se conserva todo el histórico.`)) return;
    const campaignAds = ads.filter(a => a.campaignId === campaign.id); const batch = writeBatch(db);
    batch.update(doc(db, COLLECTIONS.campaigns, campaign.id), { archived: true, active: false, archivedDate: today, stateChangedDate: today, stateHistory: [...(campaign.stateHistory || []), { date: today, active: false }], archivedAt: serverTimestamp() });
    campaignAds.forEach(a => batch.update(doc(db, COLLECTIONS.ads, a.id), { active: false, savedActiveBeforeCampaignOff: a.active !== false, disabledByCampaign: true, stateChangedDate: today, stateHistory: [...(a.stateHistory || []), { date: today, active: false }], stateChangedAt: serverTimestamp() }));
    await batch.commit(); await addDecision(ownerUid, campaign, null, 'Campaña archivada', 'Histórico conservado; excluida del análisis activo.');
  };
  const restoreCampaign = async campaign => {
    await updateDoc(doc(db, COLLECTIONS.campaigns, campaign.id), { archived: false, active: false, archivedDate: null, restoredDate: today, stateChangedDate: today, restoredAt: serverTimestamp() });
    await addDecision(ownerUid, campaign, null, 'Campaña restaurada', 'Restaurada como apagada. Enciéndela cuando corresponda.');
  };
  const permanentDeleteCampaign = async campaign => {
    if (!window.confirm(`ELIMINACIÓN DEFINITIVA: ¿borrar ${campaign.name} y todo su histórico Campaign Control?`)) return;
    const targets = [...ads.filter(x => x.campaignId === campaign.id).map(x => [COLLECTIONS.ads,x.id]), ...dailyCampaigns.filter(x => x.campaignId === campaign.id).map(x => [COLLECTIONS.dailyCampaigns,x.id]), ...dailyAds.filter(x => x.campaignId === campaign.id).map(x => [COLLECTIONS.dailyAds,x.id]), ...budgetChanges.filter(x => x.campaignId === campaign.id).map(x => [COLLECTIONS.budgetChanges,x.id]), ...recommendations.filter(x => x.campaignId === campaign.id).map(x => [COLLECTIONS.recommendations,x.id]), ...decisions.filter(x => x.campaignId === campaign.id).map(x => [COLLECTIONS.decisions,x.id]), [COLLECTIONS.campaigns,campaign.id]];
    for (let i=0;i<targets.length;i+=400) { const batch=writeBatch(db); targets.slice(i,i+400).forEach(([col,id])=>batch.delete(doc(db,col,id))); await batch.commit(); }
  };
  const addAd = async campaign => {
    const name = String(adNameByCampaign[campaign.id] || '').trim();
    if (!name) {
      showManagerMessage('error', 'Escribe el nombre del anuncio antes de crearlo.');
      return;
    }
    if (!ownerUid) {
      showManagerMessage('error', 'No hay una sesión autenticada disponible para guardar el anuncio.');
      return;
    }
    if (!campaign?.id) {
      showManagerMessage('error', 'No se pudo identificar la campaña.');
      return;
    }
    if (campaign.archived) {
      showManagerMessage('error', 'No puedes agregar anuncios a una campaña archivada.');
      return;
    }

    const normalizedName = normalizeAdName(name);
    if (ads.some(a => a.campaignId === campaign.id && normalizeAdName(a.name) === normalizedName)) {
      showManagerMessage('error', `Ya existe un anuncio llamado "${name}" dentro de esta campaña.`);
      return;
    }

    const parentProduct = products.find(p => p.id === campaign.productId);
    const effectiveStartDate =
      dateToIso(campaign.effectiveStartDate) ||
      dateToIso(parentProduct?.createdDate) ||
      today;

    const ref = doc(collection(db, COLLECTIONS.ads));
    setBusyKey(`ad:${campaign.id}`);
    try {
      await setDoc(ref, {
        ownerUid,
        productId: campaign.productId,
        campaignId: campaign.id,
        name,
        normalizedName,
        active: campaign.active !== false,
        // Alta técnica hoy; fecha efectiva conserva la posibilidad de backfill.
        createdDate: today,
        effectiveStartDate,
        stateChangedDate: effectiveStartDate,
        stateHistory: [{ date: effectiveStartDate, active: campaign.active !== false }],
        createdAt: serverTimestamp(),
        stateChangedAt: serverTimestamp(),
        disabledByCampaign: campaign.active === false
      });
      setAdNameByCampaign(x => ({ ...x, [campaign.id]: '' }));
      setExpanded(x => ({ ...x, [campaign.id]: true }));
      showManagerMessage('success', `Anuncio "${name}" creado correctamente en "${campaign.name}".`);
    } catch (error) {
      console.error('Campaign Control · crear anuncio', error);
      showManagerMessage('error', readableFirebaseError(error, 'No se pudo crear el anuncio'));
    } finally {
      setBusyKey('');
    }
  };
  const toggleAd = async (ad,campaign) => {
    if(campaign.active===false&&ad.active===false) return alert('Primero debes encender la campaña.');
    const next=ad.active===false;
    await updateDoc(doc(db,COLLECTIONS.ads,ad.id),{ active:next,savedActiveBeforeCampaignOff:next,disabledByCampaign:false,stateChangedDate:today,stateHistory:[...(ad.stateHistory||[]),{date:today,active:next}],stateChangedAt:serverTimestamp() });
    await addDecision(ownerUid,campaign,ad,next?'Anuncio encendido':'Anuncio apagado',`Estado cambiado manualmente: ${ad.name}`);
  };
  const deleteAd = async (ad,campaign) => {
    const relatedDaily=dailyAds.filter(x=>x.adId===ad.id); const relatedDecisions=decisions.filter(x=>x.adId===ad.id); const relatedRecommendations=recommendations.filter(x=>x.adId===ad.id);
    const ok=window.confirm(`¿Eliminar definitivamente el anuncio "${ad.name}" de "${campaign.name}"?\n\nSe eliminarán también ${relatedDaily.length} registro(s) diarios y sus decisiones/recomendaciones asociadas. La campaña y los demás anuncios NO se modificarán.`);
    if(!ok) return;
    const targets=[...relatedDaily.map(x=>[COLLECTIONS.dailyAds,x.id]),...relatedDecisions.map(x=>[COLLECTIONS.decisions,x.id]),...relatedRecommendations.map(x=>[COLLECTIONS.recommendations,x.id]),[COLLECTIONS.ads,ad.id]];
    for(let i=0;i<targets.length;i+=400){const batch=writeBatch(db);targets.slice(i,i+400).forEach(([col,id])=>batch.delete(doc(db,col,id)));await batch.commit();}
  };

  return <div className="space-y-5">
    {managerMessage && <div className={`rounded-2xl border p-3 text-[10px] font-black ${managerMessage.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>{managerMessage.type === 'success' ? '✓ ' : '⚠ '}{managerMessage.text}</div>}
    <SectionCard accent="#059669" soft="#ecfdf5"><div className="flex flex-col md:flex-row md:items-end gap-3"><div className="flex-1"><p className="text-[9px] font-black uppercase text-emerald-700 mb-1">Nuevo producto Campaign Control</p><input value={productForm.name} onChange={e=>setProductForm(x=>({...x,name:e.target.value}))} placeholder="Ej: ACTIVE CHIC" className="w-full bg-slate-50 rounded-xl px-3 py-2.5 text-sm font-bold outline-none"/></div><div className="md:w-48"><p className="text-[9px] font-black uppercase text-slate-400 mb-1">CPA máximo</p><input type="number" value={productForm.maxCpa} onChange={e=>setProductForm(x=>({...x,maxCpa:e.target.value}))} className="w-full bg-slate-50 rounded-xl px-3 py-2.5 text-sm font-bold outline-none"/></div><div className="md:w-48"><p className="text-[9px] font-black uppercase text-slate-400 mb-1">Fecha de inicio</p><input type="date" max={today} value={productForm.createdDate} onChange={e=>setProductForm(x=>({...x,createdDate:e.target.value}))} className="w-full bg-slate-50 rounded-xl px-3 py-2.5 text-sm font-bold outline-none"/><p className="text-[7px] text-slate-400 mt-1">Puede ser anterior a hoy</p></div><button onClick={addProduct} className="bg-emerald-500 text-zinc-950 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase flex items-center gap-2"><Plus size={14}/> Crear producto</button></div></SectionCard>
    {products.length===0?<EmptyState>No existen productos dentro de Campaign Control.</EmptyState>:products.map(product=>{const productCampaigns=campaigns.filter(c=>c.productId===product.id&&(showArchived||!c.archived));const productAccent=ccVisualAccent(product.id||product.name);return <SectionCard key={product.id} className={product.active===false?'opacity-70':''} accent={productAccent.border} soft={productAccent.soft}><div className="flex items-start justify-between gap-3"><div><div className="flex gap-2 items-center flex-wrap"><span className="w-2.5 h-2.5 rounded-full" style={{backgroundColor:productAccent.border}}></span><h3 className="font-black uppercase text-base" style={{color:productAccent.text}}>{product.name}</h3><StateBadge active={product.active!==false}/></div><p className="text-[9px] font-black text-slate-400 mt-1">CPA máximo: <span className="text-purple-600">{fmtMoney(product.maxCpa)}</span> · {productCampaigns.length} campaña(s) · Inicio: {product.createdDate ? parseDateSafe(product.createdDate)?.toLocaleDateString('es-CO') : '—'}</p></div><div className="flex gap-1"><button onClick={()=>editProduct(product)} className="p-2 rounded-xl bg-slate-100 text-slate-600"><Settings2 size={14}/></button><button onClick={()=>toggleProduct(product)} className={`p-2 rounded-xl ${product.active===false?'bg-emerald-100 text-emerald-600':'bg-rose-100 text-rose-600'}`}>{product.active===false?<Power size={14}/>:<PowerOff size={14}/>}</button><button onClick={()=>deleteProduct(product)} className="p-2 rounded-xl bg-rose-50 text-rose-500"><Trash2 size={14}/></button></div></div>
      <div className="flex gap-2 mt-4"><input value={campaignNameByProduct[product.id]||''} onChange={e=>setCampaignNameByProduct(x=>({...x,[product.id]:e.target.value}))} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addCampaign(product.id);}}} placeholder="Nombre nueva campaña" className="flex-1 bg-slate-50 rounded-xl px-3 py-2 text-xs font-bold"/><button type="button" disabled={busyKey === `campaign:${product.id}`} onClick={()=>addCampaign(product.id)} className="bg-zinc-950 text-white px-3 py-2 rounded-xl text-[9px] font-black uppercase disabled:opacity-50"><Plus size={12} className="inline mr-1"/> {busyKey === `campaign:${product.id}` ? 'Creando...' : 'Campaña'}</button></div>
      <div className="space-y-3 mt-4">{productCampaigns.length===0?<EmptyState>0 campañas. Puedes agregar una nueva sin perder el producto.</EmptyState>:productCampaigns.map(campaign=>{const campaignAds=ads.filter(a=>a.campaignId===campaign.id);const isOpen=expanded[campaign.id]!==false;const campaignAccent=ccVisualAccent(campaign.id||campaign.name,2);return <div key={campaign.id} className={`rounded-2xl overflow-hidden ${campaign.archived?'opacity-75':''}`} style={{border:`2px solid ${campaignAccent.border}`,backgroundColor:campaignAccent.soft,boxShadow:`0 6px 18px ${campaignAccent.border}10`}}><div className="p-3 flex flex-col md:flex-row md:items-center gap-3 justify-between"><button onClick={()=>setExpanded(x=>({...x,[campaign.id]:!isOpen}))} className="text-left flex-1"><div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{backgroundColor:campaignAccent.border}}></span><span className="font-black text-xs uppercase" style={{color:campaignAccent.text}}>{campaign.name}</span><StateBadge active={campaign.active!==false} archived={campaign.archived}/>{isOpen?<ChevronUp size={13}/>:<ChevronDown size={13}/>}</div><p className="text-[8px] text-slate-400 mt-1">{campaignAds.length} anuncios · alta {campaign.createdDate||'—'} · datos desde {campaign.effectiveStartDate||campaign.createdDate||'—'} · último cambio {campaign.stateChangedDate||'—'}</p></button><div className="flex gap-1 flex-wrap">{!campaign.archived&&<button onClick={()=>toggleCampaign(campaign)} className={`px-2 py-1.5 rounded-lg text-[8px] font-black uppercase ${campaign.active===false?'bg-emerald-100 text-emerald-700':'bg-rose-100 text-rose-600'}`}>{campaign.active===false?'Encender':'Apagar'}</button>}{!campaign.archived?<button onClick={()=>archiveCampaign(campaign)} className="px-2 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-[8px] font-black uppercase flex items-center gap-1"><Archive size={11}/> Archivar</button>:<button onClick={()=>restoreCampaign(campaign)} className="px-2 py-1.5 rounded-lg bg-blue-100 text-blue-700 text-[8px] font-black uppercase flex items-center gap-1"><ArchiveRestore size={11}/> Restaurar</button>}<button title="Eliminar campaña definitivamente" onClick={()=>permanentDeleteCampaign(campaign)} className="p-1.5 rounded-lg bg-rose-50 text-rose-500"><Trash2 size={12}/></button></div></div>
        {isOpen&&<div className="border-t p-3" style={{borderColor:campaignAccent.border,backgroundColor:'#ffffffcc'}}>{!campaign.archived&&<div className="flex gap-2 mb-3"><input value={adNameByCampaign[campaign.id]||''} onChange={e=>setAdNameByCampaign(x=>({...x,[campaign.id]:e.target.value}))} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addAd(campaign);}}} placeholder="Nombre nuevo anuncio" className="flex-1 bg-white border rounded-xl px-3 py-2 text-xs font-bold"/><button type="button" disabled={busyKey === `ad:${campaign.id}`} onClick={()=>addAd(campaign)} className="bg-emerald-500 text-zinc-950 px-3 rounded-xl text-[9px] font-black uppercase disabled:opacity-50"><Plus size={12} className="inline"/> {busyKey === `ad:${campaign.id}` ? 'Creando...' : 'Anuncio'}</button></div>}{campaignAds.length===0?<EmptyState>Sin anuncios.</EmptyState>:<div className="space-y-2">{campaignAds.map(ad=>{const adAccent=ccVisualAccent(ad.id||ad.name,4);return <div key={ad.id} className="rounded-xl p-2.5 flex items-center justify-between gap-2" style={{border:`2px solid ${adAccent.border}`,backgroundColor:adAccent.soft}}><div><div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{backgroundColor:adAccent.border}}></span><p className="text-[10px] font-black" style={{color:adAccent.text}}>{ad.name}</p></div><p className="text-[8px] text-slate-400">Alta {ad.createdDate||'—'} · datos desde {ad.effectiveStartDate||ad.createdDate||'—'} · último cambio {ad.stateChangedDate||'—'} · {campaign.active===false?'apagado por campaña':ad.active===false?'excluido de métricas':'incluido en métricas'}</p></div><div className="flex items-center gap-1.5"><StateBadge active={ad.active!==false}/><button disabled={campaign.archived} onClick={()=>toggleAd(ad,campaign)} className={`px-2 py-1.5 rounded-lg text-[8px] font-black ${ad.active===false?'bg-emerald-100 text-emerald-700':'bg-rose-100 text-rose-600'} disabled:opacity-30`}>{ad.active===false?'Encender':'Apagar'}</button><button title="Eliminar anuncio definitivamente" onClick={()=>deleteAd(ad,campaign)} className="p-1.5 rounded-lg bg-rose-50 text-rose-500"><Trash2 size={12}/></button></div></div>})}</div>}</div>}
      </div>})}</div></SectionCard>})}
    <label className="flex items-center gap-2 text-[9px] font-black uppercase text-slate-500"><input type="checkbox" checked={showArchived} onChange={e=>setShowArchived(e.target.checked)}/> Mostrar campañas archivadas</label>
  </div>;
}

async function addDecision(ownerUid, campaign, ad, action, detail) {
  await addDoc(collection(db, COLLECTIONS.decisions), {
    ownerUid,
    productId: campaign?.productId || ad?.productId || null,
    campaignId: campaign?.id || ad?.campaignId || null,
    adId: ad?.id || null,
    date: todayColombiaCC(),
    action,
    detail,
    createdAt: serverTimestamp()
  });
}


function DailyRegisterFull({ ownerUid, products, campaigns, ads, dailyCampaigns, dailyAds, recommendations }) {
  const [date, setDate] = useState(todayColombiaCC());
  const [expandedProducts, setExpandedProducts] = useState({});
  const [expandedCampaigns, setExpandedCampaigns] = useState({});

  const visibleProducts = products
    .filter(p => !(p.effectiveStartDate || p.createdDate) || (p.effectiveStartDate || p.createdDate) <= date)
    .sort((a,b) => String(a.name || '').localeCompare(String(b.name || '')));

  const expandAll = () => {
    const p = {}, c = {};
    visibleProducts.forEach(product => {
      p[product.id] = true;
      campaigns.filter(x => x.productId === product.id && !x.archived && (!(x.effectiveStartDate || x.createdDate) || (x.effectiveStartDate || x.createdDate) <= date))
        .forEach(campaign => { c[campaign.id] = true; });
    });
    setExpandedProducts(p);
    setExpandedCampaigns(c);
  };

  const collapseAll = () => {
    setExpandedProducts({});
    setExpandedCampaigns({});
  };

  const registeredCampaigns = dailyCampaigns.filter(r => r.date === date).length;
  const totalCampaigns = campaigns.filter(c => !c.archived && (!(c.effectiveStartDate || c.createdDate) || (c.effectiveStartDate || c.createdDate) <= date)).length;

  return (
    <div className="space-y-5">
      <SectionCard accent="#0891b2" soft="#ecfeff">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-black uppercase text-cyan-800">Registro diario de Meta Ads</h3>
            <p className="text-[9px] text-slate-400 mt-1">Fecha → Productos → Campañas → Anuncios. Cada registro se guarda por fecha y campaña; volver a guardarlo actualiza el mismo documento, nunca crea duplicados.</p>
          </div>
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <p className="text-[8px] font-black uppercase text-slate-400 mb-1">Fecha</p>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="bg-zinc-950 text-white border border-zinc-800 rounded-xl px-3 py-2 text-xs font-black" />
            </div>
            <button onClick={expandAll} className="bg-slate-100 text-slate-700 px-3 py-2 rounded-xl text-[9px] font-black uppercase">Expandir todo</button>
            <button onClick={collapseAll} className="bg-slate-100 text-slate-700 px-3 py-2 rounded-xl text-[9px] font-black uppercase">Contraer todo</button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
          <MiniCard label="Campañas disponibles" value={totalCampaigns} />
          <MiniCard label="Registradas en fecha" value={registeredCampaigns} tone={registeredCampaigns ? 'good' : 'default'} />
          <MiniCard label="Pendientes" value={Math.max(0, totalCampaigns - registeredCampaigns)} />
          <MiniCard label="Fecha" value={date} />
        </div>
      </SectionCard>

      {visibleProducts.length === 0 ? <EmptyState>No existen productos de Campaign Control para esta fecha.</EmptyState> :
        visibleProducts.map(product => {
          const productCampaigns = campaigns
            .filter(c => c.productId === product.id && !c.archived && (!(c.effectiveStartDate || c.createdDate) || (c.effectiveStartDate || c.createdDate) <= date))
            .sort((a,b) => String(a.name || '').localeCompare(String(b.name || '')));
          const isOpen = expandedProducts[product.id] === true;
          const productRegistered = dailyCampaigns.filter(r => r.date === date && r.productId === product.id).length;

          const productAccent = ccVisualAccent(product.id || product.name);
          return <div
            key={product.id}
            className={product.active === false ? 'opacity-80' : ''}
            style={{
              border: `3px solid ${productAccent.border}`,
              borderRadius: '24px',
              backgroundColor: productAccent.soft,
              boxShadow: `0 8px 24px ${productAccent.border}14`
            }}
          >
            <div className="bg-white rounded-[21px] p-4 md:p-5">
            <button onClick={() => setExpandedProducts(x => ({ ...x, [product.id]: !isOpen }))} className="w-full flex items-center justify-between gap-3 text-left">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: productAccent.border }}></span>
                  <h3 className="font-black uppercase text-sm" style={{ color: productAccent.text }}>{product.name}</h3>
                  <StateBadge active={entityActiveOnDate(product, date)} />
                </div>
                <p className="text-[8px] text-slate-400 mt-1">CPA máximo {fmtMoney(product.maxCpa)} · {productRegistered}/{productCampaigns.length} campañas registradas</p>
              </div>
              {isOpen ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
            </button>

            {isOpen && <div className="space-y-3 mt-4 pt-4 border-t">
              {productCampaigns.length === 0 ? <EmptyState>Este producto no tiene campañas disponibles para la fecha.</EmptyState> :
                productCampaigns.map(campaign => {
                  const campaignOpen = expandedCampaigns[campaign.id] === true;
                  const existing = dailyCampaigns.find(r => r.campaignId === campaign.id && r.date === date);
                  const included = entityActiveOnDate(campaign, date);
                  const campaignAccent = ccVisualAccent(campaign.id || campaign.name, 2);
                  return <div
                    key={campaign.id}
                    className="rounded-2xl overflow-hidden"
                    style={{
                      border: `2px solid ${campaignAccent.border}`,
                      backgroundColor: campaignAccent.soft
                    }}
                  >
                    <button
                      onClick={() => setExpandedCampaigns(x => ({ ...x, [campaign.id]: !campaignOpen }))}
                      className="w-full p-3 flex items-center justify-between gap-3 text-left"
                      style={{ backgroundColor: campaignAccent.soft }}
                    >
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: campaignAccent.border }}></span>
                          <span className="font-black text-xs uppercase" style={{ color: campaignAccent.text }}>{campaign.name}</span>
                          <StateBadge active={included} />
                          {existing && <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-700 text-[8px] font-black uppercase">Registrada</span>}
                        </div>
                        <p className="text-[8px] text-slate-400 mt-1">
                          {included ? 'Este día participa en diagnósticos.' : 'Este día está OFF y será excluido de diagnósticos aunque exista un registro.'}
                        </p>
                      </div>
                      {campaignOpen ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                    </button>
                    {campaignOpen && <CampaignDailyEditor
                      ownerUid={ownerUid}
                      date={date}
                      product={product}
                      campaign={campaign}
                      ads={ads.filter(a => a.campaignId === campaign.id)}
                      dailyCampaigns={dailyCampaigns}
                      dailyAds={dailyAds}
                      recommendations={recommendations}
                    />}
                  </div>;
                })
              }
            </div>}
            </div>
          </div>;
        })
      }
    </div>
  );
}

function CampaignDailyEditor({ ownerUid, date, product, campaign, ads, dailyCampaigns, dailyAds, recommendations }) {
  const existingCampaignRecord = dailyCampaigns.find(r => r.campaignId === campaign.id && r.date === date);
  const [editing, setEditing] = useState(!existingCampaignRecord);
  const [campaignForm, setCampaignForm] = useState({});
  const [adForms, setAdForms] = useState({});
  const [csvPreview, setCsvPreview] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const cRec = dailyCampaigns.find(r => r.campaignId === campaign.id && r.date === date);
    setCampaignForm({
      budget: cRec?.budget ?? '', spend: cRec?.spend ?? '', purchases: cRec?.purchases ?? '',
      ctr: cRec?.ctr ?? '', cpc: cRec?.cpc ?? '', cpm: cRec?.cpm ?? '', frequency: cRec?.frequency ?? '',
      landingViews: cRec?.landingViews ?? '', atc: cRec?.atc ?? '', roas: cRec?.roas ?? ''
    });
    const nextAds = {};
    ads.forEach(ad => {
      const rec = dailyAds.find(r => r.adId === ad.id && r.date === date);
      nextAds[ad.id] = {
        spend: rec?.spend ?? '', purchases: rec?.purchases ?? '', ctr: rec?.ctr ?? '', cpc: rec?.cpc ?? '',
        cpm: rec?.cpm ?? '', frequency: rec?.frequency ?? '', landingViews: rec?.landingViews ?? '',
        atc: rec?.atc ?? '', roas: rec?.roas ?? '', impressions: rec?.impressions ?? '', clicks: rec?.clicks ?? ''
      };
    });
    setAdForms(nextAds);
    setEditing(!cRec);
    setCsvPreview(null);
  }, [date, campaign.id, dailyCampaigns, dailyAds, ads]);

  const save = async () => {
    const campaignRecordId = `${date}_${campaign.id}`;
    await setDoc(doc(db, COLLECTIONS.dailyCampaigns, campaignRecordId), {
      ownerUid, date, productId: product.id, campaignId: campaign.id,
      budget: toNumber(campaignForm.budget), spend: toNumber(campaignForm.spend), purchases: toNumber(campaignForm.purchases),
      ctr: toNumber(campaignForm.ctr), cpc: toNumber(campaignForm.cpc), cpm: toNumber(campaignForm.cpm),
      frequency: toNumber(campaignForm.frequency), landingViews: toNumber(campaignForm.landingViews),
      atc: toNumber(campaignForm.atc), roas: toNumber(campaignForm.roas),
      source: 'manual', updatedAt: serverTimestamp()
    }, { merge: true });

    for (const ad of ads) {
      const f = adForms[ad.id] || {};
      const hasAny = Object.values(f).some(v => v !== '' && v !== null && v !== undefined);
      if (!hasAny) continue;
      await setDoc(doc(db, COLLECTIONS.dailyAds, `${date}_${ad.id}`), {
        ownerUid, date, productId: product.id, campaignId: campaign.id, adId: ad.id,
        adName: ad.name, normalizedName: ad.normalizedName,
        spend: toNumber(f.spend), purchases: toNumber(f.purchases), impressions: toNumber(f.impressions), clicks: toNumber(f.clicks),
        ctr: toNumber(f.ctr), cpc: toNumber(f.cpc), cpm: toNumber(f.cpm), frequency: toNumber(f.frequency),
        landingViews: toNumber(f.landingViews), atc: toNumber(f.atc), roas: toNumber(f.roas),
        source: 'manual', updatedAt: serverTimestamp()
      }, { merge: true });
    }

    await detectBudgetChange({
      ownerUid, date, campaign, currentBudget: toNumber(campaignForm.budget),
      dailyCampaigns, recommendations
    });

    setEditing(false);
    setMessage(existingCampaignRecord ? 'Registro actualizado sin duplicar.' : 'Registro guardado correctamente.');
    setTimeout(() => setMessage(''), 2500);
  };

  const handleCsv = async file => {
    if (!file) return;
    const rows = parseCsvText(await file.text());
    setCsvPreview(parseMetaRows(rows, ads, date));
  };

  const applyCsv = async () => {
    if (!csvPreview) return;
    const conflicts = csvPreview.filter(x => x.status === 'conflict');
    if (conflicts.length) return alert('Hay nombres duplicados dentro del CSV. Debes resolverlos antes de importar.');

    const imported = [];
    for (const item of csvPreview) {
      let ad = item.existingAd;
      if (!ad) {
        const ref = await addDoc(collection(db, COLLECTIONS.ads), {
          ownerUid, productId: product.id, campaignId: campaign.id,
          name: item.adName, normalizedName: item.normalizedName,
          active: entityActiveOnDate(campaign, item.reportDate),
          createdDate: item.reportDate || date,
          stateChangedDate: item.reportDate || date,
          stateHistory: [{ date: item.reportDate || date, active: entityActiveOnDate(campaign, item.reportDate || date) }],
          createdAt: serverTimestamp(), stateChangedAt: serverTimestamp()
        });
        ad = { id: ref.id, name: item.adName, normalizedName: item.normalizedName };
      }

      await setDoc(doc(db, COLLECTIONS.dailyAds, `${item.reportDate}_${ad.id}`), {
        ownerUid, date: item.reportDate, productId: product.id, campaignId: campaign.id,
        adId: ad.id, adName: ad.name, normalizedName: ad.normalizedName,
        ...item.metrics, source: 'meta_csv', updatedAt: serverTimestamp()
      }, { merge: true });
      imported.push(item);
    }

    const byDate = {};
    imported.forEach(item => {
      if (!byDate[item.reportDate]) byDate[item.reportDate] = [];
      byDate[item.reportDate].push({ ...item.metrics, date: item.reportDate });
    });

    for (const [reportDate, metrics] of Object.entries(byDate)) {
      const agg = aggregateRecords(metrics);
      const existing = dailyCampaigns.find(r => r.campaignId === campaign.id && r.date === reportDate);
      await setDoc(doc(db, COLLECTIONS.dailyCampaigns, `${reportDate}_${campaign.id}`), {
        ownerUid, date: reportDate, productId: product.id, campaignId: campaign.id,
        budget: toNumber(existing?.budget),
        spend: agg.spend, purchases: agg.purchases, ctr: agg.ctr, cpc: agg.cpc, cpm: agg.cpm,
        frequency: agg.frequency, landingViews: agg.landingViews, atc: agg.atc, roas: agg.roas,
        source: 'meta_csv_aggregate', updatedAt: serverTimestamp()
      }, { merge: true });
    }

    await addDoc(collection(db, COLLECTIONS.imports), {
      ownerUid, productId: product.id, campaignId: campaign.id,
      requestedDate: date,
      rows: imported.length,
      newAds: csvPreview.filter(x => x.status === 'new').length,
      existingAds: csvPreview.filter(x => x.status === 'existing').length,
      importedAt: serverTimestamp()
    });

    setCsvPreview(null);
    setMessage(`CSV importado: ${imported.length} anuncio(s) procesados.`);
    setTimeout(() => setMessage(''), 3000);
  };

  const included = entityActiveOnDate(campaign, date);

  return <div className="p-3 space-y-4 bg-white">
    <div className={`rounded-xl p-3 border ${included ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-200'}`}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
        <div>
          <p className="text-[9px] font-black uppercase">{existingCampaignRecord ? 'Registro existente' : 'Nuevo registro'}</p>
          <p className="text-[8px] text-slate-500 mt-1">{existingCampaignRecord ? 'Para evitar duplicados, primero debes presionar Editar. Al guardar se actualiza el documento existente.' : 'Completa manualmente o importa el CSV de Meta.'}</p>
        </div>
        {existingCampaignRecord && !editing && <button onClick={() => setEditing(true)} className="bg-amber-500 text-white px-3 py-2 rounded-xl text-[9px] font-black uppercase flex items-center gap-1"><Pencil size={12}/> Editar</button>}
      </div>
    </div>

    <div className="rounded-2xl p-3 bg-indigo-50/50" style={{border:'2px solid #6366f1'}}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">
        <div><p className="font-black text-xs uppercase text-indigo-800">Importar CSV de Meta Ads</p><p className="text-[8px] text-slate-400 mt-1">El archivo se aplica solo a {campaign.name}. Matching por nombre normalizado; nunca por ID de Meta.</p></div>
        <label className="cursor-pointer bg-zinc-950 text-white px-3 py-2 rounded-xl text-[9px] font-black uppercase flex items-center gap-2"><FileUp size={13}/> Seleccionar CSV<input type="file" accept=".csv,text/csv" className="hidden" onChange={e => handleCsv(e.target.files?.[0])}/></label>
      </div>
      {csvPreview && <CsvPreview rows={csvPreview} onApply={applyCsv}/>}
    </div>

    <div className="rounded-2xl p-3 bg-blue-50/40" style={{border:'2px solid #2563eb'}}>
      <p className="font-black text-xs uppercase mb-3 text-blue-800">Métricas generales de campaña</p>
      <MetricForm form={campaignForm} setForm={setCampaignForm} includeBudget disabled={!editing}/>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
        <MiniCard label="CPA calculado" value={fmtMoney(calcCpa(campaignForm.spend, campaignForm.purchases))}/>
        <MiniCard label="Visita → ATC" value={`${fmtNum(safeRate(campaignForm.atc, campaignForm.landingViews), 2)}%`}/>
        <MiniCard label="Visita → Compra" value={`${fmtNum(safeRate(campaignForm.purchases, campaignForm.landingViews), 2)}%`}/>
        <MiniCard label="ATC → Compra" value={`${fmtNum(safeRate(campaignForm.purchases, campaignForm.atc), 2)}%`}/>
      </div>
    </div>

    <div className="rounded-2xl p-3 bg-emerald-50/40" style={{border:'2px solid #059669'}}>
      <p className="font-black text-xs uppercase mb-3 text-emerald-800">Anuncios de la campaña</p>
      {ads.length === 0 ? <EmptyState>No hay anuncios. Puedes crearlos en Ver campañas o importarlos desde un CSV.</EmptyState> :
        <div className="space-y-3">{ads.map(ad => {
          const f = adForms[ad.id] || {};
          const activeThisDate = entityActiveOnDate(ad, date) && entityActiveOnDate(campaign, date);
          const adAccent = ccVisualAccent(ad.id || ad.name, 4);
          return <div
            key={ad.id}
            className={`rounded-2xl p-3 ${activeThisDate ? '' : 'opacity-75'}`}
            style={{
              border: `2px solid ${adAccent.border}`,
              backgroundColor: activeThisDate ? adAccent.soft : '#f8fafc'
            }}
          >
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: adAccent.border }}></span>
                  <p className="font-black text-xs" style={{ color: adAccent.text }}>{ad.name}</p>
                </div>
                <p className="text-[8px] text-slate-400">{activeThisDate ? 'Activo en esta fecha · incluido en análisis' : 'OFF en esta fecha · excluido de análisis'}</p>
              </div>
              <div className="text-right"><p className="text-[8px] font-black uppercase text-slate-400">CPA</p><p className="font-black">{fmtMoney(calcCpa(f.spend, f.purchases))}</p></div>
            </div>
            <MetricForm form={f} disabled={!editing} setForm={next => setAdForms(prev => ({ ...prev, [ad.id]: typeof next === 'function' ? next(prev[ad.id] || {}) : next }))}/>
          </div>;
        })}</div>
      }
    </div>

    {editing && <button onClick={save} className="w-full bg-emerald-500 text-zinc-950 py-3 rounded-xl font-black uppercase text-[10px] flex items-center justify-center gap-2"><Save size={14}/> {existingCampaignRecord ? 'Actualizar registro' : 'Guardar registro'}</button>}
    {message && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl p-3 text-[10px] font-black">✓ {message}</div>}
  </div>;
}


function DailyRegister({ ownerUid, products, campaigns, ads, dailyCampaigns, dailyAds, recommendations }) {
  const [date, setDate] = useState(todayColombiaCC());
  const [productId, setProductId] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [campaignForm, setCampaignForm] = useState({ budget: '', spend: '', purchases: '', ctr: '', cpc: '', cpm: '', frequency: '', landingViews: '', atc: '', roas: '' });
  const [adForms, setAdForms] = useState({});
  const [savedMessage, setSavedMessage] = useState('');
  const [csvPreview, setCsvPreview] = useState(null);

  const availableProducts = products.filter(p => p.active !== false);
  const productCampaigns = campaigns.filter(c => c.productId === productId && !c.archived);
  const selectedCampaign = campaigns.find(c => c.id === campaignId) || null;
  const campaignAds = ads.filter(a => a.campaignId === campaignId);

  useEffect(() => {
    setCampaignId('');
    setCsvPreview(null);
  }, [productId]);

  useEffect(() => {
    if (!campaignId) {
      setCampaignForm({ budget: '', spend: '', purchases: '', ctr: '', cpc: '', cpm: '', frequency: '', landingViews: '', atc: '', roas: '' });
      setAdForms({});
      return;
    }
    const cRec = dailyCampaigns.find(r => r.campaignId === campaignId && r.date === date);
    setCampaignForm({
      budget: cRec?.budget ?? '', spend: cRec?.spend ?? '', purchases: cRec?.purchases ?? '', ctr: cRec?.ctr ?? '', cpc: cRec?.cpc ?? '', cpm: cRec?.cpm ?? '',
      frequency: cRec?.frequency ?? '', landingViews: cRec?.landingViews ?? '', atc: cRec?.atc ?? '', roas: cRec?.roas ?? ''
    });
    const forms = {};
    campaignAds.forEach(ad => {
      const rec = dailyAds.find(r => r.adId === ad.id && r.date === date);
      forms[ad.id] = { spend: rec?.spend ?? '', purchases: rec?.purchases ?? '', ctr: rec?.ctr ?? '', cpc: rec?.cpc ?? '', cpm: rec?.cpm ?? '', frequency: rec?.frequency ?? '', landingViews: rec?.landingViews ?? '', atc: rec?.atc ?? '', roas: rec?.roas ?? '', impressions: rec?.impressions ?? '', clicks: rec?.clicks ?? '' };
    });
    setAdForms(forms);
    setCsvPreview(null);
  }, [campaignId, date, dailyCampaigns, dailyAds, ads]);

  const saveAll = async () => {
    if (!productId || !campaignId) return alert('Selecciona producto y campaña.');
    const campaignRecordId = `${date}_${campaignId}`;
    const campaignData = {
      ownerUid, date, productId, campaignId,
      budget: toNumber(campaignForm.budget), spend: toNumber(campaignForm.spend), purchases: toNumber(campaignForm.purchases),
      ctr: toNumber(campaignForm.ctr), cpc: toNumber(campaignForm.cpc), cpm: toNumber(campaignForm.cpm), frequency: toNumber(campaignForm.frequency),
      landingViews: toNumber(campaignForm.landingViews), atc: toNumber(campaignForm.atc), roas: toNumber(campaignForm.roas), updatedAt: serverTimestamp()
    };
    await setDoc(doc(db, COLLECTIONS.dailyCampaigns, campaignRecordId), campaignData, { merge: true });

    for (const ad of campaignAds) {
      const f = adForms[ad.id] || {};
      const hasData = Object.values(f).some(v => v !== '' && toNumber(v) !== 0);
      if (!hasData) continue;
      await setDoc(doc(db, COLLECTIONS.dailyAds, `${date}_${ad.id}`), {
        ownerUid, date, productId, campaignId, adId: ad.id, adName: ad.name, normalizedName: ad.normalizedName,
        spend: toNumber(f.spend), purchases: toNumber(f.purchases), impressions: toNumber(f.impressions), clicks: toNumber(f.clicks),
        ctr: toNumber(f.ctr), cpc: toNumber(f.cpc), cpm: toNumber(f.cpm), frequency: toNumber(f.frequency), landingViews: toNumber(f.landingViews), atc: toNumber(f.atc), roas: toNumber(f.roas), updatedAt: serverTimestamp()
      }, { merge: true });
    }

    await detectBudgetChange({ ownerUid, date, campaign: selectedCampaign, currentBudget: toNumber(campaignForm.budget), dailyCampaigns, recommendations });
    setSavedMessage('Registro guardado / actualizado correctamente.');
    setTimeout(() => setSavedMessage(''), 2500);
  };

  const handleCsv = async file => {
    if (!file || !campaignId) return;
    const text = await file.text();
    const rows = parseCsvText(text);
    const parsed = parseMetaRows(rows, campaignAds, date);
    setCsvPreview(parsed);
  };

  const applyCsv = async () => {
    if (!csvPreview || !selectedCampaign) return;
    if (csvPreview.some(x => x.status === 'conflict')) return alert('Hay nombres duplicados dentro del CSV. Resuelve el conflicto antes de importar.');
    const imported = [];

    for (const item of csvPreview) {
      let ad = item.existingAd;
      if (!ad) {
        const ref = await addDoc(collection(db, COLLECTIONS.ads), {
          ownerUid,
          productId,
          campaignId,
          name: item.adName,
          normalizedName: item.normalizedName,
          active: selectedCampaign.active !== false,
          createdDate: item.reportDate || date,
          createdAt: serverTimestamp(),
          stateChangedAt: serverTimestamp()
        });
        ad = { id: ref.id, name: item.adName, normalizedName: item.normalizedName };
      }
      await setDoc(doc(db, COLLECTIONS.dailyAds, `${item.reportDate}_${ad.id}`), {
        ownerUid,
        date: item.reportDate,
        productId,
        campaignId,
        adId: ad.id,
        adName: ad.name,
        normalizedName: ad.normalizedName,
        ...item.metrics,
        source: 'meta_csv',
        updatedAt: serverTimestamp()
      }, { merge: true });
      imported.push(item);
    }

    // Agregado automático a nivel campaña. El presupuesto se conserva manualmente.
    const byDate = {};
    imported.forEach(item => {
      if (!byDate[item.reportDate]) byDate[item.reportDate] = [];
      byDate[item.reportDate].push({ ...item.metrics, date: item.reportDate });
    });
    for (const [reportDate, metrics] of Object.entries(byDate)) {
      const agg = aggregateRecords(metrics);
      const existing = dailyCampaigns.find(r => r.campaignId === campaignId && r.date === reportDate);
      await setDoc(doc(db, COLLECTIONS.dailyCampaigns, `${reportDate}_${campaignId}`), {
        ownerUid, date: reportDate, productId, campaignId,
        budget: toNumber(existing?.budget),
        spend: agg.spend, purchases: agg.purchases, ctr: agg.ctr, cpc: agg.cpc, cpm: agg.cpm,
        frequency: agg.frequency, landingViews: agg.landingViews, atc: agg.atc, roas: agg.roas,
        source: 'meta_csv_aggregate', updatedAt: serverTimestamp()
      }, { merge: true });
    }

    setSavedMessage(`CSV importado: ${imported.length} anuncios procesados.`);
    setCsvPreview(null);
    setTimeout(() => setSavedMessage(''), 3000);
  };

  return (
    <div className="space-y-5">
      <SectionCard>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><p className="text-[9px] font-black uppercase text-slate-400 mb-1">Fecha</p><input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full bg-slate-50 rounded-xl px-3 py-2.5 text-xs font-black" /></div>
          <div><p className="text-[9px] font-black uppercase text-slate-400 mb-1">Producto</p><select value={productId} onChange={e => setProductId(e.target.value)} className="w-full bg-slate-50 rounded-xl px-3 py-2.5 text-xs font-black"><option value="">Seleccionar...</option>{availableProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div><p className="text-[9px] font-black uppercase text-slate-400 mb-1">Campaña</p><select value={campaignId} onChange={e => setCampaignId(e.target.value)} disabled={!productId} className="w-full bg-slate-50 rounded-xl px-3 py-2.5 text-xs font-black disabled:opacity-40"><option value="">Seleccionar...</option>{productCampaigns.map(c => <option key={c.id} value={c.id}>{c.name}{c.active === false ? ' (OFF)' : ''}</option>)}</select></div>
        </div>
      </SectionCard>

      {selectedCampaign && <>
        <SectionCard>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
            <div><h3 className="font-black uppercase text-sm">Importar CSV de Meta Ads</h3><p className="text-[9px] text-slate-400">Se aplica únicamente a <strong>{selectedCampaign.name}</strong>. Matching por nombre normalizado, nunca por ID de Meta.</p></div>
            <label className="cursor-pointer bg-zinc-950 text-white px-4 py-2.5 rounded-xl text-[9px] font-black uppercase flex items-center gap-2"><FileUp size={14} /> Seleccionar CSV<input type="file" accept=".csv,text/csv" className="hidden" onChange={e => handleCsv(e.target.files?.[0])} /></label>
          </div>
          {csvPreview && <CsvPreview rows={csvPreview} onApply={applyCsv} />}
        </SectionCard>

        <SectionCard>
          <h3 className="font-black uppercase text-sm mb-3">Métricas generales de campaña</h3>
          <MetricForm form={campaignForm} setForm={setCampaignForm} includeBudget />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
            <MiniCard label="CPA calculado" value={fmtMoney(calcCpa(campaignForm.spend, campaignForm.purchases))} />
            <MiniCard label="Visita → ATC" value={`${fmtNum(safeRate(campaignForm.atc, campaignForm.landingViews), 2)}%`} />
            <MiniCard label="Visita → Compra" value={`${fmtNum(safeRate(campaignForm.purchases, campaignForm.landingViews), 2)}%`} />
            <MiniCard label="ATC → Compra" value={`${fmtNum(safeRate(campaignForm.purchases, campaignForm.atc), 2)}%`} />
          </div>
        </SectionCard>

        <SectionCard>
          <h3 className="font-black uppercase text-sm mb-3">Anuncios de la campaña</h3>
          {campaignAds.length === 0 ? <EmptyState>No hay anuncios. Puedes crearlos desde Ver campañas o importarlos desde el CSV.</EmptyState> : <div className="space-y-3">{campaignAds.map(ad => {
            const f = adForms[ad.id] || {};
            return <div key={ad.id} className="border rounded-2xl p-3">
              <div className="flex items-center justify-between mb-3"><div><p className="font-black text-xs">{ad.name}</p><p className="text-[8px] text-slate-400">{ad.active === false ? 'OFF · el registro no cambia su estado' : 'ON'}</p></div><div className="text-right"><p className="text-[8px] uppercase font-black text-slate-400">CPA</p><p className="font-black text-sm">{fmtMoney(calcCpa(f.spend, f.purchases))}</p></div></div>
              <MetricForm form={f} setForm={next => setAdForms(s => ({ ...s, [ad.id]: typeof next === 'function' ? next(s[ad.id] || {}) : next }))} />
            </div>;
          })}</div>}
          <button onClick={saveAll} className="w-full mt-4 bg-emerald-500 text-zinc-950 py-3 rounded-xl font-black uppercase text-[10px] flex items-center justify-center gap-2"><Save size={14} /> Guardar / actualizar día</button>
          {savedMessage && <div className="mt-3 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl p-3 text-[10px] font-black">✓ {savedMessage}</div>}
        </SectionCard>
      </>}
    </div>
  );
}

function MetricForm({ form, setForm, includeBudget = false, disabled = false }) {
  const fields = [
    ...(includeBudget ? [['budget', 'Presupuesto']] : []),
    ['spend', 'Gasto'], ['purchases', 'Compras'], ['ctr', 'CTR %'], ['cpc', 'CPC'], ['cpm', 'CPM'], ['frequency', 'Frecuencia'], ['landingViews', 'Landing'], ['atc', 'ATC'], ['roas', 'ROAS']
  ];
  const update = (key, value) => {
    if (disabled) return;
    setForm(prev => ({ ...(prev || {}), [key]: value }));
  };
  return <div className="grid grid-cols-2 md:grid-cols-5 gap-2">{fields.map(([key, label]) => <div key={key}><p className="text-[8px] font-black uppercase text-slate-400 mb-1">{label}</p><input disabled={disabled} type="number" step="any" value={form?.[key] ?? ''} onChange={e => update(key, e.target.value)} className="w-full bg-slate-50 border border-transparent focus:border-emerald-300 rounded-xl px-2.5 py-2 text-xs font-bold outline-none disabled:opacity-60 disabled:bg-slate-100" /></div>)}</div>;
}

function CsvPreview({ rows, onApply }) {
  const existing = rows.filter(r => r.status === 'existing').length;
  const news = rows.filter(r => r.status === 'new').length;
  const conflicts = rows.filter(r => r.status === 'conflict').length;
  return <div className="space-y-3 rounded-2xl p-3 bg-amber-50/50" style={{border:'2px solid #d97706'}}>
    <div className="grid grid-cols-3 gap-2"><MiniCard label="Existentes" value={existing} tone="good" /><MiniCard label="Nuevos" value={news} /><MiniCard label="Conflictos" value={conflicts} tone={conflicts ? 'bad' : 'default'} /></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-[10px]"><thead><tr className="text-left text-[8px] uppercase text-slate-400"><th>Anuncio</th><th>Estado</th><th>Fecha</th><th>Gasto</th><th>Compras</th><th>CTR</th><th>CPC</th><th>CPM</th><th>Frec.</th><th>Landing</th><th>ATC</th><th>ROAS</th></tr></thead><tbody>{rows.map((r, i) => <tr key={`${r.normalizedName}-${i}`} className="border-t"><td className="py-2 font-black">{r.adName}</td><td className={`font-black ${r.status === 'conflict' ? 'text-rose-600' : r.status === 'new' ? 'text-amber-600' : 'text-emerald-600'}`}>{r.status === 'existing' ? 'Actualizar existente' : r.status === 'new' ? 'Nuevo anuncio' : 'Conflicto'}</td><td>{r.reportDate}</td><td>{fmtMoney(r.metrics.spend)}</td><td>{fmtNum(r.metrics.purchases, 2)}</td><td>{fmtNum(r.metrics.ctr, 2)}%</td><td>{fmtMoney(r.metrics.cpc)}</td><td>{fmtMoney(r.metrics.cpm)}</td><td>{fmtNum(r.metrics.frequency, 2)}</td><td>{fmtNum(r.metrics.landingViews, 2)}</td><td>{fmtNum(r.metrics.atc, 2)}</td><td>{fmtNum(r.metrics.roas, 2)}</td></tr>)}</tbody></table></div>
    <button onClick={onApply} disabled={conflicts > 0} className="bg-zinc-950 text-white px-4 py-2.5 rounded-xl text-[9px] font-black uppercase disabled:opacity-30">Importar y actualizar campaña</button>
  </div>;
}

async function detectBudgetChange({ ownerUid, date, campaign, currentBudget, dailyCampaigns, recommendations }) {
  if (!campaign || currentBudget <= 0) return;
  const previousRecords = dailyCampaigns
    .filter(r => r.campaignId === campaign.id && r.date < date && toNumber(r.budget) > 0)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const previousBudget = toNumber(previousRecords[0]?.budget);
  if (!previousBudget || previousBudget === currentBudget) return;

  const recommendation = recommendations
    .filter(r => r.campaignId === campaign.id && r.type === 'budget' && r.status === 'active')
    .sort((a, b) => String(b.createdDate || '').localeCompare(String(a.createdDate || '')))
    .find(r => toNumber(r.recommendedBudget) === currentBudget);

  const origin = recommendation ? 'recommendation' : 'manual';
  await setDoc(doc(db, COLLECTIONS.budgetChanges, `${campaign.id}_${date}`), {
    ownerUid,
    productId: campaign.productId,
    campaignId: campaign.id,
    date,
    previousBudget,
    newBudget: currentBudget,
    changePct: ((currentBudget - previousBudget) / previousBudget) * 100,
    origin,
    recommendationId: recommendation?.id || null,
    createdAt: serverTimestamp()
  }, { merge: true });

  if (recommendation) await updateDoc(doc(db, COLLECTIONS.recommendations, recommendation.id), { status: 'applied', appliedDate: date, appliedAt: serverTimestamp() });

  await addDoc(collection(db, COLLECTIONS.decisions), {
    ownerUid,
    productId: campaign.productId,
    campaignId: campaign.id,
    adId: null,
    date,
    action: origin === 'recommendation' ? 'Recomendación de presupuesto aplicada' : 'Cambio manual de presupuesto',
    detail: `${fmtMoney(previousBudget)} → ${fmtMoney(currentBudget)} (${fmtNum(((currentBudget - previousBudget) / previousBudget) * 100, 2)}%)`,
    createdAt: serverTimestamp()
  });
}

// ─── APP PRINCIPAL ───────────────────────────────────────────────────────────
export default function App() {
  const { user, loading } = useAuth();
  const [configs, setConfigs] = useState([]);
  const [months, setMonths] = useState([]);
  const [activeTab, setTab] = useState('dashboard');

  useEffect(() => {
    if (!user) return;
    const u1 = onSnapshot(collection(db, 'sales_configs'), snap => setConfigs(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u2 = onSnapshot(collection(db, 'sales_months'), snap => setMonths(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => { u1(); u2(); };
  }, [user]);

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-100"><p className="text-slate-400">Cargando...</p></div>;
  if (!user) return <Login />;

  const tabs = [
    { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { id: 'records', icon: ClipboardList, label: 'Cierres' },
    { id: 'config', icon: Settings, label: 'Estrategias' },
    { id: 'agenda', icon: CalendarDays, label: 'Agenda' },
    { id: 'campaignControl', icon: BarChart3, label: 'Campaign Control' }
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: "'DM Sans', sans-serif", color: '#0f172a', paddingBottom: '5rem' }}>
      <header style={{ background: '#09090b', position: 'sticky', top: 0, zIndex: 40 }}>
        <div style={{ maxWidth: '72rem', margin: '0 auto', padding: '0.75rem 1rem' }}>
          <div className="flex justify-between items-center">
            <div><p className="font-black italic text-emerald-400 text-sm md:text-base">Winner System 360</p><p className="text-[9px] md:text-[10px] font-bold text-zinc-500 tracking-widest">Control Ventas · Contraentrega CO</p></div>
            <div className="flex items-center gap-3">
              <nav className="flex gap-1 bg-white/5 p-1 rounded-xl border border-white/10">
                {tabs.map(t => (<button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-1 md:gap-2 px-2 md:px-4 py-1.5 md:py-2 rounded-lg text-[9px] md:text-[10px] font-black uppercase tracking-wider transition-all ${activeTab === t.id ? 'bg-emerald-500 text-zinc-950' : 'text-zinc-500'}`}><t.icon size={12} /><span className="hidden sm:inline">{t.label}</span></button>))}
              </nav>
              <button onClick={() => { import('./src/firebase').then(({ logout }) => logout()); }} className="bg-red-500/20 hover:bg-red-500/30 text-red-300 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase">Salir</button>
            </div>
          </div>
        </div>
      </header>
      <main style={{ maxWidth: '72rem', margin: '0 auto', padding: '1rem 1rem 3rem' }}>
        {activeTab === 'dashboard' && <VistaDashboard configs={configs} months={months} />}
        {activeTab === 'records' && <VistaRegistro configs={configs} months={months} activeTab={activeTab} />}
        {activeTab === 'config' && <VistaConfig configs={configs} />}
        {activeTab === 'agenda' && <AgendaModule />}
        {activeTab === 'campaignControl' && <CampaignControlModule />}
      </main>
    </div>
  );
}
