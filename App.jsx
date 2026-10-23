import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, 
  onSnapshot, serverTimestamp, Timestamp, setDoc, writeBatch 
} from 'firebase/firestore';
import { 
  getAuth, 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  signOut 
} from 'firebase/auth';

// --- CONFIGURACIÓN DE FIREBASE ---
const firebaseConfig = {
  apiKey: "AIzaSyATSpw_uzohLwm7zVUk3X_d6EAsDZNZLK0".trim(),
  authDomain: "winnerproduct-crm.firebaseapp.com".trim(),
  projectId: "winnerproduct-crm".trim(),
  storageBucket: "winnerproduct-crm.firebasestorage.app".trim(),
  messagingSenderId: "697988179670".trim(),
  appId: "1:697988179670:web:3910c31426d0d6e4bdcb77".trim()
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'winnerproduct-crm';

// --- CONFIGURACIÓN DE ESTADOS ---
const WINNER_STATUS = {
  pending: { id: 'pending', label: 'Pendiente', color: 'bg-zinc-100 text-zinc-600', activeColor: 'bg-zinc-800 text-white', emoji: '🕒' },
  prepared: { id: 'prepared', label: 'Preparado', color: 'bg-blue-50 text-blue-600', activeColor: 'bg-blue-600 text-white', emoji: '📦' },
  testing: { id: 'testing', label: 'En Testeo', color: 'bg-amber-50 text-amber-600', activeColor: 'bg-amber-500 text-white', emoji: '🧪' },
  approved: { id: 'approved', label: 'Aprobado', color: 'bg-emerald-50 text-emerald-600', activeColor: 'bg-emerald-600 text-white', emoji: '✅' },
  rejected: { id: 'rejected', label: 'Rechazado', color: 'bg-rose-50 text-rose-600', activeColor: 'bg-rose-600 text-white', emoji: '❌' }
};

const IMPORT_STATUS = {
  pending: { id: 'pending', label: 'Pendiente', color: 'bg-zinc-100 text-zinc-600', activeColor: 'bg-zinc-800 text-white', emoji: '⏳' },
  approved: { id: 'approved', label: 'Aprobado', color: 'bg-emerald-50 text-emerald-600', activeColor: 'bg-emerald-600 text-white', emoji: '🛳️' }
};

const IMPORT_STATES_LIST = {
  warehouse: { id: 'warehouse', label: 'EN BODEGA', emoji: '🏭', bgColor: 'bg-slate-100 border-slate-300' },
  portChina: { id: 'portChina', label: 'EN PUERTO CHINA', emoji: '🚢', bgColor: 'bg-blue-100 border-blue-300' },
  seaRoute: { id: 'seaRoute', label: 'EN RUTA MARÍTIMA', emoji: '🌊', bgColor: 'bg-cyan-100 border-cyan-300' },
  portColombia: { id: 'portColombia', label: 'EN PUERTO COLOMBIA', emoji: '⚓', bgColor: 'bg-emerald-100 border-emerald-300' },
  warehouseColombia: { id: 'warehouseColombia', label: 'EN BODEGA COLOMBIA', emoji: '🏚️', bgColor: 'bg-amber-100 border-amber-300' },
  delivered: { id: 'delivered', label: 'ENTREGADO', emoji: '✅', bgColor: 'bg-green-100 border-green-500' }
};

// --- ESTADOS INICIALES ---
const getInitialWinner = () => ({
  type: 'winner',
  name: '', dropiCode: '', supplier: '', description: '',
  costs: { base: 0, freight: 0, fulfillment: 0, commission: 0, cpa: 0, returns: 0, fixed: 0 },
  targetPrice: 0, status: 'pending', rejectionReason: '', image: null, order: 0,
  isWorking: false,
  createdAtText: '',
  testingData: Array(5).fill().map((_, i) => ({ id: i+1, sellerName: '', startDate: '', endDate: '' })),
  upsells: [
    { id: 1, name: '', cost: 0, price: 0, image: null },
    { id: 2, name: '', cost: 0, price: 0, image: null },
    { id: 3, name: '', cost: 0, price: 0, image: null },
    { id: 4, name: '', cost: 0, price: 0, image: null },
    { id: 5, name: '', cost: 0, price: 0, image: null }
  ]
});

const getInitialImport = () => ({
  type: 'import',
  name: '', chineseSupplier: '', dollarRate: 0, prodCostUSD: 0, cbmCostCOP: 0,
  unitsQty: 0, ctnQty: 0, yiwuFreightUSD: 0, status: 'pending', image: null, order: 0,
  isWorking: false,
  createdAtText: '',
  measures: { width: 0, height: 0, length: 0 },
  purchaseDate: '',
  advancePayment: { amount: 0, date: '' },
  totalPayment: { amount: 0, date: '' },
  actualQuantity: 0,
  variables: Array(5).fill().map((_, i) => ({ id: i+1, name: '', qty: 0 })),
  importStatus: 'warehouse'
});

const getInitialProjection = () => ({
  name: '', price: '', productCost: '', freight: '', fulfillment: '', commission: '',
  adSpend: '', cpm: '', ctr: '', loadSpeed: '', conversionRate: '',
  effectiveness: '', returnRate: '', fixedExpenses: '', activeCampaigns: 1
});

// --- AYUDANTES ---
const formatCurrency = (val) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(val || 0);

const getCurrentDateTime = () => {
  const now = new Date();
  const day = now.getDate().toString().padStart(2, '0');
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const year = now.getFullYear();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
};

const calculateWinnerMetrics = (p) => {
  if (!p) return { totalCost: 0, totalPrice: 0, profit: 0, margin: 0, activeUpsells: 0 };
  const c = p.costs || {};
  const baseCost = (parseFloat(c.base)||0) + (parseFloat(c.freight)||0) + (parseFloat(c.fulfillment)||0) +
    (parseFloat(c.commission)||0) + (parseFloat(c.cpa)||0) + (parseFloat(c.returns)||0) + (parseFloat(c.fixed)||0);
  const basePrice = parseFloat(p.targetPrice) || 0;
  const upsells = p.upsells || [];
  const uCost = upsells.reduce((sum, u) => sum + (parseFloat(u.cost)||0), 0);
  const uPrice = upsells.reduce((sum, u) => sum + (parseFloat(u.price)||0), 0);
  const totalCost = baseCost + uCost;
  const totalPrice = basePrice + uPrice;
  const profit = totalPrice - totalCost;
  const margin = totalPrice > 0 ? (profit / totalPrice) * 100 : 0;
  return { totalCost, totalPrice, profit, margin, activeUpsells: upsells.filter(u => u.name).length };
};

const calculateImportMetrics = (p) => {
  if (!p) return { cbmPerCtn: 0, totalCbm: 0, costChinaCOP: 0, nationalizationCOP: 0, totalLandCostCOP: 0, unitCostColombia: 0 };
  const m = p.measures || { width: 0, height: 0, length: 0 };
  const cbmPerCtn = (parseFloat(m.width) * parseFloat(m.height) * parseFloat(m.length)) / 1000000;
  const totalCbm = cbmPerCtn * (parseFloat(p.ctnQty) || 0);
  const costChinaUSD = ((parseFloat(p.prodCostUSD) || 0) * (parseFloat(p.unitsQty) || 0)) + (parseFloat(p.yiwuFreightUSD) || 0);
  const costChinaCOP = costChinaUSD * (parseFloat(p.dollarRate) || 0) * 1.03;
  const nationalizationCOP = totalCbm * (parseFloat(p.cbmCostCOP) || 0);
  const totalLandCostCOP = costChinaCOP + nationalizationCOP;
  const unitCostColombia = (parseFloat(p.unitsQty) > 0) ? totalLandCostCOP / parseFloat(p.unitsQty) : 0;
  return { cbmPerCtn, totalCbm, costChinaCOP, nationalizationCOP, totalLandCostCOP, unitCostColombia };
};

const compressImage = (base64Str) => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX_WIDTH = 800;
      const MAX_HEIGHT = 800;
      let width = img.width;
      let height = img.height;
      if (width > height) {
        if (width > MAX_WIDTH) { height = Math.round((height * MAX_WIDTH) / width); width = MAX_WIDTH; }
      } else {
        if (height > MAX_HEIGHT) { width = Math.round((width * MAX_HEIGHT) / height); height = MAX_HEIGHT; }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.7)); 
    };
  });
};

// --- COMPONENTES P&G ---
const InputP = ({ label, value, onChange, type="number", prefix="", suffix="" }) => {
  let displayVal = value;
  if (type === 'currency') {
     displayVal = value ? new Intl.NumberFormat('es-CO').format(value) : '';
  }
  const handleInput = (e) => {
     if (type === 'currency') {
        const numericString = e.target.value.replace(/\D/g, '');
        onChange(numericString !== '' ? parseFloat(numericString) : '');
     } else {
        onChange(e.target.value !== '' ? parseFloat(e.target.value) : '');
     }
  };
  return (
    <div className="bg-emerald-50/70 p-3 md:p-4 rounded-xl md:rounded-2xl border-2 border-emerald-100 focus-within:border-emerald-400 transition-colors shadow-sm">
      <label className="text-[9px] md:text-[11px] font-black text-emerald-700 uppercase block mb-1 md:mb-2">{label} ✎</label>
      <div className="flex items-center gap-1">
        {prefix && <span className="text-emerald-600 font-bold">{prefix}</span>}
        <input 
          type={type === 'currency' ? 'text' : type} 
          value={displayVal} 
          onChange={handleInput}
          className="w-full bg-transparent text-sm md:text-base font-bold text-emerald-950 outline-none font-mono placeholder:text-emerald-300"
          placeholder="0"
        />
        {suffix && <span className="text-emerald-600 font-bold">{suffix}</span>}
      </div>
    </div>
  );
};

const OutputP = ({ label, value, type="currency", decimals=2, highlight=false, customBg, customText }) => {
  let displayValue = 0;
  const numValue = parseFloat(value) || 0;
  if (type === "currency") displayValue = formatCurrency(numValue);
  else if (type === "number") displayValue = numValue.toFixed(decimals);
  else if (type === "percent") displayValue = `${numValue.toFixed(decimals)}%`;

  let baseBg = customBg || (highlight ? 'bg-zinc-900 border-zinc-900 shadow-xl' : 'bg-zinc-50 border-zinc-200 shadow-inner');
  let baseText = customText || (highlight ? 'text-white' : 'text-zinc-800');
  let labelText = customText ? 'text-white/80' : (highlight ? 'text-zinc-400' : 'text-zinc-500');

  return (
    <div className={`p-3 md:p-4 rounded-xl md:rounded-2xl border text-left ${baseBg}`}>
      <label className={`text-[8px] md:text-[10px] font-black uppercase block mb-1 md:mb-2 ${labelText}`}>{label}</label>
      <div className={`font-mono text-sm md:text-lg font-black truncate ${baseText}`}>
        {displayValue}
      </div>
    </div>
  );
};

