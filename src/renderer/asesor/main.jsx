import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import LoginPage from '../login/LoginPage';
import AsesorPanel from './AsesorPanel';

/**
 * Entry point del panel Asesor.
 * SPA routing: Login → AsesorPanel según autenticación.
 */
function App() {
  const [usuario, setUsuario] = useState(() => {
    try {
      const saved = localStorage.getItem('auth_user');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });

  function handleLogin(userData, token) {
    localStorage.setItem('auth_token', token);
    localStorage.setItem('auth_user', JSON.stringify(userData));
    setUsuario(userData);
  }

  async function handleLogout() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    await window.api.invoke('app:logout');
    setUsuario(null);
  }

  if (!usuario) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return <AsesorPanel usuario={usuario} onLogout={handleLogout} />;
}

const root = createRoot(document.getElementById('root'));
root.render(<App />);
