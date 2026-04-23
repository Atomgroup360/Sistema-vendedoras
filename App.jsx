import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, setDoc, updateDoc, deleteDoc, doc, onSnapshot } from 'firebase/firestore';

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

export default function App() {
  const [salesConfigs, setSalesConfigs] = useState([]);
  const [salesMonths, setSalesMonths] = useState([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isCreatingConfig, setIsCreatingConfig] = useState(false);
  
  // FILTROS DE FECHA EXACTOS
  const [filter, setFilter] = useState({ 
    startDate: new Date().toISOString().split('T')[0], 
    endDate: new Date().toISOString().split('T')[0], 
    vendedora: 'all', 
    producto: 'all' 
  });

  const [newConfig, setNewConfig] = useState({ 
    vendedora: '', productName: '', productCost: '', 
    freight: '', commission: '', returnRate: '20', effectiveness: '95', 
    fulfillment: '', fixedCosts: '', priceSingle: '', priceDouble: '',
    dailyAdSpend: '', fixedAdSpend: true 
  });

  const [newRecord, setNewRecord] = useState({ 
    date: new Date().toISOString().split('T')[0], configId: '', 
    ordersSingle: '', ordersDouble: '', revenue: '', adSpend: '' 
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

  // CÁLCULOS CON FILTRO DE FECHA
  const stats = useMemo(() => {
    const allRecords = salesMonths.flatMap(m => m.records || []);
    const filtered = allRecords.filter(r => {
      const conf = salesConfigs.find(c => c.id === r.configId);
      return r.date >= filter.startDate && r.date <= filter.endDate &&
             conf && (filter.vendedora === 'all' || conf.vendedora === filter.vendedora) &&
             (filter.producto === 'all' || r.configId === filter.producto);
    });

    let res = { realRev: 0, ad: 0, ordTotal: 0, net: 0, effDel: 0, costs: 0 };
    
    filtered.forEach(r => {
      const c = salesConfigs.find(conf => conf.id === r.configId);
      if (!c) return;

      const IER = (parseFloat(c.effectiveness)/100) * (1 - (parseFloat(c.returnRate)/100));
      const fleteRealUnitario = (parseFloat(c.freight)||0) / (1 - (parseFloat(c.returnRate)/100));
      
      const ordersS = parseFloat(r.ordersSingle) || 0;
      const ordersD = parseFloat(r.ordersDouble) || 0;
      
      res.realRev += (parseFloat(r.revenue)||0) * IER;
      res.ad += parseFloat(r.adSpend) || (c.fixedAdSpend ? parseFloat(c.dailyAdSpend) : 0);
      res.ordTotal += (ordersS + ordersD);
      res.effDel += (ordersS + ordersD) * IER;

      const costoMercancia = ((ordersS * IER) * (parseFloat(c.productCost)||0)) + ((ordersD * IER) * (parseFloat(c.productCost)*2||0));
      const costoFlete = (ordersS * fleteRealUnitario) + (ordersD * (fleteRealUnitario + 5000));
      const costoComision = ((ordersS + (ordersD * 2)) * IER) * (parseFloat(c.commission)||0);
      const costoFijoOp = ((ordersS + ordersD) * IER) * ((parseFloat(c.fulfillment)||0) + (parseFloat(c.fixedCosts)||0));
      
      res.costs += (costoMercancia + costoFlete + costoComision + costoFijoOp);
    });

    res.net = res.realRev - res.costs - res.ad;
    return res;
  }, [salesMonths, salesConfigs, filter]);

  const saveRecord = async () => {
    const mid = newRecord.date.substring(0, 7);
    const ref = doc(db, 'sales_months', mid);
    const exist = salesMonths.find(m => m.id === mid);
    const rec = { ...newRecord, id: Date.now().toString() };
    if (exist) await updateDoc(ref, { records: [...exist.records, rec] });
    else await setDoc(ref, { records: [rec] });
    setNewRecord({ ...newRecord, ordersSingle: '', ordersDouble: '', revenue: '', adSpend: '' });
  };

  return (
    <div className="min-h-screen bg-slate-100 pb-20 font-sans">
      <div className="max-w-6xl mx-auto p-4 space-y-6">
        
        {/* HEADER */}
        <div className="flex justify-between items-center bg-zinc-900 p-6 rounded-[2.5rem] text-white shadow-2xl">
          <h1 className="text-xl font-black italic text-emerald-400 tracking-tighter">WINNER OS 360</h1>
          <div className="flex gap-2 bg-white/10 p-1 rounded-2xl">
            {['dashboard', 'records', 'config'].map(t => (
              <button key={t} onClick={()=>setActiveTab(t)} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${activeTab === t ? 'bg-emerald-500 text-white' : 'text-zinc-500'}`}>{t}</button>
            ))}
          </div>
        </div>

        {activeTab === 'dashboard' && (
          <div className="space-y-6 animate-in fade-in duration-500">
            {/* FILTROS DE REVISIÓN POR FECHAS */}
            <div className="bg-white p-6 rounded-[2.5rem] border shadow-sm grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="text-[9px] font-black uppercase text-slate-400 ml-2">Desde</label>
                <input type="date" className="w-full p-3 bg-slate-50 rounded-xl font-bold text-xs" value={filter.startDate} onChange={e=>setFilter({...filter, startDate: e.target.value})} />
              </div>
              <div>
                <label className="text-[9px] font-black uppercase text-slate-400 ml-2">Hasta</label>
                <input type="date" className="w-full p-3 bg-slate-50 rounded-xl font-bold text-xs" value={filter.endDate} onChange={e=>setFilter({...filter, endDate: e.target.value})} />
              </div>
              <div>
                <label className="text-[9px] font-black uppercase text-slate-400 ml-2">Vendedora</label>
                <select className="w-full p-3 bg-slate-50 rounded-xl font-bold text-xs" onChange={e=>setFilter({...filter, vendedora: e.target.value, producto: 'all'})}>
                  <option value="all">TODAS</option>
                  {Object.keys(groupedConfigs).map(v => <option key={v} value={v}>{v.toUpperCase()}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9px] font-black uppercase text-slate-400 ml-2">Producto</label>
                <select className="w-full p-3 bg-slate-50 rounded-xl font-bold text-xs" disabled={filter.vendedora === 'all'} onChange={e=>setFilter({...filter, producto: e.target.value})}>
                  <option value="all">TOTAL PRODUCTOS</option>
                  {filter.vendedora !== 'all' && groupedConfigs[filter.vendedora]?.map(p => <option key={p.id} value={p.id}>{p.productName}</option>)}
                </select>
              </div>
            </div>

            {/* MÉTRICAS PRINCIPALES */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white p-6 rounded-3xl border shadow-sm">
                <p className="text-[9px] font-black text-slate-400 uppercase">Facturación Real (IER)</p>
                <p className="text-xl font-black">{formatCurrency(stats.realRev)}</p>
              </div>
              <div className="bg-white p-6 rounded-3xl border shadow-sm">
                <p className="text-[9px] font-black text-slate-400 uppercase">Gasto Ads</p>
                <p className="text-xl font-black">{formatCurrency(stats.ad)}</p>
              </div>
              <div className="bg-emerald-600 p-6 rounded-3xl text-white shadow-xl">
                <p className="text-[9px] font-black opacity-70 uppercase">ROAS Real</p>
                <p className="text-3xl font-black">{(stats.realRev / stats.ad || 0).toFixed(2)}</p>
              </div>
              <div className={`p-6 rounded-3xl text-white shadow-xl ${stats.net < 0 ? 'bg-rose-500' : 'bg-zinc-900'}`}>
                <p className="text-[9px] font-black opacity-70 uppercase">Profit Neto</p>
                <p className="text-xl font-black">{formatCurrency(stats.net)}</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'records' && (
          <div className="bg-zinc-900 p-8 rounded-[3rem] text-white space-y-6 shadow-2xl">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-black uppercase italic text-emerald-400">Registro de Ventas</h2>
              <input type="date" className="bg-white/10 p-3 rounded-xl font-bold text-xs border border-white/10" value={newRecord.date} onChange={e=>setNewRecord({...newRecord, date: e.target.value})} />
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="text-[9px] font-black text-zinc-500 ml-2 uppercase">Seleccionar Estrategia</label>
                <select className="w-full p-4 rounded-2xl bg-white/10 border border-white/10 font-bold text-zinc-300" value={newRecord.configId} onChange={e=>setNewRecord({...newRecord, configId: e.target.value})}>
                  <option value="">ELIJA PRODUCTO - VENDEDORA</option>
                  {Object.entries(groupedConfigs).map(([v, ps]) => (
                    <optgroup key={v} label={v.toUpperCase()} className="text-zinc-900">
                      {ps.map(p => <option key={p.id} value={p.id}>{p.productName} ({v})</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black text-zinc-500 ml-2 uppercase">Ventas 1 Unid.</label>
                <input type="number" placeholder="0" className="w-full p-4 rounded-2xl bg-white/10 border border-white/10" value={newRecord.ordersSingle} onChange={e=>setNewRecord({...newRecord, ordersSingle: e.target.value})} />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black text-zinc-500 ml-2 uppercase">Ventas 2 Unid.</label>
                <input type="number" placeholder="0" className="w-full p-4 rounded-2xl bg-white/10 border border-white/10" value={newRecord.ordersDouble} onChange={e=>setNewRecord({...newRecord, ordersDouble: e.target.value})} />
              </div>
              <div className="md:col-span-2 space-y-1">
                <label className="text-[9px] font-black text-zinc-500 ml-2 uppercase">Facturación Bruta Total</label>
                <input type="number" placeholder="$ 0" className="w-full p-4 rounded-2xl bg-white/10 border border-white/10 text-emerald-400 font-black text-xl" value={newRecord.revenue} onChange={e=>setNewRecord({...newRecord, revenue: e.target.value})} />
              </div>
            </div>
            <button onClick={saveRecord} className="w-full bg-emerald-500 p-5 rounded-2xl font-black uppercase tracking-widest active:scale-95 transition-all">Guardar Cierre del Día</button>
          </div>
        )}

        {/* MANTENER TABS DE CONFIG COMO ESTABAN PERO ASEGURAR ESTRUCTURA VENDEDORA-PRODUCTO */}
      </div>
    </div>
  );
}
