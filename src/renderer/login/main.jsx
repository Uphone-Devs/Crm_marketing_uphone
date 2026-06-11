import React from 'react';
import { createRoot } from 'react-dom/client';
import LoginPage from './LoginPage';

/**
 * Entry point dedicado para la ventana de Login.
 * Este punto de entrada es neutral y profesional.
 */
function App() {
  function handleLogin(userData, token) {
    // La redirección real la hace LoginPage.jsx invocando 'app:switch-role'
    console.log('[LOGIN] Sesión iniciada para:', userData.nombre);
  }

  return <LoginPage onLogin={handleLogin} />;
}

const root = createRoot(document.getElementById('root'));
root.render(<App />);
