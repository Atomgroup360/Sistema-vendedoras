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
  Settings2, ShieldCheck, TrendingDown, FileText, Copy, Download, Paintbrush, Scissors
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
        <div className="space-y-2"><SectionHeader title="EMBUDO OPERATIVO Y PRODUCTOS" icon={Activity} section="embudo" />{openSections.embudo && (<Card><div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-4"><div><Label>Pedidos Registrados</Label><p className="text-xl font-black">{fmtN(stats.grossOrd)}</p><p className="text-[8px]">{fmtN(stats.grossUnits)} unidades</p></div><div><Label>Guías Despachadas</Label><p className="text-xl font-black text-blue-600">{fmtN(stats.realShipped)}</p></div><div><Label>Devoluciones Est.</Label><p className="text-xl font-black text-rose-500">{fmtN(stats.estimatedReturns)}</p></div><div><Label>Entregas Finales</Label><p className="text-xl font-black text-emerald-600">{fmtN(stats.finalDeliveries)}</p><p className="text-[8px]">IER {fmtDec(stats.ierGlobal, 2)}%</p></div></div><div className="p-3 bg-slate-50 rounded-xl"><p className="text-[8px] font-black uppercase mb-2">📦 Unidades físicas</p><div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2.5 text-xs"><div><span className="text-[8px] text-slate-500">Registradas:</span> <span className="font-black ml-1">{fmtN(stats.unitsRegistradas)}</span></div><div><span className="text-[8px] text-slate-500">Enviadas:</span> <span className="font-black ml-1 text-blue-600">{fmtN(stats.unitsShippedReal)}</span></div><div><span className="text-[8px] text-slate-500">Devueltas:</span> <span className="font-black ml-1 text-rose-500">{fmtN(stats.unitsReturnedReal)}</span></div><div><span className="text-[8px] text-slate-500">Entregadas:</span> <span className="font-black ml-1 text-emerald-600">{fmtN(stats.unitsDeliveredReal)}</span></div><div><span className="text-[8px] text-slate-500">% Entregado:</span> <span className="font-black ml-1">{fmtDec(stats.pctProductosEntregados, 1)}%</span></div></div></div></Card>)}</div>

        {/* COSTOS */}
        <div className="space-y-2"><SectionHeader title="RADIOGRAFÍA DE COSTOS" icon={Calculator} section="costos" />{openSections.costos && (<Card className="space-y-0 p-0 overflow-hidden">{costItems.map((item,i) => (<div key={i} className="flex items-center gap-2 md:gap-4 px-4 py-3 border-b border-slate-50 last:border-0"><div className="w-6 h-6 md:w-8 md:h-8 rounded-xl bg-slate-100 flex items-center justify-center"><item.icon size={12} /></div><div className="flex-1"><p className="text-[11px] md:text-xs font-black">{item.label}</p><p className="text-[7px] md:text-[9px] text-slate-400">{item.note}</p></div><p className="font-black font-mono text-xs md:text-sm">{fmt(item.value)}</p></div>))}<div className="flex items-center gap-2 md:gap-4 px-4 py-3 bg-slate-900 text-white"><div className="flex-1"><p className="text-[11px] md:text-xs font-black uppercase">Total Costos</p></div><p className="font-black font-mono text-sm md:text-lg text-rose-400">{fmt(totalCostos)}</p></div></Card>)}</div>

        {/* RANKING */}
        <div className="space-y-2"><SectionHeader title="RANKING DE VENDEDORAS" icon={Award} section="ranking" totalItems={stats.rankingVendedoras?.length} />{openSections.ranking && (<div className="overflow-x-auto overscroll-x-contain"><table className="w-full text-left border-collapse text-xs md:text-sm"><thead className="bg-slate-100 text-[8px] md:text-[9px] font-black uppercase text-slate-500"><tr><th className="p-2 rounded-l-xl">#</th><th className="p-2">Vendedora</th><th className="p-2 text-right">Pedidos</th><th className="p-2 text-right">Recaudo Neto</th><th className="p-2 text-right">Utilidad</th><th className="p-2 text-right">IER</th></tr></thead><tbody className="divide-y divide-slate-100">{stats.rankingVendedoras?.map((v,idx) => (<tr key={v.vendedora} className="hover:bg-slate-50"><td className="p-2 font-black text-emerald-600">{idx+1}</td><td className="p-2 font-bold uppercase">{v.vendedora}</td><td className="p-2 text-right font-mono">{fmtN(v.pedidos)}</td><td className="p-2 text-right font-mono">{fmt(v.recaudoNeto)}</td><td className={`p-2 text-right font-mono ${v.utilidad >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{fmt(v.utilidad)}</td><td className="p-2 text-right font-mono">{fmtDec(v.ierPromedio,2)}%</td></tr>))}</tbody></table></div>)}</div>

        {/* PROYECCIÓN */}
        <div className="space-y-2"><SectionHeader title="UTILIDAD Y PROYECCIÓN" icon={TrendingUp} section="proyeccion" />{openSections.proyeccion && (<div className="flex flex-col md:grid md:grid-cols-2 gap-4"><Card dark className="space-y-3"><Label className="text-zinc-500">Utilidad Neta Período</Label><p className={`text-2xl md:text-4xl font-black font-mono ${stats.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{fmt(stats.net)}</p><div className="grid grid-cols-2 gap-2 pt-3 border-t border-zinc-800 text-xs"><div><p className="text-[8px] text-zinc-500">Ingresos Reales</p><p className="font-black text-white">{fmt(stats.realRev)}</p></div><div><p className="text-[8px] text-zinc-500">Total Costos</p><p className="font-black text-rose-400">{fmt(totalCostos)}</p></div><div><p className="text-[8px] text-zinc-500">Margen Neto</p><p className="font-black text-emerald-400">{stats.realRev > 0 ? fmtDec((stats.net / stats.realRev) * 100) : '0.00'}%</p></div><div><p className="text-[8px] text-zinc-500">Profit / Día</p><p className="font-black text-white">{fmt(avgDiario)}</p></div></div></Card><div className={`rounded-2xl p-4 text-white shadow-xl ${semaforo.color === 'bg-emerald-500' ? 'bg-emerald-600' : semaforo.color === 'bg-blue-500' ? 'bg-blue-600' : 'bg-rose-600'}`}><div><p className="text-[8px] font-black opacity-60">Proyección 30 Días</p><p className="text-[8px] opacity-50 mt-0.5">({fmt(avgDiario)}/día × 30)</p></div><p className="text-2xl md:text-4xl font-black">{fmt(proyeccion30)}</p><div className="bg-white/20 px-3 py-2 rounded-xl mt-2"><p className="text-sm md:text-lg font-black">{semaforo.emoji} {semaforo.texto}</p>{targetProfit > 0 && <p className="text-[8px] opacity-70">Meta: {fmt(targetProfit)} · 1M excelente</p>}</div><div className="flex justify-between text-[8px] font-black opacity-60 mt-3"><span>Días activos: {activeDays}</span><span>IER: {fmtDec(stats.ierGlobal, 2)}%</span></div></div>{targetProfit > 0 && (<Card className="col-span-2"><div className="flex justify-between text-xs"><Label>Avance vs Meta</Label><span className={`text-xs font-black ${semaforo.textColor}`}>{fmtDec((proyeccion30 / targetProfit) * 100, 2)}%</span></div><div className="h-2 bg-slate-100 rounded-full overflow-hidden mt-1"><div className={`h-full rounded-full ${semaforo.color === 'bg-emerald-500' ? 'bg-emerald-500' : semaforo.color === 'bg-blue-500' ? 'bg-blue-500' : 'bg-rose-500'}`} style={{ width: `${Math.min((proyeccion30 / targetProfit) * 100, 100)}%` }} /></div></Card>)}</div>)}</div>

        {/* PRODUCTOS EN REVISIÓN */}
        <div className="space-y-2"><button onClick={() => toggleSection('productosRevision')} className="w-full flex items-center justify-between py-2 px-3 md:py-3 md:px-4 bg-red-50 hover:bg-red-100 rounded-xl transition-colors border-l-4 border-red-500"><div className="flex items-center gap-1.5 md:gap-2"><AlertTriangle size={14} className="text-red-600" /><span className="text-[10px] md:text-xs font-black uppercase tracking-widest text-red-700">🚨 PRODUCTOS EN REVISIÓN ({productosEnRevision.length})</span></div>{openSections.productosRevision ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>{openSections.productosRevision && (<Card className="overflow-hidden p-0">{productosEnRevision.length === 0 ? <div className="p-6 text-center text-green-600 flex items-center justify-center gap-2"><CheckCircle2 size={20} /><span className="font-black text-sm">✅ No hay productos en revisión en este período</span></div> : (<div className="overflow-x-auto overscroll-x-contain"><table className="w-full text-left border-collapse text-[10px] md:text-sm"><thead className="bg-red-50 text-[7px] md:text-[8px] font-black uppercase text-red-700"><tr><th className="p-2 md:p-3">Vendedora</th><th className="p-2 md:p-3">Producto</th><th className="p-2 md:p-3 text-right">Utilidad Período</th><th className="p-2 md:p-3 text-right">Proy. 30 días</th><th className="p-2 md:p-3 text-right">Meta Mensual</th><th className="p-2 md:p-3 text-right">% Meta</th><th className="p-2 md:p-3 text-right">IER</th><th className="p-2 md:p-3 text-right">ROAS</th><th className="p-2 md:p-3 text-right">CPA</th><th className="p-2 md:p-3">⚠️ Alertas</th></tr></thead><tbody className="divide-y divide-slate-100">{productosEnRevision.map(p => { const porcentajeMeta = p.targetProfit > 0 ? (p.proyeccion30 / p.targetProfit) * 100 : 0; const alertas = []; if (p.utilidadPeriodo < 0) alertas.push('💰 pérdida'); if (p.ier < 70) alertas.push(`📉 IER ${fmtDec(p.ier,1)}%`); if (p.roas < 1.5 && p.roas > 0) alertas.push(`📊 ROAS ${fmtDec(p.roas,2)}x`); if (p.cpaEquilibrio > 0 && p.cpaReal > p.cpaEquilibrio) alertas.push('🎯 CPA alto'); if (p.pedidos === 0) alertas.push('⚠️ sin pedidos'); if (!p.isActive) alertas.push('🔴 PRODUCTO DESACTIVADO'); return (<tr key={p.configId} className={`hover:bg-red-50/50 transition ${!p.isActive ? 'opacity-75 bg-gray-50' : ''}`}><td className="p-2 md:p-3 font-black text-red-700 uppercase text-[9px] md:text-xs">{p.vendedora}</td><td className={`p-2 md:p-3 font-semibold text-[9px] md:text-xs ${!p.isActive ? 'line-through text-gray-500' : ''}`}>{p.productName}{!p.isActive && <span className="ml-2 text-[8px] font-black bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">⚠️ DESACTIVADO</span>}</td><td className={`p-2 md:p-3 text-right font-mono font-black ${p.utilidadPeriodo < 0 ? 'text-red-600' : 'text-amber-600'}`}>{fmt(p.utilidadPeriodo)}</td><td className="p-2 md:p-3 text-right font-mono font-black text-red-600">{fmt(p.proyeccion30)}</td><td className="p-2 md:p-3 text-right font-mono">{fmt(p.targetProfit)}</td><td className="p-2 md:p-3 text-right font-mono font-black"><span className={porcentajeMeta < 50 ? 'text-red-600' : 'text-amber-600'}>{fmtDec(porcentajeMeta, 1)}%</span></td><td className="p-2 md:p-3 text-right font-mono">{fmtDec(p.ier, 1)}%</td><td className="p-2 md:p-3 text-right font-mono">{fmtDec(p.roas, 2)}x</td><td className="p-2 md:p-3 text-right font-mono">{fmt(p.cpaReal)}</td><td className="p-2 md:p-3"><div className="flex flex-wrap gap-1">{alertas.map((a,i) => <span key={i} className={`text-[7px] md:text-[8px] font-black px-1.5 py-0.5 rounded-full ${a.includes('DESACTIVADO') ? 'bg-gray-300 text-gray-700' : 'bg-red-100 text-red-600'}`}>{a}</span>)}</div></td></tr>); })}</tbody></table>{productosEnRevision.some(p => !p.isActive) && (<div className="p-3 bg-gray-100 text-[8px] font-black text-gray-600 flex items-center gap-2 border-t"><Info size={12} /><span>📌 Los productos tachados están DESACTIVADOS. Su historial se muestra solo para referencia, pero ya no requieren acción.</span></div>)}</div>)}</Card>)}</div>

        {/* ANÁLISIS TEMPORAL POR PRODUCTO */}
        <div className="space-y-2"><SectionHeader title="ANÁLISIS TEMPORAL POR PRODUCTO" icon={CalendarDays} section="analisisProductos" totalItems={stats.detalleProductos.length} />{openSections.analisisProductos && (<div className="overflow-x-auto overscroll-x-contain"><table className="w-full text-left border-collapse text-[10px] md:text-sm"><thead className="bg-slate-100 text-[7px] md:text-[8px] font-black uppercase text-slate-500"><tr><th className="p-2">Vendedora</th><th className="p-2">Producto</th><th className="p-2">Primer registro</th><th className="p-2">Último registro</th><th className="p-2">Fecha creación</th><th className="p-2">Fecha desactivación</th><th className="p-2">Días activos</th><th className="p-2">Estado</th></tr></thead><tbody className="divide-y divide-slate-100">{stats.detalleProductos.map(p => { const diasActivos = Math.floor((parseColombiaDate(p.ultimoRegistro) - parseColombiaDate(p.primerRegistro)) / (1000*60*60*24)) + 1; const isActive = p.activo !== false; return (<tr key={p.configId} className="hover:bg-slate-50"><td className="p-2 font-bold uppercase text-[9px] md:text-xs">{p.vendedora}</td><td className={`p-2 font-semibold text-[9px] md:text-xs ${!isActive ? 'text-slate-400 line-through' : ''}`}>{p.productName}</td><td className="p-2 font-mono text-[8px] md:text-[10px]">{parseColombiaDate(p.primerRegistro).toLocaleDateString('es-CO')}</td><td className="p-2 font-mono text-[8px] md:text-[10px]">{parseColombiaDate(p.ultimoRegistro).toLocaleDateString('es-CO')}</td><td className="p-2 font-mono text-[8px] md:text-[10px]">{p.fechaCreacion ? parseColombiaDate(p.fechaCreacion).toLocaleDateString('es-CO') : '-'}</td><td className="p-2 font-mono text-[8px] md:text-[10px]">{p.fechaDesactivacion ? parseColombiaDate(p.fechaDesactivacion).toLocaleDateString('es-CO') : '-'}</td><td className="p-2 font-mono text-[8px] md:text-[10px]">{diasActivos} días</td><td className="p-2">{!isActive ? <span className="text-[8px] font-black bg-red-100 text-red-600 px-2 py-0.5 rounded-full flex items-center gap-1 w-fit"><PowerOff size={10} /> INACTIVO</span> : <span className="text-[8px] font-black bg-green-100 text-green-600 px-2 py-0.5 rounded-full flex items-center gap-1 w-fit"><Power size={10} /> ACTIVO</span>}</td></tr>); })}</tbody></table></div>)}</div>

        {/* COMPARATIVA ENTRE VENDEDORAS */}
        <div className="space-y-2"><button onClick={() => toggleSection('comparativaVendedoras')} className="w-full flex items-center justify-between py-2 px-3 md:py-3 md:px-4 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-colors"><div className="flex items-center gap-1.5 md:gap-2"><Users size={14} className="text-indigo-600" /><span className="text-[10px] md:text-xs font-black uppercase tracking-widest text-indigo-700">📊 COMPARATIVA ENTRE VENDEDORAS</span></div>{openSections.comparativaVendedoras ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>{openSections.comparativaVendedoras && (<Card className="overflow-x-auto overscroll-x-contain"><table className="w-full text-left border-collapse text-[10px] md:text-sm"><thead className="bg-indigo-50 text-[7px] md:text-[8px] font-black uppercase text-indigo-700"><tr><th className="p-2 md:p-3">Vendedora</th><th className="p-2 md:p-3 text-right">Inversión Ads</th><th className="p-2 md:p-3 text-right">CPA Promedio</th><th className="p-2 md:p-3 text-right">Utilidad Período</th><th className="p-2 md:p-3 text-right">Proy. 30 días</th><th className="p-2 md:p-3 text-right">Facturación Real</th><th className="p-2 md:p-3 text-right">ROAS</th><th className="p-2 md:p-3 text-right">IER</th></tr></thead><tbody className="divide-y divide-slate-100">{selectedVendors.length === 0 ? (<tr><td colSpan="8" className="p-4 text-center text-slate-400">Selecciona al menos una vendedora en los filtros para ver la comparativa.</td></tr>) : selectedVendors.map(vendor => { const vendorRecords = filteredRecords.filter(r => { const c = configs.find(x => x.id === r.configId); return c && c.vendedora === vendor; }); const vendorStats = calcularStats(vendorRecords, configs); const activeDaysV = new Set(vendorRecords.filter(r => !r.restDay).map(r => r.date)).size; const proy30 = activeDaysV > 0 ? (vendorStats.net / activeDaysV) * 30 : 0; return (<tr key={vendor} className="hover:bg-indigo-50/50"><td className="p-2 md:p-3 font-black uppercase text-indigo-700">{vendor}</td><td className="p-2 md:p-3 text-right font-mono">{fmt(vendorStats.totalAds)}</td><td className="p-2 md:p-3 text-right font-mono">{fmt(vendorStats.cpaReal)}</td><td className={`p-2 md:p-3 text-right font-mono font-black ${vendorStats.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(vendorStats.net)}</td><td className="p-2 md:p-3 text-right font-mono font-black">{fmt(proy30)}</td><td className="p-2 md:p-3 text-right font-mono">{fmt(vendorStats.realRev)}</td><td className="p-2 md:p-3 text-right font-mono">{fmtDec(vendorStats.roas, 2)}x</td><td className="p-2 md:p-3 text-right font-mono">{fmtDec(vendorStats.ierGlobal, 1)}%</td></tr>); })}</tbody></table>{selectedVendors.length > 0 && (<div className="p-3 bg-indigo-50 text-[8px] font-black text-indigo-600 flex justify-between"><span>Período: {filter.startDate} al {filter.endDate}</span><span>Registros analizados: {filteredRecords.length}</span></div>)}</Card>)}</div>
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
  actionItems: 'campaign_control_action_items',
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
  delivery: ['Entrega de anuncios', 'Entrega del anuncio', 'Ad delivery', 'Delivery', 'Estado de entrega'],
  spend: ['Importe gastado (COP)', 'Importe gastado', 'Amount spent (COP)', 'Amount spent', 'Gasto'],
  impressions: ['Impresiones', 'Impressions'],
  clicks: ['Clics en el enlace', 'Link clicks', 'Clics únicos en el enlace'],
  purchases: ['Compras', 'Compras en el sitio web', 'Purchases', 'Website purchases'],
  ctr: ['CTR (tasa de clics en el enlace)', 'CTR (porcentaje de clics en el enlace)', 'CTR (link click-through rate)', 'CTR'],
  cpc: ['CPC (Coste por clic en el enlace) (COP)', 'CPC (costo por clic en el enlace)', 'CPC (cost per link click)', 'CPC'],
  cpm: ['CPM (coste por 1000 impresiones) (COP)', 'CPM (costo por 1000 impresiones)', 'CPM (cost per 1,000 impressions)', 'CPM'],
  frequency: ['Frecuencia', 'Frequency'],
  hookRate: ['Hook Rate', 'Hook rate', 'Tasa de Hook', 'Tasa de hook'],
  holdRate: ['Hold Rate', 'Hold rate', 'Tasa de Hold', 'Tasa de hold'],
  avgVideoWatchTime: ['Tiempo medio de reproducción del vídeo', 'Tiempo medio de reproducción del video', 'Average video play time', 'Average video watch time'],
  landingViews: [
    'Visitas a la página de destino',
    'Visitas a la página de destino del sitio web',
    'Visitas de la página de destino',
    'Visitas de la página de destino del sitio web',
    'Landing page views',
    'Website landing page views',
    'Visitas landing'
  ],
  atc: [
    'Artículos añadidos al carrito',
    'Artículos añadidos al carrito en el sitio web',
    'Añadidos al carrito',
    'Añadidos al carrito en el sitio web',
    'Añadir al carrito',
    'Adds to cart',
    'Website adds to cart',
    'ATC'
  ],
  roas: ['ROAS (retorno del gasto publicitario) de compras', 'ROAS (retorno del gasto publicitario) de compras en el sitio web', 'Purchase ROAS', 'ROAS'],
  startDate: ['Inicio del informe', 'Reporting starts', 'Fecha de inicio'],
  endDate: ['Fin del informe', 'Reporting ends', 'Fecha de fin']
};

function colombiaPartsCC(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  const map = {};
  parts.forEach(p => {
    if (p.type !== 'literal') map[p.type] = p.value;
  });
  return map;
}

function todayColombiaCC() {
  const p = colombiaPartsCC();
  return `${p.year}-${p.month}-${p.day}`;
}

function colombiaDateTimeLabelCC(date = new Date()) {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date);
}

function colombiaDateTimeStorageCC(date = new Date()) {
  const p = colombiaPartsCC(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

function shiftIsoDateCC(isoDate, days) {
  const m = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + Number(days || 0), 12, 0, 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function lastCompleteColombiaDateCC() {
  return shiftIsoDateCC(todayColombiaCC(), -1);
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

function normalizeMetaDeliveryStatusCC(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');
}

function isMetaAdExplicitlyInactiveCC(value = '') {
  const status = normalizeMetaDeliveryStatusCC(value);
  if (!status) return false;

  // Solo estados que expresan una desactivación/pausa real.
  // "pending_process", "learning", "not_delivering", etc. NO se filtran aquí.
  const exactInactive = new Set([
    'inactive',
    'disabled',
    'off',
    'paused',
    'archived',
    'deleted',
    'permanently_disabled',
    'ad_paused',
    'adset_paused',
    'ad_set_paused',
    'campaign_paused',
    'inactivo',
    'inactiva',
    'desactivado',
    'desactivada',
    'pausado',
    'pausada',
    'apagado',
    'apagada',
    'archivado',
    'archivada',
    'eliminado',
    'eliminada'
  ]);

  return exactInactive.has(status);
}

function resolveCsvValue(row, aliases) {
  const normalized = {};
  Object.entries(row).forEach(([key, value]) => { normalized[normalizeHeader(key)] = value; });

  // Meta suele exportar dos o más columnas equivalentes.
  // Elegimos el primer alias que tenga un valor REAL, no simplemente
  // la primera columna que exista en el CSV.
  for (const alias of aliases) {
    const key = normalizeHeader(alias);
    if (!Object.prototype.hasOwnProperty.call(normalized, key)) continue;
    const value = normalized[key];
    if (value !== null && value !== undefined && String(value).trim() !== '') return value;
  }
  return '';
}

function hasCsvMetricValueCC(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
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
  // CPA = gasto / compras. Sin compra NO existe CPA.
  return p > 0 ? s / p : null;
}

function fmtCpa(value) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
  return fmtMoney(value);
}

function fmtMoneyOrDashCC(value) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
  return fmtMoney(value);
}

function fmtRate(value, suffix = '%') {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
  return `${fmtNum(value, 2)}${suffix}`;
}

function parseMetaPercentCC(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const raw = String(value).trim();
  const explicitPercent = raw.includes('%');
  const n = toNumber(raw);
  if (!Number.isFinite(n)) return null;

  // Meta exporta Hook/Hold normalmente como proporción 0–1.
  // Si ya viene con % o con valor > 1, lo tratamos como porcentaje.
  if (!explicitPercent && Math.abs(n) <= 1) return n * 100;
  return n;
}

const HOOK_HOLD_SAMPLE_CC = {
  hookMinImpressions: 500,
  holdMinEstimated3s: 100
};

function hookLevelCC(rate) {
  if (rate === null || rate === undefined || !Number.isFinite(Number(rate))) {
    return { level: 'SIN DATOS', tone: 'neutral', reading: 'Hook Rate no disponible.', action: 'No diagnosticar apertura.' };
  }
  const v = Number(rate);
  if (v < 15) return { level: 'CRÍTICO', tone: 'critical', reading: 'El inicio prácticamente no detiene el scroll.', action: 'Replantear concepto/apertura.' };
  if (v < 20) return { level: 'BAJO', tone: 'alert', reading: 'Hook débil.', action: 'Crear nuevos primeros 3 s.' };
  if (v < 25) return { level: 'ACEPTABLE', tone: 'attention', reading: 'Capta atención, pero tiene margen claro.', action: 'Probar variantes de hook.' };
  if (v < 30) return { level: 'BUENO', tone: 'good', reading: 'Apertura competitiva.', action: 'Conservar elementos principales y testear mejoras.' };
  if (v < 40) return { level: 'FUERTE', tone: 'good', reading: 'El hook es una fortaleza.', action: 'Replicar patrón/ángulo del hook.' };
  return { level: 'EXCEPCIONAL', tone: 'good', reading: 'Capacidad muy alta de detener scroll.', action: 'Preservar como activo creativo; validar negocio.' };
}

function holdLevelCC(rate) {
  if (rate === null || rate === undefined || !Number.isFinite(Number(rate))) {
    return { level: 'SIN DATOS', tone: 'neutral', reading: 'Hold Rate no disponible.', action: 'No diagnosticar cuerpo.' };
  }
  const v = Number(rate);
  if (v < 10) return { level: 'CRÍTICO', tone: 'critical', reading: 'La mayoría abandona poco después del hook.', action: 'Rehacer desarrollo 3–15 s.' };
  if (v < 15) return { level: 'BAJO', tone: 'alert', reading: 'Retención insuficiente.', action: 'Acelerar demostración, beneficio y ritmo.' };
  if (v < 20) return { level: 'ACEPTABLE', tone: 'attention', reading: 'Retención funcional, con margen.', action: 'Testear cuerpo más directo.' };
  if (v < 25) return { level: 'BUENO', tone: 'good', reading: 'El cuerpo retiene bien.', action: 'Conservar estructura y probar optimizaciones.' };
  if (v < 30) return { level: 'FUERTE', tone: 'good', reading: 'Muy buena continuidad después del hook.', action: 'Replicar estructura narrativa.' };
  return { level: 'EXCEPCIONAL', tone: 'good', reading: 'Retención sobresaliente para esta escala.', action: 'Preservar cuerpo; validar conversión.' };
}

function likelyVideoCreativeCC(ad, stats) {
  const name = normalizeAdName(ad?.name || '');
  const nameSuggestsVideo = /(^|\s)(video|reel|ugc|vsl)(\s|$)/i.test(name);
  const hook = stats?.hookRate;
  const hold = stats?.holdRate;
  const hasVideoSignal = stats?.videoMetricAvailable === true ||
    (hold !== null && hold !== undefined && Number(hold) > 0) ||
    (hook !== null && hook !== undefined && Number(hook) >= 1);
  return nameSuggestsVideo || hasVideoSignal;
}

function hookHoldDiagnosticCC(stats, previousStats, ad = null) {
  const isVideo = likelyVideoCreativeCC(ad, stats);
  if (!isVideo) {
    return {
      isVideo: false,
      sampleOk: false,
      sampleLabel: 'NO APLICA',
      hook: hookLevelCC(null),
      hold: holdLevelCC(null),
      hookDelta: null,
      holdDelta: null,
      diagnosis: 'No aplica · creativo no identificado como video',
      action: 'Usar diagnóstico comercial, dinámico y post-clic.',
      tone: 'neutral'
    };
  }

  const hookRate = stats?.hookRate ?? null;
  const holdRate = stats?.holdRate ?? null;
  const hook = hookLevelCC(hookRate);
  const hold = holdLevelCC(holdRate);
  const hookDelta = pctChange(hookRate, previousStats?.hookRate);
  const holdDelta = pctChange(holdRate, previousStats?.holdRate);
  const impressions = toNumber(stats?.impressions);
  const estimated3s = toNumber(stats?.video3sPlaysEstimated);
  const sampleOk = impressions >= HOOK_HOLD_SAMPLE_CC.hookMinImpressions &&
    estimated3s >= HOOK_HOLD_SAMPLE_CC.holdMinEstimated3s;

  if (hookRate === null || holdRate === null) {
    return {
      isVideo: true,
      sampleOk: false,
      sampleLabel: 'DATOS INCOMPLETOS',
      hook,
      hold,
      hookDelta,
      holdDelta,
      diagnosis: 'Hook/Hold incompletos',
      action: 'Reimportar CSV con Hook Rate y Hold Rate.',
      tone: 'attention'
    };
  }

  if (!sampleOk) {
    return {
      isVideo: true,
      sampleOk: false,
      sampleLabel: 'MUESTRA BAJA',
      hook,
      hold,
      hookDelta,
      holdDelta,
      diagnosis: 'Muestra insuficiente para diagnóstico creativo firme',
      action: `Acumular muestra. Referencia interna: ≥${HOOK_HOLD_SAMPLE_CC.hookMinImpressions} impresiones y ≥${HOOK_HOLD_SAMPLE_CC.holdMinEstimated3s} reproducciones estimadas de 3 s.`,
      tone: 'attention'
    };
  }

  // Para traducir la matriz Fuerte/Débil a la escala de 6 bandas:
  // BUENO o superior = señal sólida; CRÍTICO/BAJO = señal débil;
  // ACEPTABLE se trata como zona intermedia y recibe una recomendación moderada.
  const hookStrong = Number(hookRate) >= 25;
  const holdStrong = Number(holdRate) >= 20;
  const hookWeak = Number(hookRate) < 20;
  const holdWeak = Number(holdRate) < 15;

  let diagnosis = 'Base creativa funcional';
  let action = 'Realizar variaciones controladas y validar resultado comercial.';
  let tone = 'attention';

  if (hookStrong && holdStrong) {
    diagnosis = 'APERTURA Y DESARROLLO FUNCIONAN';
    action = 'Replicar el concepto y hacer variaciones controladas.';
    tone = 'good';
  } else if (hookStrong && holdWeak) {
    diagnosis = 'FORTALEZA EN EL HOOK · FUGA EN EL CUERPO';
    action = 'CONSERVAR HOOK → variar cuerpo 3–15 s.';
    tone = 'alert';
  } else if (hookWeak && holdStrong) {
    diagnosis = 'OPORTUNIDAD EN EL HOOK · CUERPO FUERTE';
    action = 'CONSERVAR CUERPO → crear nuevos hooks.';
    tone = 'alert';
  } else if (hookWeak && holdWeak) {
    diagnosis = 'APERTURA Y DESARROLLO DÉBILES';
    action = 'Probar un nuevo concepto creativo; no limitarse a retoques.';
    tone = 'critical';
  } else if (hookStrong) {
    diagnosis = 'HOOK SÓLIDO · CUERPO CON MARGEN';
    action = 'Conservar la apertura y testear un cuerpo 3–15 s más directo.';
    tone = 'attention';
  } else if (holdStrong) {
    diagnosis = 'CUERPO SÓLIDO · HOOK CON MARGEN';
    action = 'Conservar el cuerpo y producir nuevas aperturas.';
    tone = 'attention';
  } else {
    diagnosis = 'HOOK Y HOLD ACEPTABLES · MARGEN DE MEJORA';
    action = 'Testear mejoras controladas sin alterar simultáneamente todo el video.';
    tone = 'attention';
  }

  return {
    isVideo: true,
    sampleOk: true,
    sampleLabel: 'MUESTRA SUFICIENTE',
    hook,
    hold,
    hookDelta,
    holdDelta,
    diagnosis,
    action,
    tone
  };
}

function safeRate(numerator, denominator) {
  const n = toNumber(numerator);
  const d = toNumber(denominator);
  // Una tasa sin denominador no es 0%; es no calculable.
  return d > 0 ? (n / d) * 100 : null;
}

function pctChange(current, previous) {
  // No fabricar variaciones a partir de métricas no calculables.
  if (current === null || current === undefined || current === '' ||
      previous === null || previous === undefined || previous === '') return null;
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
    days: 0, spend: 0, purchases: 0, cpa: null, ctr: null, cpc: null, cpm: null,
    frequency: null, impressions: null, clicks: null, landingViews: null, atc: null, roas: null,
    hookRate: null, holdRate: null, video3sPlaysEstimated: null, video15sPlaysEstimated: null,
    videoMetricAvailable: false,
    clickToLanding: null, visitToAtc: null, visitToPurchase: null, atcToPurchase: null,
    postClickCoverage: { clicks: false, landingViews: false, atc: false }
  };

  const spend = records.reduce((sum, r) => sum + toNumber(r.spend), 0);
  const purchases = records.reduce((sum, r) => sum + toNumber(r.purchases), 0);

  const hasMetric = (record, key, availabilityKey = null) => {
    if (availabilityKey && record?.[availabilityKey] === true) return true;
    return record?.[key] !== null && record?.[key] !== undefined && record?.[key] !== '';
  };

  const clickRows = records.filter(r => hasMetric(r, 'clicks', 'clicksDataAvailable'));
  const landingRows = records.filter(r => hasMetric(r, 'landingViews', 'landingViewsDataAvailable'));
  const atcRows = records.filter(r => hasMetric(r, 'atc', 'atcDataAvailable'));
  const impressionRows = records.filter(r => hasMetric(r, 'impressions'));

  const clicks = clickRows.length ? clickRows.reduce((sum, r) => sum + toNumber(r.clicks), 0) : null;
  const landingViews = landingRows.length ? landingRows.reduce((sum, r) => sum + toNumber(r.landingViews), 0) : null;
  const atc = atcRows.length ? atcRows.reduce((sum, r) => sum + toNumber(r.atc), 0) : null;
  const impressions = impressionRows.length ? impressionRows.reduce((sum, r) => sum + toNumber(r.impressions), 0) : null;
  const days = new Set(records.map(r => String(r.date || '')).filter(Boolean)).size || records.length;

  const weightedPositive = (key, weightKey = 'spend') => {
    const valid = records.filter(r => {
      const value = toNumber(r[key]);
      const weight = toNumber(r[weightKey]);
      return value > 0 && weight > 0;
    });
    const denom = valid.reduce((sum, r) => sum + toNumber(r[weightKey]), 0);
    if (!denom) return null;
    return valid.reduce((sum, r) => sum + toNumber(r[key]) * toNumber(r[weightKey]), 0) / denom;
  };

  const weightedAllowZero = (key, weightKey = 'spend') => {
    const valid = records.filter(r => toNumber(r[weightKey]) > 0 && r[key] !== null && r[key] !== undefined && r[key] !== '');
    const denom = valid.reduce((sum, r) => sum + toNumber(r[weightKey]), 0);
    if (!denom) return null;
    return valid.reduce((sum, r) => sum + toNumber(r[key]) * toNumber(r[weightKey]), 0) / denom;
  };

  // CTR = clics de enlace / impresiones.
  // CPC = gasto / clics.
  // CPM = gasto / impresiones * 1000.
  const ctr = impressions > 0 && clicks !== null ? (clicks / impressions) * 100 : weightedAllowZero('ctr', 'spend');
  const cpc = clicks > 0 ? spend / clicks : weightedPositive('cpc', 'spend');
  const cpm = impressions > 0 ? (spend / impressions) * 1000 : weightedPositive('cpm', 'spend');

  // Frecuencia de varios días no puede reconstruirse exactamente sin Reach.
  // Usamos la mejor aproximación disponible: frecuencia reportada ponderada por impresiones.
  const frequency = weightedPositive('frequency', 'impressions') ?? weightedPositive('frequency', 'spend');

  // ROAS agregado ponderado por gasto equivale a sumar el valor atribuido / gasto
  // cuando Meta entrega ROAS por fila.
  const roas = weightedAllowZero('roas', 'spend');

  // HOOK/HOLD de video.
  // Hook agregado = reproducciones estimadas 3 s / impresiones.
  // Hold agregado = reproducciones estimadas 15 s/ThruPlay / reproducciones estimadas 3 s.
  // Como el CSV ya entrega las tasas, reconstruimos los denominadores con impresiones.
  const hookRows = records.filter(r =>
    r.hookRateDataAvailable === true &&
    r.hookRate !== null && r.hookRate !== undefined &&
    toNumber(r.impressions) > 0
  );
  const hookImpressions = hookRows.reduce((sum, r) => sum + toNumber(r.impressions), 0);
  const video3sPlaysEstimated = hookRows.length
    ? hookRows.reduce((sum, r) => sum + toNumber(r.impressions) * (toNumber(r.hookRate) / 100), 0)
    : null;
  const hookRate = hookImpressions > 0 && video3sPlaysEstimated !== null
    ? (video3sPlaysEstimated / hookImpressions) * 100
    : null;

  const holdRows = records.filter(r =>
    r.holdRateDataAvailable === true &&
    r.hookRateDataAvailable === true &&
    r.holdRate !== null && r.holdRate !== undefined &&
    r.hookRate !== null && r.hookRate !== undefined &&
    toNumber(r.impressions) > 0
  );
  const hold3sBase = holdRows.reduce(
    (sum, r) => sum + toNumber(r.impressions) * (toNumber(r.hookRate) / 100),
    0
  );
  const video15sPlaysEstimated = holdRows.length
    ? holdRows.reduce((sum, r) => {
        const estimated3s = toNumber(r.impressions) * (toNumber(r.hookRate) / 100);
        return sum + estimated3s * (toNumber(r.holdRate) / 100);
      }, 0)
    : null;
  const holdRate = hold3sBase > 0 && video15sPlaysEstimated !== null
    ? (video15sPlaysEstimated / hold3sBase) * 100
    : null;
  const videoMetricAvailable = records.some(r => r.videoMetricAvailable === true) ||
    (holdRate !== null && holdRate > 0) || (hookRate !== null && hookRate >= 1);

  return {
    days,
    spend,
    purchases,
    cpa: calcCpa(spend, purchases),
    ctr,
    cpc,
    cpm,
    frequency,
    impressions,
    clicks,
    landingViews,
    atc,
    roas,
    hookRate,
    holdRate,
    video3sPlaysEstimated,
    video15sPlaysEstimated,
    videoMetricAvailable,
    clickToLanding: clicks !== null && landingViews !== null ? safeRate(landingViews, clicks) : null,
    visitToAtc: landingViews !== null && atc !== null ? safeRate(atc, landingViews) : null,
    visitToPurchase: landingViews !== null ? safeRate(purchases, landingViews) : null,
    atcToPurchase: atc !== null ? safeRate(purchases, atc) : null,
    postClickCoverage: {
      clicks: clickRows.length > 0,
      landingViews: landingRows.length > 0,
      atc: atcRows.length > 0
    }
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

function volumeConfidenceLabel(purchases) {
  const value = toNumber(purchases);
  if (value <= 0) return 'Sin muestra';
  if (value < 5) return 'Baja';
  if (value < 15) return 'Media';
  if (value < 30) return 'Alta';
  return 'Muy alta';
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

function previousCampaignBudgetCC(dailyCampaigns, campaignId, targetDate) {
  const previous = (dailyCampaigns || [])
    .filter(r =>
      r.campaignId === campaignId &&
      r.date &&
      String(r.date) < String(targetDate || '') &&
      toNumber(r.budget) > 0
    )
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];

  if (!previous) return null;
  return {
    budget: toNumber(previous.budget),
    date: String(previous.date),
    source: previous.budgetSource || previous.source || 'registered'
  };
}

function campaignRegistrationCoverageCC(campaign, product, dailyCampaigns, throughDate = lastCompleteColombiaDateCC()) {
  // La fecha de campaña es independiente y manda para su histórico.
  const start = dateToIso(campaign?.effectiveStartDate || campaign?.createdDate) || '';
  const end = dateToIso(throughDate);

  if (!start || !end || start > end) {
    return {
      startDate: start,
      throughDate: end,
      requiredDays: 0,
      registeredDays: 0,
      missingDays: 0,
      missingDates: [],
      requiredDates: []
    };
  }

  const requiredDates = [];
  let cursor = start;
  let safety = 0;

  while (cursor && cursor <= end && safety < 5000) {
    if (entityActiveOnDate(campaign, cursor)) {
      requiredDates.push(cursor);
    }
    cursor = shiftIsoDateCC(cursor, 1);
    safety += 1;
  }

  const registeredSet = new Set(
    (dailyCampaigns || [])
      .filter(r => r.campaignId === campaign?.id && r.date)
      .map(r => String(r.date))
  );

  const missingDates = requiredDates.filter(d => !registeredSet.has(d));

  return {
    startDate: start,
    throughDate: end,
    requiredDays: requiredDates.length,
    registeredDays: requiredDates.length - missingDates.length,
    missingDays: missingDates.length,
    missingDates,
    requiredDates
  };
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
  const cpa = delta?.cpa;
  const ctr = delta?.ctr;
  const cpc = delta?.cpc;
  const cpm = delta?.cpm;
  const freq = delta?.frequency;
  const cvr = delta?.visitToPurchase;

  const has = value => value !== null && value !== undefined && Number.isFinite(Number(value));
  const gt = (value, threshold) => has(value) && Number(value) > threshold;
  const lt = (value, threshold) => has(value) && Number(value) < threshold;
  const stable = (value, threshold = 10) => has(value) && Math.abs(Number(value)) <= threshold;

  if (gt(cpa, 20) && lt(ctr, -20) && gt(cpc, 20) && gt(freq, 20)) {
    return { diagnosis: 'Fatiga confirmada', action: 'Apagar/reemplazar si no rentable', tone: 'critical' };
  }
  if (gt(cpa, 15) && lt(ctr, -15) && gt(cpc, 15) && gt(freq, 15)) {
    return { diagnosis: 'Fatiga probable', action: 'Lanzar test creativo y detener escalado', tone: 'alert' };
  }
  if (gt(cpa, 10) && lt(ctr, -10) && gt(cpc, 10) && gt(freq, 10)) {
    return { diagnosis: 'Fatiga temprana', action: 'Preparar 3–5 creativos', tone: 'attention' };
  }
  if (gt(cpa, 10) && stable(ctr) && stable(cpc) && lt(cvr, -10)) {
    return {
      diagnosis: 'Deterioro post-clic',
      action: 'Investigar conversión post-clic y comparar contra otros anuncios',
      tone: 'alert'
    };
  }
  if (gt(cpm, 15) && stable(ctr) && stable(cvr)) {
    return {
      diagnosis: 'Costo de impresión en aumento',
      action: 'Vigilar CPM/CPC sin atribuir una causa única',
      tone: 'attention'
    };
  }
  return { diagnosis: 'Sin deterioro combinado fuerte', action: 'Mantener lectura relacional', tone: 'normal' };
}

function postClickDataQualityCC(stats) {
  const clicksAvailable = stats?.postClickCoverage?.clicks === true || (stats?.clicks !== null && stats?.clicks !== undefined);
  const landingAvailable = stats?.postClickCoverage?.landingViews === true || (stats?.landingViews !== null && stats?.landingViews !== undefined);
  const atcAvailable = stats?.postClickCoverage?.atc === true || (stats?.atc !== null && stats?.atc !== undefined);

  const clicks = clicksAvailable ? toNumber(stats?.clicks) : null;
  const landing = landingAvailable ? toNumber(stats?.landingViews) : null;
  const atc = atcAvailable ? toNumber(stats?.atc) : null;
  const purchases = toNumber(stats?.purchases);
  const spend = toNumber(stats?.spend);

  if (purchases > 0 && (!landingAvailable || landing <= 0)) {
    return {
      level: 'missing',
      evaluable: false,
      label: 'DATOS POST-CLIC FALTANTES',
      reason: `Hay ${fmtNum(purchases, 2)} compra(s), pero Visitas landing está en 0/ausente. Ese 0 no se considera un dato real del embudo.`,
      action: 'Reimportar el CSV original con Visitas landing y ATC.'
    };
  }

  if (purchases > 0 && (!atcAvailable || atc <= 0)) {
    return {
      level: 'partial',
      evaluable: true,
      label: 'ATC FALTANTE / TRACKING INCOMPLETO',
      reason: `Hay ${fmtNum(purchases, 2)} compra(s), pero ATC está en 0/ausente. Visita→Compra sí puede analizarse; ATC→Compra no es confiable.`,
      action: 'Reimportar CSV o revisar el evento AddToCart.'
    };
  }

  if (spend > 0 && clicks !== null && clicks > 0 && (!landingAvailable || landing <= 0)) {
    return {
      level: 'missing',
      evaluable: false,
      label: 'VISITAS LANDING FALTANTES',
      reason: `Hay ${fmtNum(clicks, 2)} clic(s) de enlace y gasto, pero no hay Visitas landing registradas.`,
      action: 'Reimportar CSV con Visitas a la página de destino.'
    };
  }

  if (!landingAvailable && !atcAvailable) {
    return {
      level: 'missing',
      evaluable: false,
      label: 'SIN DATOS POST-CLIC',
      reason: 'El registro no contiene Visitas landing ni ATC.',
      action: 'Importar/reimportar un CSV de Meta que incluya esas columnas.'
    };
  }

  if (landingAvailable && landing === 0 && purchases === 0 && spend === 0) {
    return {
      level: 'no_delivery',
      evaluable: false,
      label: 'SIN ENTREGA / SIN MUESTRA',
      reason: 'No hubo tráfico suficiente para formar un embudo post-clic.',
      action: 'No evaluar post-clic todavía.'
    };
  }

  const notes = [];
  if (!clicksAvailable) notes.push('Clic→Landing no disponible');
  if (!atcAvailable) notes.push('ATC→Compra no disponible');

  return {
    level: notes.length ? 'partial' : 'complete',
    evaluable: true,
    label: notes.length ? 'DATOS PARCIALES' : 'DATOS COMPLETOS',
    reason: notes.length ? notes.join(' · ') : 'Clics, visitas landing y ATC disponibles.',
    action: notes.length ? 'Analizar solo las etapas disponibles.' : 'Embudo disponible para diagnóstico.'
  };
}

function funnelVariationDiagnosisFromDelta(delta, currentStats = null, previousStats = null) {
  const quality = postClickDataQualityCC(currentStats);

  if (!quality.evaluable) {
    return {
      diagnosis: quality.label,
      action: quality.action,
      tone: quality.level === 'missing' ? 'alert' : 'attention',
      evaluable: false,
      dataQuality: quality
    };
  }

  const ctl = delta?.clickToLanding;
  const vta = delta?.visitToAtc;
  const vtp = delta?.visitToPurchase;
  const atp = delta?.atcToPurchase;
  const available = [ctl, vta, vtp, atp].filter(v => v !== null && v !== undefined);

  if (!available.length) {
    return {
      diagnosis: 'Sin base comparable',
      action: quality.level === 'partial'
        ? quality.action
        : 'Acumular un periodo anterior para medir tendencia',
      tone: 'attention',
      evaluable: true,
      dataQuality: quality
    };
  }

  const le = (value, threshold) => value !== null && value !== undefined && value <= threshold;

  if (le(ctl, -20)) {
    return {
      diagnosis: 'Fuga clic → landing',
      action: 'Revisar velocidad, carga, enlace y experiencia de la landing',
      tone: 'critical',
      evaluable: true,
      dataQuality: quality
    };
  }

  if (le(vta, -20) && le(vtp, -20)) {
    return {
      diagnosis: 'Tráfico post-clic deteriorado',
      action: 'Revisar creativo→landing y calidad del tráfico',
      tone: 'critical',
      evaluable: true,
      dataQuality: quality
    };
  }

  if (le(vta, -15) && le(vtp, -15)) {
    return {
      diagnosis: 'Calidad de tráfico cayendo',
      action: 'Revisar creativo y coherencia anuncio→landing',
      tone: 'alert',
      evaluable: true,
      dataQuality: quality
    };
  }

  if (!le(vta, -10) && le(vtp, -15) && le(atp, -15)) {
    return {
      diagnosis: 'Fuga al cierre',
      action: 'Revisar formulario, confianza, oferta y fricción de compra',
      tone: 'alert',
      evaluable: true,
      dataQuality: quality
    };
  }

  if (le(vta, -10) && !le(vtp, -10)) {
    return {
      diagnosis: 'Menor intención inicial',
      action: 'Revisar coherencia anuncio→producto/oferta',
      tone: 'attention',
      evaluable: true,
      dataQuality: quality
    };
  }

  if (available.every(v => Math.abs(v) <= 10)) {
    return {
      diagnosis: quality.level === 'partial' ? 'Post-clic estable · datos parciales' : 'Post-clic estable',
      action: quality.level === 'partial' ? quality.action : 'Mantener',
      tone: 'normal',
      evaluable: true,
      dataQuality: quality
    };
  }

  return {
    diagnosis: 'Post-clic en observación',
    action: quality.level === 'partial' ? quality.action : 'Monitorear',
    tone: 'attention',
    evaluable: true,
    dataQuality: quality
  };
}



function buildMetaDeliveryDiagnosis3D(records, ad, campaign) {
  const eligible = eligibleAdRecords(records || [], ad, campaign);
  const { current } = splitPeriodRecords(eligible, '3d');

  const days = [...new Set(
    current
      .map(r => String(r.date || ''))
      .filter(Boolean)
  )];

  const omittedDays = [...new Set(
    current
      .filter(r => r.metaOmittedNoDelivery === true || r.source === 'meta_csv_zero_fill')
      .map(r => String(r.date || ''))
      .filter(Boolean)
  )];

  const stats = aggregateRecords(current);
  const omittedCount = omittedDays.length;
  const totalDays = days.length;

  if (!totalDays) {
    return {
      status: 'Sin lectura 3D',
      level: 'neutral',
      action: 'Esperar datos',
      reason: 'Aún no existen días completos dentro de la ventana 3D.',
      omittedDays: 0,
      totalDays: 0,
      isNoDelivery: false,
      isLimited: false
    };
  }

  // Caso más claro: Meta omitió el anuncio y no hubo ninguna entrega real.
  if (omittedCount === totalDays && stats.spend <= 0 && stats.impressions <= 0) {
    return {
      status: 'Sin entrega de Meta',
      level: 'attention',
      action: 'No juzgar rendimiento · revisar distribución',
      reason: `El anuncio estuvo activo pero Meta lo omitió en ${omittedCount}/${totalDays} día(s) de la ventana 3D. No tuvo gasto ni impresiones suficientes para evaluar rendimiento.`,
      omittedDays: omittedCount,
      totalDays,
      isNoDelivery: true,
      isLimited: false
    };
  }

  // Caso parcial: uno o más días completos fueron omitidos por Meta.
  if (omittedCount > 0) {
    return {
      status: 'Entrega limitada por Meta',
      level: 'attention',
      action: 'Vigilar distribución · no apagar por rendimiento',
      reason: `Meta omitió este anuncio en ${omittedCount}/${totalDays} día(s) de la ventana 3D. La señal de rendimiento tiene menos exposición y debe interpretarse con cautela.`,
      omittedDays: omittedCount,
      totalDays,
      isNoDelivery: false,
      isLimited: true
    };
  }

  return {
    status: 'Entrega normal',
    level: 'good',
    action: 'Evaluar rendimiento normalmente',
    reason: 'Meta reportó entrega en todos los días disponibles de la ventana 3D.',
    omittedDays: 0,
    totalDays,
    isNoDelivery: false,
    isLimited: false
  };
}

function buildCpaObservation3D(stats3d, previous3d, maxCpa) {
  const max = Math.max(1, toNumber(maxCpa));
  const scaleLimit = max * 0.8;
  const cpa = toNumber(stats3d?.cpa);
  const spend = toNumber(stats3d?.spend);
  const purchases = toNumber(stats3d?.purchases);
  const previousCpa = toNumber(previous3d?.cpa);
  const delta = pctChange(cpa, previousCpa);

  if (!stats3d?.days) {
    return {
      level: 'neutral',
      title: 'SIN LECTURA 3D',
      text: 'Todavía no existen días completos suficientes para evaluar el CPA operativo.',
      delta,
      aboveMaxPct: null
    };
  }

  if (spend > 0 && purchases <= 0) {
    const spendVsMax = (spend / max) * 100;

    if (spend >= max) {
      return {
        level: 'critical',
        title: 'SIN COMPRAS · GASTO ALCANZÓ EL CPA MÁXIMO',
        text: `Se gastaron ${fmtMoney(spend)} en 3D sin ninguna compra (${fmtNum(spendVsMax, 2)}% del CPA máximo ${fmtMoney(max)}). El CPA no es calculable. No escalar y priorizar optimización.`,
        delta: null,
        aboveMaxPct: null
      };
    }

    if (spend >= max * 0.5) {
      return {
        level: 'alert',
        title: 'SIN COMPRAS · VIGILAR',
        text: `Se gastaron ${fmtMoney(spend)} en 3D sin compras (${fmtNum(spendVsMax, 2)}% del CPA máximo). El CPA no es calculable; todavía no se debe interpretar el gasto como CPA.`,
        delta: null,
        aboveMaxPct: null
      };
    }

    return {
      level: 'attention',
      title: 'SIN COMPRAS AÚN · CPA NO CALCULABLE',
      text: `Se gastaron ${fmtMoney(spend)} en 3D sin compras (${fmtNum(spendVsMax, 2)}% del CPA máximo). Aún hay poca inversión para juzgar; CPA = —, nunca ${fmtMoney(spend)}.`,
      delta: null,
      aboveMaxPct: null
    };
  }

  if (cpa <= 0) {
    return {
      level: 'neutral',
      title: 'CPA 3D SIN DATO VÁLIDO',
      text: 'No hay un CPA 3D válido para tomar una decisión.',
      delta,
      aboveMaxPct: null
    };
  }

  if (cpa <= scaleLimit) {
    const margin = ((max - cpa) / max) * 100;
    return {
      level: 'good',
      title: 'CPA 3D EN ZONA DE ESCALA',
      text: `CPA ${fmtMoney(cpa)} · ${fmtNum(margin, 2)}% por debajo del máximo ${fmtMoney(max)}. Puede escalar si pasan los demás guardrails 3D.`,
      delta,
      aboveMaxPct: null
    };
  }

  if (cpa <= max) {
    const margin = ((max - cpa) / max) * 100;
    return {
      level: 'attention',
      title: 'CPA 3D DENTRO DEL OBJETIVO',
      text: `CPA ${fmtMoney(cpa)} · ${fmtNum(margin, 2)}% por debajo del máximo, pero todavía no alcanza el margen de 20% para escala fuerte.`,
      delta,
      aboveMaxPct: null
    };
  }

  const aboveMaxPct = ((cpa - max) / max) * 100;

  if (delta !== null && delta <= 0) {
    return {
      level: 'alert',
      title: 'CPA FUERA DEL OBJETIVO, PERO RECUPERÁNDOSE',
      text: `CPA 3D ${fmtMoney(cpa)} · ${fmtNum(aboveMaxPct, 2)}% por encima del máximo ${fmtMoney(max)}, pero viene mejorando ${fmtNum(Math.abs(delta), 2)}% vs los 3 días anteriores. No escalar todavía.`,
      delta,
      aboveMaxPct
    };
  }

  if (delta !== null && delta > 15) {
    return {
      level: 'critical',
      title: 'CPA FUERA DEL OBJETIVO Y DETERIORÁNDOSE',
      text: `CPA 3D ${fmtMoney(cpa)} · ${fmtNum(aboveMaxPct, 2)}% por encima del máximo ${fmtMoney(max)} y empeora ${fmtNum(delta, 2)}% vs los 3 días anteriores. No escalar y priorizar optimización.`,
      delta,
      aboveMaxPct
    };
  }

  return {
    level: 'alert',
    title: 'CPA 3D FUERA DEL OBJETIVO',
    text: `CPA 3D ${fmtMoney(cpa)} · ${fmtNum(aboveMaxPct, 2)}% por encima del máximo ${fmtMoney(max)}. No escalar hasta volver dentro del objetivo.`,
    delta,
    aboveMaxPct
  };
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
    hookRate: pctChange(c.hookRate, p.hookRate), holdRate: pctChange(c.holdRate, p.holdRate),
    clickToLanding: pctChange(c.clickToLanding, p.clickToLanding),
    visitToAtc: pctChange(c.visitToAtc, p.visitToAtc), visitToPurchase: pctChange(c.visitToPurchase, p.visitToPurchase),
    atcToPurchase: pctChange(c.atcToPurchase, p.atcToPurchase)
  };
  const dynamic = adVariationDiagnosisFromDelta(delta);
  const post = funnelVariationDiagnosisFromDelta(delta, c, p);
  const hookHold = hookHoldDiagnosticCC(c, p, ad);

  // GUARDRAILS DE ESCALADO: SIEMPRE 3D.
  // El selector Último día / 7D / 14D / 30D sirve para explorar diagnóstico,
  // pero NO cambia la decisión operativa de escala.
  const {
    currentStats: scale3d,
    previousStats: scalePrev3d
  } = splitPeriodRecords(eligible, '3d');

  // ÚLTIMO DÍA COMPLETO = alerta temprana. Nunca reemplaza al 3D,
  // pero sirve para detectar si un anuncio que viene mal está empezando a recuperarse.
  const {
    currentStats: lastCompleteStats,
    previousStats: lastCompletePreviousStats
  } = splitPeriodRecords(eligible, 'last');

  const lastCompleteDelta = {
    cpa: pctChange(lastCompleteStats.cpa, lastCompletePreviousStats.cpa),
    ctr: pctChange(lastCompleteStats.ctr, lastCompletePreviousStats.ctr),
    cpc: pctChange(lastCompleteStats.cpc, lastCompletePreviousStats.cpc),
    cpm: pctChange(lastCompleteStats.cpm, lastCompletePreviousStats.cpm),
    frequency: pctChange(lastCompleteStats.frequency, lastCompletePreviousStats.frequency),
    clickToLanding: pctChange(lastCompleteStats.clickToLanding, lastCompletePreviousStats.clickToLanding),
    visitToAtc: pctChange(lastCompleteStats.visitToAtc, lastCompletePreviousStats.visitToAtc),
    visitToPurchase: pctChange(lastCompleteStats.visitToPurchase, lastCompletePreviousStats.visitToPurchase),
    atcToPurchase: pctChange(lastCompleteStats.atcToPurchase, lastCompletePreviousStats.atcToPurchase)
  };

  const scaleDelta3d = {
    cpa: pctChange(scale3d.cpa, scalePrev3d.cpa),
    ctr: pctChange(scale3d.ctr, scalePrev3d.ctr),
    cpc: pctChange(scale3d.cpc, scalePrev3d.cpc),
    cpm: pctChange(scale3d.cpm, scalePrev3d.cpm),
    frequency: pctChange(scale3d.frequency, scalePrev3d.frequency),
    hookRate: pctChange(scale3d.hookRate, scalePrev3d.hookRate),
    holdRate: pctChange(scale3d.holdRate, scalePrev3d.holdRate),
    clickToLanding: pctChange(scale3d.clickToLanding, scalePrev3d.clickToLanding),
    visitToAtc: pctChange(scale3d.visitToAtc, scalePrev3d.visitToAtc),
    visitToPurchase: pctChange(scale3d.visitToPurchase, scalePrev3d.visitToPurchase),
    atcToPurchase: pctChange(scale3d.atcToPurchase, scalePrev3d.atcToPurchase)
  };

  const scaleDynamic3d = adVariationDiagnosisFromDelta(scaleDelta3d);
  const scalePost3d = funnelVariationDiagnosisFromDelta(scaleDelta3d, scale3d, scalePrev3d);
  const hookHold3d = hookHoldDiagnosticCC(scale3d, scalePrev3d, ad);

  const postClickCritical3d = [
    'Fuga clic → landing',
    'Tráfico post-clic deteriorado',
    'Calidad de tráfico cayendo',
    'Fuga al cierre'
  ].includes(scalePost3d.diagnosis);
  const postClickIntegrityMissing3d = scalePost3d.dataQuality?.level === 'missing';

  const guardrails = {
    cpaMargin: scale3d.cpa > 0 && scale3d.cpa <= scaleCpa,
    stability: scaleDelta3d.cpa === null || scaleDelta3d.cpa <= 15,
    creative: !['Fatiga probable', 'Fatiga confirmada'].includes(scaleDynamic3d.diagnosis),
    postClick: !postClickCritical3d && !postClickIntegrityMissing3d
  };

  // Volumen = referencia de confianza. NUNCA bloquea una escala.
  const volumeReference = {
    purchases: scale3d.purchases,
    confidence: volumeConfidenceLabel(scale3d.purchases)
  };

  const canScale = Object.values(guardrails).every(Boolean);

  // DECISIÓN OPERATIVA: SIEMPRE 3D.
  // Nunca depende del selector visual Último día / 7D / 14D / 30D.
  const cpaObservation3d = buildCpaObservation3D(scale3d, scalePrev3d, maxCpa);
  const metaDelivery3d = buildMetaDeliveryDiagnosis3D(records, ad, campaign);
  let operational3dDiagnosis = 'Sin suficiente información 3D';
  let operational3dAction = 'Monitorear';
  let operational3dPriority = 'monitor';
  let operational3dReason = 'Todavía no existe suficiente historial 3D comparable.';

  if (scale3d.days > 0) {
    if (metaDelivery3d.isNoDelivery) {
      operational3dDiagnosis = 'Sin entrega de Meta · 3D';
      operational3dAction = 'No juzgar rendimiento · revisar distribución';
      operational3dPriority = 'alert';
      operational3dReason = metaDelivery3d.reason;
    } else if (scale3d.spend > 0 && scale3d.purchases <= 0) {
      if (scale3d.spend >= maxCpa) {
        operational3dDiagnosis = 'Sin compras · gasto alcanzó CPA máximo';
        operational3dAction = 'No escalar · optimizar / reemplazar';
        operational3dPriority = 'critical';
      } else if (scale3d.spend >= maxCpa * 0.5) {
        operational3dDiagnosis = 'Sin compras · vigilar 3D';
        operational3dAction = 'No escalar · seguir observando';
        operational3dPriority = 'alert';
      } else {
        operational3dDiagnosis = 'Sin compras aún · poca inversión';
        operational3dAction = 'Mantener test · CPA no calculable';
        operational3dPriority = 'monitor';
      }
      operational3dReason = cpaObservation3d.text;
    } else if (scale3d.cpa > maxCpa && scaleDelta3d.cpa !== null && scaleDelta3d.cpa <= 0) {
      operational3dDiagnosis = 'Fuera del objetivo · recuperándose';
      operational3dAction = 'No escalar · mantener en observación';
      operational3dPriority = 'alert';
      operational3dReason = cpaObservation3d.text;
    } else if (scale3d.cpa > maxCpa && scaleDelta3d.cpa !== null && scaleDelta3d.cpa > 15) {
      operational3dDiagnosis = 'Fuera del objetivo · deteriorándose';
      operational3dAction = 'No escalar · optimizar';
      operational3dPriority = 'critical';
      operational3dReason = cpaObservation3d.text;
    } else if (scalePost3d.dataQuality?.level === 'missing') {
      operational3dDiagnosis = 'Datos post-clic incompletos · 3D';
      operational3dAction = 'Reimportar CSV / corregir tracking';
      operational3dPriority = 'alert';
      operational3dReason = scalePost3d.dataQuality?.reason || 'Faltan datos del embudo post-clic.';
    } else if (scale3d.cpa > maxCpa && scaleDynamic3d.diagnosis === 'Fatiga confirmada') {
      operational3dDiagnosis = 'Anuncio deteriorado y no rentable';
      operational3dAction = 'Evaluar pausa para proteger presupuesto';
      operational3dPriority = 'critical';
      operational3dReason = 'CPA 3D fuera de objetivo + fatiga confirmada en la ventana 3D.';
    } else if (scale3d.cpa > maxCpa && ['Fuga clic → landing', 'Tráfico post-clic deteriorado', 'Calidad de tráfico cayendo'].includes(scalePost3d.diagnosis)) {
      operational3dDiagnosis = 'Tráfico de baja calidad 3D';
      operational3dAction = 'No escalar · reemplazar / optimizar';
      operational3dPriority = 'critical';
      operational3dReason = 'CPA 3D fuera de objetivo y el embudo post-clic 3D también se deteriora.';
    } else if (scale3d.cpa > maxCpa) {
      operational3dDiagnosis = 'CPA 3D fuera del objetivo';
      operational3dAction = 'No escalar · optimizar';
      operational3dPriority = 'alert';
      operational3dReason = cpaObservation3d.text;
    } else if (scale3d.cpa <= maxCpa && scaleDynamic3d.diagnosis === 'Fatiga temprana') {
      operational3dDiagnosis = 'Rentable con fatiga temprana 3D';
      operational3dAction = 'Mantener y preparar creativos';
      operational3dPriority = 'alert';
      operational3dReason = 'El CPA 3D sigue dentro del objetivo, pero aparecen señales tempranas de fatiga.';
    } else if (scale3d.cpa <= maxCpa && scaleDynamic3d.diagnosis === 'Fatiga probable') {
      operational3dDiagnosis = 'Rentable pero deteriorándose 3D';
      operational3dAction = 'Detener escala y lanzar test creativo';
      operational3dPriority = 'alert';
      operational3dReason = 'El CPA 3D aún es rentable, pero el patrón de fatiga 3D ya es consistente.';
    } else if (scalePost3d.diagnosis === 'Fuga al cierre') {
      operational3dDiagnosis = 'Problema post-clic 3D';
      operational3dAction = 'Mantener anuncio y revisar cierre';
      operational3dPriority = 'alert';
      operational3dReason = 'La ventana 3D muestra intención, pero se pierde conversión después del ATC.';
    } else if (scalePost3d.diagnosis === 'Calidad de tráfico cayendo') {
      operational3dDiagnosis = 'Calidad de tráfico deteriorándose 3D';
      operational3dAction = scale3d.cpa <= maxCpa ? 'Preparar reemplazo' : 'No escalar · reemplazar';
      operational3dPriority = 'alert';
      operational3dReason = 'Las tasas post-clic 3D muestran deterioro en la calidad del tráfico.';
    } else if (metaDelivery3d.isLimited && scale3d.cpa > 0 && scale3d.cpa <= maxCpa) {
      operational3dDiagnosis = 'Entrega limitada por Meta · 3D';
      operational3dAction = 'Mantener activo · vigilar distribución';
      operational3dPriority = 'alert';
      operational3dReason = `${metaDelivery3d.reason} El CPA 3D todavía está dentro del objetivo, pero la exposición fue incompleta.`;
    } else if (canScale && scale3d.cpa > 0 && scale3d.cpa <= scaleCpa) {
      operational3dDiagnosis = 'Ganador 3D · escala permitida';
      operational3dAction = 'Escalar +20%';
      operational3dPriority = 'monitor';
      operational3dReason = `CPA 3D ${fmtMoney(scale3d.cpa)} con margen ≥20%, estabilidad válida, creativo sano y post-clic sano. Volumen ${fmtNum(volumeReference.purchases, 2)} compras (${volumeReference.confidence}) solo como referencia.`;
    } else if (scale3d.cpa > 0 && scale3d.cpa <= maxCpa) {
      operational3dDiagnosis = 'Rentable 3D · mantener';
      operational3dAction = 'Mantener';
      operational3dPriority = 'monitor';
      operational3dReason = cpaObservation3d.text;
    }
  }

  let finalDiagnosis = 'Sin suficiente información';
  let action = 'Monitorear';
  let priority = 'monitor';
  let reason = 'Todavía no existe suficiente historial comparable.';
  if (c.days > 0) {
    if (c.cpa > maxCpa && dynamic.diagnosis === 'Fatiga confirmada') {
      finalDiagnosis = 'Anuncio deteriorado y no rentable'; action = 'Evaluar pausa / reemplazo'; priority = 'critical'; reason = 'CPA fuera de objetivo + fatiga confirmada en CTR/CPC/frecuencia.';
    } else if (c.cpa > maxCpa && ['Fuga clic → landing', 'Tráfico post-clic deteriorado'].includes(post.diagnosis)) {
      finalDiagnosis = 'Tráfico de baja calidad'; action = 'Evaluar pausa / reemplazo creativo'; priority = 'critical'; reason = 'CPA fuera de objetivo y el embudo post-clic también se deteriora.';
    } else if (c.cpa <= maxCpa && dynamic.diagnosis === 'Fatiga temprana') {
      finalDiagnosis = 'Rentable con fatiga temprana'; action = 'Mantener y preparar creativos'; priority = 'alert'; reason = 'Todavía rentable, pero CTR/CPC/frecuencia empiezan a deteriorarse.';
    } else if (c.cpa <= maxCpa && dynamic.diagnosis === 'Fatiga probable') {
      finalDiagnosis = 'Rentable pero en deterioro'; action = 'Detener escala y lanzar test creativo'; priority = 'alert'; reason = 'CPA aún rentable, pero el patrón de fatiga ya es consistente.';
    } else if (post.diagnosis === 'Fuga al cierre') {
      finalDiagnosis = 'Problema post-clic'; action = 'Mantener anuncio y revisar cierre'; priority = 'alert'; reason = 'El anuncio genera intención, pero se pierde conversión después del ATC.';
    } else if (post.diagnosis === 'Calidad de tráfico cayendo') {
      finalDiagnosis = 'Calidad de tráfico deteriorándose'; action = c.cpa <= maxCpa ? 'Preparar reemplazo' : 'Evaluar pausa / reemplazo'; priority = 'alert'; reason = 'Las tasas visita→ATC y visita→compra empeoran frente a su ventana anterior.';
    } else if (c.cpa <= scaleCpa && dynamic.diagnosis === 'Estable' && post.diagnosis === 'Post-clic estable' && canScale) {
      finalDiagnosis = 'Ganador estable'; action = 'Escalar +20%'; priority = 'monitor'; reason = `CPA 3D con margen ≥20%, estable o mejorando, creativo sano y post-clic sano. Volumen: ${fmtNum(volumeReference.purchases, 2)} compras (${volumeReference.confidence}), usado solo como referencia de confianza.`;
    } else if (c.cpa <= maxCpa) {
      finalDiagnosis = 'Rentable / mantener'; action = 'Mantener'; priority = 'monitor'; reason = 'CPA dentro del máximo y sin señales críticas combinadas.';
    } else {
      finalDiagnosis = 'No rentable / observar'; action = 'No escalar'; priority = 'critical'; reason = `CPA ${fmtCpa(c.cpa)} supera el máximo ${fmtMoney(maxCpa)}.`;
    }
  }
  return {
    diagnosis: finalDiagnosis, finalDiagnosis, action, priority, reason, confidence, delta, stats: c, previous: p,
    guardrails, canScale, volumeReference,
    cpaObservation3d, metaDelivery3d,
    operational3dDiagnosis, operational3dAction, operational3dPriority, operational3dReason,
    scale3d, scalePrev3d, scaleDelta3d,
    lastCompleteStats, lastCompletePreviousStats, lastCompleteDelta,
    scaleMomentum:
      scaleDelta3d.cpa === null ? 'Sin comparación' :
      scaleDelta3d.cpa < -15 ? 'Mejora fuerte · puede seguir escalando si los demás guardrails pasan' :
      scaleDelta3d.cpa <= 0 ? 'Mejorando' :
      scaleDelta3d.cpa <= 10 ? 'Estable' :
      scaleDelta3d.cpa <= 15 ? 'Atención · aún dentro del guardrail' :
      'Deterioro · bloquear escala',
    scaleDynamic3d: scaleDynamic3d.diagnosis,
    scalePost3d: scalePost3d.diagnosis,
    hookHold, hookHold3d,
    dynamicDiagnosis: dynamic.diagnosis, dynamicAction: dynamic.action,
    postDiagnosis: post.diagnosis, postAction: post.action, dynamicTone: dynamic.tone, postTone: post.tone,
    postDataQuality: post.dataQuality || postClickDataQualityCC(c),
    scalePostDataQuality3d: scalePost3d.dataQuality || postClickDataQualityCC(scale3d),
    maxCpa, scaleCpa, ageDays
  };
}



function buildCampaignContributionPeriodCC(campaign, product, allAds = [], dailyAds = [], periodId = '3d') {
  const today = todayColombiaCC();
  const maxCpa = Math.max(1, toNumber(product?.maxCpa));
  const period = PERIODS.find(p => p.id === periodId) || PERIODS.find(p => p.id === '3d');

  const campaignAds = (allAds || []).filter(a => a.campaignId === campaign?.id);
  const adMap = new Map(campaignAds.map(a => [a.id, a]));

  const eligible = (dailyAds || []).filter(r => {
    if (r.campaignId !== campaign?.id) return false;
    if (!r.date || String(r.date) >= today) return false;
    const ad = adMap.get(r.adId);
    if (!ad) return false;
    return entityActiveOnDate(campaign, r.date) && entityActiveOnDate(ad, r.date);
  });

  const allDates = [...new Set(eligible.map(r => String(r.date)))]
    .sort((a, b) => b.localeCompare(a));

  const currentSize = periodId === 'last' ? 1 : period.size;
  const previousSize = periodId === 'last' ? 3 : period.previousSize;

  const dates = allDates.slice(0, currentSize);
  const previousDates = allDates.slice(currentSize, currentSize + previousSize);

  const dateSet = new Set(dates);
  const previousDateSet = new Set(previousDates);
  const windowRecords = eligible.filter(r => dateSet.has(String(r.date)));
  const previousWindowRecords = eligible.filter(r => previousDateSet.has(String(r.date)));

  const campaignStats = aggregateRecords(windowRecords);
  const campaignPreviousStats = aggregateRecords(previousWindowRecords);
  const campaignCpa = campaignStats.cpa;

  const results = {};

  campaignAds.forEach(ad => {
    const adRecords = windowRecords.filter(r => r.adId === ad.id);
    const previousAdRecords = previousWindowRecords.filter(r => r.adId === ad.id);
    const adStats = aggregateRecords(adRecords);
    const previousAdStats = aggregateRecords(previousAdRecords);

    const spendShare = campaignStats.spend > 0 ? (adStats.spend / campaignStats.spend) * 100 : 0;
    const purchaseShare = campaignStats.purchases > 0 ? (adStats.purchases / campaignStats.purchases) * 100 : 0;

    const withoutSpend = Math.max(0, campaignStats.spend - adStats.spend);
    const withoutPurchases = Math.max(0, campaignStats.purchases - adStats.purchases);
    const cpaWithout = withoutPurchases > 0 ? calcCpa(withoutSpend, withoutPurchases) : null;

    const withoutLanding =
      campaignStats.landingViews !== null && adStats.landingViews !== null
        ? Math.max(0, toNumber(campaignStats.landingViews) - toNumber(adStats.landingViews))
        : null;
    const peerVisitToPurchase = withoutLanding > 0 ? safeRate(withoutPurchases, withoutLanding) : null;

    const previousWithoutPurchases = Math.max(0, campaignPreviousStats.purchases - previousAdStats.purchases);
    const previousWithoutLanding =
      campaignPreviousStats.landingViews !== null && previousAdStats.landingViews !== null
        ? Math.max(0, toNumber(campaignPreviousStats.landingViews) - toNumber(previousAdStats.landingViews))
        : null;
    const peerPreviousVisitToPurchase =
      previousWithoutLanding > 0 ? safeRate(previousWithoutPurchases, previousWithoutLanding) : null;

    const peerCvrDelta = pctChange(peerVisitToPurchase, peerPreviousVisitToPurchase);
    const sameWindowCvrDelta = pctChange(adStats.visitToPurchase, previousAdStats.visitToPurchase);

    const removalImprovementPct =
      campaignCpa > 0 && cpaWithout !== null
        ? ((campaignCpa - cpaWithout) / campaignCpa) * 100
        : null;

    const adEligible = eligibleAdRecords(
      (dailyAds || []).filter(r => r.adId === ad.id),
      ad,
      campaign
    );
    const { currentStats: current, previousStats: previous } = splitPeriodRecords(adEligible, periodId);
    const delta = {
      cpa: pctChange(current.cpa, previous.cpa),
      ctr: pctChange(current.ctr, previous.ctr),
      cpc: pctChange(current.cpc, previous.cpc),
      cpm: pctChange(current.cpm, previous.cpm),
      frequency: pctChange(current.frequency, previous.frequency),
      visitToAtc: pctChange(current.visitToAtc, previous.visitToAtc),
      visitToPurchase: pctChange(current.visitToPurchase, previous.visitToPurchase),
      atcToPurchase: pctChange(current.atcToPurchase, previous.atcToPurchase)
    };
    const dynamic = adVariationDiagnosisFromDelta(delta);
    const post = funnelVariationDiagnosisFromDelta(delta, current, previous);

    const meaningfulSpend = adStats.spend >= maxCpa * 0.5;
    const clearlyHurtsEfficiency = removalImprovementPct !== null && removalImprovementPct >= 10;
    const disproportionate = spendShare >= purchaseShare + 10;
    const stronglyEfficient =
      adStats.purchases > 0 &&
      campaignCpa > 0 &&
      adStats.cpa > 0 &&
      adStats.cpa <= campaignCpa * 0.8 &&
      purchaseShare >= spendShare + 8;
    const reasonablyEfficient =
      adStats.purchases > 0 &&
      campaignCpa > 0 &&
      adStats.cpa > 0 &&
      adStats.cpa <= campaignCpa * 1.1 &&
      purchaseShare >= spendShare - 5;

    let status = 'Bajo aporte / vigilar';
    let tone = 'alert';
    let cause = 'Aporte todavía no concluyente dentro de esta ventana.';

    if (campaignStats.spend <= 0 || dates.length === 0) {
      status = 'Sin datos';
      tone = 'neutral';
      cause = 'No existen datos completos suficientes para esta ventana.';
    } else if (adStats.spend <= 0 && adRecords.some(r => r.metaOmittedNoDelivery === true || r.source === 'meta_csv_zero_fill')) {
      status = 'Sin entrega de Meta';
      tone = 'alert';
      cause = 'El anuncio estuvo activo, pero Meta no le asignó entrega dentro de esta ventana.';
    } else if (adStats.spend <= 0) {
      status = 'Bajo aporte / vigilar';
      tone = 'neutral';
      cause = 'No tuvo gasto dentro de la ventana seleccionada.';
    } else if (adStats.purchases <= 0 && meaningfulSpend) {
      status = adStats.spend >= maxCpa ? 'Drena la campaña' : 'Bajo aporte / vigilar';
      tone = adStats.spend >= maxCpa ? 'critical' : 'alert';
      cause = adStats.spend >= maxCpa
        ? `Gastó ${fmtMoney(adStats.spend)} (≥ CPA máximo ${fmtMoney(maxCpa)}) sin compras.`
        : `Gastó ${fmtMoney(adStats.spend)} sin compras; todavía no alcanza el CPA máximo.`;
    } else if (adStats.purchases <= 0) {
      status = 'Bajo aporte / vigilar';
      tone = 'neutral';
      cause = `Sin compras con ${fmtMoney(adStats.spend)} de gasto; muestra todavía limitada.`;
    } else if (
      clearlyHurtsEfficiency ||
      (adStats.cpa > maxCpa && disproportionate) ||
      (campaignCpa > 0 && adStats.cpa > campaignCpa * 1.35 && disproportionate)
    ) {
      status = 'Drena la campaña';
      tone = 'critical';
      cause =
        post.diagnosis === 'Calidad de tráfico cayendo' || post.diagnosis === 'Tráfico post-clic deteriorado'
          ? 'Está encareciendo la campaña y la conversión post-clic también se deteriora.'
          : ['Fatiga probable', 'Fatiga confirmada'].includes(dynamic.diagnosis)
            ? `Está encareciendo la campaña con señal de ${dynamic.diagnosis.toLowerCase()}.`
            : `Consume ${fmtNum(spendShare, 2)}% del gasto y aporta ${fmtNum(purchaseShare, 2)}% de las compras; retirarlo mejora matemáticamente el CPA del resto.`;
    } else if (stronglyEfficient) {
      status = 'Aporta fuertemente';
      tone = 'good';
      cause = `Aporta ${fmtNum(purchaseShare, 2)}% de las compras usando ${fmtNum(spendShare, 2)}% del gasto.`;
    } else if (reasonablyEfficient) {
      status = 'Aporta';
      tone = 'good';
      cause = 'Su participación en compras es proporcional o superior a su participación en gasto.';
    } else if (disproportionate || adStats.cpa > maxCpa) {
      status = 'Bajo aporte / vigilar';
      tone = 'alert';
      cause = `Consume ${fmtNum(spendShare, 2)}% del gasto y aporta ${fmtNum(purchaseShare, 2)}% de las compras.`;
    } else {
      status = 'Aporta';
      tone = 'good';
      cause = 'Mantiene una contribución razonable dentro de la ventana seleccionada.';
    }

    results[ad.id] = {
      status,
      tone,
      cause,
      dates,
      previousDates,
      spend: adStats.spend,
      purchases: adStats.purchases,
      cpa: adStats.cpa,
      spendShare,
      purchaseShare,
      campaignCpa,
      cpaWithout,
      removalImprovementPct,
      campaignVisitToPurchase: campaignStats.visitToPurchase,
      campaignPreviousVisitToPurchase: campaignPreviousStats.visitToPurchase,
      adSameWindowVisitToPurchase: adStats.visitToPurchase,
      adSameWindowPreviousVisitToPurchase: previousAdStats.visitToPurchase,
      sameWindowCvrDelta,
      peerVisitToPurchase,
      peerPreviousVisitToPurchase,
      peerCvrDelta,
      dynamic3d: dynamic.diagnosis,
      post3d: post.diagnosis
    };
  });

  return {
    periodId,
    dates,
    previousDates,
    campaignStats,
    campaignPreviousStats,
    campaignCpa,
    byAd: results
  };
}

function periodLabelCC(periodId) {
  if (periodId === 'last') return 'ÚLTIMO DÍA';
  return String(periodId || '3d').toUpperCase();
}

function periodCardLabelCC(periodId, previous = false) {
  if (periodId === 'last') return previous ? '3D PREV.' : '1D';
  const label = String(periodId || '3d').toUpperCase();
  return previous ? `${label} PREV.` : label;
}

function readingDiagForPeriodCC(diag, periodId = '3d') {
  const current = diag?.stats || {};
  const previous = diag?.previous || {};
  const delta = diag?.delta || {};
  return {
    ...diag,
    scale3d: current,
    scalePrev3d: previous,
    scaleDelta3d: delta,
    hookHold3d: diag?.hookHold,
    scaleDynamic3d: diag?.dynamicDiagnosis,
    scalePost3d: diag?.postDiagnosis,
    scalePostDataQuality3d: diag?.postDataQuality || postClickDataQualityCC(current),
    cpaObservation3d: buildCpaObservation3D(current, previous, Math.max(1, toNumber(diag?.maxCpa))),
    volumeReference: {
      purchases: toNumber(current?.purchases),
      confidence: volumeConfidenceLabel(current?.purchases)
    },
    analysisPeriodId: periodId
  };
}

function buildCampaignContribution3D(campaign, product, allAds = [], dailyAds = []) {
  const today = todayColombiaCC();
  const maxCpa = Math.max(1, toNumber(product?.maxCpa));

  const campaignAds = (allAds || []).filter(a => a.campaignId === campaign?.id);
  const adMap = new Map(campaignAds.map(a => [a.id, a]));

  // Misma ventana de campaña para todos los anuncios:
  // últimos 3 días completos con datos, excluyendo HOY y periodos OFF.
  const eligible = (dailyAds || []).filter(r => {
    if (r.campaignId !== campaign?.id) return false;
    if (!r.date || String(r.date) >= today) return false;
    const ad = adMap.get(r.adId);
    if (!ad) return false;
    return entityActiveOnDate(campaign, r.date) && entityActiveOnDate(ad, r.date);
  });

  const allDates = [...new Set(eligible.map(r => String(r.date)))]
    .sort((a, b) => b.localeCompare(a));

  const dates = allDates.slice(0, 3);
  const previousDates = allDates.slice(3, 6);

  const dateSet = new Set(dates);
  const previousDateSet = new Set(previousDates);
  const windowRecords = eligible.filter(r => dateSet.has(String(r.date)));
  const previousWindowRecords = eligible.filter(r => previousDateSet.has(String(r.date)));
  const campaignStats = aggregateRecords(windowRecords);
  const campaignPreviousStats = aggregateRecords(previousWindowRecords);
  const campaignCpa = campaignStats.cpa;

  const results = {};

  campaignAds.forEach(ad => {
    const adRecords = windowRecords.filter(r => r.adId === ad.id);
    const previousAdRecords = previousWindowRecords.filter(r => r.adId === ad.id);
    const adStats = aggregateRecords(adRecords);
    const previousAdSameWindowStats = aggregateRecords(previousAdRecords);

    const spendShare = campaignStats.spend > 0 ? (adStats.spend / campaignStats.spend) * 100 : 0;
    const purchaseShare = campaignStats.purchases > 0 ? (adStats.purchases / campaignStats.purchases) * 100 : 0;

    const withoutSpend = Math.max(0, campaignStats.spend - adStats.spend);
    const withoutPurchases = Math.max(0, campaignStats.purchases - adStats.purchases);
    const cpaWithout = withoutPurchases > 0 ? calcCpa(withoutSpend, withoutPurchases) : null;

    const withoutLanding = campaignStats.landingViews !== null && adStats.landingViews !== null
      ? Math.max(0, toNumber(campaignStats.landingViews) - toNumber(adStats.landingViews))
      : null;
    const peerVisitToPurchase = withoutLanding > 0 ? safeRate(withoutPurchases, withoutLanding) : null;

    const previousWithoutPurchases = Math.max(0, campaignPreviousStats.purchases - previousAdSameWindowStats.purchases);
    const previousWithoutLanding =
      campaignPreviousStats.landingViews !== null && previousAdSameWindowStats.landingViews !== null
        ? Math.max(0, toNumber(campaignPreviousStats.landingViews) - toNumber(previousAdSameWindowStats.landingViews))
        : null;
    const peerPreviousVisitToPurchase = previousWithoutLanding > 0
      ? safeRate(previousWithoutPurchases, previousWithoutLanding)
      : null;
    const peerCvrDelta = pctChange(peerVisitToPurchase, peerPreviousVisitToPurchase);
    const sameWindowCvrDelta = pctChange(adStats.visitToPurchase, previousAdSameWindowStats.visitToPurchase);

    const removalImprovementPct =
      campaignCpa > 0 && cpaWithout !== null
        ? ((campaignCpa - cpaWithout) / campaignCpa) * 100
        : null;

    // Diagnósticos 3D del anuncio para explicar la causa de bajo aporte/drenaje.
    const adEligible = eligibleAdRecords(
      (dailyAds || []).filter(r => r.adId === ad.id),
      ad,
      campaign
    );
    const { currentStats: ad3d, previousStats: prevAd3d } = splitPeriodRecords(adEligible, '3d');
    const delta3d = {
      cpa: pctChange(ad3d.cpa, prevAd3d.cpa),
      ctr: pctChange(ad3d.ctr, prevAd3d.ctr),
      cpc: pctChange(ad3d.cpc, prevAd3d.cpc),
      cpm: pctChange(ad3d.cpm, prevAd3d.cpm),
      frequency: pctChange(ad3d.frequency, prevAd3d.frequency),
      visitToAtc: pctChange(ad3d.visitToAtc, prevAd3d.visitToAtc),
      visitToPurchase: pctChange(ad3d.visitToPurchase, prevAd3d.visitToPurchase),
      atcToPurchase: pctChange(ad3d.atcToPurchase, prevAd3d.atcToPurchase)
    };
    const dynamic3d = adVariationDiagnosisFromDelta(delta3d);
    const post3d = funnelVariationDiagnosisFromDelta(delta3d, ad3d, prevAd3d);

    let status = 'Bajo aporte / vigilar';
    let tone = 'alert';
    let cause = 'Aporte todavía no concluyente dentro de la campaña.';

    const meaningfulSpend = adStats.spend >= maxCpa * 0.5;

    const clearlyHurtsEfficiency =
      removalImprovementPct !== null &&
      removalImprovementPct >= 10;

    const disproportionate =
      spendShare >= purchaseShare + 10;

    const stronglyEfficient =
      adStats.purchases > 0 &&
      campaignCpa > 0 &&
      adStats.cpa > 0 &&
      adStats.cpa <= campaignCpa * 0.8 &&
      purchaseShare >= spendShare + 8;

    const reasonablyEfficient =
      adStats.purchases > 0 &&
      campaignCpa > 0 &&
      adStats.cpa > 0 &&
      adStats.cpa <= campaignCpa * 1.1 &&
      purchaseShare >= spendShare - 5;

    if (campaignStats.spend <= 0 || dates.length === 0) {
      status = 'Sin datos 3D';
      tone = 'neutral';
      cause = 'Todavía no existen datos completos suficientes de la campaña.';
    } else if (adStats.spend <= 0 && adRecords.some(r => r.metaOmittedNoDelivery === true || r.source === 'meta_csv_zero_fill')) {
      status = 'Sin entrega de Meta';
      tone = 'alert';
      cause = 'El anuncio estuvo activo, pero Meta no le asignó entrega en la ventana 3D. No se clasifica como drenaje porque no consumió presupuesto.';
    } else if (adStats.spend <= 0) {
      status = 'Bajo aporte / vigilar';
      tone = 'alert';
      cause = 'El anuncio no tuvo entrega dentro de la ventana 3D.';
    } else if (adStats.purchases <= 0 && meaningfulSpend) {
      status = adStats.spend >= maxCpa ? 'Drena la campaña' : 'Bajo aporte / vigilar';
      tone = adStats.spend >= maxCpa ? 'critical' : 'alert';
      cause = adStats.spend >= maxCpa
        ? `Gastó ${fmtMoney(adStats.spend)} (≥ CPA máximo ${fmtMoney(maxCpa)}) sin compras. CPA no calculable.`
        : `Gastó ${fmtMoney(adStats.spend)} sin compras. Aún no alcanza el CPA máximo; vigilar sin fabricar un CPA.`;
    } else if (adStats.purchases <= 0) {
      status = 'Bajo aporte / vigilar';
      tone = 'neutral';
      cause = `Sin compras todavía con solo ${fmtMoney(adStats.spend)} de gasto. CPA no calculable; muestra insuficiente para condenar el anuncio.`;
    } else if (
      clearlyHurtsEfficiency ||
      (adStats.cpa > maxCpa && disproportionate) ||
      (campaignCpa > 0 && adStats.cpa > campaignCpa * 1.35 && disproportionate)
    ) {
      status = 'Drena la campaña';
      tone = 'critical';

      if (post3d.diagnosis === 'Calidad de tráfico cayendo' || post3d.diagnosis === 'Tráfico post-clic deteriorado') {
        cause = 'Está encareciendo la campaña y el tráfico post-clic muestra deterioro/calidad baja.';
      } else if (post3d.diagnosis === 'Fuga al cierre') {
        cause = 'Consume presupuesto, pero la conversión se frena después del ATC.';
      } else if (['Fatiga probable', 'Fatiga confirmada'].includes(dynamic3d.diagnosis)) {
        cause = 'Está encareciendo la campaña con señales de fatiga/saturación creativa.';
      } else if (adStats.cpa > maxCpa) {
        cause = `CPA 3D ${fmtMoney(adStats.cpa)} por encima del máximo ${fmtMoney(maxCpa)} y aporte desproporcionado.`;
      } else {
        cause = `Consume ${fmtNum(spendShare, 2)}% del gasto y aporta ${fmtNum(purchaseShare, 2)}% de las compras; retirarlo mejoraría el CPA de campaña.`;
      }
    } else if (stronglyEfficient) {
      status = 'Aporta fuertemente';
      tone = 'good';
      cause = `Aporta ${fmtNum(purchaseShare, 2)}% de las compras usando ${fmtNum(spendShare, 2)}% del gasto, con CPA claramente mejor que la campaña.`;
    } else if (reasonablyEfficient) {
      status = 'Aporta';
      tone = 'good';
      cause = `Su participación en compras es proporcional o superior a su participación en gasto.`;
    } else if (disproportionate || adStats.cpa > maxCpa) {
      status = 'Bajo aporte / vigilar';
      tone = 'alert';

      if (post3d.diagnosis === 'Calidad de tráfico cayendo' || post3d.diagnosis === 'Tráfico post-clic deteriorado') {
        cause = 'Bajo aporte con señales de tráfico menos calificado.';
      } else if (post3d.diagnosis === 'Fuga al cierre') {
        cause = 'Genera intención, pero pierde eficiencia en el cierre.';
      } else if (['Fatiga temprana', 'Fatiga probable', 'Fatiga confirmada'].includes(dynamic3d.diagnosis)) {
        cause = `Bajo aporte con señal de ${dynamic3d.diagnosis.toLowerCase()}.`;
      } else {
        cause = `Consume ${fmtNum(spendShare, 2)}% del gasto y aporta ${fmtNum(purchaseShare, 2)}% de las compras.`;
      }
    } else {
      status = 'Aporta';
      tone = 'good';
      cause = 'El anuncio mantiene una contribución razonable al rendimiento de campaña.';
    }

    results[ad.id] = {
      status,
      tone,
      cause,
      dates,
      spend: adStats.spend,
      purchases: adStats.purchases,
      cpa: adStats.cpa,
      spendShare,
      purchaseShare,
      campaignCpa,
      cpaWithout,
      removalImprovementPct,
      campaignVisitToPurchase: campaignStats.visitToPurchase,
      campaignPreviousVisitToPurchase: campaignPreviousStats.visitToPurchase,
      adSameWindowVisitToPurchase: adStats.visitToPurchase,
      adSameWindowPreviousVisitToPurchase: previousAdSameWindowStats.visitToPurchase,
      sameWindowCvrDelta,
      peerVisitToPurchase,
      peerPreviousVisitToPurchase,
      peerCvrDelta,
      previousDates,
      dynamic3d: dynamic3d.diagnosis,
      post3d: post3d.diagnosis
    };
  });

  return {
    dates,
    previousDates,
    campaignStats,
    campaignPreviousStats,
    campaignCpa,
    byAd: results
  };
}

function StateBadge({ active, archived = false }) {
  const cls = 'inline-flex max-w-full px-2 py-1 rounded-full text-[8px] sm:text-[9px] leading-tight font-black uppercase text-center';
  if (archived) return <span className={`${cls} bg-slate-200 text-slate-500`}>Archivada</span>;
  return active
    ? <span className={`${cls} bg-emerald-100 text-emerald-700`}>Activa</span>
    : <span className={`${cls} bg-rose-100 text-rose-600`}>Apagada</span>;
}

function MiniCard({ label, value, sub, tone = 'default' }) {
  const toneClass =
    tone === 'good'
      ? 'bg-emerald-50 border-emerald-100'
      : tone === 'bad'
        ? 'bg-rose-50 border-rose-100'
        : 'bg-white border-slate-100';

  return (
    <div className={`cc-mini-card min-w-0 rounded-2xl border px-2.5 py-3 sm:px-3 sm:py-3.5 lg:px-3.5 lg:py-3.5 ${toneClass}`}>
      <p
        className="min-w-0 text-[7px] sm:text-[8px] font-black uppercase tracking-wide leading-tight text-slate-400 whitespace-normal break-words"
        style={{ overflowWrap: 'break-word', wordBreak: 'normal' }}
      >
        {label}
      </p>

      <div className="min-w-0 mt-2">
        <div
          className="cc-value max-w-full font-black leading-tight tracking-[-0.01em] tabular-nums text-zinc-900 whitespace-nowrap"
          style={{ fontSize: 'clamp(16px, 1.05vw, 21px)' }}
        >
          {value}
        </div>
      </div>

      {sub ? (
        <p
          className="min-w-0 text-[7px] font-semibold leading-snug text-slate-400 mt-1.5 whitespace-normal break-words"
          style={{ overflowWrap: 'break-word', wordBreak: 'normal' }}
        >
          {sub}
        </p>
      ) : null}
    </div>
  );
}

function SectionCard({ children, className = '', accent = null, soft = null }) {
  return (
    <div
      className={`cc-section-card bg-white border shadow-sm rounded-3xl p-4 md:p-5 ${className}`}
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

function parseMetaRows(rows, existingAds, selectedDate, campaign = null) {
  const existingMap = new Map(existingAds.map(a => [normalizeAdName(a.name), a]));

  const parsed = rows.map(row => {
    const adName = String(resolveCsvValue(row, META_CSV_ALIASES.adName) || '').trim();
    if (!adName) return null;

    const deliveryRaw = String(resolveCsvValue(row, META_CSV_ALIASES.delivery) || '').trim();
    const deliveryStatus = normalizeMetaDeliveryStatusCC(deliveryRaw);
    const ignoredByMeta = isMetaAdExplicitlyInactiveCC(deliveryRaw);

    const normalizedName = normalizeAdName(adName);
    const spend = toNumber(resolveCsvValue(row, META_CSV_ALIASES.spend));
    const impressionsRaw = resolveCsvValue(row, META_CSV_ALIASES.impressions);
    const clicksRaw = resolveCsvValue(row, META_CSV_ALIASES.clicks);
    const purchasesRaw = resolveCsvValue(row, META_CSV_ALIASES.purchases);
    const ctrValueRaw = resolveCsvValue(row, META_CSV_ALIASES.ctr);
    const cpcValueRaw = resolveCsvValue(row, META_CSV_ALIASES.cpc);
    const cpmValueRaw = resolveCsvValue(row, META_CSV_ALIASES.cpm);
    const frequencyRaw = resolveCsvValue(row, META_CSV_ALIASES.frequency);
    const hookRateRaw = resolveCsvValue(row, META_CSV_ALIASES.hookRate);
    const holdRateRaw = resolveCsvValue(row, META_CSV_ALIASES.holdRate);
    const avgVideoWatchTimeRaw = resolveCsvValue(row, META_CSV_ALIASES.avgVideoWatchTime);
    const landingViewsRaw = resolveCsvValue(row, META_CSV_ALIASES.landingViews);
    const atcRaw = resolveCsvValue(row, META_CSV_ALIASES.atc);
    const roasRaw = resolveCsvValue(row, META_CSV_ALIASES.roas);

    const impressions = toNumber(impressionsRaw);
    const clicks = toNumber(clicksRaw);
    const purchases = toNumber(purchasesRaw);
    const ctrRaw = toNumber(ctrValueRaw);
    const cpcRaw = toNumber(cpcValueRaw);
    const cpmRaw = toNumber(cpmValueRaw);
    const frequency = toNumber(frequencyRaw);
    const hookRate = parseMetaPercentCC(hookRateRaw);
    const holdRate = parseMetaPercentCC(holdRateRaw);
    const avgVideoWatchTime = hasCsvMetricValueCC(avgVideoWatchTimeRaw) ? toNumber(avgVideoWatchTimeRaw) : null;
    const landingViews = toNumber(landingViewsRaw);
    const atc = toNumber(atcRaw);
    const roas = toNumber(roasRaw);
    const nameSuggestsVideo = /(^|\s)(video|reel|ugc|vsl)(\s|$)/i.test(normalizedName);
    const videoMetricAvailable = (hasCsvMetricValueCC(hookRateRaw) || hasCsvMetricValueCC(holdRateRaw)) &&
      (nameSuggestsVideo || (holdRate !== null && holdRate > 0) || (hookRate !== null && hookRate >= 1));
    const reportDate =
      dateToIso(resolveCsvValue(row, META_CSV_ALIASES.endDate)) ||
      dateToIso(resolveCsvValue(row, META_CSV_ALIASES.startDate)) ||
      selectedDate;

    const existingAd = existingMap.get(normalizedName) || null;
    const ignoredByPlatformState = existingAd ? !entityActiveOnDate(existingAd, reportDate) : false;
    const ignoredFromImport = ignoredByMeta || ignoredByPlatformState;

    return {
      adName,
      normalizedName,
      existingAd,
      reportDate,
      deliveryRaw,
      deliveryStatus,
      ignoredFromImport,
      ignoredByPlatformState,
      syntheticZero: false,
      metrics: {
        spend,
        impressions,
        clicks,
        purchases,
        ctr: impressions > 0 && clicks > 0 ? (clicks / impressions) * 100 : ctrRaw,
        cpc: clicks > 0 ? spend / clicks : cpcRaw,
        cpm: impressions > 0 ? (spend / impressions) * 1000 : cpmRaw,
        frequency,
        hookRate,
        holdRate,
        avgVideoWatchTime,
        videoMetricAvailable,
        hookRateDataAvailable: hasCsvMetricValueCC(hookRateRaw),
        holdRateDataAvailable: hasCsvMetricValueCC(holdRateRaw),
        landingViews,
        atc,
        roas,
        clicksDataAvailable: hasCsvMetricValueCC(clicksRaw),
        landingViewsDataAvailable: hasCsvMetricValueCC(landingViewsRaw),
        atcDataAvailable: hasCsvMetricValueCC(atcRaw)
      }
    };
  }).filter(Boolean);

  // Primero detectamos duplicados REALES del CSV.
  const counts = {};
  parsed.forEach(item => {
    if (item.ignoredFromImport) return;
    counts[`${item.reportDate}__${item.normalizedName}`] =
      (counts[`${item.reportDate}__${item.normalizedName}`] || 0) + 1;
  });

  parsed.forEach(item => {
    const key = `${item.reportDate}__${item.normalizedName}`;
    item.status = item.ignoredFromImport
      ? 'ignored_inactive'
      : counts[key] > 1
        ? 'conflict'
        : item.existingAd
          ? 'existing'
          : 'new';
  });

  // META puede omitir por completo anuncios ACTIVOS a los que no entregó gasto.
  // Esos anuncios NO deben desaparecer del día: se crean como fila sintética en cero.
  //
  // Importante:
  // - solo se hace cuando el CSV sí contiene al menos una fila válida;
  // - solo para anuncios que YA existen dentro de esta campaña;
  // - solo si campaña + anuncio estaban ACTIVOS en esa fecha;
  // - anuncios OFF quedan excluidos y NO reciben ceros.
  if (parsed.length > 0) {
    const reportDates = [...new Set(parsed.map(item => item.reportDate).filter(Boolean))];

    for (const reportDate of reportDates) {
      // Incluye también filas ignoradas por estar desactivadas en Meta.
      // Así un anuncio desactivado que aparece en el CSV jamás reaparece
      // accidentalmente como zero_fill.
      const namesPresent = new Set(
        parsed
          .filter(item => item.reportDate === reportDate)
          .map(item => item.normalizedName)
      );

      for (const ad of existingAds) {
        const normalizedName = normalizeAdName(ad.name);

        if (!normalizedName || namesPresent.has(normalizedName)) continue;
        if (campaign && !entityActiveOnDate(campaign, reportDate)) continue;
        if (!entityActiveOnDate(ad, reportDate)) continue;

        parsed.push({
          adName: ad.name,
          normalizedName,
          existingAd: ad,
          reportDate,
          status: 'zero_fill',
          syntheticZero: true,
          metrics: {
            spend: 0,
            impressions: 0,
            clicks: 0,
            purchases: 0,
            ctr: 0,
            cpc: 0,
            cpm: 0,
            frequency: 0,
            hookRate: null,
            holdRate: null,
            avgVideoWatchTime: null,
            videoMetricAvailable: false,
            hookRateDataAvailable: false,
            holdRateDataAvailable: false,
            landingViews: 0,
            atc: 0,
            roas: 0,
            clicksDataAvailable: true,
            landingViewsDataAvailable: true,
            atcDataAvailable: true
          }
        });
      }
    }
  }

  return parsed.sort((a, b) => {
    if (a.reportDate !== b.reportDate) return String(a.reportDate).localeCompare(String(b.reportDate));
    if (a.syntheticZero !== b.syntheticZero) return a.syntheticZero ? 1 : -1;
    return String(a.adName).localeCompare(String(b.adName));
  });
}


// ─── INFORME DETALLADO DE CAMPAÑAS / IA ─────────────────────────────────────
const REPORT_METRICS_CC = [
  { key: 'spend', label: 'Gasto', type: 'money', direction: 'neutral' },
  { key: 'purchases', label: 'Compras', type: 'number', direction: 'higher' },
  { key: 'cpa', label: 'CPA', type: 'cpa', direction: 'lower' },
  { key: 'ctr', label: 'CTR', type: 'rate', direction: 'higher' },
  { key: 'cpc', label: 'CPC', type: 'money', direction: 'lower' },
  { key: 'cpm', label: 'CPM', type: 'money', direction: 'lower' },
  { key: 'frequency', label: 'Frecuencia', type: 'number', direction: 'lower' },
  { key: 'clicks', label: 'Clics de enlace', type: 'number', direction: 'higher' },
  { key: 'landingViews', label: 'Visitas landing', type: 'number', direction: 'higher' },
  { key: 'clickToLanding', label: 'Clic → Landing', type: 'rate', direction: 'higher' },
  { key: 'atc', label: 'Añadidos al carrito', type: 'number', direction: 'higher' },
  { key: 'roas', label: 'ROAS', type: 'roas', direction: 'higher' },
  { key: 'visitToAtc', label: 'Visita → ATC', type: 'rate', direction: 'higher' },
  { key: 'visitToPurchase', label: 'Visita → Compra', type: 'rate', direction: 'higher' },
  { key: 'atcToPurchase', label: 'ATC → Compra', type: 'rate', direction: 'higher' }
];

function reportWindowCC(records = [], currentSize = 3, previousSize = currentSize, cutoffDate = todayColombiaCC()) {
  const sorted = [...(records || [])]
    .filter(r => r?.date && String(r.date) < String(cutoffDate))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const current = sorted.slice(0, currentSize);
  const previous = sorted.slice(currentSize, currentSize + previousSize);

  return {
    current,
    previous,
    currentStats: aggregateRecords(current),
    previousStats: aggregateRecords(previous),
    currentDates: [...new Set(current.map(r => String(r.date)))].sort(),
    previousDates: [...new Set(previous.map(r => String(r.date)))].sort()
  };
}

function reportWindowLabelCC(dates = []) {
  if (!dates.length) return 'SIN DATOS';
  if (dates.length === 1) return dates[0];
  return `${dates[0]} → ${dates[dates.length - 1]}`;
}

function reportMetricValueCC(metric, value) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
  if (metric.type === 'money') return fmtMoney(value);
  if (metric.type === 'cpa') return fmtCpa(value);
  if (metric.type === 'rate') return fmtRate(value);
  if (metric.type === 'roas') return `${fmtNum(value, 2)}x`;
  return fmtNum(value, 2);
}

function reportDeltaCC(metric, current, previous) {
  const delta = pctChange(current, previous);
  if (delta === null) return { value: null, text: '— · SIN BASE COMPARABLE', quality: 'neutral' };

  const abs = Math.abs(delta);
  const band =
    abs <= 10 ? 'NORMAL' :
    abs <= 15 ? 'ATENCIÓN' :
    abs <= 20 ? 'ALERTA' :
    'CRÍTICA';

  if (Math.abs(delta) < 0.005 || metric.direction === 'neutral') {
    return {
      value: delta,
      text: `${delta > 0 ? '+' : ''}${fmtNum(delta, 2)}% · ${band}`,
      quality: 'neutral'
    };
  }

  const favorable =
    metric.direction === 'lower'
      ? delta < 0
      : metric.direction === 'higher'
        ? delta > 0
        : null;

  return {
    value: delta,
    text: `${delta > 0 ? '+' : ''}${fmtNum(delta, 2)}% · ${favorable ? 'FAVORABLE' : 'DESFAVORABLE'} · ${band}`,
    quality: favorable ? 'good' : 'bad'
  };
}

function reportStatsTableCC(title, window) {
  const lines = [];
  lines.push(title);
  lines.push('-'.repeat(Math.max(42, title.length)));
  lines.push(`Periodo actual: ${reportWindowLabelCC(window.currentDates)} · ${window.currentStats.days} día(s) con registro`);
  lines.push(`Periodo comparativo: ${reportWindowLabelCC(window.previousDates)} · ${window.previousStats.days} día(s) con registro`);
  lines.push('');
  lines.push('MÉTRICA | ACTUAL | ANTERIOR | VARIACIÓN');
  lines.push('--- | --- | --- | ---');

  for (const metric of REPORT_METRICS_CC) {
    const current = window.currentStats[metric.key];
    const previous = window.previousStats[metric.key];
    const delta = reportDeltaCC(metric, current, previous);
    lines.push(
      `${metric.label} | ${reportMetricValueCC(metric, current)} | ${reportMetricValueCC(metric, previous)} | ${delta.text}`
    );
  }

  return lines;
}

function reportMetricDeltasCC(currentStats, previousStats) {
  return REPORT_METRICS_CC.reduce((acc, metric) => {
    acc[metric.key] = pctChange(currentStats?.[metric.key], previousStats?.[metric.key]);
    return acc;
  }, {});
}

function reportCausalInsightsCC(currentStats, previousStats, maxCpa) {
  const delta = reportMetricDeltasCC(currentStats, previousStats);
  const lines = [];
  const cpa = currentStats?.cpa;
  const max = Math.max(1, toNumber(maxCpa));

  if (currentStats?.spend > 0 && currentStats?.purchases <= 0) {
    lines.push(`• No hubo compras. Se consumieron ${fmtMoney(currentStats.spend)} (${fmtNum((currentStats.spend / max) * 100, 2)}% del CPA máximo) y el CPA NO es calculable.`);
  } else if (cpa !== null && cpa !== undefined) {
    lines.push(`• CPA actual ${fmtCpa(cpa)} frente a CPA máximo ${fmtMoney(max)}: ${cpa <= max ? 'DENTRO DEL OBJETIVO' : 'FUERA DEL OBJETIVO'}.`);
    if (delta.cpa !== null) {
      lines.push(`• CPA ${delta.cpa <= 0 ? 'mejoró' : 'empeoró'} ${fmtNum(Math.abs(delta.cpa), 2)}% frente al bloque comparable.`);
    }
  }

  if (delta.ctr !== null) lines.push(`• CTR ${delta.ctr >= 0 ? 'subió' : 'bajó'} ${fmtNum(Math.abs(delta.ctr), 2)}%.`);
  if (delta.cpc !== null) lines.push(`• CPC ${delta.cpc <= 0 ? 'mejoró/bajó' : 'subió'} ${fmtNum(Math.abs(delta.cpc), 2)}%.`);
  if (delta.cpm !== null) lines.push(`• CPM ${delta.cpm <= 0 ? 'bajó' : 'subió'} ${fmtNum(Math.abs(delta.cpm), 2)}%.`);
  if (delta.frequency !== null) lines.push(`• Frecuencia ${delta.frequency >= 0 ? 'subió' : 'bajó'} ${fmtNum(Math.abs(delta.frequency), 2)}%.`);
  if (delta.clickToLanding !== null) lines.push(`• Clic→Landing ${delta.clickToLanding >= 0 ? 'mejoró' : 'cayó'} ${fmtNum(Math.abs(delta.clickToLanding), 2)}%.`);
  if (delta.visitToAtc !== null) lines.push(`• Visita→ATC ${delta.visitToAtc >= 0 ? 'mejoró' : 'cayó'} ${fmtNum(Math.abs(delta.visitToAtc), 2)}%.`);
  if (delta.visitToPurchase !== null) lines.push(`• Visita→Compra ${delta.visitToPurchase >= 0 ? 'mejoró' : 'cayó'} ${fmtNum(Math.abs(delta.visitToPurchase), 2)}%.`);
  if (delta.atcToPurchase !== null) lines.push(`• ATC→Compra ${delta.atcToPurchase >= 0 ? 'mejoró' : 'cayó'} ${fmtNum(Math.abs(delta.atcToPurchase), 2)}%.`);

  const creative = adVariationDiagnosisFromDelta(delta);
  const funnel = funnelVariationDiagnosisFromDelta(delta, currentStats, previousStats);
  lines.push(`• Lectura de tendencia creativa: ${creative.diagnosis} → ${creative.action}.`);
  lines.push(`• Calidad de datos post-clic: ${funnel.dataQuality?.label || '—'}${funnel.dataQuality?.reason ? ` · ${funnel.dataQuality.reason}` : ''}.`);
  lines.push(`• Lectura post-clic: ${funnel.diagnosis} → ${funnel.action}.`);

  return lines;
}

function reportBudgetChangeImpactCC(change, campaignHistory = []) {
  const rows = [...campaignHistory].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const before = rows.filter(r => String(r.date) < String(change.date)).slice(-3);
  const after = rows.filter(r => String(r.date) >= String(change.date)).slice(0, 3);
  const beforeStats = aggregateRecords(before);
  const afterStats = aggregateRecords(after);
  const cpaDelta = pctChange(afterStats.cpa, beforeStats.cpa);

  const beforeSpendDay = beforeStats.days > 0 ? beforeStats.spend / beforeStats.days : null;
  const afterSpendDay = afterStats.days > 0 ? afterStats.spend / afterStats.days : null;
  const beforePurchasesDay = beforeStats.days > 0 ? beforeStats.purchases / beforeStats.days : null;
  const afterPurchasesDay = afterStats.days > 0 ? afterStats.purchases / afterStats.days : null;

  const volumeDelta = pctChange(afterPurchasesDay, beforePurchasesDay);

  // CPA marginal normalizado por día:
  // cuánto gasto diario adicional se necesitó por cada compra diaria adicional.
  // Así no depende de que el bloque anterior y posterior tengan exactamente
  // la misma cantidad de días.
  const extraSpendDay =
    beforeSpendDay !== null && afterSpendDay !== null
      ? afterSpendDay - beforeSpendDay
      : null;

  const extraPurchasesDay =
    beforePurchasesDay !== null && afterPurchasesDay !== null
      ? afterPurchasesDay - beforePurchasesDay
      : null;

  const marginalCpa =
    extraSpendDay !== null &&
    extraPurchasesDay !== null &&
    extraSpendDay > 0 &&
    extraPurchasesDay > 0
      ? extraSpendDay / extraPurchasesDay
      : null;

  return {
    beforeStats,
    afterStats,
    beforeDates: before.map(r => r.date),
    afterDates: after.map(r => r.date),
    cpaDelta,
    volumeDelta,
    marginalCpa,
    beforeSpendDay,
    afterSpendDay,
    beforePurchasesDay,
    afterPurchasesDay,
    extraSpendDay,
    extraPurchasesDay
  };
}

function reportHookHoldBlockCC(title, currentStats, previousStats, ad) {
  const hh = hookHoldDiagnosticCC(currentStats, previousStats, ad);
  const lines = [];
  lines.push(title);
  lines.push('-'.repeat(Math.max(42, title.length)));
  if (!hh.isVideo) {
    lines.push('NO APLICA · creativo no identificado como video.');
    return lines;
  }
  lines.push(`Hook Rate: ${fmtRate(currentStats?.hookRate)} · anterior ${fmtRate(previousStats?.hookRate)} · Δ ${hh.hookDelta === null ? '—' : `${hh.hookDelta > 0 ? '+' : ''}${fmtNum(hh.hookDelta, 2)}%`} · ${hh.hook.level}`);
  lines.push(`Lectura Hook: ${hh.hook.reading} Acción específica: ${hh.hook.action}`);
  lines.push(`Hold Rate: ${fmtRate(currentStats?.holdRate)} · anterior ${fmtRate(previousStats?.holdRate)} · Δ ${hh.holdDelta === null ? '—' : `${hh.holdDelta > 0 ? '+' : ''}${fmtNum(hh.holdDelta, 2)}%`} · ${hh.hold.level}`);
  lines.push(`Lectura Hold: ${hh.hold.reading} Acción específica: ${hh.hold.action}`);
  lines.push(`Muestra: ${hh.sampleLabel} · Impresiones ${fmtNum(currentStats?.impressions, 0)} · reproducciones 3 s estimadas ${fmtNum(currentStats?.video3sPlaysEstimated, 0)}`);
  lines.push(`Diagnóstico Hook × Hold: ${hh.diagnosis}`);
  lines.push(`Variación recomendada: ${hh.action}`);
  lines.push('Regla: este diagnóstico NO modifica la clasificación comercial, CPA, contribución ni decisión de escala.');
  return lines;
}

function reportContributionImpactTextCC(contribution) {
  if (!contribution || contribution.campaignCpa === null || contribution.campaignCpa === undefined) return 'Sin base suficiente para calcular impacto.';
  if (contribution.cpaWithout === null || contribution.cpaWithout === undefined) {
    return 'El CPA del resto no es calculable porque, al excluir este anuncio, no quedarían compras suficientes.';
  }

  const impact = pctChange(contribution.cpaWithout, contribution.campaignCpa);
  if (impact === null) return 'Sin base comparable.';

  if (impact > 0) {
    return `Si se excluyeran matemáticamente sus resultados históricos, el CPA del resto sería ${fmtCpa(contribution.cpaWithout)}, ${fmtNum(Math.abs(impact), 2)}% PEOR. El anuncio está ayudando a la eficiencia.`;
  }
  if (impact < 0) {
    return `Si se excluyeran matemáticamente sus resultados históricos, el CPA del resto sería ${fmtCpa(contribution.cpaWithout)}, ${fmtNum(Math.abs(impact), 2)}% MEJOR. El anuncio está ejerciendo presión negativa sobre la eficiencia.`;
  }
  return `El CPA del resto sería prácticamente igual (${fmtCpa(contribution.cpaWithout)}). Impacto neutral.`;
}

function buildDetailedCampaignReportCC({
  products = [],
  campaigns = [],
  ads = [],
  dailyCampaigns = [],
  dailyAds = [],
  budgetChanges = [],
  recommendations = [],
  decisions = [],
  productId = 'all',
  campaignId = 'all'
}) {
  const today = todayColombiaCC();
  const lastComplete = lastCompleteColombiaDateCC();
  const generatedAt = colombiaDateTimeLabelCC();

  // Apagadas y archivadas conservan histórico en informes.
  // Solo la eliminación definitiva hace desaparecer la campaña.
  let selectedCampaigns = campaigns
    .filter(c => productId === 'all' || c.productId === productId)
    .filter(c => campaignId === 'all' || c.id === campaignId)
    .sort((a, b) => {
      const pa = products.find(p => p.id === a.productId)?.name || '';
      const pb = products.find(p => p.id === b.productId)?.name || '';
      return pa.localeCompare(pb) || String(a.name || '').localeCompare(String(b.name || ''));
    });

  const selectedProductIds = new Set(selectedCampaigns.map(c => c.productId));
  const selectedProducts = products.filter(p => selectedProductIds.has(p.id));

  const lines = [];
  const summary = {
    products: selectedProducts.length,
    campaigns: selectedCampaigns.length,
    campaignsWithData: 0,
    scalable: 0,
    maintain: 0,
    attention: 0,
    critical: 0,
    ads: 0,
    strong: 0,
    contributes: 0,
    watch: 0,
    draining: 0,
    noDelivery: 0
  };

  const opportunities = [];
  const risks = [];
  const aiCampaignRows = [];

  lines.push('WINNER SYSTEM 360');
  lines.push('INFORME DETALLADO DE CONTROL DE CAMPAÑAS META ADS');
  lines.push('='.repeat(78));
  lines.push(`Generado: ${generatedAt}`);
  lines.push(`Zona horaria: America/Bogota`);
  lines.push(`Fecha actual: ${today}`);
  lines.push(`Último día completo permitido: ${lastComplete}`);
  lines.push('');
  lines.push('MODELO DE ANÁLISIS');
  lines.push('-'.repeat(78));
  lines.push('• 3D = ventana principal y determinante de la decisión operativa.');
  lines.push('• 3D anterior = comparación obligatoria para variaciones.');
  lines.push('• Último día completo = alerta temprana; NO reemplaza la decisión 3D.');
  lines.push('• 7D = confirmación de tendencia.');
  lines.push('• 14D = contexto + benchmark.');
  lines.push('• 30D = contexto histórico de largo plazo.');
  lines.push('• HOY se excluye completamente de decisiones por ser intradía.');
  lines.push('• Días OFF se excluyen y nunca se convierten en ceros.');
  lines.push('• CPA = gasto/compras únicamente cuando compras > 0. Sin compras, CPA = —.');
  lines.push('• Frecuencia agregada es una aproximación ponderada cuando no existe reach deduplicado.');
  lines.push('• "CPA del resto sin anuncio" es un contrafactual histórico matemático; NO predice la redistribución futura de Meta.');
  lines.push('• CVR = Visita → Compra. Es una métrica principal para localizar deterioro post-clic.');
  lines.push('• HECHO, INTERPRETACIÓN e HIPÓTESIS se separan: una hipótesis nunca se presenta como causa demostrada.');
  lines.push('• TENDENCIA y SALUD ACTUAL son distintas: una métrica puede deteriorarse frente al bloque anterior y seguir saludable/aceptable por estándar operativo.');
  lines.push('• CAPA PLAYBOOK: frecuencia 2,5–3,0 es una alerta diagnóstica, no una ley universal. Fatiga exige repetición + deterioro de respuesta + impacto económico.');
  lines.push('• Los protocolos Playbook estrictos solo se confirman cuando el CPA 3D ya está fuera del límite rentable (o existe gasto ≥ CPA máximo sin compras). Si el CPA sigue rentable, la salida es señal temprana/alerta, no protocolo confirmado.');
  lines.push('• Protocolo A: CVR cae de forma marcada mientras CPM/CTR/CPC permanecen relativamente estables. Protocolo B: frecuencia elevada/subiendo + CTR cae + CPC/CPM presionan + CPA empeora.');
  lines.push('• LA PODA CBO · CAPA 1: solo se propone cuando un anuncio concentra ≥55% del gasto y aventaja al segundo por ≥20 puntos, cumple pausa 3D y existe otro anuncio activo con CPA rentable y mejor señal. El receptor con muestra baja se considera candidato, NO ganador confirmado.');
  lines.push('• Después de La Poda se observa 48–72 h: si el receptor absorbe ≥60% del gasto y mantiene CPA rentable = Poda exitosa; si absorbe volumen pero pierde rentabilidad = Efecto Espejismo y se recomienda relevo completo.');
  lines.push('• Estándares operativos actuales: CTR saludable ≥2%, aceptable 1,2–1,99%; CVR saludable ≥3%, aceptable 2–2,99%; CPM saludable ≤$10.000; CPC máximo rentable ≈ CPA máximo × CVR.');
  lines.push('• CPC para mensajes usa una escala separada: <500 excelente; 500–599 sobresaliente; 600–799 muy bueno; 800–999 bueno; 1.000–1.200 aceptable; >1.200 no apto actualmente.');
  lines.push('• Margen operativo de cambios: 48 h entre cambios estructurales; escalamiento de presupuesto hasta +20% puede repetirse tras 24 h. Son reglas internas de seguridad, no umbrales oficiales universales publicados por Meta.');
  lines.push('');
  lines.push(`ALCANCE: ${productId === 'all' ? 'TODOS LOS PRODUCTOS' : (products.find(p => p.id === productId)?.name || productId)}${campaignId !== 'all' ? ` · CAMPAÑA ${campaigns.find(c => c.id === campaignId)?.name || campaignId}` : ''}`);
  lines.push(`Productos incluidos: ${selectedProducts.length}`);
  lines.push(`Campañas incluidas: ${selectedCampaigns.length}`);
  lines.push('');

  for (const product of selectedProducts) {
    const productCampaigns = selectedCampaigns.filter(c => c.productId === product.id);
    const maxCpa = Math.max(1, toNumber(product.maxCpa));
    const benchmark = buildProductBenchmark(product.id, dailyAds, dailyCampaigns, maxCpa, ads, campaigns);

    lines.push('');
    lines.push('#'.repeat(78));
    lines.push(`PRODUCTO: ${product.name}`);
    lines.push('#'.repeat(78));
    lines.push(`Estado actual: ${product.active === false ? 'INACTIVO' : 'ACTIVO'}`);
    lines.push(`Fecha operativa producto: ${product.effectiveStartDate || product.createdDate || '—'}`);
    lines.push(`CPA máximo: ${fmtMoney(maxCpa)}`);
    lines.push(`Zona de escala fuerte (≤80% CPA máximo): ${fmtMoney(maxCpa * 0.8)}`);
    lines.push(`Campañas incluidas: ${productCampaigns.length}`);
    lines.push('');
    lines.push('BENCHMARK PRODUCTO · 14 DÍAS ACTIVOS COMPLETOS');
    lines.push(`Estado benchmark: ${benchmark.status}`);
    lines.push(`Días disponibles: ${benchmark.availableDays} · Rentables: ${benchmark.profitableDays} · Estables: ${benchmark.stableDays} · Muestra usada: ${benchmark.sampleDays}`);
    lines.push(`CPA benchmark: ${benchmark.sampleDays ? fmtCpa(benchmark.cpa) : '—'}`);
    lines.push(`CTR benchmark: ${benchmark.sampleDays ? fmtRate(benchmark.ctr) : '—'}`);
    lines.push(`CPC benchmark: ${benchmark.sampleDays ? fmtMoney(benchmark.cpc) : '—'}`);
    lines.push(`CPM benchmark: ${benchmark.sampleDays ? fmtMoney(benchmark.cpm) : '—'}`);
    lines.push(`Frecuencia benchmark: ${benchmark.sampleDays ? fmtNum(benchmark.frequency, 2) : '—'}`);
    lines.push(`ROAS benchmark: ${benchmark.sampleDays ? `${fmtNum(benchmark.roas, 2)}x` : '—'}`);
    lines.push(`Visita→Compra benchmark: ${benchmark.sampleDays ? fmtRate(benchmark.visitToPurchase) : '—'}`);
    lines.push(`Criterio: ${benchmark.criteria}`);

    for (const campaign of productCampaigns) {
      const campaignHistory = eligibleCampaignRecords(
        dailyCampaigns.filter(r => r.campaignId === campaign.id),
        campaign
      )
        .filter(r => String(r.date) < today)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));

      if (campaignHistory.length) summary.campaignsWithData += 1;

      const lastWindow = reportWindowCC(campaignHistory, 1, 3, today);
      const w3 = reportWindowCC(campaignHistory, 3, 3, today);
      const w7 = reportWindowCC(campaignHistory, 7, 7, today);
      const w14 = reportWindowCC(campaignHistory, 14, 14, today);
      const w30 = reportWindowCC(campaignHistory, 30, 30, today);
      const contribution3d = buildCampaignContribution3D(campaign, product, ads, dailyAds);

      const recent14Dates = new Set(w14.currentDates);
      const campaignAds = ads
        .filter(a => a.campaignId === campaign.id)
        .filter(a => {
          if (a.active !== false) return true;
          return dailyAds.some(r => r.adId === a.id && recent14Dates.has(String(r.date)));
        })
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

      const adRows = campaignAds.map(ad => {
        const records = dailyAds.filter(r => r.adId === ad.id);
        return {
          ad,
          records,
          diag: diagnoseAd(records, product, ad, '3d', campaign),
          contribution: contribution3d.byAd[ad.id] || null
        };
      });

      const scaleRows = buildScaleHistory(campaignHistory, maxCpa);
      const campaignDecision = buildCampaignDecision(campaign, product, campaignHistory, adRows, scaleRows);
      const reportReadingRows = adRows.map(row => {
        const relational = buildRelationalAdDiagnosticCC(row.diag, row.contribution, maxCpa, row.ad, benchmark);
        const action = adReadingActionCC(row.diag, row.contribution, maxCpa);
        return { ...row, relational, action };
      });
      const campaignOverview = buildCampaignLayerDiagnosticCC(w3.currentStats, w3.previousStats, reportReadingRows, maxCpa);
      const coverage = campaignRegistrationCoverageCC(campaign, product, dailyCampaigns, lastComplete);
      const budgetRows = budgetChanges
        .filter(b => b.campaignId === campaign.id && (!b.date || String(b.date) < today))
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
      const recommendationRows = recommendations
        .filter(r => r.campaignId === campaign.id)
        .sort((a, b) => String(b.createdDate || b.appliedDate || '').localeCompare(String(a.createdDate || a.appliedDate || '')));
      const decisionRows = decisions
        .filter(d => d.campaignId === campaign.id)
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

      const latestCampaignRecord = [...campaignHistory].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null;
      const currentBudget = toNumber(latestCampaignRecord?.budget);
      const currentBudgetSource = latestCampaignRecord?.budgetSource === 'inherited_previous'
        ? `Heredado del ${latestCampaignRecord?.budgetInheritedFromDate || 'registro anterior'}`
        : latestCampaignRecord?.budgetSource || 'Registrado/manual';

      if (campaignDecision.status === 'Escalable') summary.scalable += 1;
      else if (campaignDecision.status === 'Crítico' || campaignDecision.status.includes('Fuera del objetivo')) summary.critical += 1;
      else if (campaignDecision.status === 'Atención' || campaignDecision.status.includes('revisar')) summary.attention += 1;
      else summary.maintain += 1;

      lines.push('');
      lines.push('='.repeat(78));
      lines.push(`CAMPAÑA: ${campaign.name}`);
      lines.push('='.repeat(78));
      lines.push(`Estado actual: ${campaignCurrentStateLabelCC(campaign)}`);
      lines.push(`Fecha inicio campaña: ${campaign.effectiveStartDate || campaign.createdDate || '—'}`);
      if (campaign.active === false || campaign.archived) {
        lines.push(`Fecha efectiva de apagado: ${campaign.deactivatedDate || campaign.archivedDate || campaign.stateChangedDate || '—'}`);
        lines.push('Histórico: CONSERVADO · la campaña continúa disponible en este informe mientras no sea eliminada definitivamente.');
      }
      lines.push(`Días registrados históricos: ${campaignHistory.length}`);
      lines.push(`Cobertura hasta ${lastComplete}: ${coverage.registeredDays}/${coverage.requiredDays} · pendientes ${coverage.missingDays}`);
      if (coverage.missingDates?.length) lines.push(`Fechas pendientes: ${coverage.missingDates.join(', ')}`);
      lines.push('');
      lines.push('DECISIÓN OPERATIVA · 3D');
      lines.push(`Estado: ${campaignDecision.status}`);
      lines.push(`Acción: ${campaignDecision.action}`);
      lines.push(`Motivo: ${campaignDecision.reason}`);
      lines.push(`Presupuesto recomendado: ${campaignDecision.recommendedBudget ? fmtMoney(campaignDecision.recommendedBudget) : '—'}`);
      lines.push(`Lectura CPA 3D: ${campaignDecision.cpaObservation3d?.title || '—'}`);
      lines.push(`Detalle CPA 3D: ${campaignDecision.cpaObservation3d?.text || '—'}`);
      lines.push('');
      lines.push('CAPA 1 · MIRADA GENERAL DE CAMPAÑA');
      lines.push('-'.repeat(78));
      lines.push(`Resultado: ${campaignOverview.resultTitle}`);
      lines.push(`En palabras simples: ${campaignOverview.resultSimple}`);
      lines.push(`Alcance del problema: ${campaignOverview.scope}`);
      lines.push(`Presupuesto afectado: ${fmtRate(campaignOverview.affectedSpend)} · ${campaignOverview.affectedCount}/${campaignOverview.activeSpendCount} anuncios con gasto`);
      lines.push(`Capa con mayor señal: ${campaignOverview.dominantLayer}`);
      lines.push(`Lectura: ${campaignOverview.scopeSimple}`);
      lines.push(`Acción: ${campaignOverview.action}`);
      if (campaignOverview.topProblems.length) {
        lines.push('Anuncios que más explican el deterioro:');
        campaignOverview.topProblems.forEach((item, index) => {
          lines.push(`  ${index + 1}. ${item.name} · ${item.action} · ${fmtRate(item.spendShare)} del gasto · ${item.contribution} · capa ${item.layer}`);
        });
      }
      lines.push(`Nota metodológica: ${campaignOverview.rulesNote}`);

      lines.push('');
      lines.push('PRESUPUESTO ACTUAL');
      lines.push(`Presupuesto último cierre: ${currentBudget > 0 ? fmtMoney(currentBudget) : '—'}`);
      lines.push(`Fecha último cierre: ${latestCampaignRecord?.date || '—'}`);
      lines.push(`Origen del presupuesto: ${currentBudget > 0 ? currentBudgetSource : '—'}`);
      if (latestCampaignRecord?.budgetPreviousValue) {
        lines.push(`Presupuesto anterior conocido: ${fmtMoney(latestCampaignRecord.budgetPreviousValue)}`);
      }

      lines.push('');

      lines.push(...reportStatsTableCC('ÚLTIMO DÍA COMPLETO · ALERTA TEMPRANA VS 3 DÍAS ANTERIORES', lastWindow));
      lines.push('');
      lines.push(...reportStatsTableCC('VENTANA OPERATIVA 3D · DECIDE', w3));
      lines.push('');
      lines.push('ANÁLISIS DE CAUSAS · 3D');
      lines.push(...reportCausalInsightsCC(w3.currentStats, w3.previousStats, maxCpa));
      lines.push('');
      lines.push(...reportStatsTableCC('CONTEXTO 7D · CONFIRMA', w7));
      lines.push('');
      lines.push(...reportStatsTableCC('CONTEXTO 14D · TENDENCIA / BENCHMARK', w14));
      lines.push('');
      lines.push(...reportStatsTableCC('CONTEXTO 30D · HISTÓRICO', w30));

      lines.push('');
      lines.push('HISTORIAL DE CAMBIOS DE PRESUPUESTO');
      lines.push('-'.repeat(78));
      if (!budgetRows.length) {
        lines.push('Sin cambios de presupuesto detectados todavía.');
      } else {
        budgetRows.forEach((change, index) => {
          const impact = reportBudgetChangeImpactCC(change, campaignHistory);
          lines.push(`${index + 1}. ${change.date || '—'} · ${fmtMoney(change.previousBudget)} → ${fmtMoney(change.newBudget)} · ${change.changePct >= 0 ? '+' : ''}${fmtNum(change.changePct, 2)}% · ${change.origin === 'recommendation' ? 'RECOMENDACIÓN APLICADA' : 'CAMBIO MANUAL'}`);
          lines.push(`   Antes (hasta 3 cierres): ${reportWindowLabelCC(impact.beforeDates)} · CPA ${fmtCpa(impact.beforeStats.cpa)} · Compras ${fmtNum(impact.beforeStats.purchases, 2)} · Gasto ${fmtMoney(impact.beforeStats.spend)}`);
          lines.push(`   Después (hasta 3 cierres): ${reportWindowLabelCC(impact.afterDates)} · CPA ${fmtCpa(impact.afterStats.cpa)} · Compras ${fmtNum(impact.afterStats.purchases, 2)} · Gasto ${fmtMoney(impact.afterStats.spend)}`);
          lines.push(`   Variación CPA post-cambio: ${impact.cpaDelta === null ? '—' : `${impact.cpaDelta > 0 ? '+' : ''}${fmtNum(impact.cpaDelta, 2)}%`}`);
          lines.push(`   Variación compras/día: ${impact.volumeDelta === null ? '—' : `${impact.volumeDelta > 0 ? '+' : ''}${fmtNum(impact.volumeDelta, 2)}%`}`);
          lines.push(`   CPA marginal aproximado: ${impact.marginalCpa === null ? '—' : fmtMoney(impact.marginalCpa)}`);
        });
      }

      const reportChangeSafety = buildCampaignChangeSafetyCC(
        campaign,
        budgetRows,
        decisionRows,
        Date.now()
      );

      const reportScaleStatus = buildCurrentScaleStatusCC(
        campaignHistory,
        scaleRows,
        maxCpa,
        budgetRows,
        reportChangeSafety
      );

      const reportPoda = buildCampaignPruningProtocolCC({
        campaign,
        product,
        allAds: ads,
        dailyAds,
        decisions: decisionRows,
        changeSafety: reportChangeSafety,
        nowMs: Date.now()
      });

      lines.push('');
      lines.push('CAPA 1 · PROTOCOLO LA PODA CBO');
      lines.push('-'.repeat(78));
      if (reportPoda.eligible === false) {
        lines.push('No aplica: La Poda solo se evalúa en campañas cuyo nombre contiene ESCALA.');
      } else if (reportPoda.active) {
        lines.push(`Estado: ${reportPoda.status}`);
        lines.push(`Lectura: ${reportPoda.summary}`);
        lines.push(`Evidencia: ${reportPoda.evidence || '—'}`);
        lines.push(`Acción recomendada: ${reportPoda.action || '—'}`);
        if (reportPoda.dominantAd) lines.push(`Anuncio dominante: ${reportPoda.dominantAd.name}`);
        if (reportPoda.candidateAd) lines.push(`Anuncio receptor: ${reportPoda.candidateAd.name}`);
        if (reportPoda.candidateConfidence) lines.push(`Confianza receptor: ${reportPoda.candidateConfidence}`);
        if (reportPoda.spendShare !== undefined) lines.push(`Participación de gasto post-poda del receptor: ${fmtRate(reportPoda.spendShare)}`);
      } else {
        lines.push('Sin escenario de Poda CBO activo.');
      }

      lines.push('');
      lines.push('DIAGNÓSTICO CAUSAL DE ESCALA');
      lines.push('-'.repeat(78));
      if (reportScaleStatus?.scaleDiagnosis) {
        lines.push(`Estado: ${reportScaleStatus.scaleDiagnosis.status}`);
        lines.push(`Confianza: ${reportScaleStatus.scaleDiagnosis.confidence}`);
        lines.push(`Lectura: ${reportScaleStatus.scaleDiagnosis.summary}`);
        lines.push(`Evidencia: ${reportScaleStatus.scaleDiagnosis.evidence}`);
        lines.push(`Acción / siguiente paso: ${reportScaleStatus.scaleDiagnosis.recommendedAction}`);
        lines.push(`Reducción habilitada: ${reportScaleStatus.scaleDiagnosis.shouldReduceBudget ? 'SÍ' : 'NO'}`);
        lines.push(`3D confirma deterioro: ${reportScaleStatus.scaleDiagnosis.threeDayConfirms ? 'SÍ' : 'NO'}`);
        lines.push(`Señal de recuperación último día: ${reportScaleStatus.scaleDiagnosis.recoverySignal ? 'SÍ' : 'NO'}`);
        lines.push(`Ventana de seguridad activa: ${reportScaleStatus.scaleDiagnosis.safetyBlocked ? 'SÍ' : 'NO'}`);
        lines.push('Nota: relación temporal/operativa; no demuestra causalidad absoluta.');
      } else {
        lines.push('Sin diagnóstico causal de escala disponible.');
      }

      lines.push('');
      lines.push('NIVELES HISTÓRICOS DE PRESUPUESTO / ESCALA');
      lines.push('-'.repeat(78));
      if (!scaleRows.length) {
        lines.push('Sin niveles de presupuesto suficientes.');
      } else {
        lines.push('PRESUPUESTO | DÍAS | GASTO | COMPRAS | CPA | ROAS | CPA MARGINAL | ESTADO | ACCIÓN');
        scaleRows.forEach(row => {
          lines.push(`${fmtMoney(row.budget)} | ${row.days} | ${fmtMoney(row.spend)} | ${fmtNum(row.purchases, 2)} | ${fmtCpa(row.cpa)} | ${row.roas === null || row.roas === undefined ? '—' : `${fmtNum(row.roas, 2)}x`} | ${row.marginalCpa === null ? '—' : fmtMoney(row.marginalCpa)} | ${row.status} | ${row.action}`);
        });
      }

      lines.push('');
      lines.push('DIAGNÓSTICO DETALLADO POR ANUNCIO');
      lines.push('='.repeat(78));

      for (const { ad, records, diag, contribution } of adRows) {
        summary.ads += 1;
        if (contribution?.status === 'Aporta fuertemente') summary.strong += 1;
        else if (contribution?.status === 'Aporta') summary.contributes += 1;
        else if (contribution?.status === 'Drena la campaña') summary.draining += 1;
        else summary.watch += 1;
        if (diag.metaDelivery3d?.isNoDelivery) summary.noDelivery += 1;

        const eligible = eligibleAdRecords(records, ad, campaign);
        const adLast = reportWindowCC(eligible, 1, 3, today);
        const ad3 = reportWindowCC(eligible, 3, 3, today);
        const ad7 = reportWindowCC(eligible, 7, 7, today);
        const ad14 = reportWindowCC(eligible, 14, 14, today);
        const ad30 = reportWindowCC(eligible, 30, 30, today);
        const spentVsMax = maxCpa > 0 ? (ad3.currentStats.spend / maxCpa) * 100 : null;
        const relational = buildRelationalAdDiagnosticCC(diag, contribution, maxCpa, ad, benchmark);
        const readingAction = adReadingActionCC(diag, contribution, maxCpa);
        const playbook = buildPlaybookProtocolCC(diag, maxCpa, reportChangeSafety, ad, campaign);

        lines.push('');
        lines.push('-'.repeat(78));
        lines.push(`ANUNCIO: ${ad.name}`);
        lines.push('-'.repeat(78));
        lines.push(`Estado actual: ${ad.active === false ? 'APAGADO' : 'ACTIVO'}`);
        lines.push(`Fecha inicio anuncio: ${ad.effectiveStartDate || ad.createdDate || '—'}`);
        lines.push(`Días activos calculados: ${diag.ageDays}`);
        lines.push(`Confianza por volumen 3D: ${diag.volumeReference?.confidence || '—'} · ${fmtNum(diag.volumeReference?.purchases || 0, 2)} compras`);
        lines.push('');
        lines.push('ENTREGA META · 3D');
        lines.push(`Estado: ${diag.metaDelivery3d?.status || '—'}`);
        lines.push(`Días omitidos: ${diag.metaDelivery3d?.omittedDays || 0}/${diag.metaDelivery3d?.totalDays || 0}`);
        lines.push(`Acción: ${diag.metaDelivery3d?.action || '—'}`);
        lines.push(`Motivo: ${diag.metaDelivery3d?.reason || '—'}`);
        lines.push('');
        lines.push('DIAGNÓSTICO RELACIONAL · 3D');
        lines.push('-'.repeat(78));
        lines.push(`Capa principal: ${relational.primaryLayer}`);
        lines.push(`Diagnóstico general: ${relational.general.title}`);
        lines.push(`HECHO: ${relational.general.fact}`);
        lines.push(`INTERPRETACIÓN: ${relational.general.interpretation}`);
        lines.push(`HIPÓTESIS: ${relational.general.hypothesis}`);
        lines.push(`Resultado: ${relational.result.title} · ${relational.result.summary}`);
        lines.push(`Impacto presupuestario: ${relational.impact.level} · ${relational.impact.summary}`);
        lines.push(`Distribución: ${relational.distribution.title} · ${relational.distribution.summary}`);
        lines.push(`Respuesta creativa: ${relational.creative.title} · ${relational.creative.summary}`);
        lines.push(`Costo del tráfico: ${relational.traffic.title} · ${relational.traffic.summary}`);
        lines.push(`Post-clic/CVR: ${relational.postClick.title} · ${relational.postClick.summary}`);
        lines.push(`Comparación con otros anuncios: ${relational.postClick.peerInterpretation}`);
        lines.push(`Confianza: ${relational.confidence.label} · ${relational.confidence.summary}`);
        lines.push(`EN PALABRAS SIMPLES: ${relational.general.simpleStory}`);
        lines.push('');
        lines.push('CAPA PLAYBOOK · 3D');
        if (playbook.eligible === false) {
          lines.push('No aplica: el nombre de la campaña no contiene ESCALA.');
        } else if (playbook.active) {
          lines.push(`Estado: ${playbook.label}`);
          lines.push(`Severidad: ${playbook.severity.toUpperCase()}`);
          lines.push(`Filtro económico: ${playbook.economicGate?.label || '—'}`);
          lines.push(`Lectura: ${playbook.summary}`);
          lines.push(`Evidencia: ${playbook.evidence}`);
          lines.push(`Acción recomendada: ${playbook.action}`);
        } else {
          lines.push('Evaluado — sin protocolo Playbook activo.');
          lines.push(`Lectura: ${playbook.summary || 'No coincide con Protocolo A/B.'}`);
        }
        lines.push('');
        lines.push('PROTECCIÓN DE PRESUPUESTO · PAUSA 3D');
        lines.push(`Decisión: ${readingAction.label}`);
        lines.push(`Lectura: ${readingAction.title}`);
        lines.push(`Explicación: ${readingAction.simple}`);
        lines.push(`Evidencia: ${readingAction.reason}`);
        lines.push(`Estado futuro: ${readingAction.pause?.futureStatus || '—'}`);
        lines.push('Regla: PAUSAR protege presupuesto hoy; NO significa declarar el creativo muerto para siempre.');
        lines.push('');
        lines.push(...reportHookHoldBlockCC('DIAGNÓSTICO CREATIVO HOOK/HOLD · 3D VS 3D ANTERIOR', ad3.currentStats, ad3.previousStats, ad));
        lines.push('');
        lines.push(...reportHookHoldBlockCC('HOOK/HOLD · 7D VS 7D ANTERIOR', ad7.currentStats, ad7.previousStats, ad));
        lines.push('');
        lines.push(...reportHookHoldBlockCC('HOOK/HOLD · 14D VS 14D ANTERIOR', ad14.currentStats, ad14.previousStats, ad));
        lines.push('');
        lines.push('CONTRIBUCIÓN A CAMPAÑA · 3D');
        lines.push(`Estado: ${contribution?.status || 'Sin lectura'}`);
        lines.push(`Gasto anuncio: ${contribution ? fmtMoney(contribution.spend) : '—'}`);
        lines.push(`Compras anuncio: ${contribution ? fmtNum(contribution.purchases, 2) : '—'}`);
        lines.push(`CPA anuncio: ${contribution ? fmtCpa(contribution.cpa) : '—'}`);
        lines.push(`Participación gasto campaña: ${contribution ? fmtRate(contribution.spendShare) : '—'}`);
        lines.push(`Participación compras campaña: ${contribution ? fmtRate(contribution.purchaseShare) : '—'}`);
        lines.push(`CPA campaña 3D: ${contribution ? fmtCpa(contribution.campaignCpa) : '—'}`);
        lines.push(`CPA del resto sin este anuncio: ${contribution ? fmtCpa(contribution.cpaWithout) : '—'}`);
        lines.push(`Impacto histórico: ${reportContributionImpactTextCC(contribution)}`);
        lines.push(`Causa: ${contribution?.cause || '—'}`);
        if (ad3.currentStats.purchases <= 0 && ad3.currentStats.spend > 0) {
          lines.push(`Consumo frente CPA máximo sin compras: ${fmtNum(spentVsMax, 2)}% (${fmtMoney(ad3.currentStats.spend)} / ${fmtMoney(maxCpa)}).`);
        }
        lines.push('');
        lines.push('DECISIÓN OPERATIVA DEL ANUNCIO · 3D');
        lines.push(`Diagnóstico técnico: ${diag.operational3dDiagnosis}`);
        lines.push(`Acción final de lectura: ${readingAction.label} · ${readingAction.title}`);
        lines.push(`Motivo explicado: ${readingAction.simple}`);
        lines.push(`Evidencia: ${readingAction.reason}`);
        lines.push(`Momentum CPA: ${diag.scaleMomentum}`);
        lines.push(`Diagnóstico creativo 3D: ${diag.scaleDynamic3d}`);
        lines.push(`Diagnóstico post-clic 3D: ${diag.scalePost3d}`);
        lines.push(`CPA máximo: ${fmtMoney(diag.maxCpa)}`);
        lines.push(`Zona escala fuerte: ${fmtMoney(diag.scaleCpa)}`);
        lines.push(`Escala permitida: ${diag.canScale ? 'SÍ' : 'NO'}`);
        if (diag.guardrails) {
          lines.push(`Guardrail CPA margen: ${diag.guardrails.cpaMargin ? 'PASA' : 'BLOQUEA'}`);
          lines.push(`Guardrail estabilidad: ${diag.guardrails.stability ? 'PASA' : 'BLOQUEA'}`);
          lines.push(`Guardrail creativo: ${diag.guardrails.creative ? 'PASA' : 'BLOQUEA'}`);
          lines.push(`Guardrail post-clic: ${diag.guardrails.postClick ? 'PASA' : 'BLOQUEA'}`);
        }

        lines.push('');
        lines.push(...reportStatsTableCC('ANUNCIO · ÚLTIMO DÍA VS 3 ANTERIORES', adLast));
        lines.push('');
        lines.push(...reportStatsTableCC('ANUNCIO · 3D VS 3D ANTERIOR', ad3));
        lines.push('');
        lines.push(...reportStatsTableCC('ANUNCIO · 7D VS 7D ANTERIOR', ad7));
        lines.push('');
        lines.push(...reportStatsTableCC('ANUNCIO · 14D VS 14D ANTERIOR', ad14));
        lines.push('');
        lines.push(...reportStatsTableCC('ANUNCIO · 30D VS 30D ANTERIOR', ad30));

        if (contribution?.status === 'Aporta fuertemente') {
          opportunities.push(`${product.name} / ${campaign.name} / ${ad.name}: ${contribution.cause}`);
        }
        if (contribution?.status === 'Drena la campaña') {
          risks.push(`${product.name} / ${campaign.name} / ${ad.name}: ${contribution.cause}`);
        } else if (ad3.currentStats.purchases <= 0 && ad3.currentStats.spend >= maxCpa * 0.5) {
          risks.push(`${product.name} / ${campaign.name} / ${ad.name}: ${fmtNum(spentVsMax, 2)}% del CPA máximo consumido sin compras.`);
        }
        if (diag.metaDelivery3d?.isNoDelivery) {
          risks.push(`${product.name} / ${campaign.name} / ${ad.name}: sin entrega de Meta en ${diag.metaDelivery3d.omittedDays}/${diag.metaDelivery3d.totalDays} día(s) 3D.`);
        }
      }

      lines.push('');
      lines.push('RECOMENDACIONES REGISTRADAS');
      lines.push('-'.repeat(78));
      if (!recommendationRows.length) lines.push('Sin recomendaciones almacenadas.');
      recommendationRows.forEach((r, i) => {
        lines.push(`${i + 1}. Estado=${r.status || '—'} · Tipo=${r.type || '—'} · Actual=${r.currentBudget ? fmtMoney(r.currentBudget) : '—'} · Recomendado=${r.recommendedBudget ? fmtMoney(r.recommendedBudget) : '—'} · Fecha=${r.createdDate || r.appliedDate || '—'} · Motivo=${r.reason || '—'}`);
      });

      lines.push('');
      lines.push('HISTORIAL DE DECISIONES REGISTRADAS');
      lines.push('-'.repeat(78));
      if (!decisionRows.length) lines.push('Sin decisiones almacenadas.');
      decisionRows.forEach((d, i) => {
        lines.push(`${i + 1}. ${d.date || '—'} · ${d.action || '—'} · ${d.detail || '—'}`);
      });

      aiCampaignRows.push({
        product: product.name,
        campaign: campaign.name,
        status: campaignDecision.status,
        currentState: campaignCurrentStateLabelCC(campaign),
        deactivatedDate: campaign.deactivatedDate || campaign.archivedDate || campaign.stateChangedDate || null,
        action: campaignDecision.action,
        currentBudget,
        cpa3d: w3.currentStats.cpa,
        maxCpa,
        purchases3d: w3.currentStats.purchases,
        spend3d: w3.currentStats.spend,
        ads: adRows.length,
        draining: adRows.filter(x => x.contribution?.status === 'Drena la campaña').map(x => x.ad.name),
        strong: adRows.filter(x => x.contribution?.status === 'Aporta fuertemente').map(x => x.ad.name),
        noDelivery: adRows.filter(x => x.diag.metaDelivery3d?.isNoDelivery).map(x => x.ad.name)
      });
    }
  }

  lines.push('');
  lines.push('');
  lines.push('#'.repeat(78));
  lines.push('RESUMEN EJECUTIVO GLOBAL');
  lines.push('#'.repeat(78));
  lines.push(`Productos analizados: ${summary.products}`);
  lines.push(`Campañas incluidas: ${summary.campaigns}`);
  lines.push(`Campañas con datos históricos: ${summary.campaignsWithData}`);
  lines.push(`Campañas escalables: ${summary.scalable}`);
  lines.push(`Campañas mantener: ${summary.maintain}`);
  lines.push(`Campañas atención: ${summary.attention}`);
  lines.push(`Campañas críticas/fuera objetivo: ${summary.critical}`);
  lines.push('');
  lines.push(`Anuncios analizados: ${summary.ads}`);
  lines.push(`Aportan fuertemente: ${summary.strong}`);
  lines.push(`Aportan: ${summary.contributes}`);
  lines.push(`Bajo aporte / vigilar: ${summary.watch}`);
  lines.push(`Drenan campaña: ${summary.draining}`);
  lines.push(`Sin entrega Meta: ${summary.noDelivery}`);
  lines.push('');
  lines.push('PRINCIPALES OPORTUNIDADES');
  if (!opportunities.length) lines.push('• Sin oportunidades fuertes detectadas con los criterios actuales.');
  opportunities.slice(0, 20).forEach((x, i) => lines.push(`${i + 1}. ${x}`));
  lines.push('');
  lines.push('PRINCIPALES RIESGOS');
  if (!risks.length) lines.push('• Sin riesgos fuertes detectados con los criterios actuales.');
  risks.slice(0, 30).forEach((x, i) => lines.push(`${i + 1}. ${x}`));

  lines.push('');
  lines.push('[AI_INDEX]');
  lines.push(`report_date=${today}`);
  lines.push(`timezone=America/Bogota`);
  lines.push(`decision_window=3D_COMPLETE_ACTIVE_DAYS`);
  lines.push(`today_excluded=true`);
  lines.push(`products=${summary.products}`);
  lines.push(`campaigns=${summary.campaigns}`);
  lines.push(`campaigns_with_data=${summary.campaignsWithData}`);
  lines.push(`campaigns_scalable=${summary.scalable}`);
  lines.push(`campaigns_attention=${summary.attention}`);
  lines.push(`campaigns_critical=${summary.critical}`);
  lines.push(`ads=${summary.ads}`);
  lines.push(`ads_strong_contributors=${summary.strong}`);
  lines.push(`ads_draining=${summary.draining}`);
  lines.push(`ads_no_delivery=${summary.noDelivery}`);
  aiCampaignRows.forEach((row, index) => {
    const prefix = `campaign_${index + 1}`;
    lines.push(`${prefix}_product=${row.product}`);
    lines.push(`${prefix}_name=${row.campaign}`);
    lines.push(`${prefix}_status=${row.status}`);
    lines.push(`${prefix}_current_state=${row.currentState}`);
    lines.push(`${prefix}_deactivated_date=${row.deactivatedDate || 'NONE'}`);
    lines.push(`${prefix}_action=${row.action}`);
    lines.push(`${prefix}_budget=${row.currentBudget || 0}`);
    lines.push(`${prefix}_spend_3d=${row.spend3d || 0}`);
    lines.push(`${prefix}_purchases_3d=${row.purchases3d || 0}`);
    lines.push(`${prefix}_cpa_3d=${row.cpa3d ?? 'null'}`);
    lines.push(`${prefix}_max_cpa=${row.maxCpa}`);
    lines.push(`${prefix}_strong_ads=${row.strong.join('|') || 'NONE'}`);
    lines.push(`${prefix}_draining_ads=${row.draining.join('|') || 'NONE'}`);
    lines.push(`${prefix}_no_delivery_ads=${row.noDelivery.join('|') || 'NONE'}`);
  });
  lines.push('[/AI_INDEX]');
  lines.push('');
  lines.push('FIN DEL INFORME');

  return {
    text: lines.join('\n'),
    summary
  };
}

function CampaignReportCenter({
  products,
  campaigns,
  ads,
  dailyCampaigns,
  dailyAds,
  budgetChanges,
  recommendations,
  decisions
}) {
  const [productId, setProductId] = useState('all');
  const [campaignId, setCampaignId] = useState('all');
  const [reportText, setReportText] = useState('');
  const [reportSummary, setReportSummary] = useState(null);
  const [message, setMessage] = useState('');

  const availableCampaigns = useMemo(
    () => campaigns
      .filter(c => productId === 'all' || c.productId === productId)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [campaigns, productId]
  );

  useEffect(() => {
    if (campaignId !== 'all' && !availableCampaigns.some(c => c.id === campaignId)) {
      setCampaignId('all');
    }
  }, [availableCampaigns, campaignId]);

  const globalCompleteDates = useMemo(() => {
    const today = todayColombiaCC();
    return [...new Set(
      dailyCampaigns
        .filter(r => r?.date && String(r.date) < today)
        .map(r => String(r.date))
    )].sort((a, b) => b.localeCompare(a)).slice(0, 3).sort();
  }, [dailyCampaigns]);

  const generateReport = () => {
    const result = buildDetailedCampaignReportCC({
      products,
      campaigns,
      ads,
      dailyCampaigns,
      dailyAds,
      budgetChanges,
      recommendations,
      decisions,
      productId,
      campaignId
    });
    setReportText(result.text);
    setReportSummary(result.summary);
    setMessage(`Informe generado · ${result.summary.campaigns} campaña(s) · ${result.summary.ads} anuncio(s).`);
  };

  const copyReport = async () => {
    if (!reportText) return;
    try {
      await navigator.clipboard.writeText(reportText);
      setMessage('Informe copiado al portapapeles. Listo para pegar en una IA.');
    } catch (error) {
      const textarea = document.createElement('textarea');
      textarea.value = reportText;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setMessage('Informe copiado al portapapeles.');
    }
  };

  const downloadReport = () => {
    if (!reportText) return;
    const productName = productId === 'all'
      ? 'todos'
      : normalizeAdName(products.find(p => p.id === productId)?.name || 'producto').replace(/\s+/g, '_');
    const campaignName = campaignId === 'all'
      ? 'campanas'
      : normalizeAdName(campaigns.find(c => c.id === campaignId)?.name || 'campana').replace(/\s+/g, '_');
    const filename = `informe_meta_ads_${productName}_${campaignName}_${todayColombiaCC()}.txt`;
    const blob = new Blob([reportText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setMessage(`TXT descargado: ${filename}`);
  };

  return (
    <div className="cc-module-view cc-report-center space-y-4">
      <SectionCard accent="#7c3aed" soft="#f5f3ff">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <FileText size={20} className="text-violet-700" />
              <h3 className="text-lg font-black uppercase text-violet-900">Informe diagnóstico detallado</h3>
            </div>
            <p className="text-[9px] text-slate-600 mt-2 max-w-3xl">
              Texto estructurado para lectura humana o procesamiento por IA. La decisión operativa siempre usa los últimos 3 días activos completos anteriores a hoy. Incluye comparación 3D anterior, Último día, 7D, 14D, 30D, presupuesto, escala, benchmark y diagnóstico completo por anuncio.
            </p>
          </div>
          <div className="rounded-2xl border border-violet-200 bg-white p-3 min-w-[260px]">
            <p className="text-[8px] font-black uppercase text-violet-700">Ventana principal automática</p>
            <p className="text-sm font-black text-zinc-900 mt-1">{globalCompleteDates.length ? reportWindowLabelCC(globalCompleteDates) : 'Sin datos completos'}</p>
            <p className="text-[8px] text-slate-500 mt-1">Hoy {todayColombiaCC()} queda excluido.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
          <div>
            <p className="text-[8px] font-black uppercase text-slate-500 mb-1">Producto</p>
            <select
              value={productId}
              onChange={e => { setProductId(e.target.value); setCampaignId('all'); }}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold"
            >
              <option value="all">Todos los productos</option>
              {[...products].sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''))).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <p className="text-[8px] font-black uppercase text-slate-500 mb-1">Campaña</p>
            <select
              value={campaignId}
              onChange={e => setCampaignId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold"
            >
              <option value="all">Todas las campañas</option>
              {availableCampaigns.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          <button
            type="button"
            onClick={generateReport}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-950 text-white text-[9px] font-black uppercase"
          >
            <FileText size={13}/> Generar informe
          </button>
          <button
            type="button"
            onClick={copyReport}
            disabled={!reportText}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-[9px] font-black uppercase disabled:opacity-40"
          >
            <Copy size={13}/> Copiar para IA
          </button>
          <button
            type="button"
            onClick={downloadReport}
            disabled={!reportText}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-[9px] font-black uppercase disabled:opacity-40"
          >
            <Download size={13}/> Descargar TXT
          </button>
        </div>

        {message && <p className="text-[9px] font-bold text-violet-700 mt-3">{message}</p>}
      </SectionCard>

      {reportSummary && (
        <div className="cc-grid-kpi">
          <MiniCard label="Productos" value={reportSummary.products} />
          <MiniCard label="Campañas" value={reportSummary.campaigns} />
          <MiniCard label="Escalables" value={reportSummary.scalable} tone="good" />
          <MiniCard label="Atención" value={reportSummary.attention} />
          <MiniCard label="Drenan" value={reportSummary.draining} tone={reportSummary.draining ? 'bad' : 'good'} />
          <MiniCard label="Sin entrega Meta" value={reportSummary.noDelivery} />
        </div>
      )}

      {reportText ? (
        <SectionCard accent="#0f172a" soft="#f8fafc">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h4 className="text-xs font-black uppercase text-slate-900">Vista previa TXT</h4>
              <p className="text-[8px] text-slate-500">El contenido mostrado es exactamente el que se copia o descarga.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copyReport}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-600 text-white text-[8px] font-black uppercase hover:bg-violet-700 transition"
                title="Copiar todo el texto del informe"
              >
                <Copy size={12}/> Copiar texto
              </button>
              <span className="px-2 py-1 rounded-full bg-zinc-950 text-white text-[8px] font-black uppercase">
                {reportText.length.toLocaleString('es-CO')} caracteres
              </span>
            </div>
          </div>
          <textarea
            readOnly
            value={reportText}
            className="w-full min-h-[650px] rounded-2xl border border-slate-200 bg-white p-4 font-mono text-[10px] leading-relaxed text-slate-700"
          />
        </SectionCard>
      ) : (
        <EmptyState>Selecciona el alcance y presiona “Generar informe”.</EmptyState>
      )}
    </div>
  );
}



function campaignActionCreatedMsCC(item) {
  return (
    toNumber(item?.clientRecordedAtMs) ||
    firestoreTimeMsCC(item?.createdAt) ||
    firestoreTimeMsCC(item?.updatedAt) ||
    0
  );
}

function campaignActionApprovedMsCC(item) {
  return (
    toNumber(item?.approvedClientAtMs) ||
    firestoreTimeMsCC(item?.approvedAt) ||
    0
  );
}

function CampaignActionBoardCC({
  ownerUid,
  actionItems = [],
  campaigns = [],
  products = [],
  ads = []
}) {
  const [view, setView] = useState('pending');
  const [campaignFilter, setCampaignFilter] = useState('all');
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');

  const pending = useMemo(
    () => actionItems.filter(x => x.status !== 'approved'),
    [actionItems]
  );

  const approved = useMemo(
    () => actionItems.filter(x => x.status === 'approved'),
    [actionItems]
  );

  const source = view === 'pending' ? pending : approved;

  const rows = useMemo(() => {
    const filtered = source.filter(item =>
      campaignFilter === 'all' || item.campaignId === campaignFilter
    );

    return [...filtered].sort((a, b) => {
      if (view === 'pending') {
        return campaignActionCreatedMsCC(a) - campaignActionCreatedMsCC(b);
      }
      return campaignActionApprovedMsCC(b) - campaignActionApprovedMsCC(a);
    });
  }, [source, campaignFilter, view]);

  const approve = async item => {
    if (!item?.id || busyId) return;
    const ok = window.confirm(
      `¿Marcar esta acción como APROBADA?\n\n${item.actionText}\n\n` +
      `Se quitará de Pendientes y quedará guardada en Historial aprobadas.`
    );
    if (!ok) return;

    setBusyId(item.id);
    setMessage('');

    try {
      await updateDoc(doc(db, COLLECTIONS.actionItems, item.id), {
        status: 'approved',
        approvedDate: todayColombiaCC(),
        approvedClientAtMs: Date.now(),
        approvedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      setMessage('Acción aprobada. Se movió al historial.');
    } catch (error) {
      console.error('Lectura de Campañas · aprobar acción', error);
      setMessage(error?.message || 'No fue posible aprobar la acción.');
    } finally {
      setBusyId('');
      window.setTimeout(() => setMessage(''), 3500);
    }
  };

  const pendingCampaigns = useMemo(() => {
    const ids = new Set(actionItems.map(x => x.campaignId).filter(Boolean));
    return campaigns
      .filter(c => ids.has(c.id))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [actionItems, campaigns]);

  return (
    <div className="cc-module-view cc-action-board space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center">
                <ListChecks size={17}/>
              </div>
              <div>
                <p className="text-[10px] sm:text-xs font-black uppercase text-zinc-900">
                  Cuadro de acciones
                </p>
                <p className="text-[8px] sm:text-[9px] text-slate-500 mt-0.5 leading-relaxed">
                  Agenda operativa de campañas. Las pendientes permanecen visibles hasta que las apruebes.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 w-full sm:w-auto">
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 min-w-[120px]">
              <p className="text-[7px] font-black uppercase text-amber-700">Pendientes</p>
              <p className="text-lg font-black text-amber-800 mt-1 tabular-nums">{pending.length}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 min-w-[120px]">
              <p className="text-[7px] font-black uppercase text-emerald-700">Aprobadas</p>
              <p className="text-lg font-black text-emerald-800 mt-1 tabular-nums">{approved.length}</p>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-col lg:flex-row lg:items-center gap-2">
          <div className="flex bg-slate-100 p-1 rounded-xl w-full sm:w-fit">
            <button
              type="button"
              onClick={() => setView('pending')}
              className={`flex-1 sm:flex-none px-3 py-2 rounded-lg text-[8px] font-black uppercase ${
                view === 'pending' ? 'bg-amber-500 text-zinc-950 shadow-sm' : 'text-slate-500'
              }`}
            >
              Pendientes · {pending.length}
            </button>
            <button
              type="button"
              onClick={() => setView('approved')}
              className={`flex-1 sm:flex-none px-3 py-2 rounded-lg text-[8px] font-black uppercase ${
                view === 'approved' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-500'
              }`}
            >
              Historial aprobadas
            </button>
          </div>

          <select
            value={campaignFilter}
            onChange={e => setCampaignFilter(e.target.value)}
            className="w-full lg:w-auto lg:min-w-[260px] rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[9px] font-bold text-zinc-700 outline-none"
          >
            <option value="all">Todas las campañas</option>
            {pendingCampaigns.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {message ? (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[8px] font-black text-emerald-700">
            {message}
          </div>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <CheckCircle2 size={28} className="mx-auto text-emerald-500"/>
          <p className="text-[10px] font-black uppercase text-zinc-900 mt-3">
            {view === 'pending' ? 'No hay acciones pendientes' : 'No hay acciones aprobadas'}
          </p>
          <p className="text-[8px] text-slate-500 mt-1">
            {view === 'pending'
              ? 'Las acciones que registres desde la revisión de una campaña aparecerán aquí.'
              : 'Las acciones aprobadas permanecerán aquí como historial.'
            }
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {rows.map(item => {
            const campaign = campaigns.find(c => c.id === item.campaignId);
            const product = products.find(p => p.id === item.productId);
            const ad =
              ads.find(a => a.id === item.adId) ||
              (item.adId ? { name: item.adNameSnapshot || 'Anuncio relacionado' } : null);

            return (
              <div
                key={item.id}
                className={`rounded-2xl border-2 bg-white p-3 sm:p-4 ${
                  view === 'pending'
                    ? 'border-amber-200'
                    : 'border-emerald-200'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`px-2 py-1 rounded-full text-[7px] font-black uppercase ${
                        view === 'pending'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {view === 'pending' ? 'Pendiente' : 'Aprobada'}
                      </span>

                      {ad ? (
                        <span className="max-w-full px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 text-[7px] font-black uppercase">
                          {ad.name}
                        </span>
                      ) : null}
                    </div>

                    <p className="text-[11px] sm:text-xs font-black text-zinc-900 mt-2 leading-relaxed break-words">
                      {item.actionText}
                    </p>

                    {item.note ? (
                      <p className="text-[8px] sm:text-[9px] text-slate-600 mt-1.5 leading-relaxed">
                        {item.note}
                      </p>
                    ) : null}
                  </div>

                  <div className="shrink-0 text-left sm:text-right">
                    <p className="text-[7px] font-black uppercase text-slate-400">Registrada</p>
                    <p className="text-[8px] font-bold text-slate-600 mt-1">
                      {decisionDateTimeLabelCC(item)}
                    </p>
                  </div>
                </div>

                <div className="mt-3 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <p className="text-[6.5px] font-black uppercase text-slate-400">Campaña</p>
                      <p className="text-[8px] font-bold text-zinc-800 mt-1 break-words">
                        {campaign?.name || item.campaignNameSnapshot || 'Campaña'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[6.5px] font-black uppercase text-slate-400">Producto</p>
                      <p className="text-[8px] font-bold text-zinc-800 mt-1 break-words">
                        {product?.name || item.productNameSnapshot || '—'}
                      </p>
                    </div>
                  </div>
                </div>

                {view === 'pending' ? (
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => approve(item)}
                    className="w-full mt-3 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 text-white px-3 py-2.5 text-[9px] font-black uppercase disabled:opacity-50"
                  >
                    <CheckCircle2 size={14}/>
                    {busyId === item.id ? 'Aprobando...' : 'Aprobar y quitar de pendientes'}
                  </button>
                ) : (
                  <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-emerald-50 px-3 py-2">
                    <span className="text-[7px] font-black uppercase text-emerald-700">
                      Acción cerrada
                    </span>
                    <span className="text-[7px] text-emerald-700">
                      {item.approvedDate ? formatIsoDateCC(item.approvedDate) : 'Aprobada'}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


function GlobalDailyCloseCC({ dailyCampaigns = [], campaigns = [] }) {
  const today = todayColombiaCC();

  const availableDates = useMemo(() => {
    return [...new Set(
      (dailyCampaigns || [])
        .map(r => String(r?.date || ''))
        .filter(date => date && date < today)
    )].sort((a, b) => String(b).localeCompare(String(a)));
  }, [dailyCampaigns, today]);

  const latestClosedDate = availableDates[0] || lastCompleteColombiaDateCC();
  const [selectedDate, setSelectedDate] = useState(latestClosedDate);

  useEffect(() => {
    if (!selectedDate || !availableDates.includes(selectedDate)) {
      setSelectedDate(latestClosedDate);
    }
  }, [latestClosedDate, availableDates, selectedDate]);

  const selectedRecords = useMemo(
    () => (dailyCampaigns || []).filter(r => String(r?.date || '') === String(selectedDate || '')),
    [dailyCampaigns, selectedDate]
  );

  const totalSpend = useMemo(
    () => selectedRecords.reduce((sum, r) => sum + toNumber(r?.spend), 0),
    [selectedRecords]
  );

  const totalPurchases = useMemo(
    () => selectedRecords.reduce((sum, r) => sum + toNumber(r?.purchases), 0),
    [selectedRecords]
  );

  const globalCpa = calcCpa(totalSpend, totalPurchases);

  const campaignCount = useMemo(
    () => new Set(selectedRecords.map(r => r?.campaignId).filter(Boolean)).size,
    [selectedRecords]
  );

  const hasData = selectedRecords.length > 0;

  return (
    <div className="cc-module-view cc-global-close space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
                <Calendar size={16}/>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] sm:text-xs font-black uppercase text-zinc-900">
                  Cierre global por día
                </p>
                <p className="text-[8px] sm:text-[9px] text-slate-500 mt-0.5 leading-relaxed">
                  Selecciona una fecha para consultar el rendimiento consolidado de la tienda.
                </p>
              </div>
            </div>
          </div>

          <div className="w-full md:w-auto">
            <label className="block text-[7px] font-black uppercase text-slate-400 mb-1.5">
              Fecha del cierre
            </label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={selectedDate || ''}
                max={lastCompleteColombiaDateCC()}
                onChange={e => setSelectedDate(e.target.value)}
                className="w-full md:w-[185px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[10px] font-black text-zinc-800 outline-none focus:border-blue-400"
              />
              {selectedDate !== latestClosedDate ? (
                <button
                  type="button"
                  onClick={() => setSelectedDate(latestClosedDate)}
                  className="shrink-0 px-3 py-2.5 rounded-xl bg-zinc-950 text-white text-[8px] font-black uppercase"
                >
                  Último cierre
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 sm:px-4 sm:py-3.5 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-5">
          <div className="lg:w-[230px] lg:shrink-0">
            <p className="text-[8px] sm:text-[9px] font-black uppercase tracking-wide text-slate-500">
              Cierre global · {selectedDate ? formatIsoDateCC(selectedDate) : '—'}
            </p>
            <p className="text-[7px] sm:text-[8px] text-slate-400 mt-1 leading-relaxed">
              {hasData
                ? `${campaignCount} campaña${campaignCount === 1 ? '' : 's'} con cierre registrado en esta fecha.`
                : 'No hay cierres registrados para esta fecha.'
              }
            </p>
          </div>

          <div className="cc-grid-close flex-1 min-w-0">
            <div className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5">
              <p className="text-[6.5px] sm:text-[7px] font-black uppercase text-slate-400">
                Gasto total
              </p>
              <p
                className="mt-1.5 font-black tabular-nums text-zinc-900 whitespace-nowrap"
                style={{ fontSize: 'clamp(18px, 1.1vw, 22px)', lineHeight: 1.15 }}
              >
                {hasData ? fmtMoney(totalSpend) : '—'}
              </p>
              <p className="text-[6.5px] sm:text-[7px] text-slate-400 mt-1">
                Todas las campañas del día
              </p>
            </div>

            <div className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5">
              <p className="text-[6.5px] sm:text-[7px] font-black uppercase text-slate-400">
                Ventas totales
              </p>
              <p
                className="mt-1.5 font-black tabular-nums text-zinc-900 whitespace-nowrap"
                style={{ fontSize: 'clamp(18px, 1.1vw, 22px)', lineHeight: 1.15 }}
              >
                {hasData ? fmtNum(totalPurchases, 0) : '—'}
              </p>
              <p className="text-[6.5px] sm:text-[7px] text-slate-400 mt-1">
                Compras registradas ese día
              </p>
            </div>

            <div className="min-w-0 rounded-xl border border-blue-100 bg-blue-50/55 px-3 py-2.5">
              <p className="text-[6.5px] sm:text-[7px] font-black uppercase text-blue-600">
                CPA ponderado global
              </p>
              <p
                className="mt-1.5 font-black tabular-nums text-zinc-900 whitespace-nowrap"
                style={{ fontSize: 'clamp(18px, 1.1vw, 22px)', lineHeight: 1.15 }}
              >
                {hasData && globalCpa !== null ? fmtMoney(globalCpa) : '—'}
              </p>
              <p className="text-[6.5px] sm:text-[7px] text-slate-500 mt-1">
                Gasto total ÷ ventas totales
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
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
  const [actionItems, setActionItems] = useState([]);
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
    listen(COLLECTIONS.actionItems, setActionItems);
    return () => listeners.forEach(unsub => unsub());
  }, [ownerUid]);

  const activeProducts = useMemo(() => products.filter(p => p.active !== false), [products]);
  const activeCampaigns = useMemo(() => campaigns.filter(c => !c.archived), [campaigns]);
  const activeAds = useMemo(() => ads.filter(a => a.deleted !== true && a.active !== false && campaigns.some(c => c.id === a.campaignId && c.active !== false && !c.archived) && products.some(p => p.id === a.productId && p.active !== false)), [ads, campaigns, products]);

  const latestDate = todayColombiaCC();

  const attentionRows = useMemo(() => {
    const rows = [];
    for (const ad of ads.filter(a => a.deleted !== true && a.active !== false)) {
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
  const pendingActionItems = useMemo(
    () => actionItems.filter(x => x.status !== 'approved'),
    [actionItems]
  );

  useEffect(() => {
    if (!selectedCampaignId && activeCampaigns.length) setSelectedCampaignId(activeCampaigns[0].id);
  }, [activeCampaigns, selectedCampaignId]);

  if (loading) return <div className="py-20 text-center text-slate-400 font-black uppercase text-xs">Cargando Lectura de Campañas...</div>;

  const tabs = [
    { id: 'dashboard', label: 'Resumen', icon: BarChart3 },
    { id: 'globalClose', label: 'Cierre global', icon: Calendar },
    { id: 'campaigns', label: 'Campañas', icon: Layers },
    { id: 'register', label: 'Registro diario', icon: CalendarDays },
    { id: 'actions', label: 'Acciones', icon: ListChecks, count: pendingActionItems.length },
    { id: 'reports', label: 'Informe IA', icon: FileText }
  ];

  return (
    <div className="space-y-5 anim-fade min-w-0 cc-mobile-readable cc-ui-shell">
      <style>{`
        /*
         * LECTURA DE CAMPAÑAS · SISTEMA VISUAL RESPONSIVE
         * Mantiene la lógica intacta y normaliza la legibilidad en móvil, tablet y PC.
         */

        .cc-ui-shell {
          --cc-body: 13px;
          --cc-small: 11px;
          --cc-label: 10px;
          --cc-control: 12px;
          --cc-value: 20px;
        }

        .cc-ui-shell,
        .cc-ui-shell * {
          box-sizing: border-box;
        }

        .cc-ui-shell p,
        .cc-ui-shell span,
        .cc-ui-shell label,
        .cc-ui-shell button,
        .cc-ui-shell th,
        .cc-ui-shell td {
          overflow-wrap: break-word;
          word-break: normal;
          hyphens: none;
        }

        /* Controles coherentes en todos los módulos. */
        .cc-ui-shell input,
        .cc-ui-shell select,
        .cc-ui-shell textarea {
          line-height: 1.35 !important;
        }

        .cc-ui-shell button {
          line-height: 1.25;
        }

        /* MÓVIL */
        @media (max-width: 639px) {
          .cc-ui-shell [class*="text-[5.5px]"],
          .cc-ui-shell [class*="text-[6px]"],
          .cc-ui-shell [class*="text-[6.5px]"],
          .cc-ui-shell [class*="text-[7px]"] {
            font-size: 9px !important;
            line-height: 1.35 !important;
          }

          .cc-ui-shell [class*="text-[7.5px]"],
          .cc-ui-shell [class*="text-[8px]"],
          .cc-ui-shell [class*="text-[8.5px]"] {
            font-size: 10px !important;
            line-height: 1.38 !important;
          }

          .cc-ui-shell [class*="text-[9px]"],
          .cc-ui-shell [class*="text-[9.5px]"] {
            font-size: 11px !important;
            line-height: 1.4 !important;
          }

          .cc-ui-shell [class*="text-[10px]"] {
            font-size: 12px !important;
            line-height: 1.42 !important;
          }

          .cc-ui-shell [class*="text-[11px]"] {
            font-size: 13px !important;
            line-height: 1.42 !important;
          }

          .cc-ui-shell [class*="text-[12px]"],
          .cc-ui-shell [class*="text-[13px]"] {
            font-size: 14px !important;
            line-height: 1.42 !important;
          }

          .cc-ui-shell button[class*="text-["] {
            min-height: 40px;
          }

          .cc-ui-shell input,
          .cc-ui-shell select,
          .cc-ui-shell textarea {
            font-size: 13px !important;
            min-height: 42px;
          }
        }

        /* TABLET */
        @media (min-width: 640px) and (max-width: 1023px) {
          .cc-ui-shell [class*="text-[5.5px]"],
          .cc-ui-shell [class*="text-[6px]"],
          .cc-ui-shell [class*="text-[6.5px]"] {
            font-size: 8.5px !important;
            line-height: 1.35 !important;
          }

          .cc-ui-shell [class*="text-[7px]"],
          .cc-ui-shell [class*="text-[7.5px]"] {
            font-size: 9.5px !important;
            line-height: 1.38 !important;
          }

          .cc-ui-shell [class*="text-[8px]"],
          .cc-ui-shell [class*="text-[8.5px]"] {
            font-size: 10px !important;
            line-height: 1.4 !important;
          }

          .cc-ui-shell [class*="text-[9px]"],
          .cc-ui-shell [class*="text-[9.5px]"] {
            font-size: 11px !important;
            line-height: 1.42 !important;
          }

          .cc-ui-shell [class*="text-[10px]"] {
            font-size: 12px !important;
            line-height: 1.42 !important;
          }

          .cc-ui-shell [class*="text-[11px]"] {
            font-size: 13px !important;
            line-height: 1.42 !important;
          }

          .cc-ui-shell [class*="text-[12px]"],
          .cc-ui-shell [class*="text-[13px]"] {
            font-size: 14px !important;
            line-height: 1.42 !important;
          }

          .cc-ui-shell input,
          .cc-ui-shell select,
          .cc-ui-shell textarea {
            font-size: 13px !important;
          }
        }

        /* PC / ESCRITORIO */
        @media (min-width: 1024px) {
          .cc-ui-shell [class*="text-[5.5px]"],
          .cc-ui-shell [class*="text-[6px]"],
          .cc-ui-shell [class*="text-[6.5px]"] {
            font-size: 8.5px !important;
            line-height: 1.32 !important;
          }

          .cc-ui-shell [class*="text-[7px]"],
          .cc-ui-shell [class*="text-[7.5px]"] {
            font-size: 9.5px !important;
            line-height: 1.35 !important;
          }

          .cc-ui-shell [class*="text-[8px]"],
          .cc-ui-shell [class*="text-[8.5px]"] {
            font-size: 10.5px !important;
            line-height: 1.38 !important;
          }

          .cc-ui-shell [class*="text-[9px]"],
          .cc-ui-shell [class*="text-[9.5px]"] {
            font-size: 11.5px !important;
            line-height: 1.4 !important;
          }

          .cc-ui-shell [class*="text-[10px]"] {
            font-size: 12.5px !important;
            line-height: 1.42 !important;
          }

          .cc-ui-shell [class*="text-[11px]"] {
            font-size: 13.5px !important;
            line-height: 1.42 !important;
          }

          .cc-ui-shell [class*="text-[12px]"] {
            font-size: 14.5px !important;
            line-height: 1.42 !important;
          }

          .cc-ui-shell [class*="text-[13px]"] {
            font-size: 15.5px !important;
            line-height: 1.42 !important;
          }

          .cc-ui-shell button[class*="text-["] {
            min-height: 38px;
          }

          .cc-ui-shell input,
          .cc-ui-shell select,
          .cc-ui-shell textarea {
            font-size: 14px !important;
          }

          /* Más aire horizontal en tarjetas de escritorio. */
          .cc-ui-shell .cc-pro-card {
            padding: 16px !important;
          }
        }

        /* SISTEMA VISUAL PROFESIONAL · TODO EL MÓDULO */
        .cc-ui-shell { color: #0f172a; }

        .cc-ui-shell .cc-module-view,
        .cc-ui-shell .cc-reading-view,
        .cc-ui-shell .cc-daily-editor { min-width: 0; }

        .cc-ui-shell .cc-section-card {
          border-width: 1px !important;
          border-radius: 20px !important;
          box-shadow: 0 6px 20px rgba(15, 23, 42, 0.045) !important;
        }

        .cc-ui-shell .cc-mini-card,
        .cc-ui-shell .cc-metric-card {
          border-color: #e2e8f0;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.025);
        }

        .cc-ui-shell .cc-mini-card .cc-value,
        .cc-ui-shell .cc-metric-card .cc-value,
        .cc-ui-shell .cc-scale-card .cc-value {
          overflow-wrap: normal !important;
          word-break: normal !important;
          white-space: nowrap !important;
        }

        .cc-ui-shell .cc-diagnosis-card {
          border-width: 1px !important;
          border-radius: 22px !important;
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05) !important;
        }

        .cc-ui-shell .cc-scale-card { border-width: 1px !important; }

        .cc-ui-shell input:not([type="checkbox"]):not([type="file"]),
        .cc-ui-shell select,
        .cc-ui-shell textarea {
          border: 1px solid #dbe3ee !important;
          background-color: #ffffff !important;
          border-radius: 12px !important;
          color: #0f172a;
          box-shadow: none !important;
          transition: border-color .16s ease, box-shadow .16s ease, background-color .16s ease;
        }

        .cc-ui-shell input:not([type="checkbox"]):not([type="file"]):focus,
        .cc-ui-shell select:focus,
        .cc-ui-shell textarea:focus {
          border-color: #94a3b8 !important;
          box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.12) !important;
          outline: none !important;
        }

        .cc-ui-shell input:disabled,
        .cc-ui-shell select:disabled,
        .cc-ui-shell textarea:disabled {
          background-color: #f8fafc !important;
          color: #64748b;
        }

        .cc-ui-shell button {
          transition: transform .12s ease, box-shadow .12s ease, background-color .12s ease, border-color .12s ease;
        }

        .cc-ui-shell button:not(:disabled):active { transform: translateY(1px); }

        .cc-ui-shell table {
          border-collapse: separate;
          border-spacing: 0;
        }

        .cc-ui-shell table th {
          font-weight: 800;
          letter-spacing: .025em;
          line-height: 1.25;
          vertical-align: middle;
        }

        .cc-ui-shell table td {
          vertical-align: middle;
          line-height: 1.35;
        }

        .cc-ui-shell .cc-data-table thead th {
          background: #f8fafc;
          border-bottom: 1px solid #e2e8f0;
          padding-top: 11px;
          padding-bottom: 11px;
        }

        .cc-ui-shell .cc-data-table tbody td {
          padding-top: 11px;
          padding-bottom: 11px;
          border-bottom: 1px solid rgba(226, 232, 240, .85);
        }

        .cc-ui-shell .cc-data-table tbody tr:last-child td { border-bottom: 0; }

        /* Anchos de tabla para evitar encabezados y dinero comprimidos */
        .cc-ui-shell .cc-data-table th,
        .cc-ui-shell .cc-data-table td {
          padding-left: 10px;
          padding-right: 10px;
        }

        .cc-ui-shell .cc-data-table th:nth-child(1),
        .cc-ui-shell .cc-data-table td:nth-child(1) { min-width: 150px; }

        .cc-ui-shell .cc-data-table th:nth-child(2),
        .cc-ui-shell .cc-data-table td:nth-child(2) { min-width: 235px; }

        .cc-ui-shell .cc-data-table th:nth-child(3),
        .cc-ui-shell .cc-data-table td:nth-child(3),
        .cc-ui-shell .cc-data-table th:nth-child(4),
        .cc-ui-shell .cc-data-table td:nth-child(4),
        .cc-ui-shell .cc-data-table th:nth-child(5),
        .cc-ui-shell .cc-data-table td:nth-child(5),
        .cc-ui-shell .cc-data-table th:nth-child(6),
        .cc-ui-shell .cc-data-table td:nth-child(6),
        .cc-ui-shell .cc-data-table th:nth-child(7),
        .cc-ui-shell .cc-data-table td:nth-child(7),
        .cc-ui-shell .cc-data-table th:nth-child(8),
        .cc-ui-shell .cc-data-table td:nth-child(8) {
          min-width: 112px;
          white-space: nowrap;
        }

        .cc-ui-shell .cc-data-table th:nth-child(9),
        .cc-ui-shell .cc-data-table td:nth-child(9),
        .cc-ui-shell .cc-data-table th:nth-child(10),
        .cc-ui-shell .cc-data-table td:nth-child(10) {
          min-width: 92px;
          white-space: nowrap;
        }

        .cc-ui-shell .cc-data-table th:nth-child(11),
        .cc-ui-shell .cc-data-table td:nth-child(11) { min-width: 190px; }

        .cc-ui-shell .cc-data-table th:nth-child(12),
        .cc-ui-shell .cc-data-table td:nth-child(12) { min-width: 245px; }

        .cc-ui-shell .cc-data-table th:nth-child(13),
        .cc-ui-shell .cc-data-table td:nth-child(13) { min-width: 235px; }

        .cc-ui-shell .cc-data-table thead th {
          white-space: normal;
          overflow-wrap: normal;
          word-break: normal;
        }

        .cc-ui-shell .cc-manager-ad {
          box-shadow: 0 2px 8px rgba(15, 23, 42, .025);
        }

        .cc-ui-shell .cc-metric-form > div { min-width: 0; }
        .cc-ui-shell .cc-metric-form input { min-height: 40px; }

        /* Grillas por ancho REAL disponible, no por ancho de ventana */
        .cc-ui-shell .cc-grid-kpi,
        .cc-ui-shell .cc-grid-close,
        .cc-ui-shell .cc-grid-metrics,
        .cc-ui-shell .cc-grid-diagnostic,
        .cc-ui-shell .cc-grid-mini,
        .cc-ui-shell .cc-grid-form,
        .cc-ui-shell .cc-grid-weekday {
          display: grid !important;
          align-items: stretch;
        }

        .cc-ui-shell .cc-grid-kpi {
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)) !important;
          gap: 12px !important;
        }

        .cc-ui-shell .cc-grid-close {
          grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)) !important;
          gap: 10px !important;
        }

        .cc-ui-shell .cc-grid-metrics {
          grid-template-columns: repeat(auto-fit, minmax(185px, 1fr)) !important;
          gap: 12px !important;
        }

        .cc-ui-shell .cc-grid-diagnostic {
          grid-template-columns: repeat(auto-fit, minmax(235px, 1fr)) !important;
          gap: 12px !important;
        }

        .cc-ui-shell .cc-grid-mini {
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)) !important;
          gap: 10px !important;
        }

        .cc-ui-shell .cc-grid-form {
          grid-template-columns: repeat(auto-fit, minmax(135px, 1fr)) !important;
          gap: 10px !important;
        }

        .cc-ui-shell .cc-grid-weekday {
          grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)) !important;
          gap: 10px !important;
        }

        .cc-ui-shell .cc-grid-metrics > *,
        .cc-ui-shell .cc-grid-kpi > *,
        .cc-ui-shell .cc-grid-close > *,
        .cc-ui-shell .cc-grid-diagnostic > *,
        .cc-ui-shell .cc-grid-mini > *,
        .cc-ui-shell .cc-grid-weekday > * {
          min-width: 0;
        }

        /* Métricas: compactas, proporcionadas y sin columnas kilométricas */
        .cc-ui-shell .cc-metric-card {
          min-height: 164px !important;
          max-width: none;
        }

        .cc-ui-shell .cc-metric-card .cc-value {
          font-size: clamp(17px, 1.1vw, 22px) !important;
        }

        .cc-ui-shell .cc-mini-card .cc-value {
          font-size: clamp(16px, 1vw, 20px) !important;
        }

        @media (min-width: 1024px) {
          .cc-ui-shell .cc-module-view { font-size: 12px; }
          .cc-ui-shell .cc-section-card { padding: 18px !important; }
          .cc-ui-shell .cc-metric-card { min-height: 176px; }
        }

        @media (max-width: 639px) {
          .cc-ui-shell .cc-section-card {
            border-radius: 16px !important;
            padding: 14px !important;
          }
          .cc-ui-shell .cc-metric-card,
          .cc-ui-shell .cc-mini-card { border-radius: 14px !important; }
          .cc-ui-shell .cc-metric-card { min-height: auto; }
          .cc-ui-shell .cc-data-table tbody td,
          .cc-ui-shell .cc-data-table thead th {
            padding-top: 9px;
            padding-bottom: 9px;
          }

          .cc-ui-shell .cc-grid-kpi,
          .cc-ui-shell .cc-grid-close,
          .cc-ui-shell .cc-grid-metrics,
          .cc-ui-shell .cc-grid-diagnostic,
          .cc-ui-shell .cc-grid-mini,
          .cc-ui-shell .cc-grid-form,
          .cc-ui-shell .cc-grid-weekday {
            grid-template-columns: 1fr !important;
          }

          .cc-ui-shell .cc-metric-card {
            min-height: auto !important;
          }
        }

        @media (min-width: 480px) and (max-width: 639px) {
          .cc-ui-shell .cc-grid-kpi,
          .cc-ui-shell .cc-grid-close,
          .cc-ui-shell .cc-grid-mini,
          .cc-ui-shell .cc-grid-form,
          .cc-ui-shell .cc-grid-weekday {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }

          .cc-ui-shell .cc-grid-metrics {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
        }
      `}</style>
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <div className="shrink-0 w-10 h-10 rounded-2xl bg-emerald-500 flex items-center justify-center text-zinc-950"><Activity size={20} /></div>
            <div className="min-w-0">
              <h2 className="text-xl sm:text-2xl md:text-3xl font-black italic uppercase tracking-tighter text-zinc-900 break-words">LECTURA DE CAMPAÑAS</h2>
              <p className="text-[8px] sm:text-[9px] md:text-[10px] text-slate-400 font-black uppercase tracking-wider sm:tracking-widest leading-relaxed">
                Diagnóstico Meta Ads · 3D decide · entiende qué pasa en segundos
              </p>
            </div>
          </div>
        </div>
        <div className="max-w-full overflow-x-auto pb-1 xl:pb-0">
          <div className="flex w-max min-w-full xl:min-w-0 bg-zinc-950 p-1 rounded-2xl">
            {tabs.map(t => <button key={t.id} onClick={() => setSubTab(t.id)} className={`shrink-0 flex items-center justify-center gap-2 px-3 sm:px-3.5 md:px-4.5 lg:px-5 py-2.5 lg:py-3 rounded-xl text-[8px] sm:text-[9px] font-black uppercase whitespace-nowrap ${subTab === t.id ? 'bg-emerald-500 text-zinc-950' : 'text-zinc-400 hover:text-white'}`}><t.icon size={13} />{t.label}{t.count > 0 ? <span className={`min-w-[18px] h-[18px] px-1 rounded-full inline-flex items-center justify-center text-[7px] ${subTab === t.id ? 'bg-zinc-950 text-white' : 'bg-amber-500 text-zinc-950'}`}>{t.count}</span> : null}</button>)}
          </div>
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
          actionItems={actionItems}
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

      {subTab === 'globalClose' && (
        <GlobalDailyCloseCC
          dailyCampaigns={dailyCampaigns}
          campaigns={campaigns}
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
          decisions={decisions}
        />
      )}

      {subTab === 'actions' && (
        <CampaignActionBoardCC
          ownerUid={ownerUid}
          actionItems={actionItems}
          campaigns={campaigns}
          products={products}
          ads={ads}
        />
      )}

      {subTab === 'reports' && (
        <CampaignReportCenter
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
  const data = history.map(r => ({ date:r.date, cpa:calcCpa(r.spend,r.purchases), spend:toNumber(r.spend), purchases:toNumber(r.purchases) }));
  const valid = data.map(x=>x.cpa).filter(x=>x !== null && x > 0);
  const chartMax = Math.max(maxCpa*1.35, ...(valid.length?valid.map(v=>v*1.1):[maxCpa]));
  const W=620,H=180,px=16,py=15,bottom=28;
  const iw=W-px*2, ih=H-py-bottom;
  const x=i=>data.length<=1?W/2:px+i*iw/(data.length-1);
  const y=v=>py+ih-(Math.min(Math.max(v,0),chartMax)/chartMax)*ih;

  const segments = [];
  let segment = [];
  data.forEach((d,i) => {
    if (d.cpa === null) {
      if (segment.length) segments.push(segment);
      segment = [];
    } else {
      segment.push(`${x(i)},${y(d.cpa)}`);
    }
  });
  if (segment.length) segments.push(segment);

  return <div>
    <div className="rounded-2xl border bg-slate-50 p-2 overflow-hidden">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[180px]" preserveAspectRatio="none">
        <line x1={px} x2={W-px} y1={y(maxCpa)} y2={y(maxCpa)} stroke="#ef4444" strokeWidth="1.5" strokeDasharray="6 5"/>
        <line x1={px} x2={W-px} y1={y(target)} y2={y(target)} stroke="#10b981" strokeWidth="1.5" strokeDasharray="6 5"/>
        {segments.map((points,i)=><polyline key={i} points={points.join(' ')} fill="none" stroke="#2563eb" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round"/>)}
        {data.map((d,i)=>d.cpa !== null
          ? <circle key={`${d.date}-${i}`} cx={x(i)} cy={y(d.cpa)} r="4" fill="#2563eb"/>
          : <circle key={`${d.date}-${i}`} cx={x(i)} cy={y(0)} r="3" fill="#94a3b8"/>
        )}
      </svg>
    </div>
    <div className="flex flex-wrap gap-4 text-[8px] font-black text-slate-500 mt-2">
      <span>🔴 CPA máximo {fmtMoney(maxCpa)}</span>
      <span>🟢 CPA operativo {fmtMoney(target)}</span>
      <span>🔵 CPA diario</span>
      <span>⚪ Sin compra = CPA no calculable</span>
    </div>
  </div>;
}

function CampaignDashboard({
  ownerUid, products, campaigns, ads, dailyCampaigns, dailyAds, budgetChanges, decisions, recommendations, actionItems,
  attentionRows, activeProducts, activeCampaigns, activeAds, latestDate,
  period, setPeriod, selectedCampaign, setSelectedCampaignId, setSubTab
}) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [drawerCampaignId, setDrawerCampaignId] = useState('');
  const [drawerPeriod, setDrawerPeriod] = useState(period || 'last');
  const [auditHighlightBusyId, setAuditHighlightBusyId] = useState('');

  const activeCampaignList = activeCampaigns.filter(c => !c.archived);

  const toggleCampaignAuditHighlight = async (event, campaign) => {
    event?.stopPropagation?.();
    if (!campaign?.id || auditHighlightBusyId) return;

    const next = campaign.dashboardAuditedHighlight !== true;
    setAuditHighlightBusyId(campaign.id);

    try {
      await updateDoc(doc(db, COLLECTIONS.campaigns, campaign.id), {
        dashboardAuditedHighlight: next,
        dashboardAuditedHighlightDate: next ? todayColombiaCC() : null,
        dashboardAuditedHighlightAt: next ? serverTimestamp() : null,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Lectura de Campañas · resaltador de auditoría', error);
      window.alert(error?.message || 'No fue posible actualizar el resaltador de auditoría.');
    } finally {
      setAuditHighlightBusyId('');
    }
  };

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
    const campaignAds = ads.filter(a => a.campaignId === c.id && a.deleted !== true && a.active !== false);
    const adDiags = campaignAds.map(ad => diagnoseAd(
      dailyAds.filter(r=>r.adId===ad.id), product, ad, 'last', c
    )).filter(d => d.scale3d?.days > 0);

    // Dashboard operativo: SIEMPRE 3D. El 'last' de arriba solo alimenta
    // la lectura analítica del último día, no estas decisiones.
    const hasCritical = adDiags.some(d=>d.operational3dPriority==='critical');
    const hasAlert = adDiags.some(d=>d.operational3dPriority==='alert');
    const hasNoDelivery = adDiags.some(d=>d.metaDelivery3d?.isNoDelivery);
    const hasLimitedDelivery = adDiags.some(d=>d.metaDelivery3d?.isLimited);
    const hasScalable = adDiags.some(d=>d.canScale);
    const cpa = stats3.cpa;
    const cpaObservation3d = buildCpaObservation3D(stats3, split3.previousStats, maxCpa);

    let state='Sin 3D suficiente', tone='attention', diagnosis='Pendiente 3D', action='Registrar histórico';
    if (stats3.days > 0) {
      if (stats3.spend > 0 && stats3.purchases <= 0) {
        if (stats3.spend >= maxCpa) {
          state='Crítico'; tone='critical';
          diagnosis='Sin compras · gasto alcanzó CPA máximo';
          action='No escalar · optimizar';
        } else if (stats3.spend >= maxCpa * 0.5) {
          state='Alerta'; tone='alert';
          diagnosis='Sin compras · vigilar 3D';
          action='No escalar · observar';
        } else {
          state='Testing'; tone='attention';
          diagnosis='Sin compras aún · CPA no calculable';
          action='Mantener test';
        }
      } else if (cpa > maxCpa) {
        if (delta3 !== null && delta3 <= 0) {
          state='Alerta'; tone='alert';
          diagnosis='CPA fuera del objetivo · recuperándose';
          action='No escalar · observar';
        } else if (delta3 !== null && delta3 > 15) {
          state='Crítico'; tone='critical';
          diagnosis='CPA fuera del objetivo · deteriorándose';
          action='No escalar · optimizar';
        } else {
          state='Alerta'; tone='alert';
          diagnosis='CPA fuera del objetivo';
          action='No escalar · optimizar';
        }
      } else if (hasCritical) {
        state='Crítico'; tone='critical';
        diagnosis='Anuncio crítico en 3D';
        action='Optimizar / no escalar';
      } else if (hasNoDelivery) {
        state='Alerta'; tone='alert';
        diagnosis='Meta no entrega a uno o más anuncios';
        action='Revisar distribución · no juzgar rendimiento';
      } else if (hasLimitedDelivery) {
        state='Alerta'; tone='alert';
        diagnosis='Entrega limitada por Meta';
        action='Vigilar distribución';
      } else if (hasAlert) {
        state='Alerta'; tone='alert';
        diagnosis='Señal operativa 3D';
        action='Revisar diagnóstico 3D';
      } else if (hasScalable && cpa <= maxCpa*0.8) {
        state='Escalable'; tone='normal';
        diagnosis='3D estable/mejorando + margen';
        action='Escalar +20%';
      } else {
        state='Mantener'; tone='attention';
        diagnosis='Rentable 3D / observar';
        action='Mantener';
      }
    }

    const creativeHealth = hasCritical ? 'Reemplazar creativo'
      : hasAlert ? 'Vigilar señales 3D'
      : 'Creativo sano 3D';

    return {
      campaign:c, product, todayRecord, lastComplete, lastStats, stats3, stats7, delta3, delta7,
      maxCpa, state, tone, diagnosis, action, creativeHealth, cpaObservation3d,
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
    <div className="cc-module-view cc-dashboard space-y-5">
      {/* TOPBAR VALIDADO */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl md:text-2xl font-black uppercase tracking-tight">Resumen de campañas</h3>
          <p className="text-[9px] md:text-[10px] text-slate-400 font-semibold mt-1">Control diario, variaciones, acciones recomendadas y techo rentable por producto</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={()=>setSubTab('register')} className="bg-white border px-4 py-2 rounded-xl text-[9px] font-black uppercase">+ Registrar día</button>
          <button onClick={()=>setSubTab('campaigns')} className="bg-zinc-950 text-white px-4 py-2 rounded-xl text-[9px] font-black uppercase">+ Nuevo producto</button>
        </div>
      </div>

      {/* KPIs · RESUMEN OPERATIVO */}

      <div className="cc-grid-kpi">
        <MiniCard label="Productos activos" value={activeProducts.length} />
        <MiniCard label="Escalables" value={scalableCount} tone={scalableCount?'good':'default'} />
        <MiniCard label="Mantener" value={maintainCount} />
        <MiniCard label="En alerta" value={alertCount} />
        <MiniCard label="Críticos" value={criticalCount} tone={criticalCount?'bad':'default'} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 sm:px-4 sm:py-3.5 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-5">
          <div className="lg:w-[230px] lg:shrink-0">
            <p className="text-[8px] sm:text-[9px] font-black uppercase tracking-wide text-slate-500">
              Último cierre consolidado
            </p>
            <p className="text-[7px] sm:text-[8px] text-slate-400 mt-1 leading-relaxed">
              Resultado conjunto de todas las campañas activas usando el último cierre completo disponible de cada campaña.
            </p>
          </div>

          <div className="cc-grid-close flex-1 min-w-0">
            <div className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5">
              <p className="text-[6.5px] sm:text-[7px] font-black uppercase text-slate-400">
                Gasto total
              </p>
              <p
                className="mt-1.5 font-black tabular-nums text-zinc-900 whitespace-nowrap"
                style={{ fontSize: 'clamp(18px, 1.1vw, 22px)', lineHeight: 1.15 }}
              >
                {fmtMoney(totalSpend)}
              </p>
              <p className="text-[6.5px] sm:text-[7px] text-slate-400 mt-1">
                Todas las campañas
              </p>
            </div>

            <div className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5">
              <p className="text-[6.5px] sm:text-[7px] font-black uppercase text-slate-400">
                Ventas totales
              </p>
              <p
                className="mt-1.5 font-black tabular-nums text-zinc-900 whitespace-nowrap"
                style={{ fontSize: 'clamp(18px, 1.1vw, 22px)', lineHeight: 1.15 }}
              >
                {fmtNum(totalPurchases, 0)}
              </p>
              <p className="text-[6.5px] sm:text-[7px] text-slate-400 mt-1">
                Compras del último cierre
              </p>
            </div>

            <div className="min-w-0 rounded-xl border border-blue-100 bg-blue-50/55 px-3 py-2.5">
              <p className="text-[6.5px] sm:text-[7px] font-black uppercase text-blue-600">
                CPA ponderado global
              </p>
              <p
                className="mt-1.5 font-black tabular-nums text-zinc-900 whitespace-nowrap"
                style={{ fontSize: 'clamp(18px, 1.1vw, 22px)', lineHeight: 1.15 }}
              >
                {globalCpa !== null ? fmtMoney(globalCpa) : '—'}
              </p>
              <p className="text-[6.5px] sm:text-[7px] text-slate-500 mt-1">
                Gasto total ÷ ventas totales
              </p>
            </div>
          </div>
        </div>
      </div>

      <SectionCard className="border-dashed" accent="#2563eb" soft="#eff6ff">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <p className="text-[9px] font-black uppercase text-blue-700">Hoy · monitor provisional intradía</p>
            <p className="text-[8px] text-slate-500 mt-1">Solo informativo. Estos datos NO participan en diagnósticos, alertas, fatiga, guardrails ni decisiones de escala.</p>
          </div>
          <div className="cc-grid-kpi min-w-full lg:min-w-[440px]">
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
        <div className="px-3 py-2.5 border-b border-slate-100 bg-amber-50/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-7 h-7 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
              <Paintbrush size={13}/>
            </span>
            <div className="min-w-0">
              <p className="text-[8px] font-black uppercase text-amber-800">Resaltador de auditoría</p>
              <p className="text-[7px] sm:text-[8px] text-slate-500 mt-0.5 leading-relaxed">
                Usa el pincel para marcar las campañas que ya revisaste. El color permanece guardado hasta que vuelvas a presionarlo.
              </p>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto overscroll-x-contain">
          <table className="cc-data-table w-full min-w-[1800px] text-[9px] lg:text-[10px]">
            <thead className="bg-slate-50">
              <tr className="text-left uppercase text-[7px] lg:text-[8px] text-slate-400">
                <th className="p-3">Estado</th><th>Producto / campaña</th><th>Presupuesto</th><th>CPA último día</th>
                <th>CPA 3D</th><th>Δ vs 3D</th><th>CPA 7D</th><th>Δ 7D</th>
                <th>Compras</th><th>Frecuencia</th><th>Salud tráfico/creativo</th><th>Diagnóstico · 3D</th><th>Acción · 3D</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length===0 ? <tr><td colSpan="13" className="p-8 text-center text-slate-400">No hay campañas que coincidan con el filtro.</td></tr> :
                filteredRows.map(r=>(
                  <tr
                    key={r.campaign.id}
                    onClick={()=>openDrawer(r.campaign.id)}
                    className={`border-t cursor-pointer transition-colors ${
                      r.campaign.dashboardAuditedHighlight === true
                        ? 'bg-amber-100/80 hover:bg-amber-100'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={event => toggleCampaignAuditHighlight(event, r.campaign)}
                          disabled={auditHighlightBusyId === r.campaign.id}
                          title={r.campaign.dashboardAuditedHighlight === true ? 'Quitar resaltado de auditoría' : 'Marcar campaña como auditada'}
                          aria-label={r.campaign.dashboardAuditedHighlight === true ? 'Quitar resaltado de auditoría' : 'Marcar campaña como auditada'}
                          className={`shrink-0 w-8 h-8 rounded-lg border inline-flex items-center justify-center transition-all disabled:opacity-50 ${
                            r.campaign.dashboardAuditedHighlight === true
                              ? 'bg-amber-400 border-amber-500 text-zinc-950 shadow-sm'
                              : 'bg-white border-slate-200 text-slate-400 hover:text-amber-700 hover:border-amber-300 hover:bg-amber-50'
                          }`}
                        >
                          <Paintbrush size={13}/>
                        </button>

                        <span className={`px-2.5 py-1.5 rounded-full font-black text-center leading-tight ${r.state==='Crítico'?'bg-rose-100 text-rose-700':r.state==='Alerta'?'bg-orange-100 text-orange-700':r.state==='Escalable'?'bg-emerald-100 text-emerald-700':'bg-amber-100 text-amber-700'}`}>
                          ● {r.state}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-black leading-tight break-words">{r.product?.name||'Producto'}</p>
                        {r.campaign.dashboardAuditedHighlight === true ? (
                          <span className="px-1.5 py-0.5 rounded-md bg-amber-300/80 text-amber-900 text-[6px] font-black uppercase">
                            Auditada
                          </span>
                        ) : null}
                      </div>
                      <p className="text-[7px] lg:text-[8px] text-slate-400 leading-tight break-words">{r.campaign.name}</p>
                    </td>
                    <td className="font-black whitespace-nowrap">{r.lastComplete?fmtMoney(r.lastComplete.budget):'—'}</td>
                    <td className={`font-black whitespace-nowrap ${r.lastStats.cpa>r.maxCpa?'text-rose-600':''}`}>{r.lastComplete?fmtCpa(r.lastStats.cpa):'—'}</td>
                    <td className="whitespace-nowrap">{r.stats3.purchases>0?fmtCpa(r.stats3.cpa):'—'}</td>
                    <td><span className={`font-black ${metricDirectionClass('cpa', r.delta3)}`}>{r.delta3===null?'—':`${r.delta3>0?'▲':'▼'} ${fmtNum(Math.abs(r.delta3), 2)}%`}</span></td>
                    <td className="whitespace-nowrap">{r.stats7.purchases>0?fmtCpa(r.stats7.cpa):'—'}</td>
                    <td><span className={`font-black ${metricDirectionClass('cpa', r.delta7)}`}>{r.delta7===null?'—':`${r.delta7>0?'▲':'▼'} ${fmtNum(Math.abs(r.delta7), 2)}%`}</span></td>
                    <td className="whitespace-nowrap">{fmtNum(r.purchases, 2)}</td>
                    <td className="whitespace-nowrap">{fmtNum(r.frequency,2)}</td>
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

      {/* DRAWER LATERAL COMO EN LA VERSION VALIDADA */}

      {drawerCampaign && (
        <>
          <div className="fixed inset-0 bg-black/35 z-[80]" onClick={()=>setDrawerCampaignId('')}></div>
          <aside className="fixed right-0 top-0 w-full sm:w-[730px] sm:max-w-[96vw] h-screen bg-white shadow-2xl z-[90] overflow-y-auto p-3 sm:p-4 md:p-6">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
                  <MiniCard label="Gasto" value={fmtMoney(drawerTodayStats.spend)} />
                  <MiniCard label="Compras" value={fmtNum(drawerTodayStats.purchases, 2)} />
                  <MiniCard label="CPA" value={drawerTodayStats.purchases > 0 ? fmtCpa(drawerTodayStats.cpa) : '—'} />
                  <MiniCard label="Frecuencia" value={fmtNum(drawerTodayStats.frequency, 2)} />
                </div>
              ) : (
                <p className="text-[9px] text-slate-500">Sin registro intradía para hoy. El diagnóstico continúa usando el último día completo disponible.</p>
              )}
            </div>

            <div className="cc-grid-kpi mt-4">
              <MiniCard label="CPA último día" value={drawerLastComplete?fmtCpa(drawerCurrent.cpa):'—'} />
              <MiniCard label="CPA 3 días anteriores" value={drawerPrev3.purchases>0?fmtCpa(drawerPrev3.cpa):'—'} />
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
                actionItems={actionItems}
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
  return tone === 'critical'
    ? 'text-rose-600'
    : tone === 'alert'
      ? 'text-orange-600'
      : tone === 'attention'
        ? 'text-amber-600'
        : tone === 'neutral'
          ? 'text-slate-500'
          : 'text-emerald-600';
}

function toneBg(tone) {
  return tone === 'critical'
    ? 'bg-rose-50 border-rose-200'
    : tone === 'alert'
      ? 'bg-orange-50 border-orange-200'
      : tone === 'attention'
        ? 'bg-amber-50 border-amber-200'
        : tone === 'neutral'
          ? 'bg-slate-50 border-slate-200'
          : 'bg-emerald-50 border-emerald-200';
}

function toneBadge(tone) {
  return tone === 'critical'
    ? 'bg-rose-100 text-rose-700'
    : tone === 'alert'
      ? 'bg-orange-100 text-orange-700'
      : tone === 'attention'
        ? 'bg-amber-100 text-amber-700'
        : tone === 'neutral'
          ? 'bg-slate-100 text-slate-600'
          : 'bg-emerald-100 text-emerald-700';
}

function GuardrailPill({ ok, label }) {
  return (
    <span
      className={`inline-flex max-w-full items-center px-2 py-1 rounded-full text-[7px] sm:text-[8px] leading-tight font-black uppercase text-center ${
        ok ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'
      }`}
    >
      {ok ? '✓' : '✕'} {label}
    </span>
  );
}

function buildProductBenchmark(productId, dailyAds, dailyCampaigns, maxCpa, allAds = [], allCampaigns = []) {
  const max = Math.max(1, toNumber(maxCpa));
  const today = todayColombiaCC();

  // Fuente de verdad: Producto -> Campañas -> Anuncios.
  // No dependemos de que los registros históricos tengan productId correctamente grabado.
  const productCampaigns = (allCampaigns || []).filter(c => c.productId === productId);
  const campaignIds = new Set(productCampaigns.map(c => c.id));
  const productAds = (allAds || []).filter(a => campaignIds.has(a.campaignId) || a.productId === productId);
  const adById = new Map(productAds.map(a => [a.id, a]));
  const campaignById = new Map(productCampaigns.map(c => [c.id, c]));

  // Reunimos registros por día completo, respetando ON/OFF.
  const byDate = new Map();

  for (const record of (dailyAds || [])) {
    if (!record?.date || String(record.date) >= today) continue;

    const ad = adById.get(record.adId);
    if (!ad) continue;

    const campaign = campaignById.get(ad.campaignId) || (allCampaigns || []).find(c => c.id === ad.campaignId);
    if (!campaign || campaign.productId !== productId) continue;

    if (!entityActiveOnDate(ad, record.date) || !entityActiveOnDate(campaign, record.date)) continue;

    if (!byDate.has(record.date)) byDate.set(record.date, []);
    byDate.get(record.date).push(record);
  }

  // Si un día tiene registro de campaña pero no registros por anuncio, lo usamos como fallback.
  // Esto permite alimentar históricos creados antes de que el detalle por anuncio estuviera completo.
  for (const record of (dailyCampaigns || [])) {
    if (!record?.date || String(record.date) >= today) continue;
    const campaign = campaignById.get(record.campaignId);
    if (!campaign || !entityActiveOnDate(campaign, record.date)) continue;
    if (!byDate.has(record.date) || byDate.get(record.date).length === 0) {
      byDate.set(record.date, [record]);
    }
  }

  const dailyProduct = [...byDate.entries()]
    .map(([date, records]) => ({ date, ...aggregateRecords(records) }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  // Benchmark operativo principal: últimos 14 días activos completos del producto.
  // El histórico anterior se conserva únicamente para comparar estabilidad.
  const BENCHMARK_WINDOW_DAYS = 14;
  const benchmarkWindow = dailyProduct.slice(-BENCHMARK_WINDOW_DAYS);
  const benchmarkDates = new Set(benchmarkWindow.map(day => day.date));

  const profitableDays = benchmarkWindow.filter(day =>
    toNumber(day.purchases) > 0 &&
    toNumber(day.cpa) > 0 &&
    toNumber(day.cpa) <= max
  );

  const stableProfitableDays = [];

  dailyProduct.forEach((day, idx) => {
    if (!benchmarkDates.has(day.date)) return;
    if (toNumber(day.purchases) <= 0 || toNumber(day.cpa) <= 0 || toNumber(day.cpa) > max) return;

    const previous = dailyProduct.slice(Math.max(0, idx - 3), idx);
    if (previous.length < 3) return;

    const prevSpend = previous.reduce((sum, x) => sum + toNumber(x.spend), 0);
    const weightedPrev = key => {
      if (!previous.length) return 0;
      if (prevSpend > 0) return previous.reduce((sum, x) => sum + toNumber(x[key]) * toNumber(x.spend), 0) / prevSpend;
      return previous.reduce((sum, x) => sum + toNumber(x[key]), 0) / previous.length;
    };

    const previousStats = {
      cpa: calcCpa(
        previous.reduce((sum, x) => sum + toNumber(x.spend), 0),
        previous.reduce((sum, x) => sum + toNumber(x.purchases), 0)
      ),
      ctr: weightedPrev('ctr'),
      cpc: weightedPrev('cpc'),
      visitToPurchase: safeRate(
        previous.reduce((sum, x) => sum + toNumber(x.purchases), 0),
        previous.reduce((sum, x) => sum + toNumber(x.landingViews), 0)
      )
    };

    const cpaDelta = pctChange(day.cpa, previousStats.cpa);
    const ctrDelta = pctChange(day.ctr, previousStats.ctr);
    const cpcDelta = pctChange(day.cpc, previousStats.cpc);
    const cvrDelta = pctChange(day.visitToPurchase, previousStats.visitToPurchase);

    // Solo evaluamos una métrica de estabilidad cuando existe base comparable.
    const stableMetric = delta => delta === null || Math.abs(delta) <= 15;
    const stable =
      stableMetric(cpaDelta) &&
      stableMetric(ctrDelta) &&
      stableMetric(cpcDelta) &&
      stableMetric(cvrDelta);

    if (stable) stableProfitableDays.push(day);
  });

  // El benchmark no debe quedarse vacío durante la etapa inicial.
  // Si aún no hay suficientes días para certificar estabilidad, usa los días rentables como benchmark provisional.
  const selectedDays = stableProfitableDays.length > 0 ? stableProfitableDays : profitableDays;
  const benchmarkStatus = stableProfitableDays.length > 0 ? 'Estable' : profitableDays.length > 0 ? 'Provisional' : 'Sin muestra';

  const totalSpend = selectedDays.reduce((sum, x) => sum + toNumber(x.spend), 0);
  const totalPurchases = selectedDays.reduce((sum, x) => sum + toNumber(x.purchases), 0);
  const totalLanding = selectedDays.reduce((sum, x) => sum + toNumber(x.landingViews), 0);
  const totalAtc = selectedDays.reduce((sum, x) => sum + toNumber(x.atc), 0);

  const weighted = key => {
    if (!selectedDays.length) return 0;
    if (totalSpend > 0) {
      return selectedDays.reduce((sum, x) => sum + toNumber(x[key]) * toNumber(x.spend), 0) / totalSpend;
    }
    return selectedDays.reduce((sum, x) => sum + toNumber(x[key]), 0) / selectedDays.length;
  };

  return {
    days: selectedDays.length,
    sampleDays: selectedDays.length,
    profitableDays: profitableDays.length,
    stableDays: stableProfitableDays.length,
    availableDays: benchmarkWindow.length,
    historicalDays: dailyProduct.length,
    windowDays: BENCHMARK_WINDOW_DAYS,
    status: benchmarkStatus,
    spend: totalSpend,
    purchases: totalPurchases,
    cpa: calcCpa(totalSpend, totalPurchases),
    ctr: weighted('ctr'),
    cpc: weighted('cpc'),
    cpm: weighted('cpm'),
    frequency: weighted('frequency'),
    roas: weighted('roas'),
    landingViews: totalLanding,
    atc: totalAtc,
    visitToAtc: safeRate(totalAtc, totalLanding),
    visitToPurchase: safeRate(totalPurchases, totalLanding),
    atcToPurchase: safeRate(totalPurchases, totalAtc),
    criteria: stableProfitableDays.length > 0
      ? 'Últimos 14 días activos completos · rentables + estables'
      : profitableDays.length > 0
        ? 'Últimos 14 días activos completos · benchmark provisional rentable'
        : 'Sin días rentables válidos dentro de los últimos 14 días activos completos'
  };
}

function buildCampaignDecision(campaign, product, campaignHistory, adRows, scaleRows) {
  const latest = [...campaignHistory].sort((a,b) => String(b.date).localeCompare(String(a.date)))[0];
  if (!latest) {
    return {
      status: 'Sin datos',
      action: 'Registrar datos',
      reason: 'Aún no existe un registro diario completo para esta campaña.',
      recommendedBudget: null,
      cpaObservation3d: { level: 'neutral', title: 'SIN LECTURA 3D', text: 'Sin datos completos para decisión operativa.' }
    };
  }

  const maxCpa = Math.max(1, toNumber(product?.maxCpa));
  const split3d = splitPeriodRecords(campaignHistory, '3d');
  const campaign3d = split3d.currentStats;
  const previous3d = split3d.previousStats;
  const cpa3d = campaign3d.cpa;
  const cpaObservation3d = buildCpaObservation3D(campaign3d, previous3d, maxCpa);

  // IMPORTANTE: estos contadores usan la decisión operativa 3D de cada anuncio,
  // nunca el diagnóstico del selector visual.
  const critical = adRows.filter(x => x.diag.operational3dPriority === 'critical').length;
  const alert = adRows.filter(x => x.diag.operational3dPriority === 'alert').length;
  const scalable = adRows.filter(x => x.diag.canScale).length;

  if (campaign3d.spend > 0 && campaign3d.purchases <= 0) {
    const spentVsMax = campaign3d.spend / maxCpa;
    return {
      status: spentVsMax >= 1 ? 'Crítico' : spentVsMax >= 0.5 ? 'Alerta' : 'Testing',
      action: spentVsMax >= 1
        ? 'No escalar · optimizar'
        : spentVsMax >= 0.5
          ? 'No escalar · seguir observando'
          : 'Mantener test · CPA no calculable',
      reason: cpaObservation3d.text,
      recommendedBudget: null,
      cpaObservation3d
    };
  }

  if (cpa3d > maxCpa) {
    const delta = cpaObservation3d.delta;

    if (delta !== null && delta <= 0) {
      return {
        status: 'Fuera del objetivo · recuperándose',
        action: 'No escalar · mantener en observación',
        reason: cpaObservation3d.text,
        recommendedBudget: null,
        cpaObservation3d
      };
    }

    const candidates = scaleRows.filter(r => r.budget < toNumber(latest.budget) && r.cpa > 0 && r.cpa <= maxCpa);
    const best = candidates.sort((a,b) => b.budget - a.budget)[0];

    return {
      status: delta !== null && delta > 15 ? 'Fuera del objetivo · deteriorándose' : 'Fuera del objetivo',
      action: delta !== null && delta > 15
        ? (best ? 'Reducir al último nivel rentable' : 'No escalar · optimizar')
        : 'No escalar · optimizar',
      reason: cpaObservation3d.text,
      recommendedBudget: delta !== null && delta > 15 ? (best?.budget || null) : null,
      cpaObservation3d
    };
  }

  if (critical > 0) {
    return {
      status: 'Atención',
      action: 'Optimizar antes de escalar',
      reason: `${critical} anuncio(s) presentan una señal crítica en la ventana operativa 3D.`,
      recommendedBudget: null,
      cpaObservation3d
    };
  }

  if (cpa3d > 0 && cpa3d <= maxCpa * 0.8 && scalable > 0 && toNumber(latest.budget) > 0) {
    return {
      status: 'Escalable',
      action: 'Escalar +20%',
      reason: `Decisión 3D: CPA de campaña ${fmtMoney(cpa3d)} con margen ≥20% y al menos un anuncio supera los 4 guardrails obligatorios. El volumen solo indica confianza.`,
      recommendedBudget: Math.round((toNumber(latest.budget) * 1.2) / 1000) * 1000,
      cpaObservation3d
    };
  }

  if (alert > 0) {
    return {
      status: 'Mantener · revisar',
      action: 'Mantener y revisar señales 3D',
      reason: `${alert} anuncio(s) requieren observación en 3D. No existe condición suficiente para una escala fuerte.`,
      recommendedBudget: null,
      cpaObservation3d
    };
  }

  return {
    status: 'Mantener',
    action: 'Mantener presupuesto',
    reason: 'La decisión operativa se mide exclusivamente en 3D. El CPA está dentro del objetivo, pero todavía falta margen o algún guardrail para escalar.',
    recommendedBudget: null,
    cpaObservation3d
  };
}



const METRIC_STANDARDS_CC = {
  ctrHealthy: 2,
  ctrAcceptable: 1.2,
  ctrPoor: 1,
  cvrHealthy: 3,
  cvrAcceptable: 2,
  cpmHealthyMax: 10000
};

function metricTrendCC(metric, delta) {
  if (delta === null || delta === undefined || !Number.isFinite(Number(delta))) {
    return { state: 'SIN COMPARACIÓN', tone: 'neutral', deteriorating: false, improving: false, magnitude: null };
  }

  const d = Number(delta);
  const higherIsBetter = ['ctr', 'visitToPurchase', 'hookRate', 'holdRate'].includes(metric);
  const deterioration = higherIsBetter ? d < 0 : d > 0;
  const improvement = higherIsBetter ? d > 0 : d < 0;
  const magnitude = Math.abs(d);

  if (magnitude < 5) {
    return { state: 'ESTABLE', tone: 'normal', deteriorating: false, improving: false, magnitude };
  }

  if (deterioration) {
    return {
      state: magnitude >= 20 ? 'DETERIORO FUERTE' : magnitude >= 10 ? 'DETERIORO' : 'DETERIORO LEVE',
      tone: magnitude >= 20 ? 'alert' : 'attention',
      deteriorating: true,
      improving: false,
      magnitude
    };
  }

  if (improvement) {
    return {
      state: magnitude >= 20 ? 'MEJORA FUERTE' : magnitude >= 10 ? 'MEJORA' : 'MEJORA LEVE',
      tone: 'good',
      deteriorating: false,
      improving: true,
      magnitude
    };
  }

  return { state: 'ESTABLE', tone: 'normal', deteriorating: false, improving: false, magnitude };
}

function cpcProfitabilityLimitCC(maxCpa, cvr) {
  const max = toNumber(maxCpa);
  const rate = toNumber(cvr);
  if (max <= 0 || rate <= 0) return null;
  return max * (rate / 100);
}

function metricAbsoluteHealthCC(metric, value, context = {}) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return {
      level: 'SIN DATOS',
      tone: 'neutral',
      actionable: false,
      healthy: false,
      acceptable: false,
      explanation: 'No hay un valor actual válido para evaluar el estándar.',
      standardText: 'Sin estándar evaluable.'
    };
  }

  const v = Number(value);
  const maxCpa = Math.max(1, toNumber(context?.maxCpa));
  const cvr = context?.cvr;

  if (metric === 'cpa') {
    if (v <= maxCpa * 0.8) {
      return {
        level: 'SALUDABLE',
        tone: 'good',
        actionable: false,
        healthy: true,
        acceptable: true,
        explanation: `El CPA está ${fmtNum(((maxCpa - v) / maxCpa) * 100, 1)}% por debajo del máximo y conserva margen de escala.`,
        standardText: `Saludable ≤ ${fmtMoney(maxCpa * 0.8)} · Aceptable ≤ ${fmtMoney(maxCpa)}`
      };
    }
    if (v <= maxCpa) {
      return {
        level: 'ACEPTABLE',
        tone: 'normal',
        actionable: false,
        healthy: false,
        acceptable: true,
        explanation: `El CPA sigue dentro del máximo configurado de ${fmtMoney(maxCpa)}, aunque con menos margen.`,
        standardText: `Máximo permitido ${fmtMoney(maxCpa)}`
      };
    }
    return {
      level: v > maxCpa * 1.25 ? 'CRÍTICO' : 'FUERA DEL OBJETIVO',
      tone: v > maxCpa * 1.25 ? 'critical' : 'alert',
      actionable: true,
      healthy: false,
      acceptable: false,
      explanation: `El CPA está ${fmtNum(((v - maxCpa) / maxCpa) * 100, 1)}% por encima del máximo configurado.`,
      standardText: `Máximo permitido ${fmtMoney(maxCpa)}`
    };
  }

  if (metric === 'ctr') {
    if (v >= METRIC_STANDARDS_CC.ctrHealthy) {
      return {
        level: 'SALUDABLE',
        tone: 'good',
        actionable: false,
        healthy: true,
        acceptable: true,
        explanation: `CTR ${fmtRate(v)} continúa en zona saludable (≥ ${fmtRate(METRIC_STANDARDS_CC.ctrHealthy)}).`,
        standardText: `Saludable ≥ 2% · Aceptable 1,2–1,99%`
      };
    }
    if (v >= METRIC_STANDARDS_CC.ctrAcceptable) {
      return {
        level: 'ACEPTABLE',
        tone: 'attention',
        actionable: false,
        healthy: false,
        acceptable: true,
        explanation: `CTR ${fmtRate(v)} está por debajo de 2%, pero continúa dentro del rango aceptable de 1,2–2%.`,
        standardText: `Saludable ≥ 2% · Aceptable 1,2–1,99%`
      };
    }
    if (v >= METRIC_STANDARDS_CC.ctrPoor) {
      return {
        level: 'DÉBIL · REVISAR',
        tone: 'alert',
        actionable: true,
        healthy: false,
        acceptable: false,
        explanation: `CTR ${fmtRate(v)} ya está por debajo del mínimo aceptable de 1,2%.`,
        standardText: `Acción < 1,2% · Malo < 1%`
      };
    }
    return {
      level: 'MALO',
      tone: 'critical',
      actionable: true,
      healthy: false,
      acceptable: false,
      explanation: `CTR ${fmtRate(v)} está por debajo de 1%, señal clara de respuesta creativa débil.`,
      standardText: `Malo < 1%`
    };
  }

  if (metric === 'visitToPurchase') {
    if (v >= METRIC_STANDARDS_CC.cvrHealthy) {
      return {
        level: 'SALUDABLE',
        tone: 'good',
        actionable: false,
        healthy: true,
        acceptable: true,
        explanation: `CVR ${fmtRate(v)} alcanza o supera el estándar buscado de 3%.`,
        standardText: `Saludable ≥ 3% · Aceptable 2–2,99%`
      };
    }
    if (v >= METRIC_STANDARDS_CC.cvrAcceptable) {
      return {
        level: 'ACEPTABLE',
        tone: 'attention',
        actionable: false,
        healthy: false,
        acceptable: true,
        explanation: `CVR ${fmtRate(v)} está por debajo del objetivo de 3%, pero sigue dentro del rango aceptable de 2–3%.`,
        standardText: `Saludable ≥ 3% · Aceptable 2–2,99%`
      };
    }
    return {
      level: v < 1 ? 'CRÍTICO' : 'FUERA DEL ESTÁNDAR',
      tone: v < 1 ? 'critical' : 'alert',
      actionable: true,
      healthy: false,
      acceptable: false,
      explanation: `CVR ${fmtRate(v)} está por debajo del mínimo aceptable de 2%.`,
      standardText: `Acción < 2%`
    };
  }

  if (metric === 'cpm') {
    if (v <= METRIC_STANDARDS_CC.cpmHealthyMax) {
      return {
        level: 'SALUDABLE',
        tone: 'good',
        actionable: false,
        healthy: true,
        acceptable: true,
        explanation: `CPM ${fmtMoney(v)} continúa por debajo del límite operativo de ${fmtMoney(METRIC_STANDARDS_CC.cpmHealthyMax)}.`,
        standardText: `Bien ≤ ${fmtMoney(METRIC_STANDARDS_CC.cpmHealthyMax)}`
      };
    }
    return {
      level: 'REVISAR',
      tone: 'attention',
      actionable: true,
      healthy: false,
      acceptable: false,
      explanation: `CPM ${fmtMoney(v)} supera ${fmtMoney(METRIC_STANDARDS_CC.cpmHealthyMax)} y merece revisión, aunque no demuestra por sí solo la causa.`,
      standardText: `Revisar > ${fmtMoney(METRIC_STANDARDS_CC.cpmHealthyMax)}`
    };
  }

  if (metric === 'cpc') {
    const limit = cpcProfitabilityLimitCC(maxCpa, cvr);
    if (limit === null) {
      return {
        level: 'SIN ESTÁNDAR CALCULABLE',
        tone: 'neutral',
        actionable: false,
        healthy: false,
        acceptable: false,
        explanation: 'Sin CVR válido no se puede calcular el CPC máximo sostenible para el CPA objetivo.',
        standardText: 'CPC máximo ≈ CPA máximo × CVR'
      };
    }
    if (v <= limit * 0.8) {
      return {
        level: 'SALUDABLE',
        tone: 'good',
        actionable: false,
        healthy: true,
        acceptable: true,
        explanation: `CPC ${fmtMoney(v)} está cómodamente por debajo del límite rentable estimado de ${fmtMoney(limit)} para el CVR actual.`,
        standardText: `Límite rentable estimado ${fmtMoney(limit)}`
      };
    }
    if (v <= limit) {
      return {
        level: 'ACEPTABLE',
        tone: 'attention',
        actionable: false,
        healthy: false,
        acceptable: true,
        explanation: `CPC ${fmtMoney(v)} todavía cabe dentro del límite rentable estimado de ${fmtMoney(limit)}, pero con poco margen.`,
        standardText: `Límite rentable estimado ${fmtMoney(limit)}`
      };
    }
    return {
      level: v > limit * 1.25 ? 'CRÍTICO' : 'FUERA DEL ESTÁNDAR',
      tone: v > limit * 1.25 ? 'critical' : 'alert',
      actionable: true,
      healthy: false,
      acceptable: false,
      explanation: `CPC ${fmtMoney(v)} supera el límite rentable estimado de ${fmtMoney(limit)} dado el CVR actual.`,
      standardText: `Límite rentable estimado ${fmtMoney(limit)}`
    };
  }

  return {
    level: 'SIN REGLA',
    tone: 'neutral',
    actionable: false,
    healthy: false,
    acceptable: false,
    explanation: 'No hay estándar operativo configurado para esta métrica.',
    standardText: '—'
  };
}

function metricTrendHealthDiagnosisCC(metric, value, delta, context = {}) {
  const health = metricAbsoluteHealthCC(metric, value, context);
  const trend = metricTrendCC(metric, delta);

  let label = health.level;
  let tone = health.tone;
  let action = health.actionable
    ? 'La métrica ya está fuera del estándar operativo: buscar causa y actuar según el diagnóstico completo.'
    : 'No requiere una corrección aislada por nivel actual. Mantener vigilancia.';

  if (health.actionable) {
    if (trend.improving) {
      label = `FUERA DEL ESTÁNDAR · PERO MEJORANDO`;
      tone = health.tone;
      action = 'Sigue fuera del estándar, aunque la dirección es favorable. Mantener acción correctiva hasta recuperar el rango.';
    } else if (trend.deteriorating) {
      label = `ACCIÓN · FUERA DEL ESTÁNDAR Y DETERIORANDO`;
      tone = health.tone === 'critical' ? 'critical' : 'alert';
      action = 'El nivel actual y la tendencia apuntan en la misma dirección negativa. Priorizar intervención.';
    }
  } else if (trend.deteriorating) {
    if (health.healthy) {
      label = 'ALERTA DE DETERIORO · SIGUE SALUDABLE';
      tone = 'attention';
      action = 'No actuar solo por la caída. Vigilar si continúa deteriorándose hasta acercarse al límite operativo.';
    } else if (health.acceptable) {
      label = 'ALERTA DE DETERIORO · AÚN ACEPTABLE';
      tone = 'attention';
      action = 'Todavía no exige una acción fuerte, pero está perdiendo margen y requiere vigilancia cercana.';
    }
  } else if (trend.improving) {
    label = health.healthy ? 'SALUDABLE · MEJORANDO' : health.acceptable ? 'ACEPTABLE · MEJORANDO' : health.level;
    tone = health.healthy ? 'good' : health.tone;
  } else if (trend.state === 'ESTABLE') {
    label = health.healthy ? 'SALUDABLE · ESTABLE' : health.acceptable ? 'ACEPTABLE · ESTABLE' : health.level;
  }

  return {
    metric,
    ...health,
    trend,
    combinedLabel: label,
    combinedTone: tone,
    action,
    summary: `${health.explanation}${trend.magnitude !== null ? ` Frente al período anterior: ${trend.state.toLowerCase()} de ${fmtNum(trend.magnitude, 1)}%.` : ''}`
  };
}

function metricSetDiagnosisCC(stats, previousStats, maxCpa) {
  const cvr = stats?.visitToPurchase;
  return {
    cpa: metricTrendHealthDiagnosisCC('cpa', stats?.cpa, pctChange(stats?.cpa, previousStats?.cpa), { maxCpa, cvr }),
    cpm: metricTrendHealthDiagnosisCC('cpm', stats?.cpm, pctChange(stats?.cpm, previousStats?.cpm), { maxCpa, cvr }),
    ctr: metricTrendHealthDiagnosisCC('ctr', stats?.ctr, pctChange(stats?.ctr, previousStats?.ctr), { maxCpa, cvr }),
    cpc: metricTrendHealthDiagnosisCC('cpc', stats?.cpc, pctChange(stats?.cpc, previousStats?.cpc), { maxCpa, cvr }),
    cvr: metricTrendHealthDiagnosisCC('visitToPurchase', stats?.visitToPurchase, pctChange(stats?.visitToPurchase, previousStats?.visitToPurchase), { maxCpa, cvr })
  };
}

function videoLevelHealthyCC(level) {
  return ['BUENO', 'FUERTE', 'EXCEPCIONAL'].includes(String(level || ''));
}

function videoLevelAcceptableCC(level) {
  return String(level || '') === 'ACEPTABLE';
}

function videoTrendHealthTextCC(name, levelObj, delta) {
  if (!levelObj || delta === null || delta === undefined) return '';
  const trend = metricTrendCC(name === 'Hook' ? 'hookRate' : 'holdRate', delta);
  if (!trend.deteriorating) return '';

  if (videoLevelHealthyCC(levelObj.level)) {
    return `${name} cayó ${fmtNum(trend.magnitude, 1)}%, pero continúa ${String(levelObj.level).toLowerCase()}.`;
  }
  if (videoLevelAcceptableCC(levelObj.level)) {
    return `${name} cayó ${fmtNum(trend.magnitude, 1)}% y permanece aceptable; vigilar antes de intervenir.`;
  }
  return `${name} cayó ${fmtNum(trend.magnitude, 1)}% y ya está en nivel ${String(levelObj.level).toLowerCase()}.`;
}



function isPlaybookEligibleCampaignCC(campaign) {
  return String(campaign?.name || '').toUpperCase().includes('ESCALA');
}

function playbookCampaignEvaluationCC(campaign, rows = []) {
  const eligible = isPlaybookEligibleCampaignCC(campaign);

  if (!eligible) {
    return {
      eligible: false,
      tone: 'neutral',
      label: 'PLAYBOOK NO APLICA',
      summary: 'Esta capa solo evalúa campañas cuyo nombre contiene “ESCALA”. El motor general de diagnóstico continúa funcionando normalmente.',
      protocolA: 'No evaluado: la campaña no está identificada como campaña de escala.',
      protocolB: 'No evaluado: la campaña no está identificada como campaña de escala.',
      dataNote: 'Para activar Playbook, incluye ESCALA en el nombre de la campaña.'
    };
  }

  if (!rows.length) {
    return {
      eligible: true,
      tone: 'neutral',
      label: 'PLAYBOOK · SIN DATOS EVALUABLES',
      summary: 'La campaña está habilitada para Playbook, pero todavía no hay anuncios activos con datos suficientes para evaluar los protocolos.',
      protocolA: 'Pendiente de datos.',
      protocolB: 'Pendiente de datos.',
      dataNote: 'Registra cierres diarios para construir la ventana de análisis.'
    };
  }

  const activeRows = rows.filter(r => r.playbook?.active);
  if (activeRows.length) {
    return {
      eligible: true,
      tone: activeRows.some(r => r.playbook?.severity === 'confirmed') ? 'critical' : 'attention',
      label: 'PLAYBOOK · SEÑALES DETECTADAS',
      summary: 'La campaña fue evaluada y al menos un anuncio coincide con un patrón operativo del Playbook.',
      protocolA: activeRows.some(r => r.playbook?.code === 'A')
        ? 'Se detectó señal compatible con deterioro post-clic.'
        : 'Sin señal A activa.',
      protocolB: activeRows.some(r => r.playbook?.code === 'B' || r.playbook?.code === 'B0')
        ? 'Se detectó señal de frecuencia/fatiga en al menos un anuncio.'
        : 'Sin señal B activa.',
      dataNote: 'La severidad final sigue subordinada al CPA de seguridad y a la ventana 3D.'
    };
  }

  const evaluations = rows.map(r => r.playbook?.evaluation).filter(Boolean);
  const current3dReady = evaluations.some(e => e.enough3d);
  const previousComparable = evaluations.some(e => e.previousComparable);
  const frequencyAvailable = evaluations.some(e => e.frequencyAvailable);
  const cvrAvailable = evaluations.some(e => e.cvrAvailable);

  let label = 'PLAYBOOK · EVALUADO — SIN PROTOCOLO ACTIVO';
  let summary = 'La campaña sí fue evaluada. Ningún anuncio cumple actualmente el patrón completo requerido para activar Protocolo A o B.';
  let dataNote = 'El diagnóstico general de campaña y anuncios continúa activo aunque Playbook no encuentre un protocolo específico.';

  if (!current3dReady) {
    label = 'PLAYBOOK PARCIAL · FALTA VENTANA 3D';
    summary = 'La campaña está habilitada, pero todavía no existe una ventana 3D completa para una confirmación estricta.';
    dataNote = 'Las señales pueden observarse, pero no deben convertirse en protocolo confirmado todavía.';
  } else if (!previousComparable) {
    label = 'PLAYBOOK PARCIAL · SIN BLOQUE ANTERIOR COMPARABLE';
    summary = 'Existe información actual, pero falta un bloque anterior suficiente para medir correctamente el deterioro relativo.';
    dataNote = 'Sin comparación previa no se puede demostrar una caída porcentual confiable.';
  }

  return {
    eligible: true,
    tone: 'neutral',
    label,
    summary,
    protocolA: cvrAvailable
      ? 'No activo: no coincide la combinación CVR ↓ marcada + CPM/CTR/CPC relativamente estables.'
      : 'No evaluable todavía: falta CVR comparable.',
    protocolB: frequencyAvailable
      ? 'No activo: no coincide la combinación frecuencia alta/subiendo + CTR ↓ + presión CPC/CPM + impacto económico.'
      : 'No evaluable todavía: falta Frecuencia registrada.',
    dataNote
  };
}

function fmtFrequencyCC(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value)) || Number(value) <= 0) return '—';
  return fmtNum(value, 2);
}

function playbookEconomicGateCC(stats3d, maxCpa) {
  const max = Math.max(1, toNumber(maxCpa));
  const spend = toNumber(stats3d?.spend);
  const purchases = toNumber(stats3d?.purchases);
  const cpa = stats3d?.cpa;
  const hasCpa = cpa !== null && cpa !== undefined && toNumber(cpa) > 0;
  const noPurchaseDamage = purchases <= 0 && spend >= max;

  if (noPurchaseDamage) {
    return {
      zone: 'outside',
      label: 'FUERA DE SEGURIDAD',
      tone: 'critical',
      strictAllowed: true,
      summary: `Se gastaron ${fmtMoney(spend)} sin compras en la ventana 3D; el resultado económico ya está fuera del margen de seguridad.`
    };
  }

  if (!hasCpa) {
    return {
      zone: 'unknown',
      label: 'SIN CPA COMPARABLE',
      tone: 'neutral',
      strictAllowed: false,
      summary: 'Todavía no existe un CPA 3D suficiente para habilitar un protocolo estricto.'
    };
  }

  if (toNumber(cpa) <= max * 0.8) {
    return {
      zone: 'strong',
      label: 'CPA CON MARGEN',
      tone: 'good',
      strictAllowed: false,
      summary: `CPA ${fmtCpa(cpa)} · permanece por debajo del 80% del máximo de ${fmtMoney(max)}.`
    };
  }

  if (toNumber(cpa) <= max) {
    return {
      zone: 'limit',
      label: 'RENTABLE · CERCA DEL LÍMITE',
      tone: 'attention',
      strictAllowed: false,
      summary: `CPA ${fmtCpa(cpa)} · sigue rentable frente al máximo de ${fmtMoney(max)}, pero tiene menos margen.`
    };
  }

  return {
    zone: 'outside',
    label: 'CPA FUERA DEL LÍMITE',
    tone: 'critical',
    strictAllowed: true,
    summary: `CPA ${fmtCpa(cpa)} · supera el máximo permitido de ${fmtMoney(max)}.`
  };
}

function buildPlaybookProtocolCC(diag, maxCpa, changeSafety = null, ad = null, campaign = null) {
  if (!isPlaybookEligibleCampaignCC(campaign)) {
    return {
      active: false,
      eligible: false,
      severity: 'none',
      tone: 'neutral',
      code: null,
      label: 'PLAYBOOK NO APLICA',
      summary: 'La campaña no contiene “ESCALA” en su nombre.',
      evidence: '',
      action: '',
      secondary: [],
      evaluation: {
        enough3d: false,
        previousComparable: false,
        frequencyAvailable: false,
        cvrAvailable: false
      }
    };
  }

  const s3 = diag?.scale3d || {};
  const p3 = diag?.scalePrev3d || {};
  const d3 = diag?.scaleDelta3d || {};
  const gate = playbookEconomicGateCC(s3, maxCpa);

  const cpaDelta = d3.cpa;
  const ctrDelta = d3.ctr;
  const cpcDelta = d3.cpc;
  const cpmDelta = d3.cpm;
  const cvrDelta = d3.visitToPurchase;
  const freqDelta = d3.frequency;
  const frequency = s3.frequency;

  const has = v => v !== null && v !== undefined && Number.isFinite(Number(v));
  const abs = v => has(v) ? Math.abs(Number(v)) : null;
  const enough3d = toNumber(s3.days) >= 3;

  // Playbook A: deterioro post-clic.
  // La caída de CVR debe ser marcada mientras pre-clic permanece relativamente estable.
  const cvrDrop = has(cvrDelta) && Number(cvrDelta) <= -20;
  const ctrStable = !has(ctrDelta) || abs(ctrDelta) <= 15;
  const cpcStable = !has(cpcDelta) || abs(cpcDelta) <= 15;
  const cpmStable = !has(cpmDelta) || abs(cpmDelta) <= 15;
  const preClickStable = ctrStable && cpcStable && cpmStable;
  const protocolAPattern = cvrDrop && preClickStable;

  // Playbook B: fatiga creativa.
  // Frecuencia 2,5–3,0 es una alerta diagnóstica, no una ley universal.
  const frequencyWatch = has(frequency) && Number(frequency) >= 2.5;
  const frequencyHigh = has(frequency) && Number(frequency) >= 3;
  const frequencyRising = has(freqDelta) && Number(freqDelta) >= 10;
  const ctrResponseDrop = has(ctrDelta) && Number(ctrDelta) <= -15;
  const costPressure =
    (has(cpcDelta) && Number(cpcDelta) >= 10) ||
    (has(cpmDelta) && Number(cpmDelta) >= 10);
  const cpaPressure =
    gate.zone === 'outside' ||
    (has(cpaDelta) && Number(cpaDelta) >= 10);
  const protocolBPattern =
    frequencyWatch &&
    (frequencyHigh || frequencyRising) &&
    ctrResponseDrop &&
    costPressure;

  const candidates = [];

  const safetyBlocked =
    changeSafety?.active &&
    changeSafety?.canStructuralNow === false;
  const safetyWait = safetyBlocked
    ? fmtHoursRemainingCC(changeSafety.structuralRemainingHours)
    : null;

  if (protocolAPattern) {
    if (gate.strictAllowed && enough3d && cpaPressure) {
      candidates.push({
        code: 'A',
        severity: 'confirmed',
        priority: 40,
        tone: 'critical',
        label: 'PROTOCOLO A · DETERIORO POST-CLIC CONFIRMADO',
        summary:
          `El CVR cayó ${fmtNum(Math.abs(cvrDelta), 1)}% mientras CPM, CTR y CPC permanecen relativamente estables. ` +
          `${gate.summary}`,
        evidence:
          `CVR ${fmtRate(s3.visitToPurchase)} (${cvrDelta > 0 ? '+' : ''}${fmtNum(cvrDelta, 1)}%) · ` +
          `CTR ${fmtRate(s3.ctr)} · CPC ${fmtMoneyOrDashCC(s3.cpc)} · CPM ${fmtMoneyOrDashCC(s3.cpm)} · CPA ${fmtCpa(s3.cpa)}.`,
        action:
          safetyBlocked
            ? `Preparar el protocolo post-clic, pero no ejecutar otro cambio estructural todavía: faltan ${safetyWait}. Revisar landing móvil, checkout/COD, variantes, precio, inventario, tracking y calidad del tráfico. Si no existe una falla operativa, dejar registrado el micro-ajuste CBO de 15–20% para ejecutarlo cuando termine la ventana y observar 48–72 h. Si no recupera, preparar relevo con ganadores frescos.`
            : 'Revisar primero landing móvil, checkout/COD, variantes, precio, inventario, tracking y calidad del tráfico. Si no existe una falla operativa, considerar micro-ajuste CBO de 15–20% y observar 48–72 h evitando cambios repetidos. Si no recupera, preparar relevo con ganadores frescos.',
        agendaAction: 'Ejecutar protocolo post-clic: revisar landing/checkout y evaluar micro-ajuste CBO 15–20%',
        agendaNote:
          `Playbook A confirmado en 3D. CVR ${fmtRate(s3.visitToPurchase)} · CPA ${fmtCpa(s3.cpa)} vs máximo ${fmtMoney(maxCpa)}.`
      });
    } else {
      candidates.push({
        code: 'A',
        severity: gate.zone === 'limit' ? 'alert' : 'watch',
        priority: gate.zone === 'limit' ? 22 : 14,
        tone: 'attention',
        label:
          gate.zone === 'limit'
            ? 'ALERTA POST-CLIC · RENTABILIDAD CONSERVADA'
            : 'SEÑAL TEMPRANA POST-CLIC · CPA CON MARGEN',
        summary:
          `El CVR cayó ${fmtNum(Math.abs(cvrDelta), 1)}% con pre-clic relativamente estable, pero el CPA todavía no habilita un protocolo estricto. ${gate.summary}`,
        evidence:
          `CVR ${fmtRate(s3.visitToPurchase)} · CTR ${fmtRate(s3.ctr)} · CPC ${fmtMoneyOrDashCC(s3.cpc)} · CPA ${fmtCpa(s3.cpa)}.`,
        action:
          gate.zone === 'limit'
            ? 'No reducir ni relevar todavía. Vigilar CVR y CPA en el próximo cierre, revisar preventivamente landing/checkout y actuar solo si el CPA cruza el límite y el 3D mantiene el patrón.'
            : 'No intervenir. Vigilar CVR, CPA y salud de página. La caída merece atención, pero la campaña conserva margen rentable.',
        agendaAction: 'Vigilar señal post-clic y revisar salud de landing/checkout',
        agendaNote:
          `Señal Playbook A sin protocolo estricto porque el CPA sigue rentable. CVR ${fmtRate(s3.visitToPurchase)} · CPA ${fmtCpa(s3.cpa)}.`
      });
    }
  }

  if (protocolBPattern) {
    if (gate.strictAllowed && enough3d && cpaPressure) {
      candidates.push({
        code: 'B',
        severity: 'confirmed',
        priority: 45,
        tone: 'critical',
        label: 'PROTOCOLO B · FATIGA CREATIVA CONFIRMADA',
        summary:
          `Frecuencia ${fmtFrequencyCC(frequency)} con deterioro de respuesta: CTR ${ctrDelta > 0 ? '+' : ''}${fmtNum(ctrDelta, 1)}% y presión de CPC/CPM. ${gate.summary}`,
        evidence:
          `Frecuencia ${fmtFrequencyCC(frequency)}${has(freqDelta) ? ` (${freqDelta > 0 ? '+' : ''}${fmtNum(freqDelta, 1)}%)` : ''} · ` +
          `CTR ${fmtRate(s3.ctr)} · CPC ${fmtMoneyOrDashCC(s3.cpc)} · CPM ${fmtMoneyOrDashCC(s3.cpm)} · CPA ${fmtCpa(s3.cpa)}.`,
        action:
          safetyBlocked
            ? `Preparar relevo creativo ahora, pero esperar ${safetyWait} antes de otro cambio estructural. Crear un conjunto nuevo en la CBO con ganadores frescos/Post IDs; cuando el relevo esté listo y termine la ventana, pausar el conjunto viejo y vigilar CPA, CVR, CTR, CPC, CPM y distribución.`
            : 'Preparar relevo creativo: crear un conjunto nuevo dentro de la CBO con ganadores frescos/Post IDs. Cuando el relevo esté listo, pausar el conjunto viejo, publicar y vigilar CPA, CVR, CTR, CPC, CPM y distribución de gasto.',
        agendaAction: `Preparar relevo creativo${ad?.name ? ` para ${ad.name}` : ''} por fatiga confirmada`,
        agendaNote:
          `Playbook B confirmado en 3D. Frecuencia ${fmtFrequencyCC(frequency)} · CTR ${fmtRate(s3.ctr)} · CPA ${fmtCpa(s3.cpa)}.`
      });
    } else {
      candidates.push({
        code: 'B',
        severity: gate.zone === 'limit' ? 'alert' : 'watch',
        priority: gate.zone === 'limit' ? 25 : 16,
        tone: 'attention',
        label:
          gate.zone === 'limit'
            ? 'ALERTA DE FATIGA · CAMPAÑA AÚN RENTABLE'
            : 'POSIBLE DESGASTE CREATIVO · SIN IMPACTO ECONÓMICO',
        summary:
          `La frecuencia está en ${fmtFrequencyCC(frequency)} y la respuesta creativa se deterioró, pero el CPA todavía no habilita fatiga confirmada. ${gate.summary}`,
        evidence:
          `Frecuencia ${fmtFrequencyCC(frequency)} · CTR ${fmtRate(s3.ctr)} (${ctrDelta > 0 ? '+' : ''}${fmtNum(ctrDelta, 1)}%) · ` +
          `CPC ${fmtMoneyOrDashCC(s3.cpc)} · CPA ${fmtCpa(s3.cpa)}.`,
        action:
          gate.zone === 'limit'
            ? 'No relevar todavía. Preparar creativos de respaldo y vigilar frecuencia, CTR, CPC y CPA. Confirmar fatiga solo si el deterioro llega al resultado económico.'
            : 'No intervenir todavía. Mantener el ganador activo y vigilar frecuencia, CTR, CPC y CPA; preparar variantes solo como prevención.',
        agendaAction: `Preparar creativo de respaldo${ad?.name ? ` para ${ad.name}` : ''}`,
        agendaNote:
          `Alerta temprana de fatiga sin impacto económico confirmado. Frecuencia ${fmtFrequencyCC(frequency)} · CPA ${fmtCpa(s3.cpa)}.`
      });
    }
  } else if (frequencyWatch) {
    candidates.push({
      code: 'B0',
      severity: 'watch',
      priority: 8,
      tone: 'attention',
      label: 'FRECUENCIA ALTA · SIN FATIGA CONFIRMADA',
      summary:
        `La frecuencia está en ${fmtFrequencyCC(frequency)}, zona de vigilancia del Playbook, pero no aparece todavía la combinación completa de deterioro creativo y económico.`,
      evidence:
        `Frecuencia ${fmtFrequencyCC(frequency)}${has(freqDelta) ? ` · Δ ${freqDelta > 0 ? '+' : ''}${fmtNum(freqDelta, 1)}%` : ''} · ` +
        `CTR ${fmtRate(s3.ctr)} · CPC ${fmtMoneyOrDashCC(s3.cpc)} · CPA ${fmtCpa(s3.cpa)}.`,
      action:
        'Vigilar. No apagar, relevar ni reducir únicamente por frecuencia. La fatiga se confirma solo cuando la repetición coincide con deterioro de respuesta y del resultado económico.',
      agendaAction: `Vigilar frecuencia${ad?.name ? ` de ${ad.name}` : ''}`,
      agendaNote:
        `Frecuencia ${fmtFrequencyCC(frequency)} en zona de vigilancia sin fatiga confirmada.`
    });
  }

  if (!candidates.length) {
    return {
      active: false,
      eligible: true,
      severity: 'none',
      tone: 'neutral',
      label: 'SIN PROTOCOLO PLAYBOOK ACTIVO',
      summary: 'No se detecta un patrón Playbook que requiera una alerta adicional.',
      evidence: '',
      action: '',
      economicGate: gate,
      secondary: [],
      evaluation: {
        enough3d,
        previousComparable: toNumber(p3?.days) > 0,
        frequencyAvailable: has(frequency),
        cvrAvailable: has(s3.visitToPurchase) && has(cvrDelta),
        protocolAPattern,
        protocolBPattern
      }
    };
  }

  candidates.sort((a, b) => b.priority - a.priority);
  const primary = candidates[0];

  return {
    active: true,
    eligible: true,
    ...primary,
    economicGate: gate,
    secondary: candidates.slice(1),
    frequency,
    frequencyDelta: freqDelta,
    cvrDelta,
    cpaDelta,
    strictAllowed: gate.strictAllowed && enough3d,
    evaluation: {
      enough3d,
      previousComparable: toNumber(p3?.days) > 0,
      frequencyAvailable: has(frequency),
      cvrAvailable: has(s3.visitToPurchase) && has(cvrDelta),
      protocolAPattern,
      protocolBPattern
    }
  };
}


function buildCampaignPruningProtocolCC({
  campaign,
  product,
  allAds = [],
  dailyAds = [],
  decisions = [],
  changeSafety = null,
  nowMs = Date.now()
}) {
  if (!isPlaybookEligibleCampaignCC(campaign)) {
    return {
      active: false,
      eligible: false,
      phase: 'not_applicable',
      status: 'LA PODA NO APLICA',
      tone: 'neutral',
      canExecute: false,
      summary: 'La Poda forma parte de la capa Playbook y solo se evalúa en campañas cuyo nombre contiene “ESCALA”.'
    };
  }

  const max = Math.max(1, toNumber(product?.maxCpa));
  const today = todayColombiaCC();

  const campaignAds = (allAds || []).filter(
    ad => ad.campaignId === campaign?.id && ad.deleted !== true
  );

  const activeAds = campaignAds.filter(
    ad => ad.active !== false && campaign?.active !== false && !campaign?.archived
  );

  const contribution3d = buildCampaignContribution3D(
    campaign,
    product,
    campaignAds,
    dailyAds
  );

  const buildRow = ad => {
    const records = (dailyAds || []).filter(r => r.adId === ad.id);
    const diag = diagnoseAd(records, product, ad, '3d', campaign);
    const contribution = contribution3d.byAd[ad.id] || null;
    const action = adReadingActionCC(diag, contribution, max);
    const stats = diag?.scale3d || {};
    const delta = diag?.scaleDelta3d || {};

    return { ad, records, diag, contribution, action, stats, delta };
  };

  const rows = activeAds
    .map(buildRow)
    .filter(row => toNumber(row?.contribution?.spend) > 0)
    .sort(
      (a, b) =>
        toNumber(b?.contribution?.spendShare) -
        toNumber(a?.contribution?.spendShare)
    );

  // ── Seguimiento de una poda ya ejecutada ───────────────────
  const podaDecision = [...(decisions || [])]
    .filter(d =>
      d.campaignId === campaign?.id &&
      d.changeType === 'ad_state' &&
      String(d.action || '').toLowerCase().includes('apagado') &&
      d.protocol === 'poda'
    )
    .sort((a, b) => (changeEventTimeMsCC(b) || 0) - (changeEventTimeMsCC(a) || 0))[0];

  if (podaDecision) {
    const dominantAd =
      campaignAds.find(a => a.id === podaDecision.adId) ||
      { id: podaDecision.adId, name: podaDecision.adNameSnapshot || 'Anuncio podado' };

    const candidateAd =
      campaignAds.find(a => a.id === podaDecision.podaCandidateAdId) ||
      (podaDecision.podaCandidateAdId
        ? { id: podaDecision.podaCandidateAdId, name: podaDecision.podaCandidateNameSnapshot || 'Anuncio receptor' }
        : null);

    const decisionDate = String(podaDecision.date || '');
    const actionMs = changeEventTimeMsCC(podaDecision);
    const elapsedHours = actionMs
      ? Math.max(0, (nowMs - actionMs) / 3600000)
      : null;

    if (!candidateAd?.id) {
      return {
        active: true,
        phase: 'post_poda',
        status: 'PODA EJECUTADA · SIN CANDIDATO IDENTIFICADO',
        tone: 'attention',
        dominantAd,
        candidateAd: null,
        canExecute: false,
        summary:
          `Se registró una poda sobre ${dominantAd.name}, pero no quedó identificado el anuncio que debía absorber el presupuesto.`,
        evidence: 'La bitácora de la poda no contiene un candidato receptor.',
        action:
          'Revisar manualmente qué anuncio permanece activo y registrar el candidato antes de interpretar el resultado.',
        agendaAction: 'Revisar candidato receptor después de La Poda',
        agendaNote: `Poda registrada sobre ${dominantAd.name} sin candidato receptor identificado.`
      };
    }

    const postEligibleRecords = (dailyAds || []).filter(r => {
      if (r.campaignId !== campaign?.id) return false;
      const date = String(r.date || '');
      if (!date || date >= today) return false;
      if (decisionDate && date <= decisionDate) return false;
      return true;
    });

    const postDates = [...new Set(postEligibleRecords.map(r => String(r.date)))]
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 3);

    const postDateSet = new Set(postDates);
    const candidatePostRecords = postEligibleRecords.filter(
      r => r.adId === candidateAd.id && postDateSet.has(String(r.date))
    );
    const campaignPostRecords = postEligibleRecords.filter(
      r => postDateSet.has(String(r.date))
    );

    const candidateStats = aggregateRecords(candidatePostRecords);
    const campaignStats = aggregateRecords(campaignPostRecords);
    const spendShare =
      campaignStats.spend > 0
        ? (candidateStats.spend / campaignStats.spend) * 100
        : 0;

    const days = postDates.length;
    const enoughTime = days >= 2 || (elapsedHours !== null && elapsedHours >= 48);
    const completedWindow = days >= 3 || (elapsedHours !== null && elapsedHours >= 72);
    const absorbed = spendShare >= 60;
    const enoughEconomicSample =
      candidateStats.spend >= max * 0.75 ||
      toNumber(candidateStats.purchases) >= 2;

    const profitable =
      toNumber(candidateStats.purchases) > 0 &&
      candidateStats.cpa !== null &&
      candidateStats.cpa !== undefined &&
      toNumber(candidateStats.cpa) <= max;

    const expensive =
      candidateStats.cpa !== null &&
      candidateStats.cpa !== undefined &&
      toNumber(candidateStats.cpa) > max;

    const noSalesDamage =
      toNumber(candidateStats.purchases) <= 0 &&
      toNumber(candidateStats.spend) >= max;

    if (!enoughTime || days < 2) {
      return {
        active: true,
        phase: 'post_poda',
        status: 'PODA EN OBSERVACIÓN · TURBULENCIA ESPERADA',
        tone: 'attention',
        dominantAd,
        candidateAd,
        candidateStats,
        campaignStats,
        spendShare,
        days,
        elapsedHours,
        canExecute: false,
        summary:
          `${dominantAd.name} fue apagado y ${candidateAd.name} está entrando en la fase de redistribución. Todavía no han transcurrido suficientes cierres completos para juzgar si puede absorber el presupuesto.`,
        evidence:
          `${days} día(s) completo(s) después de la poda · ${fmtRate(spendShare)} del gasto post-poda en ${candidateAd.name} · CPA ${fmtCpa(candidateStats.cpa)}.`,
        action:
          `No realizar otro cambio estructural. Esperar hasta completar al menos 48 horas y preferiblemente 72 horas, observando cuánto presupuesto absorbe ${candidateAd.name} y si mantiene CPA rentable.`,
        agendaAction: `Revisar resultado de La Poda de ${dominantAd.name} en 48–72 h`,
        agendaNote:
          `Candidato receptor: ${candidateAd.name}. Esperar redistribución antes de concluir.`
      };
    }

    if (absorbed && enoughEconomicSample && profitable) {
      return {
        active: true,
        phase: 'post_poda',
        status: 'PODA EXITOSA · CAMPAÑA REVIVIDA',
        tone: 'good',
        dominantAd,
        candidateAd,
        candidateStats,
        campaignStats,
        spendShare,
        days,
        elapsedHours,
        canExecute: false,
        summary:
          `${candidateAd.name} absorbió ${fmtRate(spendShare)} del gasto después de apagar ${dominantAd.name} y mantiene un CPA de ${fmtCpa(candidateStats.cpa)}, dentro del máximo de ${fmtMoney(max)}.`,
        evidence:
          `${days} día(s) completos · gasto ${fmtMoney(candidateStats.spend)} · ${fmtNum(candidateStats.purchases, 2)} compra(s) · CPA ${fmtCpa(candidateStats.cpa)}.`,
        action:
          'Mantener la nueva distribución. No ejecutar un relevo completo mientras el anuncio receptor continúe absorbiendo presupuesto con CPA rentable. Seguir vigilando estabilidad antes de volver a escalar.',
        agendaAction: `Mantener ${candidateAd.name} después de Poda exitosa`,
        agendaNote:
          `Absorbió ${fmtRate(spendShare)} del gasto con CPA ${fmtCpa(candidateStats.cpa)}.`
      };
    }

    if (absorbed && enoughEconomicSample && (expensive || noSalesDamage)) {
      return {
        active: true,
        phase: 'post_poda',
        status: 'EFECTO ESPEJISMO · RELEVO COMPLETO',
        tone: 'critical',
        dominantAd,
        candidateAd,
        candidateStats,
        campaignStats,
        spendShare,
        days,
        elapsedHours,
        canExecute: false,
        summary:
          `${candidateAd.name} sí absorbió el presupuesto (${fmtRate(spendShare)}), pero al recibir volumen dejó de sostener la eficiencia.`,
        evidence:
          toNumber(candidateStats.purchases) <= 0
            ? `${fmtMoney(candidateStats.spend)} de gasto post-poda sin compras.`
            : `CPA post-poda ${fmtCpa(candidateStats.cpa)} vs máximo ${fmtMoney(max)}.`,
        action:
          'El buen resultado previo del anuncio receptor era una señal de muestra baja y no escaló. Preparar el relevo completo: apagar el conjunto viejo cuando el nuevo esté listo e inyectar Post IDs frescos provenientes del sistema de testeo.',
        agendaAction: 'Ejecutar relevo completo por Efecto Espejismo',
        agendaNote:
          `${candidateAd.name} absorbió ${fmtRate(spendShare)} del gasto pero no sostuvo CPA rentable.`
      };
    }

    return {
      active: true,
      phase: 'post_poda',
      status: completedWindow
        ? 'PODA NO CONCLUYENTE · PREPARAR RELEVO'
        : 'PODA EN OBSERVACIÓN · ABSORCIÓN INSUFICIENTE',
      tone: completedWindow ? 'attention' : 'attention',
      dominantAd,
      candidateAd,
      candidateStats,
      campaignStats,
      spendShare,
      days,
      elapsedHours,
      canExecute: false,
      summary:
        `${candidateAd.name} todavía no demuestra una absorción suficiente del presupuesto o no acumula muestra económica suficiente para declarar éxito o espejismo.`,
      evidence:
        `${days} día(s) completos · ${fmtRate(spendShare)} del gasto · ${fmtMoney(candidateStats.spend)} gastados · CPA ${fmtCpa(candidateStats.cpa)}.`,
      action:
        completedWindow
          ? 'La ventana de 72 horas ya está prácticamente completada sin una validación clara. Preparar relevo completo y evitar seguir prolongando una estructura que no redistribuye de forma útil.'
          : 'Mantener observación hasta completar 72 horas. No declarar éxito solo porque el anuncio tenía buenas métricas con poco gasto.',
      agendaAction: completedWindow
        ? 'Preparar relevo completo por Poda no concluyente'
        : `Revisar absorción de ${candidateAd.name} al completar 72 h`,
      agendaNote:
        `Post-poda: ${fmtRate(spendShare)} del gasto · CPA ${fmtCpa(candidateStats.cpa)}.`
    };
  }

  // ── Diagnóstico previo a la poda ───────────────────────────
  if (rows.length < 2) {
    return {
      active: false,
      phase: 'pre_poda',
      status: 'SIN ESCENARIO DE PODA',
      tone: 'neutral',
      canExecute: false
    };
  }

  const dominant = rows[0];
  const runnerUp = rows[1];

  const dominantShare = toNumber(dominant?.contribution?.spendShare);
  const runnerShare = toNumber(runnerUp?.contribution?.spendShare);
  const shareGap = dominantShare - runnerShare;

  const dominantConcentrated =
    dominantShare >= 55 &&
    shareGap >= 20;

  const dominantOutside =
    toNumber(dominant?.stats?.purchases) <= 0
      ? toNumber(dominant?.stats?.spend) >= max
      : (
          dominant?.stats?.cpa !== null &&
          dominant?.stats?.cpa !== undefined &&
          toNumber(dominant.stats.cpa) > max
        );

  const cpaDeteriorated =
    dominant?.delta?.cpa !== null &&
    dominant?.delta?.cpa !== undefined &&
    toNumber(dominant.delta.cpa) >= 15;

  const responseDeteriorated =
    (
      dominant?.delta?.ctr !== null &&
      dominant?.delta?.ctr !== undefined &&
      toNumber(dominant.delta.ctr) <= -15
    ) ||
    (
      dominant?.delta?.cpc !== null &&
      dominant?.delta?.cpc !== undefined &&
      toNumber(dominant.delta.cpc) >= 10
    ) ||
    (
      dominant?.delta?.visitToPurchase !== null &&
      dominant?.delta?.visitToPurchase !== undefined &&
      toNumber(dominant.delta.visitToPurchase) <= -20
    );

  const dominantConfirmedBad =
    dominant.action?.label === 'PAUSAR' &&
    dominantOutside &&
    toNumber(dominant?.stats?.days) >= 3 &&
    (cpaDeteriorated || responseDeteriorated);

  const candidates = rows
    .slice(1)
    .filter(row => {
      const s = row.stats || {};
      const c = row.contribution || {};
      const hasPurchase = toNumber(s.purchases) > 0;
      const cpaRentable =
        hasPurchase &&
        s.cpa !== null &&
        s.cpa !== undefined &&
        toNumber(s.cpa) <= max;
      const notDrain =
        c.status !== 'Drena la campaña' &&
        row.action?.label !== 'PAUSAR';
      const clearlyBetter =
        dominant.stats?.cpa === null ||
        dominant.stats?.cpa === undefined ||
        !hasPurchase ||
        toNumber(s.cpa) <= toNumber(dominant.stats.cpa) * 0.8;

      return cpaRentable && notDrain && clearlyBetter;
    })
    .sort((a, b) => {
      const aValidated =
        toNumber(a.stats?.spend) >= max &&
        toNumber(a.stats?.purchases) >= 2 ? 1 : 0;
      const bValidated =
        toNumber(b.stats?.spend) >= max &&
        toNumber(b.stats?.purchases) >= 2 ? 1 : 0;
      if (aValidated !== bValidated) return bValidated - aValidated;
      return toNumber(a.stats?.cpa) - toNumber(b.stats?.cpa);
    });

  const candidate = candidates[0] || null;

  if (!dominantConcentrated || !dominantConfirmedBad) {
    return {
      active: false,
      phase: 'pre_poda',
      status: 'SIN PODA CONFIRMADA',
      tone: 'neutral',
      canExecute: false
    };
  }

  if (!candidate) {
    return {
      active: true,
      phase: 'pre_poda',
      status: 'ANUNCIO DOMINANTE DETERIORADO · SIN RESPALDO PARA PODA',
      tone: 'critical',
      dominantAd: dominant.ad,
      dominantStats: dominant.stats,
      dominantShare,
      candidateAd: null,
      canExecute: false,
      summary:
        `${dominant.ad.name} concentra ${fmtRate(dominantShare)} del gasto y ya cumple criterio de pausa 3D, pero ningún otro anuncio activo muestra todavía un CPA rentable suficiente para justificar una poda.`,
      evidence:
        `CPA dominante ${fmtCpa(dominant.stats.cpa)} vs máximo ${fmtMoney(max)} · participación de gasto ${fmtRate(dominantShare)}.`,
      action:
        'No apagar el anuncio dominante esperando que otro anuncio lo rescate. Preparar relevo completo con ganadores frescos, porque actualmente no existe un receptor interno con señales económicas suficientes.',
      agendaAction: 'Preparar relevo completo: no existe candidato interno para La Poda',
      agendaNote:
        `${dominant.ad.name} domina ${fmtRate(dominantShare)} del gasto y cumple pausa 3D, sin respaldo rentable activo.`
    };
  }

  const candidateValidated =
    toNumber(candidate.stats?.spend) >= max &&
    toNumber(candidate.stats?.purchases) >= 2;

  const candidateShare = toNumber(candidate?.contribution?.spendShare);
  const safetyBlocked =
    changeSafety?.active &&
    changeSafety?.canStructuralNow === false;
  const safetyWait = safetyBlocked
    ? fmtHoursRemainingCC(changeSafety.structuralRemainingHours)
    : null;

  return {
    active: true,
    phase: 'pre_poda',
    status: safetyBlocked
      ? 'LA PODA IDENTIFICADA · ESPERAR VENTANA DE SEGURIDAD'
      : 'LA PODA · CIRUGÍA RECOMENDADA',
    tone: safetyBlocked ? 'attention' : 'critical',
    dominantAd: dominant.ad,
    dominantStats: dominant.stats,
    dominantContribution: dominant.contribution,
    dominantShare,
    candidateAd: candidate.ad,
    candidateStats: candidate.stats,
    candidateContribution: candidate.contribution,
    candidateShare,
    candidateConfidence: candidateValidated
      ? 'RESPALDO CON MUESTRA'
      : 'CANDIDATO PROMETEDOR · MUESTRA BAJA',
    safetyBlocked,
    safetyWait,
    canExecute: !safetyBlocked,
    summary:
      `${dominant.ad.name} consume ${fmtRate(dominantShare)} del presupuesto y ya cumple criterio real de pausa 3D. ` +
      `${candidate.ad.name} recibe solo ${fmtRate(candidateShare)} del gasto, pero actualmente muestra CPA ${fmtCpa(candidate.stats.cpa)} dentro del máximo de ${fmtMoney(max)}.`,
    evidence:
      `${dominant.ad.name}: CPA ${fmtCpa(dominant.stats.cpa)} · ${fmtRate(dominantShare)} del gasto. ` +
      `${candidate.ad.name}: CPA ${fmtCpa(candidate.stats.cpa)} · ${fmtRate(candidateShare)} del gasto · ${fmtNum(candidate.stats.purchases, 2)} compra(s).`,
    action:
      safetyBlocked
        ? `No ejecutar todavía. Faltan ${safetyWait} para completar la ventana estructural. Después, si el 3D sigue confirmando daño en ${dominant.ad.name}, apagar únicamente ese anuncio y dejar que ${candidate.ad.name} intente absorber presupuesto durante 48–72 h.`
        : `Apagar únicamente ${dominant.ad.name}. Mantener ${candidate.ad.name} activo y no hacer más cambios durante 48–72 h. El objetivo es comprobar si el anuncio de menor gasto puede absorber volumen sin perder rentabilidad.`,
    agendaAction: `Ejecutar La Poda: apagar ${dominant.ad.name} y observar ${candidate.ad.name} durante 48–72 h`,
    agendaNote:
      `${candidateValidated ? 'Respaldo con muestra' : 'Candidato con muestra baja'}: ${candidate.ad.name} · CPA ${fmtCpa(candidate.stats.cpa)} · ${fmtRate(candidateShare)} del gasto.`
  };
}

function audiencePressureDiagnosisCC(stats3d, previous3d, benchmark = null) {
  const cpm = stats3d?.cpm;
  const ctr = stats3d?.ctr;
  const cpc = stats3d?.cpc;
  const frequency = stats3d?.frequency;
  const cvr = stats3d?.visitToPurchase;

  if (cpm === null || cpm === undefined || !toNumber(stats3d?.days)) {
    return {
      label: 'SIN LECTURA DE DISTRIBUCIÓN',
      tone: 'neutral',
      summary: 'No hay datos suficientes de CPM para explicar el costo de conseguir impresiones.',
      cause: 'No se puede inferir una causa sin datos suficientes.',
      action: 'No tomar decisiones por CPM.'
    };
  }

  const cpmDelta = pctChange(cpm, previous3d?.cpm);
  const ctrDelta = pctChange(ctr, previous3d?.ctr);
  const cpcDelta = pctChange(cpc, previous3d?.cpc);
  const freqDelta = pctChange(frequency, previous3d?.frequency);
  const cvrDelta = pctChange(cvr, previous3d?.visitToPurchase);
  const cpmStatus = metricTrendHealthDiagnosisCC('cpm', cpm, cpmDelta, { cvr });

  const has = v => v !== null && v !== undefined;
  const gt = (v, n) => has(v) && v > n;
  const lt = (v, n) => has(v) && v < n;
  const stable = (v, n = 10) => !has(v) || Math.abs(v) <= n;

  if (gt(cpmDelta, 10) && gt(freqDelta, 15) && lt(ctrDelta, -10) && gt(cpcDelta, 10)) {
    return {
      label: cpmStatus.actionable ? 'POSIBLE SATURACIÓN / FATIGA · CPM A REVISAR' : 'ALERTA DE DETERIORO · CPM AÚN SALUDABLE',
      tone: cpmStatus.actionable ? 'critical' : 'attention',
      summary: `${cpmStatus.summary} Además, la frecuencia sube mientras cae la respuesta al anuncio.`,
      cause: 'El patrón es compatible con repetición creciente sobre la audiencia y deterioro creativo. Es una interpretación, no una causa demostrada.',
      action: cpmStatus.actionable
        ? 'Revisar reemplazo creativo y detener escalado si el CPA también se deteriora.'
        : 'No actuar solo por CPM: vigilar frecuencia, CTR, CPC y CPA.'
    };
  }

  if (gt(cpmDelta, 10)) {
    return {
      label: cpmStatus.combinedLabel,
      tone: cpmStatus.combinedTone,
      summary: cpmStatus.summary,
      cause: 'El aumento puede estar relacionado con competencia, cambios de audiencia, placements, temporalidad u otros factores. El CPM por sí solo no identifica una causa.',
      action: cpmStatus.action
    };
  }

  if (cpmStatus.actionable) {
    return {
      label: cpmStatus.combinedLabel,
      tone: cpmStatus.combinedTone,
      summary: cpmStatus.summary,
      cause: 'El CPM actual supera el estándar operativo aunque la variación reciente no sea fuerte.',
      action: cpmStatus.action
    };
  }

  const benchmarkReady = benchmark?.sampleDays > 0 && toNumber(benchmark?.cpm) > 0;
  if (
    benchmarkReady &&
    toNumber(cpm) <= toNumber(benchmark.cpm) &&
    toNumber(ctr) >= toNumber(benchmark.ctr) &&
    toNumber(cpc) <= toNumber(benchmark.cpc)
  ) {
    return {
      label: 'EXPOSICIÓN + RESPUESTA EFICIENTES',
      tone: 'good',
      summary: `${cpmStatus.summary} Además, CPM, CTR y CPC están alineados favorablemente frente al benchmark rentable propio del producto.`,
      cause: 'La distribución y la respuesta están funcionando conjuntamente.',
      action: 'Mantener mientras CPA y CVR acompañen.'
    };
  }

  if (gt(cpmDelta, 10) && lt(cvrDelta, -20) && !lt(ctrDelta, -10)) {
    return {
      label: cpmStatus.healthy ? 'CPM DETERIORA, PERO SIGUE SALUDABLE · CVR ES LA ALERTA MAYOR' : 'CPM ↑ + CVR ↓',
      tone: 'alert',
      summary: `${cpmStatus.summary} La caída más fuerte se encuentra después del clic.`,
      cause: 'Existe presión de distribución acompañando un deterioro post-clic; el CPM no explica por sí solo el CPA.',
      action: 'Priorizar el diagnóstico post-clic y mantener CPM como factor acompañante.'
    };
  }

  return {
    label: cpmStatus.combinedLabel,
    tone: cpmStatus.combinedTone,
    summary: cpmStatus.summary,
    cause: 'No aparece una combinación suficientemente fuerte para atribuir el resultado únicamente a distribución.',
    action: cpmStatus.action
  };
}


function messageCpcBandCC(cpc) {
  const value = toNumber(cpc);

  if (value <= 0) {
    return {
      level: 'SIN DATOS',
      tone: 'neutral',
      rank: 0,
      apt: false,
      value,
      summary: 'No hay CPC suficiente para evaluar el creativo como candidato a campañas de mensajes.'
    };
  }

  if (value < 500) {
    return {
      level: 'EXCELENTE',
      tone: 'good',
      rank: 6,
      apt: true,
      value,
      summary: `CPC ${fmtMoney(value)} · excelente para priorizar pruebas en campañas de mensajes.`
    };
  }

  if (value < 600) {
    return {
      level: 'SOBRESALIENTE',
      tone: 'good',
      rank: 5,
      apt: true,
      value,
      summary: `CPC ${fmtMoney(value)} · sobresaliente para campañas de mensajes.`
    };
  }

  if (value < 800) {
    return {
      level: 'MUY BUENO',
      tone: 'good',
      rank: 4,
      apt: true,
      value,
      summary: `CPC ${fmtMoney(value)} · muy buena señal para campañas de mensajes.`
    };
  }

  if (value < 1000) {
    return {
      level: 'BUENO',
      tone: 'good',
      rank: 3,
      apt: true,
      value,
      summary: `CPC ${fmtMoney(value)} · buen rango para considerar una prueba en mensajes.`
    };
  }

  if (value <= 1200) {
    return {
      level: 'ACEPTABLE',
      tone: 'attention',
      rank: 2,
      apt: true,
      value,
      summary: `CPC ${fmtMoney(value)} · aceptable para mensajes, pero necesita que CTR/CPM y estabilidad acompañen.`
    };
  }

  return {
    level: 'NO APTO ACTUALMENTE',
    tone: 'critical',
    rank: 1,
    apt: false,
    value,
    summary: `CPC ${fmtMoney(value)} · supera el límite operativo de ${fmtMoney(1200)} para priorizar este creativo en campañas de mensajes.`
  };
}

function messageCpcTrendTextCC(cpc, delta) {
  const band = messageCpcBandCC(cpc);
  if (delta === null || delta === undefined || !Number.isFinite(Number(delta))) {
    return `${band.summary} Sin bloque anterior comparable.`;
  }

  const d = Number(delta);
  if (Math.abs(d) < 5) {
    return `${band.summary} El CPC está estable frente al bloque anterior.`;
  }

  if (d > 0) {
    return `${band.summary} Además, se deterioró ${fmtNum(Math.abs(d), 1)}% frente al bloque anterior${band.apt ? ', pero todavía permanece dentro de un rango utilizable para mensajes.' : '.'}`;
  }

  return `${band.summary} Además, mejoró ${fmtNum(Math.abs(d), 1)}% frente al bloque anterior.`;
}

function messagePotentialDiagnosisCC(diag, benchmark, ad, periodLabel = '3D') {
  const stats = diag?.scale3d || {};
  const delta = diag?.scaleDelta3d || {};
  const hasClicks = stats?.clicks !== null && stats?.clicks !== undefined && toNumber(stats.clicks) > 0;
  const cpcBand = messageCpcBandCC(stats.cpc);

  if (!hasClicks || !toNumber(stats?.days)) {
    return {
      label: 'NO CONCLUYENTE',
      tone: 'neutral',
      cpcBand,
      summary: 'No hay señal suficiente de clics para evaluar este creativo como candidato a mensajes.',
      action: 'Acumular datos antes de reutilizarlo en Click-to-WhatsApp.'
    };
  }

  const ctrStatus = metricAbsoluteHealthCC('ctr', stats.ctr, {});
  const cpmStatus = metricAbsoluteHealthCC('cpm', stats.cpm, {});
  const cpcTrend = messageCpcTrendTextCC(stats.cpc, delta.cpc);

  const fatigueBad = ['Fatiga probable', 'Fatiga confirmada'].includes(diag?.scaleDynamic3d);
  const hh = diag?.hookHold3d;
  const video = hh?.isVideo === true;
  const videoCritical = video && (
    ['CRÍTICO'].includes(hh?.hook?.level) ||
    ['CRÍTICO'].includes(hh?.hold?.level)
  );

  if (!cpcBand.apt) {
    return {
      label: 'NO APTO ACTUALMENTE PARA MENSAJES',
      tone: 'critical',
      cpcBand,
      summary: `${cpcTrend} Aunque otras métricas puedan ser favorables, el CPC actual supera el límite operativo para priorizarlo en mensajes.`,
      action: 'No priorizar para campañas de mensajes hasta recuperar CPC ≤ $1.200.'
    };
  }

  if (fatigueBad || videoCritical) {
    return {
      label: 'POTENCIAL LIMITADO POR CREATIVO',
      tone: 'alert',
      cpcBand,
      summary: `${cpcTrend} Sin embargo, existen señales de deterioro creativo${videoCritical ? ' en Hook/Hold' : ''}.`,
      action: 'No descartar el concepto por CPC; primero renovar/variar el creativo y volver a medir.'
    };
  }

  const ctrHealthy = ctrStatus.healthy || ctrStatus.acceptable;
  const cpmHealthy = cpmStatus.healthy || cpmStatus.acceptable;

  if (cpcBand.rank >= 5 && ctrHealthy && cpmHealthy) {
    return {
      label: 'ALTO POTENCIAL PARA MENSAJES',
      tone: 'good',
      cpcBand,
      summary: `${cpcTrend} CTR y CPM acompañan la señal.${video ? ' Hook/Hold no muestran una falla crítica.' : ''}`,
      action: 'Candidato prioritario para probar en Click-to-WhatsApp. Esta clasificación no predice el costo real por conversación.'
    };
  }

  if (cpcBand.rank >= 3 && (ctrHealthy || cpmHealthy)) {
    return {
      label: 'BUEN CANDIDATO PARA TEST',
      tone: 'good',
      cpcBand,
      summary: `${cpcTrend} ${ctrHealthy ? 'El CTR acompaña.' : ''} ${cpmHealthy ? 'El CPM sigue controlado.' : ''}`.trim(),
      action: 'Probar en mensajes con presupuesto controlado y validar allí el costo real por conversación.'
    };
  }

  if (cpcBand.rank === 2 && ctrHealthy && cpmHealthy) {
    return {
      label: 'CANDIDATO A TEST · CPC ACEPTABLE',
      tone: 'attention',
      cpcBand,
      summary: `${cpcTrend} Como está en el rango aceptable, necesita apoyo claro de CTR/CPM para justificar la prueba.`,
      action: 'Testear con presupuesto limitado; no tratarlo como candidato prioritario.'
    };
  }

  return {
    label: 'POTENCIAL NO CONCLUYENTE',
    tone: 'neutral',
    cpcBand,
    summary: `${cpcTrend} El CPC es utilizable, pero CTR/CPM o estabilidad todavía no forman un patrón suficientemente fuerte.`,
    action: 'Mantener en observación y comparar contra más historial.'
  };
}


const CAMPAIGN_CHANGE_RULES_CC = {
  structuralHours: 48,
  safeScaleHours: 24,
  maxSafeScalePct: 20
};

function firestoreTimeMsCC(value) {
  if (!value) return null;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (Number.isFinite(Number(value?.seconds))) {
    return Number(value.seconds) * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1e6);
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function changeEventTimeMsCC(item) {
  const client = toNumber(item?.clientRecordedAtMs);
  if (client > 0) return client;

  const candidates = [
    item?.createdAt,
    item?.updatedAt,
    item?.appliedAt,
    item?.stateChangedAt
  ];

  for (const candidate of candidates) {
    const ms = firestoreTimeMsCC(candidate);
    if (ms) return ms;
  }

  // Fallback histórico: solo sirve para contexto, no precisión horaria perfecta.
  const date = String(item?.date || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const ms = new Date(`${date}T12:00:00-05:00`).getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  return null;
}

function hoursRemainingCC(targetMs, nowMs = Date.now()) {
  if (!targetMs || targetMs <= nowMs) return 0;
  return (targetMs - nowMs) / 3600000;
}

function fmtHoursRemainingCC(hours) {
  const h = Math.max(0, Number(hours) || 0);
  if (h <= 0) return 'Disponible ahora';
  const whole = Math.floor(h);
  const minutes = Math.ceil((h - whole) * 60);
  if (whole <= 0) return `${minutes} min`;
  if (minutes >= 60) return `${whole + 1} h`;
  return `${whole} h ${minutes} min`;
}

function classifyDecisionChangeCC(decision) {
  const explicit = String(decision?.changeType || '').trim();
  if (explicit) return explicit;

  const action = String(decision?.action || '').toLowerCase();

  if (action.includes('anuncio apagado') || action.includes('anuncio encendido')) return 'ad_state';
  if (action.includes('anuncio creado') || action.includes('anuncio agregado')) return 'ad_added';
  if (action.includes('campaña encendida')) return 'campaign_state';
  if (action.includes('campaña apagada')) return 'campaign_state';
  return null;
}

function buildCampaignChangeSafetyCC(campaign, budgetChanges = [], decisions = [], nowMs = Date.now()) {
  if (!campaign?.id) {
    return {
      active: false,
      status: 'SIN CAMPAÑA',
      tone: 'neutral',
      canScaleNow: false,
      canStructuralNow: false,
      nextScaleAt: null,
      nextStructuralAt: null,
      scaleRemainingHours: 0,
      structuralRemainingHours: 0,
      lastEvent: null,
      events: []
    };
  }

  if (campaign.active === false || campaign.archived) {
    return {
      active: false,
      status: campaign.archived ? 'NO APLICA · CAMPAÑA ARCHIVADA' : 'NO APLICA · CAMPAÑA APAGADA',
      tone: 'neutral',
      canScaleNow: false,
      canStructuralNow: false,
      nextScaleAt: null,
      nextStructuralAt: null,
      scaleRemainingHours: 0,
      structuralRemainingHours: 0,
      lastEvent: null,
      events: []
    };
  }

  const structuralEvents = (decisions || [])
    .filter(d => d.campaignId === campaign.id)
    .map(d => {
      const type = classifyDecisionChangeCC(d);
      const timeMs = changeEventTimeMsCC(d);
      if (!type || !timeMs) return null;
      return {
        id: d.id,
        source: 'decision',
        type,
        timeMs,
        action: d.action || 'Cambio estructural',
        detail: d.detail || '',
        structuralUntil: timeMs + CAMPAIGN_CHANGE_RULES_CC.structuralHours * 3600000,
        scaleUntil: timeMs + CAMPAIGN_CHANGE_RULES_CC.structuralHours * 3600000
      };
    })
    .filter(Boolean);

  const budgetEvents = (budgetChanges || [])
    .filter(b => b.campaignId === campaign.id)
    .map(b => {
      const timeMs = changeEventTimeMsCC(b);
      if (!timeMs) return null;
      const pct = toNumber(b.changePct);
      const safeScale = pct > 0 && pct <= CAMPAIGN_CHANGE_RULES_CC.maxSafeScalePct;
      const structuralHours = CAMPAIGN_CHANGE_RULES_CC.structuralHours;
      const scaleHours = safeScale
        ? CAMPAIGN_CHANGE_RULES_CC.safeScaleHours
        : CAMPAIGN_CHANGE_RULES_CC.structuralHours;

      return {
        id: b.id,
        source: 'budget',
        type: safeScale ? 'budget_scale_safe' : 'budget_change_major',
        timeMs,
        action: safeScale ? 'Escalamiento de presupuesto' : 'Cambio de presupuesto',
        detail: `${fmtMoney(b.previousBudget)} → ${fmtMoney(b.newBudget)} (${pct > 0 ? '+' : ''}${fmtNum(pct, 2)}%)`,
        changePct: pct,
        safeScale,
        structuralUntil: timeMs + structuralHours * 3600000,
        scaleUntil: timeMs + scaleHours * 3600000
      };
    })
    .filter(Boolean);

  const events = [...structuralEvents, ...budgetEvents]
    .sort((a, b) => b.timeMs - a.timeMs);

  const nextScaleAt = events.reduce((max, e) => Math.max(max, toNumber(e.scaleUntil)), 0) || null;
  const nextStructuralAt = events.reduce((max, e) => Math.max(max, toNumber(e.structuralUntil)), 0) || null;

  const canScaleNow = !nextScaleAt || nowMs >= nextScaleAt;
  const canStructuralNow = !nextStructuralAt || nowMs >= nextStructuralAt;

  const scaleRemainingHours = hoursRemainingCC(nextScaleAt, nowMs);
  const structuralRemainingHours = hoursRemainingCC(nextStructuralAt, nowMs);

  let status = 'MARGEN SEGURO PARA CAMBIOS';
  let tone = 'good';
  let summary = 'No hay un cambio registrado dentro de la ventana de seguridad.';

  if (!canScaleNow && !canStructuralNow) {
    status = 'VENTANA DE ESTABILIZACIÓN ACTIVA';
    tone = 'alert';
    summary = `Espera ${fmtHoursRemainingCC(Math.max(scaleRemainingHours, structuralRemainingHours))} antes de otro cambio importante.`;
  } else if (canScaleNow && !canStructuralNow) {
    status = 'ESCALAMIENTO DISPONIBLE · OTROS CAMBIOS EN ESPERA';
    tone = 'attention';
    summary = `Puedes considerar otro escalamiento de hasta +${CAMPAIGN_CHANGE_RULES_CC.maxSafeScalePct}% si la campaña lo justifica. Para apagar/encender anuncios u otro cambio estructural faltan ${fmtHoursRemainingCC(structuralRemainingHours)}.`;
  }

  return {
    active: true,
    status,
    tone,
    summary,
    canScaleNow,
    canStructuralNow,
    nextScaleAt,
    nextStructuralAt,
    scaleRemainingHours,
    structuralRemainingHours,
    lastEvent: events[0] || null,
    events
  };
}

function useSafetyClockCC() {
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60000);
    return () => window.clearInterval(id);
  }, []);

  return nowMs;
}

function CampaignChangeSafetyCardCC({ safety, currentBudget = null }) {
  if (!safety) return null;

  const maxScaleBudget = toNumber(currentBudget) > 0
    ? toNumber(currentBudget) * (1 + CAMPAIGN_CHANGE_RULES_CC.maxSafeScalePct / 100)
    : null;

  return (
    <div className={`rounded-2xl border-2 p-3.5 sm:p-4 lg:p-5 ${toneBg(safety.tone || 'neutral')}`}>
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[8px] font-black uppercase text-slate-500">Margen de seguridad para cambios</p>
            <span className={`px-2 py-1 rounded-full text-[7px] font-black uppercase ${toneBadge(safety.tone || 'neutral')}`}>
              {safety.status}
            </span>
          </div>

          <p className="text-[9px] font-bold text-zinc-800 mt-2 leading-relaxed">{safety.summary}</p>

          {safety.lastEvent ? (
            <p className="text-[8px] text-slate-500 mt-2 leading-relaxed">
              Último cambio registrado: <strong>{safety.lastEvent.action}</strong>
              {safety.lastEvent.detail ? ` · ${safety.lastEvent.detail}` : ''}
            </p>
          ) : (
            <p className="text-[8px] text-slate-500 mt-2">Sin cambios recientes registrados que activen el margen de seguridad.</p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:w-[430px] gap-2">
          <div className={`rounded-xl border p-3 ${safety.canScaleNow ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
            <p className="text-[7px] font-black uppercase leading-tight text-slate-500" style={{ overflowWrap: 'break-word', wordBreak: 'normal' }}>Escalamiento de presupuesto</p>
            <p className={`text-[9px] sm:text-[10px] font-black leading-tight mt-1 ${safety.canScaleNow ? 'text-emerald-700' : 'text-amber-700'}`}>
              {safety.canScaleNow ? 'DISPONIBLE' : `ESPERAR ${fmtHoursRemainingCC(safety.scaleRemainingHours)}`}
            </p>
            <p className="text-[7px] text-slate-500 mt-1.5">
              Regla interna: máximo +20% cada 24 h.
              {maxScaleBudget ? ` · Desde ${fmtMoney(currentBudget)}: hasta ${fmtMoney(maxScaleBudget)}.` : ''}
            </p>
          </div>

          <div className={`rounded-xl border p-3 ${safety.canStructuralNow ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
            <p className="text-[7px] font-black uppercase leading-tight text-slate-500" style={{ overflowWrap: 'break-word', wordBreak: 'normal' }}>Apagar/encender anuncios y otros cambios</p>
            <p className={`text-[9px] sm:text-[10px] font-black leading-tight mt-1 ${safety.canStructuralNow ? 'text-emerald-700' : 'text-rose-700'}`}>
              {safety.canStructuralNow ? 'MARGEN SEGURO' : `ESPERAR ${fmtHoursRemainingCC(safety.structuralRemainingHours)}`}
            </p>
            <p className="text-[7px] text-slate-500 mt-1.5">Regla interna: 48 h entre cambios estructurales.</p>
          </div>
        </div>
      </div>

      <p className="text-[7px] text-slate-400 mt-3 leading-relaxed">
        Regla operativa interna de protección. Meta puede considerar significativos ciertos cambios y no publica un corte universal de 20% ni una espera oficial fija de 48 h.
      </p>
    </div>
  );
}

function budgetImpactDiagnosisCC(contribution, stats, maxCpa) {
  const share = toNumber(contribution?.spendShare);
  const cpa = stats?.cpa;
  const badResult = cpa !== null && cpa !== undefined && toNumber(cpa) > Math.max(1, toNumber(maxCpa));
  const noPurchaseRisk = toNumber(stats?.purchases) <= 0 && toNumber(stats?.spend) >= Math.max(1, toNumber(maxCpa)) * 0.5;

  let level = 'LIMITADO';
  let tone = 'normal';
  let priority = 1;
  if (share >= 25) { level = 'ALTO'; priority = 4; }
  else if (share >= 15) { level = 'MEDIO'; priority = 3; }
  else if (share >= 5) { level = 'MODERADO'; priority = 2; }

  if ((badResult || noPurchaseRisk) && share >= 25) tone = 'critical';
  else if ((badResult || noPurchaseRisk) && share >= 15) tone = 'alert';
  else if (contribution?.status === 'Aporta fuertemente' && share >= 15) tone = 'good';
  else if (badResult || noPurchaseRisk) tone = 'attention';

  const resultContext =
    badResult ? 'mientras opera por encima del CPA máximo' :
    noPurchaseRisk ? 'mientras todavía no genera compras' :
    contribution?.status === 'Aporta fuertemente' || contribution?.status === 'Aporta'
      ? 'con una contribución actualmente favorable'
      : 'dentro de la campaña';

  return {
    level,
    tone,
    priority,
    share,
    summary: `El anuncio concentra ${fmtNum(share, 2)}% del gasto total de campaña ${resultContext}.`,
    action:
      tone === 'critical' ? 'Prioridad alta de intervención.' :
      tone === 'alert' ? 'Prioridad media-alta de revisión.' :
      tone === 'good' ? 'Impacto económico favorable relevante.' :
      'Impacto económico limitado/moderado.'
  };
}

function relationalConfidenceCC(diag, periodLabel = '3D') {
  const purchases = toNumber(diag?.scale3d?.purchases);
  const clicks = diag?.scale3d?.clicks === null || diag?.scale3d?.clicks === undefined
    ? null
    : toNumber(diag.scale3d.clicks);
  const spend = toNumber(diag?.scale3d?.spend);
  const label = diag?.volumeReference?.confidence || 'Sin muestra';

  return {
    label,
    purchases,
    clicks,
    spend,
    summary: `${fmtNum(purchases, 0)} compra(s)${clicks !== null ? ` · ${fmtNum(clicks, 0)} clic(s)` : ''} · ${fmtMoney(spend)} de gasto en la ventana ${periodLabel}.`
  };
}

function buildRelationalAdDiagnosticCC(diag, contribution, maxCpa, ad = null, benchmark = null, periodLabel = '3D') {
  const s = diag?.scale3d || {};
  const p = diag?.scalePrev3d || {};
  const d = diag?.scaleDelta3d || {};
  const max = Math.max(1, toNumber(maxCpa));
  const hh = diag?.hookHold3d;
  const isVideo = hh?.isVideo === true;
  const metricStatus = metricSetDiagnosisCC(s, p, max);

  const cpa = s.cpa;
  const cpaDelta = d.cpa;
  const cpaVsMax = cpa !== null && cpa !== undefined
    ? ((toNumber(cpa) - max) / max) * 100
    : null;

  const resultTone =
    toNumber(s.purchases) <= 0 && toNumber(s.spend) >= max ? 'critical' :
    cpa !== null && cpa !== undefined && toNumber(cpa) > max && cpaDelta !== null && cpaDelta > 15 ? 'critical' :
    cpa !== null && cpa !== undefined && toNumber(cpa) > max ? 'alert' :
    cpa !== null && cpa !== undefined && toNumber(cpa) <= max * 0.8 ? 'good' :
    cpa !== null && cpa !== undefined && toNumber(cpa) <= max ? 'normal' : 'attention';

  let resultTitle = metricStatus.cpa.combinedLabel;
  let resultSummary = metricStatus.cpa.summary;
  if (cpa !== null && cpa !== undefined) {
    const relation = cpaVsMax > 0
      ? `${fmtNum(Math.abs(cpaVsMax), 2)}% por encima del máximo`
      : `${fmtNum(Math.abs(cpaVsMax), 2)}% por debajo del máximo`;
    resultSummary = `CPA ${fmtCpa(cpa)} · ${relation} (${fmtMoney(max)}). ${metricStatus.cpa.summary}`;
  }

  const impact = budgetImpactDiagnosisCC(contribution, s, max);

  // DISTRIBUTION
  const cpmDelta = d.cpm;
  let distributionTone = metricStatus.cpm.combinedTone;
  let distributionTitle = metricStatus.cpm.combinedLabel;
  const distributionSummary = metricStatus.cpm.summary;

  const distributionHypothesis = cpmDelta !== null && cpmDelta > 10
    ? 'Puede estar relacionado con competencia, cambios de audiencia, placements, temporalidad u otros factores de distribución. El CPM no demuestra una causa única.'
    : 'No existe evidencia suficiente para atribuir una causa específica únicamente desde CPM.';

  // CREATIVE RESPONSE
  const ctrDelta = d.ctr;
  const hookDelta = d.hookRate;
  const holdDelta = d.holdRate;
  let creativeTone = metricStatus.ctr.combinedTone;
  let creativeTitle = metricStatus.ctr.combinedLabel;
  let creativeSummary = metricStatus.ctr.summary;

  if (isVideo) {
    const hookContext = videoTrendHealthTextCC('Hook', hh?.hook, hookDelta);
    const holdContext = videoTrendHealthTextCC('Hold', hh?.hold, holdDelta);
    creativeSummary += ` Hook ${fmtRate(s.hookRate)} · Hold ${fmtRate(s.holdRate)}.${hookContext ? ` ${hookContext}` : ''}${holdContext ? ` ${holdContext}` : ''}`;

    const hookBelow = hh?.hook && !videoLevelHealthyCC(hh.hook.level) && !videoLevelAcceptableCC(hh.hook.level);
    const holdBelow = hh?.hold && !videoLevelHealthyCC(hh.hold.level) && !videoLevelAcceptableCC(hh.hold.level);

    if (
      metricStatus.ctr.actionable &&
      ctrDelta !== null && ctrDelta < -10 &&
      hookBelow &&
      holdBelow
    ) {
      creativeTone = 'critical';
      creativeTitle = 'ACCIÓN · DETERIORO PRE-CLIC Y NIVELES DÉBILES';
    }
  }

  // TRAFFIC COST: CPM + CTR -> CPC
  const cpcDelta = d.cpc;
  let trafficTone = metricStatus.cpc.combinedTone;
  let trafficTitle = metricStatus.cpc.combinedLabel;
  let trafficSummary = metricStatus.cpc.summary;

  if (cpcDelta !== null && cpmDelta !== null && ctrDelta !== null) {
    if (cpmDelta > 10 && ctrDelta > 10 && cpcDelta > 0) {
      trafficSummary += ` El CPM aumentó ${fmtNum(cpmDelta, 2)}%, pero la mejora del CTR (${fmtNum(ctrDelta, 2)}%) amortiguó parcialmente el incremento; el CPC terminó +${fmtNum(cpcDelta, 2)}%.`;
    } else if (cpmDelta > 10 && ctrDelta < -10 && cpcDelta > 10) {
      trafficSummary += ' El aumento del CPM y la caída del CTR presionan simultáneamente el CPC.';
    } else if (Math.abs(cpmDelta) <= 10 && ctrDelta < -10 && cpcDelta > 10) {
      trafficSummary += ' Con CPM relativamente estable, el deterioro del CTR explica mejor el aumento del CPC.';
    } else if (cpmDelta > 10 && Math.abs(ctrDelta) <= 10 && cpcDelta > 10) {
      trafficSummary += ' Con CTR relativamente estable, el incremento del CPM explica gran parte del aumento del CPC.';
    } else if (cpcDelta < -10 && ctrDelta > 10) {
      trafficSummary += ' La mejora del CTR está ayudando a abaratar el clic.';
    }
  }

  // POST-CLICK / CVR
  const cvr = s.visitToPurchase;
  const prevCvr = p.visitToPurchase;
  const cvrDelta = d.visitToPurchase;
  const quality = diag?.scalePostDataQuality3d || postClickDataQualityCC(s);

  let postTone = metricStatus.cvr.combinedTone;
  let postTitle = metricStatus.cvr.combinedLabel;
  let postSummary = metricStatus.cvr.summary;
  let peerInterpretation = '';

  if (quality?.level === 'missing') {
    postTone = 'attention';
    postTitle = 'DATOS POST-CLIC INCOMPLETOS';
    postSummary = quality.reason || 'No hay datos post-clic suficientes para evaluar CVR.';
  }

  const peerCurrent = contribution?.peerVisitToPurchase;
  const peerPrevious = contribution?.peerPreviousVisitToPurchase;
  const peerDelta = contribution?.peerCvrDelta;
  if (cvr !== null && cvr !== undefined && peerCurrent !== null && peerCurrent !== undefined) {
    if (cvrDelta !== null && cvrDelta <= -20 && (peerDelta === null || peerDelta > -10) && toNumber(cvr) < toNumber(peerCurrent) * 0.8) {
      peerInterpretation = `Los otros anuncios de la misma campaña convierten a ${fmtRate(peerCurrent)} en la misma ventana, frente a ${fmtRate(cvr)} de este anuncio. El deterioro parece más concentrado en la calidad/composición del tráfico de este anuncio que en un problema común demostrado de página.`;
    } else if (
      cvrDelta !== null && cvrDelta <= -20 &&
      peerDelta !== null && peerDelta <= -20
    ) {
      peerInterpretation = `Este anuncio y los demás anuncios de la campaña muestran caída de CVR en la misma ventana (otros anuncios ${fmtNum(peerDelta, 2)}%). Existe evidencia de un deterioro post-clic más general que amerita revisar factores comunes: página, oferta, checkout, tráfico u otros.`;
    } else {
      peerInterpretation = `CVR del anuncio ${fmtRate(cvr)} vs otros anuncios de la misma campaña ${fmtRate(peerCurrent)} en la misma ventana.`;
    }
  } else {
    peerInterpretation = 'No hay una base suficiente para comparar CVR contra otros anuncios en exactamente la misma ventana.';
  }

  // Identify main layer moving CPA.
  const badCpa = metricStatus.cpa.actionable;
  const postSevere = metricStatus.cvr.actionable && cvrDelta !== null && cvrDelta <= -15;
  const creativeBad = metricStatus.ctr.actionable && ctrDelta !== null && ctrDelta <= -10;
  const distributionBad = metricStatus.cpm.actionable;
  const cpcBad = metricStatus.cpc.actionable;
  const cvrStable = !metricStatus.cvr.actionable && (cvrDelta === null || Math.abs(cvrDelta) <= 15);
  const ctrStableOrBetter = !metricStatus.ctr.actionable;

  let generalTone = resultTone;
  let generalTitle = 'SIN DETERIORO PRINCIPAL IDENTIFICADO';
  let interpretation = 'Las métricas no muestran una capa dominante de deterioro en esta ventana.';
  let hypothesis = 'Continuar observando la cadena completa antes de atribuir una causa.';
  let primaryLayer = 'Resultado comercial';

  const healthyDeteriorations = [
    metricStatus.cpa,
    metricStatus.cpm,
    metricStatus.ctr,
    metricStatus.cpc,
    metricStatus.cvr
  ].filter(x => x?.trend?.deteriorating && !x?.actionable);

  if (!badCpa && healthyDeteriorations.length > 0) {
    generalTone = 'attention';
    generalTitle = 'ALERTA DE DETERIORO · NIVELES AÚN CONTROLADOS';
    primaryLayer = 'Vigilancia';
    interpretation = `Hay ${healthyDeteriorations.length} métrica(s) empeorando frente al período anterior, pero todavía permanecen dentro de rangos saludables o aceptables. La caída relativa es una alerta, no una razón automática para intervenir.`;
    hypothesis = 'Vigilar si el deterioro continúa hasta cruzar los estándares operativos o si empieza a afectar el CPA/contribución.';
  } else if (badCpa && postSevere && distributionBad) {
    generalTone = 'critical';
    generalTitle = 'PROBLEMA MIXTO · POST-CLIC ES LA MAYOR SEÑAL';
    primaryLayer = 'Post-clic';
    interpretation = `El CPA se deteriora con presión adicional en CPM/CPC, pero la caída del CVR (${fmtNum(Math.abs(cvrDelta), 2)}%) es la señal negativa más fuerte de la cadena.`;
    hypothesis = 'Puede existir un cambio en calidad del tráfico, página, oferta, checkout u otro factor posterior al clic. Comparar contra los demás anuncios antes de atribuirlo a la landing.';
  } else if (badCpa && postSevere && ctrStableOrBetter) {
    generalTone = 'critical';
    generalTitle = 'DETERIORO PRINCIPAL POST-CLIC';
    primaryLayer = 'Post-clic';
    interpretation = 'El anuncio mantiene o mejora su capacidad de generar clics, pero la conversión después del clic cayó con fuerza y coincide con el deterioro del CPA.';
    hypothesis = 'La causa puede estar en calidad/composición del tráfico o en factores comunes posteriores al clic. La comparación con otros anuncios ayuda a distinguirlos.';
  } else if (badCpa && creativeBad && cvrStable) {
    generalTone = 'alert';
    generalTitle = 'DETERIORO PRINCIPAL PRE-CLIC / CREATIVO';
    primaryLayer = 'Respuesta creativa';
    interpretation = 'El CVR permanece relativamente estable, mientras CTR cae y CPC se encarece. La mayor señal de deterioro aparece antes del clic.';
    hypothesis = isVideo
      ? 'Revisar Hook/Hold/CTR para localizar si el problema está en apertura, desarrollo o capacidad de llevar al clic.'
      : 'En imagen, la caída del CTR sugiere menor respuesta al creativo; validar frecuencia y nuevas variantes.';
  } else if (badCpa && distributionBad && ctrStableOrBetter && cvrStable && cpcBad) {
    generalTone = 'alert';
    generalTitle = 'PRESIÓN PRINCIPAL EN DISTRIBUCIÓN / COSTO DEL TRÁFICO';
    primaryLayer = 'Distribución';
    interpretation = 'CTR y CVR permanecen relativamente estables, mientras CPM y CPC aumentan. El deterioro observado se concentra antes de la conversión, en el costo de conseguir impresiones y clics.';
    hypothesis = 'El CPM puede variar por competencia, audiencia, placements, temporalidad u otros factores; no se puede demostrar una causa única desde estas métricas.';
  } else if (badCpa && creativeBad && postSevere) {
    generalTone = 'critical';
    generalTitle = 'DETERIORO MIXTO · PRE-CLIC + POST-CLIC';
    primaryLayer = 'Mixto';
    interpretation = 'La respuesta creativa y la conversión post-clic se deterioran simultáneamente; ambas capas están presionando el CPA.';
    hypothesis = 'Evitar atribuir el problema a una sola causa. Revisar creativo y comparar CVR contra otros anuncios de la misma página.';
  } else if (cpa !== null && cpa !== undefined && toNumber(cpa) <= max && cpaDelta !== null && cpaDelta < -10) {
    generalTone = 'good';
    generalTitle = 'RESULTADO MEJORANDO · IDENTIFICAR QUÉ CONSERVAR';
    primaryLayer = 'Mejora';
    const drivers = [];
    if (cpcDelta !== null && cpcDelta < -10) drivers.push(`CPC ${fmtNum(cpcDelta, 2)}%`);
    if (cvrDelta !== null && cvrDelta > 10) drivers.push(`CVR +${fmtNum(cvrDelta, 2)}%`);
    if (ctrDelta !== null && ctrDelta > 10) drivers.push(`CTR +${fmtNum(ctrDelta, 2)}%`);
    interpretation = drivers.length
      ? `El CPA mejora y las principales señales favorables son ${drivers.join(' · ')}.`
      : 'El CPA mejora sin una única métrica dominante; conservar la combinación actual y seguir midiendo.';
    hypothesis = 'Usar Hook/Hold, CTR y CVR para decidir qué elementos replicar sin modificar el ganador actual.';
  } else if (cpa !== null && cpa !== undefined && toNumber(cpa) <= max) {
    generalTone = 'normal';
    generalTitle = 'RESULTADO COMERCIAL CONTROLADO';
    primaryLayer = 'Resultado comercial';
    interpretation = 'El CPA se mantiene dentro del objetivo y no existe una señal combinada suficientemente fuerte para intervenir agresivamente.';
    hypothesis = 'Mantener y vigilar cualquier deterioro emergente antes de modificar el anuncio.';
  }

  const factParts = [];
  if (cpa !== null && cpa !== undefined) factParts.push(`CPA ${fmtCpa(cpa)} vs máximo ${fmtMoney(max)}`);
  if (cpaDelta !== null) factParts.push(`CPA ${cpaDelta > 0 ? '+' : ''}${fmtNum(cpaDelta, 2)}% vs ${periodLabel} previo`);
  if (cpmDelta !== null) factParts.push(`CPM ${cpmDelta > 0 ? '+' : ''}${fmtNum(cpmDelta, 2)}%`);
  if (ctrDelta !== null) factParts.push(`CTR ${ctrDelta > 0 ? '+' : ''}${fmtNum(ctrDelta, 2)}%`);
  if (cpcDelta !== null) factParts.push(`CPC ${cpcDelta > 0 ? '+' : ''}${fmtNum(cpcDelta, 2)}%`);
  if (cvrDelta !== null) factParts.push(`CVR ${cvrDelta > 0 ? '+' : ''}${fmtNum(cvrDelta, 2)}%`);
  factParts.push(`gasto campaña ${fmtNum(toNumber(contribution?.spendShare), 2)}%`);

  const generalSummary =
    `${resultSummary} ${distributionSummary} ${creativeSummary} ${trafficSummary} ${postSummary}`.replace(/\s+/g, ' ').trim();

  const resultPlain = cpa !== null && cpa !== undefined
    ? `Cada compra está costando ${fmtCpa(cpa)}. Tu límite configurado es ${fmtMoney(max)}.${cpaVsMax > 0 ? ` Hoy estás pagando ${fmtNum(Math.abs(cpaVsMax), 1)}% más de lo permitido.` : ` Estás ${fmtNum(Math.abs(cpaVsMax), 1)}% por debajo del límite.`}`
    : toNumber(s.spend) > 0 && toNumber(s.purchases) <= 0
      ? `En la ventana ${periodLabel} se gastaron ${fmtMoney(s.spend)} y todavía no hubo compras, por eso no existe un CPA real para calcular.`
      : 'Todavía no hay información suficiente para juzgar el costo por compra.';

  const impactPlain = `De cada $100 que gastó la campaña en esta ventana, este anuncio usó aproximadamente $${fmtNum(toNumber(contribution?.spendShare), 1)}.`;

  const distributionPlain = s.cpm !== null && s.cpm !== undefined
    ? `Mostrar el anuncio 1.000 veces está costando ${fmtMoneyOrDashCC(s.cpm)}.${cpmDelta === null ? '' : ` Ese costo ${cpmDelta > 0 ? 'subió' : cpmDelta < 0 ? 'bajó' : 'se mantuvo'} ${fmtNum(Math.abs(cpmDelta), 1)}% frente a la ventana anterior comparable.`}`
    : 'No hay suficiente información para saber cuánto está costando mostrar el anuncio.';

  const creativePlain = s.ctr !== null && s.ctr !== undefined
    ? `De cada 100 impresiones, aproximadamente ${fmtNum(toNumber(s.ctr), 2)} terminan en clic.${ctrDelta === null ? '' : ` La respuesta ${ctrDelta > 10 ? 'mejoró' : ctrDelta < -10 ? 'empeoró' : 'se mantiene parecida'} frente al bloque anterior.`}`
    : 'No hay suficiente información para medir qué tan bien el anuncio convierte impresiones en clics.';

  const trafficPlain = s.cpc !== null && s.cpc !== undefined
    ? `Cada clic está costando ${fmtMoneyOrDashCC(s.cpc)}.${cpcDelta === null ? '' : ` Es ${fmtNum(Math.abs(cpcDelta), 1)}% ${cpcDelta > 0 ? 'más caro' : cpcDelta < 0 ? 'más barato' : 'similar'} que antes.`}`
    : 'No hay suficiente información para calcular cuánto está costando cada clic.';

  const postPlain = cvr !== null && cvr !== undefined
    ? `De cada 100 visitas a la página, aproximadamente ${fmtNum(toNumber(cvr), 2)} terminan comprando.${cvrDelta === null ? '' : ` Esta conversión ${cvrDelta > 10 ? 'mejoró' : cvrDelta < -10 ? 'empeoró' : 'se mantiene parecida'} ${fmtNum(Math.abs(cvrDelta), 1)}% frente al bloque anterior.`}`
    : 'No hay suficiente información post-clic para saber cuántas visitas terminan comprando.';

  let simpleStory = interpretation;
  if (generalTitle.includes('POST-CLIC')) {
    simpleStory = `El anuncio todavía logra llevar personas a la página, pero una proporción mucho menor termina comprando. El problema más grande aparece después del clic, no en conseguir el clic.`;
  } else if (generalTitle.includes('PRE-CLIC') || generalTitle.includes('CREATIVO')) {
    simpleStory = `El anuncio está perdiendo capacidad para provocar clics antes de que la persona llegue a la página. La señal principal está en el creativo y en el costo del tráfico.`;
  } else if (generalTitle.includes('DISTRIBUCIÓN')) {
    simpleStory = `El anuncio sigue respondiendo de forma parecida, pero Meta está cobrando más por mostrarlo y eso está encareciendo cada clic y cada compra.`;
  } else if (generalTitle.includes('MIXTO')) {
    simpleStory = `No hay un solo problema: una parte del deterioro ocurre antes del clic y otra después de llegar a la página. Conviene corregir cada capa por separado.`;
  } else if (generalTone === 'good') {
    simpleStory = `El anuncio está mejorando. La prioridad es identificar qué parte está funcionando mejor para repetirla en nuevas variantes sin tocar el ganador actual.`;
  } else if (cpa !== null && cpa !== undefined && toNumber(cpa) <= max) {
    simpleStory = `El anuncio sigue dentro del costo máximo permitido. Hay cosas para vigilar, pero los datos no justifican una intervención agresiva.`;
  }

  return {
    primaryLayer,
    general: {
      title: generalTitle,
      tone: generalTone,
      summary: generalSummary,
      simpleStory,
      fact: factParts.join(' · '),
      interpretation,
      hypothesis
    },
    result: { title: resultTitle, tone: resultTone, summary: resultSummary, plain: resultPlain },
    impact: { ...impact, plain: impactPlain },
    distribution: {
      title: distributionTitle,
      tone: distributionTone,
      summary: distributionSummary,
      plain: distributionPlain,
      hypothesis: distributionHypothesis
    },
    creative: {
      title: creativeTitle,
      tone: creativeTone,
      summary: creativeSummary,
      plain: creativePlain
    },
    traffic: {
      title: trafficTitle,
      tone: trafficTone,
      summary: trafficSummary,
      plain: trafficPlain
    },
    postClick: {
      title: postTitle,
      tone: postTone,
      summary: postSummary,
      plain: postPlain,
      peerInterpretation
    },
    confidence: relationalConfidenceCC(diag, periodLabel),
    metricStatus,
    priorityScore: impact.priority + (generalTone === 'critical' ? 4 : generalTone === 'alert' ? 2 : generalTone === 'attention' ? 1 : 0)
  };
}

function buildPauseProtectionDecisionCC(diag, contribution, maxCpa) {
  const stats = diag?.scale3d || {};
  const delta = diag?.scaleDelta3d || {};
  const last = diag?.lastCompleteStats || {};
  const lastDelta = diag?.lastCompleteDelta || {};
  const max = Math.max(1, toNumber(maxCpa));

  const spend = toNumber(stats.spend);
  const purchases = toNumber(stats.purchases);
  const cpa = stats.cpa;
  const spendMultiple = spend / max;
  const share = toNumber(contribution?.spendShare);
  const removalImprovement = contribution?.removalImprovementPct;
  const drains = contribution?.status === 'Drena la campaña';
  const highImpact = share >= 25;
  const relevantImpact = share >= 15;
  const meaningfulRemoval = removalImprovement !== null && removalImprovement !== undefined && toNumber(removalImprovement) >= 10;
  const commercialBad = purchases <= 0 ? spend >= max : (cpa !== null && cpa !== undefined && toNumber(cpa) > max);
  const enoughSpend = spend >= max;
  const has3d = toNumber(stats.days) >= 3;

  // El último día completo solo puede frenar una pausa; nunca reemplaza la decisión 3D.
  const recoveryByCpa =
    toNumber(last.purchases) > 0 &&
    last.cpa !== null && last.cpa !== undefined &&
    toNumber(last.cpa) <= max;

  const recoveryByTrend =
    toNumber(last.purchases) > 0 &&
    lastDelta.cpa !== null && lastDelta.cpa !== undefined &&
    toNumber(lastDelta.cpa) <= -20 &&
    last.cpa !== null && last.cpa !== undefined &&
    toNumber(last.cpa) <= max * 1.15;

  const recoveryByConversion =
    toNumber(last.purchases) > 0 &&
    lastDelta.visitToPurchase !== null && lastDelta.visitToPurchase !== undefined &&
    toNumber(lastDelta.visitToPurchase) >= 20 &&
    (lastDelta.cpc === null || lastDelta.cpc === undefined || toNumber(lastDelta.cpc) <= 10);

  const recoverySignal = recoveryByCpa || recoveryByTrend || recoveryByConversion;

  const hardNoPurchaseDamage = purchases <= 0 && spendMultiple >= 2;
  const strongNoPurchaseDrain = drains && purchases <= 0 && spendMultiple >= 1.5 && share >= 10;
  const confirmedDrainDamage =
    drains &&
    commercialBad &&
    enoughSpend &&
    (relevantImpact || meaningfulRemoval) &&
    has3d;

  const shouldPause =
    !recoverySignal &&
    (hardNoPurchaseDamage || strongNoPurchaseDrain || confirmedDrainDamage);

  const evidence = [];
  if (drains) evidence.push('el anuncio está drenando la eficiencia de la campaña');
  if (purchases <= 0) evidence.push(`gastó ${fmtNum(spendMultiple, 2)} veces tu CPA máximo sin compras`);
  else if (cpa !== null && cpa !== undefined && toNumber(cpa) > max) evidence.push(`su CPA está por encima del máximo (${fmtCpa(cpa)} vs ${fmtMoney(max)})`);
  if (share > 0) evidence.push(`consume ${fmtNum(share, 2)}% del presupuesto de la campaña`);
  if (meaningfulRemoval) evidence.push(`el CPA del resto mejora ${fmtNum(removalImprovement, 2)}% al excluir matemáticamente este anuncio`);
  if (delta.cpa !== null && delta.cpa !== undefined && toNumber(delta.cpa) > 15) evidence.push(`su CPA empeoró ${fmtNum(delta.cpa, 2)}% frente a los 3 días anteriores`);

  if (shouldPause) {
    return {
      label: 'PAUSAR',
      tone: 'critical',
      title: 'PAUSAR PARA PROTEGER PRESUPUESTO',
      damageConfirmed: true,
      recoverySignal: false,
      spendMultiple,
      share,
      reason: `${evidence.join('; ')}. Seguir financiándolo tiene más evidencia de daño económico que de recuperación en este momento.`,
      simple: `Este anuncio está usando dinero importante de la campaña y, con los datos actuales, está empeorando el resultado general. Pausarlo protege presupuesto. No significa que el creativo esté muerto para siempre: puede guardarse para un retest futuro.`,
      futureStatus: 'PAUSADO POR DRENAJE 3D · APTO PARA RETEST FUTURO'
    };
  }

  if (recoverySignal && (drains || commercialBad)) {
    return {
      label: 'VIGILAR',
      tone: 'attention',
      title: 'NO PAUSAR TODAVÍA · HAY SEÑAL DE RECUPERACIÓN',
      damageConfirmed: false,
      recoverySignal: true,
      spendMultiple,
      share,
      reason: `${evidence.join('; ')}. Sin embargo, el último día completo muestra una mejora suficiente para evitar una pausa inmediata.`,
      simple: `El bloque de 3 días sigue siendo malo, pero el último día completo empezó a mejorar. Conviene vigilar de cerca antes de cortar un anuncio que puede estar recuperándose.`,
      futureStatus: 'EN OBSERVACIÓN'
    };
  }

  if (drains && !shouldPause) {
    return {
      label: 'VIGILAR',
      tone: relevantImpact || meaningfulRemoval ? 'alert' : 'attention',
      title: 'DRENA, PERO AÚN NO HAY DAÑO SUFICIENTE PARA PAUSAR',
      damageConfirmed: false,
      recoverySignal: false,
      spendMultiple,
      share,
      reason: `${evidence.join('; ')}. La señal es negativa, pero todavía falta impacto, gasto o consistencia para convertirla en una pausa obligatoria.`,
      simple: `El anuncio está aportando menos de lo que cuesta, pero aún no hay suficiente daño económico para apagarlo por una regla automática.`,
      futureStatus: 'VIGILAR'
    };
  }

  if (commercialBad) {
    return {
      label: 'VIGILAR',
      tone: 'attention',
      title: 'RESULTADO MALO · IMPACTO TODAVÍA NO CONFIRMADO',
      damageConfirmed: false,
      recoverySignal: false,
      spendMultiple,
      share,
      reason: `${evidence.join('; ')}. El resultado es malo, pero no está demostrado que este anuncio esté dañando de forma importante a la campaña.`,
      simple: `El anuncio va mal, pero todavía no hay evidencia suficiente para afirmar que sea el responsable de deteriorar la campaña.`,
      futureStatus: 'VIGILAR'
    };
  }

  return {
    label: 'SIN PAUSA',
    tone: 'normal',
    title: 'SIN CRITERIO DE PAUSA',
    damageConfirmed: false,
    recoverySignal: false,
    spendMultiple,
    share,
    reason: 'No existe daño económico suficiente para recomendar una pausa.',
    simple: 'No hay evidencia suficiente para cortar este anuncio por protección de presupuesto.',
    futureStatus: 'ACTIVO'
  };
}

function adReadingActionCC(diag, contribution, maxCpa) {
  const pause = buildPauseProtectionDecisionCC(diag, contribution, maxCpa);

  if (pause.label === 'PAUSAR') {
    return {
      label: 'PAUSAR',
      tone: 'critical',
      title: pause.title,
      reason: pause.reason,
      simple: pause.simple,
      pause
    };
  }

  if (diag?.canScale && toNumber(diag?.scale3d?.cpa) > 0 && toNumber(diag?.scale3d?.cpa) <= Math.max(1, toNumber(maxCpa)) * 0.8) {
    return {
      label: 'ESCALAR',
      tone: 'good',
      title: 'ESCALAR CON CONTROL',
      reason: diag.operational3dReason,
      simple: 'El anuncio está vendiendo con suficiente margen y supera los controles de estabilidad, creativo y post-clic. Puede recibir más presupuesto de forma gradual.',
      pause
    };
  }

  if (
    pause.label === 'VIGILAR' ||
    diag?.operational3dPriority === 'critical' ||
    diag?.operational3dPriority === 'alert' ||
    contribution?.status === 'Bajo aporte / vigilar'
  ) {
    return {
      label: 'VIGILAR',
      tone: pause.tone === 'alert' || diag?.operational3dPriority === 'critical' ? 'critical' : 'attention',
      title: pause.label === 'VIGILAR' ? pause.title : 'VIGILAR ANTES DE INTERVENIR',
      reason: pause.label === 'VIGILAR' ? pause.reason : (diag.operational3dReason || contribution?.cause),
      simple: pause.label === 'VIGILAR'
        ? pause.simple
        : 'Hay una señal que merece atención, pero todavía no existe suficiente evidencia para cortar el anuncio.',
      pause
    };
  }

  return {
    label: 'MANTENER',
    tone: 'normal',
    title: 'MANTENER',
    reason: diag?.operational3dReason || 'El anuncio permanece dentro de una lectura operativa estable.',
    simple: 'El anuncio no muestra daño económico suficiente para intervenir. Manténlo activo y sigue midiendo.',
    pause
  };
}

function readingActionClassesCC(tone) {
  if (tone === 'critical') return {
    border: '#e11d48', bg: '#fff1f2', badge: 'bg-rose-600 text-white', text: 'text-rose-700'
  };
  if (tone === 'attention' || tone === 'alert') return {
    border: '#d97706', bg: '#fffbeb', badge: 'bg-amber-500 text-zinc-950', text: 'text-amber-700'
  };
  if (tone === 'good') return {
    border: '#059669', bg: '#ecfdf5', badge: 'bg-emerald-500 text-zinc-950', text: 'text-emerald-700'
  };
  return {
    border: '#2563eb', bg: '#eff6ff', badge: 'bg-blue-600 text-white', text: 'text-blue-700'
  };
}

function QuickMetricCC({
  label,
  value,
  previousValue = null,
  delta,
  metric,
  sub,
  periodLabel = '3D',
  previousPeriodLabel = null,
  healthStatus = null
}) {
  const hasPrevious = previousValue !== null && previousValue !== undefined && previousValue !== '—';
  const prevLabel = previousPeriodLabel || periodLabel;

  return (
    <div className="cc-metric-card min-w-0 h-full rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-3.5 sm:px-3.5 sm:py-3.5 lg:px-4 lg:py-4 cc-pro-card">
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <p className="text-[7px] font-black uppercase tracking-wide text-slate-400 leading-tight">{label}</p>
          <p className="text-[6.5px] font-black uppercase tracking-wide text-slate-300 mt-0.5 leading-tight">
            Actual · {periodLabel}
          </p>
        </div>

        <span className="shrink-0 text-[7px] leading-none whitespace-nowrap">
          <Delta metric={metric} value={delta}/>
        </span>
      </div>

      <div className="mt-3 min-h-[30px] flex items-center min-w-0 w-full">
        <p
          className="cc-value min-w-0 max-w-full font-black leading-tight tracking-[-0.015em] tabular-nums text-zinc-900 whitespace-nowrap"
          style={{ fontSize: 'clamp(17px, 1.05vw, 22px)' }}
        >
          {value}
        </p>
      </div>

      {healthStatus ? (
        <div className="mt-2 min-w-0">
          <span
            className={`inline-flex max-w-full px-2 py-1 rounded-md text-[6px] font-black uppercase leading-tight text-center ${toneBadge(healthStatus.combinedTone || healthStatus.tone || 'neutral')}`}
            style={{ overflowWrap: 'break-word', wordBreak: 'normal' }}
          >
            {healthStatus.combinedLabel || healthStatus.level}
          </span>
        </div>
      ) : null}

      <div className="mt-2.5 pt-2 border-t border-slate-200/80 min-w-0">
        <p className="text-[6.5px] sm:text-[7px] lg:text-[8px] font-black uppercase tracking-wide text-slate-400 leading-snug">
          Anterior · {prevLabel}
        </p>
        <p className="text-[10px] sm:text-[11px] font-black tabular-nums text-slate-600 mt-1 leading-snug whitespace-normal break-words">
          {hasPrevious ? previousValue : 'Sin dato comparable'}
        </p>
      </div>

      {sub ? (
        <p className="text-[7px] text-slate-500 mt-2 leading-snug min-h-[18px]">
          {sub}
        </p>
      ) : null}
    </div>
  );
}

function buildCampaignLayerDiagnosticCC(campaign3d, campaignPrev3d, rows = [], maxCpa, periodLabel = '3D', currentScaleStatus = null) {
  const max = Math.max(1, toNumber(maxCpa));
  const campaignMetricStatus = metricSetDiagnosisCC(campaign3d, campaignPrev3d, max);
  const delta = {
    cpa: pctChange(campaign3d?.cpa, campaignPrev3d?.cpa),
    cpm: pctChange(campaign3d?.cpm, campaignPrev3d?.cpm),
    ctr: pctChange(campaign3d?.ctr, campaignPrev3d?.ctr),
    cpc: pctChange(campaign3d?.cpc, campaignPrev3d?.cpc),
    visitToPurchase: pctChange(campaign3d?.visitToPurchase, campaignPrev3d?.visitToPurchase)
  };

  const activeSpendRows = rows.filter(r => toNumber(r?.contribution?.spend) > 0);
  const problematic = activeSpendRows.filter(r =>
    r.action?.label === 'PAUSAR' ||
    r.action?.label === 'VIGILAR' ||
    ['critical', 'alert'].includes(r.relational?.general?.tone)
  );

  const affectedSpend = Math.min(100, problematic.reduce((sum, r) => sum + toNumber(r?.contribution?.spendShare), 0));
  const pauseRows = activeSpendRows.filter(r => r.action?.label === 'PAUSAR');
  const drainRows = activeSpendRows.filter(r => r.contribution?.status === 'Drena la campaña');

  const layerSpend = {};
  problematic.forEach(r => {
    const layer = r.relational?.primaryLayer || 'Sin clasificar';
    layerSpend[layer] = (layerSpend[layer] || 0) + toNumber(r?.contribution?.spendShare);
  });
  const layerEntries = Object.entries(layerSpend).sort((a, b) => b[1] - a[1]);
  const dominantLayer = layerEntries[0]?.[0] || 'Sin deterioro dominante';
  const meaningfulLayers = layerEntries.filter(([, share]) => share >= 15);

  const enoughBreadth = activeSpendRows.length > 0 && problematic.length >= Math.max(2, Math.ceil(activeSpendRows.length * 0.5));
  let scope = 'SIN DETERIORO DOMINANTE';
  let scopeTone = 'good';

  if (problematic.length === 0) {
    scope = 'SIN DETERIORO DOMINANTE';
    scopeTone = 'good';
  } else if (affectedSpend >= 60 && enoughBreadth) {
    scope = meaningfulLayers.length >= 2 ? 'GENERALIZADO · VARIAS CAPAS' : 'DETERIORO GENERALIZADO';
    scopeTone = 'critical';
  } else if (meaningfulLayers.length >= 2 && affectedSpend >= 30) {
    scope = 'DETERIORO MIXTO';
    scopeTone = 'alert';
  } else if (problematic.length === 1 && affectedSpend < 15) {
    scope = 'PROBLEMA AISLADO';
    scopeTone = 'attention';
  } else {
    scope = 'DETERIORO CONCENTRADO';
    scopeTone = affectedSpend >= 30 ? 'alert' : 'attention';
  }

  const campaignCpa = campaign3d?.cpa;
  const aboveMax = campaignCpa !== null && campaignCpa !== undefined && toNumber(campaignCpa) > max;
  const noPurchases = toNumber(campaign3d?.spend) > 0 && toNumber(campaign3d?.purchases) <= 0;

  let resultTitle = 'CAMPAÑA BAJO CONTROL';
  let resultTone = 'normal';
  let resultSimple = campaignCpa !== null && campaignCpa !== undefined
    ? `La campaña está pagando ${fmtCpa(campaignCpa)} por cada compra, frente a un máximo de ${fmtMoney(max)}.`
    : noPurchases
      ? `La campaña gastó ${fmtMoney(campaign3d?.spend)} en la ventana ${periodLabel} sin registrar compras.`
      : 'Todavía no hay suficiente información para calcular el costo por compra de la campaña.';

  if (noPurchases && toNumber(campaign3d?.spend) >= max) {
    resultTitle = 'CAMPAÑA EN ZONA CRÍTICA';
    resultTone = 'critical';
  } else if (aboveMax && delta.cpa !== null && delta.cpa > 15) {
    resultTitle = 'CAMPAÑA FUERA DEL OBJETIVO Y EMPEORANDO';
    resultTone = 'critical';
  } else if (aboveMax) {
    resultTitle = 'CAMPAÑA FUERA DEL OBJETIVO';
    resultTone = 'alert';
  } else if (campaignCpa !== null && campaignCpa !== undefined && toNumber(campaignCpa) <= max * 0.8) {
    resultTitle = 'CAMPAÑA CON BUEN MARGEN';
    resultTone = 'good';
  }

  if (delta.cpa !== null) {
    resultSimple += ` Frente a la ventana ${periodLabel} anterior comparable, el CPA ${delta.cpa > 0 ? 'empeoró' : delta.cpa < 0 ? 'mejoró' : 'se mantuvo'} ${fmtNum(Math.abs(delta.cpa), 1)}%.`;
  }

  let scopeSimple = 'No hay un grupo de anuncios que esté deteriorando de forma clara el resultado general.';
  if (scope.includes('GENERALIZADO')) {
    scopeSimple = `El problema no está concentrado en un solo anuncio: ${problematic.length} de ${activeSpendRows.length} anuncios con gasto reúnen ${fmtNum(affectedSpend, 1)}% del presupuesto afectado. Conviene buscar factores comunes antes de tocar anuncios sanos por separado.`;
  } else if (scope === 'DETERIORO CONCENTRADO') {
    scopeSimple = `El deterioro está concentrado en pocos anuncios que reúnen ${fmtNum(affectedSpend, 1)}% del gasto. La campaña no necesita una intervención masiva: conviene actuar sobre esos anuncios primero.`;
  } else if (scope === 'PROBLEMA AISLADO') {
    scopeSimple = `La señal negativa está casi aislada en un anuncio y afecta solo ${fmtNum(affectedSpend, 1)}% del gasto. No hay motivo para modificar toda la campaña.`;
  } else if (scope === 'DETERIORO MIXTO' || scope.includes('VARIAS CAPAS')) {
    scopeSimple = `Hay más de un tipo de problema al mismo tiempo y, juntos, afectan ${fmtNum(affectedSpend, 1)}% del presupuesto. No conviene aplicar una sola solución a toda la campaña.`;
  }

  // Campaign metric chain: decide which global layer has the clearest movement.
  let campaignLayer = dominantLayer;
  const cvrBad = campaignMetricStatus.cvr.actionable && delta.visitToPurchase !== null && delta.visitToPurchase < 0;
  const ctrBad = campaignMetricStatus.ctr.actionable && delta.ctr !== null && delta.ctr < 0;
  const cpmBad = campaignMetricStatus.cpm.actionable;
  const cpcBad = campaignMetricStatus.cpc.actionable;
  const ctrStableOrBetter = !campaignMetricStatus.ctr.actionable;
  const cvrStable = !campaignMetricStatus.cvr.actionable;

  if (cvrBad && ctrStableOrBetter) campaignLayer = 'Post-clic';
  else if (ctrBad && cvrStable) campaignLayer = 'Respuesta creativa';
  else if (cpmBad && cpcBad && ctrStableOrBetter && cvrStable) campaignLayer = 'Distribución / costo del tráfico';
  else if (cvrBad && (ctrBad || cpmBad)) campaignLayer = 'Mixto';

  const scaleDiagnosis = currentScaleStatus?.scaleDiagnosis || null;
  if (scaleDiagnosis?.isPrimarySuspect) {
    campaignLayer = 'Escalamiento / presupuesto';
    resultSimple += ` El último escalamiento aparece como sospechoso principal porque el rendimiento era más saludable antes del aumento y perdió eficiencia después.`;
  }

  let action = 'Mantener y seguir midiendo.';
  if (pauseRows.length > 0) {
    action = `Pausar ${pauseRows.length} anuncio(s) que ya cumplen criterio de protección de presupuesto y conservar activos los anuncios sanos.`;
  } else if (scaleDiagnosis?.shouldReduceBudget) {
    action = scaleDiagnosis.recommendedAction;
  } else if (scaleDiagnosis?.isPrimarySuspect) {
    action = scaleDiagnosis.recommendedAction;
  } else if (scope.includes('GENERALIZADO') && campaignLayer === 'Post-clic') {
    action = 'No apagar anuncios en bloque. Revisar primero factores comunes después del clic: página, oferta, checkout, disponibilidad o calidad general del tráfico.';
  } else if (scope === 'DETERIORO CONCENTRADO' || scope === 'PROBLEMA AISLADO') {
    action = 'Intervenir únicamente los anuncios señalados. No modificar toda la campaña.';
  } else if (scope === 'DETERIORO MIXTO' || scope.includes('VARIAS CAPAS')) {
    action = 'Separar los problemas por capa: creativo, distribución y post-clic. Corregir cada grupo sin aplicar una única solución general.';
  } else if (resultTone === 'good') {
    action = 'Mantener la estructura y escalar solo si los guardrails 3D lo permiten.';
  }

  const topProblems = [...problematic]
    .sort((a, b) => {
      const aPause = a.action?.label === 'PAUSAR' ? 1000 : 0;
      const bPause = b.action?.label === 'PAUSAR' ? 1000 : 0;
      const aScore = aPause + toNumber(a?.contribution?.spendShare) + Math.max(0, toNumber(a?.contribution?.removalImprovementPct));
      const bScore = bPause + toNumber(b?.contribution?.spendShare) + Math.max(0, toNumber(b?.contribution?.removalImprovementPct));
      return bScore - aScore;
    })
    .slice(0, 3)
    .map(r => ({
      id: r.ad?.id,
      name: r.ad?.name || 'Anuncio',
      action: r.action?.label,
      spendShare: toNumber(r?.contribution?.spendShare),
      contribution: r?.contribution?.status || 'Sin lectura',
      layer: r.relational?.primaryLayer || 'Sin clasificar'
    }));

  return {
    resultTitle,
    resultTone,
    resultSimple,
    scope,
    scopeTone,
    scopeSimple,
    affectedSpend,
    affectedCount: problematic.length,
    activeSpendCount: activeSpendRows.length,
    pauseCount: pauseRows.length,
    drainCount: drainRows.length,
    dominantLayer: campaignLayer,
    layerSpend,
    delta,
    metricStatus: campaignMetricStatus,
    scaleDiagnosis,
    action,
    topProblems,
    rulesNote: 'Alcance generalizado/concentrado se define con reglas operativas internas basadas principalmente en % de gasto afectado y cantidad de anuncios; no es un benchmark oficial de Meta.'
  };
}


function formatIsoDateCC(value) {
  const raw = String(value || '');
  const parts = raw.split('-').map(Number);
  if (parts.length !== 3 || parts.some(x => !Number.isFinite(x))) return raw || '—';
  const date = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
  return date.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

const WEEKDAYS_CC = [
  { id: 1, label: 'Lunes', short: 'Lun' },
  { id: 2, label: 'Martes', short: 'Mar' },
  { id: 3, label: 'Miércoles', short: 'Mié' },
  { id: 4, label: 'Jueves', short: 'Jue' },
  { id: 5, label: 'Viernes', short: 'Vie' },
  { id: 6, label: 'Sábado', short: 'Sáb' },
  { id: 0, label: 'Domingo', short: 'Dom' }
];

function weekdayIndexFromIsoCC(date) {
  const raw = String(date || '');
  const parts = raw.split('-').map(Number);
  if (parts.length !== 3 || parts.some(x => !Number.isFinite(x))) return null;
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
}

function weekdayConfidenceCC(sampleDays) {
  const n = toNumber(sampleDays);
  if (n >= 5) return { label: 'ALTA', tone: 'good', text: '5 o más ocurrencias históricas de este día.' };
  if (n >= 3) return { label: 'MEDIA', tone: 'normal', text: '3–4 ocurrencias históricas de este día.' };
  if (n >= 2) return { label: 'BAJA', tone: 'attention', text: 'Solo 2 ocurrencias históricas; interpretar con prudencia.' };
  return { label: 'INSUFICIENTE', tone: 'neutral', text: 'Se necesita al menos otra ocurrencia para hablar de patrón.' };
}

function weekdayMetricSignalCC(current, baseline, lowerIsBetter = false, threshold = 5) {
  if (
    current === null || current === undefined ||
    baseline === null || baseline === undefined ||
    !Number.isFinite(Number(current)) ||
    !Number.isFinite(Number(baseline)) ||
    Number(baseline) === 0
  ) return { delta: null, signal: 'neutral' };

  const delta = pctChange(current, baseline);
  if (delta === null) return { delta: null, signal: 'neutral' };

  if (lowerIsBetter) {
    if (delta <= -threshold) return { delta, signal: 'good' };
    if (delta >= threshold) return { delta, signal: 'bad' };
    return { delta, signal: 'neutral' };
  }

  if (delta >= threshold) return { delta, signal: 'good' };
  if (delta <= -threshold) return { delta, signal: 'bad' };
  return { delta, signal: 'neutral' };
}

function weekdayPlainSummaryCC(row, baseline, isBest, isWorst) {
  if (!row || row.sampleDays <= 0) return 'No existen registros completos para este día de la semana.';
  if (row.sampleDays < 2) return `Solo hay ${row.sampleDays} ${row.label.toLowerCase()} registrado. Todavía no existe muestra suficiente para hablar de un patrón.`;

  const cpaDelta = row.signals.cpa.delta;
  const cvrDelta = row.signals.cvr.delta;
  const cpcDelta = row.signals.cpc.delta;
  const ctrDelta = row.signals.ctr.delta;
  const cpmDelta = row.signals.cpm.delta;

  const pieces = [];

  if (row.stats.purchases <= 0 && row.stats.spend > 0) {
    pieces.push(`Históricamente ha consumido ${fmtMoney(row.stats.spend)} sin registrar compras.`);
  } else if (cpaDelta !== null) {
    if (cpaDelta <= -5) pieces.push(`El CPA es ${fmtNum(Math.abs(cpaDelta), 1)}% mejor que el promedio histórico de la campaña.`);
    else if (cpaDelta >= 5) pieces.push(`El CPA es ${fmtNum(Math.abs(cpaDelta), 1)}% peor que el promedio histórico de la campaña.`);
    else pieces.push('El CPA se mueve cerca del promedio histórico de la campaña.');
  }

  if (cvrDelta !== null && Math.abs(cvrDelta) >= 8) {
    pieces.push(`El CVR está ${cvrDelta > 0 ? `${fmtNum(cvrDelta, 1)}% por encima` : `${fmtNum(Math.abs(cvrDelta), 1)}% por debajo`} del promedio.`);
  } else if (ctrDelta !== null && Math.abs(ctrDelta) >= 8) {
    pieces.push(`El CTR está ${ctrDelta > 0 ? `${fmtNum(ctrDelta, 1)}% por encima` : `${fmtNum(Math.abs(ctrDelta), 1)}% por debajo`} del promedio.`);
  } else if (cpcDelta !== null && Math.abs(cpcDelta) >= 8) {
    pieces.push(`El CPC está ${cpcDelta < 0 ? `${fmtNum(Math.abs(cpcDelta), 1)}% más barato` : `${fmtNum(cpcDelta, 1)}% más caro`} que el promedio.`);
  } else if (cpmDelta !== null && Math.abs(cpmDelta) >= 10) {
    pieces.push(`El CPM está ${cpmDelta < 0 ? `${fmtNum(Math.abs(cpmDelta), 1)}% más bajo` : `${fmtNum(cpmDelta, 1)}% más alto`} que el promedio.`);
  }

  if (isBest) pieces.push('Es el día con mejor rendimiento histórico observado entre los días con muestra comparable.');
  if (isWorst) pieces.push('Es el día con peor rendimiento histórico observado entre los días con muestra comparable.');
  if (!isBest && !isWorst && row.classification === 'ESTABLE') pieces.push('No presenta una diferencia suficientemente fuerte para tratarlo como mejor o peor día.');

  return pieces.join(' ');
}

function buildCampaignWeekdayAnalysisCC(campaignHistory, maxCpa) {
  const history = (campaignHistory || [])
    .filter(r => r && r.date && String(r.date) < todayColombiaCC())
    .filter(r => !r.syntheticZero || toNumber(r.spend) > 0 || toNumber(r.purchases) > 0);

  const baseline = aggregateRecords(history);
  const firstDate = history.length ? String(history[0].date) : null;
  const lastDate = history.length ? String(history[history.length - 1].date) : null;

  const rows = WEEKDAYS_CC.map(day => {
    const records = history.filter(r => weekdayIndexFromIsoCC(r.date) === day.id);
    const uniqueDates = [...new Set(records.map(r => String(r.date)))];
    const stats = aggregateRecords(records);

    const signals = {
      cpa: weekdayMetricSignalCC(stats.cpa, baseline.cpa, true, 5),
      cvr: weekdayMetricSignalCC(stats.visitToPurchase, baseline.visitToPurchase, false, 5),
      cpc: weekdayMetricSignalCC(stats.cpc, baseline.cpc, true, 5),
      ctr: weekdayMetricSignalCC(stats.ctr, baseline.ctr, false, 5),
      cpm: weekdayMetricSignalCC(stats.cpm, baseline.cpm, true, 5)
    };

    const favorableCount = Object.values(signals).filter(x => x.signal === 'good').length;
    const unfavorableCount = Object.values(signals).filter(x => x.signal === 'bad').length;
    const confidence = weekdayConfidenceCC(uniqueDates.length);

    return {
      ...day,
      records,
      sampleDays: uniqueDates.length,
      stats,
      signals,
      favorableCount,
      unfavorableCount,
      confidence,
      classification: uniqueDates.length < 2 ? 'MUESTRA BAJA' : 'ESTABLE'
    };
  });

  const qualified = rows.filter(r => r.sampleDays >= 2 && toNumber(r.stats.spend) > 0);

  // Mejor día: prioriza resultado comercial (CPA), y usa CVR/CPC/CTR/CPM como evidencia de apoyo.
  const bestCandidates = qualified
    .filter(r => toNumber(r.stats.purchases) > 0 && r.stats.cpa !== null)
    .sort((a, b) => {
      const aCpa = toNumber(a.stats.cpa);
      const bCpa = toNumber(b.stats.cpa);
      if (aCpa !== bCpa) return aCpa - bCpa;
      if (a.unfavorableCount !== b.unfavorableCount) return a.unfavorableCount - b.unfavorableCount;
      return b.favorableCount - a.favorableCount;
    });

  // Peor día: primero días sin compra con gasto, luego CPA más alto, apoyado por el resto de métricas.
  const worstCandidates = [...qualified].sort((a, b) => {
    const aNoPurchase = toNumber(a.stats.purchases) <= 0 && toNumber(a.stats.spend) > 0 ? 1 : 0;
    const bNoPurchase = toNumber(b.stats.purchases) <= 0 && toNumber(b.stats.spend) > 0 ? 1 : 0;
    if (aNoPurchase !== bNoPurchase) return bNoPurchase - aNoPurchase;

    const aCpa = a.stats.cpa === null ? Number.POSITIVE_INFINITY : toNumber(a.stats.cpa);
    const bCpa = b.stats.cpa === null ? Number.POSITIVE_INFINITY : toNumber(b.stats.cpa);
    if (aCpa !== bCpa) return bCpa - aCpa;
    if (a.unfavorableCount !== b.unfavorableCount) return b.unfavorableCount - a.unfavorableCount;
    return a.favorableCount - b.favorableCount;
  });

  const best = bestCandidates[0] || null;
  const worst = worstCandidates.find(r => !best || r.id !== best.id) || null;

  const baselineCpa = baseline.cpa;
  const max = Math.max(1, toNumber(maxCpa));

  rows.forEach(row => {
    if (row.sampleDays < 2) {
      row.classification = 'MUESTRA BAJA';
      return;
    }

    const isBest = !!best && row.id === best.id;
    const isWorst = !!worst && row.id === worst.id;

    const cpaDelta = row.signals.cpa.delta;
    const noPurchaseDamage = toNumber(row.stats.purchases) <= 0 && toNumber(row.stats.spend) >= max * 0.5;

    const bestSupported =
      isBest &&
      toNumber(row.stats.purchases) > 0 &&
      (
        (cpaDelta !== null && cpaDelta <= -8 && row.favorableCount >= row.unfavorableCount) ||
        row.favorableCount >= 3
      );

    const worstSupported =
      isWorst &&
      (
        noPurchaseDamage ||
        (cpaDelta !== null && cpaDelta >= 8 && row.unfavorableCount >= row.favorableCount) ||
        row.unfavorableCount >= 3
      );

    if (bestSupported) row.classification = 'MEJOR RENDIMIENTO';
    else if (worstSupported) row.classification = 'PEOR RENDIMIENTO';
    else row.classification = 'ESTABLE';
  });

  // Si el mejor/peor no alcanzó diferencia fuerte, se mantiene como relativo en el resumen,
  // pero no colorea el día como patrón fuerte.
  const bestRow = best ? rows.find(r => r.id === best.id) : null;
  const worstRow = worst ? rows.find(r => r.id === worst.id) : null;

  rows.forEach(row => {
    row.summary = weekdayPlainSummaryCC(
      row,
      baseline,
      !!bestRow && row.id === bestRow.id,
      !!worstRow && row.id === worstRow.id
    );
  });

  return {
    rows,
    baseline,
    best: bestRow,
    worst: worstRow,
    stable: rows.filter(r => r.classification === 'ESTABLE'),
    lowSample: rows.filter(r => r.classification === 'MUESTRA BAJA'),
    historyDays: [...new Set(history.map(r => String(r.date)))].length,
    firstDate,
    lastDate
  };
}

function weekdayClassificationToneCC(classification) {
  if (classification === 'MEJOR RENDIMIENTO') return 'good';
  if (classification === 'PEOR RENDIMIENTO') return 'critical';
  if (classification === 'MUESTRA BAJA') return 'neutral';
  return 'normal';
}

function WeekdayMetricMiniCC({ label, value, delta, lowerIsBetter = false }) {
  const hasDelta = delta !== null && delta !== undefined;
  let tone = 'text-slate-500';

  if (hasDelta) {
    const favorable = lowerIsBetter ? delta < -5 : delta > 5;
    const unfavorable = lowerIsBetter ? delta > 5 : delta < -5;
    if (favorable) tone = 'text-emerald-700';
    else if (unfavorable) tone = 'text-rose-700';
  }

  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white px-2.5 py-2.5">
      <p className="text-[6.5px] font-black uppercase tracking-wide leading-tight text-slate-400 whitespace-normal break-words">{label}</p>

      <p className="text-[11px] sm:text-[12px] font-black tracking-tight tabular-nums text-zinc-900 mt-1.5 leading-tight whitespace-normal break-words">
        {value}
      </p>

      <div className="mt-2 pt-1.5 border-t border-slate-100">
        <p className={`text-[8px] font-black tabular-nums whitespace-nowrap ${tone}`}>
          {hasDelta ? `${delta > 0 ? '+' : ''}${fmtNum(delta, 1)}%` : '—'}
        </p>
        <p className="text-[6.5px] font-bold text-slate-400 mt-0.5 leading-tight">
          {hasDelta ? 'vs histórico' : 'Sin comparación'}
        </p>
      </div>
    </div>
  );
}

function CampaignWeekdayHistoryView({ campaign, analysis }) {
  const best = analysis?.best;
  const worst = analysis?.worst;
  const stableNames = (analysis?.stable || []).map(x => x.label);
  const rangeText = analysis?.firstDate && analysis?.lastDate
    ? `${formatIsoDateCC(analysis.firstDate)} → ${formatIsoDateCC(analysis.lastDate)}`
    : 'Sin rango histórico';

  return (
    <div className="space-y-4 min-w-0">
      <section className="rounded-3xl border-2 border-indigo-200 bg-white shadow-sm overflow-hidden">
        <div className="p-4 sm:p-5 lg:p-6">
          <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-3 py-1.5 rounded-full bg-indigo-100 text-indigo-700 text-[9px] font-black uppercase">CAPA 1 · PATRÓN SEMANAL</span>
                <span className="px-2.5 py-1.5 rounded-full bg-zinc-950 text-white text-[8px] font-black uppercase">HISTORIAL TOTAL</span>
              </div>
              <h3 className="text-xl sm:text-2xl font-black text-zinc-900 mt-3 break-words">Días de la semana · {campaign.name}</h3>
              <p className="text-[9px] sm:text-[10px] text-slate-600 mt-2 max-w-4xl leading-relaxed">
                Cada resultado se construye únicamente con el mismo día de la semana en todo el historial: todos los lunes se agrupan con lunes, todos los martes con martes, todos los viernes con viernes, etc. Después se comparan esos 7 grupos históricos para identificar cuál suele rendir mejor, cuál peor y cuáles permanecen estables.
              </p>
              <p className="text-[8px] text-slate-400 mt-2">
                {analysis?.historyDays || 0} días completos registrados · {rangeText} · hoy y días OFF excluidos.
              </p>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3.5 xl:max-w-[360px]">
              <p className="text-[8px] font-black uppercase text-amber-700">Importante</p>
              <p className="text-[9px] text-amber-900 mt-1.5 leading-relaxed">
                Este patrón histórico sirve para entender qué días suelen funcionar mejor o peor. No reemplaza la decisión 3D y no pausa ni escala anuncios automáticamente.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-[8px] font-black uppercase text-emerald-700">Mejor rendimiento histórico</p>
              <p className="text-lg font-black text-zinc-900 mt-1">{best?.label || 'Sin muestra suficiente'}</p>
              <p className="text-[9px] text-slate-600 mt-1.5">
                {best ? `${best.sampleDays} ${best.label.toLowerCase()} registrados · CPA ${fmtCpa(best.stats.cpa)}` : 'Se necesitan más datos.'}
              </p>
            </div>

            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
              <p className="text-[8px] font-black uppercase text-rose-700">Peor rendimiento histórico</p>
              <p className="text-lg font-black text-zinc-900 mt-1">{worst?.label || 'Sin muestra suficiente'}</p>
              <p className="text-[9px] text-slate-600 mt-1.5">
                {worst ? `${worst.sampleDays} ${worst.label.toLowerCase()} registrados · CPA ${fmtCpa(worst.stats.cpa)}` : 'Se necesitan más datos.'}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[8px] font-black uppercase text-slate-500">Días con rendimiento estable</p>
              <p className="text-sm font-black text-zinc-900 mt-1 leading-relaxed">
                {stableNames.length ? stableNames.join(' · ') : 'Ninguno todavía'}
              </p>
              <p className="text-[9px] text-slate-500 mt-1.5">Se mantienen cerca del comportamiento histórico general.</p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
        {(analysis?.rows || []).map(row => {
          const tone = weekdayClassificationToneCC(row.classification);
          return (
            <article key={row.id} className={`min-w-0 rounded-3xl border-2 p-4 sm:p-5 ${toneBg(tone)}`}>
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2.5 py-1 rounded-full text-[8px] font-black uppercase ${toneBadge(tone)}`}>{row.classification}</span>
                    <span className={`px-2.5 py-1 rounded-full text-[8px] font-black uppercase ${toneBadge(row.confidence.tone)}`}>
                      Confianza {row.confidence.label}
                    </span>
                  </div>
                  <h4 className="text-lg font-black text-zinc-900 mt-2">{row.label}</h4>
                  <p className="text-[8px] text-slate-500 mt-1">{row.sampleDays} {row.label.toLowerCase()} analizado(s) en todo el historial · {row.confidence.text}</p>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:min-w-[190px]">
                  <div className="rounded-xl bg-white/80 border border-white p-2.5">
                    <p className="text-[7px] font-black uppercase text-slate-400">Gasto histórico</p>
                    <p className="text-[10px] font-black tabular-nums whitespace-nowrap mt-1">{fmtMoney(row.stats.spend)}</p>
                  </div>
                  <div className="rounded-xl bg-white/80 border border-white p-2.5">
                    <p className="text-[7px] font-black uppercase text-slate-400">Compras</p>
                    <p className="text-[10px] font-black tabular-nums whitespace-nowrap mt-1">{fmtNum(row.stats.purchases, 0)}</p>
                  </div>
                </div>
              </div>

              <p className="text-[9px] sm:text-[10px] text-slate-700 mt-3 leading-relaxed">{row.summary}</p>

              <div className="cc-grid-weekday mt-4">
                <WeekdayMetricMiniCC label="CPA" value={fmtCpa(row.stats.cpa)} delta={row.signals.cpa.delta} lowerIsBetter />
                <WeekdayMetricMiniCC label="CVR" value={fmtRate(row.stats.visitToPurchase)} delta={row.signals.cvr.delta} />
                <WeekdayMetricMiniCC label="CPC" value={fmtMoneyOrDashCC(row.stats.cpc)} delta={row.signals.cpc.delta} lowerIsBetter />
                <WeekdayMetricMiniCC label="CTR" value={fmtRate(row.stats.ctr)} delta={row.signals.ctr.delta} />
                <WeekdayMetricMiniCC label="CPM" value={fmtMoneyOrDashCC(row.stats.cpm)} delta={row.signals.cpm.delta} lowerIsBetter />
              </div>
            </article>
          );
        })}
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-[8px] font-black uppercase text-slate-500">Cómo se define mejor / peor día</p>
        <p className="text-[9px] text-slate-600 mt-1.5 leading-relaxed">
          Para cada día se consolidan todas sus ocurrencias del historial completo de la campaña: lunes con lunes, viernes con viernes, etc. El CPA histórico del grupo tiene prioridad para ordenar rendimiento; CVR, CPC, CTR y CPM ayudan a explicar y confirmar el patrón. Un solo día registrado nunca se declara mejor o peor: queda como muestra baja.
        </p>
      </section>
    </div>
  );
}



function buildScaleChangeImpactDiagnosisCC(
  campaignHistory = [],
  budgetChanges = [],
  maxCpa,
  currentBudget = null,
  currentScaleStatus = null,
  changeSafety = null
) {
  const max = Math.max(1, toNumber(maxCpa));
  const current = toNumber(currentBudget);

  const increases = (budgetChanges || [])
    .filter(change =>
      toNumber(change?.newBudget) > toNumber(change?.previousBudget) &&
      toNumber(change?.previousBudget) > 0
    )
    .sort((a, b) => {
      const aMs = changeEventTimeMsCC(a) || new Date(`${a?.date || '1900-01-01'}T12:00:00-05:00`).getTime();
      const bMs = changeEventTimeMsCC(b) || new Date(`${b?.date || '1900-01-01'}T12:00:00-05:00`).getTime();
      return bMs - aMs;
    });

  if (!increases.length) {
    return {
      status: 'SIN ESCALAMIENTO COMPARABLE',
      tone: 'neutral',
      isPrimarySuspect: false,
      shouldReduceBudget: false,
      threeDayConfirms: false,
      recoverySignal: false,
      confidence: 'SIN MUESTRA',
      change: null,
      beforeStats: null,
      afterStats: null,
      summary: 'No existe un aumento de presupuesto registrado con suficiente información para relacionarlo con el rendimiento.',
      evidence: 'Sin escalamiento registrado comparable.',
      recommendedBudget: null,
      recommendedAction: 'Mantener lectura normal de campaña y seguir acumulando historial.'
    };
  }

  const matchingCurrent =
    increases.find(change => current > 0 && Math.abs(toNumber(change.newBudget) - current) < 0.01) ||
    increases[0];

  const impact = reportBudgetChangeImpactCC(matchingCurrent, campaignHistory);
  const before = impact.beforeStats || {};
  const after = impact.afterStats || {};

  const cpaDelta = impact.cpaDelta;
  const cvrDelta = pctChange(after.visitToPurchase, before.visitToPurchase);
  const ctrDelta = pctChange(after.ctr, before.ctr);
  const cpcDelta = pctChange(after.cpc, before.cpc);
  const cpmDelta = pctChange(after.cpm, before.cpm);

  const beforeCpa = before.cpa;
  const afterCpa = after.cpa;

  const beforeRentable =
    beforeCpa !== null &&
    beforeCpa !== undefined &&
    toNumber(beforeCpa) > 0 &&
    toNumber(beforeCpa) <= max;

  const beforeStrong =
    beforeRentable &&
    toNumber(beforeCpa) <= max * 0.8;

  const afterNearLimit =
    afterCpa !== null &&
    afterCpa !== undefined &&
    toNumber(afterCpa) >= max * 0.8;

  const afterOutside =
    afterCpa !== null &&
    afterCpa !== undefined &&
    toNumber(afterCpa) > max;

  const cpaDeteriorated =
    cpaDelta !== null &&
    cpaDelta >= 15;

  const cpaDeterioratedSevere =
    cpaDelta !== null &&
    cpaDelta >= 30;

  const marginalBad =
    impact.marginalCpa !== null &&
    impact.marginalCpa !== undefined &&
    toNumber(impact.marginalCpa) > max;

  const currentScaleBad = ['ESCALA INEFICIENTE', 'SOBREESCALADO'].includes(currentScaleStatus?.status);
  const currentScaleLimit = currentScaleStatus?.status === 'ESCALA · LÍMITE RENTABLE';

  const beforeDays = toNumber(before.days);
  const afterDays = toNumber(after.days);
  const enoughBeforeAfterSample = beforeDays >= 2 && afterDays >= 2;

  const confidence =
    beforeDays >= 3 && afterDays >= 3 ? 'ALTA' :
    enoughBeforeAfterSample ? 'MEDIA' :
    'BAJA';

  // ── CONFIRMACIÓN OPERATIVA 3D ──────────────────────────────
  // El historial de escala puede levantar sospecha, pero bajar presupuesto
  // exige que la ventana operativa 3D también confirme deterioro.
  const { currentStats: threeDayStats, previousStats: threeDayPrevious } =
    splitPeriodRecords(campaignHistory, '3d');

  const threeDayCpaDelta = pctChange(threeDayStats.cpa, threeDayPrevious.cpa);

  const threeDayHasFullWindow = toNumber(threeDayStats.days) >= 3;
  const threeDayNoPurchaseDamage =
    toNumber(threeDayStats.purchases) <= 0 &&
    toNumber(threeDayStats.spend) >= max;

  const threeDayCpaOutside =
    threeDayStats.cpa !== null &&
    threeDayStats.cpa !== undefined &&
    toNumber(threeDayStats.cpa) > max;

  const threeDayNearLimitAndWorsening =
    threeDayStats.cpa !== null &&
    threeDayStats.cpa !== undefined &&
    toNumber(threeDayStats.cpa) >= max * 0.9 &&
    threeDayCpaDelta !== null &&
    threeDayCpaDelta >= 15;

  const threeDayConfirms =
    threeDayHasFullWindow &&
    (
      threeDayNoPurchaseDamage ||
      threeDayCpaOutside ||
      (currentScaleBad && threeDayNearLimitAndWorsening)
    );

  // ── ÚLTIMO DÍA COMPLETO = FRENO DE SEGURIDAD ───────────────
  // Puede frenar una reducción, pero nunca autorizarla por sí solo.
  const { currentStats: lastCompleteStats, previousStats: lastCompletePrevious } =
    splitPeriodRecords(campaignHistory, 'last');

  const lastCpaDelta = pctChange(lastCompleteStats.cpa, lastCompletePrevious.cpa);
  const lastCvrDelta = pctChange(
    lastCompleteStats.visitToPurchase,
    lastCompletePrevious.visitToPurchase
  );
  const lastCpcDelta = pctChange(lastCompleteStats.cpc, lastCompletePrevious.cpc);

  const recoveryByCpa =
    toNumber(lastCompleteStats.purchases) > 0 &&
    lastCompleteStats.cpa !== null &&
    lastCompleteStats.cpa !== undefined &&
    toNumber(lastCompleteStats.cpa) <= max;

  const recoveryByCpaTrend =
    toNumber(lastCompleteStats.purchases) > 0 &&
    lastCpaDelta !== null &&
    lastCpaDelta <= -20 &&
    lastCompleteStats.cpa !== null &&
    lastCompleteStats.cpa !== undefined &&
    toNumber(lastCompleteStats.cpa) <= max * 1.15;

  const recoveryByConversion =
    toNumber(lastCompleteStats.purchases) > 0 &&
    lastCvrDelta !== null &&
    lastCvrDelta >= 20 &&
    (lastCpcDelta === null || lastCpcDelta <= 10);

  const recoverySignal =
    recoveryByCpa ||
    recoveryByCpaTrend ||
    recoveryByConversion;

  const metricDeterioration = [];
  if (cpaDelta !== null && cpaDelta > 0) metricDeterioration.push(`CPA +${fmtNum(cpaDelta, 1)}%`);
  if (cpcDelta !== null && cpcDelta > 10) metricDeterioration.push(`CPC +${fmtNum(cpcDelta, 1)}%`);
  if (cpmDelta !== null && cpmDelta > 10) metricDeterioration.push(`CPM +${fmtNum(cpmDelta, 1)}%`);
  if (cvrDelta !== null && cvrDelta < -10) metricDeterioration.push(`CVR ${fmtNum(cvrDelta, 1)}%`);
  if (ctrDelta !== null && ctrDelta < -10) metricDeterioration.push(`CTR ${fmtNum(ctrDelta, 1)}%`);

  const isPrimarySuspect =
    beforeRentable &&
    (
      (cpaDeteriorated && (afterNearLimit || currentScaleLimit || currentScaleBad)) ||
      marginalBad ||
      (beforeStrong && afterOutside)
    );

  const isWatch =
    beforeRentable &&
    !isPrimarySuspect &&
    cpaDelta !== null &&
    cpaDelta >= 8;

  const absorbed =
    beforeRentable &&
    !isPrimarySuspect &&
    !isWatch &&
    (
      afterCpa === null ||
      afterCpa === undefined ||
      toNumber(afterCpa) <= max * 0.8
    );

  const previousBudget = toNumber(matchingCurrent.previousBudget);
  const profitableCeiling = toNumber(currentScaleStatus?.profitableCeilingBudget);

  let recommendedBudget = previousBudget > 0 ? previousBudget : null;
  if (
    profitableCeiling > 0 &&
    current > 0 &&
    profitableCeiling < current &&
    (recommendedBudget === null || profitableCeiling < recommendedBudget)
  ) {
    recommendedBudget = profitableCeiling;
  }

  const safetyBlocked =
    changeSafety?.active &&
    changeSafety?.canStructuralNow === false;

  const safetyWait =
    safetyBlocked
      ? fmtHoursRemainingCC(changeSafety.structuralRemainingHours)
      : null;

  // ── REGLA ESTRICTA PARA REDUCIR PRESUPUESTO ────────────────
  // REDUCIR solo si:
  // 1) hubo escalamiento;
  // 2) antes era rentable;
  // 3) el nivel actual ya es INEFICIENTE o SOBREESCALADO;
  // 4) el 3D confirma deterioro;
  // 5) hay muestra mínima antes/después;
  // 6) el último día NO muestra recuperación;
  // 7) la ventana de seguridad ya terminó.
  const reductionConditionsMetBeforeSafety =
    beforeRentable &&
    currentScaleBad &&
    threeDayConfirms &&
    enoughBeforeAfterSample &&
    !recoverySignal;

  const shouldReduceBudget =
    reductionConditionsMetBeforeSafety &&
    !safetyBlocked;

  const reductionWaitingSafety =
    reductionConditionsMetBeforeSafety &&
    safetyBlocked;

  const deteriorationText = metricDeterioration.length
    ? metricDeterioration.join(' · ')
    : 'el CPA perdió margen después del aumento';

  const summary =
    `Antes de subir de ${fmtMoney(previousBudget)} a ${fmtMoney(matchingCurrent.newBudget)}, ` +
    `la campaña operaba con CPA ${fmtCpa(beforeCpa)}${beforeStrong ? ' y buen margen' : ' dentro del objetivo'}. ` +
    `Después del escalamiento, el CPA pasó a ${fmtCpa(afterCpa)}. ` +
    `El cambio coincide temporalmente con el deterioro (${deteriorationText}).`;

  const evidence =
    `Antes ${reportWindowLabelCC(impact.beforeDates)} · después ${reportWindowLabelCC(impact.afterDates)} · ` +
    `CPA ${fmtCpa(beforeCpa)} → ${fmtCpa(afterCpa)}` +
    `${impact.marginalCpa !== null ? ` · CPA marginal ${fmtMoney(impact.marginalCpa)}` : ''} · ` +
    `3D actual ${fmtCpa(threeDayStats.cpa)}${threeDayCpaDelta !== null ? ` (${threeDayCpaDelta > 0 ? '+' : ''}${fmtNum(threeDayCpaDelta, 1)}%)` : ''}.`;

  // 1) LÍMITE RENTABLE: nunca bajar solo por estar cerca del límite.
  if (currentScaleLimit && isPrimarySuspect) {
    return {
      status: 'LÍMITE RENTABLE · MANTENER / NO ESCALAR MÁS',
      tone: 'attention',
      isPrimarySuspect: true,
      shouldReduceBudget: false,
      threeDayConfirms,
      recoverySignal,
      confidence,
      change: matchingCurrent,
      beforeStats: before,
      afterStats: after,
      cpaDelta,
      cvrDelta,
      ctrDelta,
      cpcDelta,
      cpmDelta,
      marginalCpa: impact.marginalCpa,
      recommendedBudget,
      safetyBlocked,
      safetyWait,
      summary,
      evidence,
      recommendedAction:
        'Mantener el presupuesto actual y detener nuevos escalalamientos. Estar cerca del límite rentable NO es suficiente para bajar presupuesto. Solo reducir si el nivel pasa a ineficiente/sobreescalado y el 3D confirma el deterioro.'
    };
  }

  // 2) REDUCCIÓN YA HABILITADA: todas las condiciones se cumplieron.
  if (shouldReduceBudget) {
    return {
      status: 'REDUCIR PRESUPUESTO',
      tone: 'critical',
      isPrimarySuspect: true,
      shouldReduceBudget: true,
      threeDayConfirms: true,
      recoverySignal: false,
      confidence,
      change: matchingCurrent,
      beforeStats: before,
      afterStats: after,
      cpaDelta,
      cvrDelta,
      ctrDelta,
      cpcDelta,
      cpmDelta,
      marginalCpa: impact.marginalCpa,
      recommendedBudget,
      safetyBlocked: false,
      safetyWait: null,
      summary:
        `${summary} El nuevo nivel ya está clasificado como ${currentScaleStatus?.status?.toLowerCase()}, el 3D confirma la pérdida de eficiencia y el último día completo no muestra recuperación suficiente.`,
      evidence,
      recommendedAction:
        recommendedBudget
          ? `REDUCIR hacia ${fmtMoney(recommendedBudget)}, correspondiente al nivel previo/último nivel rentable confirmado. Después del cambio, iniciar una nueva ventana de estabilización y volver a evaluar 3D.`
          : 'REDUCIR hacia el último nivel de presupuesto que haya demostrado rentabilidad. Después del cambio, iniciar una nueva ventana de estabilización y volver a evaluar 3D.'
    };
  }

  // 3) TODO CONFIRMA, PERO FALTA CUMPLIR LAS 48H.
  if (reductionWaitingSafety) {
    return {
      status: 'REDUCCIÓN PENDIENTE · ESPERAR VENTANA DE SEGURIDAD',
      tone: 'alert',
      isPrimarySuspect: true,
      shouldReduceBudget: false,
      threeDayConfirms: true,
      recoverySignal: false,
      confidence,
      change: matchingCurrent,
      beforeStats: before,
      afterStats: after,
      cpaDelta,
      cvrDelta,
      ctrDelta,
      cpcDelta,
      cpmDelta,
      marginalCpa: impact.marginalCpa,
      recommendedBudget,
      safetyBlocked: true,
      safetyWait,
      summary:
        `${summary} El nivel actual ya es ineficiente/sobreescalado y el 3D confirma el deterioro, pero todavía está activa la ventana interna de seguridad.`,
      evidence,
      recommendedAction:
        `NO cambiar todavía. Faltan ${safetyWait} para completar la ventana de seguridad. Al cumplirse, reevaluar el 3D; si sigue deteriorado y no aparece recuperación, reducir${recommendedBudget ? ` hacia ${fmtMoney(recommendedBudget)}` : ' al último nivel rentable'}.`
    };
  }

  // 4) NIVEL MALO, PERO 3D AÚN NO CONFIRMA.
  if (currentScaleBad && isPrimarySuspect && !threeDayConfirms) {
    return {
      status: 'INEFICIENCIA HISTÓRICA · 3D AÚN NO CONFIRMA',
      tone: 'attention',
      isPrimarySuspect: true,
      shouldReduceBudget: false,
      threeDayConfirms: false,
      recoverySignal,
      confidence,
      change: matchingCurrent,
      beforeStats: before,
      afterStats: after,
      cpaDelta,
      cvrDelta,
      ctrDelta,
      cpcDelta,
      cpmDelta,
      marginalCpa: impact.marginalCpa,
      recommendedBudget,
      safetyBlocked,
      safetyWait,
      summary:
        `${summary} El historial del nivel es negativo, pero la ventana operativa 3D todavía no confirma suficiente deterioro para ordenar una reducción.`,
      evidence,
      recommendedAction:
        'No escalar más. Mantener el presupuesto mientras se completa/actualiza el 3D. Bajar ahora sería una reacción prematura.'
    };
  }

  // 5) 3D MALO, PERO ÚLTIMO DÍA EMPIEZA A RECUPERAR.
  if (currentScaleBad && isPrimarySuspect && threeDayConfirms && recoverySignal) {
    return {
      status: 'NO REDUCIR TODAVÍA · HAY RECUPERACIÓN',
      tone: 'attention',
      isPrimarySuspect: true,
      shouldReduceBudget: false,
      threeDayConfirms: true,
      recoverySignal: true,
      confidence,
      change: matchingCurrent,
      beforeStats: before,
      afterStats: after,
      cpaDelta,
      cvrDelta,
      ctrDelta,
      cpcDelta,
      cpmDelta,
      marginalCpa: impact.marginalCpa,
      recommendedBudget,
      safetyBlocked,
      safetyWait,
      summary:
        `${summary} El 3D sigue deteriorado, pero el último día completo muestra una recuperación suficiente para frenar la reducción inmediata.`,
      evidence,
      recommendedAction:
        'Mantener y vigilar el siguiente día completo. Si la recuperación desaparece y el 3D continúa fuera de eficiencia después de la ventana de seguridad, volver a evaluar la reducción.'
    };
  }

  // 6) MUESTRA antes/después insuficiente.
  if (currentScaleBad && isPrimarySuspect && !enoughBeforeAfterSample) {
    return {
      status: 'ESCALAMIENTO SOSPECHOSO · MUESTRA INSUFICIENTE',
      tone: 'attention',
      isPrimarySuspect: true,
      shouldReduceBudget: false,
      threeDayConfirms,
      recoverySignal,
      confidence,
      change: matchingCurrent,
      beforeStats: before,
      afterStats: after,
      cpaDelta,
      cvrDelta,
      ctrDelta,
      cpcDelta,
      cpmDelta,
      marginalCpa: impact.marginalCpa,
      recommendedBudget,
      safetyBlocked,
      safetyWait,
      summary:
        `${summary} Aún no hay al menos dos días comparables antes y después del cambio.`,
      evidence,
      recommendedAction:
        'No escalar más y no bajar todavía. Esperar muestra suficiente para evitar atribuir el deterioro a ruido de corto plazo.'
    };
  }

  if (isWatch) {
    return {
      status: 'ESCALAMIENTO EN OBSERVACIÓN',
      tone: 'attention',
      isPrimarySuspect: false,
      shouldReduceBudget: false,
      threeDayConfirms,
      recoverySignal,
      confidence,
      change: matchingCurrent,
      beforeStats: before,
      afterStats: after,
      cpaDelta,
      cvrDelta,
      ctrDelta,
      cpcDelta,
      cpmDelta,
      marginalCpa: impact.marginalCpa,
      recommendedBudget,
      safetyBlocked,
      safetyWait,
      summary:
        `Después del aumento de ${fmtMoney(previousBudget)} a ${fmtMoney(matchingCurrent.newBudget)}, el CPA empeoró ${fmtNum(Math.abs(cpaDelta), 1)}%, ` +
        `pero todavía no hay evidencia suficiente para atribuir el deterioro principalmente al escalamiento.`,
      evidence:
        `CPA ${fmtCpa(beforeCpa)} → ${fmtCpa(afterCpa)} · confianza ${confidence.toLowerCase()}.`,
      recommendedAction:
        'Mantener el nivel y no volver a escalar hasta que el 3D vuelva a mostrar margen claro.'
    };
  }

  if (absorbed) {
    return {
      status: 'ESCALAMIENTO ABSORBIDO',
      tone: 'good',
      isPrimarySuspect: false,
      shouldReduceBudget: false,
      threeDayConfirms,
      recoverySignal,
      confidence,
      change: matchingCurrent,
      beforeStats: before,
      afterStats: after,
      cpaDelta,
      cvrDelta,
      ctrDelta,
      cpcDelta,
      cpmDelta,
      marginalCpa: impact.marginalCpa,
      recommendedBudget,
      safetyBlocked,
      safetyWait,
      summary:
        `El aumento de ${fmtMoney(previousBudget)} a ${fmtMoney(matchingCurrent.newBudget)} no muestra un deterioro suficiente para señalarlo como problema principal. ` +
        `El nivel posterior continúa con margen rentable.`,
      evidence:
        `CPA ${fmtCpa(beforeCpa)} → ${fmtCpa(afterCpa)}.`,
      recommendedAction:
        'Mantener. Solo volver a escalar si el 3D actual, margen de seguridad y guardrails vuelven a autorizarlo.'
    };
  }

  return {
    status: isPrimarySuspect ? 'ESCALAMIENTO · SOSPECHOSO PRINCIPAL' : 'RELACIÓN CON ESCALAMIENTO NO CONCLUYENTE',
    tone: isPrimarySuspect ? 'alert' : 'neutral',
    isPrimarySuspect,
    shouldReduceBudget: false,
    threeDayConfirms,
    recoverySignal,
    confidence,
    change: matchingCurrent,
    beforeStats: before,
    afterStats: after,
    cpaDelta,
    cvrDelta,
    ctrDelta,
    cpcDelta,
    cpmDelta,
    marginalCpa: impact.marginalCpa,
    recommendedBudget,
    safetyBlocked,
    safetyWait,
    summary:
      isPrimarySuspect
        ? `${summary} El escalamiento es el principal factor temporal a vigilar, pero todavía no se cumplen todas las condiciones estrictas para bajar presupuesto.`
        : 'Existe un cambio de presupuesto registrado, pero la comparación antes/después no permite señalarlo como causa principal del resultado actual.',
    evidence,
    recommendedAction:
      isPrimarySuspect
        ? 'Detener nuevos escalalamientos y mantener observación. Reducir únicamente si el nivel queda ineficiente/sobreescalado, el 3D lo confirma, no hay recuperación y termina la ventana de seguridad.'
        : 'No reducir presupuesto únicamente por correlación. Mantener el diagnóstico completo de campaña y anuncios.'
  };
}


function marginalCpaDisplayCC(scaleStatus, maxCpa = null) {
  const marginal = scaleStatus?.marginalCpa;
  const extraSpend = scaleStatus?.marginalExtraSpendDay;
  const extraPurchases = scaleStatus?.marginalExtraPurchasesDay;
  const previousBudget = toNumber(scaleStatus?.previousBudget);
  const currentBudget = toNumber(scaleStatus?.currentBudget);
  const max = Math.max(1, toNumber(maxCpa));

  if (marginal !== null && marginal !== undefined && Number.isFinite(Number(marginal))) {
    const m = Number(marginal);
    const isBad = max > 0 && m > max;

    return {
      value: fmtMoney(m),
      status: isBad ? `INEFICIENTE · SUPERA ${fmtMoney(max)}` : 'ESCALAMIENTO RENTABLE',
      tone: isBad ? 'critical' : 'good',
      explanation: isBad
        ? `Las compras adicionales generadas por este nivel están costando ${fmtMoney(m)} cada una, por encima del máximo permitido de ${fmtMoney(max)}.`
        : `Las compras adicionales generadas por este nivel están costando ${fmtMoney(m)} cada una, dentro del máximo permitido de ${fmtMoney(max)}.`,
      detail:
        previousBudget > 0 && currentBudget > 0
          ? `El presupuesto subió de ${fmtMoney(previousBudget)} a ${fmtMoney(currentBudget)}. El gasto adicional sí produjo compras/día adicionales.`
          : 'El gasto adicional produjo compras/día adicionales y permitió calcular su costo incremental.'
    };
  }

  if (
    extraSpend !== null &&
    extraSpend !== undefined &&
    toNumber(extraSpend) > 0 &&
    extraPurchases !== null &&
    extraPurchases !== undefined &&
    toNumber(extraPurchases) <= 0
  ) {
    const minimumMarginal = toNumber(extraSpend);

    return {
      value: `> ${fmtMoney(minimumMarginal)}`,
      status: `INEFICIENTE · SUPERA ${fmtMoney(max)}`,
      tone: 'critical',
      explanation:
        `El presupuesto aumentó ${fmtMoney(minimumMarginal)} por día, pero las compras/día no aumentaron. ` +
        `Eso significa que el CPA marginal real es superior a ${fmtMoney(minimumMarginal)} y está por encima del máximo permitido de ${fmtMoney(max)}.`,
      detail:
        previousBudget > 0 && currentBudget > 0
          ? `Escalamiento: ${fmtMoney(previousBudget)} → ${fmtMoney(currentBudget)}. El gasto adicional no generó una compra incremental positiva.`
          : `El gasto diario aumentó ${fmtMoney(minimumMarginal)} sin generar compras/día adicionales.`
    };
  }

  return {
    value: '—',
    status: 'SIN MUESTRA COMPARABLE',
    tone: 'neutral',
    explanation: 'Todavía no hay dos niveles de presupuesto comparables para calcular el CPA marginal.',
    detail: 'Se necesitan datos del nivel anterior y del nivel actual.'
  };
}

function currentScaleStatusMarginalNoGainCC(scaleStatus) {
  return (
    scaleStatus?.marginalExtraSpendDay !== null &&
    scaleStatus?.marginalExtraSpendDay !== undefined &&
    toNumber(scaleStatus.marginalExtraSpendDay) > 0 &&
    scaleStatus?.marginalExtraPurchasesDay !== null &&
    scaleStatus?.marginalExtraPurchasesDay !== undefined &&
    toNumber(scaleStatus.marginalExtraPurchasesDay) <= 0
  );
}

function buildCurrentScaleStatusCC(campaignHistory = [], scaleRows = [], maxCpa, budgetChanges = [], changeSafety = null) {
  const max = Math.max(1, toNumber(maxCpa));
  const historyWithBudget = (campaignHistory || [])
    .filter(r => toNumber(r?.budget) > 0)
    .sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')));

  const latest = historyWithBudget[historyWithBudget.length - 1] || null;
  const currentBudget = toNumber(latest?.budget);

  if (!latest || currentBudget <= 0) {
    return {
      status: 'SIN HISTORIAL SUFICIENTE',
      tone: 'neutral',
      currentBudget: null,
      cpa: null,
      marginalCpa: null,
      days: 0,
      purchases: 0,
      profitableCeilingBudget: null,
      profitableCeilingCpa: null,
      summary: 'Todavía no existe un nivel de presupuesto histórico suficiente para clasificar la escala actual.',
      action: 'Seguir registrando días completos antes de usar el historial de escala como referencia.'
    };
  }

  const rows = [...(scaleRows || [])].sort((a, b) => toNumber(a.budget) - toNumber(b.budget));
  const currentRow =
    rows.find(r => Math.abs(toNumber(r.budget) - currentBudget) < 0.01) ||
    null;

  const profitableRows = rows.filter(r =>
    toNumber(r.cpa) > 0 &&
    toNumber(r.cpa) <= max &&
    !(r.marginalCpa !== null && r.marginalCpa !== undefined && toNumber(r.marginalCpa) > max)
  );

  const profitableCeiling = [...profitableRows]
    .sort((a, b) => toNumber(b.budget) - toNumber(a.budget))[0] || null;

  const previousLevel = [...rows]
    .filter(r => toNumber(r.budget) < currentBudget)
    .sort((a, b) => toNumber(b.budget) - toNumber(a.budget))[0] || null;

  const withScaleDiagnosis = statusObj => {
    const scaleDiagnosis = buildScaleChangeImpactDiagnosisCC(
      campaignHistory,
      budgetChanges,
      max,
      currentBudget,
      statusObj,
      changeSafety
    );
    return { ...statusObj, scaleDiagnosis };
  };

  if (!currentRow) {
    return withScaleDiagnosis({
      status: 'ESCALA EN OBSERVACIÓN',
      tone: 'neutral',
      currentBudget,
      cpa: null,
      marginalCpa: null,
      days: 0,
      purchases: 0,
      profitableCeilingBudget: profitableCeiling?.budget || null,
      profitableCeilingCpa: profitableCeiling?.cpa || null,
      summary: `El presupuesto actual es ${fmtMoney(currentBudget)}, pero todavía no existe suficiente historial agrupado en este nivel para clasificar su rentabilidad.`,
      action: 'Mantener observación. La decisión operativa sigue dependiendo de 3D y sus guardrails.'
    });
  }

  const base = {
    currentBudget,
    cpa: currentRow.cpa,
    marginalCpa: currentRow.marginalCpa,
    marginalExtraSpendDay: currentRow.marginalExtraSpendDay,
    marginalExtraPurchasesDay: currentRow.marginalExtraPurchasesDay,
    spendDay: currentRow.spendDay,
    purchasesDay: currentRow.purchasesDay,
    days: currentRow.days,
    purchases: currentRow.purchases,
    profitableCeilingBudget: profitableCeiling?.budget || null,
    profitableCeilingCpa: profitableCeiling?.cpa || null,
    previousBudget: previousLevel?.budget || null,
    previousCpa: previousLevel?.cpa || null
  };

  if (currentRow.status === 'Escala ineficiente') {
    return withScaleDiagnosis({
      ...base,
      status: 'ESCALA INEFICIENTE',
      tone: 'critical',
      summary:
        currentRow.marginalCpa !== null && currentRow.marginalCpa !== undefined
          ? `El presupuesto actual de ${fmtMoney(currentBudget)} presenta un CPA marginal de ${fmtCpa(currentRow.marginalCpa)}, por encima del CPA máximo de ${fmtMoney(max)}. El gasto adicional de este nivel está perdiendo eficiencia.`
          : `El presupuesto actual de ${fmtMoney(currentBudget)} aumentó el gasto diario frente al nivel anterior, pero no generó compras/día adicionales. El nuevo nivel perdió eficiencia incremental.`,
      action:
        profitableCeiling
          ? `No continuar escalando. El último nivel rentable observado es ${fmtMoney(profitableCeiling.budget)}, pero la reducción solo se habilita si el diagnóstico causal cumple todas las condiciones estrictas.`
          : 'No continuar escalando. Bajar presupuesto requiere confirmación 3D, ausencia de recuperación y ventana de seguridad cumplida.'
    });
  }

  if (currentRow.status === 'Sobreescalado') {
    return withScaleDiagnosis({
      ...base,
      status: 'SOBREESCALADO',
      tone: 'critical',
      summary:
        `En ${fmtMoney(currentBudget)}, el CPA histórico ponderado del nivel es ${fmtCpa(currentRow.cpa)}, ` +
        `por encima del máximo de ${fmtMoney(max)}.`,
      action:
        profitableCeiling
          ? `El último nivel rentable observado es ${fmtMoney(profitableCeiling.budget)} con CPA ${fmtCpa(profitableCeiling.cpa)}. No aumentar presupuesto. La plataforma solo recomendará retroceder cuando 3D confirme, no haya recuperación y se cumpla la ventana de seguridad.`
          : 'No aumentar presupuesto. La reducción solo se habilita con confirmación 3D, sin recuperación y fuera de la ventana de seguridad.'
    });
  }

  if (currentRow.status === 'Límite rentable') {
    return withScaleDiagnosis({
      ...base,
      status: 'ESCALA · LÍMITE RENTABLE',
      tone: 'attention',
      summary:
        `El presupuesto actual de ${fmtMoney(currentBudget)} sigue siendo rentable, pero el CPA histórico del nivel (${fmtCpa(currentRow.cpa)}) ` +
        `ya está cerca del máximo de ${fmtMoney(max)}.`,
      action:
        'Mantener este nivel. No aumentar presupuesto solo por historial; una nueva escala requiere que el 3D y todos los guardrails vuelvan a mostrar margen.'
    });
  }

  if (currentRow.status === 'Rentable') {
    return withScaleDiagnosis({
      ...base,
      status: 'ESCALA RENTABLE',
      tone: 'good',
      summary:
        `El nivel actual de ${fmtMoney(currentBudget)} mantiene un CPA histórico ponderado de ${fmtCpa(currentRow.cpa)}, ` +
        `con margen frente al máximo de ${fmtMoney(max)}.`,
      action:
        'El historial permite considerar este nivel saludable. Una nueva escala solo corresponde si el 3D actual también autoriza escalar.'
    });
  }

  return withScaleDiagnosis({
    ...base,
    status: 'ESCALA EN OBSERVACIÓN',
    tone: 'neutral',
    summary:
      `El presupuesto actual es ${fmtMoney(currentBudget)}. El historial de este nivel todavía no permite clasificarlo con suficiente claridad.`,
    action:
      'Mantener el presupuesto y seguir acumulando datos completos. No usar esta tarjeta por sí sola para subir o bajar inversión.'
  });
}

function CurrentScaleStatusCardCC({ scaleStatus, maxCpa }) {
  if (!scaleStatus) return null;

  const tone = scaleStatus.tone || 'neutral';
  const diag = scaleStatus.scaleDiagnosis || null;
  const marginalDisplay = marginalCpaDisplayCC(scaleStatus, maxCpa);

  const valueBox = (label, value, sub = null) => (
    <div className="min-w-0 rounded-xl border border-white/80 bg-white/80 px-3 py-3 sm:px-3.5 sm:py-3.5 lg:px-4 lg:py-4">
      <p
        className="text-[6px] sm:text-[6.5px] lg:text-[7.5px] font-black uppercase leading-tight tracking-wide text-slate-400"
        style={{ overflowWrap: 'break-word', wordBreak: 'normal' }}
      >
        {label}
      </p>

      <p
        className="cc-value mt-2 font-black leading-tight tracking-[-0.015em] tabular-nums text-zinc-900 whitespace-nowrap"
        style={{ fontSize: 'clamp(17px, 1.1vw, 22px)' }}
      >
        {value}
      </p>

      {sub ? (
        <p className="text-[6px] sm:text-[6.5px] lg:text-[7.5px] text-slate-500 mt-1.5 leading-snug">
          {sub}
        </p>
      ) : null}
    </div>
  );

  return (
    <div className={`cc-scale-card mt-4 rounded-2xl border-2 p-3 sm:p-4 lg:p-4 ${toneBg(tone)}`}>
      {/* CABECERA */}
      <div className="min-w-0">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <p className="text-[7px] sm:text-[8px] lg:text-[9px] font-black uppercase tracking-wide text-slate-500">
            Estado actual de escala
          </p>

          <span
            className={`inline-flex self-start sm:self-auto max-w-full px-2.5 py-1.5 rounded-full text-[6.5px] sm:text-[7.5px] lg:text-[8.5px] font-black uppercase leading-tight text-center ${toneBadge(tone)}`}
            style={{ overflowWrap: 'break-word', wordBreak: 'normal' }}
          >
            {scaleStatus.status}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-1 xl:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)] gap-3 xl:gap-4">
          <p className="min-w-0 text-[9px] sm:text-[10px] lg:text-[12px] xl:text-[13px] font-bold text-zinc-900 leading-[1.5]">
            {scaleStatus.summary}
          </p>

          <div className="min-w-0 rounded-xl border border-white/70 bg-white/55 px-3 py-2.5">
            <p className="text-[6.5px] sm:text-[7px] lg:text-[8px] font-black uppercase tracking-wide text-slate-400">
              Qué hacer
            </p>
            <p className="text-[7.5px] sm:text-[8px] lg:text-[9.5px] xl:text-[10px] text-slate-700 mt-1.5 leading-[1.5]">
              {scaleStatus.action}
            </p>
          </div>
        </div>
      </div>

      {/* MÉTRICAS */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5 mt-4">
        {valueBox(
          'Presupuesto actual',
          scaleStatus.currentBudget ? fmtMoney(scaleStatus.currentBudget) : '—',
          scaleStatus.days ? `${scaleStatus.days} día(s) en este nivel` : null
        )}

        {valueBox(
          'CPA histórico del nivel',
          scaleStatus.cpa !== null && scaleStatus.cpa !== undefined
            ? fmtCpa(scaleStatus.cpa)
            : '—',
          `CPA máximo ${fmtMoney(maxCpa)}`
        )}

        <div className="min-w-0 rounded-xl border border-white/80 bg-white/80 px-2.5 py-2.5 sm:px-3 sm:py-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[6px] sm:text-[6.5px] lg:text-[7.5px] font-black uppercase leading-tight tracking-wide text-slate-400">
              CPA marginal
            </p>
            <span
              className={`inline-flex max-w-[65%] px-1.5 py-1 rounded-md text-[5.5px] sm:text-[6px] lg:text-[7px] font-black uppercase leading-tight text-center ${toneBadge(marginalDisplay.tone)}`}
              style={{ overflowWrap: 'break-word', wordBreak: 'normal' }}
            >
              {marginalDisplay.status}
            </span>
          </div>

          <p
            className="cc-value mt-2 font-black leading-tight tracking-[-0.015em] tabular-nums text-zinc-900 whitespace-nowrap"
            style={{ fontSize: 'clamp(18px, 1.15vw, 23px)' }}
          >
            {marginalDisplay.value}
          </p>

          <p className="text-[6.5px] sm:text-[7px] lg:text-[8px] text-slate-600 mt-1.5 leading-snug">
            {marginalDisplay.explanation}
          </p>

          <div className="mt-2 rounded-lg bg-slate-50 px-2 py-1.5">
            <p className="text-[5.5px] sm:text-[6px] lg:text-[7px] font-black uppercase text-slate-400">
              Qué pasó en este escalamiento
            </p>
            <p className="text-[5.5px] sm:text-[6px] lg:text-[7px] text-slate-500 mt-1 leading-snug">
              {marginalDisplay.detail}
            </p>
          </div>
        </div>

        {valueBox(
          'Último nivel rentable',
          scaleStatus.profitableCeilingBudget
            ? fmtMoney(scaleStatus.profitableCeilingBudget)
            : '—',
          scaleStatus.profitableCeilingCpa
            ? `CPA ${fmtCpa(scaleStatus.profitableCeilingCpa)}`
            : 'Sin nivel rentable confirmado'
        )}
      </div>

      {/* DIAGNÓSTICO DEL ESCALAMIENTO */}
      {diag ? (
        <div className={`mt-4 rounded-2xl border p-3 sm:p-3.5 ${toneBg(diag.tone || 'neutral')}`}>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <p className="text-[7px] sm:text-[8px] lg:text-[9px] font-black uppercase tracking-wide text-slate-500">
              Relación con último escalamiento
            </p>

            <span
              className={`inline-flex self-start md:self-auto max-w-full px-2.5 py-1.5 rounded-full text-[6.5px] sm:text-[7px] lg:text-[8px] font-black uppercase leading-tight text-center ${toneBadge(diag.tone || 'neutral')}`}
              style={{ overflowWrap: 'break-word', wordBreak: 'normal' }}
            >
              {diag.status}
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5 mt-3">
            <div className="min-w-0 rounded-xl border border-white/70 bg-white/70 p-2.5 sm:p-3">
              <p className="text-[6px] sm:text-[6.5px] sm:text-[7px] lg:text-[8px] font-black uppercase tracking-wide text-slate-400">
                Lectura
              </p>
              <p className="text-[7.5px] sm:text-[8px] lg:text-[9.5px] xl:text-[10px] font-semibold text-zinc-800 mt-1.5 leading-[1.5]">
                {diag.summary}
              </p>
            </div>

            <div className="min-w-0 rounded-xl border border-white/70 bg-white/70 p-2.5 sm:p-3">
              <p className="text-[6px] sm:text-[6.5px] sm:text-[7px] lg:text-[8px] font-black uppercase tracking-wide text-slate-400">
                Evidencia
              </p>
              <p className="text-[7.5px] sm:text-[8px] lg:text-[9.5px] xl:text-[10px] text-slate-600 mt-1.5 leading-[1.5]">
                {diag.evidence}
              </p>
            </div>

            <div className="min-w-0 rounded-xl border border-white/70 bg-white/70 p-2.5 sm:p-3">
              <p className="text-[6px] sm:text-[6.5px] sm:text-[7px] lg:text-[8px] font-black uppercase tracking-wide text-slate-400">
                {diag.shouldReduceBudget ? 'Acción' : 'Qué hacer'}
              </p>
              <p className="text-[7.5px] sm:text-[8px] lg:text-[9.5px] xl:text-[10px] font-semibold text-slate-700 mt-1.5 leading-[1.5]">
                {diag.recommendedAction}
              </p>
            </div>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[5.5px] sm:text-[6.5px] lg:text-[7.5px] text-slate-400">
            <span>Confianza: <strong>{diag.confidence}</strong></span>
            <span>3D confirma: <strong>{diag.threeDayConfirms ? 'Sí' : 'No'}</strong></span>
            <span>Recuperación: <strong>{diag.recoverySignal ? 'Sí' : 'No'}</strong></span>
            <span>Reducción: <strong>{diag.shouldReduceBudget ? 'Habilitada' : 'No habilitada'}</strong></span>
          </div>
        </div>
      ) : null}

      <p className="text-[5.5px] sm:text-[6.5px] lg:text-[7.5px] text-slate-400 mt-3 leading-relaxed">
        Lectura histórica del nivel de presupuesto. No reemplaza la decisión 3D ni los guardrails de escala.
      </p>
    </div>
  );
}

function CampaignReadingView({ campaign, product, adRows, campaignHistory, campaignDecision, benchmark, analysisPeriod = '3d', changeSafety = null, currentScaleStatus = null, onAdAction = null, adActionBusyId = '', onRegisterPlaybookAction = null, campaignPoda = null, onExecutePoda = null }) {
  const [expandedReadAds, setExpandedReadAds] = useState({});
  const [playbookHelpOpen, setPlaybookHelpOpen] = useState(false);
  const periodLabel = periodLabelCC(analysisPeriod);
  const periodCardLabel = periodCardLabelCC(analysisPeriod, false);
  const previousPeriodCardLabel = periodCardLabelCC(analysisPeriod, true);
  const { currentStats: campaign3d, previousStats: campaignPrev3d } = splitPeriodRecords(campaignHistory, analysisPeriod);
  const campaignDelta = {
    cpa: pctChange(campaign3d.cpa, campaignPrev3d.cpa),
    cpc: pctChange(campaign3d.cpc, campaignPrev3d.cpc),
    ctr: pctChange(campaign3d.ctr, campaignPrev3d.ctr),
    cpm: pctChange(campaign3d.cpm, campaignPrev3d.cpm),
    frequency: pctChange(campaign3d.frequency, campaignPrev3d.frequency),
    visitToPurchase: pctChange(campaign3d.visitToPurchase, campaignPrev3d.visitToPurchase)
  };
  const maxCpa = Math.max(1, toNumber(product?.maxCpa));

  const rows = adRows.map(row => {
    // Acción siempre 3D.
    const action = adReadingActionCC(row.diag, row.contribution, maxCpa);

    // Lectura analítica cambia con Último día / 3D / 7D / 14D / 30D.
    const readingDiag = readingDiagForPeriodCC(row.diag, analysisPeriod);
    const analysisContribution = row.analysisContribution || row.contribution;
    const audience = audiencePressureDiagnosisCC(readingDiag.scale3d, readingDiag.scalePrev3d, benchmark);
    const messages = messagePotentialDiagnosisCC(readingDiag, benchmark, row.ad, periodLabel);
    const relational = buildRelationalAdDiagnosticCC(
      readingDiag,
      analysisContribution,
      maxCpa,
      row.ad,
      benchmark,
      periodLabel
    );

    // Playbook is an additive operational layer and always uses fixed 3D.
    const playbook = buildPlaybookProtocolCC(
      row.diag,
      maxCpa,
      changeSafety,
      row.ad,
      campaign
    );

    return {
      ...row,
      analysisContribution,
      readingDiag,
      action,
      audience,
      messages,
      relational,
      playbook
    };
  }).sort((a, b) => {
    const order = { PAUSAR: 0, VIGILAR: 1, ESCALAR: 2, MANTENER: 3 };
    const actionDiff = (order[a.action.label] ?? 9) - (order[b.action.label] ?? 9);
    if (actionDiff !== 0) return actionDiff;
    return toNumber(b.relational?.priorityScore) - toNumber(a.relational?.priorityScore);
  });

  const actionCounts = rows.reduce((acc, row) => {
    acc[row.action.label] = (acc[row.action.label] || 0) + 1;
    return acc;
  }, {});

  const playbookRows = rows
    .filter(row => row.playbook?.active)
    .sort((a, b) => {
      const severityOrder = { confirmed: 3, alert: 2, watch: 1, none: 0 };
      return (severityOrder[b.playbook?.severity] || 0) - (severityOrder[a.playbook?.severity] || 0);
    });
  const playbookConfirmedCount = playbookRows.filter(r => r.playbook?.severity === 'confirmed').length;
  const playbookAlertCount = playbookRows.filter(r => r.playbook?.severity === 'alert').length;
  const topPlaybook = playbookRows[0] || null;
  const playbookEvaluation = playbookCampaignEvaluationCC(campaign, rows);

  const campaignOverview = buildCampaignLayerDiagnosticCC(
    campaign3d,
    campaignPrev3d,
    rows.map(r => ({ ...r, contribution: r.analysisContribution })),
    maxCpa,
    periodLabel,
    currentScaleStatus
  );

  const campaignTone =
    campaignOverview.resultTone === 'critical' ? 'critical' :
    campaignOverview.resultTone === 'alert' || campaignOverview.scopeTone === 'alert' ? 'attention' :
    campaignOverview.resultTone === 'good' && campaignOverview.scopeTone === 'good' ? 'good' :
    campaignDecision?.status === 'Escalable' ? 'good' :
    'normal';
  const campaignColors = readingActionClassesCC(campaignTone);

  return (
    <div className="cc-reading-view space-y-5 min-w-0">
      {/* CAPA 1 · CAMPAÑA */}
      <section
        className="cc-diagnosis-card min-w-0 overflow-hidden rounded-3xl border-2 bg-white shadow-sm"
        style={{ borderColor: campaignColors.border, boxShadow: `0 10px 28px ${campaignColors.border}12` }}
      >
        <div className="p-4 sm:p-5 lg:p-6">
          {/* Cabecera: lectura a la izquierda, acción a la derecha solo cuando hay espacio real */}
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-4 xl:gap-6 items-start">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-3 py-1.5 rounded-full text-[9px] font-black uppercase ${campaignColors.badge}`}>
                  CAPA 1 · CAMPAÑA
                </span>
                <span className="px-2.5 py-1.5 rounded-full bg-indigo-100 text-indigo-700 text-[8px] font-black uppercase">ANÁLISIS {periodLabel}</span>
                <span className="px-2.5 py-1.5 rounded-full bg-zinc-950 text-white text-[8px] font-black uppercase">3D DECIDE</span>
                <span className={`px-2.5 py-1.5 rounded-full text-[8px] font-black uppercase ${toneBadge(campaignOverview.scopeTone)}`}>
                  {campaignOverview.scope}
                </span>
              </div>

              <h3 className="text-xl sm:text-2xl font-black text-zinc-900 mt-3 break-words">{campaign.name}</h3>
              <p className={`text-[11px] sm:text-xs font-black mt-1 ${campaignColors.text}`}>{campaignOverview.resultTitle}</p>
              <p className="text-[10px] sm:text-[11px] font-semibold text-zinc-800 mt-2 max-w-4xl leading-relaxed">
                {campaignOverview.resultSimple}
              </p>
              <p className="text-[9px] sm:text-[10px] text-slate-600 mt-2 max-w-4xl leading-relaxed">
                {campaignOverview.scopeSimple}
              </p>
            </div>

            <div className={`rounded-2xl border p-4 ${toneBg(campaignOverview.scopeTone)}`}>
              <p className="text-[8px] font-black uppercase tracking-wider text-slate-500">Qué hacer con la campaña</p>
              <p className="text-sm font-black text-zinc-900 mt-1">{campaignOverview.dominantLayer}</p>
              <p className="text-[9px] text-slate-700 mt-2 leading-relaxed">{campaignOverview.action}</p>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <div className="rounded-xl bg-white/80 border border-white p-2.5">
                  <p className="text-[7px] font-black uppercase text-slate-400">Presupuesto afectado</p>
                  <p className="text-lg font-black mt-1">{fmtRate(campaignOverview.affectedSpend)}</p>
                </div>
                <div className="rounded-xl bg-white/80 border border-white p-2.5">
                  <p className="text-[7px] font-black uppercase text-slate-400">Anuncios afectados</p>
                  <p className="text-lg font-black mt-1">{campaignOverview.affectedCount}/{campaignOverview.activeSpendCount}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5">
            <p className="text-[7px] font-black uppercase text-slate-500">Cómo leer las métricas</p>
            <p className="text-[8px] text-slate-600 mt-1 leading-relaxed">
              <strong>Variación</strong> = dirección frente al bloque anterior. <strong>Salud actual</strong> = si el valor de hoy sigue dentro del estándar operativo. Una métrica puede deteriorarse y seguir saludable.
            </p>
          </div>

          {/* Métricas: nunca se fuerzan junto al texto. Tienen su propia fila */}
          <div className="cc-grid-metrics mt-5">
            <QuickMetricCC label="CPA" value={fmtCpa(campaign3d.cpa)} previousValue={fmtCpa(campaignPrev3d.cpa)} delta={campaignDelta.cpa} metric="cpa" sub={`Máx. ${fmtMoney(maxCpa)}`} periodLabel={periodCardLabel} previousPeriodLabel={previousPeriodCardLabel} healthStatus={campaignOverview.metricStatus?.cpa}/>
            <QuickMetricCC label="CPM" value={fmtMoneyOrDashCC(campaign3d.cpm)} previousValue={fmtMoneyOrDashCC(campaignPrev3d.cpm)} delta={campaignDelta.cpm} metric="cpm" sub="Costo de 1.000 impresiones" periodLabel={periodCardLabel} previousPeriodLabel={previousPeriodCardLabel} healthStatus={campaignOverview.metricStatus?.cpm}/>
            <QuickMetricCC label="CTR" value={fmtRate(campaign3d.ctr)} previousValue={fmtRate(campaignPrev3d.ctr)} delta={campaignDelta.ctr} metric="ctr" sub="Respuesta al anuncio" periodLabel={periodCardLabel} previousPeriodLabel={previousPeriodCardLabel} healthStatus={campaignOverview.metricStatus?.ctr}/>
            <QuickMetricCC label="CPC" value={fmtMoneyOrDashCC(campaign3d.cpc)} previousValue={fmtMoneyOrDashCC(campaignPrev3d.cpc)} delta={campaignDelta.cpc} metric="cpc" sub="Costo de cada clic" periodLabel={periodCardLabel} previousPeriodLabel={previousPeriodCardLabel} healthStatus={campaignOverview.metricStatus?.cpc}/>
            <QuickMetricCC label="CVR" value={fmtRate(campaign3d.visitToPurchase)} previousValue={fmtRate(campaignPrev3d.visitToPurchase)} delta={campaignDelta.visitToPurchase} metric="visitToPurchase" sub="Visita → compra" periodLabel={periodCardLabel} previousPeriodLabel={previousPeriodCardLabel} healthStatus={campaignOverview.metricStatus?.cvr}/>
            <QuickMetricCC label="Frecuencia" value={fmtFrequencyCC(campaign3d.frequency)} previousValue={fmtFrequencyCC(campaignPrev3d.frequency)} delta={campaignDelta.frequency} metric="frequency" sub="Playbook: 2,5–3,0 = alerta, no diagnóstico por sí sola" periodLabel={periodCardLabel} previousPeriodLabel={previousPeriodCardLabel}/>
          </div>

          <CurrentScaleStatusCardCC
            scaleStatus={currentScaleStatus}
            maxCpa={maxCpa}
          />

          {campaignPoda?.active ? (
            <div className={`mt-4 rounded-2xl border-2 p-3.5 sm:p-4 lg:p-5 ${toneBg(campaignPoda.tone)}`}>
              <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-zinc-950 text-white text-[8px] font-black uppercase">
                      <Scissors size={12}/> Capa 1 · La Poda CBO
                    </span>
                    <span className={`px-2.5 py-1.5 rounded-full text-[8px] font-black uppercase ${toneBadge(campaignPoda.tone)}`}>
                      {campaignPoda.status}
                    </span>
                  </div>

                  <p className="text-[10px] sm:text-[11px] font-semibold text-zinc-800 mt-2.5 leading-relaxed">
                    {campaignPoda.summary}
                  </p>
                  <p className="text-[8.5px] sm:text-[9px] text-slate-600 mt-2 leading-relaxed">
                    <strong>Evidencia:</strong> {campaignPoda.evidence}
                  </p>

                  {campaignPoda.dominantAd && campaignPoda.candidateAd ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-3">
                      <div className="rounded-xl border border-rose-200 bg-white/75 p-3">
                        <p className="text-[7px] font-black uppercase text-rose-600">Anuncio dominante</p>
                        <p className="text-[10px] font-black text-zinc-900 mt-1 break-words">{campaignPoda.dominantAd.name}</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[8px] text-slate-600">
                          {campaignPoda.dominantShare !== undefined ? <span>Gasto: <strong>{fmtRate(campaignPoda.dominantShare)}</strong></span> : null}
                          {campaignPoda.dominantStats ? <span>CPA: <strong>{fmtCpa(campaignPoda.dominantStats.cpa)}</strong></span> : null}
                        </div>
                      </div>

                      <div className="rounded-xl border border-emerald-200 bg-white/75 p-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-[7px] font-black uppercase text-emerald-700">Anuncio receptor</p>
                          {campaignPoda.candidateConfidence ? (
                            <span className="px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[6.5px] font-black uppercase">
                              {campaignPoda.candidateConfidence}
                            </span>
                          ) : null}
                        </div>
                        <p className="text-[10px] font-black text-zinc-900 mt-1 break-words">{campaignPoda.candidateAd.name}</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[8px] text-slate-600">
                          {campaignPoda.phase === 'pre_poda' && campaignPoda.candidateShare !== undefined ? (
                            <span>Gasto actual: <strong>{fmtRate(campaignPoda.candidateShare)}</strong></span>
                          ) : null}
                          {campaignPoda.phase === 'post_poda' && campaignPoda.spendShare !== undefined ? (
                            <span>Gasto post-poda: <strong>{fmtRate(campaignPoda.spendShare)}</strong></span>
                          ) : null}
                          {campaignPoda.candidateStats ? <span>CPA: <strong>{fmtCpa(campaignPoda.candidateStats.cpa)}</strong></span> : null}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="xl:w-[360px] xl:shrink-0 rounded-xl border border-white bg-white/75 p-3">
                  <p className="text-[7px] font-black uppercase text-slate-400">Acción recomendada</p>
                  <p className="text-[9px] sm:text-[10px] font-semibold text-slate-700 mt-1.5 leading-relaxed">
                    {campaignPoda.action}
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-2 mt-3">
                    {campaignPoda.canExecute && onExecutePoda ? (
                      <button
                        type="button"
                        onClick={() => onExecutePoda(campaignPoda)}
                        className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-rose-600 text-white text-[8px] sm:text-[9px] font-black uppercase"
                      >
                        <Scissors size={13}/> Ejecutar La Poda
                      </button>
                    ) : null}

                    {onRegisterPlaybookAction && campaignPoda.agendaAction ? (
                      <button
                        type="button"
                        onClick={() => onRegisterPlaybookAction(campaignPoda, campaignPoda.dominantAd || campaignPoda.candidateAd)}
                        className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-indigo-600 text-white text-[8px] sm:text-[9px] font-black uppercase"
                      >
                        <ListChecks size={13}/> Registrar acción
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className={`mt-4 rounded-2xl border-2 p-3.5 sm:p-4 lg:p-5 ${
            !playbookEvaluation.eligible
              ? 'border-slate-200 bg-slate-50'
              : topPlaybook
                ? toneBg(topPlaybook.playbook.tone)
                : 'border-indigo-200 bg-indigo-50/45'
          }`}>
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-2.5 py-1.5 rounded-full text-[8px] font-black uppercase ${
                    playbookEvaluation.eligible
                      ? 'bg-zinc-950 text-white'
                      : 'bg-slate-200 text-slate-600'
                  }`}>
                    Capa Playbook · 3D
                  </span>

                  {playbookEvaluation.eligible ? (
                    <span className="px-2 py-1 rounded-full bg-indigo-100 text-indigo-700 text-[7px] font-black uppercase">
                      Campaña ESCALA
                    </span>
                  ) : (
                    <span className="px-2 py-1 rounded-full bg-white border border-slate-200 text-slate-500 text-[7px] font-black uppercase">
                      No aplica
                    </span>
                  )}

                  {playbookConfirmedCount > 0 ? (
                    <span className="px-2 py-1 rounded-full bg-rose-100 text-rose-700 text-[7px] font-black uppercase">
                      {playbookConfirmedCount} confirmado{playbookConfirmedCount === 1 ? '' : 's'}
                    </span>
                  ) : null}

                  {playbookAlertCount > 0 ? (
                    <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-800 text-[7px] font-black uppercase">
                      {playbookAlertCount} alerta{playbookAlertCount === 1 ? '' : 's'}
                    </span>
                  ) : null}
                </div>

                <p className="text-[11px] font-black text-zinc-900 mt-2">
                  {topPlaybook ? topPlaybook.playbook.label : playbookEvaluation.label}
                </p>

                <p className="text-[9px] sm:text-[10px] text-slate-600 mt-1 leading-relaxed">
                  {topPlaybook
                    ? <>Principal señal: <strong>{topPlaybook.ad.name}</strong>. {topPlaybook.playbook.summary}</>
                    : playbookEvaluation.summary
                  }
                </p>

                {!topPlaybook ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mt-3">
                    <div className="rounded-xl border border-white/80 bg-white/70 p-3">
                      <p className="text-[7px] font-black uppercase text-slate-400">Protocolo A · Post-clic</p>
                      <p className="text-[8px] sm:text-[9px] text-slate-600 mt-1 leading-relaxed">
                        {playbookEvaluation.protocolA}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/80 bg-white/70 p-3">
                      <p className="text-[7px] font-black uppercase text-slate-400">Protocolo B · Fatiga</p>
                      <p className="text-[8px] sm:text-[9px] text-slate-600 mt-1 leading-relaxed">
                        {playbookEvaluation.protocolB}
                      </p>
                    </div>
                  </div>
                ) : null}

                <p className="text-[8px] text-slate-500 mt-2 leading-relaxed">
                  {topPlaybook
                    ? 'La severidad Playbook siempre está subordinada al CPA de seguridad y a la evidencia 3D.'
                    : playbookEvaluation.dataNote
                  }
                </p>
              </div>

              <div className="lg:w-[310px] lg:shrink-0 space-y-2">
                {topPlaybook ? (
                  <div className="rounded-xl bg-white/75 border border-white p-3">
                    <p className="text-[7px] font-black uppercase text-slate-400">Filtro económico</p>
                    <p className={`text-[9px] font-black mt-1 ${toneText(topPlaybook.playbook.economicGate?.tone)}`}>
                      {topPlaybook.playbook.economicGate?.label}
                    </p>
                    <p className="text-[8px] text-slate-500 mt-1 leading-relaxed">
                      Mientras el CPA siga dentro del límite rentable, Playbook solo puede emitir señal temprana o alerta; no un protocolo estricto.
                    </p>
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={() => setPlaybookHelpOpen(v => !v)}
                  className="w-full inline-flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-[8px] sm:text-[9px] font-black uppercase"
                >
                  <span className="inline-flex items-center gap-2"><Info size={13}/> Cómo funcionan los protocolos</span>
                  {playbookHelpOpen ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
                </button>
              </div>
            </div>

            {playbookHelpOpen ? (
              <div className="mt-3 pt-3 border-t border-slate-200/80">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5">
                  <div className="rounded-xl border border-blue-200 bg-white/80 p-3.5">
                    <p className="text-[8px] font-black uppercase text-blue-700">A · Deterioro post-clic</p>
                    <p className="text-[9px] text-slate-700 mt-1.5 leading-relaxed">
                      Busca una caída marcada del CVR mientras CPM, CTR y CPC permanecen relativamente estables. Si el CPA sigue rentable, solo alerta. Si el CPA supera seguridad y 3D confirma, habilita el protocolo post-clic.
                    </p>
                  </div>

                  <div className="rounded-xl border border-amber-200 bg-white/80 p-3.5">
                    <p className="text-[8px] font-black uppercase text-amber-700">B · Fatiga creativa</p>
                    <p className="text-[9px] text-slate-700 mt-1.5 leading-relaxed">
                      Frecuencia 2,5–3,0 es vigilancia, no sentencia. La fatiga necesita repetición alta/subiendo + CTR deteriorándose + presión de CPC/CPM. Solo se confirma estrictamente cuando también existe impacto económico.
                    </p>
                  </div>

                  <div className="rounded-xl border border-rose-200 bg-white/80 p-3.5">
                    <p className="text-[8px] font-black uppercase text-rose-700">La Poda · Capa 1</p>
                    <p className="text-[9px] text-slate-700 mt-1.5 leading-relaxed">
                      Se evalúa cuando un anuncio concentra la mayor parte del gasto y cumple pausa 3D, mientras otro anuncio rentable puede actuar como receptor. Después de apagar solo el dominante, se observa 48–72 h para distinguir Poda exitosa de Efecto Espejismo.
                    </p>
                  </div>
                </div>

                <div className="mt-2.5 rounded-xl border border-indigo-200 bg-indigo-50/70 p-3">
                  <p className="text-[8px] font-black uppercase text-indigo-700">Regla de aplicación</p>
                  <p className="text-[9px] text-slate-700 mt-1 leading-relaxed">
                    Esta capa se ejecuta únicamente cuando el nombre de la campaña contiene <strong>ESCALA</strong>. Campañas de testeo siguen usando el motor general, pero Playbook A/B y La Poda quedan desactivados.
                  </p>
                </div>
              </div>
            ) : null}
          </div>


          {/* Lectura ejecutiva */}
          <div className="cc-grid-diagnostic mt-4">
            <div className={`rounded-2xl border p-3.5 ${toneBg(campaignOverview.scopeTone)}`}>
              <p className="text-[8px] font-black uppercase text-slate-500">Alcance del problema</p>
              <p className="text-[12px] font-black mt-1">{campaignOverview.scope}</p>
              <p className="text-[9px] text-slate-600 mt-1.5 leading-relaxed">{campaignOverview.scopeSimple}</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
              <p className="text-[8px] font-black uppercase text-slate-500">Impacto en presupuesto</p>
              <p className="text-2xl font-black mt-1 text-zinc-900">{fmtRate(campaignOverview.affectedSpend)}</p>
              <p className="text-[9px] text-slate-600 mt-1.5 leading-relaxed">
                {campaignOverview.affectedCount} de {campaignOverview.activeSpendCount} anuncios con gasto requieren atención.
              </p>
            </div>

            <div className="sm:col-span-2 xl:col-span-1 rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
              <p className="text-[8px] font-black uppercase text-slate-500">Mayor señal observada</p>
              <p className="text-[12px] font-black mt-1 text-zinc-900">{campaignOverview.dominantLayer}</p>
              <p className="text-[9px] text-slate-600 mt-1.5 leading-relaxed">{campaignOverview.action}</p>
            </div>
          </div>

          {campaignOverview.topProblems.length ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <p className="text-[8px] font-black uppercase tracking-wider text-slate-400">Anuncios que más explican el deterioro</p>
                <p className="text-[8px] text-slate-400">Ordenados por impacto económico</p>
              </div>
              <div className="cc-grid-diagnostic mt-2.5">
                {campaignOverview.topProblems.map((item, index) => (
                  <div key={item.id || index} className="min-w-0 rounded-xl bg-slate-50 border border-slate-100 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 text-[10px] font-black text-zinc-900 break-words">{index + 1}. {item.name}</p>
                      <span className={`shrink-0 px-2 py-1 rounded-full text-[7px] font-black ${item.action === 'PAUSAR' ? 'bg-rose-600 text-white' : 'bg-amber-100 text-amber-700'}`}>
                        {item.action}
                      </span>
                    </div>
                    <p className="text-[8px] text-slate-500 mt-1.5 leading-relaxed">
                      {fmtRate(item.spendShare)} del gasto · {item.contribution} · {item.layer}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-4 pt-3 border-t border-slate-100">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <p className="text-[8px] font-black uppercase tracking-wider text-slate-400">Hoy debes hacer</p>
              <p className="text-[8px] text-slate-400">Pausar protege presupuesto; no declara muerto el creativo.</p>
            </div>
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 mt-2.5">
              <span className="px-3 py-2 rounded-xl bg-rose-50 text-rose-700 text-[9px] font-black text-center">{actionCounts.PAUSAR || 0} pausar</span>
              <span className="px-3 py-2 rounded-xl bg-amber-50 text-amber-700 text-[9px] font-black text-center">{actionCounts.VIGILAR || 0} vigilar</span>
              <span className="px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 text-[9px] font-black text-center">{actionCounts.ESCALAR || 0} escalar</span>
              <span className="px-3 py-2 rounded-xl bg-blue-50 text-blue-700 text-[9px] font-black text-center">{actionCounts.MANTENER || 0} mantener</span>
            </div>
          </div>
        </div>
      </section>

      {campaign.active !== false && changeSafety ? (
        <CampaignChangeSafetyCardCC
          safety={changeSafety}
          currentBudget={campaignHistory?.[campaignHistory.length - 1]?.budget}
        />
      ) : null}

      {/* Separador conceptual */}
      <div className="rounded-2xl bg-zinc-950 text-white p-3.5 sm:p-4">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] lg:items-center gap-2 lg:gap-5">
          <div>
            <p className="text-[9px] font-black uppercase tracking-wider text-emerald-400">Cómo leer esta pantalla</p>
            <p className="text-[9px] sm:text-[10px] text-zinc-300 mt-1 leading-relaxed">
              Primero mira la campaña. Después baja únicamente a los anuncios que explican el cambio. Todo lo operativo usa 3D vs los 3 días activos completos anteriores.
            </p>
          </div>
          <span className="text-[8px] font-black uppercase text-zinc-400 lg:text-right">
            Pausar → Vigilar → Escalar → Mantener
          </span>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 px-1 pt-1">
        <span className="w-fit px-3 py-1.5 rounded-full bg-zinc-950 text-white text-[8px] font-black uppercase">CAPA 2 · ANUNCIOS</span>
        <p className="text-[9px] text-slate-500">Detalle por anuncio: qué cambió, dónde está el problema y qué acción corresponde.</p>
      </div>

      {/* CAPA 2 · ANUNCIOS */}
      {rows.length ? rows.map(({ ad, diag, contribution, analysisContribution, readingDiag, action, audience, messages, relational, playbook }) => {
        const colors = readingActionClassesCC(action.tone);
        const open = expandedReadAds[ad.id] === true;
        const hh = diag.hookHold3d;
        const contributionTone =
          contribution?.status === 'Drena la campaña' ? 'critical' :
          contribution?.status === 'Aporta fuertemente' || contribution?.status === 'Aporta' ? 'good' :
          contribution?.status === 'Sin entrega de Meta' ? 'attention' : 'neutral';

        return (
          <article
            key={ad.id}
            className="cc-diagnosis-card min-w-0 overflow-hidden rounded-3xl border-2 bg-white shadow-sm"
            style={{ borderColor: colors.border, boxShadow: `0 8px 24px ${colors.border}10` }}
          >
            <div className="p-4 sm:p-5 lg:p-6">
              {/* Identidad + decisión, sin forzar las métricas en paralelo */}
              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4 xl:gap-6 items-start">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-3 py-1.5 rounded-full text-[9px] font-black uppercase ${colors.badge}`}>{action.label}</span>
                    <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-600 text-[8px] font-black uppercase">
                      {hh?.isVideo ? 'VIDEO' : 'IMAGEN / CREATIVO'}
                    </span>
                    {contribution ? (
                      <span className={`px-2 py-1 rounded-full text-[8px] font-black uppercase ${toneBadge(contributionTone)}`}>
                        {contribution.status}
                      </span>
                    ) : null}
                  </div>

                  <h4 className="text-base sm:text-lg font-black text-zinc-900 mt-3 break-words">{ad.name}</h4>
                  <p className={`text-[10px] sm:text-[11px] font-black mt-1 ${colors.text}`}>{diag.operational3dDiagnosis}</p>
                  <p className="text-[10px] font-black text-zinc-800 mt-2 leading-relaxed max-w-4xl">{relational.general.title}</p>
                  <p className="text-[9px] sm:text-[10px] text-slate-600 mt-1 leading-relaxed max-w-4xl">{relational.general.simpleStory}</p>
                </div>

                <div className={`rounded-2xl border p-4 ${toneBg(action.pause?.tone || action.tone || 'normal')}`}>
                  <p className="text-[8px] font-black uppercase text-slate-500">Acción recomendada</p>
                  <p className={`text-sm font-black mt-1 ${colors.text}`}>{action.title}</p>
                  <p className="text-[9px] text-slate-700 mt-2 leading-relaxed">{action.simple}</p>
                  <p className="text-[8px] font-black text-zinc-700 mt-3">
                    Prioridad: {relational.impact.level}
                  </p>

                  {onAdAction ? (
                    <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-200/70">
                      <button
                        type="button"
                        disabled={adActionBusyId === ad.id}
                        onClick={() => onAdAction('off', ad)}
                        className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl bg-amber-100 text-amber-800 text-[8px] font-black uppercase disabled:opacity-50"
                      >
                        <PowerOff size={12}/> Apagar
                      </button>
                      <button
                        type="button"
                        disabled={adActionBusyId === ad.id}
                        onClick={() => onAdAction('delete', ad)}
                        className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl bg-rose-100 text-rose-700 text-[8px] font-black uppercase disabled:opacity-50"
                        title="Eliminar de la configuración activa conservando histórico y bitácora"
                      >
                        <Trash2 size={12}/> Eliminar
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Métricas principales */}
              <div className="cc-grid-metrics mt-5">
                <QuickMetricCC label="CPA" value={fmtCpa(readingDiag.scale3d.cpa)} previousValue={fmtCpa(readingDiag.scalePrev3d.cpa)} delta={readingDiag.scaleDelta3d.cpa} metric="cpa" sub={`Máx. ${fmtMoney(maxCpa)} · ${periodLabel}`} periodLabel={periodCardLabel} previousPeriodLabel={previousPeriodCardLabel} healthStatus={relational.metricStatus?.cpa}/>
                <QuickMetricCC label="CPC" value={fmtMoneyOrDashCC(readingDiag.scale3d.cpc)} previousValue={fmtMoneyOrDashCC(readingDiag.scalePrev3d.cpc)} delta={readingDiag.scaleDelta3d.cpc} metric="cpc" sub={relational.metricStatus?.cpc?.standardText || periodLabel} periodLabel={periodCardLabel} previousPeriodLabel={previousPeriodCardLabel} healthStatus={relational.metricStatus?.cpc}/>
                <QuickMetricCC label="CTR" value={fmtRate(readingDiag.scale3d.ctr)} previousValue={fmtRate(readingDiag.scalePrev3d.ctr)} delta={readingDiag.scaleDelta3d.ctr} metric="ctr" sub={relational.metricStatus?.ctr?.standardText || periodLabel} periodLabel={periodCardLabel} previousPeriodLabel={previousPeriodCardLabel} healthStatus={relational.metricStatus?.ctr}/>
                <QuickMetricCC label="CPM" value={fmtMoneyOrDashCC(readingDiag.scale3d.cpm)} previousValue={fmtMoneyOrDashCC(readingDiag.scalePrev3d.cpm)} delta={readingDiag.scaleDelta3d.cpm} metric="cpm" sub={relational.metricStatus?.cpm?.standardText || periodLabel} periodLabel={periodCardLabel} previousPeriodLabel={previousPeriodCardLabel} healthStatus={relational.metricStatus?.cpm}/>
                <QuickMetricCC label="CVR" value={fmtRate(readingDiag.scale3d.visitToPurchase)} previousValue={fmtRate(readingDiag.scalePrev3d.visitToPurchase)} delta={readingDiag.scaleDelta3d.visitToPurchase} metric="visitToPurchase" sub={relational.metricStatus?.cvr?.standardText || `Visita → compra · ${periodLabel}`} periodLabel={periodCardLabel} previousPeriodLabel={previousPeriodCardLabel} healthStatus={relational.metricStatus?.cvr}/>
                <QuickMetricCC label="Frecuencia" value={fmtFrequencyCC(readingDiag.scale3d.frequency)} previousValue={fmtFrequencyCC(readingDiag.scalePrev3d.frequency)} delta={readingDiag.scaleDelta3d.frequency} metric="frequency" sub="Playbook: interpretar junto con CTR/CPC/CPA" periodLabel={periodCardLabel} previousPeriodLabel={previousPeriodCardLabel}/>
              </div>

              {playbook?.active ? (
                <div className={`mt-4 rounded-2xl border-2 p-3.5 sm:p-4 lg:p-5 ${toneBg(playbook.tone)}`}>
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-2.5 py-1.5 rounded-full text-[8px] font-black uppercase ${toneBadge(playbook.tone)}`}>
                          {playbook.severity === 'confirmed' ? 'PROTOCOLO CONFIRMADO' : playbook.severity === 'alert' ? 'ALERTA PLAYBOOK' : 'SEÑAL PLAYBOOK'}
                        </span>
                        <span className="px-2 py-1 rounded-full bg-white/75 text-slate-600 text-[7px] font-black uppercase">
                          {playbook.economicGate?.label}
                        </span>
                      </div>

                      <p className="text-[11px] sm:text-[12px] font-black text-zinc-900 mt-2">
                        {playbook.label}
                      </p>
                      <p className="text-[9px] sm:text-[10px] text-slate-700 mt-1.5 leading-relaxed">
                        {playbook.summary}
                      </p>
                      <p className="text-[8px] sm:text-[9px] text-slate-500 mt-1.5 leading-relaxed">
                        <strong>Evidencia:</strong> {playbook.evidence}
                      </p>

                      {playbook.secondary?.length ? (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {playbook.secondary.map((signal, index) => (
                            <span key={`${signal.code}_${index}`} className="px-2 py-1 rounded-full bg-white/70 border border-white text-[7px] font-black uppercase text-slate-600">
                              También: {signal.label}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="lg:w-[340px] lg:shrink-0 rounded-xl bg-white/75 border border-white p-3">
                      <p className="text-[7px] font-black uppercase text-slate-400">Acción recomendada por Playbook</p>
                      <p className="text-[9px] sm:text-[10px] font-semibold text-slate-700 mt-1.5 leading-relaxed">
                        {playbook.action}
                      </p>
                      {onRegisterPlaybookAction && playbook.agendaAction ? (
                        <button
                          type="button"
                          onClick={() => onRegisterPlaybookAction(playbook, ad)}
                          className="w-full mt-3 inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-indigo-600 text-white text-[8px] sm:text-[9px] font-black uppercase"
                        >
                          <ListChecks size={13}/> Registrar acción recomendada
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Diagnóstico relacional */}
              <div className="mt-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <p className="text-[8px] font-black uppercase tracking-wider text-slate-400">Cadena diagnóstica {periodLabel}</p>
                  <span className="w-fit px-2.5 py-1.5 rounded-full bg-zinc-950 text-white text-[8px] font-black uppercase">
                    Principal: {relational.primaryLayer}
                  </span>
                </div>

                <div className={`mt-2.5 rounded-2xl border-2 p-3.5 sm:p-4 lg:p-5 ${toneBg(relational.general.tone)}`}>
                  <p className="text-[8px] font-black uppercase">Diagnóstico general</p>
                  <p className="text-[12px] font-black mt-1">{relational.general.title}</p>
                  <p className="text-[9px] sm:text-[10px] text-slate-600 mt-1.5 leading-relaxed">{relational.general.interpretation}</p>
                </div>

                <div className="cc-grid-diagnostic mt-2.5">
                  {[
                    ['1 · Resultado', relational.result],
                    ['2 · Impacto presupuesto', relational.impact],
                    ['3 · Distribución', relational.distribution],
                    ['4 · Respuesta creativa', relational.creative],
                    ['5 · Costo del tráfico', relational.traffic],
                    ['6 · Post-clic / CVR', relational.postClick]
                  ].map(([label, layer]) => (
                    <div key={label} className={`min-w-0 rounded-2xl border p-3.5 ${toneBg(layer?.tone || 'normal')}`}>
                      <p className="text-[8px] font-black uppercase text-slate-500">{label}</p>
                      <p className="text-[10px] font-black mt-1.5 break-words">{layer?.title || layer?.level || '—'}</p>
                      <p className="text-[8px] sm:text-[9px] text-slate-600 mt-1.5 leading-relaxed">{layer?.plain || layer?.summary || '—'}</p>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-2.5">
                  {hh?.isVideo ? (
                    <div className={`rounded-2xl border p-3.5 ${toneBg(hh.tone)}`}>
                      <p className="text-[8px] font-black uppercase">Video · Hook / Hold</p>
                      <p className="text-[10px] font-black mt-1.5">{hh.diagnosis}</p>
                      <p className="text-[8px] text-slate-500 mt-1.5">Hook {fmtRate(readingDiag.scale3d.hookRate)} · Hold {fmtRate(readingDiag.scale3d.holdRate)}</p>
                    </div>
                  ) : (
                    <div className="rounded-2xl border p-3.5 bg-slate-50 border-slate-200">
                      <p className="text-[8px] font-black uppercase">Creativo de imagen</p>
                      <p className="text-[10px] font-black mt-1.5">CTR tiene mayor peso en la lectura creativa.</p>
                      <p className="text-[8px] text-slate-500 mt-1.5">
                        CTR {fmtRate(readingDiag.scale3d.ctr)} · Δ {readingDiag.scaleDelta3d.ctr === null ? '—' : `${readingDiag.scaleDelta3d.ctr > 0 ? '+' : ''}${fmtNum(readingDiag.scaleDelta3d.ctr,2)}%`}
                      </p>
                    </div>
                  )}

                  <div className={`rounded-2xl border p-3.5 ${toneBg(messages.tone)}`}>
                    <p className="text-[8px] font-black uppercase">Potencial para mensajes</p>
                    <p className="text-[10px] font-black mt-1.5">{messages.label}</p>
                    <p className="text-[8px] sm:text-[9px] text-slate-500 mt-1.5 leading-relaxed">{messages.summary}</p>
                  </div>
                </div>
              </div>

              {/* Acción inferior / detalle */}
              <div className="mt-4 rounded-2xl bg-slate-50 border border-slate-200 p-3.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[8px] font-black uppercase tracking-wider text-slate-400">Evidencia de la decisión</p>
                    <p className="text-[9px] text-slate-600 mt-1 leading-relaxed max-w-4xl">{action.reason}</p>
                    <p className="text-[8px] font-black text-zinc-700 mt-2">
                      {relational.impact.summary}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedReadAds(x => ({ ...x, [ad.id]: !open }))}
                    className="w-full sm:w-auto shrink-0 px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-[9px] font-black uppercase text-slate-600"
                  >
                    {open ? 'Ocultar detalle' : 'Ver por qué'}
                  </button>
                </div>
              </div>
            </div>

            {open && (
              <div className="border-t border-slate-100 bg-slate-50/60 p-4 sm:p-5 lg:p-6">
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-2.5 mb-3">
                  <div className="rounded-2xl bg-white border border-slate-200 p-3.5">
                    <p className="text-[8px] font-black uppercase text-emerald-700">Hecho</p>
                    <p className="text-[9px] text-slate-700 mt-1.5 leading-relaxed">{relational.general.fact}</p>
                  </div>
                  <div className="rounded-2xl bg-white border border-slate-200 p-3.5">
                    <p className="text-[8px] font-black uppercase text-blue-700">Interpretación</p>
                    <p className="text-[9px] text-slate-700 mt-1.5 leading-relaxed">{relational.general.interpretation}</p>
                  </div>
                  <div className="rounded-2xl bg-white border border-slate-200 p-3.5">
                    <p className="text-[8px] font-black uppercase text-amber-700">Hipótesis · no demostrada</p>
                    <p className="text-[9px] text-slate-700 mt-1.5 leading-relaxed">{relational.general.hypothesis}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  <div className={`rounded-2xl border p-3.5 ${toneBg(action.pause?.tone || 'normal')}`}>
                    <p className="text-[8px] font-black uppercase text-slate-500">Protección de presupuesto · pausa 3D</p>
                    <p className="text-[11px] font-black mt-1">{action.pause?.title || 'SIN LECTURA'}</p>
                    <p className="text-[9px] text-slate-700 mt-2 leading-relaxed">{action.pause?.simple}</p>
                    <p className="text-[8px] text-slate-500 mt-2">
                      {action.pause?.recoverySignal ? 'El último día completo muestra recuperación y frena una pausa automática.' : 'El último día completo no reemplaza al 3D; solo ayuda a detectar recuperación.'}
                    </p>
                    <p className="text-[8px] font-black text-zinc-700 mt-2">{action.pause?.futureStatus}</p>
                  </div>

                  <div className="rounded-2xl bg-white border border-slate-200 p-3.5">
                    <p className="text-[8px] font-black uppercase text-slate-500">Contribución {periodLabel} · lo que aporta / drena</p>
                    <p className={`text-[11px] font-black mt-1 ${toneText(contributionTone)}`}>{analysisContribution?.status || 'Sin lectura'}</p>
                    <p className="text-[9px] text-slate-600 mt-2">{analysisContribution?.cause || 'Sin diagnóstico de contribución.'}</p>
                    <div className="cc-grid-mini mt-3">
                      <MiniCard label="Gasto campaña" value={fmtRate(analysisContribution?.spendShare)} />
                      <MiniCard label="Compras campaña" value={fmtRate(analysisContribution?.purchaseShare)} />
                      <MiniCard label="CPA anuncio" value={fmtCpa(analysisContribution?.cpa)} />
                      <MiniCard label="CPA resto sin anuncio" value={fmtCpa(analysisContribution?.cpaWithout)} />
                      <MiniCard label="CVR anuncio" value={fmtRate(analysisContribution?.adSameWindowVisitToPurchase)} />
                      <MiniCard label="CVR otros anuncios" value={fmtRate(analysisContribution?.peerVisitToPurchase)} />
                    </div>
                  </div>

                  <div className="rounded-2xl bg-white border border-slate-200 p-3.5">
                    <p className="text-[8px] font-black uppercase text-slate-500">CVR vs otros anuncios · misma ventana</p>
                    <p className={`text-[11px] font-black mt-1 ${toneText(relational.postClick.tone)}`}>{relational.postClick.title}</p>
                    <p className="text-[9px] text-slate-600 mt-2 leading-relaxed">{relational.postClick.peerInterpretation}</p>
                    <p className="text-[8px] text-slate-400 mt-2">Esto evita culpar automáticamente a la landing cuando el deterioro puede estar concentrado en el tráfico de un solo anuncio.</p>
                  </div>

                  <div className="rounded-2xl bg-white border border-slate-200 p-3.5">
                    <p className="text-[8px] font-black uppercase text-slate-500">Presión de audiencia</p>
                    <p className={`text-[11px] font-black mt-1 ${toneText(audience.tone)}`}>{audience.label}</p>
                    <p className="text-[9px] text-slate-600 mt-2 leading-relaxed">{audience.summary}</p>
                    <p className="text-[9px] text-slate-500 mt-2"><strong>Posible causa:</strong> {audience.cause}</p>
                    <p className="text-[9px] font-black text-zinc-800 mt-2">Acción: {audience.action}</p>
                  </div>

                  <div className="rounded-2xl bg-white border border-slate-200 p-3.5">
                    <p className="text-[8px] font-black uppercase text-slate-500">Potencial para campañas de mensajes</p>
                    <p className={`text-[11px] font-black mt-1 ${toneText(messages.tone)}`}>{messages.label}</p>
                    <p className="text-[9px] text-slate-600 mt-2 leading-relaxed">{messages.summary}</p>
                    <p className="text-[9px] font-black text-zinc-800 mt-2">Acción: {messages.action}</p>
                    <p className="text-[8px] text-slate-400 mt-2">Esta señal no modifica CPA, ganador/perdedor ni guardrails. Solo prioriza creativos para probar en mensajes.</p>
                  </div>

                  <div className="rounded-2xl bg-white border border-slate-200 p-3.5">
                    <p className="text-[8px] font-black uppercase text-slate-500">Confianza de la evidencia</p>
                    <p className="text-[11px] font-black mt-1 text-zinc-900">{relational.confidence.label}</p>
                    <p className="text-[9px] text-slate-600 mt-2">{relational.confidence.summary}</p>
                    <p className="text-[8px] text-slate-400 mt-2">La confianza contextualiza el diagnóstico; no sustituye las reglas 3D.</p>
                  </div>

                  <div className="rounded-2xl bg-white border border-slate-200 p-3.5 xl:col-span-2">
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 lg:items-center">
                      <div>
                        <p className="text-[8px] font-black uppercase text-slate-500">Guardrails 3D</p>
                        <p className="text-[9px] text-slate-500 mt-2">
                          Volumen: {fmtNum(diag.volumeReference?.purchases, 0)} compras · confianza {diag.volumeReference?.confidence}. El volumen informa confianza; no bloquea por sí solo.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <GuardrailPill ok={diag.guardrails.cpaMargin} label="Margen CPA"/>
                        <GuardrailPill ok={diag.guardrails.stability} label="Estabilidad"/>
                        <GuardrailPill ok={diag.guardrails.creative} label="Creativo"/>
                        <GuardrailPill ok={diag.guardrails.postClick} label="Post-clic"/>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </article>
        );
      }) : <EmptyState>Sin anuncios activos con datos para la ventana seleccionada.</EmptyState>}
    </div>
  );
}

function CampaignDiagnosticDetail({ ownerUid, campaign, product, ads, allAds, allCampaigns, dailyAds, dailyCampaigns, budgetChanges, decisions, recommendations, actionItems = [], period }) {
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
  const [viewMode, setViewMode] = useState('reading');
  const [adActionModal, setAdActionModal] = useState(null);
  const [adActionReason, setAdActionReason] = useState('');
  const [adActionBusyId, setAdActionBusyId] = useState('');
  const [adActionMessage, setAdActionMessage] = useState('');
  const [planActionOpen, setPlanActionOpen] = useState(false);
  const [planActionText, setPlanActionText] = useState('');
  const [planActionNote, setPlanActionNote] = useState('');
  const [planActionAdId, setPlanActionAdId] = useState('');
  const [planActionBusy, setPlanActionBusy] = useState(false);
  const [planActionMessage, setPlanActionMessage] = useState('');

  useEffect(() => {
    if (['last', '3d', '7d', '14d', '30d'].includes(period)) setMonitorPeriod(period);
  }, [period]);

  const visibleAds = ads.filter(a => a.deleted !== true && a.active !== false && campaign.active !== false && !campaign.archived);

  const contribution3d = useMemo(
    () => buildCampaignContribution3D(
      campaign,
      product,
      allAds || ads,
      dailyAds
    ),
    [campaign, product, allAds, ads, dailyAds]
  );

  const contributionAnalysis = useMemo(
    () => buildCampaignContributionPeriodCC(
      campaign,
      product,
      allAds || ads,
      dailyAds,
      monitorPeriod
    ),
    [campaign, product, allAds, ads, dailyAds, monitorPeriod]
  );

  const adRows = visibleAds.map(ad => {
    const records = dailyAds.filter(r => r.adId === ad.id);
    return {
      ad,
      diag: diagnoseAd(records, product, ad, monitorPeriod, campaign),
      contribution: contribution3d.byAd[ad.id] || null,
      analysisContribution: contributionAnalysis.byAd[ad.id] || null
    };
  }).sort((a, b) => (a.diag.stats.cpa || 999999999) - (b.diag.stats.cpa || 999999999));

  const today = todayColombiaCC();
  const safetyNowMs = useSafetyClockCC();
  const campaignHistory = eligibleCampaignRecords(
    dailyCampaigns.filter(r => r.campaignId === campaign.id),
    campaign
  ).filter(r => String(r.date) < today)
   .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const scaleRows = useMemo(() => buildScaleHistory(campaignHistory, product?.maxCpa), [campaignHistory, product?.maxCpa]);
  const budgetRows = budgetChanges.filter(b => b.campaignId === campaign.id).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const decisionRows = decisions.filter(d => d.campaignId === campaign.id).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const changeSafety = useMemo(
    () => buildCampaignChangeSafetyCC(campaign, budgetChanges, decisions, safetyNowMs),
    [campaign, budgetChanges, decisions, safetyNowMs]
  );
  const currentScaleStatus = useMemo(
    () => buildCurrentScaleStatusCC(campaignHistory, scaleRows, product?.maxCpa, budgetRows, changeSafety),
    [campaignHistory, scaleRows, product?.maxCpa, budgetRows, changeSafety]
  );

  const campaignPoda = useMemo(
    () => buildCampaignPruningProtocolCC({
      campaign,
      product,
      allAds: allAds || ads,
      dailyAds,
      decisions: decisionRows,
      changeSafety,
      nowMs: safetyNowMs
    }),
    [campaign, product, allAds, ads, dailyAds, decisionRows, changeSafety, safetyNowMs]
  );

  const campaignPendingActions = actionItems.filter(
    x => x.campaignId === campaign.id && x.status !== 'approved'
  );

  const savePlannedAction = async () => {
    const actionText = String(planActionText || '').trim();
    const note = String(planActionNote || '').trim();
    const relatedAd = ads.find(a => a.id === planActionAdId) || null;

    if (!actionText) {
      setPlanActionMessage('Escribe la acción que deseas registrar.');
      return;
    }

    setPlanActionBusy(true);
    setPlanActionMessage('');

    try {
      await addDoc(collection(db, COLLECTIONS.actionItems), {
        ownerUid,
        productId: campaign.productId || product?.id || null,
        productNameSnapshot: product?.name || null,
        campaignId: campaign.id,
        campaignNameSnapshot: campaign.name || null,
        adId: relatedAd?.id || null,
        adNameSnapshot: relatedAd?.name || null,
        actionText,
        note,
        status: 'pending',
        createdDate: todayColombiaCC(),
        source: 'campaign_review',
        clientRecordedAtMs: Date.now(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      setPlanActionOpen(false);
      setPlanActionText('');
      setPlanActionNote('');
      setPlanActionAdId('');
    } catch (error) {
      console.error('Lectura de Campañas · registrar acción', error);
      setPlanActionMessage(error?.message || 'No fue posible registrar la acción.');
    } finally {
      setPlanActionBusy(false);
    }
  };

  const requestPlaybookAction = (playbook, ad) => {
    if (!playbook?.agendaAction) return;
    setPlanActionText(playbook.agendaAction);
    setPlanActionNote(playbook.agendaNote || playbook.action || '');
    setPlanActionAdId(ad?.id || '');
    setPlanActionMessage('');
    setPlanActionOpen(true);
  };

  const requestAdAction = (mode, ad, meta = {}) => {
    if (!ad?.id) return;
    setAdActionModal({ mode, ad, ...meta });
    setAdActionReason(meta?.prefillReason || '');
    setAdActionMessage('');
  };

  const requestPodaExecution = poda => {
    const dominantAd =
      (allAds || ads).find(a => a.id === poda?.dominantAd?.id) ||
      poda?.dominantAd;

    if (!dominantAd?.id || !poda?.candidateAd?.id) return;

    requestAdAction('off', dominantAd, {
      protocol: 'poda',
      podaCandidateAdId: poda.candidateAd.id,
      podaCandidateNameSnapshot: poda.candidateAd.name,
      prefillReason:
        `LA PODA CBO: ${dominantAd.name} concentra el gasto y cumple pausa 3D. ` +
        `${poda.candidateAd.name} queda activo como receptor para validar absorción durante 48–72 h.`
    });
  };

  const closeAdActionModal = () => {
    if (adActionBusyId) return;
    setAdActionModal(null);
    setAdActionReason('');
  };

  const applyAdAction = async () => {
    const mode = adActionModal?.mode;
    const ad = adActionModal?.ad;
    const reason = String(adActionReason || '').trim();

    if (!ad?.id || !mode) return;
    if (!reason) {
      setAdActionMessage('Escribe la razón del cambio para guardarla en la bitácora.');
      return;
    }

    if (changeSafety?.active && changeSafety?.canStructuralNow === false) {
      const ok = window.confirm(
        `MARGEN DE SEGURIDAD ACTIVO\n\n` +
        `Todavía faltan ${fmtHoursRemainingCC(changeSafety.structuralRemainingHours)} para completar la ventana interna de 48 horas.\n\n` +
        `El cambio quedará registrado en la bitácora si decides continuar.\n\n` +
        `¿Deseas continuar de todas formas?`
      );
      if (!ok) return;
    }

    setAdActionBusyId(ad.id);
    setAdActionMessage('');

    try {
      const todayAction = todayColombiaCC();
      const batch = writeBatch(db);

      if (mode === 'off') {
        batch.update(doc(db, COLLECTIONS.ads, ad.id), {
          active: false,
          savedActiveBeforeCampaignOff: false,
          disabledByCampaign: false,
          stateChangedDate: todayAction,
          stateHistory: terminalStateHistoryCC(ad.stateHistory, todayAction, false),
          stateChangedAt: serverTimestamp()
        });

        await batch.commit();

        const protocolMeta = adActionModal?.protocol === 'poda'
          ? {
              protocol: 'poda',
              podaCandidateAdId: adActionModal.podaCandidateAdId,
              podaCandidateNameSnapshot: adActionModal.podaCandidateNameSnapshot
            }
          : {};

        await addDecision(
          ownerUid,
          campaign,
          ad,
          'Anuncio apagado',
          `Apagado desde Análisis de métricas. Razón: ${reason}`,
          {
            changeType: 'ad_state',
            safetyHours: 48,
            reason,
            source: 'ad_metrics_analysis',
            ...protocolMeta
          }
        );
      } else {
        batch.update(doc(db, COLLECTIONS.ads, ad.id), {
          active: false,
          deleted: true,
          deletedDate: todayAction,
          deletedReason: reason,
          savedActiveBeforeCampaignOff: false,
          disabledByCampaign: false,
          stateChangedDate: todayAction,
          stateHistory: terminalStateHistoryCC(ad.stateHistory, todayAction, false),
          deletedAt: serverTimestamp(),
          stateChangedAt: serverTimestamp()
        });

        (recommendations || [])
          .filter(r => r.adId === ad.id && r.status === 'active')
          .forEach(r => batch.update(doc(db, COLLECTIONS.recommendations, r.id), {
            status: 'cancelled',
            cancelledReason: 'ad_deleted',
            cancelledDate: todayAction,
            updatedAt: serverTimestamp()
          }));

        await batch.commit();

        await addDecision(
          ownerUid,
          campaign,
          ad,
          'Anuncio eliminado',
          `Eliminado de la configuración activa desde Análisis de métricas. Histórico conservado. Razón: ${reason}`,
          {
            changeType: 'ad_deleted',
            safetyHours: 48,
            reason,
            source: 'ad_metrics_analysis'
          }
        );
      }

      setAdActionModal(null);
      setAdActionReason('');
    } catch (error) {
      console.error('Lectura de Campañas · acción anuncio', error);
      setAdActionMessage(error?.message || 'No fue posible guardar el cambio.');
    } finally {
      setAdActionBusyId('');
    }
  };

  const benchmark = useMemo(
    () => buildProductBenchmark(product?.id, dailyAds, dailyCampaigns, product?.maxCpa, allAds || ads, allCampaigns || [campaign]),
    [product?.id, product?.maxCpa, dailyAds, dailyCampaigns, allAds, allCampaigns, ads, campaign]
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
  const weekdayAnalysis = useMemo(
    () => buildCampaignWeekdayAnalysisCC(campaignHistory, maxCpa),
    [campaignHistory, maxCpa]
  );

  return (
    <div className="cc-module-view cc-diagnostic-detail space-y-5">
      <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-3 sm:p-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[8px] font-black uppercase tracking-wide text-indigo-700">Agenda de esta campaña</p>
            <p className="text-[9px] sm:text-[10px] text-slate-600 mt-1 leading-relaxed">
              Registra una acción mientras analizas la campaña y revísala después desde el Cuadro de acciones.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {campaignPendingActions.length > 0 ? (
              <span className="px-2.5 py-2 rounded-xl bg-amber-100 text-amber-800 text-[8px] font-black uppercase">
                {campaignPendingActions.length} pendiente{campaignPendingActions.length === 1 ? '' : 's'}
              </span>
            ) : null}

            <button
              type="button"
              onClick={() => {
                setPlanActionOpen(true);
                setPlanActionMessage('');
              }}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-indigo-600 text-white text-[9px] font-black uppercase shadow-sm"
            >
              <Plus size={14}/> Registrar acción
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="px-1 md:px-2">
          <p className="text-[9px] font-black uppercase text-zinc-900">Cómo quieres leer la campaña</p>
          <p className="text-[9px] text-slate-500 mt-0.5 leading-relaxed">Modo lectura resume la decisión en segundos. Días de la semana descubre patrones históricos. Vista detallada conserva la lectura técnica completa anterior para investigar métricas, embudo, variaciones y diagnósticos a profundidad.</p>
        </div>
        <div className="flex bg-slate-100 p-1 rounded-xl w-full md:w-auto overflow-x-auto">
          <button
            type="button"
            onClick={() => setViewMode('reading')}
            className={`shrink-0 flex-1 md:flex-none px-3 sm:px-4 py-2.5 rounded-lg text-[8px] sm:text-[9px] font-black uppercase transition ${viewMode === 'reading' ? 'bg-zinc-950 text-white shadow-sm' : 'text-slate-500'}`}
          >
            Modo lectura
          </button>
          <button
            type="button"
            onClick={() => setViewMode('weekdays')}
            className={`shrink-0 flex-1 md:flex-none px-3 sm:px-4 py-2.5 rounded-lg text-[8px] sm:text-[9px] font-black uppercase transition ${viewMode === 'weekdays' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500'}`}
          >
            Días de la semana
          </button>
          <button
            type="button"
            onClick={() => setViewMode('technical')}
            className={`shrink-0 flex-1 md:flex-none px-3 sm:px-4 py-2.5 rounded-lg text-[8px] sm:text-[9px] font-black uppercase transition ${viewMode === 'technical' ? 'bg-zinc-950 text-white shadow-sm' : 'text-slate-500'}`}
          >
            Vista detallada
          </button>
        </div>
      </div>

      <div className="rounded-2xl border-2 border-indigo-200 bg-indigo-50/60 p-3 sm:p-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[9px] font-black uppercase text-indigo-800">Rango de análisis</p>
              <span className="px-2 py-1 rounded-full bg-zinc-950 text-white text-[7px] font-black uppercase">3D sigue decidiendo</span>
            </div>
            <p className="text-[8px] sm:text-[9px] text-slate-600 mt-1 leading-relaxed">
              Cambia las métricas, comparaciones y diagnósticos que estás leyendo. Las métricas y diagnósticos visibles cambian con el rango. Las reglas operativas de pausar/escalar permanecen ancladas a 3D.
            </p>
            {viewMode === 'weekdays' ? (
              <p className="text-[8px] font-black text-indigo-700 mt-1.5">
                Días de la semana usa siempre TODO EL HISTORIAL de la campaña para comparar todos los lunes entre sí, todos los martes entre sí, etc.
              </p>
            ) : null}
          </div>

          <div className="max-w-full overflow-x-auto pb-1 lg:pb-0">
            <div className="flex w-max min-w-full lg:min-w-0 bg-white border border-indigo-100 p-1 rounded-xl">
              {MONITOR_PERIODS.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setMonitorPeriod(p.id)}
                  className={`shrink-0 flex-1 lg:flex-none px-3 sm:px-4 py-2.5 rounded-lg text-[9px] font-black transition ${
                    monitorPeriod === p.id
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-500 hover:text-zinc-900'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {viewMode === 'reading' && (
        <CampaignReadingView
          campaign={campaign}
          product={product}
          adRows={adRows}
          campaignHistory={campaignHistory}
          campaignDecision={campaignDecision}
          benchmark={benchmark}
          analysisPeriod={monitorPeriod}
          changeSafety={changeSafety}
          currentScaleStatus={currentScaleStatus}
          onAdAction={requestAdAction}
          adActionBusyId={adActionBusyId}
          onRegisterPlaybookAction={requestPlaybookAction}
          campaignPoda={campaignPoda}
          onExecutePoda={requestPodaExecution}
        />
      )}

      {viewMode === 'weekdays' && (
        <CampaignWeekdayHistoryView
          campaign={campaign}
          analysis={weekdayAnalysis}
        />
      )}

      {viewMode === 'technical' && (
        <>
      <div className="rounded-2xl border-2 border-zinc-300 bg-white p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <p className="text-[9px] font-black uppercase text-zinc-900">Vista detallada completa · restaurada</p>
            <p className="text-[8px] sm:text-[9px] text-slate-500 mt-1">
              Esta es la vista técnica profunda: conserva las tablas, variaciones dinámicas, embudo post-clic, contribución, Hook/Hold, guardrails y lectura por rango.
            </p>
          </div>
          <span className="w-fit px-2.5 py-1.5 rounded-full bg-zinc-950 text-white text-[8px] font-black uppercase">
            {periodLabelCC(monitorPeriod)}
          </span>
        </div>
      </div>
      {campaign.active !== false ? (
        <CampaignChangeSafetyCardCC
          safety={changeSafety}
          currentBudget={campaignHistory?.[campaignHistory.length - 1]?.budget}
        />
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className={`rounded-2xl p-3 ${toneBg(
          campaignDecision.cpaObservation3d?.level === 'critical' ? 'critical' :
          campaignDecision.cpaObservation3d?.level === 'alert' ? 'alert' :
          'normal'
        )}`} style={{border:'2px solid #0f766e'}}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[8px] font-black uppercase text-slate-400">Motor de decisión de campaña</p>
            <span className="px-2 py-1 rounded-full bg-zinc-950 text-white text-[8px] font-black uppercase">3D determina</span>
          </div>
          <p className="font-black text-sm mt-1">{campaignDecision.status}</p>
          <p className="text-[9px] text-slate-500 mt-1">{campaignDecision.reason}</p>
          <p className="text-[10px] font-black mt-2">Acción 3D: {campaignDecision.action}</p>
          {campaignDecision.recommendedBudget ? <p className="text-[10px] font-black text-emerald-700 mt-1">Presupuesto recomendado: {fmtMoney(campaignDecision.recommendedBudget)}</p> : null}
          {campaignDecision.cpaObservation3d && (
            <div className={`mt-3 rounded-xl border p-2.5 ${
              campaignDecision.cpaObservation3d.level === 'critical' ? 'bg-rose-50 border-rose-200 text-rose-700' :
              campaignDecision.cpaObservation3d.level === 'alert' ? 'bg-orange-50 border-orange-200 text-orange-700' :
              campaignDecision.cpaObservation3d.level === 'good' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
              campaignDecision.cpaObservation3d.level === 'attention' ? 'bg-amber-50 border-amber-200 text-amber-700' :
              'bg-slate-50 border-slate-200 text-slate-600'
            }`}>
              <p className="text-[8px] font-black uppercase">{campaignDecision.cpaObservation3d.title}</p>
              <p className="text-[8px] mt-1 leading-relaxed">{campaignDecision.cpaObservation3d.text}</p>
            </div>
          )}
        </div>
        <div className="rounded-2xl p-3 bg-blue-50" style={{border:'1px solid #bfdbfe'}}><p className="text-[8px] font-black uppercase text-blue-700">Salud de tráfico y creativo</p><p className="font-black text-sm mt-1">{adRows.length} anuncios activos</p><p className="text-[9px] text-slate-500 mt-1">Estables: {dynamicCounts['Estable'] || 0} · Fatiga temprana: {dynamicCounts['Fatiga temprana'] || 0} · Probable/confirmada: {(dynamicCounts['Fatiga probable'] || 0) + (dynamicCounts['Fatiga confirmada'] || 0)}</p></div>
        <div className="rounded-2xl p-3 bg-orange-50" style={{border:'2px solid #ea580c'}}><p className="text-[8px] font-black uppercase text-orange-700">Distribución / costo de impresiones</p><p className="text-[9px] text-slate-600 mt-1">CPM se lee en dos capas: tendencia vs período anterior y nivel actual. Un CPM puede subir y seguir saludable si permanece ≤ $10.000. Si supera $10.000 entra en revisión; la causa no se demuestra solo con CPM.</p></div>
      </div>

      <div className="rounded-2xl p-3 md:p-4 bg-cyan-50" style={{border:'2px solid #0891b2'}}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <p className="text-[9px] font-black uppercase text-cyan-800">Período de monitoreo por anuncio</p>
            <p className="text-[8px] text-slate-500 mt-1">Controla la lectura analítica de Variaciones dinámicas y Embudo post-clic. NO modifica decisiones, Guardrails, Contribución ni observaciones operativas: todo eso se determina en 3D.</p>
          </div>
          <div className="flex bg-slate-100 p-1 rounded-xl w-full md:w-auto overflow-x-auto">
            {MONITOR_PERIODS.map(p => (
              <button
                key={p.id}
                onClick={() => setMonitorPeriod(p.id)}
                className={`shrink-0 px-3 sm:px-4 py-2 rounded-lg text-[9px] font-black transition ${monitorPeriod === p.id ? 'bg-zinc-950 text-white shadow-sm' : 'text-slate-500 hover:text-zinc-900'}`}
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

      <div className="bg-blue-50 rounded-2xl p-3" style={{border:'2px solid #3b82f6'}}><p className="text-[9px] font-black uppercase text-blue-700">Cómo funcionan las variaciones por anuncio</p><p className="text-[9px] text-blue-600 mt-1">{variationExplanation(monitorPeriod)} Bandas: 0–10% normal · &gt;10–15% atención · &gt;15–20% alerta · &gt;20% crítica. La dirección se interpreta según la métrica.</p><p className="text-[8px] font-black text-blue-800 mt-2">Regla de seguridad: 3D define qué hacer ahora, pero 3 días malos no significan que un creativo jamás pueda recuperarse. La pausa final exige daño económico/contribución y revisa si el último día completo muestra recuperación.</p></div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="rounded-2xl p-3 bg-cyan-50" style={{border:'2px solid #0891b2'}}>
          <p className="text-[8px] font-black uppercase text-cyan-700">Regla de inclusión de datos</p>
          <p className="text-[9px] text-slate-600 mt-1">Los días en que la campaña o el anuncio estuvo OFF se excluyen totalmente de Último día/3D/7D/14D/30D, benchmark y escala rentable. HOY queda solo como monitor intradía y no participa en decisiones. Los días OFF no se convierten en ceros.</p>
        </div>
        <div className="rounded-2xl p-3 bg-indigo-50" style={{border:'1px solid #c7d2fe'}}>
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
        {adRows.length ? <div className="overflow-x-auto overscroll-x-contain"><table className="w-full min-w-[1250px] text-left text-[10px] border-separate border-spacing-y-1"><thead><tr className="border-b text-[8px] font-black uppercase text-slate-400"><th className="py-2">Anuncio</th><th>CPA</th><th>Δ CPA</th><th>CTR</th><th>Δ CTR</th><th>CPC</th><th>Δ CPC</th><th>CPM</th><th>Δ CPM</th><th>Frecuencia</th><th>Δ Frec.</th><th>CVR</th><th>Δ CVR</th><th>Diagnóstico dinámico</th><th>Acción</th></tr></thead><tbody>{adRows.map(({ad,diag}) => <tr
          key={ad.id}
          className="border-b-4 border-white"
          style={{ backgroundColor: ccVisualAccent(ad.id || ad.name).soft, boxShadow: `inset 5px 0 0 ${ccVisualAccent(ad.id || ad.name).border}` }}
        ><td className="py-3 pl-3 font-black" style={{ color: ccVisualAccent(ad.id || ad.name).text }}>{ad.name}</td><td>{fmtCpa(diag.stats.cpa)}</td><td><Delta metric="cpa" value={diag.delta.cpa}/></td><td>{fmtNum(diag.stats.ctr,2)}%</td><td><Delta metric="ctr" value={diag.delta.ctr}/></td><td>{fmtMoney(diag.stats.cpc)}</td><td><Delta metric="cpc" value={diag.delta.cpc}/></td><td>{fmtMoney(diag.stats.cpm)}</td><td><Delta metric="cpm" value={diag.delta.cpm}/></td><td>{fmtNum(diag.stats.frequency,2)}</td><td><Delta metric="frequency" value={diag.delta.frequency}/></td><td>{fmtRate(diag.stats.visitToPurchase)}</td><td><Delta metric="visitToPurchase" value={diag.delta.visitToPurchase}/></td><td className={`font-black ${toneText(diag.dynamicTone)}`}>{diag.dynamicDiagnosis}</td><td className="font-black">{diag.dynamicAction}</td></tr>)}</tbody></table></div> : <EmptyState>No hay anuncios activos con datos para esta campaña.</EmptyState>}
      </div>

      <div className="rounded-2xl border-2 p-3 md:p-4 bg-white shadow-sm" style={{ borderColor: '#f59e0b' }}>
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-2 mb-3 pb-3 border-b" style={{ borderColor: '#fde68a' }}>
          <div>
            <h4 className="text-xs font-black uppercase text-amber-800">Diagnóstico creativo · Hook Rate + Hold Rate</h4>
            <p className="text-[8px] text-slate-500 mt-1">
              Solo para video. Hook = primeros 0–3 s · Hold = continuidad 3–15 s. <strong>Diagnostica QUÉ variar; no convierte un anuncio en ganador/perdedor y no modifica los guardrails.</strong>
            </p>
          </div>
          <span className="px-2 py-1 rounded-full bg-zinc-950 text-white text-[8px] font-black">
            {monitorPeriod === 'last' ? 'ÚLTIMO DÍA' : `${monitorPeriod.toUpperCase()} VS PREVIO`}
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 mb-3">
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
            <p className="text-[8px] font-black uppercase text-amber-800">Hook Rate</p>
            <p className="text-[8px] text-slate-600 mt-1">Reproducciones 3 s ÷ impresiones × 100. Mide si la apertura detiene el scroll.</p>
            <p className="text-[7px] text-slate-500 mt-1">Crítico &lt;15 · Bajo 15–19,9 · Aceptable 20–24,9 · Bueno 25–29,9 · Fuerte 30–39,9 · Excepcional ≥40.</p>
          </div>
          <div className="rounded-xl bg-orange-50 border border-orange-200 p-3">
            <p className="text-[8px] font-black uppercase text-orange-800">Hold Rate</p>
            <p className="text-[8px] text-slate-600 mt-1">15 s/ThruPlay ÷ reproducciones 3 s × 100. Mide cuánto conserva el cuerpo a quienes enganchó.</p>
            <p className="text-[7px] text-slate-500 mt-1">Crítico &lt;10 · Bajo 10–14,9 · Aceptable 15–19,9 · Bueno 20–24,9 · Fuerte 25–29,9 · Excepcional ≥30.</p>
          </div>
        </div>

        {adRows.filter(({diag}) => diag.hookHold?.isVideo).length ? (
          <div className="overflow-x-auto overscroll-x-contain">
            <table className="w-full min-w-[1500px] text-left text-[10px] border-separate border-spacing-y-1">
              <thead><tr className="text-[8px] font-black uppercase text-slate-400">
                <th className="py-2">Video</th><th>Hook</th><th>Nivel Hook</th><th>Δ Hook</th><th>Hold</th><th>Nivel Hold</th><th>Δ Hold</th><th>Muestra</th><th>Diagnóstico creativo</th><th>Variación recomendada</th>
              </tr></thead>
              <tbody>{adRows.filter(({diag}) => diag.hookHold?.isVideo).map(({ad,diag}) => {
                const hh = diag.hookHold;
                const accent = ccVisualAccent(ad.id || ad.name, 2);
                return <tr key={ad.id} className="border-b-4 border-white" style={{backgroundColor: accent.soft, boxShadow:`inset 5px 0 0 ${accent.border}`}}>
                  <td className="py-3 pl-3 font-black" style={{color:accent.text}}>{ad.name}</td>
                  <td className="font-black">{fmtRate(diag.stats.hookRate)}</td>
                  <td><span className={`px-2 py-1 rounded-full text-[8px] font-black ${toneBadge(hh.hook.tone)}`}>{hh.hook.level}</span><p className="text-[7px] text-slate-500 mt-1 max-w-[180px]">{hh.hook.reading}</p></td>
                  <td><Delta metric="hookRate" value={hh.hookDelta}/></td>
                  <td className="font-black">{fmtRate(diag.stats.holdRate)}</td>
                  <td><span className={`px-2 py-1 rounded-full text-[8px] font-black ${toneBadge(hh.hold.tone)}`}>{hh.hold.level}</span><p className="text-[7px] text-slate-500 mt-1 max-w-[180px]">{hh.hold.reading}</p></td>
                  <td><Delta metric="holdRate" value={hh.holdDelta}/></td>
                  <td><span className={`px-2 py-1 rounded-full text-[8px] font-black ${hh.sampleOk?'bg-emerald-100 text-emerald-700':'bg-amber-100 text-amber-700'}`}>{hh.sampleLabel}</span><p className="text-[7px] text-slate-500 mt-1">Imp. {fmtNum(diag.stats.impressions,0)} · 3s est. {fmtNum(diag.stats.video3sPlaysEstimated,0)}</p></td>
                  <td className={`font-black ${toneText(hh.tone)}`}>{hh.diagnosis}</td>
                  <td className="font-black max-w-[260px]">{hh.action}</td>
                </tr>
              })}</tbody>
            </table>
          </div>
        ) : <EmptyState>No hay anuncios de video con Hook/Hold disponibles en esta ventana. Reimporta los CSV históricos para cargar estas métricas.</EmptyState>}
      </div>

      <div className="rounded-2xl border-2 p-3 md:p-4 bg-white shadow-sm" style={{ borderColor: '#7c3aed' }}>
        <div className="flex items-center justify-between gap-2 mb-3 pb-2 border-b" style={{ borderColor: '#ddd6fe' }}><h4 className="text-xs font-black uppercase text-violet-800">Embudo post-clic dinámico por anuncio</h4><span className="px-2 py-1 rounded-full bg-zinc-950 text-white text-[8px] font-black">{monitorPeriod === 'last' ? 'ÚLTIMO DÍA' : monitorPeriod.toUpperCase()}</span></div>
        <div className="mb-3 rounded-xl border border-violet-200 bg-violet-50 p-3">
          <p className="text-[8px] font-black uppercase text-violet-800">Embudo corregido</p>
          <p className="text-[8px] text-violet-700 mt-1">
            Clic→Landing = Visitas landing / Clics de enlace · Visita→ATC = ATC / Visitas · Visita→Compra = Compras / Visitas · ATC→Compra = Compras / ATC.
            Si hay compras pero Visitas/ATC están en 0, el sistema lo marca como dato faltante: ya no presenta ese 0 como un embudo real ni como “estable”.
          </p>
        </div>
        {adRows.length ? <div className="overflow-x-auto overscroll-x-contain"><table className="w-full min-w-[1680px] text-left text-[10px] border-separate border-spacing-y-1"><thead><tr className="border-b text-[8px] font-black uppercase text-slate-400"><th className="py-2">Anuncio</th><th>Clics</th><th>Visitas</th><th>ATC</th><th>Compras</th><th>C→Landing</th><th>Δ</th><th>V→ATC</th><th>Δ</th><th>V→Compra</th><th>Δ</th><th>ATC→Compra</th><th>Δ</th><th>Calidad datos</th><th>Diagnóstico post-clic</th><th>Acción</th></tr></thead><tbody>{adRows.map(({ad,diag}) => {
          const q = diag.postDataQuality || postClickDataQualityCC(diag.stats);
          const landingMissing = q.level === 'missing' && diag.stats.purchases > 0 && toNumber(diag.stats.landingViews) <= 0;
          const atcMissing = (q.level === 'missing' || q.label?.includes('ATC FALTANTE')) && diag.stats.purchases > 0 && toNumber(diag.stats.atc) <= 0;
          return <tr
          key={ad.id}
          className="border-b-4 border-white"
          style={{ backgroundColor: ccVisualAccent(ad.id || ad.name, 1).soft, boxShadow: `inset 5px 0 0 ${ccVisualAccent(ad.id || ad.name, 1).border}` }}
        ><td className="py-3 pl-3 font-black" style={{ color: ccVisualAccent(ad.id || ad.name, 1).text }}>{ad.name}</td><td>{diag.stats.clicks === null ? '—' : fmtNum(diag.stats.clicks, 2)}</td><td className={landingMissing?'font-black text-rose-600':''}>{landingMissing ? '— FALTANTE' : (diag.stats.landingViews === null ? '—' : fmtNum(diag.stats.landingViews, 2))}</td><td className={atcMissing?'font-black text-rose-600':''}>{atcMissing ? '— FALTANTE' : (diag.stats.atc === null ? '—' : fmtNum(diag.stats.atc, 2))}</td><td>{fmtNum(diag.stats.purchases, 2)}</td><td className="font-black">{fmtRate(diag.stats.clickToLanding)}</td><td><Delta metric="clickToLanding" value={diag.delta.clickToLanding}/></td><td className="font-black">{fmtRate(diag.stats.visitToAtc)}</td><td><Delta metric="visitToAtc" value={diag.delta.visitToAtc}/></td><td className="font-black">{fmtRate(diag.stats.visitToPurchase)}</td><td><Delta metric="visitToPurchase" value={diag.delta.visitToPurchase}/></td><td className="font-black">{fmtRate(diag.stats.atcToPurchase)}</td><td><Delta metric="atcToPurchase" value={diag.delta.atcToPurchase}/></td><td><span className={`px-2 py-1 rounded-full text-[8px] font-black uppercase ${q.level === 'missing' ? 'bg-rose-100 text-rose-700' : q.level === 'partial' ? 'bg-amber-100 text-amber-700' : q.level === 'no_delivery' ? 'bg-slate-100 text-slate-600' : 'bg-emerald-100 text-emerald-700'}`}>{q.label}</span><p className="text-[7px] text-slate-500 mt-1 max-w-[220px]">{q.reason}</p></td><td className={`font-black ${toneText(diag.postTone)}`}>{diag.postDiagnosis}</td><td className="font-black max-w-[220px]">{diag.postAction}</td></tr>})}</tbody></table></div> : <EmptyState>Sin datos post-clic disponibles.</EmptyState>}
      </div>

      <div className="rounded-2xl border-2 p-3 md:p-4 bg-white shadow-sm" style={{ borderColor: '#059669' }}>
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-2 mb-3 pb-3 border-b" style={{ borderColor: '#a7f3d0' }}>
          <div>
            <h4 className="text-xs font-black uppercase text-emerald-800">Contribución por anuncio · qué aporta / qué drena</h4>
            <p className="text-[8px] text-slate-500 mt-1">
              Las columnas Dinámico y Post-clic respetan la ventana seleccionada. <strong>La decisión operativa, la acción y la contribución a campaña siempre se calculan en 3D fijo</strong>.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-600 text-[8px] font-black uppercase">
              Diagnóstico: {monitorPeriod === 'last' ? 'ÚLTIMO DÍA' : monitorPeriod.toUpperCase()}
            </span>
            <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[8px] font-black uppercase">
              Contribución: 3D
            </span>
          </div>
        </div>

        {adRows.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 2xl:grid-cols-5 gap-2 mb-3">
            {[
              ['Aporta fuerte', adRows.filter(x => x.contribution?.status === 'Aporta fuertemente').length, 'bg-emerald-50 text-emerald-700 border-emerald-200'],
              ['Aporta', adRows.filter(x => x.contribution?.status === 'Aporta').length, 'bg-blue-50 text-blue-700 border-blue-200'],
              ['Bajo aporte', adRows.filter(x => x.contribution?.status === 'Bajo aporte / vigilar').length, 'bg-amber-50 text-amber-700 border-amber-200'],
              ['Drena campaña', adRows.filter(x => x.contribution?.status === 'Drena la campaña').length, 'bg-rose-50 text-rose-700 border-rose-200'],
              ['Sin entrega Meta', adRows.filter(x => x.diag.metaDelivery3d?.isNoDelivery).length, 'bg-cyan-50 text-cyan-700 border-cyan-200']
            ].map(([label, value, cls]) => (
              <div key={label} className={`min-w-0 rounded-xl border p-2.5 ${cls}`}>
                <p className="text-[7px] sm:text-[8px] font-black uppercase leading-tight" style={{ overflowWrap: 'break-word', wordBreak: 'normal' }}>{label}</p>
                <p className="text-sm sm:text-base font-black tabular-nums mt-1 whitespace-nowrap">{value}</p>
              </div>
            ))}
          </div>
        )}
        {adRows.length ? <div className="overflow-x-auto overscroll-x-contain"><table className="w-full min-w-[1950px] text-left text-[10px] border-separate border-spacing-y-1"><thead><tr className="border-b text-[8px] font-black uppercase text-slate-400"><th className="py-2">Anuncio</th><th>CPA</th><th>Dinámico</th><th>Post-clic</th><th>Entrega Meta · 3D</th><th>Contribución campaña · 3D</th><th>Decisión operativa · 3D</th><th>Confianza</th><th>Por qué · 3D</th><th>Acción · 3D</th></tr></thead><tbody>{adRows.map(({ad,diag,contribution}) => {
          const contributionClass =
            contribution?.tone === 'critical' ? 'bg-rose-100 text-rose-700 border-rose-200' :
            contribution?.tone === 'good' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
            contribution?.tone === 'alert' ? 'bg-amber-100 text-amber-700 border-amber-200' :
            'bg-slate-100 text-slate-500 border-slate-200';

          return <tr
            key={ad.id}
            className="border-b-4 border-white"
            style={{ backgroundColor: ccVisualAccent(ad.id || ad.name, 2).soft, boxShadow: `inset 5px 0 0 ${ccVisualAccent(ad.id || ad.name, 2).border}` }}
          >
            <td className="py-3 pl-3">
              <p className="font-black" style={{ color: ccVisualAccent(ad.id || ad.name, 2).text }}>{ad.name}</p>
              <p className="text-[8px] text-slate-400">{diag.ageDays} días activos</p>
            </td>
            <td className="font-black">{fmtCpa(diag.stats.cpa)}</td>
            <td>{diag.dynamicDiagnosis}</td>
            <td>{diag.postDiagnosis}</td>
            <td className="min-w-[220px] py-2 pr-3">
              <div className={`rounded-xl border p-2 ${
                diag.metaDelivery3d?.isNoDelivery
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : diag.metaDelivery3d?.isLimited
                    ? 'bg-amber-50 border-amber-200 text-amber-700'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-700'
              }`}>
                <p className="text-[8px] font-black uppercase">{diag.metaDelivery3d?.status || 'Sin lectura 3D'}</p>
                <p className="text-[8px] mt-1">
                  {diag.metaDelivery3d?.totalDays > 0
                    ? `${diag.metaDelivery3d.omittedDays}/${diag.metaDelivery3d.totalDays} día(s) omitidos por Meta`
                    : 'Sin días completos'}
                </p>
              </div>
            </td>
            <td className="min-w-[320px] py-2 pr-3">
              {contribution ? (
                <div className="rounded-xl bg-white/80 border border-white p-2.5">
                  <span className={`inline-block px-2 py-1 rounded-full border text-[8px] font-black uppercase ${contributionClass}`}>
                    {contribution.status}
                  </span>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1.5 mt-2 text-[7px] sm:text-[8px]">
                    <span className="text-slate-500">Gasto campaña</span>
                    <span className="font-black">{fmtNum(contribution.spendShare, 2)}%</span>
                    <span className="text-slate-500">Compras campaña</span>
                    <span className="font-black">{fmtNum(contribution.purchaseShare, 2)}%</span>
                    <span className="text-slate-500">CPA anuncio 3D</span>
                    <span className="font-black">{contribution.purchases > 0 ? fmtCpa(contribution.cpa) : 'Sin compras'}</span>
                    <span className="text-slate-500">CPA campaña sin anuncio</span>
                    <span className={`font-black ${
                      contribution.removalImprovementPct !== null && contribution.removalImprovementPct > 0
                        ? 'text-emerald-600'
                        : contribution.removalImprovementPct !== null && contribution.removalImprovementPct < 0
                          ? 'text-rose-600'
                          : ''
                    }`}>
                      {contribution.cpaWithout !== null ? fmtCpa(contribution.cpaWithout) : '—'}
                    </span>
                  </div>
                  <p className="text-[8px] text-slate-600 leading-relaxed mt-2">{contribution.cause}</p>
                  {contribution.removalImprovementPct !== null && (
                    <p className={`text-[8px] font-black mt-1 ${
                      contribution.removalImprovementPct >= 10 ? 'text-rose-600' :
                      contribution.removalImprovementPct > 0 ? 'text-amber-600' :
                      'text-emerald-600'
                    }`}>
                      {contribution.removalImprovementPct > 0
                        ? `Sin este anuncio, el CPA de campaña mejoraría ${fmtNum(contribution.removalImprovementPct, 2)}%`
                        : contribution.removalImprovementPct < 0
                          ? `Sin este anuncio, el CPA empeoraría ${fmtNum(Math.abs(contribution.removalImprovementPct), 2)}%`
                          : 'Impacto neutro sobre el CPA de campaña'}
                    </p>
                  )}
                </div>
              ) : (
                <span className="text-slate-400">Sin datos 3D</span>
              )}
            </td>
            <td className={`font-black ${diag.operational3dPriority === 'critical' ? 'text-rose-600' : diag.operational3dPriority === 'alert' ? 'text-orange-600' : 'text-emerald-600'}`}>{diag.operational3dDiagnosis}</td>
            <td className="font-black">{diag.volumeReference?.confidence || diag.confidence}</td>
            <td className="max-w-[330px] text-slate-500">{diag.operational3dReason}</td>
            <td className="font-black">{diag.operational3dAction}</td>
          </tr>;
        })}</tbody></table></div> : <EmptyState>Sin anuncios activos.</EmptyState>}
      </div>

      <div className="rounded-2xl p-3 md:p-4 bg-cyan-50/40 shadow-sm" style={{border:'2px solid #0891b2'}}>
        <h4 className="text-xs font-black uppercase mb-3 text-cyan-800">Historial de cambios de presupuesto</h4>
        {budgetRows.length ? <div className="overflow-x-auto overscroll-x-contain"><table className="w-full min-w-[720px] text-[10px]"><thead><tr className="text-left text-slate-400 uppercase text-[8px]"><th>Fecha</th><th>Anterior</th><th>Nuevo</th><th>Cambio</th><th>Origen</th></tr></thead><tbody>{budgetRows.map((r,i) => <tr key={r.id} className="border-t" style={{backgroundColor:i%2===0?'#ecfeff':'#ffffff'}}><td className="py-2">{r.date}</td><td>{fmtMoney(r.previousBudget)}</td><td>{fmtMoney(r.newBudget)}</td><td className="font-black">{fmtNum(r.changePct, 2)}%</td><td>{r.origin === 'recommendation' ? 'Recomendación aplicada' : 'Cambio manual'}</td></tr>)}</tbody></table></div> : <EmptyState>Se construirá automáticamente al detectar cambios entre registros diarios.</EmptyState>}
      </div>

      <div className="rounded-2xl p-3 md:p-4 bg-emerald-50/40 shadow-sm" style={{border:'1px solid #a7f3d0'}}>
        <h4 className="text-xs font-black uppercase mb-3 text-emerald-800">Historial de escala rentable</h4>
        {scaleRows.length ? <div className="overflow-x-auto overscroll-x-contain"><table className="w-full min-w-[1180px] text-[10px]"><thead><tr className="text-left text-slate-400 uppercase text-[8px]"><th>Presupuesto</th><th>Días</th><th>Gasto</th><th>Compras</th><th>Gasto/día</th><th>Compras/día</th><th>CPA ponderado</th><th>ROAS</th><th>CPA marginal</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{scaleRows.map((r,i) => <tr key={r.budget} className="border-t" style={{backgroundColor:i%2===0?'#ecfdf5':'#ffffff'}}><td className="py-2 font-black">{fmtMoney(r.budget)}</td><td>{r.days}</td><td>{fmtMoney(r.spend)}</td><td>{fmtNum(r.purchases, 2)}</td><td>{r.spendDay === null ? '—' : fmtMoney(r.spendDay)}</td><td>{r.purchasesDay === null ? '—' : fmtNum(r.purchasesDay, 2)}</td><td>{fmtCpa(r.cpa)}</td><td>{fmtNum(r.roas,2)}</td><td>{r.marginalCpa === null ? (r.marginalExtraSpendDay > 0 && r.marginalExtraPurchasesDay <= 0 ? 'SIN GANANCIA' : '—') : fmtMoney(r.marginalCpa)}</td><td className={`font-black ${r.status === 'Rentable' ? 'text-emerald-600' : r.status.includes('Sobreescalado') || r.status.includes('ineficiente') ? 'text-rose-600' : 'text-amber-600'}`}>{r.status}</td><td className="font-black">{r.action}</td></tr>)}</tbody></table></div> : <EmptyState>Se construirá automáticamente con los datos diarios registrados.</EmptyState>}
      </div>

      <div className="rounded-2xl p-3 md:p-4 bg-indigo-50/40 shadow-sm" style={{border:'1px solid #c7d2fe'}}>
        <h4 className="text-xs font-black uppercase mb-3 text-indigo-800">Línea de tiempo de decisiones</h4>
        {decisionRows.length ? <div className="space-y-2">{decisionRows.slice(0,30).map((r,i) => <div key={r.id} className="flex gap-3 rounded-xl pl-3 py-2" style={{border:`2px solid ${ccVisualAccent(r.id||r.action,i).border}`,backgroundColor:ccVisualAccent(r.id||r.action,i).soft}}><div className="text-[9px] text-slate-400 w-20 shrink-0">{r.date}</div><div><p className="text-[10px] font-black">{r.action}</p>{r.detail && <p className="text-[9px] text-slate-500">{r.detail}</p>}</div></div>)}</div> : <EmptyState>Sin decisiones registradas todavía.</EmptyState>}
      </div>

      <div className="rounded-2xl p-4 md:p-5 bg-pink-50/40 shadow-sm" style={{border:'2px solid #db2777'}}>
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-3 mb-4">
          <div>
            <h4 className="text-sm font-black uppercase text-pink-800">Benchmark propio del producto</h4>
            <p className="text-[9px] md:text-[10px] text-slate-500 mt-1 leading-relaxed">
              Benchmark operativo móvil sobre los últimos <strong>14 días activos completos</strong>. HOY y los días OFF no participan.
            </p>
          </div>
          <span className={`shrink-0 px-3 py-1.5 rounded-full text-[9px] font-black uppercase ${
            benchmark.status === 'Estable' ? 'bg-emerald-100 text-emerald-700' :
            benchmark.status === 'Provisional' ? 'bg-amber-100 text-amber-700' :
            'bg-slate-100 text-slate-500'
          }`}>
            {benchmark.status}
          </span>
        </div>

        <div className="rounded-2xl bg-white p-3 md:p-4" style={{border:'1px solid #fbcfe8'}}>
          <p className="text-[9px] font-black uppercase text-pink-700 mb-3">Calidad de la muestra</p>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5 sm:gap-3">
            <div className="rounded-xl bg-slate-50 p-3 min-h-[82px] flex flex-col justify-between">
              <p className="text-[8px] sm:text-[9px] font-bold text-slate-500 leading-tight">Días activos en ventana</p>
              <p className="text-sm sm:text-base font-black tabular-nums text-slate-900 whitespace-nowrap">{benchmark.availableDays}</p>
            </div>
            <div className="rounded-xl bg-amber-50 p-3 min-h-[82px] flex flex-col justify-between" style={{border:'1px solid #fde68a'}}>
              <p className="text-[8px] sm:text-[9px] font-bold text-amber-700 leading-tight">Días rentables</p>
              <p className="text-sm sm:text-base font-black tabular-nums text-amber-800 whitespace-nowrap">{benchmark.profitableDays}</p>
            </div>
            <div className="rounded-xl bg-blue-50 p-3 min-h-[82px] flex flex-col justify-between" style={{border:'1px solid #bfdbfe'}}>
              <p className="text-[8px] sm:text-[9px] font-bold text-blue-700 leading-tight">Días con rendimiento estable</p>
              <p className="text-sm sm:text-base font-black tabular-nums text-blue-800 whitespace-nowrap">{benchmark.stableDays}</p>
            </div>
            <div className="rounded-xl bg-emerald-50 p-3 min-h-[82px] flex flex-col justify-between" style={{border:'1px solid #a7f3d0'}}>
              <p className="text-[8px] sm:text-[9px] font-bold text-emerald-700 leading-tight">Muestra usada</p>
              <p className="text-sm sm:text-base font-black tabular-nums text-emerald-800 whitespace-nowrap">{benchmark.sampleDays}</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-3 md:p-4 mt-3" style={{border:'1px solid #fbcfe8'}}>
          <p className="text-[9px] font-black uppercase text-pink-700 mb-3">Rendimiento benchmark</p>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5 sm:gap-3">
            <div className="rounded-xl bg-slate-50 p-3 min-h-[86px]">
              <p className="text-[9px] font-bold text-slate-500">CPA ponderado</p>
              <p className="text-sm sm:text-base font-black tabular-nums text-slate-900 mt-2 leading-tight break-words">{benchmark.sampleDays ? fmtCpa(benchmark.cpa) : '—'}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 min-h-[86px]">
              <p className="text-[9px] font-bold text-slate-500">CTR</p>
              <p className="text-sm sm:text-base font-black tabular-nums text-slate-900 mt-2 whitespace-nowrap">{benchmark.sampleDays ? `${fmtNum(benchmark.ctr,2)}%` : '—'}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 min-h-[86px]">
              <p className="text-[9px] font-bold text-slate-500">CPC</p>
              <p className="text-sm sm:text-base font-black tabular-nums text-slate-900 mt-2 leading-tight break-words">{benchmark.sampleDays ? fmtMoney(benchmark.cpc) : '—'}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 min-h-[86px]">
              <p className="text-[9px] font-bold text-slate-500">Visita → Compra</p>
              <p className="text-sm sm:text-base font-black tabular-nums text-slate-900 mt-2 whitespace-nowrap">{benchmark.sampleDays ? fmtRate(benchmark.visitToPurchase) : '—'}</p>
            </div>
          </div>
        </div>

        <div className={`mt-3 rounded-xl p-3 text-[9px] md:text-[10px] font-bold leading-relaxed ${
          benchmark.status === 'Estable' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
          benchmark.status === 'Provisional' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
          'bg-slate-50 text-slate-500 border border-slate-200'
        }`}>
          <strong>Estado:</strong> {benchmark.status} · {benchmark.criteria}
        </div>

        <p className="text-[9px] text-slate-500 mt-3 leading-relaxed">
          Se evalúan como máximo los últimos <strong>14 días activos completos</strong> del producto. Dentro de esa ventana se identifican los días rentables y estables. Si todavía no existe suficiente muestra para certificar estabilidad, el sistema usa temporalmente los días rentables como benchmark provisional. El histórico anterior solo se utiliza para comparar estabilidad, no para inflar el promedio actual.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-2xl p-3 bg-slate-50" style={{border:'2px solid #475569'}}><h4 className="text-xs font-black uppercase mb-2 text-slate-700">Cómo se dispara cada diagnóstico</h4><div className="space-y-2 text-[9px] text-slate-600"><p><strong>Fatiga:</strong> CPA ↑ + CTR ↓ + CPC ↑ + frecuencia ↑.</p><p><strong>Costo de impresión:</strong> CPM ↑ indica que conseguir impresiones cuesta más; no demuestra por sí solo competencia o saturación.</p><p><strong>Fuga clic→landing:</strong> Clic→Landing cae con datos válidos; revisar carga, enlace y experiencia de la landing.</p><p><strong>Problema post-clic:</strong> CPA ↑ con CTR estable/mejor y CVR ↓ indica que la principal señal negativa aparece después del clic.</p><p><strong>Fuga al cierre:</strong> intención inicial sana pero ATC→Compra y Visita→Compra caen.</p><p><strong>Datos faltantes:</strong> compras con Landing/ATC en 0 se marcan como tracking/importación incompleta y nunca como “Post-clic estable”.</p><p><strong>Hook/Hold:</strong> solo diagnostican la apertura y el cuerpo del video. Nunca convierten por sí solos un anuncio en ganador/perdedor y no bloquean ni habilitan escala.</p></div></div>
        <div className="rounded-2xl p-3 bg-violet-50" style={{border:'2px solid #7c3aed'}}><h4 className="text-xs font-black uppercase mb-2 text-violet-800">Matriz de diagnóstico por combinación de métricas</h4><div className="space-y-2 text-[9px] text-slate-600"><p>CTR ↓ + CPC ↑ + Frecuencia ↑ + CPA ↑ → <strong>Fatiga / saturación</strong></p><p>CPM ↑ + CTR estable + CVR estable → <strong>Costo de distribución/tráfico en aumento</strong></p><p>CTR estable/mejor + CPC relativamente estable + CVR ↓ → <strong>Deterioro principal post-clic</strong></p><p>V→ATC ↓ + V→Compra ↓ → <strong>Calidad de tráfico deteriorada</strong></p></div></div>
      </div>

      <div className="rounded-2xl p-3 md:p-4 bg-orange-50/40 shadow-sm" style={{border:'2px solid #ea580c'}}>
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-2 mb-3">
          <div>
            <h4 className="text-xs font-black uppercase text-orange-800">Guardrails de escalado</h4>
            <p className="text-[8px] text-slate-500 mt-1">
              Ventana fija de decisión: <strong>3D</strong>. Cambiar el selector superior NO modifica estos guardrails. Una mejora del CPA siempre pasa estabilidad; solo bloquea si el CPA 3D empeora más de +15%.
            </p>
          </div>
          <span className="px-2 py-1 rounded-full bg-zinc-950 text-white text-[8px] font-black uppercase">3D determina</span>
        </div>

        {adRows.length ? <div className="space-y-2">{adRows.map(({ad,diag}) => {
          const adAccent=ccVisualAccent(ad.id||ad.name,3);
          const volumeTone =
            diag.volumeReference.confidence === 'Muy alta' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
            diag.volumeReference.confidence === 'Alta' ? 'bg-blue-100 text-blue-700 border-blue-200' :
            diag.volumeReference.confidence === 'Media' ? 'bg-amber-100 text-amber-700 border-amber-200' :
            'bg-slate-100 text-slate-600 border-slate-200';

          return <div key={ad.id} className="rounded-xl p-3" style={{border:`2px solid ${adAccent.border}`,backgroundColor:adAccent.soft}}>
            <div className="flex flex-col xl:flex-row xl:items-center gap-3 justify-between">
              <div>
                <p className="text-[10px] font-black" style={{color:adAccent.text}}>{ad.name}</p>
                <p className="text-[8px] text-slate-500 mt-1">Para escala fuerte deben pasar 4 controles obligatorios. El volumen NO bloquea.</p>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <GuardrailPill ok={diag.guardrails.cpaMargin} label={`CPA 3D ≤ ${fmtMoney(maxCpa*0.8)}`}/>
                <GuardrailPill
                  ok={diag.guardrails.stability}
                  label={
                    diag.scaleDelta3d?.cpa === null
                      ? 'CPA 3D sin comparación'
                      : diag.scaleDelta3d.cpa <= 0
                        ? `CPA 3D mejora ${fmtNum(Math.abs(diag.scaleDelta3d.cpa), 2)}%`
                        : `CPA 3D empeora ${fmtNum(diag.scaleDelta3d.cpa, 2)}%`
                  }
                />
                <GuardrailPill ok={diag.guardrails.creative} label="Creativo 3D sano"/>
                <GuardrailPill ok={diag.guardrails.postClick} label="Post-clic 3D sano"/>
              </div>

              <span className={`px-2.5 py-1.5 rounded-full text-[8px] font-black ${diag.canScale ? 'bg-emerald-500 text-zinc-950' : 'bg-zinc-100 text-zinc-500'}`}>
                {diag.canScale ? 'ESCALA PERMITIDA' : 'NO ESCALAR'}
              </span>
            </div>

            <div className="mt-2 pt-2 border-t border-white/80 flex flex-wrap items-center gap-2">
              <span className={`px-2.5 py-1.5 rounded-full border text-[8px] font-black ${volumeTone}`}>
                Volumen referencia 3D: {fmtNum(diag.volumeReference.purchases, 2)} compras · Confianza {diag.volumeReference.confidence}
              </span>
              <span className={`px-2.5 py-1.5 rounded-full border text-[8px] font-black ${
                diag.metaDelivery3d?.isNoDelivery
                  ? 'bg-blue-100 text-blue-700 border-blue-200'
                  : diag.metaDelivery3d?.isLimited
                    ? 'bg-amber-100 text-amber-700 border-amber-200'
                    : 'bg-emerald-100 text-emerald-700 border-emerald-200'
              }`}>
                Entrega Meta: {diag.metaDelivery3d?.status || 'Sin lectura 3D'}
              </span>
              <span className={`px-2.5 py-1.5 rounded-full border text-[8px] font-black ${
                diag.scaleDelta3d?.cpa !== null && diag.scaleDelta3d.cpa < -15
                  ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                  : diag.scaleDelta3d?.cpa !== null && diag.scaleDelta3d.cpa > 15
                    ? 'bg-rose-100 text-rose-700 border-rose-200'
                    : 'bg-blue-100 text-blue-700 border-blue-200'
              }`}>
                Momentum CPA: {diag.scaleMomentum}
              </span>
              <span className={`px-2.5 py-1.5 rounded-full border text-[8px] font-black ${
                diag.cpaObservation3d?.level === 'critical' ? 'bg-rose-100 text-rose-700 border-rose-200' :
                diag.cpaObservation3d?.level === 'alert' ? 'bg-orange-100 text-orange-700 border-orange-200' :
                diag.cpaObservation3d?.level === 'good' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                'bg-amber-100 text-amber-700 border-amber-200'
              }`}>
                {diag.cpaObservation3d?.title || 'CPA 3D SIN LECTURA'}
              </span>
              <span className="text-[8px] text-slate-500">
                El volumen aumenta o reduce la confianza de la decisión, pero nunca cambia por sí solo ESCALA PERMITIDA a NO ESCALAR.
              </span>
              {diag.cpaObservation3d?.text ? (
                <p className="w-full text-[8px] text-slate-600 mt-1">{diag.cpaObservation3d.text}</p>
              ) : null}
            </div>
          </div>
        })}</div> : <EmptyState>Sin anuncios activos.</EmptyState>}
      </div>

      <div className="rounded-2xl p-3 md:p-4 bg-blue-50/40 shadow-sm" style={{border:'1px solid #bfdbfe'}}>
        <h4 className="text-xs font-black uppercase mb-3 text-blue-800">Nivel de confianza del diagnóstico</h4>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-[9px]"><div className="bg-rose-50 rounded-xl p-3 border-2 border-rose-200"><strong className="text-rose-700">&lt;5 compras</strong><br/>Baja</div><div className="bg-amber-50 rounded-xl p-3 border-2 border-amber-200"><strong className="text-amber-700">5–14</strong><br/>Media</div><div className="bg-blue-50 rounded-xl p-3 border-2 border-blue-200"><strong className="text-blue-700">15–29</strong><br/>Alta</div><div className="bg-emerald-50 rounded-xl p-3 border-2 border-emerald-200"><strong className="text-emerald-700">30+</strong><br/>Muy alta</div></div>
        <p className="text-[8px] text-slate-500 mt-2">Referencia de volumen: 1–4 compras = Baja · 5–14 = Media · 15–29 = Alta · 30+ = Muy alta. Este nivel informa cuánta evidencia hay, pero NO bloquea una escala. La antigüedad sigue ayudando a interpretar la confianza general del diagnóstico.</p>
      </div>
        </>
      )}
      {planActionOpen ? (
        <div className="fixed inset-0 z-[145] bg-zinc-950/55 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-4">
          <div className="w-full max-w-xl rounded-3xl bg-white border border-slate-200 shadow-2xl p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[8px] font-black uppercase tracking-wide text-indigo-600">
                  Nueva acción pendiente
                </p>
                <h4 className="text-base sm:text-lg font-black text-zinc-900 mt-1 break-words">
                  {campaign.name}
                </h4>
                <p className="text-[8px] text-slate-500 mt-1">
                  Fecha de registro: {formatIsoDateCC(todayColombiaCC())}
                </p>
              </div>

              <button
                type="button"
                onClick={() => !planActionBusy && setPlanActionOpen(false)}
                disabled={planActionBusy}
                className="shrink-0 p-2 rounded-xl bg-slate-100 text-slate-500 disabled:opacity-40"
              >
                <X size={15}/>
              </button>
            </div>

            <div className="mt-4">
              <label className="text-[8px] font-black uppercase text-slate-500">
                Acción por realizar · obligatoria
              </label>
              <textarea
                value={planActionText}
                onChange={e => setPlanActionText(e.target.value)}
                placeholder="Ej: Apagar anuncio Video 1 después de completar la ventana de seguridad"
                className="w-full min-h-[92px] mt-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[10px] font-semibold text-zinc-800 outline-none focus:border-indigo-400"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <div>
                <label className="text-[8px] font-black uppercase text-slate-500">
                  Anuncio relacionado · opcional
                </label>
                <select
                  value={planActionAdId}
                  onChange={e => setPlanActionAdId(e.target.value)}
                  className="w-full mt-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[9px] font-bold text-zinc-700 outline-none"
                >
                  <option value="">Acción general de campaña</option>
                  {ads.filter(a => a.deleted !== true).map(ad => (
                    <option key={ad.id} value={ad.id}>
                      {ad.name}{ad.active === false ? ' · OFF' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[8px] font-black uppercase text-slate-500">
                  Estado inicial
                </label>
                <div className="mt-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <p className="text-[9px] font-black text-amber-800">PENDIENTE</p>
                  <p className="text-[7px] text-amber-700 mt-0.5">
                    Permanecerá en Acciones hasta aprobarla.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-3">
              <label className="text-[8px] font-black uppercase text-slate-500">
                Nota / criterio · opcional
              </label>
              <textarea
                value={planActionNote}
                onChange={e => setPlanActionNote(e.target.value)}
                placeholder="Ej: Revisar 3D y confirmar que no exista recuperación antes de ejecutar"
                className="w-full min-h-[72px] mt-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[9px] text-zinc-700 outline-none focus:border-indigo-400"
              />
            </div>

            {planActionMessage ? (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[8px] font-black text-rose-700">
                {planActionMessage}
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-2 mt-4">
              <button
                type="button"
                onClick={() => !planActionBusy && setPlanActionOpen(false)}
                disabled={planActionBusy}
                className="px-3 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-[9px] font-black uppercase disabled:opacity-40"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={savePlannedAction}
                disabled={planActionBusy || !String(planActionText || '').trim()}
                className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-indigo-600 text-white text-[9px] font-black uppercase disabled:opacity-40"
              >
                <Save size={13}/>
                {planActionBusy ? 'Guardando...' : 'Guardar pendiente'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {adActionModal ? (
        <div className="fixed inset-0 z-[140] bg-zinc-950/55 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white border border-slate-200 shadow-2xl p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[8px] font-black uppercase tracking-wide text-slate-400">
                  Cambio operativo · anuncio
                </p>
                <h4 className="text-base sm:text-lg font-black text-zinc-900 mt-1 break-words">
                  {adActionModal.protocol === 'poda'
                    ? 'Ejecutar La Poda'
                    : adActionModal.mode === 'delete'
                      ? 'Eliminar anuncio'
                      : 'Apagar anuncio'} · {adActionModal.ad?.name}
                </h4>
              </div>
              <button
                type="button"
                onClick={closeAdActionModal}
                disabled={!!adActionBusyId}
                className="shrink-0 p-2 rounded-xl bg-slate-100 text-slate-500 disabled:opacity-40"
              >
                <X size={15}/>
              </button>
            </div>

            <div className={`mt-4 rounded-xl border p-3 ${adActionModal.mode === 'delete' ? 'bg-rose-50 border-rose-200' : 'bg-amber-50 border-amber-200'}`}>
              <p className="text-[8px] font-black uppercase text-slate-600">
                {adActionModal.protocol === 'poda'
                  ? 'Cirugía CBO'
                  : adActionModal.mode === 'delete'
                    ? 'Qué ocurrirá'
                    : 'Fecha efectiva'}
              </p>
              <p className="text-[8px] sm:text-[9px] text-slate-600 mt-1.5 leading-relaxed">
                {adActionModal.protocol === 'poda'
                  ? `${adActionModal.ad?.name} quedará OFF. ${adActionModal.podaCandidateNameSnapshot || 'El anuncio receptor'} permanecerá activo para intentar absorber el presupuesto. Después de este cambio debes evitar nuevas modificaciones estructurales durante 48–72 h para poder leer el resultado de la poda.`
                  : adActionModal.mode === 'delete'
                    ? 'El anuncio desaparecerá de la configuración activa y del Registro diario desde hoy. Sus datos históricos y la bitácora se conservarán.'
                    : `El anuncio quedará OFF desde ${formatIsoDateCC(todayColombiaCC())} y dejará de aparecer en Registro diario desde esta fecha.`
                }
              </p>
            </div>

            {changeSafety?.active && changeSafety?.canStructuralNow === false ? (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-[8px] font-black uppercase text-amber-700">Margen de seguridad activo</p>
                <p className="text-[8px] text-amber-700 mt-1">
                  Faltan {fmtHoursRemainingCC(changeSafety.structuralRemainingHours)} para completar la ventana interna de 48 h.
                </p>
              </div>
            ) : null}

            <div className="mt-4">
              <label className="text-[8px] font-black uppercase text-slate-500">
                Razón del cambio · obligatoria
              </label>
              <textarea
                value={adActionReason}
                onChange={e => setAdActionReason(e.target.value)}
                placeholder="Ej: CPA alto después del escalamiento / deterioro de CVR / creativo agotado"
                className="w-full min-h-[95px] mt-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[10px] font-semibold text-zinc-800 outline-none focus:border-emerald-400"
              />
            </div>

            {adActionMessage ? (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[8px] font-black text-rose-700">
                {adActionMessage}
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-2 mt-4">
              <button
                type="button"
                onClick={closeAdActionModal}
                disabled={!!adActionBusyId}
                className="px-3 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-[9px] font-black uppercase disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={applyAdAction}
                disabled={!!adActionBusyId || !String(adActionReason || '').trim()}
                className={`px-3 py-2.5 rounded-xl text-white text-[9px] font-black uppercase disabled:opacity-40 ${
                  adActionModal.mode === 'delete' ? 'bg-rose-600' : 'bg-amber-600'
                }`}
              >
                {adActionBusyId
                  ? 'Guardando...'
                  : adActionModal.mode === 'delete'
                    ? 'Eliminar anuncio'
                    : 'Apagar anuncio'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
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

  const rows = [...groups.entries()]
    .map(([budget, recs]) => {
      const stats = aggregateRecords(recs);
      const days = Math.max(0, toNumber(stats.days) || recs.length);
      const spendDay = days > 0 ? stats.spend / days : null;
      const purchasesDay = days > 0 ? stats.purchases / days : null;

      return {
        budget,
        days,
        spend: stats.spend,
        purchases: stats.purchases,
        spendDay,
        purchasesDay,
        cpa: stats.cpa,
        roas: stats.roas,
        marginalCpa: null,
        marginalExtraSpendDay: null,
        marginalExtraPurchasesDay: null
      };
    })
    .sort((a, b) => a.budget - b.budget);

  rows.forEach((r, idx) => {
    if (idx === 0) return;

    const prev = rows[idx - 1];

    const extraSpendDay =
      r.spendDay !== null && prev.spendDay !== null
        ? r.spendDay - prev.spendDay
        : null;

    const extraPurchasesDay =
      r.purchasesDay !== null && prev.purchasesDay !== null
        ? r.purchasesDay - prev.purchasesDay
        : null;

    r.marginalExtraSpendDay = extraSpendDay;
    r.marginalExtraPurchasesDay = extraPurchasesDay;

    r.marginalCpa =
      extraSpendDay !== null &&
      extraPurchasesDay !== null &&
      extraSpendDay > 0 &&
      extraPurchasesDay > 0
        ? extraSpendDay / extraPurchasesDay
        : null;
  });

  const max = Math.max(1, toNumber(maxCpa));

  return rows.map(r => {
    let status = 'Observación', action = 'Mantener';

    if (r.cpa > 0 && r.cpa <= max * 0.8) {
      status = 'Rentable';
      action = 'Escala candidata';
    } else if (r.cpa > 0 && r.cpa <= max) {
      status = 'Límite rentable';
      action = 'Mantener';
    } else if (r.cpa > 0) {
      status = 'Sobreescalado';
      action = 'Reducir';
    }

    if (r.marginalCpa !== null && r.marginalCpa > max) {
      status = 'Escala ineficiente';
      action = 'Volver al nivel anterior';
    }

    // Si aumentó el gasto diario pero NO aumentaron las compras diarias,
    // no existe un CPA marginal positivo calculable: la señal es peor.
    if (
      r.marginalExtraSpendDay !== null &&
      r.marginalExtraSpendDay > 0 &&
      r.marginalExtraPurchasesDay !== null &&
      r.marginalExtraPurchasesDay <= 0
    ) {
      status = 'Escala ineficiente';
      action = 'No seguir escalando';
    }

    return { ...r, status, action };
  });
}


function terminalStateHistoryCC(history, effectiveDate, active) {
  const date = dateToIso(effectiveDate);
  if (!date) return Array.isArray(history) ? history : [];

  const kept = (Array.isArray(history) ? history : [])
    .filter(event => event?.date && String(event.date) < String(date))
    .map(event => ({ ...event }));

  kept.push({ date, active: active !== false });
  return kept.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}

function campaignCurrentStateLabelCC(campaign) {
  if (!campaign) return '—';
  if (campaign.archived) return 'ARCHIVADA / APAGADA';
  if (campaign.active === false) return 'APAGADA / DESACTIVADA';
  return 'ACTIVA';
}

function rebaseInitialStateHistory(history, oldStart, newStart) {
  const rows = Array.isArray(history) ? history.map(x => ({ ...x })) : [];
  if (!rows.length) return [{ date: newStart, active: true }];

  const sortedIndexes = rows
    .map((row, index) => ({ index, date: String(row?.date || '') }))
    .filter(x => x.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!sortedIndexes.length) return [{ date: newStart, active: true }, ...rows];

  const firstIndex = sortedIndexes[0].index;
  const firstDate = String(rows[firstIndex]?.date || '');

  // Solo movemos el evento inicial si realmente corresponde a la fecha
  // de alta anterior. Los encendidos/apagados posteriores se conservan.
  if (firstDate === String(oldStart || '')) {
    rows[firstIndex] = { ...rows[firstIndex], date: newStart };
  }

  return rows;
}

function CampaignManager({ ownerUid, products, campaigns, ads, dailyCampaigns, dailyAds, budgetChanges, recommendations, decisions }) {
  const [productForm, setProductForm] = useState({ name: '', maxCpa: '20000', createdDate: todayColombiaCC() });
  const [campaignNameByProduct, setCampaignNameByProduct] = useState({});
  const [campaignDateByProduct, setCampaignDateByProduct] = useState({});
  const [adNameByCampaign, setAdNameByCampaign] = useState({});
  const [expandedProductsManager, setExpandedProductsManager] = useState({});
  const [expanded, setExpanded] = useState({});
  const [expandedAds, setExpandedAds] = useState({});
  const [showArchived, setShowArchived] = useState(false);
  const [managerMessage, setManagerMessage] = useState(null);
  const [busyKey, setBusyKey] = useState('');
  const [campaignOffPicker, setCampaignOffPicker] = useState(null);
  const today = todayColombiaCC();
  const safetyNowMs = useSafetyClockCC();

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

  const confirmStructuralChangeSafety = campaign => {
    const safety = buildCampaignChangeSafetyCC(campaign, budgetChanges, decisions, Date.now());
    if (!safety.active || safety.canStructuralNow) return true;

    return window.confirm(
      `MARGEN DE SEGURIDAD ACTIVO\n\n` +
      `Todavía faltan ${fmtHoursRemainingCC(safety.structuralRemainingHours)} para completar la ventana interna de 48 horas.\n\n` +
      `Último cambio: ${safety.lastEvent?.action || 'cambio reciente registrado'}\n` +
      `${safety.lastEvent?.detail || ''}\n\n` +
      `Cambiar ahora puede dificultar la lectura del rendimiento y puede afectar la estabilización de Meta.\n\n` +
      `¿Deseas continuar de todas formas?`
    );
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
      effectiveStartDate: startDate,
      stateChangedDate: startDate,
      stateHistory: [{ date: startDate, active: true }],
      createdAt: serverTimestamp()
    });
    setProductForm({ name: '', maxCpa: '20000', createdDate: todayColombiaCC() });
  };
  const editProduct = async product => {
    const name = window.prompt('Nombre del producto:', product.name);
    if (name === null) return;
    const cleanName = name.trim();
    if (!cleanName) {
      showManagerMessage('error', 'El nombre del producto no puede quedar vacío.');
      return;
    }

    const maxCpa = window.prompt('CPA máximo Meta:', String(product.maxCpa || 20000));
    if (maxCpa === null) return;
    if (toNumber(maxCpa) <= 0) {
      showManagerMessage('error', 'El CPA máximo debe ser mayor que 0.');
      return;
    }

    try {
      await updateDoc(doc(db, COLLECTIONS.products, product.id), {
        name: cleanName,
        maxCpa: toNumber(maxCpa),
        updatedAt: serverTimestamp()
      });
      showManagerMessage('success', `Producto actualizado: "${cleanName}".`);
    } catch (error) {
      console.error('Lectura de Campañas · editar producto', error);
      showManagerMessage('error', readableFirebaseError(error, 'No se pudo editar el producto'));
    }
  };

  const editCampaignName = async campaign => {
    const value = window.prompt('Nombre de la campaña:', campaign.name || '');
    if (value === null) return;
    const name = value.trim();

    if (!name) {
      showManagerMessage('error', 'El nombre de la campaña no puede quedar vacío.');
      return;
    }

    const duplicated = campaigns.some(c =>
      c.id !== campaign.id &&
      c.productId === campaign.productId &&
      !c.archived &&
      String(c.name || '').trim().toLowerCase() === name.toLowerCase()
    );

    if (duplicated) {
      showManagerMessage('error', `Ya existe una campaña llamada "${name}" dentro de este producto.`);
      return;
    }

    try {
      await updateDoc(doc(db, COLLECTIONS.campaigns, campaign.id), {
        name,
        updatedAt: serverTimestamp()
      });
      showManagerMessage(
        'success',
        `Campaña renombrada a "${name}". ${isPlaybookEligibleCampaignCC({ name }) ? 'Playbook ESCALA habilitado.' : 'Playbook no aplica mientras el nombre no contenga ESCALA.'}`
      );
    } catch (error) {
      console.error('Lectura de Campañas · editar nombre campaña', error);
      showManagerMessage('error', readableFirebaseError(error, 'No se pudo editar la campaña'));
    }
  };

  const editAdName = async (ad, campaign) => {
    const value = window.prompt('Nombre del anuncio:', ad.name || '');
    if (value === null) return;
    const name = value.trim();

    if (!name) {
      showManagerMessage('error', 'El nombre del anuncio no puede quedar vacío.');
      return;
    }

    const duplicated = ads.some(a =>
      a.id !== ad.id &&
      a.campaignId === campaign.id &&
      a.deleted !== true &&
      String(a.name || '').trim().toLowerCase() === name.toLowerCase()
    );

    if (duplicated) {
      showManagerMessage('error', `Ya existe un anuncio llamado "${name}" dentro de esta campaña.`);
      return;
    }

    try {
      await updateDoc(doc(db, COLLECTIONS.ads, ad.id), {
        name,
        updatedAt: serverTimestamp()
      });
      showManagerMessage('success', `Anuncio renombrado a "${name}".`);
    } catch (error) {
      console.error('Lectura de Campañas · editar nombre anuncio', error);
      showManagerMessage('error', readableFirebaseError(error, 'No se pudo editar el anuncio'));
    }
  };

  const editProductStartDate = async product => {
    const oldStart = dateToIso(product.effectiveStartDate || product.createdDate) || today;
    const value = window.prompt(
      `Fecha de creación / inicio de "${product.name}" (AAAA-MM-DD):`,
      oldStart
    );
    if (value === null) return;

    const newStart = dateToIso(value);
    if (!newStart) {
      showManagerMessage('error', 'La fecha del producto no es válida. Usa formato AAAA-MM-DD.');
      return;
    }
    if (newStart > today) {
      showManagerMessage('error', 'La fecha del producto no puede ser posterior a hoy.');
      return;
    }

    if (newStart === oldStart) {
      showManagerMessage('success', 'La fecha del producto no cambió.');
      return;
    }

    if (!window.confirm(
      `Cambiar inicio de "${product.name}" de ${oldStart} a ${newStart}.

` +
      `No se borrarán registros. La fecha del producto es independiente de las fechas configuradas en sus campañas.`
    )) return;

    try {
      const nextStateHistory = rebaseInitialStateHistory(product.stateHistory, oldStart, newStart);
      const patch = {
        createdDate: newStart,
        effectiveStartDate: newStart,
        stateHistory: nextStateHistory,
        startDateHistory: [
          ...(Array.isArray(product.startDateHistory) ? product.startDateHistory : []),
          { from: oldStart, to: newStart, changedDate: today }
        ],
        updatedAt: serverTimestamp()
      };

      if (String(product.stateChangedDate || '') === oldStart) {
        patch.stateChangedDate = newStart;
      }

      await updateDoc(doc(db, COLLECTIONS.products, product.id), patch);
      showManagerMessage('success', `Fecha de "${product.name}" actualizada a ${newStart}.`);
    } catch (error) {
      console.error('Lectura de Campañas · editar fecha producto', error);
      showManagerMessage('error', readableFirebaseError(error, 'No se pudo cambiar la fecha del producto'));
    }
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

  const expandAllProductCampaigns = productId => {
    const ids = campaigns
      .filter(c => c.productId === productId && (showArchived || !c.archived))
      .map(c => c.id);

    setExpanded(prev => {
      const next = { ...prev };
      ids.forEach(id => { next[id] = true; });
      return next;
    });
  };

  const collapseAllProductCampaigns = productId => {
    const ids = campaigns
      .filter(c => c.productId === productId && (showArchived || !c.archived))
      .map(c => c.id);

    setExpanded(prev => {
      const next = { ...prev };
      ids.forEach(id => { next[id] = false; });
      return next;
    });

    setExpandedAds(prev => {
      const next = { ...prev };
      ids.forEach(id => { next[id] = false; });
      return next;
    });
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

    const campaignStartDate = dateToIso(campaignDateByProduct[productId] || today);
    if (!campaignStartDate) {
      showManagerMessage('error', 'Selecciona una fecha válida para la campaña.');
      return;
    }
    if (campaignStartDate > today) {
      showManagerMessage('error', 'La fecha de la campaña no puede ser posterior a hoy.');
      return;
    }

    const ref = doc(collection(db, COLLECTIONS.campaigns));
    setBusyKey(`campaign:${productId}`);
    try {
      await setDoc(ref, {
        ownerUid,
        productId,
        name,
        active: true,
        archived: false,
        // Fecha operativa elegida por el usuario. Es independiente del producto.
        createdDate: campaignStartDate,
        effectiveStartDate: campaignStartDate,
        stateChangedDate: campaignStartDate,
        stateHistory: [{ date: campaignStartDate, active: true }],
        startDateHistory: [],
        // Fecha técnica real de creación del documento en Firestore.
        createdAt: serverTimestamp(),
        previousAdStates: {}
      });
      setCampaignNameByProduct(x => ({ ...x, [productId]: '' }));
      setCampaignDateByProduct(x => ({ ...x, [productId]: today }));
      setExpanded(x => ({ ...x, [ref.id]: true }));
      setExpandedAds(x => ({ ...x, [ref.id]: false }));
      showManagerMessage('success', `Campaña "${name}" creada con fecha de inicio ${campaignStartDate}.`);
    } catch (error) {
      console.error('Lectura de Campañas · crear campaña', error);
      showManagerMessage('error', readableFirebaseError(error, 'No se pudo crear la campaña'));
    } finally {
      setBusyKey('');
    }
  };
  const editCampaignStartDate = async campaign => {
    const oldStart = dateToIso(campaign.effectiveStartDate || campaign.createdDate) || today;

    const value = window.prompt(
      `Fecha de creación / inicio de "${campaign.name}" (AAAA-MM-DD):`,
      oldStart
    );
    if (value === null) return;

    const newStart = dateToIso(value);
    if (!newStart) {
      showManagerMessage('error', 'La fecha de la campaña no es válida. Usa formato AAAA-MM-DD.');
      return;
    }
    if (newStart > today) {
      showManagerMessage('error', 'La fecha de la campaña no puede ser posterior a hoy.');
      return;
    }
    if (newStart === oldStart) {
      showManagerMessage('success', 'La fecha de la campaña no cambió.');
      return;
    }

    if (!window.confirm(
      `Cambiar inicio de "${campaign.name}" de ${oldStart} a ${newStart}.\n\n` +
      `No se borrarán registros. La nueva fecha será el inicio operativo independiente de esta campaña y podrá ser anterior o posterior a la fecha del producto.`
    )) return;

    try {
      const nextStateHistory = rebaseInitialStateHistory(campaign.stateHistory, oldStart, newStart);
      const patch = {
        // createdAt conserva la fecha técnica real de Firestore.
        // createdDate/effectiveStartDate representan el inicio operativo editable.
        createdDate: newStart,
        effectiveStartDate: newStart,
        stateHistory: nextStateHistory,
        startDateHistory: [
          ...(Array.isArray(campaign.startDateHistory) ? campaign.startDateHistory : []),
          { from: oldStart, to: newStart, changedDate: today }
        ],
        updatedAt: serverTimestamp()
      };

      if (String(campaign.stateChangedDate || '') === oldStart) {
        patch.stateChangedDate = newStart;
      }

      await updateDoc(doc(db, COLLECTIONS.campaigns, campaign.id), patch);
      showManagerMessage('success', `Fecha de "${campaign.name}" actualizada a ${newStart}.`);
    } catch (error) {
      console.error('Lectura de Campañas · editar fecha campaña', error);
      showManagerMessage('error', readableFirebaseError(error, 'No se pudo cambiar la fecha de la campaña'));
    }
  };

  const requestCampaignOff = campaign => {
    const campaignStart = dateToIso(campaign.effectiveStartDate || campaign.createdDate) || today;
    setCampaignOffPicker({
      campaignId: campaign.id,
      campaignName: campaign.name,
      date: today,
      minDate: campaignStart
    });
  };

  const toggleCampaign = async (campaign, requestedOffDate = null) => {
    const campaignAds = ads.filter(a => a.campaignId === campaign.id && a.deleted !== true);
    const batch = writeBatch(db);

    if (campaign.active !== false) {
      const offDate = dateToIso(requestedOffDate || today);
      const campaignStart = dateToIso(campaign.effectiveStartDate || campaign.createdDate) || today;

      if (!offDate) {
        showManagerMessage('error', 'Selecciona una fecha válida para apagar la campaña.');
        return;
      }
      if (offDate > today) {
        showManagerMessage('error', 'La fecha de apagado no puede ser posterior a hoy.');
        return;
      }
      if (offDate < campaignStart) {
        showManagerMessage('error', `La campaña no puede apagarse antes de su fecha de inicio (${campaignStart}).`);
        return;
      }

      if (!window.confirm(
        `Apagar "${campaign.name}" con fecha efectiva ${offDate}?\n\n` +
        `Desde esa fecha dejará de aparecer en Registro diario. ` +
        `Los datos anteriores se conservarán y seguirán disponibles en los informes.`
      )) return;

      const previousAdStates = {};
      campaignAds.forEach(a => { previousAdStates[a.id] = a.active !== false; });

      batch.update(doc(db, COLLECTIONS.campaigns, campaign.id), {
        active: false,
        previousAdStates,
        stateChangedDate: offDate,
        deactivatedDate: offDate,
        stateHistory: terminalStateHistoryCC(campaign.stateHistory, offDate, false),
        stateChangedAt: serverTimestamp()
      });

      campaignAds.forEach(a => {
        batch.update(doc(db, COLLECTIONS.ads, a.id), {
          active: false,
          savedActiveBeforeCampaignOff: a.active !== false,
          disabledByCampaign: true,
          stateChangedDate: offDate,
          stateHistory: terminalStateHistoryCC(a.stateHistory, offDate, false),
          stateChangedAt: serverTimestamp()
        });
      });

      await batch.commit();
      await addDecision(
        ownerUid,
        campaign,
        null,
        'Campaña apagada',
        `Fecha efectiva de apagado: ${offDate}. Desde esa fecha quedó excluida de Registro diario; histórico anterior conservado.`,
        { changeType: 'campaign_state', safetyHours: 48 }
      );
      setCampaignOffPicker(null);
      showManagerMessage('success', `"${campaign.name}" apagada con fecha efectiva ${offDate}.`);
    } else {
      const previous = campaign.previousAdStates || {};

      batch.update(doc(db, COLLECTIONS.campaigns, campaign.id), {
        active: true,
        stateChangedDate: today,
        deactivatedDate: null,
        stateHistory: [...(campaign.stateHistory || []), { date: today, active: true }],
        stateChangedAt: serverTimestamp()
      });

      campaignAds.forEach(a => {
        const restored = previous[a.id] !== undefined
          ? previous[a.id]
          : (a.savedActiveBeforeCampaignOff === true);

        batch.update(doc(db, COLLECTIONS.ads, a.id), {
          active: restored,
          disabledByCampaign: false,
          stateChangedDate: today,
          stateHistory: [...(a.stateHistory || []), { date: today, active: restored }],
          stateChangedAt: serverTimestamp()
        });
      });

      await batch.commit();
      await addDecision(
        ownerUid,
        campaign,
        null,
        'Campaña encendida',
        `Reactivada el ${today}. Se restauró el estado individual previo de los anuncios.`,
        { changeType: 'campaign_state', safetyHours: 48 }
      );
      showManagerMessage('success', `"${campaign.name}" encendida desde ${today}.`);
    }
  };
  const archiveCampaign = async campaign => {
    if (!window.confirm(`¿Archivar ${campaign.name}? Se conserva todo el histórico.`)) return;
    const campaignAds = ads.filter(a => a.campaignId === campaign.id && a.deleted !== true); const batch = writeBatch(db);
    batch.update(doc(db, COLLECTIONS.campaigns, campaign.id), { archived: true, active: false, archivedDate: today, deactivatedDate: campaign.deactivatedDate || today, stateChangedDate: today, stateHistory: [...(campaign.stateHistory || []), { date: today, active: false }], archivedAt: serverTimestamp() });
    campaignAds.forEach(a => batch.update(doc(db, COLLECTIONS.ads, a.id), { active: false, savedActiveBeforeCampaignOff: a.active !== false, disabledByCampaign: true, stateChangedDate: today, stateHistory: [...(a.stateHistory || []), { date: today, active: false }], stateChangedAt: serverTimestamp() }));
    await batch.commit(); await addDecision(ownerUid, campaign, null, 'Campaña archivada', 'Histórico conservado; excluida del análisis activo.');
  };
  const restoreCampaign = async campaign => {
    await updateDoc(doc(db, COLLECTIONS.campaigns, campaign.id), { archived: false, active: false, archivedDate: null, restoredDate: today, stateChangedDate: today, restoredAt: serverTimestamp() });
    await addDecision(ownerUid, campaign, null, 'Campaña restaurada', 'Restaurada como apagada. Enciéndela cuando corresponda.');
  };
  const permanentDeleteCampaign = async campaign => {
    if (!window.confirm(`ELIMINACIÓN DEFINITIVA: ¿borrar ${campaign.name} y todo su histórico de Lectura de Campañas?`)) return;
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
    if (ads.some(a => a.campaignId === campaign.id && a.deleted !== true && normalizeAdName(a.name) === normalizedName)) {
      showManagerMessage('error', `Ya existe un anuncio llamado "${name}" dentro de esta campaña.`);
      return;
    }

    const parentProduct = products.find(p => p.id === campaign.productId);
    const effectiveStartDate =
      dateToIso(campaign.effectiveStartDate || campaign.createdDate) ||
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
      await addDecision(
        ownerUid,
        campaign,
        { id: ref.id, productId: campaign.productId, campaignId: campaign.id },
        'Anuncio creado',
        `Nuevo anuncio agregado a la campaña: ${name}`,
        { changeType: 'ad_added', safetyHours: 48 }
      );
      setAdNameByCampaign(x => ({ ...x, [campaign.id]: '' }));
      setExpanded(x => ({ ...x, [campaign.id]: true }));
      showManagerMessage('success', `Anuncio "${name}" creado correctamente en "${campaign.name}". Se activó margen de seguridad de cambios.`);
    } catch (error) {
      console.error('Lectura de Campañas · crear anuncio', error);
      showManagerMessage('error', readableFirebaseError(error, 'No se pudo crear el anuncio'));
    } finally {
      setBusyKey('');
    }
  };
  const toggleAd = async (ad,campaign) => {
    if(campaign.active===false&&ad.active===false) return alert('Primero debes encender la campaña.');
    if (!confirmStructuralChangeSafety(campaign)) return;

    const next=ad.active===false;
    const promptText = next
      ? `Motivo para encender "${ad.name}":`
      : `Razón para apagar "${ad.name}":`;
    const rawReason = window.prompt(promptText, next ? 'Reactivación manual' : '');
    if (rawReason === null) return;
    const reason = String(rawReason || '').trim();
    if (!reason) return alert('Debes registrar una razón para guardar el cambio en la bitácora.');

    await updateDoc(doc(db,COLLECTIONS.ads,ad.id),{
      active:next,
      savedActiveBeforeCampaignOff:next,
      disabledByCampaign:false,
      stateChangedDate:today,
      stateHistory:terminalStateHistoryCC(ad.stateHistory,today,next),
      stateChangedAt:serverTimestamp()
    });
    await addDecision(
      ownerUid,
      campaign,
      ad,
      next?'Anuncio encendido':'Anuncio apagado',
      `${next ? 'Encendido' : 'Apagado'} manualmente. Razón: ${reason}`,
      { changeType: 'ad_state', safetyHours: 48, reason, source: 'campaign_manager' }
    );
  };
  const deleteAd = async (ad,campaign) => {
    if (!confirmStructuralChangeSafety(campaign)) return;

    const rawReason = window.prompt(
      `Razón para eliminar "${ad.name}" de la configuración activa:\n\nEl histórico NO se borrará y el cambio quedará en la bitácora.`,
      ''
    );
    if (rawReason === null) return;
    const reason = String(rawReason || '').trim();
    if (!reason) return alert('Debes registrar una razón para eliminar el anuncio.');

    const ok=window.confirm(
      `¿Eliminar "${ad.name}" de la configuración activa de "${campaign.name}"?\n\n` +
      `Dejará de aparecer en Campañas y Registro diario desde hoy. ` +
      `Los registros históricos y la bitácora se conservarán.`
    );
    if(!ok) return;

    const batch = writeBatch(db);
    batch.update(doc(db,COLLECTIONS.ads,ad.id), {
      active:false,
      deleted:true,
      deletedDate:today,
      deletedReason:reason,
      savedActiveBeforeCampaignOff:false,
      disabledByCampaign:false,
      stateChangedDate:today,
      stateHistory:terminalStateHistoryCC(ad.stateHistory,today,false),
      deletedAt:serverTimestamp(),
      stateChangedAt:serverTimestamp()
    });

    recommendations
      .filter(x=>x.adId===ad.id && x.status==='active')
      .forEach(x=>batch.update(doc(db,COLLECTIONS.recommendations,x.id),{
        status:'cancelled',
        cancelledReason:'ad_deleted',
        cancelledDate:today,
        updatedAt:serverTimestamp()
      }));

    await batch.commit();

    await addDecision(
      ownerUid,
      campaign,
      ad,
      'Anuncio eliminado',
      `Eliminado de la configuración activa. Histórico conservado. Razón: ${reason}`,
      { changeType:'ad_deleted', safetyHours:48, reason, source:'campaign_manager' }
    );
  };

  return <div className="cc-module-view cc-manager space-y-5">
    {managerMessage && <div className={`rounded-2xl border p-3 text-[10px] font-black ${managerMessage.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>{managerMessage.type === 'success' ? '✓ ' : '⚠ '}{managerMessage.text}</div>}
    <SectionCard accent="#059669" soft="#ecfdf5"><div className="flex flex-col md:flex-row md:items-end gap-3"><div className="flex-1"><p className="text-[9px] font-black uppercase text-emerald-700 mb-1">Nuevo producto · Lectura de campañas</p><input value={productForm.name} onChange={e=>setProductForm(x=>({...x,name:e.target.value}))} placeholder="Ej: ACTIVE CHIC" className="w-full bg-slate-50 rounded-xl px-3 py-2.5 text-sm font-bold outline-none"/></div><div className="md:w-48"><p className="text-[9px] font-black uppercase text-slate-400 mb-1">CPA máximo</p><input type="number" value={productForm.maxCpa} onChange={e=>setProductForm(x=>({...x,maxCpa:e.target.value}))} className="w-full bg-slate-50 rounded-xl px-3 py-2.5 text-sm font-bold outline-none"/></div><div className="md:w-48"><p className="text-[9px] font-black uppercase text-slate-400 mb-1">Fecha de inicio</p><input type="date" max={today} value={productForm.createdDate} onChange={e=>setProductForm(x=>({...x,createdDate:e.target.value}))} className="w-full bg-slate-50 rounded-xl px-3 py-2.5 text-sm font-bold outline-none"/><p className="text-[7px] text-slate-400 mt-1">Puede ser anterior a hoy</p></div><button onClick={addProduct} className="bg-emerald-500 text-zinc-950 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase flex items-center gap-2"><Plus size={14}/> Crear producto</button></div></SectionCard>
    {products.length===0?<EmptyState>No existen productos en Lectura de Campañas.</EmptyState>:products.map(product=>{const productCampaigns=campaigns.filter(c=>c.productId===product.id&&(showArchived||!c.archived));const productAccent=ccVisualAccent(product.id||product.name);const productOpen=expandedProductsManager[product.id]===true;return <SectionCard key={product.id} className={product.active===false?'opacity-70':''} accent={productAccent.border} soft={productAccent.soft}>
      <button
        type="button"
        aria-expanded={productOpen}
        onClick={()=>setExpandedProductsManager(x=>({...x,[product.id]:!productOpen}))}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <h3 className="font-black uppercase text-base" style={{color:productAccent.text}}>{product.name}</h3>
        {productOpen?<ChevronUp size={16} style={{color:productAccent.text}}/>:<ChevronDown size={16} style={{color:productAccent.text}}/>}
      </button>

      {productOpen&&<div className="mt-4 pt-4 border-t" style={{borderColor:productAccent.border}}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex gap-2 items-center flex-wrap">
              <span className="w-2.5 h-2.5 rounded-full" style={{backgroundColor:productAccent.border}}></span>
              <StateBadge active={product.active!==false}/>
            </div>
            <p className="text-[9px] font-black text-slate-400 mt-1">
              CPA máximo: <span className="text-purple-600">{fmtMoney(product.maxCpa)}</span> · {productCampaigns.length} campaña(s) · Inicio: {(product.effectiveStartDate || product.createdDate) ? parseDateSafe(product.effectiveStartDate || product.createdDate)?.toLocaleDateString('es-CO') : '—'}
            </p>
          </div>
          <div className="flex gap-1">
            <button title="Editar nombre y CPA" onClick={()=>editProduct(product)} className="px-2.5 py-2 rounded-xl bg-slate-100 text-slate-600 text-[8px] font-black uppercase inline-flex items-center gap-1.5"><Pencil size={13}/> Editar</button>
            <button title="Editar fecha de creación / inicio" onClick={()=>editProductStartDate(product)} className="p-2 rounded-xl bg-blue-50 text-blue-600"><CalendarDays size={14}/></button>
            <button onClick={()=>toggleProduct(product)} className={`p-2 rounded-xl ${product.active===false?'bg-emerald-100 text-emerald-600':'bg-rose-100 text-rose-600'}`}>{product.active===false?<Power size={14}/>:<PowerOff size={14}/>}</button>
            <button onClick={()=>deleteProduct(product)} className="p-2 rounded-xl bg-rose-50 text-rose-500"><Trash2 size={14}/></button>
            <button type="button" title="Cerrar producto" onClick={()=>setExpandedProductsManager(x=>({...x,[product.id]:false}))} className="p-2 rounded-xl bg-slate-100 text-slate-500"><ChevronUp size={14}/></button>
          </div>
        </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_190px_auto] gap-2 mt-4">
        <div>
          <p className="text-[8px] font-black uppercase text-slate-400 mb-1">Nombre campaña</p>
          <input
            value={campaignNameByProduct[product.id]||''}
            onChange={e=>setCampaignNameByProduct(x=>({...x,[product.id]:e.target.value}))}
            onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addCampaign(product.id);}}}
            placeholder="Nombre nueva campaña"
            className="w-full bg-slate-50 rounded-xl px-3 py-2 text-xs font-bold"
          />
        </div>
        <div>
          <p className="text-[8px] font-black uppercase text-slate-400 mb-1">Fecha inicio campaña</p>
          <input
            type="date"
            max={today}
            value={campaignDateByProduct[product.id] || today}
            onChange={e=>setCampaignDateByProduct(x=>({...x,[product.id]:e.target.value}))}
            className="w-full bg-slate-50 rounded-xl px-3 py-2 text-xs font-bold"
          />
          <p className="text-[7px] text-slate-400 mt-1">Independiente de la fecha del producto</p>
        </div>
        <button
          type="button"
          disabled={busyKey === `campaign:${product.id}`}
          onClick={()=>addCampaign(product.id)}
          className="md:self-end bg-zinc-950 text-white px-3 py-2 rounded-xl text-[9px] font-black uppercase disabled:opacity-50"
        >
          <Plus size={12} className="inline mr-1"/> {busyKey === `campaign:${product.id}` ? 'Creando...' : 'Campaña'}
        </button>
      </div>
      {productCampaigns.length > 0 && <div className="flex items-center justify-between gap-2 mt-3">
        <p className="text-[8px] font-bold text-slate-400">Producto → Campaña → resumen y controles → anuncios</p>
        <div className="flex gap-1.5 shrink-0">
          <button type="button" onClick={()=>expandAllProductCampaigns(product.id)} className="px-2.5 py-1.5 rounded-lg bg-white/80 border border-slate-200 text-[8px] font-black uppercase text-slate-600 flex items-center gap-1"><ChevronDown size={11}/> Expandir campañas</button>
          <button type="button" onClick={()=>collapseAllProductCampaigns(product.id)} className="px-2.5 py-1.5 rounded-lg bg-white/80 border border-slate-200 text-[8px] font-black uppercase text-slate-600 flex items-center gap-1"><ChevronUp size={11}/> Contraer campañas</button>
        </div>
      </div>}
      <div className="space-y-3 mt-3">{productCampaigns.length===0?<EmptyState>0 campañas. Puedes agregar una nueva sin perder el producto.</EmptyState>:productCampaigns.map(campaign=>{const campaignAds=ads.filter(a=>a.campaignId===campaign.id&&a.deleted!==true);const isOpen=expanded[campaign.id]===true;const adsOpen=expandedAds[campaign.id]===true;const campaignAccent=ccVisualAccent(campaign.id||campaign.name,2);return <div key={campaign.id} className={`rounded-2xl overflow-hidden ${campaign.archived?'opacity-75':''}`} style={{border:`1px solid ${campaignAccent.border}`,backgroundColor:campaignAccent.soft,boxShadow:`0 6px 18px ${campaignAccent.border}0d`}}>
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={()=>setExpanded(x=>({...x,[campaign.id]:!isOpen}))}
          className="w-full p-3 flex items-center justify-between gap-3 text-left hover:bg-white/35 transition-colors"
        >
          <span className="font-black text-xs uppercase" style={{color:campaignAccent.text}}>{campaign.name}</span>
          {isOpen?<ChevronUp size={14} style={{color:campaignAccent.text}}/>:<ChevronDown size={14} style={{color:campaignAccent.text}}/>}
        </button>

        {isOpen&&<div className="border-t" style={{borderColor:campaignAccent.border,backgroundColor:'#ffffffcc'}}>
          <div className="p-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <StateBadge active={campaign.active!==false} archived={campaign.archived}/>
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white border border-slate-200 text-[8px] font-black text-slate-500">
                    {campaignAds.length} anuncio(s)
                  </span>
                  <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[8px] font-black ${
                    isPlaybookEligibleCampaignCC(campaign)
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'bg-slate-100 text-slate-500'
                  }`}>
                    {isPlaybookEligibleCampaignCC(campaign) ? 'PLAYBOOK ESCALA' : 'PLAYBOOK NO APLICA'}
                  </span>
                </div>
                <p className="text-[8px] text-slate-400 mt-2">
                  inicio campaña {campaign.effectiveStartDate||campaign.createdDate||'—'} · fecha independiente del producto · alta técnica conservada · último cambio {campaign.stateChangedDate||'—'}{campaign.active===false ? ` · apagada desde ${campaign.deactivatedDate||campaign.stateChangedDate||'—'}` : ''}
                </p>
              </div>

              <div className="flex gap-1 flex-wrap">
                <button title="Editar nombre de campaña" onClick={()=>editCampaignName(campaign)} className="px-2.5 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-[8px] font-black uppercase inline-flex items-center gap-1"><Pencil size={11}/> Editar</button>
                <button title="Editar fecha de creación / inicio" onClick={()=>editCampaignStartDate(campaign)} className="p-1.5 rounded-lg bg-blue-50 text-blue-600"><CalendarDays size={12}/></button>
                {!campaign.archived&&<button
                  onClick={()=>campaign.active===false ? toggleCampaign(campaign) : requestCampaignOff(campaign)}
                  className={`px-2 py-1.5 rounded-lg text-[8px] font-black uppercase ${campaign.active===false?'bg-emerald-100 text-emerald-700':'bg-rose-100 text-rose-600'}`}
                >{campaign.active===false?'Encender':'Apagar'}</button>}
                {!campaign.archived?<button onClick={()=>archiveCampaign(campaign)} className="px-2 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-[8px] font-black uppercase flex items-center gap-1"><Archive size={11}/> Archivar</button>:<button onClick={()=>restoreCampaign(campaign)} className="px-2 py-1.5 rounded-lg bg-blue-100 text-blue-700 text-[8px] font-black uppercase flex items-center gap-1"><ArchiveRestore size={11}/> Restaurar</button>}
                <button title="Eliminar campaña definitivamente" onClick={()=>permanentDeleteCampaign(campaign)} className="p-1.5 rounded-lg bg-rose-50 text-rose-500"><Trash2 size={12}/></button>
                <button type="button" onClick={()=>setExpanded(x=>({...x,[campaign.id]:false}))} className="px-2 py-1.5 rounded-lg bg-slate-100 text-slate-500 text-[8px] font-black uppercase flex items-center gap-1"><ChevronUp size={10}/> Cerrar campaña</button>
              </div>
            </div>

            {campaign.active !== false && !campaign.archived && (() => {
              const campaignSafety = buildCampaignChangeSafetyCC(campaign, budgetChanges, decisions, safetyNowMs);
              const latestBudget = [...budgetChanges]
                .filter(b => b.campaignId === campaign.id && toNumber(b.newBudget) > 0)
                .sort((a,b) => toNumber(changeEventTimeMsCC(b)) - toNumber(changeEventTimeMsCC(a)))[0]?.newBudget || null;

              return (
                <div className="mt-3">
                  <CampaignChangeSafetyCardCC safety={campaignSafety} currentBudget={latestBudget} />
                </div>
              );
            })()}

            {campaignOffPicker?.campaignId === campaign.id && campaign.active !== false && !campaign.archived && (
              <div className="mt-3 rounded-2xl border-2 border-rose-200 bg-rose-50 p-3">
                <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
                  <div>
                    <p className="text-[9px] font-black uppercase text-rose-700">Fecha efectiva de apagado</p>
                    <p className="text-[8px] text-rose-600 mt-1">
                      Desde esta fecha la campaña dejará de aparecer en Registro diario. El histórico anterior seguirá disponible en informes.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <div>
                      <p className="text-[7px] font-black uppercase text-rose-500 mb-1">Apagar desde</p>
                      <input
                        type="date"
                        min={campaignOffPicker.minDate}
                        max={today}
                        value={campaignOffPicker.date}
                        onChange={e=>setCampaignOffPicker(x=>x ? ({...x,date:e.target.value}) : x)}
                        className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-black text-rose-800"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={()=>toggleCampaign(campaign, campaignOffPicker.date)}
                      className="px-3 py-2 rounded-xl bg-rose-600 text-white text-[8px] font-black uppercase"
                    >
                      Confirmar apagado
                    </button>
                    <button
                      type="button"
                      onClick={()=>setCampaignOffPicker(null)}
                      className="px-3 py-2 rounded-xl bg-white border border-rose-200 text-rose-600 text-[8px] font-black uppercase"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            )}

            <button
              type="button"
              aria-expanded={adsOpen}
              onClick={()=>setExpandedAds(x=>({...x,[campaign.id]:!adsOpen}))}
              className="w-full mt-3 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 hover:bg-slate-100 transition-colors"
            >
              <span className="text-[9px] font-black uppercase text-slate-600">
                Anuncios de la campaña · {campaignAds.length}
              </span>
              <span className="inline-flex items-center gap-1 text-[8px] font-black uppercase" style={{color:campaignAccent.text}}>
                {adsOpen ? 'Ocultar anuncios' : 'Ver anuncios'}
                {adsOpen?<ChevronUp size={12}/>:<ChevronDown size={12}/>}
              </span>
            </button>
          </div>

          {adsOpen&&<div className="border-t p-3" style={{borderColor:campaignAccent.border,backgroundColor:'#ffffff'}}>
          {!campaign.archived&&<div className="flex gap-2 mb-3"><input value={adNameByCampaign[campaign.id]||''} onChange={e=>setAdNameByCampaign(x=>({...x,[campaign.id]:e.target.value}))} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addAd(campaign);}}} placeholder="Nombre nuevo anuncio" className="flex-1 bg-white border rounded-xl px-3 py-2 text-xs font-bold"/><button type="button" disabled={busyKey === `ad:${campaign.id}`} onClick={()=>addAd(campaign)} className="bg-emerald-500 text-zinc-950 px-3 rounded-xl text-[9px] font-black uppercase disabled:opacity-50"><Plus size={12} className="inline"/> {busyKey === `ad:${campaign.id}` ? 'Creando...' : 'Anuncio'}</button></div>}{campaignAds.length===0?<EmptyState>Sin anuncios.</EmptyState>:<div className="space-y-2">{campaignAds.map(ad=>{const adAccent=ccVisualAccent(ad.id||ad.name,4);return <div key={ad.id} className="cc-manager-ad rounded-xl p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3" style={{border:`1px solid ${adAccent.border}`,backgroundColor:adAccent.soft}}><div className="min-w-0"><div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{backgroundColor:adAccent.border}}></span><p className="text-[10px] font-black" style={{color:adAccent.text}}>{ad.name}</p></div><p className="text-[8px] text-slate-400">Alta {ad.createdDate||'—'} · datos desde {ad.effectiveStartDate||ad.createdDate||'—'} · último cambio {ad.stateChangedDate||'—'} · {campaign.active===false?'apagado por campaña':ad.active===false?'excluido de métricas':'incluido en métricas'}</p></div><div className="flex items-center gap-1.5 flex-wrap justify-end"><StateBadge active={ad.active!==false}/><button title="Editar nombre del anuncio" onClick={()=>editAdName(ad,campaign)} className="px-2 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-[8px] font-black uppercase inline-flex items-center gap-1"><Pencil size={10}/> Editar</button><button disabled={campaign.archived} onClick={()=>toggleAd(ad,campaign)} className={`px-2 py-1.5 rounded-lg text-[8px] font-black ${ad.active===false?'bg-emerald-100 text-emerald-700':'bg-rose-100 text-rose-600'} disabled:opacity-30`}>{ad.active===false?'Encender':'Apagar'}</button><button title="Eliminar de la configuración activa conservando histórico y bitácora" onClick={()=>deleteAd(ad,campaign)} className="p-1.5 rounded-lg bg-rose-50 text-rose-500"><Trash2 size={12}/></button></div></div>})}</div>}</div>}
        </div>}
      </div>})}</div>
      </div>}
    </SectionCard>})}
    <label className="flex items-center gap-2 text-[9px] font-black uppercase text-slate-500"><input type="checkbox" checked={showArchived} onChange={e=>setShowArchived(e.target.checked)}/> Mostrar campañas archivadas</label>
  </div>;
}


function decisionDateTimeLabelCC(item) {
  const ms = changeEventTimeMsCC(item);
  if (ms) {
    return new Intl.DateTimeFormat('es-CO', {
      timeZone: 'America/Bogota',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date(ms));
  }
  return formatIsoDateCC(item?.date);
}

function changeLogToneCC(item) {
  const action = String(item?.action || '').toLowerCase();
  if (action.includes('eliminado') || action.includes('apagado')) return 'critical';
  if (action.includes('presupuesto') || action.includes('escala')) return 'attention';
  if (action.includes('encendido') || action.includes('creado') || action.includes('restaurada')) return 'good';
  return 'neutral';
}

function isCampaignChangeLogEventCC(item) {
  const type = String(item?.changeType || '');
  if ([
    'ad_state',
    'ad_deleted',
    'ad_added',
    'campaign_state',
    'budget_scale_safe',
    'budget_change_major'
  ].includes(type)) return true;

  const action = String(item?.action || '');
  return /anuncio|campaña|presupuesto|archivada|restaurada/i.test(action);
}

function CampaignChangeLogCC({ campaign, decisions = [], ads = [] }) {
  const rows = (decisions || [])
    .filter(d => d.campaignId === campaign.id && isCampaignChangeLogEventCC(d))
    .sort((a, b) => {
      const aMs = changeEventTimeMsCC(a) || 0;
      const bMs = changeEventTimeMsCC(b) || 0;
      if (aMs !== bMs) return bMs - aMs;
      return String(b.date || '').localeCompare(String(a.date || ''));
    });

  if (!rows.length) {
    return (
      <div className="p-4 bg-white">
        <EmptyState>Esta campaña todavía no tiene cambios registrados en la bitácora.</EmptyState>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-4 bg-white">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <div>
          <p className="text-[9px] font-black uppercase text-zinc-900">Bitácora de cambios</p>
          <p className="text-[8px] text-slate-500 mt-1">
            Historial operativo de la campaña: anuncios apagados/encendidos/eliminados, altas y cambios de presupuesto.
          </p>
        </div>
        <span className="w-fit px-2 py-1 rounded-full bg-slate-100 text-slate-600 text-[7px] font-black uppercase">
          {rows.length} cambio{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="space-y-2">
        {rows.map((item, idx) => {
          const tone = changeLogToneCC(item);
          const adName =
            item.adNameSnapshot ||
            ads.find(a => a.id === item.adId)?.name ||
            (item.adId ? 'Anuncio' : null);
          const reason = String(item.reason || '').trim();
          const detail = String(item.detail || '').trim();

          return (
            <div
              key={item.id || `${item.date || 'date'}_${idx}`}
              className={`rounded-xl border p-3 ${toneBg(tone)}`}
            >
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-1 rounded-full text-[7px] font-black uppercase ${toneBadge(tone)}`}>
                      {item.action || 'Cambio'}
                    </span>
                    {adName ? (
                      <span className="px-2 py-1 rounded-full bg-white/80 border border-white text-[7px] font-black uppercase text-slate-600">
                        {adName}
                      </span>
                    ) : (
                      <span className="px-2 py-1 rounded-full bg-white/80 border border-white text-[7px] font-black uppercase text-slate-600">
                        Campaña
                      </span>
                    )}
                  </div>

                  {reason ? (
                    <p className="text-[8px] sm:text-[9px] font-semibold text-zinc-800 mt-2 leading-relaxed">
                      <strong>Razón:</strong> {reason}
                    </p>
                  ) : null}

                  {detail ? (
                    <p className="text-[7.5px] sm:text-[8px] text-slate-600 mt-1.5 leading-relaxed">
                      {detail}
                    </p>
                  ) : null}
                </div>

                <p className="shrink-0 text-[7px] font-black text-slate-400 md:text-right">
                  {decisionDateTimeLabelCC(item)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

async function addDecision(ownerUid, campaign, ad, action, detail, meta = {}) {
  await addDoc(collection(db, COLLECTIONS.decisions), {
    ownerUid,
    productId: campaign?.productId || ad?.productId || null,
    campaignId: campaign?.id || ad?.campaignId || null,
    adId: ad?.id || null,
    campaignNameSnapshot: campaign?.name || meta?.campaignNameSnapshot || null,
    adNameSnapshot: ad?.name || meta?.adNameSnapshot || null,
    date: todayColombiaCC(),
    action,
    detail,
    ...meta,
    clientRecordedAtMs: Date.now(),
    createdAt: serverTimestamp()
  });
}


function DailyRegisterFull({ ownerUid, products, campaigns, ads, dailyCampaigns, dailyAds, recommendations, decisions = [] }) {
  const [date, setDate] = useState(todayColombiaCC());
  const [expandedProducts, setExpandedProducts] = useState({});
  const [expandedCampaigns, setExpandedCampaigns] = useState({});
  const [campaignPane, setCampaignPane] = useState({});
  const [colombiaClock, setColombiaClock] = useState(colombiaDateTimeLabelCC());

  useEffect(() => {
    const refresh = () => {
      setColombiaClock(colombiaDateTimeLabelCC());
      const colombiaToday = todayColombiaCC();
      setDate(current => current > colombiaToday ? colombiaToday : current);
    };
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, []);

  const colombiaToday = todayColombiaCC();
  const lastCompleteDate = lastCompleteColombiaDateCC();

  const visibleProducts = products
    .filter(p => {
      const productStart = dateToIso(p.effectiveStartDate || p.createdDate);
      const productAlreadyExists = !productStart || productStart <= date;
      const hasHistoricalCampaign = campaigns.some(c =>
        c.productId === p.id &&
        !c.archived &&
        (!(c.effectiveStartDate || c.createdDate) || (c.effectiveStartDate || c.createdDate) <= date) &&
        entityActiveOnDate(c, date)
      );
      return productAlreadyExists || hasHistoricalCampaign;
    })
    .sort((a,b) => String(a.name || '').localeCompare(String(b.name || '')));

  const expandAll = () => {
    const p = {}, c = {};
    visibleProducts.forEach(product => {
      p[product.id] = true;
      campaigns.filter(x =>
        x.productId === product.id &&
        !x.archived &&
        (!(x.effectiveStartDate || x.createdDate) || (x.effectiveStartDate || x.createdDate) <= date) &&
        entityActiveOnDate(x, date)
      ).forEach(campaign => { c[campaign.id] = true; });
    });
    setExpandedProducts(p);
    setExpandedCampaigns(c);
  };

  const collapseAll = () => {
    setExpandedProducts({});
    setExpandedCampaigns({});
  };

  const availableCampaignsForDate = campaigns.filter(c =>
    !c.archived &&
    (!(c.effectiveStartDate || c.createdDate) || (c.effectiveStartDate || c.createdDate) <= date) &&
    entityActiveOnDate(c, date)
  );
  const availableCampaignIdsForDate = new Set(availableCampaignsForDate.map(c => c.id));
  const registeredCampaigns = new Set(
    dailyCampaigns
      .filter(r => r.date === date && availableCampaignIdsForDate.has(r.campaignId))
      .map(r => r.campaignId)
  ).size;
  const totalCampaigns = availableCampaignsForDate.length;

  return (
    <div className="cc-module-view cc-daily-register space-y-5">
      <SectionCard accent="#0891b2" soft="#ecfeff">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-black uppercase text-cyan-800">Registro diario de Meta Ads</h3>
            <p className="text-[9px] text-slate-400 mt-1">Fecha → Productos → Campañas → Anuncios. Cada registro se guarda por fecha y campaña; volver a guardarlo actualiza el mismo documento, nunca crea duplicados.</p>
            <div className="mt-2 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-cyan-50 border border-cyan-200">
              <span className="text-[8px] font-black uppercase text-cyan-700">🇨🇴 Hora Colombia · America/Bogota</span>
              <span className="text-[8px] font-black text-cyan-900">{colombiaClock}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <p className="text-[8px] font-black uppercase text-slate-400 mb-1">Fecha</p>
              <input type="date" max={colombiaToday} value={date} onChange={e => setDate(e.target.value > colombiaToday ? colombiaToday : e.target.value)} className="bg-zinc-950 text-white border border-zinc-800 rounded-xl px-3 py-2 text-xs font-black" />
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

      {visibleProducts.length === 0 ? <EmptyState>No existen productos de Lectura de Campañas para esta fecha.</EmptyState> :
        visibleProducts.map(product => {
          const productCampaigns = campaigns
            .filter(c =>
              c.productId === product.id &&
              !c.archived &&
              (!(c.effectiveStartDate || c.createdDate) || (c.effectiveStartDate || c.createdDate) <= date) &&
              entityActiveOnDate(c, date)
            )
            .sort((a,b) => String(a.name || '').localeCompare(String(b.name || '')));
          const isOpen = expandedProducts[product.id] === true;

          const productCampaignIds = new Set(productCampaigns.map(c => c.id));
          const productRegistered = new Set(
            dailyCampaigns
              .filter(r =>
                r.date === date &&
                r.productId === product.id &&
                productCampaignIds.has(r.campaignId)
              )
              .map(r => r.campaignId)
          ).size;
          const productPending = Math.max(0, productCampaigns.length - productRegistered);
          const productRegistrationComplete =
            productCampaigns.length > 0 && productPending === 0;

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
                  <StateBadge active={
                    entityActiveOnDate(product, date) ||
                    productCampaigns.some(c => entityActiveOnDate(c, date))
                  } />

                  {productCampaigns.length > 0 ? (
                    <>
                      <span className={`px-2 py-1 rounded-full text-[8px] font-black uppercase ${
                        productRegistrationComplete
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}>
                        Campañas registradas {productRegistered} de {productCampaigns.length}
                      </span>

                      {productRegistrationComplete ? (
                        <span className="px-2 py-1 rounded-full bg-emerald-500 text-white text-[8px] font-black uppercase">
                          Al día
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded-full bg-rose-100 text-rose-700 text-[8px] font-black uppercase">
                          {productPending} pendiente{productPending === 1 ? '' : 's'}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-500 text-[8px] font-black uppercase">
                      Sin campañas para esta fecha
                    </span>
                  )}
                </div>
                <p className="text-[8px] text-slate-400 mt-1">
                  CPA máximo {fmtMoney(product.maxCpa)} · seguimiento del registro visible sin desplegar el producto
                </p>
              </div>
              {isOpen ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
            </button>

            {isOpen && <div className="space-y-3 mt-4 pt-4 border-t">
              {productCampaigns.length === 0 ? <EmptyState>Este producto no tiene campañas disponibles para la fecha.</EmptyState> :
                productCampaigns.map(campaign => {
                  const campaignOpen = expandedCampaigns[campaign.id] === true;
                  const existing = dailyCampaigns.find(r => r.campaignId === campaign.id && r.date === date);
                  const previousBudgetRecord = previousCampaignBudgetCC(dailyCampaigns, campaign.id, date);
                  const existingBudgetValue = toNumber(existing?.budget);
                  const included = entityActiveOnDate(campaign, date);
                  const registrationCoverage = campaignRegistrationCoverageCC(
                    campaign,
                    product,
                    dailyCampaigns,
                    lastCompleteDate
                  );
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
                          {existingBudgetValue > 0 ? (
                            <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[8px] font-black uppercase">
                              Presupuesto día · {fmtMoney(existingBudgetValue)}
                            </span>
                          ) : previousBudgetRecord ? (
                            <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-700 text-[8px] font-black uppercase">
                              Presupuesto previo · {fmtMoney(previousBudgetRecord.budget)}
                            </span>
                          ) : (
                            <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-500 text-[8px] font-black uppercase">
                              Sin presupuesto previo
                            </span>
                          )}
                          {registrationCoverage.requiredDays === 0 ? (
                            <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-500 text-[8px] font-black uppercase">
                              Sin días completos pendientes
                            </span>
                          ) : registrationCoverage.missingDays === 0 ? (
                            <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[8px] font-black uppercase">
                              Histórico al día · {registrationCoverage.registeredDays}/{registrationCoverage.requiredDays}
                            </span>
                          ) : (
                            <span className={`px-2 py-1 rounded-full text-[8px] font-black uppercase ${
                              registrationCoverage.missingDays >= 4
                                ? 'bg-rose-100 text-rose-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}>
                              Faltan {registrationCoverage.missingDays} día(s) por registrar
                            </span>
                          )}
                        </div>
                        <p className="text-[8px] text-slate-400 mt-1">
                          {included ? 'Este día participa en diagnósticos.' : 'Este día está OFF y será excluido de diagnósticos aunque exista un registro.'}
                        </p>
                        <p className="text-[8px] text-slate-500 mt-1">
                          Historial completo: {registrationCoverage.registeredDays}/{registrationCoverage.requiredDays} días activos registrados desde {registrationCoverage.startDate || '—'} hasta {registrationCoverage.throughDate || '—'}. HOY no cuenta porque es intradía; días OFF tampoco.
                        </p>
                      </div>
                      {campaignOpen ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                    </button>
                    {campaignOpen && (() => {
                      const pane = campaignPane[campaign.id] || 'register';
                      const campaignLogCount = decisions.filter(d => d.campaignId === campaign.id && isCampaignChangeLogEventCC(d)).length;

                      return (
                        <div className="bg-white border-t" style={{ borderColor: campaignAccent.border }}>
                          <div className="flex gap-1 p-2 bg-slate-50/80 overflow-x-auto">
                            <button
                              type="button"
                              onClick={() => setCampaignPane(x => ({ ...x, [campaign.id]: 'register' }))}
                              className={`shrink-0 px-3 py-2 rounded-lg text-[8px] font-black uppercase ${
                                pane === 'register'
                                  ? 'bg-zinc-950 text-white'
                                  : 'bg-white border border-slate-200 text-slate-500'
                              }`}
                            >
                              Registro del día
                            </button>

                            <button
                              type="button"
                              onClick={() => setCampaignPane(x => ({ ...x, [campaign.id]: 'log' }))}
                              className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[8px] font-black uppercase ${
                                pane === 'log'
                                  ? 'bg-indigo-600 text-white'
                                  : 'bg-white border border-slate-200 text-slate-500'
                              }`}
                            >
                              Bitácora de cambios
                              <span className={`px-1.5 py-0.5 rounded-full text-[6px] ${
                                pane === 'log' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                              }`}>
                                {campaignLogCount}
                              </span>
                            </button>
                          </div>

                          {pane === 'log' ? (
                            <CampaignChangeLogCC
                              campaign={campaign}
                              decisions={decisions}
                              ads={ads.filter(a => a.campaignId === campaign.id)}
                            />
                          ) : (
                            <CampaignDailyEditor
                              ownerUid={ownerUid}
                              date={date}
                              product={product}
                              campaign={campaign}
                              ads={ads.filter(a => a.campaignId === campaign.id)}
                              dailyCampaigns={dailyCampaigns}
                              dailyAds={dailyAds}
                              recommendations={recommendations}
                            />
                          )}
                        </div>
                      );
                    })()}
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
  const adsForDate = ads.filter(ad =>
    entityActiveOnDate(ad, date) &&
    entityActiveOnDate(campaign, date)
  );
  const existingCampaignRecord = dailyCampaigns.find(r => r.campaignId === campaign.id && r.date === date);
  const [editing, setEditing] = useState(!existingCampaignRecord);
  const [campaignForm, setCampaignForm] = useState({});
  const [adForms, setAdForms] = useState({});
  const [csvPreview, setCsvPreview] = useState(null);
  const [message, setMessage] = useState('');

  const previousBudgetRecord = useMemo(
    () => previousCampaignBudgetCC(dailyCampaigns, campaign.id, date),
    [dailyCampaigns, campaign.id, date]
  );

  useEffect(() => {
    const cRec = dailyCampaigns.find(r => r.campaignId === campaign.id && r.date === date);
    const recordedBudget = toNumber(cRec?.budget);
    const inheritedBudget = toNumber(previousBudgetRecord?.budget);
    setCampaignForm({
      budget: recordedBudget > 0 ? recordedBudget : (inheritedBudget > 0 ? inheritedBudget : ''), spend: cRec?.spend ?? '', purchases: cRec?.purchases ?? '',
      impressions: cRec?.impressions ?? '', clicks: cRec?.clicks ?? '',
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
  }, [date, campaign.id, dailyCampaigns, dailyAds, ads, previousBudgetRecord?.budget, previousBudgetRecord?.date]);

  const recordedBudgetForDay = toNumber(existingCampaignRecord?.budget);
  const previousBudgetValue = toNumber(previousBudgetRecord?.budget);
  const currentBudgetValue = toNumber(campaignForm.budget);
  const hasRecordedBudgetForDay = recordedBudgetForDay > 0;
  const isInheritedBudget = !hasRecordedBudgetForDay && previousBudgetValue > 0 && currentBudgetValue === previousBudgetValue;
  const isChangedFromInherited = !hasRecordedBudgetForDay && previousBudgetValue > 0 && currentBudgetValue > 0 && currentBudgetValue !== previousBudgetValue;
  const isExistingBudgetEdited = hasRecordedBudgetForDay && editing && currentBudgetValue > 0 && currentBudgetValue !== recordedBudgetForDay;
  const inheritedNeedsConfirmation = !!existingCampaignRecord && !hasRecordedBudgetForDay && isInheritedBudget;

  const save = async () => {
    const campaignRecordId = `${date}_${campaign.id}`;
    const budgetValueToSave = toNumber(campaignForm.budget);
    const budgetIsInherited = previousBudgetValue > 0 && budgetValueToSave === previousBudgetValue && !hasRecordedBudgetForDay;
    const budgetSourceToSave = budgetIsInherited
      ? 'inherited_previous'
      : (hasRecordedBudgetForDay && budgetValueToSave === recordedBudgetForDay
          ? (existingCampaignRecord?.budgetSource || 'registered')
          : 'manual');

    await setDoc(doc(db, COLLECTIONS.dailyCampaigns, campaignRecordId), {
      ownerUid, date, productId: product.id, campaignId: campaign.id,
      budget: budgetValueToSave,
      budgetSource: budgetSourceToSave,
      budgetInheritedFromDate: budgetIsInherited ? (previousBudgetRecord?.date || null) : null,
      budgetPreviousValue: previousBudgetValue > 0 ? previousBudgetValue : null,
      spend: toNumber(campaignForm.spend), purchases: toNumber(campaignForm.purchases),
      impressions: toNumber(campaignForm.impressions), clicks: toNumber(campaignForm.clicks),
      ctr: toNumber(campaignForm.ctr), cpc: toNumber(campaignForm.cpc), cpm: toNumber(campaignForm.cpm),
      frequency: toNumber(campaignForm.frequency), landingViews: toNumber(campaignForm.landingViews),
      atc: toNumber(campaignForm.atc), roas: toNumber(campaignForm.roas),
      source: 'manual',
      registrationTimezone: 'America/Bogota',
      updatedAtColombia: colombiaDateTimeStorageCC(),
      updatedAt: serverTimestamp()
    }, { merge: true });

    for (const ad of adsForDate) {
      const f = adForms[ad.id] || {};
      const hasAny = Object.values(f).some(v => v !== '' && v !== null && v !== undefined);
      if (!hasAny) continue;
      await setDoc(doc(db, COLLECTIONS.dailyAds, `${date}_${ad.id}`), {
        ownerUid, date, productId: product.id, campaignId: campaign.id, adId: ad.id,
        adName: ad.name, normalizedName: ad.normalizedName,
        spend: toNumber(f.spend), purchases: toNumber(f.purchases), impressions: toNumber(f.impressions), clicks: toNumber(f.clicks),
        ctr: toNumber(f.ctr), cpc: toNumber(f.cpc), cpm: toNumber(f.cpm), frequency: toNumber(f.frequency),
        landingViews: toNumber(f.landingViews), atc: toNumber(f.atc), roas: toNumber(f.roas),
        source: 'manual',
        registrationTimezone: 'America/Bogota',
        updatedAtColombia: colombiaDateTimeStorageCC(),
        updatedAt: serverTimestamp()
      }, { merge: true });
    }

    await detectBudgetChange({
      ownerUid, date, campaign, currentBudget: toNumber(campaignForm.budget),
      dailyCampaigns, recommendations
    });

    setEditing(false);
    setMessage(
      budgetIsInherited
        ? `Registro guardado · presupuesto heredado confirmado en ${fmtMoney(budgetValueToSave)}.`
        : existingCampaignRecord
          ? 'Registro actualizado sin duplicar.'
          : 'Registro guardado correctamente.'
    );
    setTimeout(() => setMessage(''), 2500);
  };

  const handleCsv = async file => {
    if (!file) return;
    const rows = parseCsvText(await file.text());
    setCsvPreview(parseMetaRows(rows, ads, date, campaign));
  };

  const applyCsv = async () => {
    if (!csvPreview) return;
    const conflicts = csvPreview.filter(x => x.status === 'conflict');
    if (conflicts.length) return alert('Hay nombres duplicados dentro del CSV. Debes resolverlos antes de importar.');

    const imported = [];
    for (const item of csvPreview) {
      // Protección crítica: un anuncio marcado como desactivado/pausado
      // en el CSV de Meta NO se crea y NO genera registro diario.
      if (item.status === 'ignored_inactive' || item.ignoredFromImport) continue;

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
        ...item.metrics,
        source: item.syntheticZero ? 'meta_csv_zero_fill' : 'meta_csv',
        metaOmittedNoDelivery: item.syntheticZero === true,
        registrationTimezone: 'America/Bogota',
        updatedAtColombia: colombiaDateTimeStorageCC(),
        updatedAt: serverTimestamp()
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
      const previousBudgetForImport = previousCampaignBudgetCC(dailyCampaigns, campaign.id, reportDate);
      const existingBudgetForImport = toNumber(existing?.budget);
      const visibleBudgetForSelectedDate = reportDate === date ? toNumber(campaignForm.budget) : 0;
      const budgetForImport = existingBudgetForImport > 0
        ? existingBudgetForImport
        : visibleBudgetForSelectedDate > 0
          ? visibleBudgetForSelectedDate
          : toNumber(previousBudgetForImport?.budget);
      const inheritedImportBudget = existingBudgetForImport <= 0 &&
        previousBudgetForImport?.budget > 0 &&
        budgetForImport === toNumber(previousBudgetForImport.budget);

      await setDoc(doc(db, COLLECTIONS.dailyCampaigns, `${reportDate}_${campaign.id}`), {
        ownerUid, date: reportDate, productId: product.id, campaignId: campaign.id,
        budget: budgetForImport,
        budgetSource: inheritedImportBudget ? 'inherited_previous' : (existing?.budgetSource || 'manual'),
        budgetInheritedFromDate: inheritedImportBudget ? previousBudgetForImport?.date || null : null,
        budgetPreviousValue: previousBudgetForImport?.budget || null,
        spend: agg.spend, purchases: agg.purchases, impressions: agg.impressions, clicks: agg.clicks,
        ctr: agg.ctr, cpc: agg.cpc, cpm: agg.cpm,
        frequency: agg.frequency, landingViews: agg.landingViews, atc: agg.atc, roas: agg.roas,
        source: 'meta_csv_aggregate',
        registrationTimezone: 'America/Bogota',
        updatedAtColombia: colombiaDateTimeStorageCC(),
        updatedAt: serverTimestamp()
      }, { merge: true });
    }

    await addDoc(collection(db, COLLECTIONS.imports), {
      ownerUid, productId: product.id, campaignId: campaign.id,
      requestedDate: date,
      rows: imported.length,
      newAds: csvPreview.filter(x => x.status === 'new').length,
      existingAds: csvPreview.filter(x => x.status === 'existing').length,
      zeroFilledAds: csvPreview.filter(x => x.status === 'zero_fill').length,
      ignoredInactiveAds: csvPreview.filter(x => x.status === 'ignored_inactive').length,
      registrationTimezone: 'America/Bogota',
      importedAtColombia: colombiaDateTimeStorageCC(),
      importedAt: serverTimestamp()
    });

    const zeroFilledCount = imported.filter(x => x.status === 'zero_fill').length;
    const ignoredInactiveCount = csvPreview.filter(x => x.status === 'ignored_inactive').length;
    const metaRowsCount = imported.length - zeroFilledCount;
    setCsvPreview(null);
    setMessage(
      `CSV importado: ${metaRowsCount} anuncio(s) procesados` +
      `${zeroFilledCount > 0 ? ` + ${zeroFilledCount} activo(s) sin entrega guardados en cero` : ''}` +
      `${ignoredInactiveCount > 0 ? ` · ${ignoredInactiveCount} desactivado(s) o fuera de vigencia ignorados y NO registrados` : ''}.`
    );
    setTimeout(() => setMessage(''), 4000);
  };

  const included = entityActiveOnDate(campaign, date);

  return <div className="cc-daily-editor p-3 sm:p-4 space-y-4 bg-white">
    <div className={`rounded-xl p-3 border ${included ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-200'}`}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
        <div>
          <p className="text-[9px] font-black uppercase">{existingCampaignRecord ? 'Registro existente' : 'Nuevo registro'}</p>
          <p className="text-[8px] text-slate-500 mt-1">{existingCampaignRecord ? 'Para evitar duplicados, primero debes presionar Editar. Al guardar se actualiza el documento existente.' : 'Completa manualmente o importa el CSV de Meta.'}</p>
        </div>
        {existingCampaignRecord && !editing && <button onClick={() => setEditing(true)} className="bg-amber-500 text-white px-3 py-2 rounded-xl text-[9px] font-black uppercase flex items-center gap-1"><Pencil size={12}/> Editar</button>}
      </div>
    </div>

    <div className="rounded-2xl p-3 bg-indigo-50/50" style={{border:'1px solid #c7d2fe'}}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">
        <div><p className="font-black text-xs uppercase text-indigo-800">Importar CSV de Meta Ads</p><p className="text-[8px] text-slate-400 mt-1">El archivo se aplica solo a {campaign.name}. Matching por nombre normalizado; nunca por ID de Meta. Los anuncios activos que Meta omita por no tener entrega se completan automáticamente en 0. Si el CSV marca un anuncio como desactivado/pausado, se ignora y NO se crea en la plataforma.</p></div>
        <label className="cursor-pointer bg-zinc-950 text-white px-3 py-2 rounded-xl text-[9px] font-black uppercase flex items-center gap-2"><FileUp size={13}/> Seleccionar CSV<input type="file" accept=".csv,text/csv" className="hidden" onChange={e => handleCsv(e.target.files?.[0])}/></label>
      </div>
      {csvPreview && <CsvPreview rows={csvPreview} onApply={applyCsv}/>}
    </div>

    <div className="rounded-2xl p-3 bg-blue-50/40" style={{border:'1px solid #bfdbfe'}}>
      <p className="font-black text-xs uppercase mb-3 text-blue-800">Métricas generales de campaña</p>

      <div className={`rounded-xl border p-3 mb-3 ${
        isExistingBudgetEdited || isChangedFromInherited
          ? 'bg-blue-50 border-blue-200'
          : hasRecordedBudgetForDay
            ? 'bg-emerald-50 border-emerald-200'
            : isInheritedBudget
              ? 'bg-amber-50 border-amber-200'
              : 'bg-slate-50 border-slate-200'
      }`}>
        {isExistingBudgetEdited ? <>
          <p className="text-[9px] font-black uppercase text-blue-700">Presupuesto modificado · pendiente de guardar</p>
          <p className="text-[8px] text-blue-600 mt-1">
            Registrado para este día: <strong>{fmtMoney(recordedBudgetForDay)}</strong> → nuevo valor: <strong>{fmtMoney(currentBudgetValue)}</strong>.
          </p>
        </> : isChangedFromInherited ? <>
          <p className="text-[9px] font-black uppercase text-blue-700">Presupuesto actualizado para este día</p>
          <p className="text-[8px] text-blue-600 mt-1">
            Presupuesto anterior: <strong>{fmtMoney(previousBudgetValue)}</strong> ({previousBudgetRecord?.date || '—'}) → nuevo: <strong>{fmtMoney(currentBudgetValue)}</strong>. Al guardar quedará registrado el cambio.
          </p>
        </> : hasRecordedBudgetForDay ? <>
          <p className="text-[9px] font-black uppercase text-emerald-700">Presupuesto registrado para este día</p>
          <p className="text-[8px] text-emerald-600 mt-1">
            Este registro ya tiene <strong>{fmtMoney(recordedBudgetForDay)}</strong> como presupuesto. Si Meta cambió el presupuesto, presiona Editar y actualízalo.
          </p>
        </> : isInheritedBudget ? <>
          <p className="text-[9px] font-black uppercase text-amber-700">Presupuesto heredado del registro anterior</p>
          <p className="text-[8px] text-amber-700 mt-1">
            Se precargó <strong>{fmtMoney(previousBudgetValue)}</strong>, último presupuesto registrado el <strong>{previousBudgetRecord?.date || '—'}</strong>. Verifica si continúa igual antes de guardar.
          </p>
          {inheritedNeedsConfirmation && <p className="text-[8px] font-black text-amber-800 mt-1">Este día existía sin presupuesto confirmado. Presiona Editar y Guardar para confirmarlo.</p>}
        </> : <>
          <p className="text-[9px] font-black uppercase text-slate-600">Sin presupuesto anterior</p>
          <p className="text-[8px] text-slate-500 mt-1">No encontramos un presupuesto registrado antes de esta fecha. Ingresa el presupuesto de Meta para este día.</p>
        </>}
      </div>

      <MetricForm form={campaignForm} setForm={setCampaignForm} includeBudget disabled={!editing}/>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
        <MiniCard label="CPA calculado" value={fmtCpa(calcCpa(campaignForm.spend, campaignForm.purchases))}/>
        <MiniCard label="Visita → ATC" value={`${fmtNum(safeRate(campaignForm.atc, campaignForm.landingViews), 2)}%`}/>
        <MiniCard label="Visita → Compra" value={`${fmtNum(safeRate(campaignForm.purchases, campaignForm.landingViews), 2)}%`}/>
        <MiniCard label="ATC → Compra" value={`${fmtNum(safeRate(campaignForm.purchases, campaignForm.atc), 2)}%`}/>
      </div>
    </div>

    <div className="rounded-2xl p-3 bg-emerald-50/40" style={{border:'1px solid #a7f3d0'}}>
      <p className="font-black text-xs uppercase mb-3 text-emerald-800">Anuncios de la campaña</p>
      {adsForDate.length === 0 ? <EmptyState>No hay anuncios activos para esta fecha. Los anuncios apagados/eliminados se consultan en la Bitácora de cambios.</EmptyState> :
        <div className="space-y-3">{adsForDate.map(ad => {
          const f = adForms[ad.id] || {};
          const activeThisDate = entityActiveOnDate(ad, date) && entityActiveOnDate(campaign, date);
          const adAccent = ccVisualAccent(ad.id || ad.name, 4);
          return <div
            key={ad.id}
            className={`rounded-2xl p-3 ${activeThisDate ? '' : 'opacity-75'}`}
            style={{
              border: `1px solid ${adAccent.border}`,
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
              <div className="text-right"><p className="text-[8px] font-black uppercase text-slate-400">CPA</p><p className="font-black">{fmtCpa(calcCpa(f.spend, f.purchases))}</p></div>
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
  const [campaignForm, setCampaignForm] = useState({ budget: '', spend: '', purchases: '', impressions: '', clicks: '', ctr: '', cpc: '', cpm: '', frequency: '', landingViews: '', atc: '', roas: '' });
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
      setCampaignForm({ budget: '', spend: '', purchases: '', impressions: '', clicks: '', ctr: '', cpc: '', cpm: '', frequency: '', landingViews: '', atc: '', roas: '' });
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
    const parsed = parseMetaRows(rows, campaignAds, date, selectedCampaign);
    setCsvPreview(parsed);
  };

  const applyCsv = async () => {
    if (!csvPreview || !selectedCampaign) return;
    if (csvPreview.some(x => x.status === 'conflict')) return alert('Hay nombres duplicados dentro del CSV. Resuelve el conflicto antes de importar.');
    const imported = [];

    for (const item of csvPreview) {
      // Protección crítica: un anuncio marcado como desactivado/pausado
      // en el CSV de Meta NO se crea y NO genera registro diario.
      if (item.status === 'ignored_inactive' || item.ignoredFromImport) continue;

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
        spend: agg.spend, purchases: agg.purchases, impressions: agg.impressions, clicks: agg.clicks,
        ctr: agg.ctr, cpc: agg.cpc, cpm: agg.cpm,
        frequency: agg.frequency, landingViews: agg.landingViews, atc: agg.atc, roas: agg.roas,
        source: 'meta_csv_aggregate', updatedAt: serverTimestamp()
      }, { merge: true });
    }

    const ignoredInactiveCount = csvPreview.filter(x => x.status === 'ignored_inactive').length;
    setSavedMessage(
      `CSV importado: ${imported.length} anuncio(s) procesados` +
      `${ignoredInactiveCount > 0 ? ` · ${ignoredInactiveCount} desactivado(s) en Meta ignorados y NO creados` : ''}.`
    );
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
            <MiniCard label="CPA calculado" value={fmtCpa(calcCpa(campaignForm.spend, campaignForm.purchases))} />
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
              <div className="flex items-center justify-between mb-3"><div><p className="font-black text-xs">{ad.name}</p><p className="text-[8px] text-slate-400">{ad.active === false ? 'OFF · el registro no cambia su estado' : 'ON'}</p></div><div className="text-right"><p className="text-[8px] uppercase font-black text-slate-400">CPA</p><p className="font-black text-sm">{fmtCpa(calcCpa(f.spend, f.purchases))}</p></div></div>
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
    ['spend', 'Gasto'], ['purchases', 'Compras'], ['impressions', 'Impresiones'], ['clicks', 'Clics enlace'],
    ['ctr', 'CTR %'], ['cpc', 'CPC'], ['cpm', 'CPM'], ['frequency', 'Frecuencia'],
    ['landingViews', 'Visitas landing'], ['atc', 'ATC'], ['roas', 'ROAS']
  ];
  const update = (key, value) => {
    if (disabled) return;
    setForm(prev => ({ ...(prev || {}), [key]: value }));
  };
  return (
    <div className="cc-metric-form cc-grid-form">
      {fields.map(([key, label]) => (
        <div key={key} className="min-w-0">
          <p className="text-[7px] sm:text-[8px] font-black uppercase leading-tight text-slate-400 mb-1" style={{ overflowWrap: 'break-word', wordBreak: 'normal' }}>
            {label}
          </p>
          <input
            disabled={disabled}
            type="number"
            step="any"
            value={form?.[key] ?? ''}
            onChange={e => update(key, e.target.value)}
            className="w-full min-w-0 bg-slate-50 border border-transparent focus:border-emerald-300 rounded-xl px-2.5 py-2 text-[11px] sm:text-xs font-bold outline-none disabled:opacity-60 disabled:bg-slate-100"
          />
        </div>
      ))}
    </div>
  );
}

function CsvPreview({ rows, onApply }) {
  const existing = rows.filter(r => r.status === 'existing').length;
  const news = rows.filter(r => r.status === 'new').length;
  const zeroFilled = rows.filter(r => r.status === 'zero_fill').length;
  const ignoredInactive = rows.filter(r => r.status === 'ignored_inactive').length;
  const conflicts = rows.filter(r => r.status === 'conflict').length;

  return <div className="space-y-3 rounded-2xl p-3 sm:p-4 bg-amber-50/50" style={{border:'1px solid #f59e0b'}}>
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2.5">
      <MiniCard label="Existentes Meta" value={existing} tone="good" />
      <MiniCard label="Nuevos" value={news} />
      <MiniCard label="Activos sin entrega → 0" value={zeroFilled} tone={zeroFilled ? 'default' : 'good'} />
      <MiniCard label="Desactivados ignorados" value={ignoredInactive} tone={ignoredInactive ? 'default' : 'good'} />
      <MiniCard label="Conflictos" value={conflicts} tone={conflicts ? 'bad' : 'default'} />
    </div>

    {zeroFilled > 0 && (
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
        <p className="text-[9px] font-black uppercase text-blue-700">Meta omitió {zeroFilled} anuncio(s) activo(s) sin entrega</p>
        <p className="text-[8px] text-blue-600 mt-1">
          El sistema los agregará automáticamente para ese día con gasto, impresiones, clics, compras y demás métricas en 0.
          Esto permite que el día exista en el histórico del anuncio. Los anuncios OFF no se completan con ceros.
        </p>
      </div>
    )}

    {ignoredInactive > 0 && (
      <div className="rounded-xl border border-slate-300 bg-slate-50 p-3">
        <p className="text-[9px] font-black uppercase text-slate-700">Desactivados en Meta: {ignoredInactive}</p>
        <p className="text-[8px] text-slate-600 mt-1">
          Estas filas se muestran solo para control. Al importar no se crea el anuncio, no se guarda un registro diario y no entra al agregado de campaña.
        </p>
      </div>
    )}

    {rows.some(r => r.status !== 'ignored_inactive' && r.metrics.purchases > 0 && (!r.metrics.landingViewsDataAvailable || r.metrics.landingViews <= 0)) && (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
        <p className="text-[9px] font-black uppercase text-rose-700">Advertencia · faltan datos post-clic en el CSV</p>
        <p className="text-[8px] text-rose-600 mt-1">
          Hay filas con compras pero sin Visitas landing. Se importarán las métricas disponibles, pero el embudo quedará marcado como incompleto y NO como estable.
        </p>
      </div>
    )}

    <div className="overflow-x-auto overscroll-x-contain">
      <table className="w-full min-w-[900px] text-[10px]">
        <thead>
          <tr className="text-left text-[8px] uppercase text-slate-400">
            <th>Anuncio</th><th>Estado</th><th>Fecha</th><th>Gasto</th><th>Compras</th><th>Clics</th><th>Hook</th><th>Hold</th><th>Landing</th><th>C→Landing</th><th>ATC</th><th>CTR</th><th>CPC</th><th>CPM</th><th>Frec.</th><th>ROAS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => <tr
            key={`${r.reportDate}-${r.normalizedName}-${i}`}
            className={`border-t ${
              r.status === 'zero_fill'
                ? 'bg-blue-50/70'
                : r.status === 'ignored_inactive'
                  ? 'bg-slate-100/80 opacity-70'
                  : ''
            }`}
          >
            <td className="py-2 font-black">{r.adName}</td>
            <td className={`font-black ${
              r.status === 'conflict' ? 'text-rose-600' :
              r.status === 'new' ? 'text-amber-600' :
              r.status === 'zero_fill' ? 'text-blue-600' :
              r.status === 'ignored_inactive' ? 'text-slate-500' :
              'text-emerald-600'
            }`}>
              {r.status === 'existing'
                ? 'Reportado por Meta'
                : r.status === 'new'
                  ? 'Nuevo anuncio'
                  : r.status === 'zero_fill'
                    ? 'Activo · Meta sin entrega → 0'
                    : r.status === 'ignored_inactive'
                      ? `Ignorado · desactivado en Meta${r.deliveryRaw ? ` (${r.deliveryRaw})` : ''}`
                      : 'Conflicto'}
            </td>
            <td>{r.reportDate}</td>
            <td>{fmtMoney(r.metrics.spend)}</td>
            <td>{fmtNum(r.metrics.purchases, 2)}</td>
            <td>{r.metrics.clicksDataAvailable ? fmtNum(r.metrics.clicks, 2) : '—'}</td>
            <td>{r.metrics.videoMetricAvailable && r.metrics.hookRateDataAvailable ? fmtRate(r.metrics.hookRate) : '—'}</td>
            <td>{r.metrics.videoMetricAvailable && r.metrics.holdRateDataAvailable ? fmtRate(r.metrics.holdRate) : '—'}</td>
            <td className={r.metrics.purchases > 0 && (!r.metrics.landingViewsDataAvailable || r.metrics.landingViews <= 0) ? 'font-black text-rose-600' : ''}>
              {r.metrics.landingViewsDataAvailable ? fmtNum(r.metrics.landingViews, 2) : '—'}
            </td>
            <td>{r.metrics.clicksDataAvailable && r.metrics.landingViewsDataAvailable ? fmtRate(safeRate(r.metrics.landingViews, r.metrics.clicks)) : '—'}</td>
            <td className={r.metrics.purchases > 0 && (!r.metrics.atcDataAvailable || r.metrics.atc <= 0) ? 'font-black text-rose-600' : ''}>
              {r.metrics.atcDataAvailable ? fmtNum(r.metrics.atc, 2) : '—'}
            </td>
            <td>{fmtNum(r.metrics.ctr, 2)}%</td>
            <td>{fmtMoney(r.metrics.cpc)}</td>
            <td>{fmtMoney(r.metrics.cpm)}</td>
            <td>{fmtNum(r.metrics.frequency, 2)}</td>
            <td>{fmtNum(r.metrics.roas, 2)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>

    <button
      onClick={onApply}
      disabled={conflicts > 0}
      className="bg-zinc-950 text-white px-4 py-2.5 rounded-xl text-[9px] font-black uppercase disabled:opacity-30"
    >
      Importar válidos · ignorar desactivados
    </button>
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
  const changePct = ((currentBudget - previousBudget) / previousBudget) * 100;
  const safeScale = changePct > 0 && changePct <= CAMPAIGN_CHANGE_RULES_CC.maxSafeScalePct;
  const safetyHours = safeScale
    ? CAMPAIGN_CHANGE_RULES_CC.safeScaleHours
    : CAMPAIGN_CHANGE_RULES_CC.structuralHours;

  await setDoc(doc(db, COLLECTIONS.budgetChanges, `${campaign.id}_${date}`), {
    ownerUid,
    productId: campaign.productId,
    campaignId: campaign.id,
    date,
    previousBudget,
    newBudget: currentBudget,
    changePct,
    origin,
    recommendationId: recommendation?.id || null,
    changeType: safeScale ? 'budget_scale_safe' : 'budget_change_major',
    safetyHours,
    ruleMaxScalePct: CAMPAIGN_CHANGE_RULES_CC.maxSafeScalePct,
    clientRecordedAtMs: Date.now(),
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
    detail: `${fmtMoney(previousBudget)} → ${fmtMoney(currentBudget)} (${changePct > 0 ? '+' : ''}${fmtNum(changePct, 2)}%)`,
    changeType: safeScale ? 'budget_scale_safe' : 'budget_change_major',
    safetyHours,
    clientRecordedAtMs: Date.now(),
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
    { id: 'campaignControl', icon: BarChart3, label: 'Lectura de Campañas' }
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
      <main style={{ maxWidth: activeTab === 'campaignControl' ? '96rem' : '72rem', margin: '0 auto', padding: '1rem 1rem 3rem' }}>
        {activeTab === 'dashboard' && <VistaDashboard configs={configs} months={months} />}
        {activeTab === 'records' && <VistaRegistro configs={configs} months={months} activeTab={activeTab} />}
        {activeTab === 'config' && <VistaConfig configs={configs} />}
        {activeTab === 'agenda' && <AgendaModule />}
        {activeTab === 'campaignControl' && <CampaignControlModule />}
      </main>
    </div>
  );
}
