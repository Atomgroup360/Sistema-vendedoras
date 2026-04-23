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

// --- CONFIGURACIÓN DE FIREBASE (PONER AQUÍ TUS NUEVAS CREDENCIALES) ---
const firebaseConfig = {
  apiKey: "AIzaSyCAGEmzg7k6RCOoqOPqcpOVgws4W2pasDg",
  authDomain: "vendedoras-winner-360.firebaseapp.com",
  projectId: "vendedoras-winner-360",
  storageBucket: "vendedoras-winner-360.firebasestorage.app",
  messagingSenderId: "460355470202",
  appId: "1:460355470202:web:bfa880f95d25192e814cc3"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = "winner-sales-system"; // Identificador único para tus colecciones

// --- MODELOS DE DATOS ---
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
    <div className={`p-3 rounded-xl border text-left flex flex-col justify-center ${customBg || (highlight ? 'bg-zinc-900 border-zinc-900 shadow-lg' : 'bg-zinc-50 border-zinc-200')}`}>
      <label className={`text-[8px] font-black uppercase mb-1 ${highlight ? 'text-zinc-400' : 'text-zinc-500'}`}>{label}</label>
      <div className={`font-mono text-sm font-black truncate ${highlight ? 'text-white' : 'text-zinc-800'}`}>{displayValue}</div>
    </div>
  );
};