// --- COMPONENTE LOGIN ---
function LoginScreen({ setErrorExt }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      console.error(err);
      let msg = 'Credenciales inválidas.';
      if (err.code === 'auth/network-request-failed') msg = 'Error de red o API restringida.';
      setError(msg);
      setErrorExt?.(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f1f5f9] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-[2.5rem] shadow-2xl p-8 md:p-12 border border-zinc-200/50 animate-in zoom-in-95 duration-300 text-center">
        <div className="w-20 h-20 bg-zinc-900 rounded-[1.5rem] flex items-center justify-center text-white text-4xl shadow-xl italic font-black mx-auto mb-6">W</div>
        <h1 className="text-3xl font-black tracking-tighter uppercase italic text-zinc-900 leading-none">Winner OS</h1>
        <p className="text-zinc-400 text-[10px] font-bold mt-2 tracking-widest uppercase mb-10 text-center w-full">Cloud Management System</p>
        <form onSubmit={handleLogin} className="space-y-6 text-left">
          <div>
            <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block mb-2 px-1 leading-none">Correo Electrónico</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-zinc-50 border-2 border-zinc-100 rounded-2xl p-4 text-base focus:outline-none focus:border-zinc-900 transition-all text-zinc-700 outline-none" placeholder="admin@winneros.com"/>
          </div>
          <div>
            <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block mb-2 px-1 leading-none">Contraseña</label>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-zinc-50 border-2 border-zinc-100 rounded-2xl p-4 text-base focus:outline-none focus:border-zinc-900 transition-all text-zinc-700 outline-none" placeholder="••••••••"/>
          </div>
          {error && <div className="bg-rose-50 border border-rose-100 p-4 rounded-2xl text-rose-600 text-[11px] font-bold uppercase text-center leading-tight">⚠️ {error}</div>}
          <button type="submit" disabled={loading} className="w-full bg-zinc-900 hover:bg-black text-white font-black py-5 rounded-2xl text-xs shadow-2xl transition-all uppercase tracking-[0.2em] active:scale-[0.98] disabled:opacity-50">
            {loading ? 'Validando...' : 'Entrar al Sistema'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ==================== COMPONENTE AGENDA ====================
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
  const [approvalModal, setApprovalModal] = useState({ show: false, taskId: null, justification: '' });
  const [formData, setFormData] = useState({
    title: '', description: '', responsible: 'david', priority: 'media', status: 'pending', dueDate: ''
  });

  useEffect(() => {
    if (!auth.currentUser) return;
    const tasksRef = collection(db, 'artifacts', appId, 'public', 'data', 'agenda_tasks');
    const unsubscribe = onSnapshot(tasksRef, (snapshot) => {
      const loaded = snapshot.docs.map(doc => {
        const data = doc.data();
        let createdAtFormatted = '';
        if (data.createdAt?.toDate) {
          const d = data.createdAt.toDate();
          createdAtFormatted = `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getFullYear()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
        }
        let dueDateStr = data.dueDate?.toDate ? data.dueDate.toDate().toISOString().split('T')[0] : '';
        let approvedAtFormatted = '';
        if (data.approvedAt?.toDate) {
          const d = data.approvedAt.toDate();
          approvedAtFormatted = `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getFullYear()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
        }
        return { id: doc.id, ...data, createdAtFormatted, dueDate: dueDateStr, approvedAtFormatted, comments: data.comments || [] };
      });
      setTasks(loaded);
    });
    return () => unsubscribe();
  }, []);

  const handleFormChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });
  const saveTask = async () => {
    if (!formData.title.trim()) { alert("El título es obligatorio"); return; }
    const payload = {
      title: formData.title.trim(), description: formData.description.trim(), responsible: formData.responsible,
      priority: formData.priority, status: formData.status, dueDate: formData.dueDate ? Timestamp.fromDate(new Date(formData.dueDate)) : null,
      updatedAt: serverTimestamp(), createdBy: auth.currentUser?.uid
    };
    try {
      if (editingTask) {
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'agenda_tasks', editingTask.id), payload);
      } else {
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'agenda_tasks'), { ...payload, createdAt: serverTimestamp(), comments: [] });
      }
      resetForm();
    } catch (err) { console.error(err); alert("Error al guardar la tarea"); }
  };
  const deleteTask = async (id) => {
    if (window.confirm("¿Eliminar esta tarea definitivamente?")) {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'agenda_tasks', id));
    }
  };
  const handleStatusChange = async (taskId, newStatus, taskDueDate) => {
    if (newStatus === 'approved') {
      setApprovalModal({ show: true, taskId, justification: '', dueDate: taskDueDate });
    } else {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'agenda_tasks', taskId), { status: newStatus, updatedAt: serverTimestamp() });
    }
  };
  const confirmApproval = async () => {
    const { taskId, justification, dueDate } = approvalModal;
    if (!justification.trim()) { alert("Debes escribir una justificación para aprobar la tarea"); return; }
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
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'agenda_tasks', taskId), {
        status: 'approved', approvedAt, approvedAtFormatted, approvalJustification: justification.trim(), approvalDelayInfo: delayInfo, updatedAt: serverTimestamp()
      });
      setApprovalModal({ show: false, taskId: null, justification: '' });
    } catch (err) { console.error(err); alert("Error al guardar la aprobación"); }
  };
  const addComment = async (taskId) => {
    const commentText = newComment[taskId]?.trim();
    if (!commentText) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const responsibleName = RESPONSIBLES.find(r => r.id === task.responsible)?.name || 'Usuario';
    const comment = {
      id: Date.now().toString(), text: commentText, author: responsibleName, authorId: task.responsible,
      createdAt: new Date().toLocaleString('es-CO')
    };
    const updatedComments = [...(task.comments || []), comment];
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'agenda_tasks', taskId), { comments: updatedComments, updatedAt: serverTimestamp() });
      setNewComment(prev => ({ ...prev, [taskId]: '' }));
    } catch (err) { console.error(err); alert("Error al guardar el comentario"); }
  };
  const resetForm = () => {
    setFormData({ title: '', description: '', responsible: 'david', priority: 'media', status: 'pending', dueDate: '' });
    setEditingTask(null); setShowForm(false);
  };
  const editTask = (task) => {
    setFormData({ title: task.title, description: task.description || '', responsible: task.responsible, priority: task.priority || 'media', status: task.status, dueDate: task.dueDate || '' });
    setEditingTask(task); setShowForm(true);
  };
  const toggleComments = (taskId) => setExpandedComments(prev => ({ ...prev, [taskId]: !prev[taskId] }));

  const filteredTasks = tasks
    .filter(t => t.status === activeTab)
    .filter(t => filterResponsible === 'all' || t.responsible === filterResponsible)
    .filter(t => t.title?.toLowerCase().includes(searchTerm.toLowerCase()) || t.description?.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'dueDate') {
        if (!a.dueDate) return 1; if (!b.dueDate) return -1;
        return new Date(a.dueDate) - new Date(b.dueDate);
      }
      if (sortBy === 'priority') {
        const order = { alta: 0, media: 1, baja: 2 };
        return (order[a.priority] || 1) - (order[b.priority] || 1);
      }
      return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
    });

  const getTaskCount = (status) => tasks.filter(t => t.status === status).length;
  const getComplianceByResponsible = () => {
    return RESPONSIBLES.map(resp => {
      const userTasks = tasks.filter(t => t.responsible === resp.id);
      const total = userTasks.length;
      const approved = userTasks.filter(t => t.status === 'approved').length;
      const rejected = userTasks.filter(t => t.status === 'rejected').length;
      const pending = total - approved - rejected;
      const percent = total === 0 ? 0 : Math.round((approved / total) * 100);
      let barColor = 'bg-emerald-500';
      if (percent < 30) barColor = 'bg-rose-500';
      else if (percent < 70) barColor = 'bg-amber-500';
      return { ...resp, total, approved, rejected, pending, percent, barColor };
    });
  };
  const complianceData = getComplianceByResponsible();
  const overallTotal = tasks.length;
  const overallApproved = tasks.filter(t => t.status === 'approved').length;
  const overallPercent = overallTotal === 0 ? 0 : Math.round((overallApproved / overallTotal) * 100);
  const pendingByResponsible = RESPONSIBLES.map(resp => ({ ...resp, total: tasks.filter(t => t.status === 'pending' && t.responsible === resp.id).length }));

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {approvalModal.show && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4" onClick={() => setApprovalModal({ show: false, taskId: null, justification: '' })}>
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-black text-green-600 mb-4">✅ Aprobar Tarea</h3>
            <textarea value={approvalModal.justification} onChange={(e) => setApprovalModal(prev => ({ ...prev, justification: e.target.value }))} rows={4} placeholder="Describe las acciones realizadas..." className="w-full border rounded-xl p-3 text-sm mb-4" autoFocus />
            <div className="flex gap-3">
              <button onClick={() => setApprovalModal({ show: false, taskId: null, justification: '' })} className="flex-1 border rounded-xl py-2">Cancelar</button>
              <button onClick={confirmApproval} className="flex-1 bg-green-600 text-white rounded-xl py-2">Confirmar</button>
            </div>
          </div>
        </div>
      )}
      {selectedTask && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-40 p-4" onClick={() => setSelectedTask(null)}>
          <div className="bg-white rounded-2xl max-w-md w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white p-4 border-b flex justify-between"><h3 className="font-black">{selectedTask.title}</h3><button onClick={() => setSelectedTask(null)} className="text-2xl">&times;</button></div>
            <div className="p-4 space-y-3">
              <div className="bg-zinc-50 p-3 rounded-xl"><p className="text-xs font-black">📝 Descripción</p><p>{selectedTask.description || 'Sin descripción'}</p></div>
              {selectedTask.status === 'approved' && selectedTask.approvalJustification && (
                <div className="bg-green-50 p-3 rounded-xl border border-green-200">
                  <p className="text-xs font-black text-green-700">✅ Aprobada el: {selectedTask.approvedAtFormatted}</p>
                  <p className="text-xs font-bold">{selectedTask.approvalDelayInfo?.message}</p>
                  <p className="text-xs mt-1">Justificación: {selectedTask.approvalJustification}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="font-black">Responsable:</span> {RESPONSIBLES.find(r => r.id === selectedTask.responsible)?.name}</div>
                <div><span className="font-black">Prioridad:</span> {PRIORITIES[selectedTask.priority]?.emoji} {PRIORITIES[selectedTask.priority]?.label}</div>
                <div><span className="font-black">Estado:</span> {TASK_STATUS[selectedTask.status]?.emoji} {TASK_STATUS[selectedTask.status]?.label}</div>
                <div><span className="font-black">Fecha límite:</span> {selectedTask.dueDate || '-'}</div>
              </div>
              <div className="bg-zinc-50 p-3 rounded-xl">
                <p className="text-xs font-black">💬 Comentarios ({selectedTask.comments?.length || 0})</p>
                <div className="max-h-32 overflow-y-auto space-y-1 my-2">{selectedTask.comments?.map(c => <div key={c.id} className="text-xs border-b pb-1"><b>{c.author}</b> ({c.createdAt}): {c.text}</div>)}</div>
                <div className="flex gap-2"><input value={newComment[selectedTask.id] || ''} onChange={(e) => setNewComment(prev => ({ ...prev, [selectedTask.id]: e.target.value }))} placeholder="Escribe un comentario..." className="flex-1 border rounded-xl px-3 py-1 text-sm" /><button onClick={() => addComment(selectedTask.id)} className="bg-blue-600 text-white px-3 rounded-xl text-sm">Enviar</button></div>
              </div>
              <div className="flex gap-2"><button onClick={() => { setSelectedTask(null); editTask(selectedTask); }} className="flex-1 bg-indigo-50 py-2 rounded-xl">✏️ Editar</button><button onClick={() => { deleteTask(selectedTask.id); setSelectedTask(null); }} className="flex-1 bg-rose-50 py-2 rounded-xl">🗑️ Eliminar</button></div>
            </div>
          </div>
        </div>
      )}
      <div className="bg-white rounded-2xl p-4 shadow-sm border"><div className="flex justify-between items-center mb-3"><h3 className="font-black">📊 Cumplimiento por Responsable</h3><span className="text-xs">Total: {overallApproved}/{overallTotal} ({overallPercent}%)</span></div><div className="grid grid-cols-1 md:grid-cols-3 gap-4">{complianceData.map(resp => (<div key={resp.id} className={`${resp.bgLight} rounded-xl p-3`}><div className="flex justify-between"><div><div className="flex gap-1"><div className={`w-3 h-3 rounded-full ${resp.barColor}`}></div><span className="font-black">{resp.name}</span></div><span className="text-2xl font-black">{resp.percent}%</span></div><div className="text-right"><span className="text-xs text-zinc-500">Tareas</span><div className="font-bold">{resp.approved}/{resp.total}</div></div></div><div className="h-2 bg-white rounded-full my-2"><div className={`h-full rounded-full ${resp.barColor}`} style={{ width: `${resp.percent}%` }}></div></div><div className="flex justify-between text-[10px] font-bold"><span>✅ {resp.approved}</span><span>⏳ {resp.pending}</span><span>❌ {resp.rejected}</span></div></div>))}</div></div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">{pendingByResponsible.map(resp => (<div key={resp.id} className="bg-white rounded-xl p-3 text-center shadow-sm border"><p className="text-[10px] font-black uppercase">Pendientes {resp.name}</p><p className="text-3xl font-black" style={{ color: resp.color === 'blue' ? '#2563eb' : (resp.color === 'purple' ? '#9333ea' : '#16a34a') }}>{resp.total}</p></div>))}</div>
      <div className="bg-white rounded-xl p-1 shadow-sm border"><div className="flex flex-wrap gap-1 justify-center">{AGENDA_TABS.map(tab => (<button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`px-4 py-2 rounded-xl font-black text-xs uppercase flex items-center gap-1 ${activeTab === tab.id ? `${tab.color} text-white shadow-md` : 'bg-zinc-100'}`}><span>{tab.emoji}</span> {tab.label} <span className="ml-1 px-1 rounded-full bg-white/30">{getTaskCount(tab.id)}</span></button>))}</div></div>
      <div className="flex flex-col md:flex-row gap-3"><input type="text" placeholder="🔍 Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="flex-1 border rounded-xl px-3 py-2 text-sm" /><select value={filterResponsible} onChange={(e) => setFilterResponsible(e.target.value)} className="border rounded-xl px-3 py-2 text-sm"><option value="all">👥 Todos</option>{RESPONSIBLES.map(r => <option key={r.id} value={r.id}>👤 {r.name}</option>)}</select><select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="border rounded-xl px-3 py-2 text-sm"><option value="dueDate">📅 Fecha límite</option><option value="priority">⚠️ Prioridad</option><option value="createdAt">🕒 Creación</option></select></div>
      <div className="flex justify-end"><button onClick={() => { resetForm(); setShowForm(true); }} className="bg-zinc-900 text-white px-5 py-2 rounded-xl text-xs font-black">➕ Nueva Tarea</button></div>
      {showForm && (<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"><div className="bg-white rounded-2xl max-w-lg w-full p-5"><h3 className="font-black mb-4">{editingTask ? 'Editar Tarea' : 'Nueva Tarea'}</h3><div className="space-y-3"><input name="title" value={formData.title} onChange={handleFormChange} placeholder="Título *" className="w-full border rounded-xl p-2" /><textarea name="description" value={formData.description} onChange={handleFormChange} rows={2} placeholder="Descripción" className="w-full border rounded-xl p-2" /><div className="grid grid-cols-2 gap-2"><select name="responsible" value={formData.responsible} onChange={handleFormChange} className="border rounded-xl p-2">{RESPONSIBLES.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select><select name="priority" value={formData.priority} onChange={handleFormChange} className="border rounded-xl p-2">{Object.entries(PRIORITIES).map(([k,v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}</select></div><div className="grid grid-cols-2 gap-2"><select name="status" value={formData.status} onChange={handleFormChange} className="border rounded-xl p-2">{Object.entries(TASK_STATUS).map(([k,v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}</select><input type="date" name="dueDate" value={formData.dueDate} onChange={handleFormChange} className="border rounded-xl p-2" /></div></div><div className="flex justify-end gap-3 mt-5"><button onClick={resetForm} className="border rounded-xl px-4 py-1">Cancelar</button><button onClick={saveTask} className="bg-zinc-900 text-white rounded-xl px-4 py-1">Guardar</button></div></div></div>)}
      <div className="hidden md:block bg-white rounded-2xl shadow-sm border overflow-x-auto"><table className="w-full text-left"><thead className="bg-zinc-50 border-b"><tr><th className="px-4 py-2 text-[10px]">Título</th><th className="px-4 py-2">Responsable</th><th className="px-4 py-2">Prioridad</th><th className="px-4 py-2">Estado</th><th className="px-4 py-2">Fecha límite</th><th className="px-4 py-2">Creada</th><th className="px-4 py-2">Acciones</th></tr></thead><tbody>{filteredTasks.map(task => { const resp = RESPONSIBLES.find(r => r.id === task.responsible); const priorityConfig = PRIORITIES[task.priority] || PRIORITIES.media; const statusConfig = TASK_STATUS[task.status] || TASK_STATUS.pending; const isOverdue = task.dueDate && task.status !== 'approved' && new Date(task.dueDate) < new Date(); const delayInfo = task.approvalDelayInfo; return (<React.Fragment key={task.id}><tr className="border-b hover:bg-zinc-50"><td className="px-4 py-2"><button onClick={() => setSelectedTask(task)} className="font-bold text-sm">{task.title}{task.description && <div className="text-[10px] text-zinc-400">{task.description}</div>}{task.status === 'approved' && delayInfo && <div className="text-[9px] text-orange-600">{delayInfo.message}</div>}</button></td><td><span className={`px-2 py-1 rounded-full text-[10px] font-black ${resp?.color === 'blue' ? 'bg-blue-100' : resp?.color === 'purple' ? 'bg-purple-100' : 'bg-green-100'}`}>{resp?.name}</span></td><td><span className={`px-2 py-1 rounded-full text-[10px] font-bold ${priorityConfig.color}`}>{priorityConfig.emoji} {priorityConfig.label}</span></td><td><select value={task.status} onChange={(e) => handleStatusChange(task.id, e.target.value, task.dueDate)} className={`text-[10px] font-bold rounded-full px-2 py-1 border ${statusConfig.color}`} disabled={task.status === 'approved'}>{Object.entries(TASK_STATUS).map(([k,v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}</select></td><td className="text-sm">{task.dueDate ? <span className={isOverdue ? 'text-rose-600 font-bold' : ''}>{task.dueDate}</span> : '-'}</td><td className="text-xs">{task.createdAtFormatted || '-'}</td><td className="flex gap-1"><button onClick={() => toggleComments(task.id)} className="text-blue-600">💬 {task.comments?.length || 0}</button><button onClick={() => editTask(task)} className="text-indigo-600">✏️</button><button onClick={() => deleteTask(task.id)} className="text-rose-600">🗑️</button></td></tr>{expandedComments[task.id] && (<tr className="bg-zinc-50"><td colSpan="7" className="p-3"><div className="space-y-2 max-h-48 overflow-y-auto">{task.comments?.map(c => { const a = RESPONSIBLES.find(r => r.id === c.authorId); return (<div key={c.id} className={`${a?.bgLight} p-2 rounded-lg`}><div className="flex justify-between"><span className="font-bold text-xs">{c.author}</span><span className="text-[9px]">{c.createdAt}</span></div><p className="text-xs">{c.text}</p></div>); })}</div><div className="mt-2 flex gap-2"><input value={newComment[task.id] || ''} onChange={(e) => setNewComment(prev => ({ ...prev, [task.id]: e.target.value }))} placeholder="Comentario..." className="flex-1 border rounded-xl px-2 py-1 text-sm" /><button onClick={() => addComment(task.id)} className="bg-blue-600 text-white px-3 rounded-xl text-sm">Enviar</button></div></td></tr>)}</React.Fragment>);})}{filteredTasks.length === 0 && <tr><td colSpan="7" className="text-center py-8">No hay tareas</td></tr>}</tbody></table></div>
      <div className="md:hidden space-y-3 p-2">{filteredTasks.map(task => { const resp = RESPONSIBLES.find(r => r.id === task.responsible); const priorityConfig = PRIORITIES[task.priority] || PRIORITIES.media; const statusConfig = TASK_STATUS[task.status] || TASK_STATUS.pending; const isOverdue = task.dueDate && task.status !== 'approved' && new Date(task.dueDate) < new Date(); const delayInfo = task.approvalDelayInfo; const isOpen = expandedComments[task.id]; return (<div key={task.id} className="bg-white border rounded-xl p-3"><button onClick={() => setSelectedTask(task)} className="w-full text-left"><h3 className="font-black">{task.title}</h3>{task.description && <p className="text-xs text-zinc-500">{task.description}</p>}{task.status === 'approved' && delayInfo && <p className="text-[10px] text-orange-600">{delayInfo.message}</p>}</button><div className="flex flex-wrap gap-2 mt-2"><span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${resp?.color === 'blue' ? 'bg-blue-100' : resp?.color === 'purple' ? 'bg-purple-100' : 'bg-green-100'}`}>{resp?.name}</span><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${priorityConfig.color}`}>{priorityConfig.emoji} {priorityConfig.label}</span><select value={task.status} onChange={(e) => handleStatusChange(task.id, e.target.value, task.dueDate)} className={`text-[10px] font-bold rounded-full px-2 py-0.5 border ${statusConfig.color}`} disabled={task.status === 'approved'}>{Object.entries(TASK_STATUS).map(([k,v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}</select></div><div className="flex justify-between text-xs mt-2"><span>📅 {task.dueDate || '-'}</span><span>🕒 {task.createdAtFormatted || '-'}</span></div><div className="flex gap-2 mt-2"><button onClick={() => toggleComments(task.id)} className="flex-1 bg-blue-50 py-1 rounded-lg text-xs">💬 {task.comments?.length || 0}</button><button onClick={() => editTask(task)} className="flex-1 bg-indigo-50 py-1 rounded-lg text-xs">✏️</button><button onClick={() => deleteTask(task.id)} className="flex-1 bg-rose-50 py-1 rounded-lg text-xs">🗑️</button></div>{isOpen && (<div className="mt-2 bg-zinc-50 p-2 rounded-lg space-y-2"><div className="max-h-40 overflow-y-auto">{task.comments?.map(c => { const a = RESPONSIBLES.find(r => r.id === c.authorId); return (<div key={c.id} className="border-b pb-1"><span className="font-bold text-xs">{c.author}</span> <span className="text-[9px]">{c.createdAt}</span><p className="text-xs">{c.text}</p></div>); })}</div><div className="flex gap-2"><input value={newComment[task.id] || ''} onChange={(e) => setNewComment(prev => ({ ...prev, [task.id]: e.target.value }))} placeholder="Comentario..." className="flex-1 border rounded-lg px-2 py-1 text-sm" /><button onClick={() => addComment(task.id)} className="bg-blue-600 text-white px-3 rounded-lg text-sm">Enviar</button></div></div>)}</div>);})}</div>
    </div>
  );
}

// ==================== COMPONENTE PROMPTS IA ====================
const PROMPT_CATEGORIES = [
  { id: 'landing', label: '🚀 Landing Page', color: 'bg-blue-50 border-blue-300 text-blue-700' },
  { id: 'anuncios', label: '📢 Anuncios Publicitarios', color: 'bg-amber-50 border-amber-300 text-amber-700' },
  { id: 'diseno', label: '🎨 Reglas de Diseño', color: 'bg-purple-50 border-purple-300 text-purple-700' },
  { id: 'otros', label: '📦 Otros', color: 'bg-gray-50 border-gray-300 text-gray-700' }
];

function PromptModule() {
  const [prompts, setPrompts] = useState([]);
  const [activeCategory, setActiveCategory] = useState('todos');
  const [showForm, setShowForm] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    content: '',
    category: 'landing'
  });
  const [notification, setNotification] = useState('');
  const [instructions, setInstructions] = useState({});

  useEffect(() => {
    if (!auth.currentUser) return;
    const promptsRef = collection(db, 'artifacts', appId, 'public', 'data', 'prompts');
    const unsubscribePrompts = onSnapshot(promptsRef, (snapshot) => {
      const loaded = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      loaded.sort((a, b) => (a.order || 0) - (b.order || 0));
      setPrompts(loaded);
    });

    const instructionsRef = collection(db, 'artifacts', appId, 'public', 'data', 'prompt_instructions');
    const unsubscribeInstructions = onSnapshot(instructionsRef, (snapshot) => {
      const loaded = {};
      snapshot.docs.forEach(doc => {
        loaded[doc.id] = doc.data().text || '';
      });
      setInstructions(loaded);
    });

    return () => {
      unsubscribePrompts();
      unsubscribeInstructions();
    };
  }, []);

  const saveInstruction = async (categoryId, text) => {
    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'prompt_instructions', categoryId);
      await setDoc(docRef, { text, updatedAt: serverTimestamp() }, { merge: true });
      setNotification('✅ Instrucción guardada');
      setTimeout(() => setNotification(''), 2000);
    } catch (err) {
      console.error(err);
      alert('Error al guardar instrucción');
    }
  };

  const handleFormChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const savePrompt = async () => {
    if (!formData.name.trim() || !formData.content.trim()) {
      alert("El nombre y el contenido son obligatorios");
      return;
    }
    const payload = {
      name: formData.name.trim(),
      content: formData.content.trim(),
      category: formData.category,
      order: prompts.length,
      updatedAt: serverTimestamp(),
      createdBy: auth.currentUser?.uid
    };
    try {
      if (editingPrompt) {
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'prompts', editingPrompt.id), payload);
      } else {
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'prompts'), {
          ...payload,
          createdAt: serverTimestamp()
        });
      }
      resetForm();
      setNotification(editingPrompt ? '✅ Prompt actualizado' : '✅ Prompt creado');
      setTimeout(() => setNotification(''), 3000);
    } catch (err) {
      console.error(err);
      alert("Error al guardar el prompt");
    }
  };

  const deletePrompt = async (id) => {
    if (window.confirm("¿Eliminar este prompt definitivamente?")) {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'prompts', id));
    }
  };

  const resetForm = () => {
    setFormData({ name: '', content: '', category: 'landing' });
    setEditingPrompt(null);
    setShowForm(false);
  };

  const editPrompt = (prompt) => {
    setFormData({
      name: prompt.name,
      content: prompt.content,
      category: prompt.category || 'landing'
    });
    setEditingPrompt(prompt);
    setShowForm(true);
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      setNotification('📋 Prompt copiado al portapapeles');
      setTimeout(() => setNotification(''), 2000);
    }).catch(() => {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setNotification('📋 Prompt copiado');
      setTimeout(() => setNotification(''), 2000);
    });
  };

  const movePrompt = async (id, direction) => {
    const index = prompts.findIndex(p => p.id === id);
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= prompts.length) return;

    const updatedPrompts = [...prompts];
    const [movedItem] = updatedPrompts.splice(index, 1);
    updatedPrompts.splice(newIndex, 0, movedItem);

    const updates = updatedPrompts.map((p, i) => {
      return updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'prompts', p.id), { order: i });
    });
    try {
      await Promise.all(updates);
    } catch (err) {
      console.error(err);
      alert('Error al reordenar');
    }
  };

  const filteredPrompts = activeCategory === 'todos'
    ? prompts
    : prompts.filter(p => p.category === activeCategory);

  const getCategoryLabel = (catId) => {
    const found = PROMPT_CATEGORIES.find(c => c.id === catId);
    return found ? found.label : catId;
  };

  const getCategoryColor = (catId) => {
    const found = PROMPT_CATEGORIES.find(c => c.id === catId);
    return found ? found.color : 'bg-gray-50 border-gray-300 text-gray-700';
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {notification && (
        <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-zinc-900 text-white px-6 py-3 rounded-xl text-xs font-black z-50 shadow-xl">
          {notification}
        </div>
      )}

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-zinc-900">🎨 Prompts IA</h2>
          <p className="text-sm text-zinc-500">Gestiona tus prompts de generación de imágenes por categorías</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="bg-zinc-900 hover:bg-black text-white px-6 py-3 rounded-xl font-black text-xs uppercase shadow-lg flex items-center gap-2 transition-all active:scale-95"
        >
          ➕ Nuevo Prompt
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setActiveCategory('todos')}
          className={`px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all ${activeCategory === 'todos' ? 'bg-zinc-900 text-white shadow-md' : 'bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50'}`}
        >
          📋 Todos ({prompts.length})
        </button>
        {PROMPT_CATEGORIES.map(cat => {
          const count = prompts.filter(p => p.category === cat.id).length;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all ${activeCategory === cat.id ? 'bg-zinc-900 text-white shadow-md' : 'bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50'}`}
            >
              {cat.label} ({count})
            </button>
          );
        })}
      </div>

      {activeCategory !== 'todos' && (
        <div className="bg-white rounded-2xl p-5 border border-zinc-200 shadow-sm space-y-2">
          <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-wider">📝 Instrucciones / Pasos para {getCategoryLabel(activeCategory)}</label>
          <div className="flex gap-3 items-start">
            <textarea
              value={instructions[activeCategory] || ''}
              onChange={(e) => {
                const newText = e.target.value;
                setInstructions(prev => ({ ...prev, [activeCategory]: newText }));
              }}
              rows={3}
              className="flex-1 bg-zinc-50 border border-zinc-200 rounded-xl p-3 text-sm focus:outline-none focus:border-zinc-400 resize-y"
              placeholder="Escribe los pasos o instrucciones para esta categoría..."
            />
            <button
              onClick={() => saveInstruction(activeCategory, instructions[activeCategory] || '')}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-xs font-black whitespace-nowrap"
            >
              Guardar Instrucción
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <div className="bg-white rounded-2xl p-6 shadow-lg border border-zinc-200 space-y-4">
          <h3 className="font-black text-lg">{editingPrompt ? '✏️ Editar Prompt' : '📝 Nuevo Prompt'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black text-zinc-500 mb-1">Nombre del Prompt *</label>
              <input
                name="name"
                value={formData.name}
                onChange={handleFormChange}
                placeholder="Ej. Landing Hero Section"
                className="w-full border border-zinc-200 rounded-xl p-3 text-sm focus:outline-none focus:border-zinc-900"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-zinc-500 mb-1">Categoría *</label>
              <select
                name="category"
                value={formData.category}
                onChange={handleFormChange}
                className="w-full border border-zinc-200 rounded-xl p-3 text-sm focus:outline-none focus:border-zinc-900"
              >
                {PROMPT_CATEGORIES.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-black text-zinc-500 mb-1">Contenido del Prompt *</label>
            <textarea
              name="content"
              value={formData.content}
              onChange={handleFormChange}
              rows={6}
              placeholder="Escribe tu prompt aquí..."
              className="w-full border border-zinc-200 rounded-xl p-3 text-sm focus:outline-none focus:border-zinc-900 resize-y font-mono"
            />
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={resetForm} className="px-5 py-2 rounded-xl border border-zinc-200 text-sm font-bold">Cancelar</button>
            <button onClick={savePrompt} className="px-5 py-2 rounded-xl bg-zinc-900 text-white text-sm font-bold">Guardar</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredPrompts.length === 0 ? (
          <div className="col-span-full text-center py-12 text-zinc-400 bg-white rounded-2xl border border-zinc-200">
            <p className="text-lg font-black">No hay prompts en esta categoría</p>
            <p className="text-sm mt-1">Crea uno nuevo usando el botón de arriba</p>
          </div>
        ) : (
          filteredPrompts.map((prompt, index) => {
            const categoryStyle = getCategoryColor(prompt.category);
            const isFirst = index === 0;
            const isLast = index === filteredPrompts.length - 1;
            return (
              <div
                key={prompt.id}
                className="bg-white rounded-2xl border border-zinc-200 shadow-sm hover:shadow-md transition-all overflow-hidden group"
              >
                <div className="p-4 border-b border-zinc-100 flex justify-between items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-base truncate">{prompt.name}</span>
                      <span className={`inline-block text-[9px] font-black px-2 py-0.5 rounded-full ${categoryStyle}`}>
                        {getCategoryLabel(prompt.category)}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => movePrompt(prompt.id, -1)}
                      disabled={isFirst}
                      className={`text-zinc-400 hover:text-indigo-600 transition p-1 ${isFirst ? 'opacity-30 cursor-not-allowed' : ''}`}
                      title="Mover arriba"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => movePrompt(prompt.id, 1)}
                      disabled={isLast}
                      className={`text-zinc-400 hover:text-indigo-600 transition p-1 ${isLast ? 'opacity-30 cursor-not-allowed' : ''}`}
                      title="Mover abajo"
                    >
                      ▼
                    </button>
                    <button
                      onClick={() => editPrompt(prompt)}
                      className="text-zinc-400 hover:text-indigo-600 transition p-1"
                      title="Editar"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => deletePrompt(prompt.id)}
                      className="text-zinc-400 hover:text-rose-600 transition p-1"
                      title="Eliminar"
                    >
                      🗑️
                    </button>
                  </div>
                </div>

                <div className="p-4">
                  <textarea
                    value={prompt.content}
                    readOnly
                    rows={5}
                    className="w-full text-sm font-mono bg-zinc-50 rounded-xl p-3 border border-zinc-200 cursor-default text-zinc-800 leading-relaxed resize-none"
                    placeholder="Contenido del prompt..."
                  />
                </div>

                <div className="px-4 pb-4 flex gap-2">
                  <button
                    onClick={() => copyToClipboard(prompt.content)}
                    className="flex-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2"
                  >
                    📋 Copiar Prompt
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}


// ==================== ÁREA DIGITAL 2.0 (COLECCIONES INDEPENDIENTES) ====================
const DIGITAL_STATES = [
  {id:'pending',name:'Pendiente',color:'#64748b'},
  {id:'research',name:'Investigación',color:'#8b5cf6'},
  {id:'production',name:'Producción',color:'#f59e0b'},
  {id:'review',name:'Revisión',color:'#0ea5e9'},
  {id:'ready',name:'Listo para lanzar',color:'#10b981'},
  {id:'launched',name:'Lanzado',color:'#2563eb'}
];
const DIGITAL_STRATEGIES = {
  web: {label:'PÁGINA WEB',icon:'🌐',color:'#2563eb',soft:'#dbeafe'},
  ai: {label:'ASISTENTE IA',icon:'🤖',color:'#7c3aed',soft:'#ede9fe'},
  human: {label:'VENDEDORA HUMANA',icon:'👩‍💼',color:'#be185d',soft:'#fce7f3'}
};
const digitalStrategy = value => DIGITAL_STRATEGIES[value] || null;
const DIGITAL_SETTINGS_ID='digital_workspace_settings';
const compressDigitalImage=file=>new Promise((resolve,reject)=>{
  if(!file?.type?.startsWith('image/')){reject(new Error('Selecciona una imagen válida.'));return;}
  if(file.size>12*1024*1024){reject(new Error('La imagen original no puede superar 12 MB.'));return;}
  const reader=new FileReader();
  reader.onerror=()=>reject(new Error('No se pudo leer la imagen.'));
  reader.onload=()=>{
    const img=new Image();img.onerror=()=>reject(new Error('Imagen no compatible.'));
    img.onload=()=>{
      const max=720,scale=Math.min(1,max/Math.max(img.width,img.height));
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));
      canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
      let output=canvas.toDataURL('image/jpeg',.72);
      if(output.length>650000)output=canvas.toDataURL('image/jpeg',.42);
      if(output.length>750000){reject(new Error('La miniatura es demasiado grande. Usa otra imagen.'));return;}
      resolve(output);
    };img.src=reader.result;
  };reader.readAsDataURL(file);
});
const DIGITAL_BASE = ['artifacts',appId,'public','data'];
const digitalCollection = name => collection(db,...DIGITAL_BASE,name);
const digitalDoc = (name,id) => doc(db,...DIGITAL_BASE,name,id);
const driveFolderIsValid = value => { try { const u=new URL(value); return u.protocol==='https:' && (u.hostname==='drive.google.com' || u.hostname==='docs.google.com') && (u.pathname.includes('/folders/') || u.pathname.includes('/drive/')); } catch { return false; } };
function DigitalModule({user}) {
  const [tab,setTab]=useState('products');
  const [products,setProducts]=useState([]);
  const [categories,setCategories]=useState([]);
  const [prompts,setPrompts]=useState([]);
  const [search,setSearch]=useState('');
  const [category,setCategory]=useState('all');
  const [productForm,setProductForm]=useState(null);
  const [promptForm,setPromptForm]=useState(null);
  const [categoryForm,setCategoryForm]=useState(null);
  const [notice,setNotice]=useState('');
  const [settings,setSettings]=useState({states:DIGITAL_STATES,activeProductId:null});
  const [stateEditor,setStateEditor]=useState(false);
  const [newStateName,setNewStateName]=useState('');
  const [newStateColor,setNewStateColor]=useState('#6366f1');
  const [uploadingImage,setUploadingImage]=useState(false);
  const stateOptions=Array.isArray(settings.states)&&settings.states.length?settings.states:DIGITAL_STATES;
  const settingsRef=digitalDoc('digital_products',DIGITAL_SETTINGS_ID);
  useEffect(()=>{
    const off=onSnapshot(settingsRef,snap=>{
      if(snap.exists())setSettings({states:DIGITAL_STATES,activeProductId:null,...snap.data()});
    },e=>setNotice('No se pudo cargar la configuración digital: '+e.message));
    return ()=>off();
  },[]);
  const saveSettings=async next=>{
    try{await setDoc(settingsRef,{...next,_kind:'digital_settings',updatedAt:serverTimestamp()},{merge:true});setSettings(next);setNotice('Configuración guardada');}
    catch(e){setNotice('No se pudo guardar la configuración: '+e.message);}
  };
  const [workingSaving,setWorkingSaving]=useState(false);
  const setWorking=async p=>{
    if(workingSaving)return;
    setWorkingSaving(true);
    try {
      const nextValue=!p.isWorking;
      const batch=writeBatch(db);
      // Mismo campo isWorking que utiliza Winners; un solo producto activo.
      if(nextValue){
        products.filter(item=>item.id!==p.id && item.isWorking).forEach(item=>
          batch.update(digitalDoc('digital_products',item.id),{isWorking:false,updatedAt:serverTimestamp()})
        );
      }
      batch.update(digitalDoc('digital_products',p.id),{isWorking:nextValue,updatedAt:serverTimestamp()});
      await batch.commit();
      setNotice(nextValue?'Producto marcado EN PROCESO':'Producto desmarcado');
    }catch(e){setNotice('No se pudo cambiar EN PROCESO: '+e.message);}
    finally{setWorkingSaving(false);}
  };
  const updateState=(id,changes)=>saveSettings({...settings,states:stateOptions.map(st=>st.id===id?{...st,...changes}:st)});
  const addState=()=>{
    const name=newStateName.trim();if(!name)return;
    const id='custom_'+Date.now().toString(36);
    saveSettings({...settings,states:[...stateOptions,{id,name,color:newStateColor}]});setNewStateName('');
  };
  const deleteState=id=>{
    if(products.some(p=>p.status===id)){setNotice('Primero cambia el estado de los productos que lo utilizan.');return;}
    if(stateOptions.length<=1){setNotice('Debe existir al menos un estado.');return;}
    saveSettings({...settings,states:stateOptions.filter(st=>st.id!==id)});
  };
  useEffect(()=>{
    const listeners=[['digital_products',docs=>setProducts(docs.filter(p=>p.id!==DIGITAL_SETTINGS_ID&&p._kind!=='digital_settings'))],['digital_prompt_categories',setCategories],['digital_prompts',setPrompts]];
    const off=listeners.map(([name,setter])=>onSnapshot(digitalCollection(name),s=>setter(s.docs.map(d=>({id:d.id,...d.data()}))),e=>setNotice('No se pudo cargar '+name+': '+e.message)));
    return ()=>off.forEach(fn=>fn());
  },[]);
  const sortedCats=[...categories].sort((a,b)=>(a.order||0)-(b.order||0));
  const sortedPrompts=[...prompts].filter(p=>(category==='all'||p.categoryId===category)&&`${p.name} ${p.content}`.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>(a.order||0)-(b.order||0));
  const filteredProducts=[...products].filter(p=>`${p.name} ${p.description||''}`.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>(a.order||0)-(b.order||0));
  const save=async (name,form,close)=>{
    try {
      const {id,...rest}=form;
      const payload={...rest,updatedAt:serverTimestamp(),updatedBy:user.uid};
      if(id) await updateDoc(digitalDoc(name,id),payload);
      else await addDoc(digitalCollection(name),{...payload,createdAt:serverTimestamp(),createdBy:user.uid});
      close(null);setNotice('Cambios guardados');
    }catch(e){setNotice('Error al guardar: '+e.message);}
  };
  const remove=async (name,id)=>{if(!window.confirm('¿Eliminar este registro?'))return;try{await deleteDoc(digitalDoc(name,id));if(name==='digital_products'&&settings.activeProductId===id)await saveSettings({...settings,activeProductId:null});}catch(e){setNotice('Error: '+e.message);}};
  const copy=async text=>{try{await navigator.clipboard.writeText(text);setNotice('Prompt copiado');}catch{setNotice('No fue posible copiar automáticamente');}};
  const changeStatus=async (p,status)=>{try{await updateDoc(digitalDoc('digital_products',p.id),{status,updatedAt:serverTimestamp()});}catch(e){setNotice('Error: '+e.message);}};
  const field='w-full min-w-0 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white';
  const action='rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-blue-700';
  return <div className="space-y-5 digital-area">
    <div className="rounded-3xl bg-gradient-to-r from-slate-950 via-blue-950 to-slate-900 p-5 text-white shadow-xl md:p-8">
      <div className="text-[10px] font-black tracking-[.22em] text-cyan-300">TU PEDIDO COLOMBIA · AI WORKSPACE</div>
      <h2 className="mt-2 text-2xl font-black md:text-3xl">✦ Área Digital</h2>
      <p className="mt-1 text-sm text-slate-300">Producción de contenido y biblioteca independiente de prompts.</p>
      <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">{[['Productos',products.length],['En proceso',products.filter(p=>p.isWorking).length],['Listos',products.filter(p=>p.status==='ready').length],['Prompts',prompts.length]].map(([n,v])=><div key={n} className="rounded-xl border border-white/15 bg-white/10 p-3"><div className="text-2xl font-black">{v}</div><div className="text-[11px] text-slate-300">{n}</div></div>)}</div>
    </div>
    <div className="flex flex-wrap gap-2"><button onClick={()=>{setTab('products');setSearch('');}} className={tab==='products'?action:'rounded-xl border px-4 py-2 text-sm dark:border-slate-600'}>📦 Productos</button><button onClick={()=>{setTab('prompts');setSearch('');}} className={tab==='prompts'?action:'rounded-xl border px-4 py-2 text-sm dark:border-slate-600'}>🧠 Biblioteca IA</button></div>
    {notice&&<div role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{notice}<button className="ml-3 underline" onClick={()=>setNotice('')}>Cerrar</button></div>}
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><input aria-label="Buscar" className={field+' sm:max-w-md'} placeholder="🔍 Buscar productos o prompts..." value={search} onChange={e=>setSearch(e.target.value)}/>{tab==='products'?<div className="flex flex-wrap gap-2"><button className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold dark:border-slate-600" onClick={()=>setStateEditor(true)}>🎨 Configurar estados</button><button className={action} onClick={()=>setProductForm({name:'',description:'',image:'',status:'pending',strategy:'',driveFolderUrl:'',responsible:'',order:products.length})}>＋ Nuevo producto</button></div>:<div className="flex gap-2"><button className={action} onClick={()=>setCategoryForm({name:'',description:'',order:categories.length})}>＋ Categoría</button><button className={action} onClick={()=>setPromptForm({name:'',content:'',description:'',categoryId:category==='all'?'':category,order:prompts.length})}>＋ Prompt</button></div>}</div>
    {tab==='products'?<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{filteredProducts.map(p=><article key={p.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800" style={{
      borderLeft:'6px solid '+(stateOptions.find(st=>st.id===(p.status||'pending'))?.color||'#64748b'),
      borderTop:'2px solid '+(stateOptions.find(st=>st.id===(p.status||'pending'))?.color||'#64748b'),
      backgroundImage:'linear-gradient(115deg, '+(stateOptions.find(st=>st.id===(p.status||'pending'))?.color||'#64748b')+'24, transparent 72%)',
      boxShadow:p.isWorking?'0 0 0 2px #10b981, 0 8px 22px #10b98124':'0 4px 16px #0f172a12'
    }}><div className="flex gap-3">{p.image?<img src={p.image} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover"/>:<div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-3xl dark:bg-slate-700">📦</div>}<div className="min-w-0 flex-1"><h3 className="break-words font-black">{p.name}</h3><p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-300">{p.description||'Sin descripción'}</p><div className="mt-2">{digitalStrategy(p.strategy)?<span className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] font-black tracking-wide shadow-sm" style={{color:digitalStrategy(p.strategy).color,backgroundColor:digitalStrategy(p.strategy).soft,borderColor:digitalStrategy(p.strategy).color+'55'}}><span className="text-base">{digitalStrategy(p.strategy).icon}</span>{digitalStrategy(p.strategy).label}</span>:<span className="inline-block rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-800">⚠ Estrategia por definir</span>}</div><p className="mt-2 text-xs">👤 {p.responsible||'Sin asignar'}</p><span className="mt-2 inline-block rounded-full px-2 py-1 text-[11px] font-bold text-white" style={{backgroundColor:stateOptions.find(st=>st.id===(p.status||'pending'))?.color||'#64748b'}}>{stateOptions.find(st=>st.id===(p.status||'pending'))?.name||'Pendiente'}</span></div></div><div className="mt-3 flex items-center justify-between rounded-xl border border-slate-200 bg-white/75 p-3 dark:border-slate-600 dark:bg-slate-900/50"><span className="text-xs font-bold">{p.isWorking?'🟢 EN PROCESO':'⚪ Sin actividad'}</span><button type="button" role="switch" aria-checked={!!p.isWorking} aria-label={'Marcar en proceso '+p.name} onClick={()=>setWorking(p)} disabled={workingSaving} className={'relative h-7 w-12 rounded-full transition '+(p.isWorking?'bg-emerald-500':'bg-slate-300 dark:bg-slate-600')}><span className={'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all '+(p.isWorking?'left-6':'left-1')}/></button></div><label className="mt-4 block text-[10px] font-black uppercase text-slate-500">Estado de producción</label><select className={field+' mt-1'} value={p.status||'pending'} onChange={e=>changeStatus(p,e.target.value)}>{stateOptions.map(st=><option key={st.id} value={st.id}>{st.name}</option>)}</select>
      {driveFolderIsValid(p.driveFolderUrl)?<a className="transition hover:brightness-110 mt-4 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-700 to-cyan-600 px-4 py-4 text-center text-sm font-black text-white shadow-lg" href={p.driveFolderUrl} target="_blank" rel="noopener noreferrer">📂 MATERIAL DE TRABAJO ↗</a>:<div className="mt-4 rounded-xl border border-dashed border-amber-300 p-3 text-center text-xs text-amber-700 dark:text-amber-300">📂 Sin carpeta Drive vinculada</div>}
      <div className="mt-3 flex justify-end gap-3 text-xs"><button onClick={()=>setProductForm({...p})} className="font-bold text-blue-600 dark:text-cyan-300">✏️ Editar / Vincular Drive</button><button onClick={()=>remove('digital_products',p.id)} className="text-rose-500">Eliminar</button></div></article>)}{filteredProducts.length===0&&<div className="rounded-2xl border border-dashed p-8 text-center text-sm text-slate-500">No hay productos. Crea el primero.</div>}</div>:
    <div className="space-y-4"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"><button onClick={()=>setCategory('all')} className={'group relative overflow-hidden rounded-2xl border p-4 text-left shadow-md transition-all hover:-translate-y-0.5 hover:shadow-xl '+(category==='all'?'border-cyan-400 bg-gradient-to-br from-slate-900 via-blue-950 to-cyan-900 text-white ring-2 ring-cyan-400':'border-slate-200 bg-gradient-to-br from-slate-800 to-slate-950 text-white dark:border-slate-600')}><span className="absolute -right-5 -top-6 text-8xl opacity-10">✦</span><div className="flex items-center justify-between"><span className="rounded-xl bg-white/15 px-3 py-2 text-xl">🗂️</span><span className="rounded-full bg-white/15 px-3 py-1 text-xs font-black">{prompts.length} PROMPTS</span></div><div className="mt-5 text-base font-black">Todas las categorías</div><p className="mt-1 text-xs text-slate-300">Explora toda la biblioteca IA</p></button>{sortedCats.map((c,i)=>{const palette=[['#4338ca','#6366f1','#eef2ff'],['#0f766e','#14b8a6','#ccfbf1'],['#9a3412','#f97316','#ffedd5'],['#6d28d9','#a78bfa','#ede9fe'],['#be185d','#ec4899','#fce7f3'],['#1d4ed8','#38bdf8','#e0f2fe']][i%6];const selected=category===c.id;const count=prompts.filter(p=>p.categoryId===c.id).length;return <article key={c.id} className="group relative min-w-0 overflow-hidden rounded-2xl border bg-white shadow-md transition-all hover:-translate-y-0.5 hover:shadow-xl dark:bg-slate-800" style={{borderColor:selected?palette[1]:'#cbd5e1',boxShadow:selected?'0 0 0 2px '+palette[1]+',0 12px 25px #0f172a18':undefined}}><div className="h-2" style={{background:`linear-gradient(90deg,${palette[0]},${palette[1]})`}}/><button onClick={()=>setCategory(c.id)} className="w-full p-4 text-left"><div className="flex items-center justify-between gap-2"><span className="flex h-11 w-11 items-center justify-center rounded-xl text-xl shadow-sm" style={{backgroundColor:palette[2],color:palette[0]}}>✦</span><span className="rounded-full px-3 py-1 text-[10px] font-black" style={{backgroundColor:palette[2],color:palette[0]}}>{count} {count===1?'PROMPT':'PROMPTS'}</span></div><h3 className="mt-4 break-words text-base font-black text-slate-900 dark:text-white">{c.name}</h3><p className="mt-1 line-clamp-2 min-h-[2.5em] text-xs text-slate-500 dark:text-slate-300">{c.description||'Recursos y guías de esta etapa de producción'}</p><div className="mt-3 text-[11px] font-black" style={{color:palette[0]}}>{selected?'● CATEGORÍA ACTIVA':'VER PROMPTS →'}</div></button><div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-2 dark:border-slate-700"><button title="Editar categoría" onClick={()=>setCategoryForm({...c})} className="rounded-lg px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700">✏️ Editar</button><button title="Eliminar categoría" onClick={()=>{if(prompts.some(p=>p.categoryId===c.id)){setNotice('Mueve o elimina sus prompts antes de borrar la categoría');return;}remove('digital_prompt_categories',c.id);if(category===c.id)setCategory('all');}} className="rounded-lg px-2 py-1 text-xs text-rose-500 hover:bg-rose-50">✕</button></div></article>})}</div>
    {category!=='all'&&categories.find(c=>c.id===category)?.description&&<p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900 dark:bg-slate-800 dark:text-blue-200">{categories.find(c=>c.id===category).description}</p>}
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">{sortedPrompts.map(p=><article key={p.id} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="break-words font-black">{p.name}</h3><p className="mt-1 text-[11px] text-blue-600 dark:text-cyan-300">{categories.find(c=>c.id===p.categoryId)?.name||'Sin categoría'}</p></div><button className={action} onClick={()=>copy(p.content)}>📋 Copiar</button></div>{p.description&&<p className="mt-2 text-xs text-slate-500 dark:text-slate-300">{p.description}</p>}<pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-900">{p.content}</pre><div className="mt-3 flex justify-end gap-3 text-xs"><button onClick={()=>setPromptForm({...p})} className="font-bold text-blue-600 dark:text-cyan-300">Editar</button><button onClick={()=>setPromptForm({...p,id:undefined,name:p.name+' (copia)',order:prompts.length})} className="font-bold">Duplicar</button><button onClick={()=>remove('digital_prompts',p.id)} className="text-rose-500">Eliminar</button></div></article>)}{sortedPrompts.length===0&&<div className="rounded-xl border border-dashed p-8 text-center text-sm">Sin prompts en esta selección.</div>}</div></div>}
    {stateEditor&&<div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-3" onClick={()=>setStateEditor(false)}><div onClick={e=>e.stopPropagation()} className="max-h-[90dvh] w-full max-w-lg space-y-4 overflow-auto rounded-2xl bg-white p-5 text-slate-900 dark:bg-slate-800 dark:text-white"><h3 className="text-lg font-black">🎨 Estados de producción</h3><p className="text-xs text-slate-500 dark:text-slate-300">Edita nombres y colores. Los cambios se comparten con el equipo.</p>{stateOptions.map(st=><div key={st.id} className="flex items-center gap-2"><input aria-label={'Color de '+st.name} type="color" value={st.color||'#64748b'} onChange={e=>updateState(st.id,{color:e.target.value})} className="h-10 w-12 shrink-0"/><input aria-label={'Nombre de '+st.name} className={field} value={st.name} onChange={e=>setSettings(prev=>({...prev,states:prev.states.map(x=>x.id===st.id?{...x,name:e.target.value}:x)}))} onBlur={()=>saveSettings(settings)}/><button title="Eliminar estado" className="rounded-lg border px-2 py-2 text-rose-600" onClick={()=>deleteState(st.id)}>✕</button></div>)}<div className="flex items-center gap-2"><input type="color" value={newStateColor} onChange={e=>setNewStateColor(e.target.value)} className="h-10 w-12 shrink-0"/><input className={field} placeholder="Nuevo estado" value={newStateName} onChange={e=>setNewStateName(e.target.value)}/><button className={action} onClick={addState}>Añadir</button></div><div className="flex justify-end gap-2"><button className={action} onClick={()=>{saveSettings(settings);setStateEditor(false);}}>Guardar y cerrar</button></div></div></div>}
    {productForm&&<div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-3" onClick={()=>setProductForm(null)}><form onClick={e=>e.stopPropagation()} onSubmit={e=>{e.preventDefault();if(productForm.driveFolderUrl&&!driveFolderIsValid(productForm.driveFolderUrl)){setNotice('Ingresa una URL válida de carpeta de Google Drive');return;}save('digital_products',productForm,setProductForm);}} className="max-h-[92dvh] w-full max-w-xl space-y-3 overflow-y-auto rounded-2xl bg-white p-5 text-slate-900 dark:bg-slate-800 dark:text-white"><h3 className="text-xl font-black">Producto digital</h3><label className="block text-xs">Nombre *<input required className={field+' mt-1'} value={productForm.name} onChange={e=>setProductForm({...productForm,name:e.target.value})}/></label><label className="block text-xs">Descripción<textarea className={field+' mt-1'} rows="2" value={productForm.description||''} onChange={e=>setProductForm({...productForm,description:e.target.value})}/></label><label className="block text-xs font-black">Estrategia comercial *<select required className={field+' mt-1'} value={productForm.strategy||''} onChange={e=>setProductForm({...productForm,strategy:e.target.value})}><option value="">Selecciona la estrategia</option>{Object.entries(DIGITAL_STRATEGIES).map(([key,st])=><option key={key} value={key}>{st.icon} {st.label}</option>)}</select></label>{digitalStrategy(productForm.strategy)&&<div className="rounded-xl border p-3 text-xs font-black" style={{color:digitalStrategy(productForm.strategy).color,backgroundColor:digitalStrategy(productForm.strategy).soft,borderColor:digitalStrategy(productForm.strategy).color+'55'}}>Proceso asignado: {digitalStrategy(productForm.strategy).icon} {digitalStrategy(productForm.strategy).label}</div>}<label className="block text-xs">Responsable<input className={field+' mt-1'} value={productForm.responsible||''} onChange={e=>setProductForm({...productForm,responsible:e.target.value})}/></label><label className="block text-xs">Cargar imagen desde tu equipo<input type="file" accept="image/*" className={field+' mt-1'} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;setUploadingImage(true);try{const image=await compressDigitalImage(file);setProductForm(prev=>({...prev,image}));}catch(err){setNotice(err.message);}finally{setUploadingImage(false);}}}/></label>{productForm.image&&<img src={productForm.image} alt="Vista previa del producto" className="h-28 w-28 rounded-xl object-cover"/>}<label className="block text-xs">O pega URL de imagen<input type="text" className={field+' mt-1'} value={productForm.image||''} onChange={e=>setProductForm({...productForm,image:e.target.value})}/></label><label className="block text-xs">Carpeta Google Drive<input type="url" className={field+' mt-1'} placeholder="https://drive.google.com/drive/folders/..." value={productForm.driveFolderUrl||''} onChange={e=>setProductForm({...productForm,driveFolderUrl:e.target.value})}/></label><div className="flex justify-end gap-2"><button type="button" onClick={()=>setProductForm(null)}>Cancelar</button><button type="submit" disabled={uploadingImage} className={action}>{uploadingImage?'Procesando imagen...':'Guardar producto'}</button></div></form></div>}
    {categoryForm&&<div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-3" onClick={()=>setCategoryForm(null)}><form onClick={e=>e.stopPropagation()} onSubmit={e=>{e.preventDefault();save('digital_prompt_categories',categoryForm,setCategoryForm);}} className="w-full max-w-lg space-y-3 rounded-2xl bg-white p-5 dark:bg-slate-800"><h3 className="font-black">Categoría de prompts</h3><input required className={field} placeholder="Nombre" value={categoryForm.name} onChange={e=>setCategoryForm({...categoryForm,name:e.target.value})}/><textarea className={field} placeholder="Instrucciones de esta fase" value={categoryForm.description||''} onChange={e=>setCategoryForm({...categoryForm,description:e.target.value})}/><input className={field} type="number" placeholder="Orden" value={categoryForm.order??0} onChange={e=>setCategoryForm({...categoryForm,order:Number(e.target.value)})}/><div className="flex justify-end gap-2"><button type="button" onClick={()=>setCategoryForm(null)}>Cancelar</button><button className={action}>Guardar</button></div></form></div>}
    {promptForm&&<div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-3" onClick={()=>setPromptForm(null)}><form onClick={e=>e.stopPropagation()} onSubmit={e=>{e.preventDefault();if(!promptForm.categoryId){setNotice('Crea o selecciona una categoría');return;}save('digital_prompts',promptForm,setPromptForm);}} className="max-h-[92dvh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-2xl bg-white p-5 dark:bg-slate-800"><h3 className="font-black">Prompt IA</h3><input required className={field} placeholder="Nombre del prompt" value={promptForm.name} onChange={e=>setPromptForm({...promptForm,name:e.target.value})}/><select required className={field} value={promptForm.categoryId||''} onChange={e=>setPromptForm({...promptForm,categoryId:e.target.value})}><option value="">Selecciona categoría</option>{sortedCats.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><input className={field} placeholder="Descripción breve" value={promptForm.description||''} onChange={e=>setPromptForm({...promptForm,description:e.target.value})}/><textarea required className={field+' font-mono'} rows="10" placeholder="Contenido completo del prompt" value={promptForm.content} onChange={e=>setPromptForm({...promptForm,content:e.target.value})}/><label className="block text-xs">Orden<input className={field+' mt-1'} type="number" value={promptForm.order??0} onChange={e=>setPromptForm({...promptForm,order:Number(e.target.value)})}/></label><div className="flex justify-end gap-2"><button type="button" onClick={()=>setPromptForm(null)}>Cancelar</button><button className={action}>Guardar prompt</button></div></form></div>}
  </div>;
}

// ==================== COMPONENTE PRINCIPAL APP ====================
export default function App() {
  const [activeModule, setActiveModule] = useState('winners');
  const [userRole,setUserRole]=useState(null);
  const [roleLoading,setRoleLoading]=useState(true);
  const [mobileMenu,setMobileMenu]=useState(false);
  const [theme,setTheme]=useState('light');
  const [user, setUser] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('pending');
  const [isCreating, setIsCreating] = useState(false);
  const [newProduct, setNewProduct] = useState(getInitialWinner());
  const [proj, setProj] = useState(getInitialProjection());
  const [expandedItems, setExpandedItems] = useState({});
  const [notification, setNotification] = useState('');
  const [formError, setFormError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useState('manual');
  const [supplierFilter, setSupplierFilter] = useState('all');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(()=>{
    const stored = user ? localStorage.getItem('winner-theme:'+user.uid) : null;
    setTheme(stored === 'dark' ? 'dark' : 'light');
  },[user?.uid]);
  useEffect(()=>{
    document.documentElement.classList.toggle('dark',theme==='dark');
    document.documentElement.style.colorScheme=theme;
  },[theme]);
  const toggleTheme=()=>{
    const next=theme==='light'?'dark':'light';
    setTheme(next);
    if(user)localStorage.setItem('winner-theme:'+user.uid,next);
  };
  useEffect(()=>{
    if(!user){setUserRole(null);setRoleLoading(false);return;}
    setRoleLoading(true);
    const off=onSnapshot(doc(db,'user_roles',user.uid),snap=>{
      const role=snap.exists()?snap.data().role:null;
      setUserRole(role==='digital'?'digital':role==='admin'?'admin':null);
      setRoleLoading(false);
      if(role==='digital')setActiveModule('digital');
    },()=>{setUserRole(null);setRoleLoading(false);});
    return ()=>off();
  },[user]);
  useEffect(()=>{if(userRole==='digital'&&activeModule!=='digital')setActiveModule('digital');},[userRole,activeModule]);
  useEffect(() => {
    if (!user || userRole !== 'admin' || activeModule === 'projection' || activeModule === 'agenda' || activeModule === 'prompts' || activeModule === 'digital') return;
    const colName = activeModule === 'winners' ? 'products' : 'import_products';
    const q = collection(db, 'artifacts', appId, 'public', 'data', colName);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loaded = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setProducts(loaded);
    }, (error) => {
      console.error("Firestore Error:", error);
      setNotification(`Error de acceso: No tienes permisos.`);
      setTimeout(() => setNotification(''), 4000);
    });
    return () => unsubscribe();
  }, [user, userRole, activeModule]);

  const uniqueSuppliers = useMemo(() => {
    if (activeModule !== 'winners' && activeModule !== 'imports') return [];
    const field = activeModule === 'winners' ? 'supplier' : 'chineseSupplier';
    const list = products.map(p => p[field]).filter(Boolean);
    return ['all', ...new Set(list)];
  }, [products, activeModule]);

  const displayedProducts = useMemo(() => {
    if (activeModule !== 'winners' && activeModule !== 'imports') return [];
    let result = products.filter(p => {
      const matchesTab = p.status === activeTab;
      const matchesSearch = p.name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                           p.dropiCode?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           p.chineseSupplier?.toLowerCase().includes(searchTerm.toLowerCase());
      const supplierField = activeModule === 'winners' ? 'supplier' : 'chineseSupplier';
      const matchesSupplier = supplierFilter === 'all' || p[supplierField] === supplierFilter;
      return matchesTab && matchesSearch && matchesSupplier;
    });
    return [...result].sort((a, b) => {
      if (a.isWorking && !b.isWorking) return -1;
      if (!a.isWorking && b.isWorking) return 1;
      if (sortOrder === 'manual' || sortOrder === 'recent') return (a.order || 0) - (b.order || 0);
      const valA = activeModule === 'winners' ? calculateWinnerMetrics(a).margin : calculateImportMetrics(a).unitCostColombia;
      const valB = activeModule === 'winners' ? calculateWinnerMetrics(b).margin : calculateImportMetrics(b).unitCostColombia;
      if (sortOrder === 'roi-desc') return valB - valA;
      if (sortOrder === 'roi-asc') return valA - valB;
      return 0;
    });
  }, [products, activeTab, searchTerm, supplierFilter, sortOrder, activeModule]);

  const handleLogout = () => signOut(auth);
  const handleModuleChange = (mod) => {
    setProducts([]);
    setActiveModule(mod);
    setActiveTab('pending');
    setSearchTerm('');
    setSupplierFilter('all');
    setSortOrder('manual');
    if (mod !== 'projection' && mod !== 'agenda' && mod !== 'prompts' && mod !== 'digital') {
      setNewProduct(mod === 'winners' ? getInitialWinner() : getInitialImport());
    }
    setIsCreating(false);
    setFormError('');
  };

  const copyToClipboard = (text) => {
    if (!text) return;
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    setNotification(`Copiado: ${text}`);
    setTimeout(() => setNotification(''), 2000);
    document.body.removeChild(textArea);
  };

  const handleSave = async () => {
    setFormError('');
    if (!newProduct.name || newProduct.name.trim() === '') {
      setFormError('⚠️ ERROR: Debes escribir un "Nombre" para el producto.');
      return;
    }
    setIsSaving(true);
    const colName = activeModule === 'winners' ? 'products' : 'import_products';
    const regPrefix = activeModule === 'winners' ? 'WIN' : 'IMP';
    const regNumber = `${regPrefix}-${(products.length + 1).toString().padStart(3, '0')}`;
    try {
      if (!auth.currentUser) throw new Error("Debes iniciar sesión para crear registros");
      const currentDateTime = getCurrentDateTime();
      const payloadRaw = { ...newProduct, regNumber, order: Date.now(), createdBy: auth.currentUser.uid, createdAtText: currentDateTime };
      const cleanPayload = JSON.parse(JSON.stringify(payloadRaw));
      cleanPayload.createdAt = serverTimestamp();
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', colName), cleanPayload);
      setIsCreating(false);
      setNewProduct(activeModule === 'winners' ? getInitialWinner() : getInitialImport());
      setActiveTab('pending');
      setFormError('');
      setNotification('¡Registro guardado en la Nube! ✨');
      setTimeout(() => setNotification(''), 3000);
    } catch (e) {
      console.error("Firebase Save Error:", e);
      setFormError(`⚠️ FALLO DE SERVIDOR: ${e.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const updateDocField = async (id, f, v) => {
    const colName = activeModule === 'winners' ? 'products' : 'import_products';
    try { await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', colName, id), { [f]: v }); } catch (e) { console.error(e); }
  };
  const updateNestedField = async (id, parent, f, v) => {
    const colName = activeModule === 'winners' ? 'products' : 'import_products';
    const item = products.find(x => x.id === id);
    if (!item) return;
    try { await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', colName, id), { [parent]: { ...item[parent], [f]: v } }); } catch (e) { console.error(e); }
  };
  const updateUpsell = async (p, uid, f, v) => {
    const currentUpsells = p.upsells || getInitialWinner().upsells;
    const newUpsells = currentUpsells.map(u => u.id === uid ? { ...u, [f]: v } : u);
    try { await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'products', p.id), { upsells: newUpsells }); } catch (e) { console.error(e); }
  };
  const resetUpsell = async (p, uid) => {
    const currentUpsells = p.upsells || getInitialWinner().upsells;
    const clearedUpsells = currentUpsells.map(u => u.id === uid ? { id: uid, name: '', cost: 0, price: 0, image: null } : u);
    try { await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'products', p.id), { upsells: clearedUpsells }); } catch (e) { console.error(e); }
  };
  const deleteItem = async (id) => {
    if (window.confirm('¿Estás seguro de borrar este registro de la base de datos?')) {
      const colName = activeModule === 'winners' ? 'products' : 'import_products';
      try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', colName, id)); } catch (e) { console.error(e); }
    }
  };
  const moveItem = async (id, dir) => {
    const colName = activeModule === 'winners' ? 'products' : 'import_products';
    const list = displayedProducts;
    const idx = list.findIndex(p => p.id === id);
    const targetIdx = idx + dir;
    if (targetIdx >= 0 && targetIdx < list.length) {
      const a = list[idx], b = list[targetIdx];
      try {
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', colName, a.id), { order: b.order || Date.now() });
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', colName, b.id), { order: a.order || Date.now() - 100 });
      } catch (e) { console.error(e); }
    }
  };
  const handleImage = (e, targetId = null, upsellId = null) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = async () => {
      let result = reader.result;
      if (file.size > 500 * 1024) {
        try { result = await compressImage(reader.result); } catch(err) { console.error("Error comprimiendo:", err); }
      }
      if (!targetId) {
        if (upsellId) {
          const up = (newProduct.upsells || []).map(u => u.id === upsellId ? {...u, image: result} : u);
          setNewProduct({...newProduct, upsells: up});
        } else {
          setNewProduct({...newProduct, image: result});
        }
      } else {
        const colName = activeModule === 'winners' ? 'products' : 'import_products';
        const item = products.find(x => x.id === targetId);
        if (!item) return;
        if (upsellId) {
          const up = (item.upsells || getInitialWinner().upsells).map(u => u.id === upsellId ? {...u, image: result} : u);
          updateDoc(doc(db, 'artifacts', appId, 'public', 'data', colName, targetId), { upsells: up });
        } else {
          updateDoc(doc(db, 'artifacts', appId, 'public', 'data', colName, targetId), { image: result });
        }
      }
    };
    reader.readAsDataURL(file);
  };
  const updateVariable = async (p, varId, field, value) => {
    const newVars = (p.variables || getInitialImport().variables).map(v => v.id === varId ? { ...v, [field]: value } : v);
    await updateDocField(p.id, 'variables', newVars);
  };
  const updateTestingData = async (p, testId, field, value) => {
    const currentData = p.testingData || getInitialWinner().testingData;
    const newData = currentData.map(t => t.id === testId ? { ...t, [field]: value } : t);
    await updateDocField(p.id, 'testingData', newData);
  };

  const renderProjectionModule = () => {
    const val = (key) => parseFloat(proj[key]) || 0;
    const handleChange = (key) => (newVal) => setProj({...proj, [key]: newVal});
    const resetProjection = () => setProj(getInitialProjection());
    const impressions = val('cpm') > 0 ? (val('adSpend') / val('cpm')) * 1000 : 0;
    const costPerImpression = impressions > 0 ? val('adSpend') / impressions : 0;
    const linkClicks = impressions * (val('ctr') / 100);
    const cpc = linkClicks > 0 ? val('adSpend') / linkClicks : 0;
    const pageVisits = linkClicks * (val('loadSpeed') / 100);
    const costPerVisit = pageVisits > 0 ? val('adSpend') / pageVisits : 0;
    const salesCol1 = pageVisits * (val('conversionRate') / 100);
    const salesCol2 = salesCol1 * val('price');
    const cpaFb = salesCol1 > 0 ? val('adSpend') / salesCol1 : 0;
    const dispatchedOrders = salesCol1 * (val('effectiveness') / 100);
    const costPerDispatched = dispatchedOrders > 0 ? val('adSpend') / dispatchedOrders : 0;
    const returns = dispatchedOrders * (val('returnRate') / 100);
    const effectiveDeliveries = dispatchedOrders - returns;
    const realRevenue = effectiveDeliveries * val('price');
    const cpaReal = effectiveDeliveries > 0 ? val('adSpend') / effectiveDeliveries : 0;
    const roasFb = val('adSpend') > 0 ? salesCol2 / val('adSpend') : 0;
    const roasReal = val('adSpend') > 0 ? realRevenue / val('adSpend') : 0;
    const totalProductCost = effectiveDeliveries * val('productCost');
    const totalFreightCost = val('freight') * dispatchedOrders;
    const totalReturnCost = val('freight') * returns;
    const totalFulfillmentCost = val('fulfillment') * dispatchedOrders;
    const totalCommissionCost = val('commission') * effectiveDeliveries;
    const intermediationCosts = totalProductCost + totalFreightCost + totalReturnCost + totalFulfillmentCost + totalCommissionCost;
    const grossProfit = realRevenue - intermediationCosts - val('adSpend');
    const prorateCampaign = val('activeCampaigns') > 0 ? val('fixedExpenses') / val('activeCampaigns') : 0;
    const netProfit = grossProfit - prorateCampaign;
    const grossMargin = realRevenue > 0 ? (grossProfit / realRevenue) * 100 : 0;
    const netMargin = realRevenue > 0 ? (netProfit / realRevenue) * 100 : 0;
    const downloadReport = () => {
      const productName = proj.name || 'Sin Nombre';
      const reportContent = `======================================
📊 REPORTE DE PROYECCIÓN: ${productName.toUpperCase()}
======================================
🎯 MÉTRICAS DE MARKETING:
- Inversión Facebook:     ${formatCurrency(val('adSpend'))}
- CPM:                    ${formatCurrency(val('cpm'))}
- Impresiones:            ${impressions.toFixed(0)}
- CTR:                    ${val('ctr').toFixed(2)}%
- Clics en Enlace:        ${linkClicks.toFixed(0)}
- Costo por Clic (CPC):   ${formatCurrency(cpc)}
- Velocidad de Carga:     ${val('loadSpeed').toFixed(2)}%
- Visitas a la Página:    ${pageVisits.toFixed(0)}
- Costo por Visita:       ${formatCurrency(costPerVisit)}
- % Conversión:           ${val('conversionRate').toFixed(2)}%
📦 EMBUDO DE VENTAS Y ENTREGAS:
- Ventas Generadas (Col1): ${salesCol1.toFixed(2)} pedidos
- % Efectividad:          ${val('effectiveness').toFixed(2)}%
- Pedidos Despachados:    ${dispatchedOrders.toFixed(2)} pedidos
- % Devolución:           ${val('returnRate').toFixed(2)}%
- Total Devoluciones:     ${returns.toFixed(2)} pedidos
- ENTREGAS EFECTIVAS:     ${effectiveDeliveries.toFixed(2)} pedidos
💳 ANÁLISIS DE ADQUISICIÓN (CPA & ROAS):
- CPA Facebook:           ${formatCurrency(cpaFb)}
- CPA Real:               ${formatCurrency(cpaReal)}
- ROAS Facebook:          ${roasFb.toFixed(2)}
- ROAS Real ⭐:            ${roasReal.toFixed(2)}
💰 FINANZAS Y COSTOS DE OPERACIÓN:
- Precio de Venta:        ${formatCurrency(val('price'))}
- Costo de Producto:      ${formatCurrency(val('productCost'))}
- Flete por envío:        ${formatCurrency(val('freight'))}
- Costo Fulfillment:      ${formatCurrency(val('fulfillment'))}
- Comisión + Fijos:       ${formatCurrency(val('commission'))}
- Facturado Tienda Web:   ${formatCurrency(salesCol2)}
- Ingresos Reales ⭐:      ${formatCurrency(realRevenue)}
- Total Intermediación:   ${formatCurrency(intermediationCosts)}
- Gastos Fijos (Prorrateo): ${formatCurrency(prorateCampaign)}
🏆 RESULTADOS FINALES:
- Profit Bruto:           ${formatCurrency(grossProfit)}
- Profit Neto Real:       ${formatCurrency(netProfit)}
- Margen Bruto:           ${grossMargin.toFixed(2)}%
- Margen Neto:            ${netMargin.toFixed(2)}%
======================================
Reporte generado por WinnerProduct OS
======================================`;
      const blob = new Blob([reportContent], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Reporte_PyG_${productName.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'producto'}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    };
    return (
      <div className="space-y-6 md:space-y-10 pb-20 animate-in fade-in duration-500 text-left">
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white rounded-[2rem] p-5 md:p-8 shadow-sm border border-zinc-200/50">
          <div className="w-full md:flex-1">
            <label className="text-[9px] md:text-[11px] font-black text-zinc-400 uppercase tracking-widest block mb-2 px-1">Producto a Analizar</label>
            <input type="text" value={proj.name || ''} onChange={(e) => setProj({...proj, name: e.target.value})} className="w-full bg-zinc-50 border-2 border-zinc-100 rounded-xl md:rounded-2xl p-3 md:p-4 text-sm md:text-base focus:outline-none focus:border-indigo-400 transition-all text-zinc-900 font-bold" placeholder="Ej. Nombre del producto..." />
          </div>
          <div className="flex flex-col sm:flex-row w-full md:w-auto gap-3">
            <button onClick={downloadReport} className="w-full md:w-auto bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white px-4 md:px-6 py-3 md:py-4 rounded-xl md:rounded-2xl font-black text-[10px] md:text-xs uppercase tracking-widest transition-all border border-indigo-100 flex items-center justify-center gap-2 shrink-0">📄 Descargar Informe</button>
            <button onClick={resetProjection} className="w-full md:w-auto bg-rose-50 text-rose-600 hover:bg-rose-500 hover:text-white px-4 md:px-6 py-3 md:py-4 rounded-xl md:rounded-2xl font-black text-[10px] md:text-xs uppercase tracking-widest transition-all border border-rose-100 flex items-center justify-center gap-2 shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
              Limpiar Datos
            </button>
          </div>
        </div>
        <div className="bg-white rounded-[2rem] p-5 md:p-10 shadow-sm border border-zinc-200/50">
          <h2 className="text-lg md:text-2xl font-black text-zinc-900 uppercase italic mb-6 border-b-2 border-zinc-100 pb-3">Datos de Operación y Costos</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-6">
            <InputP label="Precio Venta" value={proj.price} onChange={handleChange('price')} type="currency" prefix="$" />
            <InputP label="Costo Producto" value={proj.productCost} onChange={handleChange('productCost')} type="currency" prefix="$" />
            <InputP label="Flete" value={proj.freight} onChange={handleChange('freight')} type="currency" prefix="$" />
            <InputP label="Fulfillment" value={proj.fulfillment} onChange={handleChange('fulfillment')} type="currency" prefix="$" />
            <InputP label="Comisión + Fijos" value={proj.commission} onChange={handleChange('commission')} type="currency" prefix="$" />
          </div>
        </div>
        <div className="bg-white rounded-[2rem] p-5 md:p-10 shadow-sm border border-zinc-200/50">
          <h2 className="text-lg md:text-2xl font-black text-zinc-900 uppercase italic mb-6 border-b-2 border-zinc-100 pb-3">Análisis de Métricas</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-6">
            <InputP label="Inv. Facebook" value={proj.adSpend} onChange={handleChange('adSpend')} type="currency" prefix="$" />
            <InputP label="CPM" value={proj.cpm} onChange={handleChange('cpm')} type="currency" prefix="$" />
            <OutputP label="Impresiones" value={impressions} type="number" decimals={0} />
            <OutputP label="Costo x Impresión" value={costPerImpression} type="currency" />
            <InputP label="CTR" value={proj.ctr} onChange={handleChange('ctr')} type="number" suffix="%" />
            <OutputP label="Clics en enlace" value={linkClicks} type="number" decimals={0} />
            <OutputP label="Costo por Clic" value={cpc} type="currency" />
            <InputP label="Vel. de Carga" value={proj.loadSpeed} onChange={handleChange('loadSpeed')} type="number" suffix="%" />
            <OutputP label="Visitas a página" value={pageVisits} type="number" decimals={0} />
            <OutputP label="Costo x Visita" value={costPerVisit} type="currency" />
            <InputP label="Conversión" value={proj.conversionRate} onChange={handleChange('conversionRate')} type="number" suffix="%" />
            <OutputP label="Ventas (Pedidos)" value={salesCol1} type="number" decimals={2} />
            <OutputP label="Ventas ($)" value={salesCol2} type="currency" />
            <OutputP label="CPA Facebook" value={cpaFb} type="currency" customBg="bg-blue-600 border-blue-700 shadow-lg" customText="text-white" />
            <InputP label="% Efectividad" value={proj.effectiveness} onChange={handleChange('effectiveness')} type="number" suffix="%" />
            <OutputP label="Ped. Despachados" value={dispatchedOrders} type="number" decimals={2} />
            <OutputP label="Costo x Despachado" value={costPerDispatched} type="currency" />
            <InputP label="% Devolución" value={proj.returnRate} onChange={handleChange('returnRate')} type="number" suffix="%" />
            <OutputP label="Devoluciones" value={returns} type="number" decimals={2} />
            <OutputP label="Entregas Efectivas" value={effectiveDeliveries} type="number" decimals={2} />
            <OutputP label="Ingresos Reales" value={realRevenue} type="currency" highlight />
            <OutputP label="CPA Real" value={cpaReal} type="currency" customBg="bg-orange-500 border-orange-600 shadow-lg" customText="text-white" />
            <OutputP label="ROAS FACEBOOK" value={roasFb} type="number" decimals={2} />
            <OutputP label="ROAS REAL ⭐" value={roasReal} type="number" decimals={2} highlight />
          </div>
        </div>
        <div className="bg-white rounded-[2rem] p-5 md:p-10 shadow-sm border border-zinc-200/50">
          <h2 className="text-lg md:text-2xl font-black text-zinc-900 uppercase italic mb-6 border-b-2 border-zinc-100 pb-3">Pérdidas y Ganancias</h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-10">
            <div className="space-y-3">
              <OutputP label="Facturado Tienda Web" value={salesCol2} type="currency" />
              <OutputP label="Facturado Real ⭐" value={realRevenue} type="currency" highlight />
              <OutputP label="Ingresos Totales" value={realRevenue} type="currency" />
              <OutputP label="Inversión Publicidad" value={proj.adSpend} type="currency" />
            </div>
            <div className="space-y-3 p-4 md:p-6 bg-rose-50/50 rounded-[1.5rem] border border-rose-100">
              <h3 className="text-[10px] md:text-[12px] font-black text-rose-500 uppercase mb-4">Desglose de Costos Operativos</h3>
              <OutputP label="Costo Prod. Vendido" value={totalProductCost} type="currency" />
              <OutputP label="Costo Envío Efectivo 🚚" value={totalFreightCost} type="currency" />
              <OutputP label="Costo Devoluciones" value={totalReturnCost} type="currency" customBg="bg-rose-500 border-rose-600 shadow-lg" customText="text-white" />
              <OutputP label="Costo Fulfillment" value={totalFulfillmentCost} type="currency" />
              <OutputP label="Costo Comisión" value={totalCommissionCost} type="currency" />
              <div className="pt-2"><OutputP label="Total Costos Intermediación" value={intermediationCosts} type="currency" highlight /></div>
            </div>
            <div className="space-y-3">
              <InputP label="Gastos Fijos (Globales)" value={proj.fixedExpenses} onChange={handleChange('fixedExpenses')} type="currency" prefix="$" />
              <InputP label="Campañas Activas" value={proj.activeCampaigns} onChange={handleChange('activeCampaigns')} type="number" />
              <OutputP label="Prorrateo x Campaña" value={prorateCampaign} type="currency" />
              <div className="mt-6">
                <div className={`rounded-[1.5rem] p-5 shadow-lg text-white transition-colors duration-500 ${grossProfit < 0 ? 'bg-rose-600' : 'bg-emerald-500'}`}>
                  <label className="text-[10px] font-black uppercase tracking-widest opacity-80 block mb-1">Profit Bruto ⭐⭐⭐⭐⭐</label>
                  <div className="text-3xl md:text-4xl font-black font-mono">{formatCurrency(grossProfit)}</div>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-8 bg-zinc-900 rounded-[2.5rem] p-6 md:p-12 text-white shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/20 rounded-full blur-[100px] -mr-32 -mt-32"></div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative z-10 text-center md:text-left">
              <div className="border-b md:border-b-0 md:border-r border-zinc-800 pb-6 md:pb-0 md:pr-8">
                <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Profit Neto Real</p>
                <p className={`text-4xl md:text-6xl font-black font-mono tracking-tighter ${netProfit < 0 ? 'text-rose-500' : 'text-emerald-400'}`}>{formatCurrency(netProfit)}</p>
              </div>
              <div className="border-b md:border-b-0 md:border-r border-zinc-800 pb-6 md:pb-0 md:px-8">
                <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Margen Bruto</p>
                <p className="text-3xl md:text-5xl font-black italic">{grossMargin.toFixed(2)}%</p>
              </div>
              <div className="md:pl-8">
                <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Margen Neto</p>
                <p className={`text-3xl md:text-5xl font-black italic ${netMargin < 0 ? 'text-rose-500' : 'text-indigo-400'}`}>{netMargin.toFixed(2)}%</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderCreationForm = () => {
    if (activeModule === 'winners') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 text-zinc-900 text-left">
          <div className="space-y-4">
            <div className="aspect-square bg-zinc-50 rounded-xl md:rounded-2xl border-2 border-dashed border-zinc-200 relative flex items-center justify-center overflow-hidden shadow-inner group max-w-sm mx-auto w-full text-center">
              {newProduct.image ? <img src={newProduct.image} className="w-full h-full object-cover" alt="Preview"/> : <span className="text-xs md:text-4xl opacity-10 font-bold flex items-center justify-center h-full italic">IMG</span>}
              <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e)=>handleImage(e)}/>
            </div>
            <div className="relative"><input value={newProduct.name || ''} onChange={(e)=>setNewProduct({...newProduct, name: e.target.value})} className="w-full border-b-2 border-zinc-200 pb-2 font-bold text-xl md:text-2xl outline-none focus:border-zinc-900 bg-transparent text-zinc-900 placeholder:text-zinc-300" placeholder="* Nombre Comercial (Obligatorio)"/></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="text-[9px] font-black text-zinc-400 uppercase px-1 leading-none">CÓDIGO DROPI</label><input value={newProduct.dropiCode || ''} onChange={(e)=>setNewProduct({...newProduct, dropiCode: e.target.value})} className="bg-zinc-50 border border-zinc-100 rounded-xl p-3 text-sm font-mono w-full text-zinc-800 outline-none" placeholder="ID-000"/></div>
              <div><label className="text-[9px] font-black text-zinc-400 uppercase px-1 leading-none">Proveedor</label><input value={newProduct.supplier || ''} onChange={(e)=>setNewProduct({...newProduct, supplier: e.target.value})} className="bg-zinc-50 border border-zinc-100 rounded-xl p-3 text-sm w-full text-zinc-800 outline-none" placeholder="Nombre..."/></div>
            </div>
          </div>
          <div className="space-y-6">
            <div className="bg-zinc-50 p-4 md:p-6 rounded-2xl border border-zinc-100 shadow-sm">
              <h3 className="text-[10px] font-black uppercase text-zinc-400 mb-4 border-b pb-2">Costos Winner (COP)</h3>
              <div className="grid grid-cols-2 gap-3">
                {['base', 'cpa', 'freight', 'fulfillment', 'commission', 'returns', 'fixed'].map(k => (
                  <div key={k}><label className="text-[8px] font-bold text-zinc-500 uppercase block mb-1 leading-none">{k}</label>
                  <input type="number" value={newProduct.costs?.[k] || ''} onChange={(e)=>setNewProduct({...newProduct, costs: {...newProduct.costs, [k]: parseFloat(e.target.value)||0}})} className="w-full bg-white border border-zinc-200 rounded-lg p-2 text-base font-mono text-zinc-800 outline-none"/></div>
                ))}
              </div>
            </div>
            <div className="bg-zinc-900 p-5 md:p-6 rounded-2xl text-white shadow-xl">
              <label className="text-[9px] font-bold uppercase text-zinc-500 mb-2 block leading-none">PVP Sugerido</label>
              <div className="flex items-center gap-2"><span className="text-2xl font-bold opacity-30">$</span>
              <input type="number" value={newProduct.targetPrice || ''} onChange={(e)=>setNewProduct({...newProduct, targetPrice: parseFloat(e.target.value)||0})} className="w-full bg-transparent border-b border-zinc-700 text-3xl md:text-4xl font-bold outline-none text-white"/></div>
            </div>
          </div>
        </div>
      );
    } else {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 text-zinc-900 text-left">
          <div className="space-y-4">
            <div className="aspect-square bg-zinc-50 rounded-xl md:rounded-2xl border-2 border-dashed border-zinc-200 relative flex items-center justify-center overflow-hidden shadow-inner group max-w-sm mx-auto w-full text-center">
              {newProduct.image ? <img src={newProduct.image} className="w-full h-full object-cover" alt="Preview"/> : <span className="text-xs md:text-4xl opacity-10 font-bold flex items-center justify-center h-full italic">IMG</span>}
              <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e)=>handleImage(e)}/>
            </div>
            <div className="relative"><input value={newProduct.name || ''} onChange={(e)=>setNewProduct({...newProduct, name: e.target.value})} className="w-full border-b-2 border-zinc-200 pb-2 font-bold text-xl md:text-2xl outline-none focus:border-zinc-900 bg-transparent text-zinc-900 placeholder:text-zinc-300" placeholder="* Nombre Producto (Obligatorio)"/></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-left"><label className="text-[9px] font-black text-zinc-400 uppercase px-1 leading-none">Proveedor Chino</label><input value={newProduct.chineseSupplier || ''} onChange={(e)=>setNewProduct({...newProduct, chineseSupplier: e.target.value})} className="bg-zinc-50 border border-zinc-100 rounded-xl p-3 text-sm w-full text-zinc-800 outline-none" placeholder="Nombre..."/></div>
              <div className="text-left"><label className="text-[9px] font-black text-zinc-400 uppercase px-1 leading-none">Dólar Hoy</label><input type="number" value={newProduct.dollarRate || ''} onChange={(e)=>setNewProduct({...newProduct, dollarRate: parseFloat(e.target.value)||0})} className="bg-zinc-50 border border-zinc-100 rounded-xl p-3 text-sm font-mono w-full text-zinc-800 outline-none" placeholder="0.00"/></div>
            </div>
          </div>
          <div className="space-y-4">
            <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-100 grid grid-cols-2 gap-3 md:gap-4 text-left">
              <div><label className="text-[8px] font-black text-zinc-400 uppercase">Costo USD</label><input type="number" value={newProduct.prodCostUSD || ''} onChange={(e)=>setNewProduct({...newProduct, prodCostUSD: parseFloat(e.target.value)||0})} className="w-full bg-white border border-zinc-200 rounded-lg p-2 text-base text-zinc-800 outline-none"/></div>
              <div><label className="text-[8px] font-black text-zinc-400 uppercase">Costo CBM</label><input type="number" value={newProduct.cbmCostCOP || ''} onChange={(e)=>setNewProduct({...newProduct, cbmCostCOP: parseFloat(e.target.value)||0})} className="w-full bg-white border border-zinc-200 rounded-lg p-2 text-base text-zinc-800 outline-none"/></div>
              <div><label className="text-[8px] font-black text-zinc-400 uppercase">Unidades</label><input type="number" value={newProduct.unitsQty || ''} onChange={(e)=>setNewProduct({...newProduct, unitsQty: parseFloat(e.target.value)||0})} className="w-full bg-white border border-zinc-200 rounded-lg p-2 text-base text-zinc-800 outline-none"/></div>
              <div><label className="text-[8px] font-black text-zinc-400 uppercase">CTN qty</label><input type="number" value={newProduct.ctnQty || ''} onChange={(e)=>setNewProduct({...newProduct, ctnQty: parseFloat(e.target.value)||0})} className="w-full bg-white border border-zinc-200 rounded-lg p-2 text-base text-zinc-800 outline-none"/></div>
              <div className="col-span-2"><label className="text-[8px] font-black text-zinc-400 uppercase">Flete YIWU (USD)</label><input type="number" value={newProduct.yiwuFreightUSD || ''} onChange={(e)=>setNewProduct({...newProduct, yiwuFreightUSD: parseFloat(e.target.value)||0})} className="w-full bg-white border border-zinc-200 rounded-lg p-2 text-base text-zinc-800 outline-none"/></div>
            </div>
            <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-100 text-left">
              <h4 className="text-[8px] font-black text-zinc-400 uppercase mb-2 px-1">Medidas CTN (W x H x L cm)</h4>
              <div className="grid grid-cols-3 gap-2 px-1">
                <input type="number" value={newProduct.measures?.width || ''} placeholder="W" onChange={(e)=>setNewProduct({...newProduct, measures: {...newProduct.measures, width: parseFloat(e.target.value)||0}})} className="bg-white border border-zinc-200 p-2 rounded text-sm w-full text-zinc-800 outline-none"/>
                <input type="number" value={newProduct.measures?.height || ''} placeholder="H" onChange={(e)=>setNewProduct({...newProduct, measures: {...newProduct.measures, height: parseFloat(e.target.value)||0}})} className="bg-white border border-zinc-200 p-2 rounded text-sm w-full text-zinc-800 outline-none"/>
                <input type="number" value={newProduct.measures?.length || ''} placeholder="L" onChange={(e)=>setNewProduct({...newProduct, measures: {...newProduct.measures, length: parseFloat(e.target.value)||0}})} className="bg-white border border-zinc-200 p-2 rounded text-sm w-full text-zinc-800 outline-none"/>
              </div>
            </div>
          </div>
        </div>
      );
    }
  };

  if (loading) return <div className="min-h-screen bg-[#f1f5f9] flex items-center justify-center"><div className="bg-white p-8 rounded-2xl shadow-xl text-center"><div className="w-12 h-12 border-4 border-zinc-200 border-t-zinc-900 rounded-full animate-spin mx-auto mb-4"></div><p className="text-zinc-500 font-bold text-sm">Cargando sesión...</p></div></div>;
  if (!user) return <LoginScreen />;
  if(roleLoading) return <div className="p-8 text-center">Validando permisos...</div>;
  if(!userRole)return <div className="min-h-screen flex items-center justify-center bg-slate-100 p-5"><div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-xl"><h2 className="text-xl font-black">Acceso pendiente de autorización</h2><p className="my-4 text-sm">Un administrador debe asignar tu UID en Firestore /user_roles/ con role: admin o digital.</p><button className="rounded-xl bg-slate-900 px-5 py-3 text-white" onClick={()=>signOut(auth)}>Cerrar sesión</button></div></div>;

  return (
    <div className="winner-shell min-h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {notification && <div className="fixed bottom-4 left-1/2 z-[90] -translate-x-1/2 rounded-xl bg-slate-900 px-6 py-3 text-xs font-black text-white">{notification}</div>}
      <div className="flex min-h-screen">
        {mobileMenu&&<button aria-label="Cerrar menú" className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={()=>setMobileMenu(false)}/>}
        <aside className={`${mobileMenu?'translate-x-0':'-translate-x-full'} fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-[#0B1220] p-4 text-white shadow-2xl transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0`}>
          <div className="mb-8 flex items-center gap-3 border-b border-white/10 pb-5"><div className="rounded-xl bg-blue-600 p-3 font-black">W</div><div><div className="font-black tracking-wide">WINNER OS 2.0</div><div className="text-[10px] text-cyan-300">TU PEDIDO COLOMBIA</div></div></div>
          <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Navegación</div>
          {(userRole==='digital'?[['digital','✦','Área Digital']]:[['winners','🏆','Winners'],['imports','🚢','Importaciones'],['projection','📈','Proyección P&G'],['agenda','📅','Agenda'],['prompts','🧠','Prompts'],['digital','✦','Área Digital']]).map(([id,icon,label])=><button key={id} onClick={()=>{handleModuleChange(id);setMobileMenu(false);}} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-bold transition-colors ${activeModule===id?'bg-blue-600 text-white shadow-lg':'text-slate-300 hover:bg-white/10'}`}><span>{icon}</span>{label}</button>)}
          <div className="mt-auto space-y-3 border-t border-white/10 pt-4"><div className="truncate text-xs text-slate-400" title={user.email}>{user.email}</div><button onClick={handleLogout} className="w-full rounded-xl border border-white/20 px-4 py-2 text-left text-xs font-bold hover:bg-white/10">↪ Cerrar sesión</button></div>
        </aside>
        <main className="min-w-0 flex-1 p-3 sm:p-5 lg:p-8">
          <header className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-4"><div className="flex min-w-0 items-center gap-3"><button aria-label="Abrir menú" className="rounded-xl border px-3 py-2 lg:hidden dark:border-slate-700" onClick={()=>setMobileMenu(true)}>☰</button><div className="min-w-0"><div className="truncate text-sm font-black sm:text-lg">{({winners:'Winners',imports:'Importaciones',projection:'Proyección P&G',agenda:'Agenda',prompts:'Prompts IA',digital:'Área Digital'})[activeModule]}</div><div className="text-[10px] text-slate-500 dark:text-slate-400">Gestión inteligente · Tu Pedido Colombia</div></div></div><button title="Cambiar tema" aria-label="Cambiar tema claro u oscuro" className="shrink-0 rounded-xl border border-slate-200 px-4 py-2 text-sm dark:border-slate-700" onClick={toggleTheme}>{theme==='light'?'🌙 Oscuro':'☀️ Claro'}</button></header>
          <div className="mx-auto max-w-[1500px]">
        {activeModule === 'digital' && <DigitalModule user={user} />}
        {activeModule === 'agenda' && <AgendaModule />}
        {activeModule === 'prompts' && <PromptModule />}
        {activeModule === 'projection' && renderProjectionModule()}
        {activeModule !== 'agenda' && activeModule !== 'prompts' && activeModule !== 'projection' && activeModule !== 'digital' && (
          <>
            <div className="grid md:grid-cols-4 gap-3 mb-4">
              <input type="text" placeholder="Buscar..." value={searchTerm} onChange={(e)=>setSearchTerm(e.target.value)} className="md:col-span-2 bg-white border rounded-xl p-3 text-sm" />
              <select value={supplierFilter} onChange={(e)=>setSupplierFilter(e.target.value)} className="bg-white border rounded-xl p-3 text-sm"><option value="all">TODOS PROV.</option>{uniqueSuppliers.filter(s=>s!=='all').map(s=><option key={s} value={s}>{s.toUpperCase()}</option>)}</select>
              <select value={sortOrder} onChange={(e)=>setSortOrder(e.target.value)} className="bg-white border rounded-xl p-3 text-sm"><option value="manual">ORDEN MANUAL</option><option value="roi-desc">ROI ↑</option><option value="roi-asc">ROI ↓</option><option value="recent">RECIENTES</option></select>
            </div>
            <header className="bg-white rounded-2xl p-4 flex justify-between items-center mb-4">
              <div className="flex items-center gap-3"><div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center text-white text-xl font-black">W</div><h1 className="text-xl font-black">{activeModule==='winners'?'Winner OS':'Importación'}</h1></div>
              <button onClick={()=>{setIsCreating(true); setFormError('');}} className="bg-zinc-900 text-white px-6 py-2 rounded-xl text-xs font-black">➕ Crear Registro</button>
            </header>
            <div className="flex gap-2 mb-6 overflow-x-auto">
              {Object.values(activeModule==='winners'?WINNER_STATUS:IMPORT_STATUS).map(c=>(
                <button key={c.id} onClick={()=>setActiveTab(c.id)} className={`px-4 py-2 rounded-xl text-[11px] font-black ${activeTab===c.id?c.activeColor:'bg-white text-zinc-400'}`}>{c.emoji} {c.label} ({products.filter(p=>p.status===c.id).length})</button>
              ))}
            </div>
            <div className="space-y-6">
              {displayedProducts.map((p,idx)=>{
                const isWinner = activeModule==='winners';
                const mWinner = isWinner ? calculateWinnerMetrics(p) : null;
                const mImport = !isWinner ? calculateImportMetrics(p) : null;
                const stCfg = (isWinner?WINNER_STATUS[p.status]:IMPORT_STATUS[p.status]) || (isWinner?WINNER_STATUS.pending:IMPORT_STATUS.pending);
                let cardBgClass = p.isWorking ? 'bg-amber-50 border-amber-400' : 'bg-white';
                if(!isWinner && p.status==='approved') cardBgClass = (IMPORT_STATES_LIST[p.importStatus]||IMPORT_STATES_LIST.warehouse).bgColor;
                return (
                  <div key={p.id} className={`rounded-2xl shadow-sm border text-slate-900 dark:text-slate-100 ${cardBgClass} overflow-hidden`}>
                    <div className="px-4 py-2 flex justify-between items-center border-b bg-zinc-50/20">
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="bg-zinc-900 text-white px-2 py-0.5 rounded-lg text-[10px] font-black">{p.regNumber}</div>
                        {p.createdAtText && <div className="text-[10px] text-zinc-500">📅 {p.createdAtText}</div>}
                        <div className="flex items-center gap-1 cursor-pointer" onClick={()=>updateDocField(p.id,'isWorking',!p.isWorking)}>
                          <span className="text-[9px] font-black">{p.isWorking?'🔴 EN PROCESO':'⚪ EN PROCESO'}</span>
                          <div className={`w-7 h-4 rounded-full ${p.isWorking?'bg-amber-500':'bg-zinc-200'}`}><div className={`w-3 h-3 bg-white rounded-full shadow-sm transition-all ${p.isWorking?'translate-x-3':'translate-x-0'}`}></div></div>
                        </div>
                        <span className="text-[10px] font-black">{stCfg.emoji} {stCfg.label}</span>
                        {sortOrder==='manual' && <div className="flex gap-1"><button onClick={()=>moveItem(p.id,-1)} disabled={idx===0}>▲</button><span className="text-[10px]">#{idx+1}</span><button onClick={()=>moveItem(p.id,1)} disabled={idx===displayedProducts.length-1}>▼</button></div>}
                      </div>
                      <button onClick={()=>deleteItem(p.id)} className="text-zinc-300 hover:text-rose-600">🗑️</button>
                    </div>
                    <div className="flex flex-col xl:flex-row">
                      <div className="w-full xl:w-1/3 p-4 border-r">
                        <div className="flex flex-col items-center">
                          <div className="w-32 h-32 bg-white rounded-2xl border relative overflow-hidden cursor-pointer group">
                            {p.image ? <img src={p.image} className="w-full h-full object-cover"/> : <div className="flex items-center justify-center h-full text-2xl opacity-20">IMG</div>}
                            <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e)=>handleImage(e,p.id)}/>
                          </div>
                          <input value={p.name||''} onChange={(e)=>updateDocField(p.id,'name',e.target.value)} className="w-full text-center font-bold text-lg mt-2 border-b border-transparent hover:border-zinc-200 focus:border-zinc-900 outline-none bg-transparent text-slate-900 dark:text-slate-100" placeholder="Nombre..."/>
                          <div className="grid grid-cols-2 gap-2 w-full mt-2">
                            {isWinner ? (
                              <>
                                <div onClick={()=>copyToClipboard(p.dropiCode)} className="bg-white border p-1 rounded-lg text-slate-900 dark:bg-slate-800 dark:text-slate-100 text-center cursor-pointer"><span className="text-[8px] font-black">DROPI</span><input value={p.dropiCode||''} onChange={(e)=>updateDocField(p.id,'dropiCode',e.target.value)} className="w-full text-xs font-mono bg-transparent outline-none text-slate-900 dark:text-slate-100"/></div>
                                <div className="bg-white border p-1 rounded-lg text-slate-900 dark:bg-slate-800 dark:text-slate-100"><span className="text-[8px] font-black">PROV.</span><input value={p.supplier||''} onChange={(e)=>updateDocField(p.id,'supplier',e.target.value)} className="w-full text-xs bg-transparent outline-none text-slate-900 dark:text-slate-100"/></div>
                              </>
                            ) : (
                              <>
                                <div className="bg-white border p-1 rounded-lg text-slate-900 dark:bg-slate-800 dark:text-slate-100"><span className="text-[8px] font-black">CH-PROV</span><input value={p.chineseSupplier||''} onChange={(e)=>updateDocField(p.id,'chineseSupplier',e.target.value)} className="w-full text-xs bg-transparent outline-none text-slate-900 dark:text-slate-100"/></div>
                                <div className="bg-white border p-1 rounded-lg text-slate-900 dark:bg-slate-800 dark:text-slate-100"><span className="text-[8px] font-black">TRM</span><input type="number" value={p.dollarRate||0} onChange={(e)=>updateDocField(p.id,'dollarRate',parseFloat(e.target.value)||0)} className="w-full text-xs bg-transparent outline-none text-slate-900 dark:text-slate-100"/></div>
                              </>
                            )}
                          </div>
                          {isWinner && (
                            <button onClick={()=>setExpandedItems({...expandedItems,[`desc_${p.id}`]:!expandedItems[`desc_${p.id}`]})} className="w-full text-left text-[9px] font-black mt-2 flex justify-between"><span>Ver Estrategia</span><span>{expandedItems[`desc_${p.id}`]?'▲':'▼'}</span></button>
                          )}
                          {isWinner && expandedItems[`desc_${p.id}`] && <textarea value={p.description||''} onChange={(e)=>updateDocField(p.id,'description',e.target.value)} rows={2} className="w-full mt-1 text-xs bg-white p-2 rounded border" placeholder="Estrategia..."/>}
                        </div>
                      </div>
                      <div className="flex-1 p-4 space-y-4">
                        {isWinner ? (
                          <div className="grid grid-cols-4 gap-2">
                            {['base','cpa','freight','fulfillment','commission','returns','fixed'].map(k=>(
                              <div key={k} className="bg-zinc-50 p-2 rounded-lg text-slate-900 dark:bg-slate-800 dark:text-slate-100"><label className="text-[8px] font-black">{k}</label><input type="number" value={p.costs?.[k]||0} onChange={(e)=>updateNestedField(p.id,'costs',k,parseFloat(e.target.value)||0)} className="w-full text-xs font-mono bg-transparent outline-none text-slate-900 dark:text-slate-100"/></div>
                            ))}
                          </div>
                        ) : (
                          <div className="grid grid-cols-4 gap-2">
                            {[{k:'prodCostUSD',l:'USD'},{k:'cbmCostCOP',l:'CBM'},{k:'unitsQty',l:'Uds'},{k:'ctnQty',l:'CTN'},{k:'yiwuFreightUSD',l:'Yiwu'}].map(f=>(
                              <div key={f.k} className="bg-zinc-50 p-2 rounded-lg text-slate-900 dark:bg-slate-800 dark:text-slate-100"><label className="text-[8px] font-black">{f.l}</label><input type="number" value={p[f.k]||0} onChange={(e)=>updateDocField(p.id,f.k,parseFloat(e.target.value)||0)} className="w-full text-xs font-mono bg-transparent outline-none text-slate-900 dark:text-slate-100"/></div>
                            ))}
                            <div className="col-span-2 bg-zinc-50 p-2 rounded-lg"><label className="text-[8px] font-black">Medidas (cm)</label><div className="flex gap-1"><input type="number" value={p.measures?.width||0} onChange={(e)=>updateNestedField(p.id,'measures','width',parseFloat(e.target.value)||0)} className="w-1/3 text-xs"/><input type="number" value={p.measures?.height||0} onChange={(e)=>updateNestedField(p.id,'measures','height',parseFloat(e.target.value)||0)} className="w-1/3 text-xs"/><input type="number" value={p.measures?.length||0} onChange={(e)=>updateNestedField(p.id,'measures','length',parseFloat(e.target.value)||0)} className="w-1/3 text-xs"/></div></div>
                            <div className="col-span-2 md:col-span-1 bg-indigo-50 p-2 rounded-lg"><label className="text-[8px] font-black">TOTAL CBM</label><div className="font-mono text-sm font-black">{mImport.totalCbm.toFixed(3)}</div></div>
                          </div>
                        )}
                        <div className="bg-zinc-900 rounded-2xl p-4 text-white relative overflow-hidden">
                          {isWinner ? (
                            <div className="space-y-2"><div className="flex justify-between"><div><label className="text-[9px] font-black">PVP Sugerido</label><input type="number" value={p.targetPrice||0} onChange={(e)=>updateDocField(p.id,'targetPrice',parseFloat(e.target.value)||0)} className="bg-transparent text-white text-3xl font-black w-32 outline-none"/></div><div className="text-right"><label className="text-[9px] font-black">Costos</label><div className="text-lg font-mono">{formatCurrency(mWinner.totalCost)}</div></div></div><div className="flex justify-between"><div><label className="text-[9px] font-black">Utilidad Neta</label><div className={`text-2xl font-mono font-black ${mWinner.profit>0?'text-emerald-400':'text-rose-500'}`}>{formatCurrency(mWinner.profit)}</div></div><div><label className="text-[9px] font-black">Margen ROI</label><div className="text-3xl font-black italic">{mWinner.margin.toFixed(1)}%</div></div></div></div>
                          ) : (
                            <div className="space-y-2"><div className="flex justify-between"><div><label className="text-[9px] font-black">China (1.03x)</label><div className="text-xl font-mono">{formatCurrency(mImport.costChinaCOP)}</div></div><div><label className="text-[9px] font-black">Logística</label><div className="text-xl font-mono">{formatCurrency(mImport.nationalizationCOP)}</div></div></div><div className="bg-emerald-500/10 p-3 rounded-xl"><div><label className="text-[9px] font-black">Costo Prod. Colombia</label><div className="text-2xl font-black">{formatCurrency(mImport.unitCostColombia)}</div></div><div><label className="text-[8px] font-black">Inversión Total</label><div className="text-xs opacity-50">{formatCurrency(mImport.totalLandCostCOP)}</div></div></div></div>
                          )}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          {Object.values(isWinner?WINNER_STATUS:IMPORT_STATUS).map(s=>(
                            <button key={s.id} onClick={()=>updateDocField(p.id,'status',s.id)} className={`px-3 py-1.5 rounded-xl text-[10px] font-black border-2 ${p.status===s.id ? `bg-white ${s.activeColor} border-zinc-900` : 'bg-white border-zinc-100 text-zinc-400'}`}>{s.emoji} {s.label}</button>
                          ))}
                        </div>
                        {isWinner && p.status === 'testing' && (
                          <div className="bg-amber-50 p-3 rounded-xl space-y-2"><h4 className="text-xs font-black">🧪 Datos de Testeo</h4>{(p.testingData||getInitialWinner().testingData).map(t=><div key={t.id} className="grid grid-cols-1 md:grid-cols-3 gap-2"><input value={t.sellerName||''} onChange={(e)=>updateTestingData(p,t.id,'sellerName',e.target.value)} placeholder={`Vendedora ${t.id}`} className="bg-white border rounded-lg p-1 text-sm"/><input type="date" value={t.startDate||''} onChange={(e)=>updateTestingData(p,t.id,'startDate',e.target.value)} className="bg-white border rounded-lg p-1 text-sm"/><input type="date" value={t.endDate||''} onChange={(e)=>updateTestingData(p,t.id,'endDate',e.target.value)} className="bg-white border rounded-lg p-1 text-sm"/></div>)}</div>
                        )}
                        {isWinner && p.status === 'rejected' && (
                          <textarea value={p.rejectionReason||''} onChange={(e)=>updateDocField(p.id,'rejectionReason',e.target.value)} rows={2} className="w-full border-rose-200 border rounded-lg p-2 text-sm" placeholder="Motivo de rechazo..."/>
                        )}
                        {!isWinner && p.status === 'approved' && (
                          <div className="bg-white/50 rounded-2xl p-4 space-y-5 border border-emerald-200">
                            <h4 className="text-sm font-black text-emerald-700">📋 Gestión de Compra</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <label className="block text-[10px] font-black text-zinc-500 mb-1">📅 Fecha de Compra</label>
                                <input type="date" value={p.purchaseDate || ''} onChange={(e) => updateDocField(p.id, 'purchaseDate', e.target.value)} className="w-full bg-white border border-zinc-200 rounded-xl p-2 text-sm" />
                              </div>
                              <div>
                                <label className="block text-[10px] font-black text-zinc-500 mb-1">💰 Anticipo (COP)</label>
                                <div className="flex gap-2">
                                  <input type="number" value={p.advancePayment?.amount || 0} onChange={(e) => updateNestedField(p.id, 'advancePayment', 'amount', parseFloat(e.target.value) || 0)} placeholder="Monto" className="w-1/2 bg-white border border-zinc-200 rounded-xl p-2 text-sm" />
                                  <input type="date" value={p.advancePayment?.date || ''} onChange={(e) => updateNestedField(p.id, 'advancePayment', 'date', e.target.value)} className="w-1/2 bg-white border border-zinc-200 rounded-xl p-2 text-sm" />
                                </div>
                              </div>
                              <div>
                                <label className="block text-[10px] font-black text-zinc-500 mb-1">💵 Pago Total (COP)</label>
                                <div className="flex gap-2">
                                  <input type="number" value={p.totalPayment?.amount || 0} onChange={(e) => updateNestedField(p.id, 'totalPayment', 'amount', parseFloat(e.target.value) || 0)} placeholder="Monto" className="w-1/2 bg-white border border-zinc-200 rounded-xl p-2 text-sm" />
                                  <input type="date" value={p.totalPayment?.date || ''} onChange={(e) => updateNestedField(p.id, 'totalPayment', 'date', e.target.value)} className="w-1/2 bg-white border border-zinc-200 rounded-xl p-2 text-sm" />
                                </div>
                              </div>
                              <div>
                                <label className="block text-[10px] font-black text-zinc-500 mb-1">📦 Cantidad Real Comprada</label>
                                <input type="number" value={p.actualQuantity || 0} onChange={(e) => updateDocField(p.id, 'actualQuantity', parseFloat(e.target.value) || 0)} className="w-full bg-white border border-zinc-200 rounded-xl p-2 text-sm" />
                              </div>
                            </div>
                            <div className="bg-indigo-50 rounded-xl p-3">
                              <h5 className="text-[10px] font-black text-indigo-700 mb-2">🇨🇳 Saldo Pendiente con Proveedor Chino</h5>
                              {(() => {
                                const prodUSD = (p.prodCostUSD || 0) * (p.unitsQty || 0);
                                const flete = p.yiwuFreightUSD || 0;
                                const totalUSD = prodUSD + flete;
                                const trm = p.dollarRate || 0;
                                const valorCOP = totalUSD * trm * 1.03;
                                const anticipo = p.advancePayment?.amount || 0;
                                const pagoTotal = p.totalPayment?.amount || 0;
                                const totalPagado = anticipo + pagoTotal;
                                const saldoCOP = valorCOP - totalPagado;
                                const saldoUSD = saldoCOP / (trm || 1);
                                const porcentajePagado = valorCOP > 0 ? (totalPagado / valorCOP) * 100 : 0;
                                return (
                                  <div>
                                    <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                                      <div>💰 Productos: {prodUSD.toFixed(2)} USD</div>
                                      <div>🚢 Flete Yiwu: {flete.toFixed(2)} USD</div>
                                      <div>💱 TRM: {trm.toLocaleString()} COP</div>
                                      <div>📦 Total compra (1.03x): {formatCurrency(valorCOP)}</div>
                                    </div>
                                    <div className="mt-2 bg-white rounded-lg p-2">
                                      <div className="flex justify-between"><span>Anticipo:</span><span>{formatCurrency(anticipo)}</span></div>
                                      <div className="flex justify-between"><span>Pago Total:</span><span>{formatCurrency(pagoTotal)}</span></div>
                                      <div className="flex justify-between"><span>Total Pagado:</span><span className="font-bold">{formatCurrency(totalPagado)}</span></div>
                                      <div className="mt-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                        <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${porcentajePagado}%` }}></div>
                                      </div>
                                      <div className="flex justify-between font-bold mt-2">
                                        <span className="text-amber-700">🔴 SALDO PENDIENTE:</span>
                                        <span className={saldoCOP>0?'text-rose-600':'text-emerald-600'}>{formatCurrency(saldoCOP)}</span>
                                      </div>
                                      <div className="flex justify-between"><span>Saldo en USD:</span><span>${saldoUSD.toFixed(2)} USD</span></div>
                                      {saldoCOP>0 && <div className="mt-1 text-[10px] text-amber-700 text-center">⚠️ Pendiente de pago</div>}
                                      {saldoCOP<0 && <div className="mt-1 text-[10px] text-emerald-700 text-center">✓ Pagos superan el valor de compra. Saldo a favor</div>}
                                      {saldoCOP===0 && valorCOP>0 && <div className="mt-1 text-[10px] text-green-700 text-center">✓ Compra pagada en totalidad</div>}
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                            <div>
                              <label className="block text-[10px] font-black text-zinc-500 mb-1">🎨 Variables (color, talla, etc.)</label>
                              <div className="space-y-2">
                                {(p.variables || getInitialImport().variables).map(v => (
                                  <div key={v.id} className="flex gap-2 items-center">
                                    <input type="text" value={v.name || ''} onChange={(e) => updateVariable(p, v.id, 'name', e.target.value)} placeholder={`Variable ${v.id}`} className="flex-1 bg-white border border-zinc-200 rounded-xl p-2 text-sm" />
                                    <input type="number" value={v.qty || 0} onChange={(e) => updateVariable(p, v.id, 'qty', parseFloat(e.target.value) || 0)} placeholder="Cantidad" className="w-24 bg-white border border-zinc-200 rounded-xl p-2 text-sm" />
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div>
                              <label className="block text-[10px] font-black text-zinc-500 mb-1">🚢 Estado de Importación</label>
                              <div className="flex flex-wrap gap-2">
                                {Object.values(IMPORT_STATES_LIST).map(state => (
                                  <button key={state.id} onClick={() => updateDocField(p.id, 'importStatus', state.id)} className={`px-3 py-1.5 rounded-lg text-[9px] font-black transition-all ${p.importStatus === state.id ? 'bg-zinc-800 text-white shadow-md' : 'bg-white text-zinc-500 border border-zinc-200'}`}>
                                    {state.emoji} {state.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                      {isWinner && (
                        <div className="w-full xl:w-1/3 bg-[#fcfdfe] p-3 border-l">
                          <button onClick={()=>setExpandedItems({...expandedItems,[`u_${p.id}`]:!expandedItems[`u_${p.id}`]})} className={`w-full flex justify-between p-3 rounded-xl border-2 ${expandedItems[`u_${p.id}`]?'bg-zinc-900 text-white':'bg-white'}`}><span>🍱 Bundles ({mWinner.activeUpsells} Activos)</span><span>{expandedItems[`u_${p.id}`]?'▲':'▼'}</span></button>
                          {expandedItems[`u_${p.id}`] && <div className="mt-3 space-y-2">{(p.upsells||getInitialWinner().upsells).map(u=><div key={u.id} className="bg-white p-2 rounded-xl border flex gap-2"><div className="w-12 h-12 bg-zinc-100 rounded-lg relative"><input type="file" className="absolute inset-0 opacity-0" onChange={(e)=>handleImage(e,p.id,u.id)}/>{u.image?<img src={u.image} className="w-full h-full object-cover"/>:<span className="flex items-center justify-center h-full text-xs">+</span>}</div><div className="flex-1"><input value={u.name||''} onChange={(e)=>updateUpsell(p,u.id,'name',e.target.value)} placeholder="Nombre" className="w-full text-sm font-black border-b"/><div className="flex gap-2 mt-1"><input type="number" value={u.cost||0} onChange={(e)=>updateUpsell(p,u.id,'cost',parseFloat(e.target.value)||0)} placeholder="Costo" className="w-1/2 text-xs bg-zinc-50 rounded p-1"/><input type="number" value={u.price||0} onChange={(e)=>updateUpsell(p,u.id,'price',parseFloat(e.target.value)||0)} placeholder="Venta" className="w-1/2 text-xs bg-indigo-50 rounded p-1"/></div></div><button onClick={()=>resetUpsell(p,u.id)} className="text-zinc-300">✖</button></div>)}</div>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      {isCreating && activeModule !== 'projection' && activeModule !== 'agenda' && activeModule !== 'prompts' && activeModule !== 'digital' && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white p-4 border-b flex justify-between"><h2 className="font-black">Registro Cloud</h2><button onClick={()=>{setIsCreating(false); setFormError('');}}>✕</button></div>
            <div className="p-6">{renderCreationForm()}{formError && <div className="bg-rose-100 text-rose-700 p-3 rounded-xl mt-4 text-center text-sm">{formError}</div>}<button onClick={handleSave} disabled={isSaving} className="w-full mt-6 bg-zinc-900 text-white py-4 rounded-2xl font-black">{isSaving?'Guardando...':'Confirmar Registro'}</button></div>
          </div>
        </div>
      )}
        </main>
      </div>
    </div>
  );
}
