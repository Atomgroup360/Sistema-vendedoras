import React, { useState, useEffect, useMemo } from 'react';
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
import { useAuth } from './src/context/AuthContext';
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

// ─── MOTOR DE CÁLCULO ─────────────────────────────────────────────────────────
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

// ─── VISTA 1: CONFIGURACIÓN ───────────────────────────────────────────────────
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
    <div className="space-y-8">
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
                  <button onClick={(e) => { e.stopPropagation(); openNewForVendor(vendedora); }} className="flex items-center gap-1 bg-emerald-500 text-zinc-950 px-3 py-2 rounded-xl font-black text-[9px] uppercase"><Plus size={12} /> Producto</button>
                  <button onClick={() => toggleV(vendedora)} className="p-1 rounded-xl hover:bg-slate-100">{expandedV[vendedora] ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
                </div>
              </div>
              {expandedV[vendedora] && (
                <div className="border-t border-slate-100 divide-y divide-slate-100">
                  {productos.map(p => {
                    const isActive = p.activo !== false;
                    return (
                      <div key={p.id} className={`p-4 md:p-5 flex flex-col sm:flex-row sm:items-center gap-3 transition-all ${!isActive ? 'bg-slate-100 opacity-70' : ''}`}>
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
                  <div>
                    <p className="text-[10px] font-black uppercase">Estado del Producto</p>
                  </div>
                </div>
                <button onClick={() => setField('activo', !form.activo)} className="flex items-center gap-2 text-[9px] font-black uppercase">
                  {form.activo ? <><ToggleRight size={28} className="text-emerald-400" /><span className="text-emerald-400">ACTIVO</span></> : <><ToggleLeft size={28} className="text-red-400" /><span className="text-red-400">INACTIVO</span></>}
                </button>
              </div>

              <InputField label="Precio de Venta (1 unidad)" type="number" value={form.priceSingle} onChange={e => setField('priceSingle', e.target.value)} placeholder="Ej: 79000" />
              <InputField label="Costo Unitario de Producto" type="number" value={form.productCost} onChange={e => setField('productCost', e.target.value)} placeholder="Ej: 18000" />
              <InputField label="Flete Base por Guía" type="number" value={form.freight} onChange={e => setField('freight', e.target.value)} placeholder="Ej: 9500" />
              <InputField label="Comisión por Entrega" type="number" value={form.commission} onChange={e => setField('commission', e.target.value)} placeholder="Ej: 3000" />
              <InputField label="CPA Equilibrio" type="number" value={form.cpaEquilibrio} onChange={e => setField('cpaEquilibrio', e.target.value)} placeholder="Ej: 15000" />
            </div>
            <button onClick={save} className="w-full mt-6 bg-emerald-500 text-zinc-950 py-4 rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-emerald-400"><Save size={18} /> Guardar</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── VISTA 2: REGISTRO DIARIO (VERSIÓN SIMPLIFICADA) ─────────────────────────
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
        setErrorMsg(`❌ Ya existe un registro para esta fecha. Puedes editarlo o eliminarlo.`);
        return;
      }
    }
    let orders = form.orders, units = form.units, revenue = form.revenue;
    if (form.restDay) {
      orders = '0'; units = '0'; revenue = '0';
    } else {
      if (!orders || !units || !revenue) {
        alert("Completa todos los campos obligatorios o activa 'Día de descanso'.");
        return;
      }
    }
    const rec = {
      configId: selectedProductId, orders, units, revenue, adSpend: form.adSpend || '0',
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
  };

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
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div><h2 className="text-2xl md:text-3xl font-black italic uppercase">Cierre Diario</h2></div>

      <Card className="space-y-4">
        <div className="bg-zinc-950 px-4 py-3 rounded-2xl text-white space-y-3">
          <div className="flex items-center gap-2"><Calendar size={16} className="text-emerald-400" /><div><p className="text-[8px] font-black text-zinc-500 uppercase">Fecha del Registro</p></div></div>
          <div className="space-y-2">
            <input type="date" value={selectedDate} onChange={(e) => { setSelectedDate(e.target.value); setEditingRec(null); setSelectedVendor(''); setSelectedProductId(''); setForm({ orders: '', units: '', revenue: '', adSpend: '', restDay: false }); }} className="w-full bg-white text-zinc-950 font-black text-sm rounded-xl px-3 py-2 border-2 border-emerald-400" />
            <div className="grid grid-cols-3 gap-1">
              <button onClick={() => moveDate(-1)} className="bg-white/10 text-emerald-400 px-2 py-1.5 rounded-xl text-[9px] font-black">Día anterior</button>
              <button onClick={() => { setSelectedDate(todayColombia()); setEditingRec(null); setSelectedVendor(''); setSelectedProductId(''); setForm({ orders: '', units: '', revenue: '', adSpend: '', restDay: false }); }} className="bg-emerald-500 text-zinc-950 px-2 py-1.5 rounded-xl text-[9px] font-black">Hoy</button>
              <button onClick={() => moveDate(1)} className="bg-white/10 text-emerald-400 px-2 py-1.5 rounded-xl text-[9px] font-black">Día siguiente</button>
            </div>
          </div>
        </div>

        <div className={`rounded-xl p-3 flex items-center justify-between ${form.restDay ? 'bg-amber-100' : 'bg-slate-100'}`}>
          <div className="flex items-center gap-2"><Coffee size={16} className="text-amber-600" /><div><p className="text-[9px] font-black uppercase">Día de descanso / Sin campaña</p></div></div>
          <button onClick={() => setFormField('restDay', !form.restDay)} className="flex items-center gap-1 text-[8px] font-black">
            {form.restDay ? <><ToggleRight size={22} className="text-amber-500" /><span className="text-amber-600">DESCANSO</span></> : <><ToggleLeft size={22} className="text-slate-400" /><span className="text-slate-500">Activo</span></>}
          </button>
        </div>

        <div><Label>Vendedora</Label>
          <select value={selectedVendor} onChange={(e) => handleVendorChange(e.target.value)} disabled={!!editingRec} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 font-semibold text-sm">
            <option value="">Seleccionar vendedora...</option>
            {vendors.map(v => <option key={v} value={v}>{v.toUpperCase()}</option>)}
          </select>
        </div>

        <div><Label>Producto</Label>
          <select value={selectedProductId} onChange={(e) => handleProductChange(e.target.value)} disabled={!selectedVendor || !!editingRec} className="w-full px-3 py-2.5 rounded-xl bg-slate-50 font-semibold text-sm">
            <option value="">Seleccionar producto...</option>
            {productsOfVendor.map(p => <option key={p.id} value={p.id}>{p.productName}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-50 p-3 rounded-xl"><Label className="!mb-0">Total Guías</Label><input type="number" value={form.orders} onChange={e => setFormField('orders', e.target.value)} placeholder="0" disabled={form.restDay} className="w-full bg-transparent font-black text-2xl outline-none" /></div>
          <div className="bg-slate-50 p-3 rounded-xl"><Label className="!mb-0">Total Unidades</Label><input type="number" value={form.units} onChange={e => setFormField('units', e.target.value)} placeholder="0" disabled={form.restDay} className="w-full bg-transparent font-black text-2xl outline-none" /></div>
        </div>

        <div><Label>Recaudo Bruto Total del Día</Label><input type="number" value={form.revenue} onChange={e => setFormField('revenue', e.target.value)} placeholder="$ 0" disabled={form.restDay} className="w-full px-4 py-4 rounded-xl bg-slate-50 border-2 border-emerald-100 font-black text-2xl outline-none" /></div>

        <button onClick={save} disabled={!selectedVendor || !selectedProductId} className="w-full bg-emerald-500 text-zinc-950 py-3 rounded-xl font-black uppercase text-xs tracking-widest hover:bg-emerald-400 disabled:opacity-30"><Save size={14} /> {editingRec ? 'Actualizar' : 'Guardar'}</button>
        {savedMsg && <div className="text-center text-emerald-600 text-[10px] font-black"><CheckCircle2 size={12} /> ¡Guardado!</div>}
        {errorMsg && <div className="text-center text-rose-600 text-[10px] font-black"><AlertTriangle size={12} /> {errorMsg}</div>}
      </Card>

      {dayRecords.length > 0 && (
        <div className="space-y-2">
          <p className="text-[9px] font-black text-slate-400 uppercase">Registros del día</p>
          {dayRecords.map(r => {
            const c = configs.find(x => x.id === r.configId);
            return (
              <Card key={r.id} className="flex justify-between items-center">
                <div><span className="font-black text-emerald-600 text-xs">{c?.vendedora} - {c?.productName}</span><div className="text-[9px]">{r.orders} guías · {fmt(r.revenue)}</div></div>
                <div className="flex gap-1"><button onClick={() => startEdit(r)} className="p-1.5 rounded hover:bg-amber-50"><Pencil size={12} /></button><button onClick={() => deleteRec(r.id)} className="p-1.5 rounded hover:bg-rose-50"><Trash2 size={12} /></button></div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── VISTA 3: DASHBOARD (VERSIÓN SIMPLIFICADA) ───────────────────────────────
function VistaDashboard({ configs, months }) {
  const [filter, setFilter] = useState({ startDate: todayColombia(), endDate: todayColombia(), vendedora: 'all', producto: 'all' });
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

  const stats = useMemo(() => calcularStats(filteredRecords, configs), [filteredRecords, configs]);
  const activeDays = useMemo(() => {
    const activeRecords = filteredRecords.filter(r => !r.restDay);
    return new Set(activeRecords.map(r => r.date)).size;
  }, [filteredRecords]);
  const avgDiario = activeDays > 0 ? stats.net / activeDays : 0;
  const proyeccion30 = avgDiario * 30;

  const handleVendorChange = (vendor) => { setF('vendedora', vendor); setF('producto', 'all'); };

  return (
    <div className="space-y-6">
      <div><h2 className="text-2xl md:text-3xl font-black italic uppercase">Dashboard General</h2></div>

      <Card className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div><Label>Desde</Label><input type="date" value={filter.startDate} onChange={e => setF('startDate', e.target.value)} className="w-full px-2 py-2 bg-slate-50 rounded-xl text-xs" /></div>
        <div><Label>Hasta</Label><input type="date" value={filter.endDate} onChange={e => setF('endDate', e.target.value)} className="w-full px-2 py-2 bg-slate-50 rounded-xl text-xs" /></div>
        <div><Label>Vendedora</Label>
          <select value={filter.vendedora} onChange={(e) => handleVendorChange(e.target.value)} className="w-full px-2 py-2 bg-slate-50 rounded-xl text-xs">
            <option value="all">TODAS</option>
            {Object.keys(grouped).map(v => <option key={v} value={v}>{v.toUpperCase()}</option>)}
          </select>
        </div>
        <div><Label>Producto</Label>
          <select value={filter.producto} onChange={e => setF('producto', e.target.value)} className="w-full px-2 py-2 bg-slate-50 rounded-xl text-xs">
            <option value="all">TODOS</option>
            {productosDisponibles.map(p => <option key={p.id} value={p.id}>{p.productName} {!p.activo ? '(INACTIVO)' : ''}</option>)}
          </select>
        </div>
      </Card>

      {filteredRecords.length === 0 ? (
        <Card className="text-center py-12"><BarChart3 size={32} className="mx-auto mb-3 opacity-30" /><p>Sin datos en este rango</p></Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card><Label>💰 Recaudo Bruto</Label><p className="text-2xl font-black">{fmt(stats.grossRev)}</p></Card>
            <Card><Label>📊 Recaudo Neto Real</Label><p className="text-2xl font-black text-emerald-600">{fmt(stats.realRev)}</p></Card>
            <Card><Label>💵 Utilidad Neta</Label><p className={`text-2xl font-black ${stats.net >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{fmt(stats.net)}</p></Card>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="AOV" value={fmt(stats.aov)} sub={`${fmtN(stats.grossOrd)} pedidos`} />
            <Stat label="CPA Real" value={fmt(stats.cpaReal)} />
            <Stat label="ROAS" value={`${fmtDec(stats.roas, 2)}x`} />
            <Stat label="Proyección 30d" value={fmt(proyeccion30)} sub={`${fmt(avgDiario)}/día`} />
          </div>

          {/* Ranking simplificado */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100"><tr><th className="p-2">#</th><th>Vendedora</th><th className="text-right">Pedidos</th><th className="text-right">Utilidad</th></tr></thead>
              <tbody>
                {stats.rankingVendedoras?.slice(0, 5).map((v, idx) => (
                  <tr key={v.vendedora} className="border-b"><td className="p-2 font-black text-emerald-600">{idx+1}</td><td className="font-bold">{v.vendedora}</td><td className="text-right">{fmtN(v.pedidos)}</td><td className={`text-right ${v.utilidad >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{fmt(v.utilidad)}</td></tr>
                ))}
              </tbody>
            </table>
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
          <div><p className="font-black italic text-emerald-400">Winner System 360</p><p className="text-[9px] font-bold text-zinc-500">Control Ventas · Contraentrega CO</p></div>
          <div className="flex items-center gap-3">
            <div className="flex gap-1 bg-white/5 p-1 rounded-xl">
              {tabs.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase ${activeTab === t.id ? 'bg-emerald-500 text-zinc-950' : 'text-zinc-500'}`}>
                  <t.icon size={12} /><span className="hidden sm:inline">{t.label}</span>
                </button>
              ))}
            </div>
            <button onClick={() => import('./src/firebase').then(({ logout }) => logout())} className="bg-red-500/20 text-red-300 px-2 py-1 rounded-lg text-[9px] font-black uppercase">Salir</button>
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
