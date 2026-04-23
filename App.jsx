import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, collection, addDoc, setDoc, updateDoc, deleteDoc, doc, 
  onSnapshot
} from 'firebase/firestore';
import { 
  LucideLayoutDashboard, LucideClipboardList, LucideSettings, LucidePlus, 
  LucideTrash2, LucideCalendar, LucideTrendingUp, LucidePackage, 
  LucideLayers, LucideTruck, LucideTarget, LucideWallet, LucideCheckCircle2, 
  LucideXCircle, LucideCalculator, LucideEye, LucideLineChart, LucideActivity, 
  LucidePercent, LucideBadgeDollarSign, LucidePencil, LucideSave, LucideX
} from 'lucide-react';

// --- CONFIGURACIÓN DE FIREBASE ---
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

export default function App() {
  // --- ESTADOS GLOBALES ---
  const [salesConfigs, setSalesConfigs] = useState([]);
  const [dailyRecords, setDailyRecords] = useState([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isCreatingConfig, setIsCreatingConfig] = useState(false);
  const [editingConfigId, setEditingConfigId] = useState(null);
  const [editingRecordId, setEditingRecordId] = useState(null);
  
  // --- FILTROS ---
  const [filter, setFilter] = useState({ 
    startDate: new Date().toISOString().split('T')[0], 
    endDate: new Date().toISOString().split('T')[0], 
    vendedora: 'all', 
    producto: 'all' 
  });

  // --- FORMULARIOS ---
  const initialConfig = { 
    vendedora: '', productName: '', targetProfit: '800000', productCost: '', 
    freight: '', commission: '', returnRate: '20', effectiveness: '95', 
    fulfillment: '', fixedCosts: '2000', dailyAdSpend: '', fixedAdSpend: true 
  };
  const [configForm, setConfigForm] = useState(initialConfig);

  const initialRecord = { 
    date: new Date().toISOString().split('T')[0], configId: '', 
    orders: '', units: '', revenue: '', adSpend: '' 
  };
  const [recordForm, setRecordForm] = useState(initialRecord);

  // --- PERSISTENCIA FIREBASE ---
  useEffect(() => {
    const unsubConfigs = onSnapshot(collection(db, 'sales_configs'), (snap) => {
      setSalesConfigs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    const unsubRecords = onSnapshot(collection(db, 'daily_records'), (snap) => {
      setDailyRecords(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => { unsubConfigs(); unsubRecords(); };
  }, []);

  const groupedConfigs = useMemo(() => salesConfigs.reduce((acc, c) => {
    if (!acc[c.vendedora]) acc[c.vendedora] = [];
    acc[c.vendedora].push(c);
    return acc;
  }, {}), [salesConfigs]);

  // --- MOTOR MATEMÁTICO STRICTO (CORREGIDO A UNIDADES FÍSICAS) ---
  const stats = useMemo(() => {
    const filtered = dailyRecords.filter(r => {
      const conf = salesConfigs.find(c => c.id === r.configId);
      return r.date >= filter.startDate && r.date <= filter.endDate &&
             conf && (filter.vendedora === 'all' || conf.vendedora === filter.vendedora) &&
             (filter.producto === 'all' || r.configId === filter.producto);
    });

    let res = { 
      grossRev: 0, grossOrd: 0, grossUnits: 0,
      realRev: 0, ad: 0, net: 0, 
      realShipped: 0, estimatedReturns: 0, finalDeliveries: 0,  
      totalFreightCost: 0, totalFulfillment: 0, 
      productCostTotal: 0, totalCommissions: 0, totalFixedCosts: 0,
      targetGoalRange: 0, totalOperationalCosts: 0,
      unitsShippedReal: 0, unitsReturnedReal: 0, unitsDeliveredReal: 0
    };
    
    filtered.forEach(r => {
      const c = salesConfigs.find(conf => conf.id === r.configId);
      if (!c) return;

      const eff = parseFloat(c.effectiveness) / 100;
      const ret = parseFloat(c.returnRate) / 100;
      const IER = eff * (1 - ret); // 0.76 (Para 95% y 20%)

      const orders = parseFloat(r.orders) || 0;
      const units = parseFloat(r.units) || 0;
      const revenue = parseFloat(r.revenue) || 0;
      const ads = parseFloat(r.adSpend) || (c.fixedAdSpend ? parseFloat(c.dailyAdSpend) : 0);

      // --- LOGÍSTICA DE PAQUETES (GUÍAS) ---
      const despachosRealesGuias = orders * eff;
      const entregasFinalesGuias = orders * IER;

      // --- LOGÍSTICA DE UNIDADES (FÍSICAS) ---
      const despachosRealesUnidades = units * eff;
      const entregasFinalesUnidades = units * IER; // 3 * 0.76 = 2.28 unidades finales

      // --- 1. COSTOS EXACTOS (SOBRE UNIDADES) ---
      // FÓRMULA ESTRICTA: COSTO MERCANCIA = COSTO UNITARIO X UNIDADES ENTREGADAS
      const costoMercancia = (parseFloat(c.productCost) || 0) * entregasFinalesGuias; // CMV = costo producto x entregas finales
      
      const comisiones = (parseFloat(c.commission) || 0) * entregasFinalesUnidades;
      
      // --- 2. COSTOS EXACTOS (SOBRE GUÍAS/PAQUETES) ---
      const costosFijos = (parseFloat(c.fixedCosts) || 0) * entregasFinalesGuias;
      
      const avgUnits = orders > 0 ? units / orders : 0;
      const extraUnits = (avgUnits > 1) ? (avgUnits - 1) : 0;
      const fleteFinal = (parseFloat(c.freight) || 0) + (extraUnits * 5000);
      
      const fletesTotales = despachosRealesGuias * fleteFinal;
      const fulfillmentTotal = despachosRealesGuias * (parseFloat(c.fulfillment) || 0);

      // --- ACUMULADOS ---
      res.grossRev += revenue;
      res.grossOrd += orders;
      res.grossUnits += units;
      res.realRev += revenue * IER;
      res.ad += ads;
      
      res.realShipped += despachosRealesGuias;
      res.estimatedReturns += despachosRealesGuias * ret;
      res.finalDeliveries += entregasFinalesGuias;
      
      res.unitsShippedReal += despachosRealesUnidades;
      res.unitsReturnedReal += despachosRealesUnidades * ret;
      res.unitsDeliveredReal += entregasFinalesUnidades;
      
      res.productCostTotal += costoMercancia;
      res.totalCommissions += comisiones;
      res.totalFixedCosts += costosFijos;
      res.totalFreightCost += fletesTotales;
      res.totalFulfillment += fulfillmentTotal;
      
      res.targetGoalRange = parseFloat(c.targetProfit) || 0;
      res.totalOperationalCosts += (costoMercancia + fletesTotales + fulfillmentTotal + comisiones + costosFijos);
    });

    res.net = res.realRev - res.totalOperationalCosts - res.ad;
    return res;
  }, [dailyRecords, salesConfigs, filter]);

  // --- PROYECCIÓN MENSUAL SEMÁFORO ---
  const projection = useMemo(() => {
    const dStart = new Date(filter.startDate + "T00:00:00");
    const dEnd = new Date(filter.endDate + "T00:00:00");
    const diffDays = Math.max(1, Math.ceil(Math.abs(dEnd - dStart) / (1000 * 60 * 60 * 24)) + 1);
    const avgDaily = stats.net / diffDays;
    const totalProj = avgDaily * 30;

    let color = "bg-rose-500"; 
    let label = "REVISIÓN";

    if (totalProj > 1000000) {
      color = "bg-emerald-500";
      label = "EXCELENTE";
    } else if (totalProj >= stats.targetGoalRange && stats.targetGoalRange > 0) {
      color = "bg-blue-500";
      label = "BIEN";
    }

    return { totalProj, avgDaily, color, label };
  }, [stats, filter]);

  const formatCurrency = (val) => new Intl.NumberFormat('es-CO', { 
    style: 'currency', currency: 'COP', maximumFractionDigits: 0 
  }).format(val || 0);

  // --- HANDLERS SEGUROS ---
  const handleSaveConfig = async () => {
    if (editingConfigId) {
      await updateDoc(doc(db, 'sales_configs', editingConfigId), configForm);
    } else {
      await addDoc(collection(db, 'sales_configs'), { ...configForm, createdAt: Date.now() });
    }
    setIsCreatingConfig(false);
    setEditingConfigId(null);
    setConfigForm(initialConfig);
  };

  const handleEditConfig = (prod) => {
    setConfigForm(prod);
    setEditingConfigId(prod.id);
    setIsCreatingConfig(true);
  };

  const handleSaveRecord = async () => {
    if (!recordForm.configId || !recordForm.orders || !recordForm.revenue) return;
    if (editingRecordId) {
      await updateDoc(doc(db, 'daily_records', editingRecordId), recordForm);
    } else {
      await addDoc(collection(db, 'daily_records'), { ...recordForm, createdAt: Date.now() });
    }
    setEditingRecordId(null);
    setRecordForm(initialRecord);
  };

  const handleEditRecord = (rec) => {
    setRecordForm(rec);
    setEditingRecordId(rec.id);
    setActiveTab('records');
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] font-sans text-slate-900 pb-24">
      {/* NAVEGACIÓN SUPERIOR */}
      <div className="bg-zinc-950 text-white sticky top-0 z-50 shadow-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <LucideActivity className="text-zinc-950" size={24} />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tighter italic text-white leading-none">WINNER SYSTEM 360</h1>
              <p className="text-[8px] font-bold opacity-40 uppercase tracking-[0.3em] mt-1">Pereira Analytics Hub</p>
            </div>
          </div>
          <nav className="flex gap-2 bg-white/5 p-1 rounded-2xl border border-white/10">
            {[
              { id: 'dashboard', icon: LucideLayoutDashboard, label: 'Dashboard' },
              { id: 'records', icon: LucideClipboardList, label: 'Registros' },
              { id: 'config', icon: LucideSettings, label: 'Estrategias' }
            ].map(tab => (
              <button key={tab.id} onClick={() => {setActiveTab(tab.id); setEditingRecordId(null); setRecordForm(initialRecord);}} className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all ${activeTab === tab.id ? 'bg-emerald-500 text-zinc-950 shadow-lg' : 'text-zinc-500 hover:text-white hover:bg-white/5'}`}>
                <tab.icon size={14} /> <span className="hidden md:inline">{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6 space-y-10">
        
        {/* VISTA 1: DASHBOARD GENERAL */}
        {activeTab === 'dashboard' && (
          <div className="space-y-10 animate-in fade-in duration-500">
            
            <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-2 flex items-center gap-1"><LucideCalendar size={12}/> Fecha Inicio</label>
                <input type="date" className="w-full p-3.5 bg-slate-50 rounded-2xl font-bold text-xs outline-none focus:ring-2 focus:ring-emerald-500/20" value={filter.startDate} onChange={e=>setFilter({...filter, startDate: e.target.value})} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-2 flex items-center gap-1"><LucideCalendar size={12}/> Fecha Fin</label>
                <input type="date" className="w-full p-3.5 bg-slate-50 rounded-2xl font-bold text-xs outline-none focus:ring-2 focus:ring-emerald-500/20" value={filter.endDate} onChange={e=>setFilter({...filter, endDate: e.target.value})} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-2">Filtrar Vendedora</label>
                <select className="w-full p-3.5 bg-slate-50 rounded-2xl font-bold text-xs outline-none" value={filter.vendedora} onChange={e=>setFilter({...filter, vendedora: e.target.value, producto: 'all'})}>
                  <option value="all">TODAS LAS VENDEDORAS</option>
                  {Object.keys(groupedConfigs).map(v => <option key={v} value={v}>{v.toUpperCase()}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-2">Filtrar Producto</label>
                <select className="w-full p-3.5 bg-slate-50 rounded-2xl font-bold text-xs outline-none" value={filter.producto} disabled={filter.vendedora === 'all'} onChange={e=>setFilter({...filter, producto: e.target.value})}>
                  <option value="all">TODOS LOS PRODUCTOS</option>
                  {filter.vendedora !== 'all' && groupedConfigs[filter.vendedora]?.map(p => <option key={p.id} value={p.id}>{p.productName}</option>)}
                </select>
              </div>
            </div>

            {/* RADIOGRAFÍA FINANCIERA */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="bg-emerald-600 text-white p-7 rounded-[2.5rem] shadow-xl flex flex-col justify-center">
                <p className="text-[10px] font-black opacity-70 uppercase mb-2">Recaudo Neto (Caja Real)</p>
                <p className="text-3xl font-black font-mono tracking-tighter">{formatCurrency(stats.realRev)}</p>
                <p className="text-[9px] font-bold mt-2 tracking-widest">INGRESOS EFECTIVOS</p>
              </div>
              <div className="bg-white border border-slate-200 p-7 rounded-[2.5rem] flex flex-col justify-center shadow-sm">
                <p className="text-[10px] font-black text-blue-500 uppercase mb-2">ROAS Operativo</p>
                <p className="text-4xl font-black italic tracking-tighter text-slate-900">{(stats.realRev / (stats.ad || 1)).toFixed(2)}</p>
              </div>
              <div className="bg-zinc-900 p-7 rounded-[2.5rem] text-white flex flex-col justify-center shadow-xl">
                <p className="text-[10px] font-black opacity-40 uppercase mb-2">Costos Operativos Totales</p>
                <p className="text-3xl font-black font-mono tracking-tighter text-slate-300">{formatCurrency(stats.totalOperationalCosts)}</p>
                <p className="text-[8px] font-bold opacity-30 mt-2 uppercase">Mercancía, Fletes, Fijos</p>
              </div>
              <div className={`p-7 rounded-[2.5rem] text-white shadow-2xl flex flex-col justify-center transition-all duration-700 ${stats.net < 0 ? 'bg-rose-600' : 'bg-zinc-950'}`}>
                <p className="text-[10px] font-black opacity-70 uppercase mb-2">Profit Neto Real</p>
                <p className="text-4xl font-black font-mono tracking-tighter leading-none">{formatCurrency(stats.net)}</p>
              </div>
            </div>

            {/* LOGÍSTICA DE PEREIRA Y GASTOS */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="bg-white p-10 rounded-[3.5rem] border border-blue-100 shadow-sm space-y-8">
                <div className="flex justify-between items-center border-b border-slate-100 pb-5">
                  <h3 className="text-xs font-black uppercase text-slate-500 flex items-center gap-2 tracking-[0.2em]"><LucideTruck size={16} className="text-blue-500"/> Flujo Logístico (Guías)</h3>
                </div>
                <div className="grid grid-cols-2 gap-8">
                   <div className="space-y-6">
                      <div className="bg-slate-50 p-5 rounded-3xl">
                        <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Despachados (Eff)</p>
                        <p className="text-2xl font-black text-slate-900 font-mono">{stats.realShipped.toFixed(2)}</p>
                      </div>
                      <div className="bg-rose-50 p-5 rounded-3xl border border-rose-100">
                        <p className="text-[10px] font-black text-rose-400 uppercase mb-1">Devueltos</p>
                        <p className="text-2xl font-black text-rose-600 font-mono">{stats.estimatedReturns.toFixed(2)}</p>
                      </div>
                   </div>
                   <div className="space-y-6">
                      <div className="bg-emerald-50 p-5 rounded-3xl border border-emerald-100">
                        <p className="text-[10px] font-black text-emerald-700 uppercase mb-1">Entregas Finales</p>
                        <p className="text-3xl font-black text-emerald-600 font-mono">{stats.finalDeliveries.toFixed(2)}</p>
                      </div>
                      <div className="p-5 flex flex-col justify-center">
                        <p className="text-[10px] font-black text-slate-400 uppercase">Flete Real x Entrega</p>
                        <p className="text-xl font-black text-blue-600 font-mono">{formatCurrency(stats.totalFreightCost / (stats.finalDeliveries || 1))}</p>
                      </div>
                   </div>
                </div>
              </div>

              <div className="bg-white p-10 rounded-[3.5rem] border border-emerald-100 shadow-sm space-y-8">
                <div className="flex justify-between items-center border-b border-slate-100 pb-5">
                  <h3 className="text-xs font-black uppercase text-slate-500 flex items-center gap-2 tracking-[0.2em]"><LucideCalculator size={16} className="text-emerald-500"/> Desglose de Gastos</h3>
                </div>
                <div className="grid grid-cols-2 gap-8">
                   <div className="space-y-5">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Costo Mercancía (Unid):</span>
                        <span className="font-black text-rose-500 text-sm font-mono">{formatCurrency(stats.productCostTotal)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Comisiones (Unid):</span>
                        <span className="font-black text-slate-900 text-sm font-mono">{formatCurrency(stats.totalCommissions)}</span>
                      </div>
                      <div className="flex justify-between items-center border-t border-slate-50 pt-2">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Fijos Operativos (Guía):</span>
                        <span className="font-black text-slate-900 text-sm font-mono">{formatCurrency(stats.totalFixedCosts)}</span>
                      </div>
                   </div>
                   <div className="space-y-5 border-l border-slate-100 pl-8 text-xs font-bold">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-slate-400 uppercase tracking-tighter">Fletes Totales (Guía):</span>
                        <span className="font-black">{formatCurrency(stats.totalFreightCost)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-slate-400 uppercase tracking-tighter">Fulfillment (Guía):</span>
                        <span className="font-black">{formatCurrency(stats.totalFulfillment)}</span>
                      </div>
                      <div className="bg-zinc-950 p-4 rounded-2xl text-emerald-400 mt-2 text-center">
                        <p className="text-[8px] font-black uppercase mb-1">CPA Real x Entrega</p>
                        <p className="text-lg font-black font-mono tracking-tighter">{formatCurrency(stats.ad / (stats.finalDeliveries || 1))}</p>
                      </div>
                   </div>
                </div>
              </div>
            </div>

            {/* PROYECCIÓN SEMÁFORO MENSUAL */}
            <div className="space-y-6">
              <div className="flex items-center gap-2 ml-4">
                 <LucideLineChart size={18} className="text-emerald-500" />
                 <h2 className="text-sm font-black uppercase text-emerald-600 tracking-[0.3em]">Proyección Mensual a 30 Días</h2>
              </div>
              <div className={`p-10 rounded-[4rem] text-white shadow-2xl flex flex-col md:flex-row items-center justify-between gap-10 relative overflow-hidden transition-all duration-1000 ${projection.color}`}>
                <div className="absolute top-0 right-0 p-8 opacity-10"><LucideTrendingUp size={200} /></div>
                <div className="z-10 flex flex-col md:flex-row items-center gap-12 flex-1">
                   <div className="text-center md:text-left">
                      <p className="text-[11px] font-black uppercase tracking-[0.4em] opacity-60 mb-2">Estatus Proyectado</p>
                      <h2 className="text-7xl font-black italic tracking-tighter drop-shadow-2xl">{projection.label}</h2>
                   </div>
                   <div className="h-24 w-px bg-white/20 hidden md:block"></div>
                   <div className="text-center md:text-left">
                      <p className="text-[11px] font-black uppercase tracking-[0.4em] opacity-60 mb-1">Profit Promedio Diario</p>
                      <p className="text-3xl font-black font-mono tracking-tighter drop-shadow-xl">{formatCurrency(projection.avgDaily)}</p>
                   </div>
                </div>
                <div className="z-10 bg-zinc-950/30 backdrop-blur-xl p-10 rounded-[3.5rem] border border-white/20 min-w-[340px] text-center shadow-inner">
                   <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-70 mb-3">Profit Mensual Estimado</p>
                   <p className="text-6xl font-black font-mono tracking-tighter text-white drop-shadow-2xl">{formatCurrency(projection.totalProj)}</p>
                   <div className="mt-5 pt-5 border-t border-white/10 flex justify-between items-center text-[10px] font-black opacity-60 uppercase tracking-widest">
                      <span>Meta de Venta</span>
                      <span>{formatCurrency(stats.targetGoalRange)}</span>
                   </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VISTA 2: REGISTRO DIARIO */}
        {activeTab === 'records' && (
          <div className="max-w-2xl mx-auto bg-zinc-950 p-10 md:p-14 rounded-[4rem] text-white shadow-2xl animate-in slide-in-from-bottom-8 duration-500">
            <div className="flex justify-between items-end mb-10 border-b border-white/10 pb-8 text-center md:text-left">
              <div>
                <h2 className="text-3xl font-black uppercase italic text-emerald-400 tracking-tighter leading-none">{editingRecordId ? 'Ajustar Cierre' : 'Registrar Operación'}</h2>
                <p className="text-[10px] font-bold opacity-30 tracking-[0.4em] mt-3 uppercase tracking-widest">Input de Ventas</p>
              </div>
              <div className="bg-white/5 p-4 rounded-2xl border border-white/10 hover:border-emerald-500 transition-all cursor-pointer">
                <input type="date" className="bg-transparent text-emerald-400 font-black text-xs outline-none cursor-pointer" value={recordForm.date} onChange={e=>setRecordForm({...recordForm, date: e.target.value})} />
              </div>
            </div>

            <div className="space-y-10">
              <div className="space-y-3">
                <label className="text-[10px] font-black text-zinc-500 uppercase ml-2 tracking-widest">Seleccionar Estrategia Activa</label>
                <select className="w-full p-6 rounded-[2rem] bg-white/5 border border-white/10 text-white font-bold outline-none focus:border-emerald-500 transition-all appearance-none cursor-pointer" value={recordForm.configId} onChange={e => setRecordForm({...recordForm, configId: e.target.value})}>
                  <option value="">SELECCIONE...</option>
                  {Object.entries(groupedConfigs).map(([v, ps]) => (
                    <optgroup key={v} label={v.toUpperCase()} className="text-zinc-900 bg-white">
                      {ps.map(p => <option key={p.id} value={p.id}>{p.productName} ({v})</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-8">
                <div className="bg-white/5 p-8 rounded-[3rem] border border-white/5 space-y-4 hover:bg-white/10 transition-all text-center">
                  <label className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Guías (Paquetes)</label>
                  <input type="number" placeholder="0" className="w-full bg-transparent font-black text-6xl outline-none text-white text-center placeholder:text-zinc-800" value={recordForm.orders} onChange={e=>setRecordForm({...recordForm, orders: e.target.value})} />
                </div>
                <div className="bg-white/5 p-8 rounded-[3rem] border border-white/5 space-y-4 hover:bg-white/10 transition-all text-center">
                  <label className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Unid. Físicas</label>
                  <input type="number" placeholder="0" className="w-full bg-transparent font-black text-6xl outline-none text-white text-center placeholder:text-zinc-800" value={recordForm.units} onChange={e=>setRecordForm({...recordForm, units: e.target.value})} />
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-black text-zinc-500 uppercase ml-2 tracking-widest">Recaudo Bruto Total (Facturación)</label>
                <div className="relative">
                   <span className="absolute left-10 top-1/2 -translate-y-1/2 text-emerald-500 text-3xl font-black opacity-30">$</span>
                   <input type="number" placeholder="0" className="w-full p-12 rounded-[3.5rem] bg-white/5 border border-emerald-500/30 text-emerald-400 font-black text-6xl outline-none placeholder:text-zinc-800 pl-20 shadow-inner" value={recordForm.revenue} onChange={e=>setRecordForm({...recordForm, revenue: e.target.value})} />
                </div>
              </div>

              {recordForm.configId && !salesConfigs.find(c => c.id === recordForm.configId)?.fixedAdSpend && (
                 <div className="space-y-3 animate-in slide-in-from-top-4">
                   <label className="text-[10px] font-black text-rose-400 uppercase ml-2 tracking-widest flex items-center gap-2"><LucideTarget size={14}/> Inversión Ads (Manual)</label>
                   <input type="number" placeholder="Monto invertido hoy" className="w-full p-6 rounded-[2rem] bg-white/5 border border-rose-500/20 text-white font-black text-3xl outline-none text-center" value={recordForm.adSpend} onChange={e=>setRecordForm({...recordForm, adSpend: e.target.value})} />
                 </div>
              )}

              <div className="flex gap-4">
                <button onClick={handleSaveRecord} disabled={!recordForm.configId || !recordForm.orders || !recordForm.revenue} className="flex-1 bg-emerald-500 p-8 rounded-[2.5rem] font-black uppercase tracking-[0.5em] text-zinc-950 hover:bg-emerald-400 transition-all shadow-2xl shadow-emerald-500/40 active:scale-95 disabled:opacity-20 flex items-center justify-center gap-3">
                  <LucideSave size={20}/> {editingRecordId ? 'Actualizar Registro' : 'Cerrar Día'}
                </button>
                {editingRecordId && (
                  <button onClick={() => {setEditingRecordId(null); setRecordForm(initialRecord);}} className="bg-white/10 p-8 rounded-[2.5rem] text-white hover:bg-white/20 transition-all active:scale-95"><LucideX size={24}/></button>
                )}
              </div>
            </div>
            
            {/* TABLA DE AUDITORÍA RÁPIDA (VISTA DE REGISTROS DIARIOS) */}
            <div className="mt-12 border-t border-white/10 pt-8">
               <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 mb-6 flex items-center gap-2"><LucideEye size={14}/> Registros de Hoy</h3>
               <div className="space-y-3">
                  {dailyRecords.filter(r => r.date === recordForm.date).map(rec => {
                     const conf = salesConfigs.find(c => c.id === rec.configId);
                     return (
                        <div key={rec.id} className="bg-white/5 p-5 rounded-3xl flex justify-between items-center group hover:bg-white/10 transition-colors border border-transparent hover:border-white/10">
                           <div>
                              <p className="text-xs font-black text-white uppercase">{conf?.vendedora}</p>
                              <p className="text-[10px] font-bold text-emerald-400 uppercase">{conf?.productName}</p>
                           </div>
                           <div className="flex gap-4 items-center">
                              <span className="text-xs font-black text-zinc-400">{rec.orders} Guías</span>
                              <span className="text-xs font-black text-zinc-400 font-mono">{formatCurrency(rec.revenue)}</span>
                              <div className="flex gap-2">
                                 <button onClick={() => handleEditRecord(rec)} className="p-2 rounded-xl bg-white/10 text-white hover:bg-emerald-500 hover:text-zinc-900 transition-all"><LucidePencil size={14}/></button>
                                 <button onClick={() => deleteDoc(doc(db, 'daily_records', rec.id))} className="p-2 rounded-xl bg-white/10 text-white hover:bg-rose-500 transition-all"><LucideTrash2 size={14}/></button>
                              </div>
                           </div>
                        </div>
                     )
                  })}
               </div>
            </div>
          </div>
        )}

        {/* VISTA 3: CONFIGURACIÓN / ESTRATEGIAS */}
        {activeTab === 'config' && (
          <div className="space-y-10 animate-in fade-in duration-500">
            <div className="flex justify-between items-center border-b border-slate-200 pb-10 flex-wrap gap-8">
              <div>
                <h2 className="text-5xl font-black uppercase italic tracking-tighter text-zinc-900 leading-none">Configuración Maestro</h2>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.4em] mt-5">Definición de Esquemas de Costos x Producto</p>
              </div>
              <button onClick={() => { setEditingConfigId(null); setConfigForm(initialConfig); setIsCreatingConfig(true); }} className="bg-zinc-950 text-white px-12 py-6 rounded-[2.5rem] font-black text-[12px] uppercase flex items-center gap-4 hover:bg-zinc-800 transition-all shadow-2xl shadow-zinc-950/20 active:scale-95">
                <LucidePlus size={20} /> Crear Nueva Estrategia
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
              {Object.entries(groupedConfigs).map(([vendedora, productos]) => (
                <div key={vendedora} className="bg-white rounded-[4.5rem] border border-slate-200 shadow-sm overflow-hidden group hover:shadow-2xl transition-all duration-700">
                  <div className="bg-zinc-950 p-10 flex justify-between items-center relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-5 text-white font-black text-8xl leading-none tracking-tighter italic select-none uppercase">{vendedora}</div>
                    <div className="flex items-center gap-4 z-10">
                       <div className="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center font-black text-zinc-950 shadow-lg shadow-emerald-500/20">VN</div>
                       <h3 className="text-white font-black uppercase tracking-[0.2em] text-lg">{vendedora}</h3>
                    </div>
                    <span className="bg-white/10 text-white text-[10px] px-5 py-2 rounded-full font-black tracking-widest z-10 border border-white/10">{productos.length} SKUS</span>
                  </div>
                  <div className="p-10 space-y-6">
                    {productos.map(prod => (
                      <div key={prod.id} className="p-7 rounded-[3rem] bg-slate-50 border-2 border-transparent hover:border-emerald-400/20 hover:bg-white transition-all flex justify-between items-center group/item shadow-sm hover:shadow-lg">
                        <div className="flex-1">
                          <p className="font-black text-slate-900 text-base uppercase leading-none mb-4">{prod.productName}</p>
                          <div className="flex gap-4 flex-wrap">
                            <div className="flex flex-col"><span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Efectividad</span><span className="text-xs font-black text-slate-700">{prod.effectiveness}%</span></div>
                            <div className="flex flex-col"><span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Devolución</span><span className="text-xs font-black text-rose-500">{prod.returnRate}%</span></div>
                            <div className="flex flex-col"><span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Flete Base</span><span className="text-xs font-black text-emerald-600">{formatCurrency(prod.freight)}</span></div>
                            <div className="flex flex-col"><span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Costo Und</span><span className="text-xs font-black text-slate-700">{formatCurrency(prod.productCost)}</span></div>
                          </div>
                        </div>
                        <div className="flex gap-3 ml-6">
                           <button onClick={() => handleEditConfig(prod)} className="p-4 rounded-2xl bg-white text-slate-300 hover:text-emerald-500 hover:bg-emerald-50 shadow-md transition-all active:scale-90"><LucidePencil size={18}/></button>
                           <button onClick={() => deleteDoc(doc(db, 'sales_configs', prod.id))} className="p-4 rounded-2xl bg-white text-slate-300 hover:text-rose-500 hover:bg-rose-50 shadow-md transition-all active:scale-90"><LucideTrash2 size={18}/></button>
                        </div>
                      </div>
                    ))}
                    <button 
                      onClick={() => {setConfigForm({...initialConfig, vendedora}); setEditingConfigId(null); setIsCreatingConfig(true);}}
                      className="w-full py-7 border-2 border-dashed border-slate-200 rounded-[3.5rem] text-[11px] font-black text-slate-400 uppercase hover:border-emerald-400 hover:text-emerald-500 transition-all flex items-center justify-center gap-3 bg-slate-50/30 active:scale-98"
                    >
                      <LucidePlus size={18}/> Nuevo Producto para {vendedora}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* MODAL CONFIGURACIÓN ESTRATEGIA (VISTA 1) */}
        {isCreatingConfig && (
          <div className="fixed inset-0 bg-zinc-950/95 backdrop-blur-3xl flex items-center justify-center z-[100] p-4">
            <div className="bg-white w-full max-w-5xl rounded-[4.5rem] p-12 md:p-16 max-h-[92vh] overflow-y-auto space-y-14 animate-in zoom-in-95 shadow-2xl relative">
              <div className="flex justify-between items-start border-b border-slate-100 pb-10">
                <div>
                   <h2 className="text-5xl font-black uppercase italic text-zinc-900 tracking-tighter leading-none">{editingConfigId ? 'Ajustar Estrategia' : 'Nueva Estrategia SKU'}</h2>
                   <p className="text-[12px] font-black text-slate-400 mt-5 uppercase tracking-[0.4em]">Configuración de Costos y Rentabilidad Real</p>
                </div>
                <button onClick={() => setIsCreatingConfig(false)} className="bg-slate-100 p-6 rounded-full hover:bg-rose-50 hover:text-rose-500 transition-all active:scale-90 shadow-sm"><LucideX size={28}/></button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
                <div className="col-span-2 space-y-3">
                  <label className="text-[11px] font-black uppercase ml-3 text-slate-400 tracking-widest">Nombre de Vendedora</label>
                  <input className="w-full p-6 bg-slate-50 rounded-3xl font-black uppercase text-base border-2 border-transparent focus:border-emerald-400 outline-none transition-all shadow-inner" value={configForm.vendedora} onChange={e => setConfigForm({...configForm, vendedora: e.target.value})} placeholder="EJ: CAMILA PERILLA" />
                </div>
                <div className="col-span-2 space-y-3">
                  <label className="text-[11px] font-black uppercase ml-3 text-slate-400 tracking-widest">Nombre del Producto (SKU)</label>
                  <input className="w-full p-6 bg-slate-50 rounded-3xl font-black uppercase text-base border-2 border-transparent focus:border-emerald-400 outline-none transition-all shadow-inner" value={configForm.productName} onChange={e => setConfigForm({...configForm, productName: e.target.value})} placeholder="EJ: COMBO KERATINA X2" />
                </div>

                <div className="bg-emerald-50/70 p-8 rounded-[3.5rem] space-y-4 border border-emerald-100 shadow-sm">
                   <label className="text-[10px] font-black text-emerald-700 uppercase tracking-[0.2em] text-center block">Efectividad %</label>
                   <input type="number" className="w-full bg-transparent font-black text-6xl outline-none text-emerald-950 text-center" value={configForm.effectiveness} onChange={e => setConfigForm({...configForm, effectiveness: e.target.value})} />
                </div>
                <div className="bg-rose-50/70 p-8 rounded-[3.5rem] space-y-4 border border-rose-100 shadow-sm">
                   <label className="text-[10px] font-black text-rose-700 uppercase tracking-[0.2em] text-center block">Devolución %</label>
                   <input type="number" className="w-full bg-transparent font-black text-6xl outline-none text-rose-950 text-center" value={configForm.returnRate} onChange={e => setConfigForm({...configForm, returnRate: e.target.value})} />
                </div>

                <div className="col-span-2 bg-zinc-950 p-8 rounded-[3.5rem] flex items-center gap-10 shadow-2xl shadow-zinc-950/20">
                  <div className="flex-1">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em] mb-3 block text-center md:text-left">Inversión Ads Estándar</label>
                    <input type="number" className="w-full bg-transparent text-emerald-400 font-black text-6xl outline-none text-center md:text-left" value={configForm.dailyAdSpend} onChange={e => setConfigForm({...configForm, dailyAdSpend: e.target.value})} placeholder="0" />
                  </div>
                  <div className="flex flex-col items-center border-l border-white/10 pl-10">
                    <span className="text-[9px] font-black text-zinc-500 mb-3 uppercase tracking-tighter">ADS FIJO</span>
                    <button 
                      onClick={() => setConfigForm({...configForm, fixedAdSpend: !configForm.fixedAdSpend})}
                      className={`w-16 h-9 rounded-full relative transition-all duration-500 ${configForm.fixedAdSpend ? 'bg-emerald-500 shadow-lg shadow-emerald-500/20' : 'bg-zinc-800'}`}
                    >
                      <div className={`absolute top-1.5 w-6 h-6 bg-white rounded-full transition-all duration-500 shadow-xl ${configForm.fixedAdSpend ? 'left-8' : 'left-2'}`}></div>
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                   <label className="text-[11px] font-black uppercase text-slate-400 ml-3">Costo Producto (Und)</label>
                   <input type="number" className="w-full p-6 bg-slate-50 rounded-3xl font-black border-2 border-transparent focus:border-emerald-400 outline-none shadow-inner" value={configForm.productCost} onChange={e => setConfigForm({...configForm, productCost: e.target.value})} />
                </div>
                <div className="space-y-3">
                   <label className="text-[11px] font-black uppercase text-slate-400 ml-3">Flete Base (Paquete)</label>
                   <input type="number" className="w-full p-6 bg-slate-50 rounded-3xl font-black border-2 border-transparent focus:border-emerald-400 outline-none shadow-inner" value={configForm.freight} onChange={e => setConfigForm({...configForm, freight: e.target.value})} />
                </div>
                <div className="space-y-3">
                   <label className="text-[11px] font-black uppercase text-slate-400 ml-3">Comisión (Und Entregada)</label>
                   <input type="number" className="w-full p-6 bg-slate-50 rounded-3xl font-black border-2 border-transparent focus:border-emerald-400 outline-none shadow-inner" value={configForm.commission} onChange={e => setConfigForm({...configForm, commission: e.target.value})} />
                </div>
                <div className="space-y-3">
                   <label className="text-[11px] font-black uppercase text-emerald-600 ml-3">Utilidad Meta Mes</label>
                   <input type="number" className="w-full p-6 bg-emerald-50 rounded-3xl font-black border-2 border-emerald-200 outline-none text-emerald-700 shadow-inner" value={configForm.targetProfit} onChange={e => setConfigForm({...configForm, targetProfit: e.target.value})} />
                </div>

                <div className="col-span-2 space-y-3">
                   <label className="text-[11px] font-black uppercase text-slate-400 ml-3">Costos Fulfillment (X Salida de Bodega)</label>
                   <input type="number" className="w-full p-6 bg-slate-50 rounded-3xl font-black border-2 border-transparent focus:border-emerald-400 outline-none shadow-inner" value={configForm.fulfillment} onChange={e => setConfigForm({...configForm, fulfillment: e.target.value})} placeholder="Insumos, Empaque, Bodega" />
                </div>
                <div className="col-span-2 space-y-3">
                   <label className="text-[11px] font-black uppercase text-slate-400 ml-3">Gastos Fijos (X Paquete Entregado)</label>
                   <input type="number" className="w-full p-6 bg-slate-50 rounded-3xl font-black border-2 border-transparent focus:border-emerald-400 outline-none shadow-inner" value={configForm.fixedCosts} onChange={e => setConfigForm({...configForm, fixedCosts: e.target.value})} placeholder="Ej: 2000" />
                </div>
              </div>

              <div className="pt-8">
                <button 
                  onClick={handleSaveConfig}
                  className="w-full bg-zinc-950 p-12 rounded-[4rem] font-black uppercase tracking-[0.7em] text-emerald-400 hover:text-white transition-all shadow-2xl active:scale-[0.97] flex items-center justify-center gap-6 group overflow-hidden relative"
                >
                  <div className="absolute inset-0 bg-emerald-500/5 group-hover:bg-emerald-500/10 transition-colors"></div>
                  <LucideSave size={32} className="group-hover:rotate-12 transition-transform duration-500 z-10" />
                  <span className="text-xl z-10 tracking-widest">{editingConfigId ? 'Actualizar Esquema Maestro' : 'Guardar Esquema Maestro'}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
