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
  Coffee, Moon, Award, ListChecks, CalendarDays, Power, PowerOff
} from 'lucide-react';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import Login from './src/components/Login';
import { db } from './src/firebase';

// ─── HELPERS CON ZONA HORARIA COLOMBIA ────────────────────────────────────────
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
  <div className={`p-3 md:p-4 rounded-2xl ${accent ? 'bg-emerald-500 text-white' : highlight ? 'bg-blue-50 border border-blue-100' : dark ? 'bg-zinc-800' : 'bg-slate-50'}`}>
    <p className={`text-[9px] font-black uppercase tracking-widest mb-1 ${accent ? 'text-emerald-100' : highlight ? 'text-blue-500' : dark ? 'text-zinc-500' : 'text-slate-400'}`}>{label}</p>
    <p className={`font-black font-mono leading-none ${big ? 'text-xl md:text-2xl' : 'text-base md:text-lg'} ${accent ? 'text-white' : highlight ? 'text-blue-700' : dark ? 'text-white' : 'text-slate-900'}`}>{value}</p>
    {sub && <p className={`text-[9px] mt-1 font-semibold ${accent ? 'text-emerald-100' : highlight ? 'text-blue-400' : dark ? 'text-zinc-500' : 'text-slate-400'}`}>{sub}</p>}
  </div>
);

