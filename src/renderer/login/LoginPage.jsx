import React, { useState } from 'react';
import Logo from '../shared/Logo';
import '../shared/theme.css';
import './LoginPage.css';

/**
 * LoginPage — Pantalla de autenticación.
 * Diseño basado en mockup de login del Desing.md.
 * Al autenticar, invoca callback con datos del usuario (id, nombre, rol).
 */
export default function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [serverIp, setServerIp] = useState(localStorage.getItem('uphone_ws_ip') || '192.168.1.173');

  function buildBaseUrl(ip) {
    if (ip.startsWith('http://') || ip.startsWith('https://')) {
      return ip.replace(/\/$/, '');
    }
    return `http://${ip}:3001`;
  }
  const [showAdvanced, setShowAdvanced] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email || !password) {
      setError('Completa todos los campos');
      return;
    }

    setLoading(true);
    setError('');

    try {
      let result = null;
      // Cambiamos la lógica: Si hay una IP configurada (incluso 127.0.0.1), usa la API remota (Postgres).
      // Solo usa SQLite local si el campo IP está vacío o dice "local".
      const isRemote = serverIp && serverIp.trim() !== '' && serverIp.trim().toLowerCase() !== 'local';

      // 1. Intentar vía HTTP/HTTPS si se ha configurado IP o URL de Supervisor
      if (isRemote) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 6000);

          const response = await fetch(`${buildBaseUrl(serverIp)}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          result = await response.json();
          
          if (result.error && !result.token) {
             setError(`Servidor (${serverIp}): ${result.error}`);
             setLoading(false);
             return;
          }
        } catch (fetchErr) {
          console.warn('[LOGIN] Error en login remoto:', fetchErr);
          setError(`No se pudo conectar al Supervisor en ${serverIp}. Verifique que el programa esté abierto en la otra PC y el Firewall permita el puerto 3001.`);
          setLoading(false);
          return;
        }
      }

      // 2. Si no es remoto o falló sin error de red, probar local (IPC)
      if (!result) {
        result = await window.api.invoke('auth:login', { email, password });
      }

      if (result?.usuario) {
        localStorage.setItem('auth_token', result.token);
        localStorage.setItem('auth_user', JSON.stringify(result.usuario));
        localStorage.setItem('uphone_ws_ip', serverIp); // Persistir la IP
        
        // Cambiar a la ventana del rol correspondiente
        await window.api.invoke('app:switch-role', result.usuario.rol);
        onLogin(result.usuario, result.token);
      } else {
        setError(result?.error || 'Credenciales inválidas');
      }
    } catch (err) {
      setError('Error inesperado: ' + err.message);
    } finally {
      setLoading(false);
    }
  }


  return (
    <div className="login-page">
      {/* Background decoration */}
      <div className="login-bg">
        <div className="login-bg__orb login-bg__orb--1" />
        <div className="login-bg__orb login-bg__orb--2" />
      </div>

      {/* Login Card */}
      <div className="login-card">
        {/* Brand */}
        <div className="login-card__brand">
          <div className="login-card__logo" style={{ background: 'transparent', display: 'flex', justifyContent: 'center' }}>
            <Logo width="220px" />
          </div>
          <p className="login-card__subtitle">CRM Marketing Uphone</p>
        </div>

        {/* Form */}
        <form className="login-form" onSubmit={handleSubmit}>
          {/* Email */}
          <div className="login-field">
            <span className="material-symbols-outlined login-field__icon">mail</span>
            <input
              id="login-email"
              className="login-field__input"
              type="email"
              placeholder="correo@uphone.local"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              disabled={loading}
            />
          </div>

          {/* Password */}
          <div className="login-field">
            <span className="material-symbols-outlined login-field__icon">lock</span>
            <input
              id="login-password"
              className="login-field__input"
              type={showPassword ? 'text' : 'password'}
              placeholder="Contraseña"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={loading}
            />
            <button
              type="button"
              className="login-field__toggle"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
            >
              <span className="material-symbols-outlined">
                {showPassword ? 'visibility_off' : 'visibility'}
              </span>
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="login-error">
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>error</span>
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            id="btn-login"
            className="btn btn-primary btn-lg login-submit"
            type="submit"
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="spinner" />
                Autenticando...
              </>
            ) : (
              <>
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>login</span>
                Iniciar Sesión
              </>
            )}
          </button>

          {/* Advanced / Server IP */}
          <div className="login-advanced">
            <button 
              type="button" 
              className="login-advanced__toggle"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <span className="material-symbols-outlined">
                {showAdvanced ? 'expand_less' : 'settings'}
              </span>
              {showAdvanced ? 'Ocultar ajustes de red' : 'Configurar IP del Servidor'}
            </button>

            {showAdvanced && (
              <div className="login-field login-field--advanced animate-fade-in" style={{marginBottom: '1rem'}}>
                <span className="material-symbols-outlined login-field__icon">lan</span>
                <input
                  className="login-field__input"
                  type="text"
                  placeholder="IP local (192.168.x.x) o URL (https://xxx.trycloudflare.com)"
                  value={serverIp}
                  onChange={e => setServerIp(e.target.value)}
                  disabled={loading}
                />
              </div>
            )}
            

          </div>
        </form>

        {/* Footer */}
        <div className="login-footer">
          <div className="dot dot-primary dot-pulse" />
          <span>Terminal Seguro · Encriptación AES-256</span>
        </div>
      </div>
    </div>
  );
}
