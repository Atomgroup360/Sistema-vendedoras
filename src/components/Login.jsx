import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await login(email, password);
    } catch (err) {
      setError('Correo o contraseña incorrectos');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
      <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full">
        <h2 className="text-2xl font-black italic text-center mb-6">Winner System 360</h2>
        <p className="text-center text-sm text-slate-500 mb-6">Ingresa con tu cuenta</p>
        {error && <div className="bg-red-100 text-red-700 p-3 rounded-xl text-sm mb-4">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-xs font-black uppercase mb-1">Correo electrónico</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-slate-50 border-2 border-transparent focus:border-emerald-400 outline-none"
              required
            />
          </div>
          <div className="mb-6">
            <label className="block text-xs font-black uppercase mb-1">Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-slate-50 border-2 border-transparent focus:border-emerald-400 outline-none"
              required
            />
          </div>
          <button
            type="submit"
            className="w-full bg-emerald-500 text-zinc-950 py-3 rounded-xl font-black uppercase tracking-wider hover:bg-emerald-400"
          >
            Iniciar sesión
          </button>
        </form>
      </div>
    </div>
  );
}
