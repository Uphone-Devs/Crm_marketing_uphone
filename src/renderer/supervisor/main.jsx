import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import LoginPage from '../login/LoginPage';
import JefePanel from './JefePanel';

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('[ErrorBoundary]', error, info.componentStack); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100vh', background:'#0d1117', color:'#e3e3e3', gap:16, padding:24 }}>
          <span className="material-symbols-outlined" style={{ fontSize:64, color:'#ff5252' }}>error</span>
          <h2 style={{ margin:0 }}>Error inesperado</h2>
          <p style={{ color:'#888', textAlign:'center', maxWidth:400 }}>{this.state.error?.message || 'Algo salió mal. La operación puede haber sido guardada.'}</p>
          <button onClick={() => this.setState({ error: null })} style={{ padding:'10px 24px', borderRadius:8, border:'none', background:'#00c853', color:'#000', fontWeight:700, cursor:'pointer', fontSize:14 }}>
            Reintentar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Entry point del panel Jefe de Área / Jefa de Cobranza.
 * SPA routing: Login → JefePanel según autenticación.
 */
function App() {
  const [usuario, setUsuario] = useState(() => {
    try {
      const saved = localStorage.getItem('auth_user:v1');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });

  function handleLogin(userData, token) {
    localStorage.setItem('auth_token', token);
    localStorage.setItem('auth_user:v1', JSON.stringify(userData));
    setUsuario(userData);
  }

  async function handleLogout() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user:v1');
    await window.api.invoke('app:logout');
    setUsuario(null);
  }

  if (!usuario) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return <JefePanel usuario={usuario} onLogout={handleLogout} />;
}

const root = createRoot(document.getElementById('root'));
root.render(<ErrorBoundary><App /></ErrorBoundary>);
