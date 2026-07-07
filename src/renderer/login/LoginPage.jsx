import React, { useState } from 'react';
import '../shared/theme.css';
import './LoginPage.css';

function buildBaseUrl(ip) {
  if (ip.startsWith('http://') || ip.startsWith('https://')) {
    return ip.replace(/\/$/, '');
  }
  return `http://${ip}:3001`;
}

export default function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [serverIp, setServerIp] = useState(localStorage.getItem('uphone_ws_ip') || '192.168.1.192');
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
      const isRemote = serverIp && serverIp.trim() !== '' && serverIp.trim().toLowerCase() !== 'local';

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
          setError(`No se pudo conectar al servidor en ${serverIp}. Verifique que el programa esté abierto en la otra PC y el Firewall permita el puerto 3001.`);
          setLoading(false);
          return;
        }
      }

      if (!result) {
        result = await window.api.invoke('auth:login', { email, password });
      }

      if (result?.usuario) {
        localStorage.setItem('auth_token', result.token);
        localStorage.setItem('auth_user:v1', JSON.stringify(result.usuario));
        localStorage.setItem('uphone_ws_ip', serverIp);
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
      {/* Fondo animado */}
      <div className="login-bg">
        <div className="login-bg__orb login-bg__orb--1" />
        <div className="login-bg__orb login-bg__orb--2" />
        <div className="login-bg__orb login-bg__orb--3" />
      </div>

      {/* Card */}
      <div className="login-card">

        {/* Logo + Marca */}
        <div className="login-logo-wrap">
          <div className="login-logo-badge">
            <span className="login-logo-badge__letter">U</span>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="login-brand-name">U<span>PHONE</span></div>
            <div className="login-brand-sub">CRM · Terminal de Cobranza</div>
          </div>
        </div>

        {/* Separador */}
        <div className="login-divider">
          <span className="login-divider__label">Ingresa tus credenciales</span>
        </div>

        {/* Formulario */}
        <form className="login-form" onSubmit={handleSubmit}>

          {/* Email */}
          <div className="login-field">
            <span className="material-symbols-outlined login-field__icon">mail</span>
            <input
              className="login-field__input"
              type="email"
              placeholder="correo@uphone.local"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              disabled={loading}
            />
          </div>

          {/* Contraseña */}
          <div className="login-field">
            <span className="material-symbols-outlined login-field__icon">lock</span>
            <input
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
            <div className="login-error animate-fade-in">
              <span className="material-symbols-outlined">error</span>
              {error}
            </div>
          )}

          {/* Botón */}
          <button
            id="btn-login"
            className="login-submit"
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
                <span className="material-symbols-outlined">login</span>
                Iniciar Sesión
              </>
            )}
          </button>

          {/* IP del servidor */}
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
              <div className="login-field login-field--advanced animate-fade-in">
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
          <div className="login-footer-dot" />
          <span>Terminal Seguro · Encriptación AES-256</span>
        </div>
      </div>
    </div>
  );
}