// --- APLICACIÓN PRINCIPAL ---
export default function App() {
  const [user, setUser] = useState(null);
  const [salesConfigs, setSalesConfigs] = useState([]);
  const [salesMonths, setSalesMonths] = useState([]);
  const [activeTab, setActiveTab] = useState('dashboard'); // dashboard, records, config
  
  // States de Formularios
  const [isCreatingConfig, setIsCreatingConfig] = useState(false);
  const [newConfig, setNewConfig] = useState(getInitialSalesConfig());
  const [newRecord, setNewRecord] = useState(getInitialSaleRecord());
  const [filter, setFilter] = useState({
     startDate: new Date(new Date().setDate(1)).toISOString().split('T')[0],
     endDate: new Date().toISOString().split('T')[0],
     vendedora: 'all',
     producto: 'all'
  });

  useEffect(() => {
    onAuthStateChanged(auth, (u) => setUser(u));
    if (user) {
      onSnapshot(collection(db, 'sales_configs'), (snap) => setSalesConfigs(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
      onSnapshot(collection(db, 'sales_months'), (snap) => setSalesMonths(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    }
  }, [user]);

  // LÓGICA DE FILTRADO Y CÁLCULOS
  const groupedConfigs = useMemo(() => salesConfigs.reduce((acc, c) => {
    if (!acc[c.vendedora]) acc[c.vendedora] = [];
    acc[c.vendedora].push(c);
    return acc;
  }, {}), [salesConfigs]);

  const stats = useMemo(() => {
    const allRecords = salesMonths.flatMap(m => m.records || []);
    const filtered = allRecords.filter(r => {
      const d = new Date(r.date);
      const conf = salesConfigs.find(c => c.id === r.configId);
      return d >= new Date(filter.startDate) && d <= new Date(filter.endDate) &&
             conf && (filter.vendedora === 'all' || conf.vendedora === filter.vendedora) &&
             (filter.producto === 'all' || r.configId === filter.producto);
    });

    let res = { grossRev: 0, realRev: 0, ad: 0, ord: 0, net: 0, effDel: 0, costs: 0 };
    filtered.forEach(r => {
      const c = salesConfigs.find(conf => conf.id === r.configId);
      if (!c) return;
      const index = (parseFloat(c.effectiveness) - parseFloat(c.returnRate)) / 100;
      const realRev = (parseFloat(r.revenue)||0) * index;
      const effOrd = (parseFloat(r.orders)||0) * index;
      const effUni = (parseFloat(r.units)||0) * index;
      
      res.grossRev += (parseFloat(r.revenue)||0);
      res.realRev += realRev;
      res.ad += (parseFloat(r.adSpend)||0);
      res.ord += (parseFloat(r.orders)||0);
      res.effDel += effOrd;
      
      const prodCost = effUni * (parseFloat(c.productCost)||0);
      const logCost = (parseFloat(r.orders)||0) * ((parseFloat(c.freight)||0) + (parseFloat(c.fulfillment)||0));
      const commCost = effOrd * (parseFloat(c.commission)||0);
      const fixed = effOrd * (parseFloat(c.fixedCosts)||0);
      
      res.costs += (prodCost + logCost + commCost + fixed);
    });
    res.net = res.realRev - res.costs - res.ad;
    return res;
  }, [salesMonths, salesConfigs, filter]);

  // FUNCIONES DE GUARDADO
  const saveConfig = async () => {
    await addDoc(collection(db, 'sales_configs'), {...newConfig, createdAt: Date.now()});
    setIsCreatingConfig(false);
    setNewConfig(getInitialSalesConfig());
  };

  const saveRecord = async () => {
    const mid = newRecord.date.substring(0, 7);
    const ref = doc(db, 'sales_months', mid);
    const exist = salesMonths.find(m => m.id === mid);
    const rec = { ...newRecord, id: Date.now().toString() };
    if (exist) await updateDoc(ref, { records: [...exist.records, rec] });
    else await setDoc(ref, { records: [rec] });
    setNewRecord(getInitialSaleRecord());
  };

  if (!user) return <div className="p-10 text-center font-black">POR FAVOR INICIA SESIÓN EN FIREBASE...</div>;

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8 font-sans text-slate-900">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* HEADER & NAV */}
        <div className="flex justify-between items-center bg-white p-4 rounded-3xl shadow-sm border">
          <h1 className="text-xl font-black italic uppercase tracking-tighter text-emerald-600">Sales Dashboard</h1>
          <div className="flex gap-2 bg-slate-100 p-1 rounded-2xl">
            {['dashboard', 'records', 'config'].map(t => (
              <button key={t} onClick={()=>setActiveTab(t)} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === t ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-400'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* TAB 1: DASHBOARD */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6 animate-in fade-in">
            {/* FILTROS */}
            <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border flex flex-wrap gap-4 items-end">
               <div className="flex-1 min-w-[200px]"><label className="text-[10px] font-black text-slate-400 uppercase ml-2 mb-1 block">Vendedora</label>
               <select value={filter.vendedora} onChange={e=>setFilter({...filter, vendedora: e.target.value, producto: 'all'})} className="w-full p-3 rounded-2xl border bg-slate-50 font-bold outline-none focus:border-emerald-400 text-sm">
                 <option value="all">TODAS</option>
                 {Object.keys(groupedConfigs).map(v => <option key={v} value={v}>{v.toUpperCase()}</option>)}
               </select></div>
               <div className="flex-1 min-w-[200px]"><label className="text-[10px] font-black text-slate-400 uppercase ml-2 mb-1 block">Producto</label>
               <select value={filter.producto} onChange={e=>setFilter({...filter, producto: e.target.value})} disabled={filter.vendedora === 'all'} className="w-full p-3 rounded-2xl border bg-slate-50 font-bold outline-none focus:border-emerald-400 text-sm disabled:opacity-30">
                 <option value="all">TOTALES</option>
                 {filter.vendedora !== 'all' && groupedConfigs[filter.vendedora]?.map(c => <option key={c.id} value={c.id}>{c.productName.toUpperCase()}</option>)}
               </select></div>
            </div>

            {/* CARDS PRINCIPALES */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white p-6 rounded-3xl border shadow-sm"><p className="text-[10px] font-black text-slate-400 uppercase">Facturación Real</p><p className="text-2xl font-black font-mono">{formatCurrency(stats.realRev)}</p></div>
              <div className="bg-white p-6 rounded-3xl border shadow-sm"><p className="text-[10px] font-black text-slate-400 uppercase">Inversión Ads</p><p className="text-2xl font-black font-mono">{formatCurrency(stats.ad)}</p></div>
              <div className="bg-emerald-600 p-6 rounded-3xl shadow-xl text-white"><p className="text-[10px] font-black opacity-80 uppercase">ROAS Global</p><p className="text-4xl font-black italic">{(stats.realRev / stats.ad || 0).toFixed(2)}</p></div>
              <div className={`p-6 rounded-3xl shadow-xl text-white ${stats.net < 0 ? 'bg-rose-500' : 'bg-zinc-900'}`}><p className="text-[10px] font-black opacity-80 uppercase">Profit Neto</p><p className="text-2xl font-black font-mono">{formatCurrency(stats.net)}</p></div>
            </div>

            {/* DETALLES */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
               <div className="bg-white p-8 rounded-[2.5rem] border shadow-sm space-y-4 text-left">
                  <h3 className="font-black uppercase tracking-tighter border-b pb-2">📦 Operación Real</h3>
                  <OutputP label="Ventas Brutas" value={stats.ord} type="number" decimals={0} customBg="bg-slate-50" />
                  <OutputP label="Entregas Efectivas (Netas)" value={stats.effDel} type="number" decimals={1} customBg="bg-emerald-50" />
                  <OutputP label="CPA Real Promedio" value={stats.ad / stats.effDel || 0} highlight />
               </div>
               <div className="bg-white p-8 rounded-[2.5rem] border shadow-sm space-y-4 text-left">
                  <h3 className="font-black uppercase tracking-tighter border-b pb-2">💳 Costos Totales</h3>
                  <OutputP label="Costos Operativos (Flete+Fulfill+Comisión)" value={stats.costs} customBg="bg-rose-50" />
                  <OutputP label="Margen Neto" value={stats.realRev > 0 ? (stats.net / stats.realRev) * 100 : 0} type="percent" highlight />
               </div>
            </div>
          </div>
        )}

        {/* TAB 2: CIERRE DIARIO */}
        {activeTab === 'records' && (
          <div className="space-y-6 animate-in slide-in-from-bottom-4">
             <div className="bg-zinc-900 p-8 rounded-[2.5rem] text-white space-y-6 shadow-2xl">
                <h2 className="text-2xl font-black uppercase italic tracking-tighter">Cierre de Ventas Diario</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                   <select value={newRecord.configId} onChange={e=>handleRecordConfigSelect(e.target.value)} className="w-full p-4 rounded-2xl bg-white/10 border border-white/10 font-bold outline-none text-sm [&>optgroup]:text-zinc-900 [&>option]:text-zinc-900">
                      <option value="">VENDEDORA - PRODUCTO</option>
                      {Object.entries(groupedConfigs).map(([v, ps]) => <optgroup key={v} label={v.toUpperCase()}>{ps.map(c => <option key={c.id} value={c.id}>{c.productName}</option>)}</optgroup>)}
                   </select>
                   <input type="date" value={newRecord.date} onChange={e=>setNewRecord({...newRecord, date: e.target.value})} className="p-4 rounded-2xl bg-white/10 border border-white/10 font-bold text-center" />
                   <div className="flex gap-2">
                     <input type="number" value={newRecord.orders} onChange={e=>setNewRecord({...newRecord, orders: e.target.value})} className="w-1/2 p-4 rounded-2xl bg-white/10 border border-white/10 text-center font-black" placeholder="PEDIDOS" />
                     <input type="number" value={newRecord.units} onChange={e=>setNewRecord({...newRecord, units: e.target.value})} className="w-1/2 p-4 rounded-2xl bg-white/10 border border-white/10 text-center font-black" placeholder="UNIDADES" />
                   </div>
                   <div className="md:col-span-2"><InputP label="Facturación Bruta (Sin descontar nada)" value={newRecord.revenue} onChange={v=>setNewRecord({...newRecord, revenue: v})} type="currency" prefix="$" /></div>
                   <div className="flex flex-col justify-end"><button onClick={saveRecord} className="w-full bg-emerald-500 p-4 rounded-2xl font-black uppercase tracking-widest hover:bg-emerald-400 transition-all">Guardar Día</button></div>
                </div>
             </div>
          </div>
        )}

        {/* TAB 3: CONFIGURACIÓN */}
        {activeTab === 'config' && (
          <div className="space-y-6 text-left">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-black uppercase italic tracking-tighter">Vendedoras y Estrategias</h2>
              <button onClick={()=>setIsCreatingConfig(true)} className="bg-zinc-900 text-white px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest">➕ Añadir Vendedora</button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
               {Object.entries(groupedConfigs).map(([v, prods]) => (
                 <div key={v} className="bg-white rounded-[2rem] border shadow-sm overflow-hidden">
                    <div className="bg-zinc-900 text-white p-5 flex justify-between items-center">
                       <h3 className="font-black uppercase tracking-widest">{v}</h3>
                       <button onClick={()=>{setNewConfig({...getInitialSalesConfig(), vendedora: v}); setIsCreatingConfig(true);}} className="text-[9px] bg-white text-zinc-900 px-3 py-1 rounded-lg font-black uppercase">➕ Prod</button>
                    </div>
                    <div className="p-4 space-y-4">
                       {prods.map(c => (
                         <div key={c.id} className="p-4 rounded-2xl border bg-slate-50 flex justify-between items-center hover:border-emerald-400 transition-colors">
                            <div><p className="font-black uppercase text-emerald-600 leading-none">{c.productName}</p><p className="text-[10px] font-bold text-slate-400 mt-1 uppercase">Eff: {c.effectiveness}% | Ret: {c.returnRate}%</p></div>
                            <button onClick={()=>deleteDoc(doc(db, 'sales_configs', c.id))} className="text-slate-300 hover:text-rose-500">🗑️</button>
                         </div>
                       ))}
                    </div>
                 </div>
               ))}
            </div>
          </div>
        )}

        {/* MODAL CONFIGURACIÓN */}
        {isCreatingConfig && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-[500] animate-in fade-in">
             <div className="bg-white w-full max-w-2xl rounded-[3rem] p-8 shadow-2xl space-y-6">
                <div className="flex justify-between items-center border-b pb-4"><h2 className="font-black text-xl uppercase italic">Nueva Configuración</h2><button onClick={()=>setIsCreatingConfig(false)} className="bg-slate-100 p-2 rounded-full">✕</button></div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 flex gap-4">
                    <input value={newConfig.vendedora} onChange={e=>setNewConfig({...newConfig, vendedora: e.target.value})} className="w-1/2 p-4 rounded-2xl border bg-slate-50 font-bold" placeholder="NOMBRE VENDEDORA" />
                    <input value={newConfig.productName} onChange={e=>setNewConfig({...newConfig, productName: e.target.value})} className="w-1/2 p-4 rounded-2xl border bg-slate-50 font-bold" placeholder="NOMBRE PRODUCTO" />
                  </div>
                  <InputP label="Costo Producto" value={newConfig.productCost} onChange={v=>setNewConfig({...newConfig, productCost: v})} type="currency" prefix="$" />
                  <InputP label="Flete Envío" value={newConfig.freight} onChange={v=>setNewConfig({...newConfig, freight: v})} type="currency" prefix="$" />
                  <InputP label="Comisión Venta" value={newConfig.commission} onChange={v=>setNewConfig({...newConfig, commission: v})} type="currency" prefix="$" />
                  <InputP label="Meta Profit" value={newConfig.targetProfit} onChange={v=>setNewConfig({...newConfig, targetProfit: v})} type="currency" prefix="$" />
                  <InputP label="% Efectividad" value={newConfig.effectiveness} onChange={v=>setNewConfig({...newConfig, effectiveness: v})} suffix="%" />
                  <InputP label="% Devolución" value={newConfig.returnRate} onChange={v=>setNewConfig({...newConfig, returnRate: v})} suffix="%" />
                </div>
                <button onClick={saveConfig} className="w-full bg-zinc-900 text-white p-5 rounded-2xl font-black uppercase tracking-widest shadow-xl active:scale-95 transition-all">Guardar Estrategia</button>
             </div>
          </div>
        )}
      </div>
    </div>
  );
}
