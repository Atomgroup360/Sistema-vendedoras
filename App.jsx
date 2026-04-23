import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, collection, addDoc, setDoc, updateDoc, deleteDoc, doc, 
  onSnapshot, serverTimestamp 
} from 'firebase/firestore';
import { 
  getAuth, 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  signOut 
} from 'firebase/auth';

// --- CONFIGURACIÓN DE FIREBASE (Asegúrate de colocar tus credenciales reales aquí) ---
const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_DOMINIO",
  projectId: "TU_PROJECT_ID",
  storageBucket: "TU_STORAGE_BUCKET",
  messagingSenderId: "TU_SENDER_ID",
  appId: "TU_APP_ID"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- MODELOS DE DATOS INICIALES ---
const getInitialSalesConfig = () => ({
  vendedora: '', 
  productName: '', 
  targetProfit: '', 
  productCost: '', 
  freight: '', 
  commission: '', 
  returnRate: '', 
  effectiveness: '', 
  fulfillment: '', 
  fixedCosts: '', 
  fixedAdSpend: false, 
  dailyAdSpend: ''
});

const getInitialSaleRecord = () => ({
  date: new Date().toISOString().split('T')[0], 
  configId: '', 
  orders: '', 
  units: '', 
  revenue: '', 
  adSpend: ''
});

// --- AYUDANTES ---
const formatCurrency = (val) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(val || 0);

// --- COMPONENTES UI ATÓMICOS ---
const InputP = ({ label, value, onChange, type="number", prefix="", suffix="", disabled=false }) => {
  let displayVal = value;
  if (type === 'currency') displayVal = value ? new Intl.NumberFormat('es-CO').format(value) : '';
  
  const handleInput = (e) => {
    if (type === 'currency') {
      const num = e.target.value.replace(/\D/g, '');
      onChange(num !== '' ? parseFloat(num) : '');
    } else onChange(e.target.value !== '' ? parseFloat(e.target.value) : '');
  };

  return (
    <div className={`bg-emerald-50/70 p-3 rounded-xl border-2 border-emerald-100 transition-all ${disabled ? 'opacity-50' : 'focus-within:border-emerald-400'}`}>
      <label className="text-[9px] font-black text-emerald-700 uppercase block mb-1">{label}</label>
      <div className="flex items-center gap-1">
        {prefix && <span className="text-emerald-600 font-bold">{prefix}</span>}
        <input type={type === 'currency' ? 'text' : type} value={displayVal} onChange={handleInput} disabled={disabled} className="w-full bg-transparent text-sm font-bold text-emerald-950 outline-none font-mono" placeholder="0" />
        {suffix && <span className="text-emerald-600 font-bold">{suffix}</span>}
      </div>
    </div>
  );
};

const OutputP = ({ label, value, type="currency", decimals=2, highlight=false, customBg }) => {
  let displayValue = 0;
  const numValue = parseFloat(value) || 0;
  if (type === "currency") displayValue = formatCurrency(numValue);
  else if (type === "number") displayValue = numValue.toFixed(decimals);
  else if (type === "percent") displayValue = `${numValue.toFixed(decimals)}%`;

  return (
    <div className={`p-4 rounded-2xl border text-left flex flex-col justify-center ${customBg || (highlight ? 'bg-zinc-900 border-zinc-900 shadow-lg' : 'bg-zinc-50 border-zinc-200 shadow-inner')}`}>
      <label className={`text-[8px] font-black uppercase mb-1 ${highlight ? 'text-zinc-400' : 'text-zinc-500'}`}>{label}</label>
      <div className={`font-mono text-sm md:text-lg font-black truncate ${highlight ? 'text-white' : 'text-zinc-800'}`}>{displayValue}</div>
    </div>
  );
};

