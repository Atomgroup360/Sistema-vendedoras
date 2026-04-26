// src/main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '../App';  // ← importante: App está en la raíz
import { AuthProvider } from './context/AuthContext';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