// ─── VISTA 1: CONFIGURACIÓN (con interruptor de producto activo/inactivo) ─────
const EMPTY_CONFIG = {
  vendedora: '', productName: '',
  targetProfit: '', productCost: '', freight: '', fulfillment: '',
  commission: '', returnRate: '20', effectiveness: '95',
  fixedCosts: '', priceSingle: '', dailyAdSpend: '', fixedAdSpend: true,
  extraUnitCharge: '',
  cpaEquilibrio: '',
  activo: true,
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

  const openNew = () => { setEditId(null); setForm(EMPTY_CONFIG); setShowForm(true); };
  const openNewForVendor = (vendedora) => {
    setEditId(null);
    setForm({ ...EMPTY_CONFIG, vendedora });
    setExpandedV(x => ({ ...x, [vendedora]: true }));
    setShowForm(true);
  };
  const openEdit = (p) => { setEditId(p.id); setForm({ ...p }); setShowForm(true); };
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.vendedora.trim() || !form.productName.trim()) return;
    const data = { ...form };
    
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
    <div className="space-y-8 anim-fade">
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-black italic uppercase tracking-tighter">Estrategias</h2>
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest">Módulo 1 · Vendedoras y Productos</p>
        </div>
        <button onClick={openNew} className="flex items-center gap-2 bg-zinc-950 text-white px-4 md:px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-zinc-800"><Plus size={16} /> Nueva Vendedora + Producto</button>
      </div>
      {Object.keys(grouped).length === 0 ? (
        <Card className="text-center py-16 text-slate-300"><Users size={48} className="mx-auto mb-4 opacity-30" /><p className="font-black uppercase text-sm">Sin estrategias aún</p></Card>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([vendedora, productos]) => (
            <Card key={vendedora} className="overflow-hidden p-0">
              <div className="flex items-center justify-between gap-3 p-4 md:p-5 bg-white">
                <div onClick={() => toggleV(vendedora)} className="flex-1 flex items-center gap-3 cursor-pointer">
                  <div className="w-8 h-8 md:w-10 md:h-10 rounded-2xl bg-emerald-500 flex items-center justify-center text-white font-black text-sm shrink-0">{vendedora[0]?.toUpperCase()}</div>
                  <div><p className="font-black text-xs md:text-sm uppercase">{vendedora}</p><p className="text-[10px] text-slate-400 font-semibold">{productos.length} productos</p></div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={(e) => { e.stopPropagation(); openNewForVendor(vendedora); }} className="flex items-center gap-1 bg-emerald-500 text-zinc-950 px-3 py-2 rounded-xl font-black text-[9px] uppercase"><Plus size={12} /> Producto</button>
                  <button onClick={() => toggleV(vendedora)} className="p-1 rounded-xl hover:bg-slate-100">{expandedV[vendedora] ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
                </div>
              </div>
              {expandedV[vendedora] && (
                <div className="border-t divide-y">
                  {productos.map(p => {
                    const isActive = p.activo !== false;
                    return (
                      <div key={p.id} className={`p-4 md:p-5 flex flex-col sm:flex-row sm:items-center gap-3 ${!isActive ? 'bg-slate-100 opacity-70' : ''}`}>
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <p className={`font-black uppercase text-xs md:text-sm ${!isActive ? 'text-slate-500 line-through' : 'text-emerald-600'}`}>{p.productName}</p>
                            {!isActive && <span className="text-[9px] font-black bg-red-100 text-red-600 px-2 py-0.5 rounded-full"><PowerOff size={10} /> INACTIVO</span>}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            <span className="text-[8px] font-black bg-slate-100 px-2 py-1 rounded-full">EFF {p.effectiveness}%</span>
                            <span className="text-[8px] font-black bg-rose-100 px-2 py-1 rounded-full">DEV {p.returnRate}%</span>
                            <span className="text-[8px] font-black bg-emerald-100 px-2 py-1 rounded-full">Meta {fmt(p.targetProfit)}</span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => openEdit(p)} className="p-2 rounded-xl hover:bg-emerald-50"><Pencil size={14} /></button>
                          <button onClick={() => remove(p.id)} className="p-2 rounded-xl hover:bg-rose-50"><Trash2 size={14} /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      {showForm && (
        <div className="fixed inset-0 bg-zinc-950/90 backdrop-blur-xl flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-3xl rounded-3xl p-4 md:p-8 max-h-[92vh] overflow-y-auto shadow-2xl">
            <div className="flex justify-between items-center mb-6 pb-4 border-b">
              <div><h3 className="text-xl md:text-2xl font-black italic uppercase">{editId ? 'Editar' : 'Nueva'} Estrategia</h3></div>
              <button onClick={() => setShowForm(false)} className="p-2 rounded-xl hover:bg-slate-100"><X size={20} /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InputField label="Nombre Vendedora" value={form.vendedora} onChange={e => setField('vendedora', e.target.value)} placeholder="Ej: CAMILA PEREIRA" />
              <InputField label="Nombre Producto" value={form.productName} onChange={e => setField('productName', e.target.value)} placeholder="Ej: CEPILLO PRO X2" />
              
              <div className="bg-zinc-950 text-white p-4 rounded-2xl flex items-center justify-between col-span-2">
                <div className="flex items-center gap-3">
                  {form.activo ? <Power size={18} className="text-emerald-400" /> : <PowerOff size={18} className="text-red-400" />}
                  <div><p className="text-[10px] font-black uppercase">Estado del Producto</p></div>
                </div>
                <button onClick={() => setField('activo', !form.activo)} className="flex items-center gap-2 text-[9px] font-black uppercase">
                  {form.activo ? <><ToggleRight size={28} className="text-emerald-400" /><span>ACTIVO</span></> : <><ToggleLeft size={28} className="text-red-400" /><span>INACTIVO</span></>}
                </button>
              </div>

              <div className="bg-emerald-50 p-4 rounded-2xl"><Label>% Efectividad</Label><input type="number" value={form.effectiveness} onChange={e => setField('effectiveness', e.target.value)} className="w-full bg-transparent font-black text-3xl outline-none" /></div>
              <div className="bg-rose-50 p-4 rounded-2xl"><Label>% Devolución</Label><input type="number" value={form.returnRate} onChange={e => setField('returnRate', e.target.value)} className="w-full bg-transparent font-black text-3xl outline-none" /></div>
              <InputField label="Precio de Venta" type="number" value={form.priceSingle} onChange={e => setField('priceSingle', e.target.value)} placeholder="79000" />
              <InputField label="Costo Unitario" type="number" value={form.productCost} onChange={e => setField('productCost', e.target.value)} placeholder="18000" />
              <InputField label="Flete Base" type="number" value={form.freight} onChange={e => setField('freight', e.target.value)} placeholder="9500" />
              <InputField label="Comisión por Entrega" type="number" value={form.commission} onChange={e => setField('commission', e.target.value)} placeholder="3000" />
              <InputField label="Meta de Utilidad Mensual" type="number" value={form.targetProfit} onChange={e => setField('targetProfit', e.target.value)} placeholder="4000000" />
              <InputField label="CPA Equilibrio" type="number" value={form.cpaEquilibrio} onChange={e => setField('cpaEquilibrio', e.target.value)} placeholder="15000" />
              <div className="bg-zinc-950 text-white p-4 rounded-2xl space-y-2 col-span-2">
                <div className="flex justify-between items-center"><Label>Inversión Ads Diaria</Label>
                  <button onClick={() => setField('fixedAdSpend', !form.fixedAdSpend)} className="flex items-center gap-1 text-[9px] font-black uppercase">
                    {form.fixedAdSpend ? <><ToggleRight size={22} className="text-emerald-400" /><span>FIJA</span></> : <><ToggleLeft size={22} /><span>MANUAL</span></>}
                  </button>
                </div>
                <input type="number" value={form.dailyAdSpend} onChange={e => setField('dailyAdSpend', e.target.value)} placeholder="$ 0" className="w-full bg-transparent text-emerald-400 font-black text-2xl outline-none" />
              </div>
              {form.priceSingle && form.productCost && (
                <div className={`col-span-2 p-4 rounded-2xl border-2 ${previewProfit >= 0 ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'}`}>
                  <p className="text-[10px] font-black uppercase">Preview Utilidad Estimada</p>
                  <p className={`text-2xl font-black font-mono ${previewProfit >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{fmt(previewProfit)}</p>
                </div>
              )}
            </div>
            <button onClick={save} className="w-full mt-6 bg-emerald-500 text-zinc-950 py-4 rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-emerald-400"><Save size={18} /> Guardar</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── VISTA 2: REGISTRO DIARIO (con control de omisiones) ─────────────────────
function VistaRegistro({ configs, months }) {
  const [selectedDate, setSelectedDate] = useState(todayColombia());
  const [selectedVendor, setSelectedVendor] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [form, setForm] = useState({ orders: '', units: '', revenue: '', adSpend: '', restDay: false });
  const [editingRec, setEditingRec] = useState(null);
  const [savedMsg, setSavedMsg] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const grouped = useMemo(() => configs.reduce((a, c) => {
    if (!a[c.vendedora]) a[c.vendedora] = [];
    a[c.vendedora].push(c);
    return a;
  }, {}), [configs]);
  const vendors = useMemo(() => Object.keys(grouped).sort(), [grouped]);
  const productsOfVendor = useMemo(() => selectedVendor ? grouped[selectedVendor] || [] : [], [selectedVendor, grouped]);
  const selectedConfig = useMemo(() => selectedProductId ? configs.find(c => c.id === selectedProductId) : null, [selectedProductId, configs]);

  const monthId = selectedDate.substring(0, 7);
  const monthDoc = months.find(m => m.id === monthId);
  const dayRecords = useMemo(() => (monthDoc?.records || []).filter(r => r.date === selectedDate), [monthDoc, selectedDate]);

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
        setErrorMsg(`❌ Ya existe un registro para ${config?.vendedora} - ${config?.productName} en esta fecha.`);
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
        alert("Completa todos los campos obligatorios o activa 'Día de descanso'.");
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
  const extraUnitCharge = parseFloat(selectedConfig?.extraUnitCharge) || 0;
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
    <div className="max-w-2xl mx-auto space-y-6">
      <div><h2 className="text-2xl md:text-3xl font-black italic uppercase">Cierre Diario</h2><p className="text-xs text-slate-400 font-black uppercase">Módulo 2 · Registro de Operación</p></div>

      {ultimoDia && (
        <div className={`rounded-2xl p-3 md:p-4 border-l-8 shadow-sm ${diferenciaDias > 1 ? 'bg-amber-50 border-amber-400' : 'bg-blue-50 border-blue-400'}`}>
          <div className="flex flex-col md:flex-row justify-between gap-3">
            <div className="flex gap-3">
              <CalendarDays size={18} />
              <div>
                <p className="text-[9px] font-black uppercase opacity-70">Último día registrado</p>
                <p className="font-black text-xs md:text-base">{parseColombiaDate(ultimoDia).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
                <p className="text-[8px] font-semibold mt-1">
                  {diferenciaDias === 0 && '✅ Hoy ya hay actividad.'}
                  {diferenciaDias === 1 && '⚠️ Ayer fue el último día.'}
                  {diferenciaDias > 1 && `❗ Han pasado ${diferenciaDias} días sin registrar.`}
                </p>
              </div>
            </div>
            {diasFaltantes.length > 0 && (
              <div className="bg-white/80 rounded-xl p-2 max-h-32 overflow-y-auto text-[10px]">
                <p className="font-black uppercase text-[8px] flex items-center gap-1"><ListChecks size={10} /> Días sin registrar:</p>
                <ul className="mt-1">
                  {diasFaltantes.slice(0, 4).map(d => <li key={d.fecha} className="text-[9px]">📅 {d.nombre}</li>)}
                  {diasFaltantes.length > 4 && <li className="text-[8px] text-amber-600">... y más</li>}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      <Card className={`space-y-4 ${editingRec ? 'border-2 border-amber-400' : ''}`}>
        {editingRec && <div className="flex items-center gap-2 text-amber-600 text-[10px] font-black bg-amber-50 p-2 rounded-xl"><Pencil size={12} /> Editando · <button onClick={cancelEdit} className="underline ml-auto">Cancelar</button></div>}
        {errorMsg && <div className="bg-rose-50 text-rose-600 p-2 rounded-xl text-[10px]"><AlertTriangle size={12} /> {errorMsg}</div>}

        <div className="bg-zinc-950 p-3 rounded-2xl text-white space-y-3">
          <div className="flex gap-2"><Calendar size={16} className="text-emerald-400" /><div><p className="text-[8px] font-black text-zinc-500 uppercase">Fecha del Registro (Hora Colombia)</p></div></div>
          <div className="space-y-2">
            <input type="date" value={selectedDate} onChange={(e) => { setSelectedDate(e.target.value); setEditingRec(null); setSelectedVendor(''); setSelectedProductId(''); setForm({ orders: '', units: '', revenue: '', adSpend: '', restDay: false }); }} className="w-full bg-white text-zinc-950 font-black text-sm rounded-xl p-2 border-2 border-emerald-400" />
            <div className="grid grid-cols-3 gap-1">
              <button onClick={() => moveDate(-1)} className="bg-white/10 text-emerald-400 p-1.5 rounded-xl text-[9px] font-black">Ayer</button>
              <button onClick={() => { setSelectedDate(todayColombia()); setEditingRec(null); setSelectedVendor(''); setSelectedProductId(''); setForm({ orders: '', units: '', revenue: '', adSpend: '', restDay: false }); }} className="bg-emerald-500 text-zinc-950 p-1.5 rounded-xl text-[9px] font-black">Hoy</button>
              <button onClick={() => moveDate(1)} className="bg-white/10 text-emerald-400 p-1.5 rounded-xl text-[9px] font-black">Mañana</button>
            </div>
          </div>
        </div>

        <div className={`rounded-xl p-3 flex justify-between ${form.restDay ? 'bg-amber-100' : 'bg-slate-100'}`}>
          <div className="flex gap-2"><Coffee size={16} /><div><p className="text-[9px] font-black uppercase">Día de descanso</p></div></div>
          <button onClick={() => setFormField('restDay', !form.restDay)} className="text-[8px] font-black">
            {form.restDay ? <><ToggleRight size={22} className="text-amber-500" /> DESCANSO</> : <><ToggleLeft size={22} /> Activo</>}
          </button>
        </div>

        <div><Label>Vendedora</Label>
          <select value={selectedVendor} onChange={(e) => handleVendorChange(e.target.value)} disabled={!!editingRec} className="w-full p-2.5 rounded-xl bg-slate-50 text-sm">
            <option value="">Seleccionar vendedora...</option>
            {vendors.map(v => <option key={v} value={v}>{v.toUpperCase()}</option>)}
          </select>
        </div>

        <div><Label>Producto</Label>
          <select value={selectedProductId} onChange={(e) => handleProductChange(e.target.value)} disabled={!selectedVendor || !!editingRec} className="w-full p-2.5 rounded-xl bg-slate-50 text-sm">
            <option value="">Seleccionar producto...</option>
            {productsOfVendor.map(p => <option key={p.id} value={p.id}>{p.productName}</option>)}
          </select>
        </div>

        {selectedConfig && !selectedConfig.fixedAdSpend && (
          <div className="bg-zinc-950 text-white p-3 rounded-xl"><Label>Inversión Ads (MANUAL)</Label><input type="number" value={form.adSpend} onChange={e => setFormField('adSpend', e.target.value)} placeholder="$ 0" disabled={form.restDay} className="w-full bg-transparent font-black text-2xl outline-none" /></div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-50 p-3 rounded-xl"><Label>Total Guías</Label><input type="number" value={form.orders} onChange={e => setFormField('orders', e.target.value)} disabled={form.restDay} className="w-full bg-transparent font-black text-2xl outline-none" /></div>
          <div className="bg-slate-50 p-3 rounded-xl"><Label>Total Unidades</Label><input type="number" value={form.units} onChange={e => setFormField('units', e.target.value)} disabled={form.restDay} className="w-full bg-transparent font-black text-2xl outline-none" /></div>
        </div>

        {!form.restDay && avgUnits && (
          <div className="text-center text-[9px]">Promedio: <span className="text-emerald-600">{avgUnits} unid/guía</span>
            {extraUnitCharge > 0 && parseFloat(avgUnits) > 1 && <span className="text-yellow-600 ml-2">Extra: {fmt(extraPerGuide)}</span>}
          </div>
        )}

        <div><Label>Recaudo Bruto del Día</Label><input type="number" value={form.revenue} onChange={e => setFormField('revenue', e.target.value)} disabled={form.restDay} className="w-full p-4 rounded-xl bg-slate-50 border-2 border-emerald-100 font-black text-2xl outline-none" /></div>

        <button onClick={save} disabled={!selectedVendor || !selectedProductId} className="w-full bg-emerald-500 text-zinc-950 p-3 rounded-xl font-black uppercase text-xs tracking-widest hover:bg-emerald-400 disabled:opacity-30"><Save size={14} /> {editingRec ? 'Actualizar' : 'Guardar'}</button>
        {savedMsg && <div className="text-center text-emerald-600 text-[10px] font-black"><CheckCircle2 size={12} /> ¡Guardado!</div>}
      </Card>

      {dayRecords.length > 0 && (
        <div className="space-y-2">
          <p className="text-[9px] font-black text-slate-400 uppercase ml-1">Registros del día</p>
          {dayRecords.map(r => {
            const c = configs.find(x => x.id === r.configId);
            return (
              <Card key={r.id} className="flex justify-between items-center">
                <div><span className="font-black text-emerald-600 text-xs">{c?.vendedora} - {c?.productName}</span><div className="text-[9px]">{r.orders} guías · {r.units} unid · {fmt(r.revenue)}</div></div>
                <div className="flex gap-1"><button onClick={() => startEdit(r)} className="p-1.5 rounded hover:bg-amber-50"><Pencil size={12} /></button><button onClick={() => deleteRec(r.id)} className="p-1.5 rounded hover:bg-rose-50"><Trash2 size={12} /></button></div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── VISTA 3: DASHBOARD (COMPLETO CON TODAS LAS MÉTRICAS ORIGINALES) ─────────
function VistaDashboard({ configs, months }) {
  const [filter, setFilter] = useState({ startDate: todayColombia(), endDate: todayColombia(), vendedora: 'all', producto: 'all' });
  const grouped = useMemo(() => configs.reduce((a, c) => { if (!a[c.vendedora]) a[c.vendedora] = []; a[c.vendedora].push(c); return a; }, {}), [configs]);
  const setF = (k, v) => setFilter(f => ({ ...f, [k]: v }));

  const [openSections, setOpenSections] = useState({
    embudo: false,
    costos: false,
    ranking: false,
    proyeccion: false,
    analisisProductos: false
  });
  const toggleSection = (section) => setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));

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

  let semaforo = { color: 'bg-rose-500', texto: 'REVISIÓN', emoji: '🔴' };
  if (proyeccion30 >= 1_000_000) semaforo = { color: 'bg-emerald-500', texto: 'EXCELENTE', emoji: '🟢' };
  else if (proyeccion30 >= targetProfit && targetProfit > 0) semaforo = { color: 'bg-blue-500', texto: 'BIEN', emoji: '🔵' };

  let cpaColor = '', cpaMensaje = '';
  if (stats.cpaReal > stats.cpaEquilibrioPonderado) {
    cpaColor = 'bg-red-100 border-red-500';
    cpaMensaje = '⚠️ CPA por encima del equilibrio → No rentable';
  } else if (stats.cpaReal <= stats.cpaEquilibrioPonderado * 0.75) {
    cpaColor = 'bg-green-100 border-green-500';
    cpaMensaje = '🚀 CPA excelente → ESCALAR';
  } else {
    cpaColor = 'bg-yellow-100 border-yellow-500';
    cpaMensaje = '✅ CPA por debajo del equilibrio → Rentable';
  }

  const selectedProductIsInactive = useMemo(() => {
    if (filter.producto === 'all') return false;
    const config = configs.find(c => c.id === filter.producto);
    return config && config.activo === false;
  }, [filter.producto, configs]);

  const productosDisponibles = useMemo(() => {
    if (filter.vendedora === 'all') {
      const productosMap = new Map();
      configs.forEach(c => { productosMap.set(c.id, { id: c.id, productName: c.productName, activo: c.activo !== false }); });
      return Array.from(productosMap.values()).sort((a, b) => a.productName.localeCompare(b.productName));
    } else {
      const productos = grouped[filter.vendedora] || [];
      return productos.map(p => ({ id: p.id, productName: p.productName, activo: p.activo !== false }));
    }
  }, [configs, filter.vendedora, grouped]);

  const handleVendorChange = (vendor) => { setF('vendedora', vendor); setF('producto', 'all'); };

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

  const SectionHeader = ({ title, icon: Icon, section }) => (
    <button onClick={() => toggleSection(section)} className="w-full flex justify-between py-2 px-3 bg-slate-100 hover:bg-slate-200 rounded-xl">
      <div className="flex gap-1.5"><Icon size={14} className="text-emerald-600" /><span className="text-[10px] font-black uppercase">{title}</span></div>
      {openSections[section] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
    </button>
  );

  return (
    <div className="space-y-6">
      <div><h2 className="text-2xl md:text-3xl font-black italic uppercase">Dashboard General</h2><p className="text-[10px] text-slate-400 font-black uppercase">Módulo 3 · Análisis de Rendimiento</p></div>

      <Card className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div><Label>Desde</Label><input type="date" value={filter.startDate} onChange={e => setF('startDate', e.target.value)} className="w-full p-2 bg-slate-50 rounded-xl text-xs" /></div>
        <div><Label>Hasta</Label><input type="date" value={filter.endDate} onChange={e => setF('endDate', e.target.value)} className="w-full p-2 bg-slate-50 rounded-xl text-xs" /></div>
        <div><Label>Vendedora</Label>
          <select value={filter.vendedora} onChange={(e) => handleVendorChange(e.target.value)} className="w-full p-2 bg-slate-50 rounded-xl text-xs">
            <option value="all">TODAS</option>
            {Object.keys(grouped).map(v => <option key={v} value={v}>{v.toUpperCase()}</option>)}
          </select>
        </div>
        <div><Label>Producto</Label>
          <select value={filter.producto} onChange={e => setF('producto', e.target.value)} className="w-full p-2 bg-slate-50 rounded-xl text-xs">
            <option value="all">TODOS</option>
            {productosDisponibles.map(p => <option key={p.id} value={p.id}>{p.productName} {!p.activo ? '(INACTIVO)' : ''}</option>)}
          </select>
        </div>
      </Card>

      {selectedProductIsInactive && filter.producto !== 'all' && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-3 rounded-xl flex gap-2"><PowerOff size={16} /><span className="text-xs font-black">⚠️ PRODUCTO DESACTIVADO - Datos históricos</span></div>
      )}

      {filteredRecords.length === 0 ? (
        <Card className="text-center py-12 text-slate-300"><BarChart3 size={32} className="mx-auto mb-3 opacity-30" /><p>Sin datos en este rango</p></Card>
      ) : (
        <>
          <div className={`rounded-xl p-3 md:p-5 border-2 ${cpaColor} shadow-md`}>
            <div className="flex flex-col md:flex-row justify-between gap-3">
              <div><Label className="opacity-70">CPA REAL</Label><p className="text-xl md:text-3xl font-black">{fmt(stats.cpaReal)}</p></div>
              <div className="text-center"><Label className="opacity-70">CPA EQUILIBRIO</Label><p className="text-lg md:text-2xl font-black">{fmt(stats.cpaEquilibrioPonderado)}</p></div>
              <div><div className="inline-block px-2 py-1 rounded-lg bg-white/50"><p className="text-[8px] font-black">{cpaMensaje}</p></div></div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card><Label>💰 Recaudo Bruto</Label><p className="text-2xl font-black">{fmt(stats.grossRev)}</p></Card>
            <Card className="bg-amber-50"><Label>⚠ Ajuste IER</Label><p className="text-2xl font-black text-amber-600">- {fmt(ajustePorIER)}</p><p className="text-[8px]">{fmtDec(eficienciaRecaudo,1)}% perdido</p></Card>
            <Card className="bg-emerald-50"><Label>✅ Recaudo Neto Real</Label><p className="text-2xl font-black text-emerald-700">{fmt(stats.realRev)}</p></Card>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="AOV" value={fmt(stats.aov)} sub={`${fmtN(stats.grossOrd)} pedidos`} highlight />
            <Stat label="Flete x Entrega" value={fmt(stats.freteRealXEntrega)} sub={`${fmtN(stats.finalDeliveries)} entregas`} />
            <Stat label="ROAS" value={`${fmtDec(stats.roas, 4)}x`} />
            <Stat label="Utilidad Neta" value={fmt(stats.net)} />
            <Stat label="Profit / Día" value={fmt(avgDiario)} sub={`${activeDays} días activos`} highlight />
          </div>

          {/* Embudo */}
          <div className="space-y-2">
            <SectionHeader title="EMBUDO OPERATIVO" icon={Activity} section="embudo" />
            {openSections.embudo && (
              <Card>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <div><Label>Pedidos Registrados</Label><p className="text-xl font-black">{fmtN(stats.grossOrd)}</p><p className="text-[8px]">{fmtN(stats.grossUnits)} unidades</p></div>
                  <div><Label>Guías Despachadas</Label><p className="text-xl font-black text-blue-600">{fmtN(stats.realShipped)}</p></div>
                  <div><Label>Devoluciones Est.</Label><p className="text-xl font-black text-rose-500">{fmtN(stats.estimatedReturns)}</p></div>
                  <div><Label>Entregas Finales</Label><p className="text-xl font-black text-emerald-600">{fmtN(stats.finalDeliveries)}</p><p className="text-[8px]">IER {fmtDec(stats.ierGlobal,2)}%</p></div>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <p className="text-[8px] font-black uppercase mb-2">📦 Unidades físicas</p>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    <div><span className="text-[8px]">Registradas:</span> <span className="font-black">{fmtN(stats.unitsRegistradas)}</span></div>
                    <div><span className="text-[8px]">Enviadas:</span> <span className="font-black text-blue-600">{fmtN(stats.unitsShippedReal)}</span></div>
                    <div><span className="text-[8px]">Devueltas:</span> <span className="font-black text-rose-500">{fmtN(stats.unitsReturnedReal)}</span></div>
                    <div><span className="text-[8px]">Entregadas:</span> <span className="font-black text-emerald-600">{fmtN(stats.unitsDeliveredReal)}</span></div>
                    <div><span className="text-[8px]">% Entregado:</span> <span className="font-black">{fmtDec(stats.pctProductosEntregados,1)}%</span></div>
                  </div>
                </div>
              </Card>
            )}
          </div>

          {/* Costos */}
          <div className="space-y-2">
            <SectionHeader title="RADIOGRAFÍA DE COSTOS" icon={Calculator} section="costos" />
            {openSections.costos && (
              <Card className="p-0 overflow-hidden">
                {costItems.map((item,i) => (
                  <div key={i} className="flex items-center gap-2 md:gap-4 px-4 py-3 border-b last:border-0">
                    <div className="w-6 h-6 md:w-8 md:h-8 rounded-xl bg-slate-100 flex items-center justify-center"><item.icon size={12} /></div>
                    <div className="flex-1"><p className="text-[11px] font-black">{item.label}</p><p className="text-[7px] text-slate-400">{item.note}</p></div>
                    <p className="font-black text-xs md:text-sm">{fmt(item.value)}</p>
                  </div>
                ))}
                <div className="flex items-center gap-2 md:gap-4 px-4 py-3 bg-slate-900 text-white">
                  <div className="flex-1"><p className="text-[11px] font-black uppercase">Total Costos</p></div>
                  <p className="font-black text-sm md:text-lg text-rose-400">{fmt(totalCostos)}</p>
                </div>
              </Card>
            )}
          </div>

          {/* Ranking */}
          <div className="space-y-2">
            <SectionHeader title="RANKING DE VENDEDORAS" icon={Award} section="ranking" />
            {openSections.ranking && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs md:text-sm">
                  <thead className="bg-slate-100 text-[8px] font-black"><tr><th className="p-2 rounded-l-xl">#</th><th>Vendedora</th><th className="text-right">Pedidos</th><th className="text-right">Recaudo Neto</th><th className="text-right">Utilidad</th><th className="text-right">IER</th></tr></thead>
                  <tbody>
                    {stats.rankingVendedoras?.map((v, idx) => (
                      <tr key={v.vendedora} className="hover:bg-slate-50 border-b"><td className="p-2 font-black text-emerald-600">{idx+1}</td><td className="font-bold uppercase">{v.vendedora}</td><td className="text-right font-mono">{fmtN(v.pedidos)}</td><td className="text-right font-mono">{fmt(v.recaudoNeto)}</td><td className={`text-right font-mono ${v.utilidad >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{fmt(v.utilidad)}</td><td className="text-right font-mono">{fmtDec(v.ierPromedio,2)}%</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Proyección */}
          <div className="space-y-2">
            <SectionHeader title="UTILIDAD Y PROYECCIÓN" icon={TrendingUp} section="proyeccion" />
            {openSections.proyeccion && (
              <div className="flex flex-col md:grid md:grid-cols-2 gap-4">
                <Card dark><Label>Utilidad Neta Período</Label><p className={`text-2xl md:text-4xl font-black ${stats.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{fmt(stats.net)}</p>
                  <div className="grid grid-cols-2 gap-2 pt-3 border-t border-zinc-800 text-xs">
                    <div><p className="text-[8px]">Ingresos Reales</p><p className="font-black">{fmt(stats.realRev)}</p></div>
                    <div><p className="text-[8px]">Total Costos</p><p className="font-black text-rose-400">{fmt(totalCostos)}</p></div>
                    <div><p className="text-[8px]">Margen Neto</p><p className="font-black text-emerald-400">{stats.realRev > 0 ? fmtDec((stats.net / stats.realRev) * 100) : '0'}%</p></div>
                    <div><p className="text-[8px]">Profit / Día</p><p className="font-black">{fmt(avgDiario)}</p></div>
                  </div>
                </Card>
                <div className={`rounded-2xl p-4 text-white ${semaforo.color}`}>
                  <div><p className="text-[8px] font-black opacity-60">Proyección 30 Días</p></div>
                  <p className="text-2xl md:text-4xl font-black">{fmt(proyeccion30)}</p>
                  <div className="bg-white/20 px-3 py-2 rounded-xl mt-2"><p className="text-sm font-black">{semaforo.emoji} {semaforo.texto}</p></div>
                  <div className="flex justify-between text-[8px] font-black opacity-60 mt-3"><span>Días activos: {activeDays}</span><span>IER: {fmtDec(stats.ierGlobal,2)}%</span></div>
                </div>
                {targetProfit > 0 && (
                  <Card className="col-span-2">
                    <div className="flex justify-between"><Label>Avance vs Meta</Label><span className="text-xs font-black">{fmtDec((proyeccion30 / targetProfit) * 100,2)}%</span></div>
                    <div className="h-2 bg-slate-100 rounded-full mt-1"><div className={`h-full rounded-full ${semaforo.color}`} style={{ width: `${Math.min((proyeccion30 / targetProfit) * 100, 100)}%` }} /></div>
                  </Card>
                )}
              </div>
            )}
          </div>

          {/* Análisis temporal por producto */}
          <div className="space-y-2">
            <SectionHeader title="ANÁLISIS TEMPORAL POR PRODUCTO" icon={CalendarDays} section="analisisProductos" />
            {openSections.analisisProductos && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[10px] md:text-sm">
                  <thead className="bg-slate-100 text-[7px] font-black"><tr><th className="p-2">Vendedora</th><th>Producto</th><th>Primer registro</th><th>Último registro</th><th>Días activos</th><th>Estado</th></tr></thead>
                  <tbody>
                    {stats.detalleProductos.map(p => {
                      const diasActivos = Math.floor((parseColombiaDate(p.ultimoRegistro) - parseColombiaDate(p.primerRegistro)) / (1000*60*60*24)) + 1;
                      return (
                        <tr key={p.configId} className="hover:bg-slate-50 border-b"><td className="p-2 font-bold uppercase">{p.vendedora}</td><td className={!p.activo ? 'text-slate-400 line-through' : ''}>{p.productName}</td><td>{parseColombiaDate(p.primerRegistro).toLocaleDateString('es-CO')}</td><td>{parseColombiaDate(p.ultimoRegistro).toLocaleDateString('es-CO')}</td><td>{diasActivos} días</td><td>{!p.activo ? <span className="text-red-600 text-[8px] font-black"><PowerOff size={10} /> INACTIVO</span> : <span className="text-green-600 text-[8px] font-black"><Power size={10} /> ACTIVO</span>}</td></tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── APP PRINCIPAL ────────────────────────────────────────────────────────────
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

  if (loading) return <div className="min-h-screen flex items-center justify-center">Cargando...</div>;
  if (!user) return <Login />;

  const tabs = [
    { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { id: 'records', icon: ClipboardList, label: 'Cierres' },
    { id: 'config', icon: Settings, label: 'Estrategias' },
  ];

  return (
    <div className="min-h-screen bg-slate-100 pb-20" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <header className="bg-zinc-950 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 py-3 flex justify-between items-center">
          <div><p className="font-black italic text-emerald-400 text-sm md:text-base">Winner System 360</p><p className="text-[9px] font-bold text-zinc-500">Control Ventas · Contraentrega CO</p></div>
          <div className="flex items-center gap-3">
            <div className="flex gap-1 bg-white/5 p-1 rounded-xl border border-white/10">
              {tabs.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-1 px-2 md:px-3 py-1.5 rounded-lg text-[9px] font-black uppercase ${activeTab === t.id ? 'bg-emerald-500 text-zinc-950' : 'text-zinc-500'}`}>
                  <t.icon size={12} /><span className="hidden sm:inline">{t.label}</span>
                </button>
              ))}
            </div>
            <button onClick={() => import('./src/firebase').then(({ logout }) => logout())} className="bg-red-500/20 hover:bg-red-500/30 text-red-300 px-2 py-1 rounded-lg text-[9px] font-black uppercase">Salir</button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">
        {activeTab === 'dashboard' && <VistaDashboard configs={configs} months={months} />}
        {activeTab === 'records' && <VistaRegistro configs={configs} months={months} />}
        {activeTab === 'config' && <VistaConfig configs={configs} />}
      </main>
    </div>
  );
}