// --- APLICACIÓN PRINCIPAL ---
export default function App() {
  const [user, setUser] = useState(null);
  const [salesConfigs, setSalesConfigs] = useState([]);
  const [salesMonths, setSalesMonths] = useState([]);
  const [activeTab, setActiveTab] = useState('dashboard'); // dashboard, records, config
  
  // Estados de Formularios y Modales
  const [isCreatingConfig, setIsCreatingConfig] = useState(false);
  const [newConfig, setNewConfig] = useState(getInitialSalesConfig());
  const [newRecord, setNewRecord] = useState(getInitialSaleRecord());
  const [isSaving, setIsSaving] = useState(false);

  // Filtros del Dashboard
  const [filter, setFilter] = useState({
     startDate: new Date(new Date().setDate(1)).toISOString().split('T')[0],
     endDate: new Date().toISOString().split('T')[0],
     vendedora: 'all',
     producto: 'all'
  });

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (user) {
      const unsubConfigs = onSnapshot(collection(db, 'sales_configs'), (snap) => {
        setSalesConfigs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      });
      const unsubMonths = onSnapshot(collection(db, 'sales_months'), (snap) => {
        setSalesMonths(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      });
      return () => { unsubConfigs(); unsubMonths(); };
    }
  }, [user]);

  // AGRUPACIÓN PARA SELECTS
  const groupedConfigs = useMemo(() => salesConfigs.reduce((acc, c) => {
    if (!acc[c.vendedora]) acc[c.vendedora] = [];
    acc[c.vendedora].push(c);
    return acc;
  }, {}), [salesConfigs]);

  // --- LÓGICA DE CÁLCULO DE RENDIMIENTO ---
  const stats = useMemo(() => {
    const allRecords = salesMonths.flatMap(m => m.records || []);
    const filtered = allRecords.filter(r => {
      const d = new Date(r.date);
      const conf = salesConfigs.find(c => c.id === r.configId);
      const start = new Date(filter.startDate);
      const end = new Date(filter.endDate);
      end.setHours(23, 59, 59);

      return d >= start && d <= end &&
             conf && (filter.vendedora === 'all' || conf.vendedora === filter.vendedora) &&
             (filter.producto === 'all' || r.configId === filter.producto);
    });

    let res = { 
      grossRev: 0, realRev: 0, ad: 0, ord: 0, net: 0, 
      effDel: 0, costs: 0, prodCosts: 0, logCosts: 0, commCosts: 0, fixedCosts: 0 
    };

    filtered.forEach(r => {
      const c = salesConfigs.find(conf => conf.id === r.configId);
      if (!c) return;

      // FÓRMULA DE ÍNDICE EFECTIVO (Ej: 95% Eff - 20% Dev = 75% Real)
      const index = (parseFloat(c.effectiveness) - parseFloat(c.returnRate)) / 100;
      
      const dayGrossRev = parseFloat(r.revenue) || 0;
      const dayRealRev = dayGrossRev * index;
      const dayEffOrd = (parseFloat(r.orders) || 0) * index;
      const dayEffUni = (parseFloat(r.units) || 0) * index;
      
      res.grossRev += dayGrossRev;
      res.realRev += dayRealRev;
      res.ad += (parseFloat(r.adSpend) || 0);
      res.ord += (parseFloat(r.orders) || 0);
      res.effDel += dayEffOrd;
      
      const dayProdCost = dayEffUni * (parseFloat(c.productCost) || 0);
      // Flete y Fulfillment se cobran sobre el despacho bruto de ida
      const dayLogCost = (parseFloat(r.orders) || 0) * ((parseFloat(c.freight) || 0) + (parseFloat(c.fulfillment) || 0));
      const dayCommCost = dayEffOrd * (parseFloat(c.commission) || 0);
      const dayFixed = dayEffOrd * (parseFloat(c.fixedCosts) || 0);
      
      res.prodCosts += dayProdCost;
      res.logCosts += dayLogCost;
      res.commCosts += dayCommCost;
      res.fixedCosts += dayFixed;
      res.costs += (dayProdCost + dayLogCost + dayCommCost + dayFixed);
    });

    res.net = res.realRev - res.costs - res.ad;
    res.roas = res.ad > 0 ? res.realRev / res.ad : 0;
    res.cpaReal = res.effDel > 0 ? res.ad / res.effDel : 0;
    res.margin = res.realRev > 0 ? (res.net / res.realRev) * 100 : 0;

    // Proyección mensual simple basada en promedio diario
    const activeDays = new Set(filtered.map(r => r.date)).size || 1;
    res.projectedMonthly = (res.realRev / activeDays) * 30;

    return res;
  }, [salesMonths, salesConfigs, filter]);

  // FUNCIONES DE ACCIÓN
  const handleRecordConfigSelect = (configId) => {
    const conf = salesConfigs.find(c => c.id === configId);
    setNewRecord({
      ...newRecord, 
      configId, 
      adSpend: conf?.fixedAdSpend ? (parseFloat(conf.dailyAdSpend) || 0) : ''
    });
  };

  const saveConfig = async () => {
    setIsSaving(true);
    try {
      await addDoc(collection(db, 'sales_configs'), { ...newConfig, createdAt: Date.now() });
      setIsCreatingConfig(false);
      setNewConfig(getInitialSalesConfig());
    } catch (e) { console.error(e); } finally { setIsSaving(false); }
  };

  const saveRecord = async () => {
    if (!newRecord.configId) return;
    setIsSaving(true);
    try {
      const monthId = newRecord.date.substring(0, 7);
      const ref = doc(db, 'sales_months', monthId);
      const exist = salesMonths.find(m => m.id === monthId);
      const rec = { ...newRecord, id: Date.now().toString() };
      
      if (exist) await updateDoc(ref, { records: [...exist.records, rec] });
      else await setDoc(ref, { records: [rec] });
      
      setNewRecord(getInitialSaleRecord());
    } catch (e) { console.error(e); } finally { setIsSaving(false); }
  };

  const deleteRecord = async (date, recordId) => {
    if (!window.confirm('¿Eliminar este registro?')) return;
    const monthId = date.substring(0, 7);
    const exist = salesMonths.find(m => m.id === monthId);
    if (exist) {
      await updateDoc(doc(db, 'sales_months', monthId), {
        records: exist.records.filter(r => r.id !== recordId)
      });
    }
  };

  if (!user) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6 text-white text-center">
      <div className="space-y-4">
        <div className="w-16 h-16 bg-emerald-500 rounded-2xl flex items-center justify-center text-3xl font-black italic mx-auto shadow-xl">W</div>
        <h1 className="text-2xl font-black uppercase tracking-widest">Inicia Sesión para Continuar</h1>
        <p className="text-slate-400 text-sm max-w-xs">Configura Firebase Authentication y reglas de Firestore para acceder.</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-100 p-2 md:p-8 font-sans text-slate-900">
      <div className="max-w-7xl mx-auto space-y-6 md:space-y-10">
        
        {/* CABECERA Y NAVEGACIÓN */}
        <header className="flex flex-col md:flex-row justify-between items-center bg-white p-4 md:p-6 rounded-[2rem] shadow-sm border border-slate-200 gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-emerald-600 rounded-2xl flex items-center justify-center text-white text-2xl font-black italic shadow-lg">W</div>
            <div className="text-left">
              <h1 className="text-xl font-black uppercase tracking-tight leading-none text-slate-800">Winner Sales OS</h1>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">Gestión de Rendimiento Real</p>
            </div>
          </div>
          <nav className="flex gap-1 bg-slate-100 p-1.5 rounded-2xl w-full md:w-auto overflow-x-auto no-scrollbar">
            {[
              { id: 'dashboard', label: '📊 Dashboard', color: 'bg-emerald-600' },
              { id: 'records', label: '📝 Cierre Diario', color: 'bg-emerald-600' },
              { id: 'config', label: '⚙️ Configuración', color: 'bg-emerald-600' }
            ].map(t => (
              <button key={t.id} onClick={()=>setActiveTab(t.id)} className={`flex-1 md:flex-none px-4 md:px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${activeTab === t.id ? `${t.color} text-white shadow-md scale-105` : 'text-slate-400 hover:text-slate-600'}`}>
                {t.label}
              </button>
            ))}
          </nav>
        </header>

        {/* --- TAB 1: DASHBOARD DE RENDIMIENTO --- */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6 animate-in fade-in duration-500">
            {/* PANEL DE FILTROS */}
            <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-200 grid grid-cols-1 md:grid-cols-4 gap-4 items-end text-left">
               <div><label className="text-[10px] font-black text-slate-400 uppercase ml-2 mb-1 block">Desde</label>
               <input type="date" value={filter.startDate} onChange={e=>setFilter({...filter, startDate: e.target.value})} className="w-full p-3 rounded-2xl border bg-slate-50 font-bold outline-none focus:border-emerald-400 text-sm" /></div>
               
               <div><label className="text-[10px] font-black text-slate-400 uppercase ml-2 mb-1 block">Hasta</label>
               <input type="date" value={filter.endDate} onChange={e=>setFilter({...filter, endDate: e.target.value})} className="w-full p-3 rounded-2xl border bg-slate-50 font-bold outline-none focus:border-emerald-400 text-sm" /></div>
               
               <div><label className="text-[10px] font-black text-slate-400 uppercase ml-2 mb-1 block">Vendedora</label>
               <select value={filter.vendedora} onChange={e=>setFilter({...filter, vendedora: e.target.value, producto: 'all'})} className="w-full p-3 rounded-2xl border bg-slate-50 font-bold outline-none focus:border-emerald-400 text-sm">
                 <option value="all">TODAS</option>
                 {Object.keys(groupedConfigs).map(v => <option key={v} value={v}>{v.toUpperCase()}</option>)}
               </select></div>
               
               <div><label className="text-[10px] font-black text-slate-400 uppercase ml-2 mb-1 block">Producto</label>
               <select value={filter.producto} onChange={e=>setFilter({...filter, producto: e.target.value})} disabled={filter.vendedora === 'all'} className="w-full p-3 rounded-2xl border bg-slate-50 font-bold outline-none focus:border-emerald-400 text-sm disabled:opacity-30">
                 <option value="all">TODOS LOS PRODUCTOS</option>
                 {filter.vendedora !== 'all' && groupedConfigs[filter.vendedora]?.map(c => <option key={c.id} value={c.id}>{c.productName.toUpperCase()}</option>)}
               </select></div>
            </div>

            {/* TARJETAS DE MÉTRICAS GLOBALES */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm text-left">
                <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Facturación Real</p>
                <p className="text-xl md:text-3xl font-black font-mono text-slate-800">{formatCurrency(stats.realRev)}</p>
              </div>
              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm text-left">
                <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Inversión Publicidad</p>
                <p className="text-xl md:text-3xl font-black font-mono text-slate-800">{formatCurrency(stats.ad)}</p>
              </div>
              <div className="bg-emerald-600 p-5 rounded-3xl shadow-xl text-white text-left">
                <p className="text-[10px] font-black opacity-80 uppercase mb-1">ROAS Promedio</p>
                <p className="text-3xl md:text-5xl font-black italic">{stats.roas.toFixed(2)}</p>
              </div>
              <div className={`p-5 rounded-3xl shadow-xl text-white text-left ${stats.net < 0 ? 'bg-rose-500' : 'bg-zinc-900'}`}>
                <p className="text-[10px] font-black opacity-80 uppercase mb-1">Profit Neto Real</p>
                <p className="text-xl md:text-3xl font-black font-mono">{formatCurrency(stats.net)}</p>
              </div>
            </div>

            {/* DESGLOSE DETALLADO */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
               <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                  <h3 className="font-black uppercase text-xs tracking-tighter border-b pb-2 text-slate-800">📦 Operación y Eficiencia</h3>
                  <OutputP label="Facturación Bruta (Ingresada)" value={stats.grossRev} customBg="bg-slate-50" />
                  <OutputP label="Pedidos Brutos Despachados" value={stats.ord} type="number" decimals={0} />
                  <OutputP label="Entregas Efectivas Est." value={stats.effDel} type="number" decimals={1} customBg="bg-emerald-50 border-emerald-100" customText="text-emerald-800" />
                  <OutputP label="CPA Real Promedio" value={stats.cpaReal} highlight />
               </div>

               <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                  <h3 className="font-black uppercase text-xs tracking-tighter border-b pb-2 text-rose-500">💳 Desglose de Costos Reales</h3>
                  <OutputP label="Costo de Productos (Entregados)" value={stats.prodCosts} customBg="bg-rose-50 border-rose-100" customText="text-rose-900" />
                  <OutputP label="Logística de Ida (Bruta)" value={stats.logCosts} customBg="bg-rose-50 border-rose-100" customText="text-rose-900" />
                  <OutputP label="Comisiones Pagadas" value={stats.commCosts} customBg="bg-rose-50 border-rose-100" customText="text-rose-900" />
                  <OutputP label="Gastos Fijos Acum." value={stats.fixedCosts} customBg="bg-rose-50 border-rose-100" customText="text-rose-900" />
               </div>

               <div className="bg-zinc-900 rounded-3xl p-8 shadow-2xl space-y-6 text-white relative overflow-hidden flex flex-col justify-center">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/20 rounded-full blur-[40px] -mr-10 -mt-10"></div>
                  <h3 className="text-[11px] font-black text-zinc-400 uppercase tracking-widest border-b border-zinc-800 pb-2 relative z-10">🚀 Proyección de Cierre</h3>
                  <div className="relative z-10 space-y-4">
                      <div>
                        <p className="text-[10px] font-bold text-zinc-500 uppercase mb-1">Estimado Mensual (Ingresos)</p>
                        <p className="text-3xl font-mono font-black text-emerald-400 leading-none">{formatCurrency(stats.projectedMonthly)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-zinc-500 uppercase mb-1">Margen Neto Operativo</p>
                        <p className={`text-4xl font-black italic leading-none ${stats.margin > 0 ? 'text-white' : 'text-rose-500'}`}>{stats.margin.toFixed(2)}%</p>
                      </div>
                  </div>
               </div>
            </div>
          </div>
        )}

        {/* --- TAB 2: CIERRE DIARIO --- */}
        {activeTab === 'records' && (
          <div className="space-y-6 animate-in slide-in-from-bottom-6 duration-500 text-left">
             <div className="bg-emerald-600 p-6 md:p-10 rounded-[2.5rem] text-white shadow-2xl border border-emerald-500 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-[80px] -mr-20 -mt-20"></div>
                <h2 className="text-2xl md:text-3xl font-black uppercase italic tracking-tighter mb-6 relative z-10">Cierre de Ventas Diario</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 relative z-10">
                   <div className="md:col-span-2">
                     <label className="text-[9px] font-black text-emerald-200 uppercase px-1 block mb-1">Vendedora - Producto</label>
                     <select value={newRecord.configId} onChange={e=>handleRecordConfigSelect(e.target.value)} className="w-full p-4 rounded-2xl bg-white/20 border border-white/20 font-bold outline-none text-sm transition-all focus:bg-white/30 [&>optgroup]:text-zinc-900 [&>option]:text-zinc-900">
                        <option value="" disabled>SELECCIONAR...</option>
                        {Object.entries(groupedConfigs).map(([v, ps]) => (
                          <optgroup key={v} label={v.toUpperCase()}>
                            {ps.map(c => <option key={c.id} value={c.id}>{c.productName}</option>)}
                          </optgroup>
                        ))}
                     </select>
                   </div>

                   <div className="lg:col-span-1">
                     <label className="text-[9px] font-black text-emerald-200 uppercase px-1 block mb-1">Fecha</label>
                     <input type="date" value={newRecord.date} onChange={e=>setNewRecord({...newRecord, date: e.target.value})} className="w-full p-4 rounded-2xl bg-white/20 border border-white/20 font-bold text-center outline-none focus:bg-white/30" />
                   </div>

                   <div>
                     <label className="text-[9px] font-black text-emerald-200 uppercase px-1 block mb-1">Pedidos D.</label>
                     <input type="number" value={newRecord.orders} onChange={e=>setNewRecord({...newRecord, orders: e.target.value})} className="w-full p-4 rounded-2xl bg-white/20 border border-white/20 text-center font-black outline-none focus:bg-white/30" placeholder="0" />
                   </div>

                   <div>
                     <label className="text-[9px] font-black text-emerald-200 uppercase px-1 block mb-1">Unds Total</label>
                     <input type="number" value={newRecord.units} onChange={e=>setNewRecord({...newRecord, units: e.target.value})} className="w-full p-4 rounded-2xl bg-white/20 border border-white/20 text-center font-black outline-none focus:bg-white/30" placeholder="0" />
                   </div>

                   <div>
                     <label className="text-[9px] font-black text-emerald-200 uppercase px-1 block mb-1">Inv. FB</label>
                     <input type="number" value={newRecord.adSpend} onChange={e=>setNewRecord({...newRecord, adSpend: e.target.value})} disabled={salesConfigs.find(c=>c.id===newRecord.configId)?.fixedAdSpend} className="w-full p-4 rounded-2xl bg-white/20 border border-white/20 text-center font-black outline-none focus:bg-white/30 disabled:opacity-30" placeholder="0" />
                   </div>

                   <div className="md:col-span-4 lg:col-span-5">
                     <label className="text-[9px] font-black text-emerald-200 uppercase px-1 block mb-1">Facturación Bruta (Ingreso Total sin descontar costos)</label>
                     <div className="flex items-center gap-2 bg-white/20 border border-white/20 rounded-2xl px-4 focus-within:bg-white/30 transition-all">
                        <span className="font-bold text-emerald-200">$</span>
                        <input type="text" value={newRecord.revenue ? new Intl.NumberFormat('es-CO').format(newRecord.revenue) : ''} onChange={e=>{const v = e.target.value.replace(/\D/g,''); setNewRecord({...newRecord, revenue: v!==''?parseFloat(v):''});}} className="w-full bg-transparent p-4 pl-0 text-lg font-mono font-bold outline-none" placeholder="0" />
                     </div>
                   </div>

                   <div className="md:col-span-2 lg:col-span-1 flex items-end">
                     <button onClick={saveRecord} disabled={isSaving} className="w-full bg-white text-emerald-700 p-5 rounded-2xl font-black uppercase tracking-widest shadow-xl active:scale-95 transition-all hover:bg-slate-50 disabled:opacity-50">
                        {isSaving ? '⏳...' : 'Guardar Cierre'}
                     </button>
                   </div>
                </div>
             </div>

             {/* TABLA DE REGISTROS RECIENTES */}
             <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b bg-slate-50 flex justify-between items-center">
                   <h3 className="text-xs font-black uppercase text-slate-500 tracking-widest px-2">Historial de Cierres (Últimos 30)</h3>
                </div>
                <div className="overflow-x-auto">
                   <table className="w-full text-left border-collapse">
                      <thead>
                         <tr className="bg-slate-50 text-[9px] uppercase tracking-widest text-slate-400 border-b">
                            <th className="p-4">Fecha</th>
                            <th className="p-4">Vendedora / Producto</th>
                            <th className="p-4">FB</th>
                            <th className="p-4">Ped/Und</th>
                            <th className="p-4">Fact. Bruta</th>
                            <th className="p-4 text-center">Acción</th>
                         </tr>
                      </thead>
                      <tbody>
                         {allRecords.sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0, 30).map(r => {
                            const c = salesConfigs.find(conf=>conf.id===r.configId);
                            return (
                               <tr key={r.id} className="border-b last:border-0 hover:bg-slate-50 text-[11px] md:text-sm font-bold text-slate-700 transition-colors">
                                  <td className="p-4 font-mono">{r.date}</td>
                                  <td className="p-4">
                                     <p className="leading-none">{c ? c.vendedora : '???'}</p>
                                     <p className="text-[10px] text-slate-400 uppercase mt-1">{c ? c.productName : '???'}</p>
                                  </td>
                                  <td className="p-4 font-mono text-slate-400">{formatCurrency(r.adSpend)}</td>
                                  <td className="p-4 font-mono">{r.orders} / <span className="text-emerald-600">{r.units}</span></td>
                                  <td className="p-4 font-mono text-slate-900">{formatCurrency(r.revenue)}</td>
                                  <td className="p-4 text-center">
                                     <button onClick={()=>deleteRecord(r.date, r.id)} className="text-slate-300 hover:text-rose-500 p-2 transition-all hover:scale-110">
                                        <svg className="w-4 h-4 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                     </button>
                                  </td>
                               </tr>
                            );
                         })}
                      </tbody>
                   </table>
                   {allRecords.length === 0 && <div className="p-10 text-center text-slate-400 font-bold uppercase text-xs tracking-widest">No hay datos registrados aún.</div>}
                </div>
             </div>
          </div>
        )}

        {/* --- TAB 3: CONFIGURACIÓN DE EQUIPOS --- */}
        {activeTab === 'config' && (
          <div className="space-y-6 text-left animate-in fade-in duration-500">
            <div className="flex justify-between items-center bg-white p-4 rounded-2xl border shadow-sm">
              <h2 className="text-xl font-black uppercase italic tracking-tighter text-slate-800">Estrategias de Costos</h2>
              <button onClick={()=>setIsCreatingConfig(true)} className="bg-zinc-900 text-white px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-xl active:scale-95 transition-all hover:bg-black">➕ Añadir Vendedora</button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pb-20">
               {Object.entries(groupedConfigs).map(([vName, products]) => (
                 <div key={vName} className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                    <div className="bg-slate-900 text-white p-5 flex justify-between items-center">
                       <h3 className="font-black uppercase tracking-widest truncate mr-4">{vName}</h3>
                       <button onClick={()=>{setNewConfig({...getInitialSalesConfig(), vendedora: vName}); setIsCreatingConfig(true);}} className="text-[9px] bg-emerald-500 text-white px-4 py-2 rounded-xl font-black uppercase shadow-lg active:scale-95 transition-all">➕ Producto</button>
                    </div>
                    <div className="p-0 flex-1">
                       {products.map(c => (
                         <div key={c.id} className="p-5 border-b last:border-0 hover:bg-slate-50 transition-colors group">
                            <div className="flex justify-between items-start mb-4">
                               <div>
                                  <h4 className="font-black uppercase text-emerald-600 text-sm leading-none">{c.productName}</h4>
                                  <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase tracking-tighter">Profit Meta: {formatCurrency(c.targetProfit)}</p>
                               </div>
                               <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                  <button onClick={()=>{setNewConfig(c); setIsCreatingConfig(true);}} className="text-[10px] font-black text-slate-400 hover:text-emerald-600 border border-slate-200 rounded-lg px-2 py-1">✏️</button>
                                  <button onClick={()=>deleteDoc(doc(db, 'sales_configs', c.id))} className="text-[10px] font-black text-rose-300 hover:text-rose-500 border border-rose-100 rounded-lg px-2 py-1">🗑️</button>
                               </div>
                            </div>
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-[10px] font-bold text-slate-600">
                               <div><span className="block text-[8px] text-slate-400 uppercase mb-0.5">Costo Prod</span>{formatCurrency(c.productCost)}</div>
                               <div><span className="block text-[8px] text-slate-400 uppercase mb-0.5">Logística</span>{formatCurrency(c.freight)} / {formatCurrency(c.fulfillment)}</div>
                               <div><span className="block text-[8px] text-slate-400 uppercase mb-0.5">Eficiencia</span><span className="text-emerald-600">{c.effectiveness}% Eff</span></div>
                               <div><span className="block text-[8px] text-slate-400 uppercase mb-0.5">Tasa Dev.</span><span className="text-rose-500">{c.returnRate}% Dev</span></div>
                            </div>
                         </div>
                       ))}
                    </div>
                 </div>
               ))}
               {Object.keys(groupedConfigs).length === 0 && <div className="col-span-full py-20 text-center text-slate-300 font-bold uppercase tracking-widest text-sm">No has configurado equipos de venta.</div>}
            </div>
          </div>
        )}

        {/* --- MODAL DE CREACIÓN/EDICIÓN DE CONFIGURACIÓN --- */}
        {isCreatingConfig && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-[500] animate-in fade-in">
             <div className="bg-white w-full max-w-4xl rounded-[3rem] p-6 md:p-10 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto no-scrollbar text-left">
                <div className="flex justify-between items-center border-b pb-6">
                  <div>
                    <h2 className="font-black text-2xl uppercase italic tracking-tighter text-slate-800">Ajustes de Estrategia</h2>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Configura los costos y metas para este producto</p>
                  </div>
                  <button onClick={()=>setIsCreatingConfig(false)} className="bg-slate-100 p-3 rounded-full hover:bg-slate-200 transition-all">✕</button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Bloque Identificación */}
                  <div className="space-y-4">
                    <h3 className="text-[11px] font-black text-emerald-600 uppercase border-b pb-2 tracking-widest">📍 Identificación</h3>
                    <div className="grid grid-cols-1 gap-4">
                      <input value={newConfig.vendedora} onChange={e=>setNewConfig({...newConfig, vendedora: e.target.value})} className="w-full p-4 rounded-2xl border-2 border-slate-100 bg-slate-50 font-bold outline-none focus:border-emerald-400 text-sm" placeholder="NOMBRE VENDEDORA" />
                      <input value={newConfig.productName} onChange={e=>setNewConfig({...newConfig, productName: e.target.value})} className="w-full p-4 rounded-2xl border-2 border-slate-100 bg-slate-50 font-bold outline-none focus:border-emerald-400 text-sm" placeholder="NOMBRE PRODUCTO / CAMPAÑA" />
                    </div>
                    {/* Switch de Inversión FB */}
                    <div className="bg-slate-50 p-5 rounded-3xl border-2 border-slate-100">
                      <div className="flex items-center justify-between mb-4">
                        <div className="text-left"><p className="text-[11px] font-black uppercase text-slate-800 leading-none">Inversión FB Fija</p><p className="text-[9px] font-bold text-slate-400 mt-1 uppercase">Activa para fijar un presupuesto diario</p></div>
                        <button onClick={()=>setNewConfig({...newConfig, fixedAdSpend: !newConfig.fixedAdSpend})} className={`w-12 h-6 rounded-full relative transition-all ${newConfig.fixedAdSpend ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                           <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${newConfig.fixedAdSpend ? 'left-7' : 'left-1'}`} />
                        </button>
                      </div>
                      {newConfig.fixedAdSpend && (
                        <InputP label="Presupuesto Diario Fijo" value={newConfig.dailyAdSpend} onChange={v=>setNewConfig({...newConfig, dailyAdSpend: v})} type="currency" prefix="$" />
                      )}
                    </div>
                  </div>

                  {/* Bloque Costos y Rendimiento */}
                  <div className="space-y-4">
                    <h3 className="text-[11px] font-black text-emerald-600 uppercase border-b pb-2 tracking-widest">💰 Costos y Rendimiento</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <InputP label="Costo Producto" value={newConfig.productCost} onChange={v=>setNewConfig({...newConfig, productCost: v})} type="currency" prefix="$" />
                      <InputP label="Flete de Envío" value={newConfig.freight} onChange={v=>setNewConfig({...newConfig, freight: v})} type="currency" prefix="$" />
                      <InputP label="Fulfillment" value={newConfig.fulfillment} onChange={v=>setNewConfig({...newConfig, fulfillment: v})} type="currency" prefix="$" />
                      <InputP label="Comisión Venta" value={newConfig.commission} onChange={v=>setNewConfig({...newConfig, commission: v})} type="currency" prefix="$" />
                      <InputP label="Gastos Fijos Unit." value={newConfig.fixedCosts} onChange={v=>setNewConfig({...newConfig, fixedCosts: v})} type="currency" prefix="$" />
                      <InputP label="Ganancia Objetivo" value={newConfig.targetProfit} onChange={v=>setNewConfig({...newConfig, targetProfit: v})} type="currency" prefix="$" />
                      <InputP label="% Efectividad" value={newConfig.effectiveness} onChange={v=>setNewConfig({...newConfig, effectiveness: v})} suffix="%" />
                      <InputP label="% Devolución" value={newConfig.returnRate} onChange={v=>setNewConfig({...newConfig, returnRate: v})} suffix="%" />
                    </div>
                  </div>
                </div>

                <div className="pt-6 border-t">
                  <button onClick={saveConfig} disabled={isSaving} className="w-full bg-zinc-900 text-white p-5 rounded-2xl font-black uppercase tracking-widest shadow-2xl active:scale-95 transition-all hover:bg-black disabled:opacity-50">
                    {isSaving ? 'Guardando...' : 'Confirmar Estrategia'}
                  </button>
                </div>
             </div>
          </div>
        )}
      </div>
    </div>
  );
}
