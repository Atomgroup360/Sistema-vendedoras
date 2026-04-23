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
  const [filter, setFilter] = useState({ startDate: new Date(new Date().setDate(1)).toISOString().split('T')[0], endDate: new Date().toISOString().split('T')[0], vendedora: 'all', producto: 'all' });

  // Estado del Formulario (Jerarquía Vendedora -> Producto)
  const [newConfig, setNewConfig] = useState({ 
    vendedora: '', productName: '', targetProfit: '', productCost: '', 
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

      const IER = (parseFloat(c.effectiveness)/100) * (1 - (parseFloat(c.returnRate)/100)); // Ejemplo: 0.76
      const fleteRealUnitario = (parseFloat(c.freight)||0) / (1 - (parseFloat(c.returnRate)/100));
      
      const ordersS = parseFloat(r.ordersSingle) || 0;
      const ordersD = parseFloat(r.ordersDouble) || 0;
      
      const revReal = (parseFloat(r.revenue)||0) * IER;
      const ads = parseFloat(r.adSpend) || (c.fixedAdSpend ? parseFloat(c.dailyAdSpend) : 0);

      const costoMercancia = ((ordersS * IER) * (parseFloat(c.productCost)||0)) + ((ordersD * IER) * (parseFloat(c.productCost)*2||0));
      const costoFlete = (ordersS * fleteRealUnitario) + (ordersD * (fleteRealUnitario + 5000));
      const costoComision = ((ordersS + (ordersD * 2)) * IER) * (parseFloat(c.commission)||0);
      const costoFijoOp = ((ordersS + ordersD) * IER) * ((parseFloat(c.fulfillment)||0) + (parseFloat(c.fixedCosts)||0));

      res.realRev += revReal;
      res.ad += ads;
      res.ordTotal += (ordersS + ordersD);
      res.effDel += (ordersS + ordersD) * IER;
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
    <div className="min-h-screen bg-slate-100 font-sans text-slate-900 pb-20">
      {/* HEADER DINÁMICO */}
      <div className="max-w-6xl mx-auto p-4 space-y-6">
        <div className="flex justify-between items-center bg-zinc-900 p-6 rounded-[2rem] shadow-2xl text-white">
          <div>
            <h1 className="text-2xl font-black italic tracking-tighter text-emerald-400">WINNER PRODUCT OS</h1>
            <p className="text-[10px] font-bold opacity-60">PEREIRA - COLOMBIA 2026</p>
          </div>
          <div className="flex gap-2 bg-white/10 p-1 rounded-2xl">
            {['dashboard', 'records', 'config'].map(t => (
              <button key={t} onClick={()=>setActiveTab(t)} className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${activeTab === t ? 'bg-emerald-500 text-white' : 'text-zinc-500 hover:text-white'}`}>{t}</button>
            ))}
          </div>
        </div>

        {/* CONTENIDO DE TABS */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white p-6 rounded-3xl border shadow-sm">
                <p className="text-[9px] font-black text-slate-400 uppercase">Facturación Real (IER)</p>
                <p className="text-xl font-black">{formatCurrency(stats.realRev)}</p>
              </div>
              <div className="bg-white p-6 rounded-3xl border shadow-sm">
                <p className="text-[9px] font-black text-slate-400 uppercase">Inversión Meta</p>
                <p className="text-xl font-black">{formatCurrency(stats.ad)}</p>
              </div>
              <div className="bg-emerald-600 p-6 rounded-3xl text-white shadow-xl">
                <p className="text-[9px] font-black opacity-80 uppercase">ROAS Real</p>
                <p className="text-3xl font-black">{(stats.realRev / stats.ad || 0).toFixed(2)}</p>
              </div>
              <div className={`p-6 rounded-3xl text-white shadow-xl ${stats.net < 0 ? 'bg-rose-500' : 'bg-zinc-900'}`}>
                <p className="text-[9px] font-black opacity-80 uppercase">Profit Neto</p>
                <p className="text-xl font-black">{formatCurrency(stats.net)}</p>
              </div>
            </div>

            {/* FILTROS POR VENDEDORA Y PRODUCTO */}
            <div className="bg-white p-6 rounded-[2.5rem] border flex flex-wrap gap-4">
              <div className="flex-1 min-w-[150px]">
                <label className="text-[9px] font-black uppercase ml-2 text-slate-400">Vendedora</label>
                <select className="w-full p-3 rounded-xl bg-slate-50 font-bold border-none outline-none" onChange={e => setFilter({...filter, vendedora: e.target.value, producto: 'all'})}>
                  <option value="all">TODAS</option>
                  {Object.keys(groupedConfigs).map(v => <option key={v} value={v}>{v.toUpperCase()}</option>)}
                </select>
              </div>
              <div className="flex-1 min-w-[150px]">
                <label className="text-[9px] font-black uppercase ml-2 text-slate-400">Producto Específico</label>
                <select className="w-full p-3 rounded-xl bg-slate-50 font-bold border-none outline-none" disabled={filter.vendedora === 'all'} onChange={e => setFilter({...filter, producto: e.target.value})}>
                  <option value="all">PRODUCTOS TOTALES</option>
                  {filter.vendedora !== 'all' && groupedConfigs[filter.vendedora]?.map(p => <option key={p.id} value={p.id}>{p.productName}</option>)}
                </select>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'records' && (
          <div className="bg-zinc-900 p-8 rounded-[3rem] text-white space-y-6 shadow-2xl animate-in slide-in-from-bottom">
            <h2 className="text-xl font-black uppercase italic tracking-tighter text-emerald-400">Cierre Diario de Ventas</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <select className="w-full p-4 rounded-2xl bg-white/10 border border-white/10 font-bold text-sm" value={newRecord.configId} onChange={e => setNewRecord({...newRecord, configId: e.target.value})}>
                  <option value="">SELECCIONE VENDEDORA - PRODUCTO</option>
                  {Object.entries(groupedConfigs).map(([v, ps]) => (
                    <optgroup key={v} label={v.toUpperCase()} className="text-zinc-900">
                      {ps.map(p => <option key={p.id} value={p.id}>{p.productName} ({v})</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              <input type="number" placeholder="VENTAS INDIVIDUALES" className="p-4 rounded-2xl bg-white/10" value={newRecord.ordersSingle} onChange={e => setNewRecord({...newRecord, ordersSingle: e.target.value})} />
              <input type="number" placeholder="VENTAS DOBLES" className="p-4 rounded-2xl bg-white/10" value={newRecord.ordersDouble} onChange={e => setNewRecord({...newRecord, ordersDouble: e.target.value})} />
              <input type="number" placeholder="FACTURACIÓN BRUTA TOTAL" className="p-4 rounded-2xl bg-white/10 md:col-span-2" value={newRecord.revenue} onChange={e => setNewRecord({...newRecord, revenue: e.target.value})} />
            </div>
            <button onClick={saveRecord} className="w-full bg-emerald-500 p-5 rounded-2xl font-black uppercase tracking-widest hover:bg-emerald-400 transition-all">Guardar Datos y Calcular</button>
          </div>
        )}

        {activeTab === 'config' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-black uppercase italic">Estructura de Vendedoras</h2>
              <button onClick={() => setIsCreatingConfig(true)} className="bg-zinc-900 text-white px-6 py-3 rounded-2xl font-black text-[10px] uppercase">Añadir Vendedora/Producto</button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {Object.entries(groupedConfigs).map(([v, prods]) => (
                <div key={v} className="bg-white rounded-[2.5rem] border shadow-sm overflow-hidden">
                  <div className="bg-zinc-900 p-5 flex justify-between items-center">
                    <h3 className="text-white font-black uppercase text-xs">{v}</h3>
                    <span className="bg-emerald-500 text-[8px] px-2 py-1 rounded-full text-white font-black">{prods.length} PRODS</span>
                  </div>
                  <div className="p-4 space-y-2">
                    {prods.map(p => (
                      <div key={p.id} className="p-4 rounded-2xl bg-slate-50 flex justify-between items-center border border-transparent hover:border-emerald-400">
                        <div>
                          <p className="font-black text-xs text-emerald-600">{p.productName.toUpperCase()}</p>
                          <p className="text-[9px] font-bold text-slate-400">CPA Equilibrio: {formatCurrency((parseFloat(p.priceSingle)*0.3))}</p>
                        </div>
                        <button onClick={() => deleteDoc(doc(db, 'sales_configs', p.id))} className="text-rose-400 text-xs">🗑️</button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* MODAL DE CONFIGURACIÓN COMPLETO */}
        {isCreatingConfig && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[1000] p-4">
            <div className="bg-white w-full max-w-4xl rounded-[3rem] p-8 max-h-[90vh] overflow-y-auto space-y-6 shadow-2xl">
              <div className="flex justify-between items-center border-b pb-4">
                <h2 className="text-xl font-black uppercase italic tracking-tighter text-zinc-800">Parámetros de Escalado 360</h2>
                <button onClick={() => setIsCreatingConfig(false)} className="bg-slate-100 p-2 rounded-full">✕</button>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="col-span-2">
                  <label className="text-[9px] font-black ml-2 uppercase">Nombre Vendedora</label>
                  <input className="w-full p-3 bg-slate-50 rounded-xl font-bold" value={newConfig.vendedora} onChange={e => setNewConfig({...newConfig, vendedora: e.target.value})} />
                </div>
                <div className="col-span-2">
                  <label className="text-[9px] font-black ml-2 uppercase">Nombre Producto</label>
                  <input className="w-full p-3 bg-slate-50 rounded-xl font-bold" value={newConfig.productName} onChange={e => setNewConfig({...newConfig, productName: e.target.value})} />
                </div>
                <div className="bg-emerald-50 p-4 rounded-2xl">
                   <label className="text-[9px] font-black text-emerald-700 uppercase">% Efectividad</label>
                   <input type="number" className="w-full bg-transparent font-black text-xl outline-none" value={newConfig.effectiveness} onChange={e => setNewConfig({...newConfig, effectiveness: e.target.value})} />
                </div>
                <div className="bg-rose-50 p-4 rounded-2xl">
                   <label className="text-[9px] font-black text-rose-700 uppercase">% Devolución</label>
                   <input type="number" className="w-full bg-transparent font-black text-xl outline-none" value={newConfig.returnRate} onChange={e => setNewConfig({...newConfig, returnRate: e.target.value})} />
                </div>
                <div className="bg-slate-100 p-4 rounded-2xl col-span-2 flex items-center gap-4">
                   <div className="flex-1">
                      <label className="text-[9px] font-black uppercase block">Ads Diario</label>
                      <input type="number" className="w-full bg-transparent font-black text-xl outline-none" value={newConfig.dailyAdSpend} onChange={e => setNewConfig({...newConfig, dailyAdSpend: e.target.value})} />
                   </div>
                   <div className="flex flex-col items-center">
                      <span className="text-[8px] font-black mb-1">FIJAR</span>
                      <input type="checkbox" checked={newConfig.fixedAdSpend} onChange={e => setNewConfig({...newConfig, fixedAdSpend: e.target.checked})} className="w-6 h-6" />
                   </div>
                </div>
                {/* Agrega aquí el resto de campos (productCost, freight, etc) con el mismo estilo */}
              </div>

              <button onClick={async () => { await addDoc(collection(db, 'sales_configs'), {...newConfig, createdAt: Date.now()}); setIsCreatingConfig(false); }} className="w-full bg-zinc-900 text-white p-5 rounded-[2rem] font-black uppercase tracking-widest shadow-xl active:scale-95 transition-all">Crear Estrategia Maestra</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
