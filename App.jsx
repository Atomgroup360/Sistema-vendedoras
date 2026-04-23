import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, collection, addDoc, setDoc, updateDoc, deleteDoc, doc, 
  onSnapshot 
} from 'firebase/firestore';

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

const formatCurrency = (val) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(val || 0);

// --- COMPONENTES UI ---
const InputP = ({ label, value, onChange, type="number", prefix="", suffix="", disabled=false }) => {
  let displayVal = value;
  if (type === 'currency') displayVal = value ? new Intl.NumberFormat('es-CO').format(value) : '';
  const handleInput = (e) => {
    if (type === 'currency') {
      const num = e.target.value.replace(/\D/g, '');
      onChange(num !== '' ? parseFloat(num) : '');
    } else onChange(e.target.value !== '' ? e.target.value : '');
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
  else if (type === "number") displayValue = numValue.toLocaleString();
  else if (type === "percent") displayValue = `${numValue.toFixed(decimals)}%`;
  return (
    <div className={`p-3 rounded-xl border text-left flex flex-col justify-center ${customBg || (highlight ? 'bg-zinc-900 border-zinc-900 shadow-lg' : 'bg-zinc-50 border-zinc-200')}`}>
      <label className={`text-[8px] font-black uppercase mb-1 ${highlight ? 'text-zinc-400' : 'text-zinc-500'}`}>{label}</label>
      <div className={`font-mono text-sm font-black truncate ${highlight ? 'text-white' : 'text-zinc-800'}`}>{displayValue}</div>
    </div>
  );
};

// --- APP PRINCIPAL ---
export default function App() {
  const [salesConfigs, setSalesConfigs] = useState([]);
  const [salesMonths, setSalesMonths] = useState([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isCreatingConfig, setIsCreatingConfig] = useState(false);
  const [newConfig, setNewConfig] = useState({ vendedora: '', productName: '', productCost: '', freight: '', commission: '', dailyAdSpend: '', effectiveness: '100', returnRate: '0', fulfillment: '', fixedCosts: '' });
  const [newRecord, setNewRecord] = useState({ date: new Date().toISOString().split('T')[0], configId: '', orders: '', units: '', revenue: '', adSpend: '' });
  const [filter, setFilter] = useState({
    startDate: new Date(new Date().setDate(1)).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    vendedora: 'all',
    producto: 'all'
  });

  useEffect(() => {
    const unsubConfigs = onSnapshot(collection(db, 'sales_configs'), (snap) => setSalesConfigs(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const unsubMonths = onSnapshot(collection(db, 'sales_months'), (snap) => setSalesMonths(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => { unsubConfigs(); unsubMonths(); };
  }, []);

  const groupedConfigs = useMemo(() => salesConfigs.reduce((acc, c) => {
    if (!acc[c.vendedora]) acc[c.vendedora] = [];
    acc[c.vendedora].push(c);
    return acc;
  }, {}), [salesConfigs]);

  const stats = useMemo(() => {
    const allRecords = salesMonths.flatMap(m => m.records || []);
    const filtered = allRecords.filter(r => {
      const conf = salesConfigs.find(c => c.id === r.configId);
      return r.date >= filter.startDate && r.date <= filter.endDate &&
             conf && (filter.vendedora === 'all' || conf.vendedora === filter.vendedora) &&
             (filter.producto === 'all' || r.configId === filter.producto);
    });

    let res = { realRev: 0, ad: 0, ord: 0, net: 0, effDel: 0, costs: 0 };
    filtered.forEach(r => {
      const c = salesConfigs.find(conf => conf.id === r.configId);
      if (!c) return;
      const fer = (parseFloat(c.effectiveness)/100) * (1 - (parseFloat(c.returnRate)/100));
      const fleteReal = (parseFloat(c.freight)||0) / (1 - (parseFloat(c.returnRate)/100));
      res.realRev += (parseFloat(r.revenue)||0) * fer;
      res.ad += (parseFloat(r.adSpend)||0);
      res.ord += (parseFloat(r.orders)||0);
      const effOrd = (parseFloat(r.orders)||0) * fer;
      res.effDel += effOrd;
      res.costs += ((parseFloat(r.units)||0) * fer * (parseFloat(c.productCost)||0)) + ((parseFloat(r.orders)||0) * fleteReal) + (effOrd * (parseFloat(c.commission)||0)) + (effOrd * (parseFloat(c.fulfillment)||0)) + (effOrd * (parseFloat(c.fixedCosts)||0));
    });
    res.net = res.realRev - res.costs - res.ad;
    return res;
  }, [salesMonths, salesConfigs, filter]);

  const saveConfig = async () => {
    await addDoc(collection(db, 'sales_configs'), {...newConfig, createdAt: Date.now()});
    setIsCreatingConfig(false);
    setNewConfig({ vendedora: '', productName: '', productCost: '', freight: '', commission: '', dailyAdSpend: '', effectiveness: '100', returnRate: '0', fulfillment: '', fixedCosts: '' });
  };

  const saveRecord = async () => {
    const mid = newRecord.date.substring(0, 7);
    const ref = doc(db, 'sales_months', mid);
    const config = salesConfigs.find(c => c.id === newRecord.configId);
    const adToSave = newRecord.adSpend || (config?.dailyAdSpend || 0);
    const rec = { ...newRecord, adSpend: adToSave, id: Date.now().toString() };
    const exist = salesMonths.find(m => m.id === mid);
    if (exist) await updateDoc(ref, { records: [...exist.records, rec] });
    else await setDoc(ref, { records: [rec] });
    setNewRecord({ date: new Date().toISOString().split('T')[0], configId: '', orders: '', units: '', revenue: '', adSpend: '' });
  };

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8 font-sans text-slate-900">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex justify-between items-center bg-white p-4 rounded-3xl shadow-sm border">
          <h1 className="text-xl font-black italic uppercase text-emerald-600 tracking-tighter">Winner System 360</h1>
          <div className="flex gap-2 bg-slate-100 p-1 rounded-2xl">
            {['dashboard', 'records', 'config'].map(t => (
              <button key={t} onClick={()=>setActiveTab(t)} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${activeTab === t ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-400'}`}>{t}</button>
            ))}
          </div>
        </div>

        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border flex flex-wrap gap-4">
              <div className="flex-1"><label className="text-[10px] font-black text-slate-400 uppercase ml-2">Vendedora</label>
              <select value={filter.vendedora} onChange={e=>setFilter({...filter, vendedora: e.target.value, producto: 'all'})} className="w-full p-3 rounded-2xl border bg-slate-50 font-bold text-sm">
                <option value="all">TODAS</option>
                {Object.keys(groupedConfigs).map(v => <option key={v} value={v}>{v.toUpperCase()}</option>)}
              </select></div>
              <div className="flex-1"><label className="text-[10px] font-black text-slate-400 uppercase ml-2">Producto</label>
              <select value={filter.producto} onChange={e=>setFilter({...filter, producto: e.target.value})} disabled={filter.vendedora === 'all'} className="w-full p-3 rounded-2xl border bg-slate-50 font-bold text-sm">
                <option value="all">TOTALES</option>
                {filter.vendedora !== 'all' && groupedConfigs[filter.vendedora]?.map(c => <option key={c.id} value={c.id}>{c.productName.toUpperCase()}</option>)}
              </select></div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white p-6 rounded-3xl border"><p className="text-[10px] font-black text-slate-400 uppercase">Facturación Real</p><p className="text-2xl font-black font-mono">{formatCurrency(stats.realRev)}</p></div>
              <div className="bg-white p-6 rounded-3xl border"><p className="text-[10px] font-black text-slate-400 uppercase">Inversión Ads</p><p className="text-2xl font-black font-mono">{formatCurrency(stats.ad)}</p></div>
              <div className="bg-emerald-600 p-6 rounded-3xl shadow-xl text-white"><p className="text-[10px] font-black opacity-80 uppercase">ROAS Real</p><p className="text-4xl font-black italic">{(stats.realRev / stats.ad || 0).toFixed(2)}</p></div>
              <div className={`p-6 rounded-3xl shadow-xl text-white ${stats.net < 0 ? 'bg-rose-500' : 'bg-zinc-900'}`}><p className="text-[10px] font-black opacity-80 uppercase">Profit Neto</p><p className="text-2xl font-black font-mono">{formatCurrency(stats.net)}</p></div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               <div className="bg-white p-6 rounded-[2.5rem] border space-y-3">
                  <h3 className="font-black uppercase text-xs border-b pb-2">📦 Entregas</h3>
                  <OutputP label="Pedidos Brutos" value={stats.ord} type="number" customBg="bg-slate-50" />
                  <OutputP label="Pedidos Efectivos (FER)" value={stats.effDel} type="number" customBg="bg-emerald-50" />
                  <OutputP label="CPA Real" value={stats.ad / stats.effDel || 0} highlight />
               </div>
               <div className="bg-white p-6 rounded-[2.5rem] border space-y-3">
                  <h3 className="font-black uppercase text-xs border-b pb-2">💸 Costos</h3>
                  <OutputP label="Costos Totales" value={stats.costs} customBg="bg-rose-50" />
                  <OutputP label="Margen Real %" value={stats.realRev > 0 ? (stats.net / stats.realRev) * 100 : 0} type="percent" highlight />
               </div>
            </div>
          </div>
        )}

        {activeTab === 'records' && (
          <div className="bg-zinc-900 p-8 rounded-[2.5rem] text-white space-y-6">
            <h2 className="text-xl font-black uppercase italic tracking-tighter">Cierre Diario</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
              <div className="col-span-full">
                <label className="text-[10px] font-black text-zinc-500 uppercase ml-2 mb-1 block">Producto de Vendedora</label>
                <select value={newRecord.configId} onChange={e=>setNewRecord({...newRecord, configId: e.target.value})} className="w-full p-4 rounded-2xl bg-white/10 border border-white/10 font-bold text-white outline-none [&>optgroup]:text-zinc-900 [&>option]:text-zinc-900">
                  <option value="">SELECCIONAR...</option>
                  {Object.entries(groupedConfigs).map(([v, ps]) => <optgroup key={v} label={v.toUpperCase()}>{ps.map(c => <option key={c.id} value={c.id}>{c.productName} ({v})</option>)}</optgroup>)}
                </select>
              </div>
              <InputP label="Ventas Individuales (Pedidos)" value={newRecord.orders} onChange={v=>setNewRecord({...newRecord, orders: v})} />
              <InputP label="Unidades Totales" value={newRecord.units} onChange={v=>setNewRecord({...newRecord, units: v})} />
              <div className="col-span-full">
                <InputP label="Facturación Bruta (Dinero total)" value={newRecord.revenue} onChange={v=>setNewRecord({...newRecord, revenue: v})} type="currency" prefix="$" />
              </div>
              <div className="col-span-full">
                <InputP label="Inversión Ads Hoy (Opcional)" value={newRecord.adSpend} onChange={v=>setNewRecord({...newRecord, adSpend: v})} type="currency" prefix="$" />
              </div>
            </div>
            <button onClick={saveRecord} className="w-full bg-emerald-500 p-4 rounded-2xl font-black uppercase hover:bg-emerald-400 transition-all">Guardar Datos del Día</button>
          </div>
        )}

        {activeTab === 'config' && (
          <div className="space-y-6 text-left">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-black uppercase italic">Estrategias</h2>
              <button onClick={()=>setIsCreatingConfig(true)} className="bg-zinc-900 text-white px-6 py-3 rounded-2xl font-black text-[10px] uppercase">➕ Nueva Vendedora/Prod</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               {Object.entries(groupedConfigs).map(([v, prods]) => (
                 <div key={v} className="bg-white rounded-[2rem] border overflow-hidden">
                    <div className="bg-zinc-900 text-white p-4 font-black uppercase text-xs">{v}</div>
                    <div className="p-4 space-y-2">
                       {prods.map(c => (
                         <div key={c.id} className="p-3 rounded-xl border bg-slate-50 flex justify-between items-center">
                            <div><p className="font-black text-emerald-600 text-sm uppercase">{c.productName}</p><p className="text-[9px] font-bold text-slate-400 uppercase">Eff: {c.effectiveness}% | Dev: {c.returnRate}%</p></div>
                            <button onClick={()=>deleteDoc(doc(db, 'sales_configs', c.id))} className="text-rose-400">🗑️</button>
                         </div>
                       ))}
                    </div>
                 </div>
               ))}
            </div>
          </div>
        )}

        {isCreatingConfig && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-[500]">
             <div className="bg-white w-full max-w-2xl rounded-[2.5rem] p-6 space-y-4 max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center border-b pb-2"><h2 className="font-black uppercase italic">Configuración</h2><button onClick={()=>setIsCreatingConfig(false)}>✕</button></div>
                <div className="grid grid-cols-2 gap-3 text-left">
                  <div className="col-span-2 flex gap-2">
                    <input value={newConfig.vendedora} onChange={e=>setNewConfig({...newConfig, vendedora: e.target.value})} className="w-1/2 p-3 rounded-xl border bg-slate-50 font-bold uppercase text-xs" placeholder="NOMBRE VENDEDORA" />
                    <input value={newConfig.productName} onChange={e=>setNewConfig({...newConfig, productName: e.target.value})} className="w-1/2 p-3 rounded-xl border bg-slate-50 font-bold uppercase text-xs" placeholder="NOMBRE PRODUCTO" />
                  </div>
                  <InputP label="Costo Producto" value={newConfig.productCost} onChange={v=>setNewConfig({...newConfig, productCost: v})} type="currency" prefix="$" />
                  <InputP label="Flete Promedio" value={newConfig.freight} onChange={v=>setNewConfig({...newConfig, freight: v})} type="currency" prefix="$" />
                  <InputP label="Comisión Vendedora" value={newConfig.commission} onChange={v=>setNewConfig({...newConfig, commission: v})} type="currency" prefix="$" />
                  <InputP label="Ads Fijo Diario" value={newConfig.dailyAdSpend} onChange={v=>setNewConfig({...newConfig, dailyAdSpend: v})} type="currency" prefix="$" />
                  <InputP label="% Efectividad" value={newConfig.effectiveness} onChange={v=>setNewConfig({...newConfig, effectiveness: v})} suffix="%" />
                  <InputP label="% Devolución" value={newConfig.returnRate} onChange={v=>setNewConfig({...newConfig, returnRate: v})} suffix="%" />
                  <InputP label="Fulfillment" value={newConfig.fulfillment} onChange={v=>setNewConfig({...newConfig, fulfillment: v})} type="currency" prefix="$" />
                  <InputP label="Costos Fijos" value={newConfig.fixedCosts} onChange={v=>setNewConfig({...newConfig, fixedCosts: v})} type="currency" prefix="$" />
                </div>
                <button onClick={saveConfig} className="w-full bg-zinc-900 text-white p-4 rounded-2xl font-black uppercase">Guardar Estrategia</button>
             </div>
          </div>
        )}
      </div>
    </div>
  );
}
