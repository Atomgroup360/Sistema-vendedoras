<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Winner System 360</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <script type="importmap">
    {
      "imports": {
        "firebase/app": "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js",
        "firebase/firestore": "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"
      }
    }
    </script>
</head>
<body class="bg-slate-100">
    <div id="root"></div>

    <script type="text/babel" data-type="module">
        import { initializeApp } from "firebase/app";
        import { getFirestore, collection, addDoc, setDoc, updateDoc, deleteDoc, doc, onSnapshot } from "firebase/firestore";

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

        const { useState, useEffect, useMemo } = React;

        function App() {
            const [salesConfigs, setSalesConfigs] = useState([]);
            const [salesMonths, setSalesMonths] = useState([]);
            const [activeTab, setActiveTab] = useState('dashboard');
            const [isCreatingConfig, setIsCreatingConfig] = useState(false);
            const [newConfig, setNewConfig] = useState({ vendedora: '', productName: '', productCost: '', freight: '', commission: '', dailyAdSpend: '', effectiveness: '100', returnRate: '0', fulfillment: '', fixedCosts: '' });
            const [newRecord, setNewRecord] = useState({ date: new Date().toISOString().split('T')[0], configId: '', orders: '', units: '', revenue: '', adSpend: '' });
            const [filter, setFilter] = useState({ startDate: new Date(new Date().setDate(1)).toISOString().split('T')[0], endDate: new Date().toISOString().split('T')[0], vendedora: 'all', producto: 'all' });

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
                    return r.date >= filter.startDate && r.date <= filter.endDate && conf && (filter.vendedora === 'all' || conf.vendedora === filter.vendedora) && (filter.producto === 'all' || r.configId === filter.producto);
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

            const formatCurrency = (val) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(val || 0);

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
                <div className="max-w-4xl mx-auto p-4 space-y-6">
                    <div className="flex justify-between items-center bg-white p-4 rounded-2xl shadow-sm">
                        <h1 className="font-black text-emerald-600 italic">WINNER 360</h1>
                        <div className="flex gap-2">
                            {['dashboard', 'records', 'config'].map(t => (
                                <button key={t} onClick={()=>setActiveTab(t)} className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase ${activeTab === t ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}>{t}</button>
                            ))}
                        </div>
                    </div>

                    {activeTab === 'dashboard' && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="bg-white p-4 rounded-xl shadow-sm border"><p className="text-[8px] font-bold text-slate-400 uppercase">Facturación Real</p><p className="font-bold">{formatCurrency(stats.realRev)}</p></div>
                                <div className="bg-white p-4 rounded-xl shadow-sm border"><p className="text-[8px] font-bold text-slate-400 uppercase">Inversión Ads</p><p className="font-bold">{formatCurrency(stats.ad)}</p></div>
                                <div className="bg-emerald-600 p-4 rounded-xl text-white"><p className="text-[8px] font-bold opacity-70 uppercase">ROAS Real</p><p className="text-xl font-black">{(stats.realRev / stats.ad || 0).toFixed(2)}</p></div>
                                <div className={`p-4 rounded-xl text-white ${stats.net < 0 ? 'bg-rose-500' : 'bg-zinc-900'}`}><p className="text-[8px] font-bold opacity-70 uppercase">Profit Neto</p><p className="font-bold">{formatCurrency(stats.net)}</p></div>
                            </div>
                            <div className="bg-white p-6 rounded-2xl shadow-sm border text-center font-bold text-slate-400 text-sm">
                                Selecciona una vendedora en los filtros para ver detalles.
                            </div>
                        </div>
                    )}

                    {activeTab === 'records' && (
                        <div className="bg-zinc-900 p-6 rounded-2xl text-white space-y-4">
                            <h2 className="font-black uppercase italic">Cierre Diario</h2>
                            <select value={newRecord.configId} onChange={e=>setNewRecord({...newRecord, configId: e.target.value})} className="w-full p-3 rounded-xl bg-white/10 text-white">
                                <option value="">Seleccionar Producto...</option>
                                {Object.entries(groupedConfigs).map(([v, ps]) => (
                                    <optgroup key={v} label={v.toUpperCase()} className="text-black">
                                        {ps.map(c => <option key={c.id} value={c.id}>{c.productName}</option>)}
                                    </optgroup>
                                ))}
                            </select>
                            <input type="number" placeholder="Ventas (Pedidos)" value={newRecord.orders} onChange={e=>setNewRecord({...newRecord, orders: e.target.value})} className="w-full p-3 rounded-xl bg-white/10" />
                            <input type="number" placeholder="Facturación Bruta" value={newRecord.revenue} onChange={e=>setNewRecord({...newRecord, revenue: e.target.value})} className="w-full p-3 rounded-xl bg-white/10" />
                            <button onClick={saveRecord} className="w-full bg-emerald-500 p-4 rounded-xl font-black uppercase">Guardar Día</button>
                        </div>
                    )}

                    {activeTab === 'config' && (
                        <div className="space-y-4">
                            <button onClick={()=>setIsCreatingConfig(true)} className="w-full bg-zinc-900 text-white p-4 rounded-xl font-black uppercase">+ Nueva Configuración</button>
                            {Object.entries(groupedConfigs).map(([v, prods]) => (
                                <div key={v} className="bg-white p-4 rounded-2xl border shadow-sm">
                                    <h3 className="font-black uppercase text-xs mb-2">{v}</h3>
                                    {prods.map(c => (
                                        <div key={c.id} className="flex justify-between items-center p-2 bg-slate-50 rounded-lg mb-1">
                                            <span className="text-sm font-bold text-slate-600">{c.productName}</span>
                                            <button onClick={()=>deleteDoc(doc(db, 'sales_configs', c.id))} className="text-rose-500 text-xs">Borrar</button>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    )}

                    {isCreatingConfig && (
                        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                            <div className="bg-white p-6 rounded-2xl w-full max-w-md space-y-3">
                                <h2 className="font-black uppercase">Nueva Estrategia</h2>
                                <input placeholder="Nombre Vendedora" value={newConfig.vendedora} onChange={e=>setNewConfig({...newConfig, vendedora: e.target.value})} className="w-full p-2 border rounded-lg uppercase" />
                                <input placeholder="Nombre Producto" value={newConfig.productName} onChange={e=>setNewConfig({...newConfig, productName: e.target.value})} className="w-full p-2 border rounded-lg uppercase" />
                                <input type="number" placeholder="Costo Producto" value={newConfig.productCost} onChange={e=>setNewConfig({...newConfig, productCost: e.target.value})} className="w-full p-2 border rounded-lg" />
                                <input type="number" placeholder="Flete" value={newConfig.freight} onChange={e=>setNewConfig({...newConfig, freight: e.target.value})} className="w-full p-2 border rounded-lg" />
                                <input type="number" placeholder="% Devolución" value={newConfig.returnRate} onChange={e=>setNewConfig({...newConfig, returnRate: e.target.value})} className="w-full p-2 border rounded-lg" />
                                <button onClick={saveConfig} className="w-full bg-emerald-600 text-white p-3 rounded-xl font-black">GUARDAR</button>
                                <button onClick={()=>setIsCreatingConfig(false)} className="w-full text-slate-400 text-xs uppercase">Cancelar</button>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

        const root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(<App />);
    </script>
</body>
</html>
