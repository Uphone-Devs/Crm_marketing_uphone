import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import './AdminPanel.css';

// ── Helpers ─────────────────────────────────────────────────────

const fmt = (bytes) => {
  if (!bytes) return '0 MB';
  const gb = bytes / 1024 / 1024 / 1024;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1024 / 1024).toFixed(0)} MB`;
};

const fmtMoney = (n) =>
  (n || 0).toLocaleString('es-EC', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const fmtUptime = ({ hours = 0, minutes = 0 } = {}) => `${hours}h ${minutes}m`;

const IS_VM = (cfg) => cfg?.mode === 'vm' && cfg?.vmUrl;

// ── vmApiFetch — fetch hacia el REST API de la VM ───────────────

async function vmApiFetch(vmUrl, vmToken, path, options = {}) {
  const base = (vmUrl || '').replace(/\/$/, '');
  const res  = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(vmToken ? { Authorization: `Bearer ${vmToken}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Sub-componentes ──────────────────────────────────────────────

function GaugeCircle({ percent = 0, label, color = '#00e676', size = 110 }) {
  const r    = (size / 2) - 12;
  const circ = 2 * Math.PI * r;
  const off  = circ - (Math.min(percent, 100) / 100) * circ;
  const cx   = size / 2;
  const cy   = size / 2;
  return (
    <div className="gauge-wrap">
      <svg width={size} height={size}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#2a2a2a" strokeWidth="9" />
        <circle
          cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="9"
          strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
        <text x={cx} y={cy + 6} textAnchor="middle" fill="#fff" fontSize="20" fontWeight="700">{percent}</text>
        <text x={cx} y={cy + 20} textAnchor="middle" fill="#666" fontSize="9">%</text>
      </svg>
      <span className="gauge-label">{label}</span>
    </div>
  );
}

function StatusBadge({ status }) {
  const ok = status === true || status === 'RUNNING';
  return <span className={`status-badge ${ok ? 'status-badge--ok' : 'status-badge--err'}`}>{ok ? 'RUNNING' : 'STOPPED'}</span>;
}

function ModeBadge({ mode }) {
  return (
    <span className={`mode-badge mode-badge--${mode}`}>
      <span className="material-icons" style={{ fontSize: 12 }}>{mode === 'vm' ? 'cloud' : 'storage'}</span>
      {mode === 'vm' ? 'VM / PostgreSQL' : 'Local SQLite'}
    </span>
  );
}

function Card({ title, onRefresh, children, className = '' }) {
  return (
    <div className={`admin-card ${className}`}>
      <div className="admin-card__header">
        <span className="admin-card__title">{title}</span>
        {onRefresh && (
          <button className="admin-card__refresh" onClick={onRefresh} title="Actualizar">
            <span className="material-icons" style={{ fontSize: 16 }}>refresh</span>
          </button>
        )}
      </div>
      <div className="admin-card__body">{children}</div>
    </div>
  );
}

function VmOnlyPlaceholder({ label = 'Datos disponibles en modo VM' }) {
  return (
    <div className="vm-placeholder">
      <span className="material-icons">cloud_off</span>
      <span>{label}</span>
    </div>
  );
}

// ── PageDashboard ────────────────────────────────────────────────

function MetaMensualCard() {
  const [meta, setMeta] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (window.api) {
      window.api.invoke('db:getAllConfig').then(configs => {
        if (configs && configs.meta_mensual_usd) setMeta(configs.meta_mensual_usd);
      });
    }
  }, []);

  const handleSave = async () => {
    if (isNaN(meta) || meta === '') return;
    setSaving(true);
    if (window.api) {
      await window.api.invoke('db:setConfig', 'meta_mensual_usd', String(meta));
      alert('Meta mensual guardada exitosamente.');
    }
    setSaving(false);
  };

  return (
    <Card title="Meta Mensual de Cobranza (USD)">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <input type="number" className="input" value={meta} onChange={e => setMeta(e.target.value)} style={{ width: '150px' }} />
        <button className="btn btn--outline" onClick={handleSave} disabled={saving}>{saving ? 'Guardando...' : 'Fijar Meta'}</button>
      </div>
      <p style={{ fontSize: 12, color: '#7f8c8d', marginTop: 8 }}>Usado en el Dashboard Directivo para proyecciones.</p>
    </Card>
  );
}

function PageDashboard({ sysInfo, cpuHistory, connUsers, globalMetrics, dbConfig, reload }) {
  const procs = sysInfo?.processes || {};
  const processList = [
    { label: 'Express API Server', key: 'express',   icon: 'dns'        },
    { label: 'WebSocket Server',   key: 'websocket', icon: 'sync_alt'   },
    { label: 'ADB / Android',      key: 'adb',       icon: 'smartphone' },
    { label: 'SQLite Database',    key: 'sqlite',    icon: 'storage'    },
  ];
  const supervisores = (connUsers || []).filter(u => u.tipo === 'SUPERVISOR');
  const asesores     = (connUsers || []).filter(u => u.tipo === 'ASESOR');

  return (
    <div className="page-grid">
      <MetaMensualCard />
      {/* System Resources */}
      <Card title="Recursos del Sistema" onRefresh={() => reload('sys')} className="card--wide">
        <div className="sys-resources">
          <div className="gauges-row">
            <GaugeCircle percent={sysInfo?.cpu?.percent  ?? 0} label="CPU"   color="#00e676" />
            <GaugeCircle percent={sysInfo?.ram?.percent  ?? 0} label="RAM"   color="#40c4ff" />
            <GaugeCircle percent={sysInfo?.disk?.percent ?? 0} label="DISCO" color="#ffd740" />
          </div>
          <div className="sys-info-table">
            <div className="sys-info-row"><span>CPU</span><span>{sysInfo?.cpu?.model ?? '—'} · {sysInfo?.cpu?.cores ?? 0} núcleos</span></div>
            {!IS_VM(dbConfig) && <div className="sys-info-row"><span>Velocidad</span><span>{sysInfo?.cpu?.speed ?? 0} MHz</span></div>}
            <div className="sys-info-row"><span>RAM Total</span><span>{fmt(sysInfo?.ram?.total)} · Usado {fmt(sysInfo?.ram?.used)}</span></div>
            {!IS_VM(dbConfig) && <div className="sys-info-row"><span>Disco</span><span>Total {fmt(sysInfo?.disk?.total)} · Libre {fmt(sysInfo?.disk?.free)}</span></div>}
            <div className="sys-info-row"><span>Uptime</span><span>{fmtUptime(sysInfo?.uptime)}</span></div>
            <div className="sys-info-row"><span>Hostname</span><span>{sysInfo?.hostname ?? '—'}</span></div>
          </div>
        </div>
      </Card>

      {/* Processes */}
      <Card title="Estado de Procesos" onRefresh={() => reload('sys')}>
        <div className="process-list">
          {processList.map(p => (
            <div key={p.key} className="process-row">
              <span className="material-icons process-icon">{p.icon}</span>
              <span className="process-label">{p.label}</span>
              <StatusBadge status={IS_VM(dbConfig) ? true : procs[p.key]} />
            </div>
          ))}
        </div>
      </Card>

      {/* Performance Graph */}
      <Card title="Rendimiento CPU — últimos 60 seg" onRefresh={() => reload('sys')} className="card--wide">
        <ResponsiveContainer minWidth={1} minHeight={1} width="100%" height={160}>
          <AreaChart data={cpuHistory} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#00e676" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#00e676" stopOpacity={0}   />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#222" strokeDasharray="3 3" />
            <XAxis dataKey="t" tick={{ fill: '#555', fontSize: 10 }} />
            <YAxis domain={[0, 100]} tick={{ fill: '#555', fontSize: 10 }} />
            <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333', fontSize: 12 }} formatter={v => [`${v}%`, 'CPU']} />
            <Area type="monotone" dataKey="v" stroke="#00e676" fill="url(#cpuGrad)" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      {/* Usuarios Conectados — resumen */}
      <Card title="Usuarios Conectados" onRefresh={() => reload('users')}>
        <>
          <div className="conn-summary">
            <div className="conn-chip conn-chip--sup">
              <span className="material-icons">supervisor_account</span>
              <div><div className="conn-chip__count">{supervisores.length}</div><div className="conn-chip__label">Supervisores</div></div>
            </div>
            <div className="conn-chip conn-chip--ase">
              <span className="material-icons">headset_mic</span>
              <div><div className="conn-chip__count">{asesores.length}</div><div className="conn-chip__label">Asesores</div></div>
            </div>
          </div>
          <div className="conn-mini-list">
            {(connUsers || []).slice(0, 6).map((u, i) => (
              <div key={i} className="conn-mini-row">
                <span className={`conn-dot conn-dot--${u.tipo === 'SUPERVISOR' ? 'sup' : 'ase'}`} />
                <span className="conn-mini-name">{u.nombre}</span>
                <span className="conn-mini-tipo">{u.tipo}</span>
                {u.metricas && <span className="conn-mini-metric">{u.metricas.marcaciones ?? 0} marc.</span>}
              </div>
            ))}
            {(connUsers || []).length === 0 && <div className="empty-state">Sin usuarios conectados</div>}
          </div>
        </>
      </Card>

      {/* Resumen Global */}
      <Card title="Resumen Operativo del Día" onRefresh={() => reload('metrics')}>
        {globalMetrics ? (
          <div className="global-kpis">
            <div className="kpi-item">
              <span className="material-icons kpi-icon" style={{ color: '#00e676' }}>call</span>
              <div className="kpi-val">{globalMetrics.totalMarcaciones ?? 0}</div>
              <div className="kpi-key">Marcaciones</div>
            </div>
            <div className="kpi-item">
              <span className="material-icons kpi-icon" style={{ color: '#ffd740' }}>handshake</span>
              <div className="kpi-val">{globalMetrics.totalCompromisos ?? 0}</div>
              <div className="kpi-key">Compromisos</div>
            </div>
            <div className="kpi-item">
              <span className="material-icons kpi-icon" style={{ color: '#40c4ff' }}>attach_money</span>
              <div className="kpi-val">{fmtMoney(globalMetrics.moraBaseTotal)}</div>
              <div className="kpi-key">Mora Base</div>
            </div>
            <div className="kpi-item">
              <span className="material-icons kpi-icon" style={{ color: '#ea80fc' }}>people</span>
              <div className="kpi-val">{globalMetrics.totalConectados ?? 0}</div>
              <div className="kpi-key">Asesores Activos</div>
            </div>
          </div>
        ) : (
          <div className="empty-state">Sin datos disponibles</div>
        )}
      </Card>
    </div>
  );
}

// ── PageConectados ───────────────────────────────────────────────

function PageConectados({ connUsers, dbConfig, reload }) {
  const supervisores = (connUsers || []).filter(u => u.tipo === 'SUPERVISOR');
  const asesores     = (connUsers || []).filter(u => u.tipo === 'ASESOR');

  return (
    <div className="page-grid">
      <Card title={`Supervisores Conectados (${supervisores.length})`} onRefresh={() => reload('users')} className="card--full">
        <table className="admin-table">
          <thead><tr><th>Nombre</th><th>Estado WS</th></tr></thead>
          <tbody>
            {supervisores.length === 0 && <tr><td colSpan={2} className="empty-td">Sin supervisores conectados</td></tr>}
            {supervisores.map((u, i) => (
              <tr key={i}>
                <td><span className="material-icons" style={{ fontSize: 14, color: '#40c4ff', verticalAlign: 'middle', marginRight: 6 }}>supervisor_account</span>{u.nombre}</td>
                <td><span className="status-badge status-badge--ok">ONLINE</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title={`Asesores Conectados (${asesores.length})`} onRefresh={() => reload('users')} className="card--full">
        <table className="admin-table">
          <thead>
            <tr><th>Nombre</th><th>Estado</th><th>Marcaciones</th><th>Gestiones</th><th>Compromisos</th><th>T. Productivo</th></tr>
          </thead>
          <tbody>
            {asesores.length === 0 && <tr><td colSpan={6} className="empty-td">Sin asesores conectados</td></tr>}
            {asesores.map((u, i) => {
              const m = u.metricas || {};
              const e = u.estado   || {};
              return (
                <tr key={i}>
                  <td><span className="material-icons" style={{ fontSize: 14, color: '#00e676', verticalAlign: 'middle', marginRight: 6 }}>headset_mic</span>{u.nombre}</td>
                  <td><span className="estado-badge">{e.nombre_estado || 'Conectado'}</span></td>
                  <td className="td-num">{m.marcaciones ?? 0}</td>
                  <td className="td-num">{m.total_gestiones ?? 0}</td>
                  <td className="td-num">{m.total_compromisos ?? 0}</td>
                  <td className="td-num">{m.tiempo_productivo ? `${Math.floor(m.tiempo_productivo / 60)}m` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ── PageUsuarios ─────────────────────────────────────────────────

function PageUsuarios({ users, dbConfig, reload }) {
  const [modal,   setModal]   = useState(null);
  const [form,    setForm]    = useState({ nombre: '', email: '', password: '', rol: 'asesor' });
  const [pwModal, setPwModal] = useState(null);
  const [newPw,   setNewPw]   = useState('');
  const [saving,  setSaving]  = useState(false);
  const [msg,     setMsg]     = useState('');

  const ROL_COLORS = { admin: '#ea80fc', supervisor: '#40c4ff', jefe_area: '#ffab40', asesor: '#00e676' };

  // Decide si usar IPC o REST según modo
  async function apiCall(ipcChannel, ipcArgs, restMethod, restPath, restBody) {
    if (IS_VM(dbConfig)) {
      const base = dbConfig.vmUrl.replace(/\/$/, '');
      const res  = await fetch(`${base}${restPath}`, {
        method: restMethod,
        headers: {
          'Content-Type': 'application/json',
          ...(dbConfig.vmToken ? { Authorization: `Bearer ${dbConfig.vmToken}` } : {}),
        },
        ...(restBody ? { body: JSON.stringify(restBody) } : {}),
      });
      return res.json();
    } else {
      return window.api.invoke(ipcChannel, ipcArgs);
    }
  }

  async function handleSave() {
    setSaving(true);
    let res;
    if (modal === 'create') {
      res = await apiCall('admin:createUser', form, 'POST', '/api/admin/users', form);
    } else {
      res = await apiCall('admin:updateUser', form, 'PUT', `/api/admin/users/${form.id}`, form);
    }
    setSaving(false);
    if (res?.error) { setMsg(`Error: ${res.error}`); return; }
    setMsg(''); setModal(null); reload('userList');
  }

  async function handleToggle(u) {
    const res = await apiCall('admin:toggleUser', u.id, 'POST', `/api/admin/users/${u.id}/toggle`);
    if (res?.error) { setMsg(`Error: ${res.error}`); return; }
    reload('userList');
  }

  async function handlePwSave() {
    if (!newPw || newPw.length < 6) { setMsg('Mínimo 6 caracteres'); return; }
    setSaving(true);
    const res = await apiCall(
      'admin:changePassword', { id: pwModal.id, password: newPw },
      'POST', `/api/admin/users/${pwModal.id}/password`, { password: newPw }
    );
    setSaving(false);
    if (res?.error) { setMsg(`Error: ${res.error}`); return; }
    setMsg(''); setPwModal(null); setNewPw('');
  }

  return (
    <div className="page-grid">
      <Card title={`Gestión de Usuarios ${IS_VM(dbConfig) ? '— VM / PostgreSQL' : '— Local SQLite'}`} onRefresh={() => reload('userList')} className="card--full">
        <div className="users-toolbar">
          <button className="btn btn--primary" onClick={() => { setForm({ nombre: '', email: '', password: '', rol: 'asesor', supervisor_id: null }); setMsg(''); setModal('create'); }}>
            <span className="material-icons" style={{ fontSize: 16 }}>person_add</span>
            Nuevo Usuario
          </button>
          {msg && <span className="toolbar-msg toolbar-msg--err">{msg}</span>}
          {IS_VM(dbConfig) && <span className="toolbar-vm-note"><span className="material-icons" style={{ fontSize: 13 }}>cloud</span>Operando en VM: {dbConfig.vmUrl}</span>}
        </div>
        <table className="admin-table">
          <thead>
            <tr><th>#</th><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th><th>Creado</th><th>Acciones</th></tr>
          </thead>
          <tbody>
            {(users || []).map(u => (
              <tr key={u.id} className={u.estado === 'inactivo' ? 'row--inactive' : ''}>
                <td className="td-num">{u.id}</td>
                <td>{u.nombre}</td>
                <td className="td-email">{u.email}</td>
                <td><span className="rol-badge" style={{ color: ROL_COLORS[u.rol] || '#aaa' }}>{u.rol}</span></td>
                <td><span className={`status-badge ${u.estado === 'activo' ? 'status-badge--ok' : 'status-badge--off'}`}>{u.estado}</span></td>
                <td className="td-date">{u.creado_en?.slice(0, 10) || '—'}</td>
                <td>
                  <div className="action-btns">
                    <button className="btn-icon" title="Editar" onClick={() => { setForm({ id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, estado: u.estado, supervisor_id: u.supervisor_id ?? null }); setMsg(''); setModal('edit'); }}>
                      <span className="material-icons">edit</span>
                    </button>
                    <button className="btn-icon" title="Cambiar contraseña" onClick={() => { setPwModal(u); setNewPw(''); setMsg(''); }}>
                      <span className="material-icons">lock_reset</span>
                    </button>
                    <button className={`btn-icon ${u.estado === 'activo' ? 'btn-icon--warn' : 'btn-icon--ok'}`} title={u.estado === 'activo' ? 'Desactivar' : 'Activar'} onClick={() => handleToggle(u)}>
                      <span className="material-icons">{u.estado === 'activo' ? 'block' : 'check_circle'}</span>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {(users || []).length === 0 && <tr><td colSpan={7} className="empty-td">Sin usuarios</td></tr>}
          </tbody>
        </table>
      </Card>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>{modal === 'create' ? 'Nuevo Usuario' : 'Editar Usuario'}</span>
              <button className="btn-icon" onClick={() => setModal(null)}><span className="material-icons">close</span></button>
            </div>
            <div className="modal-body">
              {msg && <div className="modal-err">{msg}</div>}
              <label>Nombre<input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} /></label>
              <label>Email<input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></label>
              {modal === 'create' && <label>Contraseña<input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} /></label>}
              <label>Rol
                <select value={form.rol} onChange={e => setForm(f => ({ ...f, rol: e.target.value }))}>
                  <option value="asesor">Asesor</option>
                  <option value="jefe_area">Jefe de Área</option>
                  <option value="supervisor">Supervisor</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              {form.rol === 'asesor' && (
                <label>Jefe / Supervisor (equipo)
                  <select
                    value={form.supervisor_id ?? ''}
                    onChange={e => setForm(f => ({ ...f, supervisor_id: e.target.value ? Number(e.target.value) : null }))}
                  >
                    <option value="">— Sin asignar —</option>
                    {(users || []).filter(u => u.rol === 'supervisor' || u.rol === 'jefe_area').map(s => (
                      <option key={s.id} value={s.id}>{s.nombre} ({s.rol})</option>
                    ))}
                  </select>
                </label>
              )}
              {modal === 'edit' && (
                <label>Estado
                  <select value={form.estado} onChange={e => setForm(f => ({ ...f, estado: e.target.value }))}>
                    <option value="activo">Activo</option>
                    <option value="inactivo">Inactivo</option>
                  </select>
                </label>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn--ghost" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn btn--primary" onClick={handleSave} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </div>
        </div>
      )}

      {pwModal && (
        <div className="modal-overlay" onClick={() => setPwModal(null)}>
          <div className="modal-box modal-box--sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>Cambiar Contraseña — {pwModal.nombre}</span>
              <button className="btn-icon" onClick={() => setPwModal(null)}><span className="material-icons">close</span></button>
            </div>
            <div className="modal-body">
              {msg && <div className="modal-err">{msg}</div>}
              <label>Nueva Contraseña<input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} autoFocus /></label>
            </div>
            <div className="modal-footer">
              <button className="btn btn--ghost" onClick={() => setPwModal(null)}>Cancelar</button>
              <button className="btn btn--primary" onClick={handlePwSave} disabled={saving}>{saving ? 'Guardando…' : 'Cambiar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── PageConexion — configuración de BD dual-mode ────────────────

function PageConexion({ dbConfig, onConfigChange }) {
  const [mode,      setMode]      = useState(dbConfig.mode     || 'local');
  const [vmUrl,     setVmUrl]     = useState(dbConfig.vmUrl    || '');
  const [vmToken,   setVmToken]   = useState(dbConfig.vmToken  || '');
  const [pgString,  setPgString]  = useState(dbConfig.pgString || '');
  const [vmEmail,   setVmEmail]   = useState('');
  const [vmPw,      setVmPw]      = useState('');
  const [testResult, setTestResult] = useState(null);
  const [testing,   setTesting]   = useState(false);
  const [logging,   setLogging]   = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [msg,       setMsg]       = useState('');

  // Sync cuando llega nueva config desde fuera
  useEffect(() => {
    setMode(dbConfig.mode     || 'local');
    setVmUrl(dbConfig.vmUrl   || '');
    setVmToken(dbConfig.vmToken || '');
    setPgString(dbConfig.pgString || '');
  }, [dbConfig]);

  async function handleTest() {
    if (!vmUrl) { setMsg('Ingresa la URL del servidor VM'); return; }
    setTesting(true); setTestResult(null); setMsg('');
    const res = await window.api.invoke('admin:testVmConnection', { vmUrl, vmToken });
    setTesting(false);
    setTestResult(res);
  }

  async function handleVmLogin() {
    if (!vmUrl || !vmEmail || !vmPw) { setMsg('Completa URL, email y contraseña de la VM'); return; }
    setLogging(true); setMsg('');
    const res = await window.api.invoke('admin:vmLogin', { vmUrl, email: vmEmail, password: vmPw });
    setLogging(false);
    if (res?.ok && res.token) {
      setVmToken(res.token);
      setMsg('');
      setTestResult({ ok: true, status: 200, ms: 0, body: `Token obtenido para: ${res.usuario?.nombre || vmEmail}` });
    } else {
      setMsg(`Login fallido: ${res?.error || 'Error desconocido'}`);
    }
  }

  async function handleSave() {
    setSaving(true); setMsg('');
    const res = await window.api.invoke('admin:setDbConfig', { mode, vmUrl, vmToken, pgString });
    setSaving(false);
    if (res?.error) { setMsg(`Error al guardar: ${res.error}`); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    onConfigChange({ mode, vmUrl, vmToken, pgString });
  }

  return (
    <div className="page-grid">
      {/* Selector de modo */}
      <Card title="Modo de Conexión" className="card--full">
        <div className="conn-mode-selector">
          <div
            className={`conn-mode-card ${mode === 'local' ? 'conn-mode-card--active' : ''}`}
            onClick={() => setMode('local')}
          >
            <div className="conn-mode-icon conn-mode-icon--local">
              <span className="material-icons">storage</span>
            </div>
            <div className="conn-mode-info">
              <div className="conn-mode-title">Local LAN — SQLite</div>
              <div className="conn-mode-desc">Datos desde la base de datos local (better-sqlite3). Funciona sin internet. Ideal para uso en oficina / red LAN.</div>
              <div className="conn-mode-tech">
                <span className="tech-chip tech-chip--green">better-sqlite3</span>
                <span className="tech-chip tech-chip--blue">IPC / Electron</span>
                <span className="tech-chip">LAN / Localhost</span>
              </div>
            </div>
            <div className="conn-mode-radio">
              <div className={`radio-dot ${mode === 'local' ? 'radio-dot--active' : ''}`} />
            </div>
          </div>

          <div
            className={`conn-mode-card ${mode === 'vm' ? 'conn-mode-card--active conn-mode-card--vm' : ''}`}
            onClick={() => setMode('vm')}
          >
            <div className="conn-mode-icon conn-mode-icon--vm">
              <span className="material-icons">cloud</span>
            </div>
            <div className="conn-mode-info">
              <div className="conn-mode-title">Servidor VM — SQLite Centralizado</div>
              <div className="conn-mode-desc">Datos desde el servidor remoto vía REST API. VM centraliza la BD — todos los asesores comparten los mismos datos. PostgreSQL disponible en Fase 2.</div>
              <div className="conn-mode-tech">
                <span className="tech-chip tech-chip--green">SQLite WAL</span>
                <span className="tech-chip tech-chip--blue">REST / JWT</span>
                <span className="tech-chip tech-chip--orange">Azure VM</span>
                <span className="tech-chip">Fase 2: PostgreSQL</span>
              </div>
            </div>
            <div className="conn-mode-radio">
              <div className={`radio-dot ${mode === 'vm' ? 'radio-dot--active' : ''}`} />
            </div>
          </div>
        </div>
      </Card>

      {/* Configuración Local */}
      {mode === 'local' && (
        <Card title="Configuración Local" className="card--full">
          <div className="local-info">
            <div className="local-info-row">
              <span className="material-icons" style={{ color: '#00e676' }}>check_circle</span>
              <span>Motor: <strong>better-sqlite3</strong> (WAL mode, sincrónico)</span>
            </div>
            <div className="local-info-row">
              <span className="material-icons" style={{ color: '#40c4ff' }}>folder</span>
              <span>DB Path: <code>%APPDATA%\terminal-cobranza\terminal.db</code></span>
            </div>
            <div className="local-info-row">
              <span className="material-icons" style={{ color: '#ffd740' }}>info</span>
              <span>No requiere configuración adicional. La BD se inicializa automáticamente al arrancar la app.</span>
            </div>
            <div className="local-info-row">
              <span className="material-icons" style={{ color: '#ea80fc' }}>schedule</span>
              <span>Migraciones: M-001 â†’ M-041 aplicadas automáticamente.</span>
            </div>
          </div>
        </Card>
      )}

      {/* Configuración VM */}
      {mode === 'vm' && (
        <>
          <Card title="Conexión al Servidor VM" className="card--full">
            <div className="vm-form">
              <div className="vm-form-section">
                <div className="vm-form-section-title">Servidor Express / REST API</div>
                <label className="form-label">
                  URL del Servidor VM
                  <div className="input-with-hint">
                    <input
                      value={vmUrl}
                      onChange={e => setVmUrl(e.target.value)}
                      placeholder="https://cobranza.midominio.com  ó  http://10.20.1.4:3001"
                    />
                    <span className="input-hint">Puerto 3001 por defecto</span>
                  </div>
                </label>
                <label className="form-label">
                  Token JWT de Acceso
                  <div className="input-row">
                    <input
                      value={vmToken}
                      onChange={e => setVmToken(e.target.value)}
                      placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                      className="input-mono"
                    />
                  </div>
                </label>
                <div className="vm-form-actions">
                  <button className="btn btn--outline" onClick={handleTest} disabled={testing}>
                    <span className="material-icons" style={{ fontSize: 15 }}>{testing ? 'hourglass_empty' : 'wifi_tethering'}</span>
                    {testing ? 'Probando…' : 'Test Conexión'}
                  </button>
                  {testResult && (
                    <div className={`test-result ${testResult.ok ? 'test-result--ok' : 'test-result--err'}`}>
                      <span className="material-icons">{testResult.ok ? 'check_circle' : 'error'}</span>
                      {testResult.ok
                        ? `VM online — HTTP ${testResult.status} · ${testResult.ms}ms`
                        : `Sin conexión — ${testResult.error || `HTTP ${testResult.status}`}`
                      }
                    </div>
                  )}
                </div>
              </div>

              <div className="vm-form-divider" />

              <div className="vm-form-section">
                <div className="vm-form-section-title">Obtener Token — Login en VM</div>
                <div className="vm-login-form">
                  <label className="form-label">
                    Email admin en VM
                    <input type="email" value={vmEmail} onChange={e => setVmEmail(e.target.value)} placeholder="admin@sistema.local" />
                  </label>
                  <label className="form-label">
                    Contraseña
                    <input type="password" value={vmPw} onChange={e => setVmPw(e.target.value)} placeholder="••••••••" />
                  </label>
                  <button className="btn btn--primary" onClick={handleVmLogin} disabled={logging}>
                    <span className="material-icons" style={{ fontSize: 15 }}>login</span>
                    {logging ? 'Conectando…' : 'Conectar y obtener token'}
                  </button>
                </div>
              </div>
            </div>
          </Card>

          <Card title="PostgreSQL + Prisma — Activo" className="card--full">
            <div className="vm-form">
              <div className="vm-form-section">
                <div className="vm-form-section-title">Connection String (se conecta en el servidor VM)</div>
                <label className="form-label">
                  DATABASE_URL
                  <input
                    value={pgString}
                    onChange={e => setPgString(e.target.value)}
                    placeholder="postgresql://usuario:contraseña@vm-host:5432/crm_marketing"
                    className="input-mono"
                  />
                  <span className="input-hint-block">
                    La conexión Prisma/PostgreSQL ocurre en el servidor VM.
                    Configura <code>DATABASE_URL</code> en el <code>.env</code> del backend. Schema sincronizado hasta M-041.
                  </span>
                </label>
                <div className="prisma-info-chips">
                  <div className="prisma-chip">
                    <span className="material-icons" style={{ fontSize: 14 }}>check_circle</span>
                    Estado: Operativo
                  </div>
                  <div className="prisma-chip">
                    <span className="material-icons" style={{ fontSize: 14 }}>account_tree</span>
                    ORM: Prisma Client v7
                  </div>
                  <div className="prisma-chip">
                    <span className="material-icons" style={{ fontSize: 14 }}>storage</span>
                    Motor: PostgreSQL 18.4
                  </div>
                  <div className="prisma-chip">
                    <span className="material-icons" style={{ fontSize: 14 }}>swap_horiz</span>
                    API: REST / JSON — misma interfaz que modo local
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </>
      )}

      {/* Save */}
      <Card title="Aplicar Configuración" className="card--full">
        {msg && <div className="modal-err" style={{ marginBottom: 12 }}>{msg}</div>}
        <div className="save-row">
          <button className="btn btn--primary btn--lg" onClick={handleSave} disabled={saving}>
            <span className="material-icons">{saving ? 'hourglass_empty' : saved ? 'check' : 'save'}</span>
            {saving ? 'Guardando…' : saved ? '¡Guardado!' : 'Guardar y Aplicar'}
          </button>
          <div className="save-note">
            <span className="material-icons" style={{ fontSize: 14, color: '#ffd740' }}>warning</span>
            Al cambiar de modo, los datos del dashboard se actualizarán automáticamente desde la fuente seleccionada.
          </div>
        </div>
      </Card>
    </div>
  );
}

// ── PageSistema ──────────────────────────────────────────────────

function PageSistema({ sysInfo, dbConfig, reload }) {
  return (
    <div className="page-grid">
      <Card title="CPU" onRefresh={() => reload('sys')}>
        <div className="sys-detail">
          <div className="sys-detail-row"><span>Modelo</span><span>{sysInfo?.cpu?.model || '—'}</span></div>
          <div className="sys-detail-row"><span>Núcleos</span><span>{sysInfo?.cpu?.cores || 0}</span></div>
          {!IS_VM(dbConfig) && <div className="sys-detail-row"><span>Velocidad</span><span>{sysInfo?.cpu?.speed || 0} MHz</span></div>}
          <div className="sys-detail-row"><span>Uso actual</span><span>{sysInfo?.cpu?.percent || 0}%</span></div>
        </div>
      </Card>
      <Card title="Memoria RAM" onRefresh={() => reload('sys')}>
        <div className="sys-detail">
          <div className="sys-detail-row"><span>Total</span><span>{fmt(sysInfo?.ram?.total)}</span></div>
          <div className="sys-detail-row"><span>Usada</span><span>{fmt(sysInfo?.ram?.used)}</span></div>
          <div className="sys-detail-row"><span>Libre</span><span>{fmt(sysInfo?.ram?.free)}</span></div>
          <div className="sys-detail-row"><span>Uso</span><span>{sysInfo?.ram?.percent || 0}%</span></div>
        </div>
      </Card>
      <Card title="Almacenamiento" onRefresh={() => reload('sys')}>
        <div className="sys-detail">
          {IS_VM(dbConfig)
            ? <div className="sys-detail-row"><span>Info</span><span>No disponible vía API</span></div>
            : <>
                <div className="sys-detail-row"><span>Total</span><span>{fmt(sysInfo?.disk?.total)}</span></div>
                <div className="sys-detail-row"><span>Libre</span><span>{fmt(sysInfo?.disk?.free)}</span></div>
                <div className="sys-detail-row"><span>Uso</span><span>{sysInfo?.disk?.percent || 0}%</span></div>
              </>
          }
        </div>
      </Card>
      <Card title="Sistema Operativo" onRefresh={() => reload('sys')}>
        <div className="sys-detail">
          <div className="sys-detail-row"><span>Plataforma</span><span>{sysInfo?.platform || '—'}</span></div>
          <div className="sys-detail-row"><span>Hostname</span><span>{sysInfo?.hostname || '—'}</span></div>
          <div className="sys-detail-row"><span>Uptime</span><span>{fmtUptime(sysInfo?.uptime)}</span></div>
        </div>
      </Card>
    </div>
  );
}

// ── AdminPanel principal ─────────────────────────────────────────

const NAV = [
  { id: 'dashboard',  label: 'Dashboard',          icon: 'dashboard'          },
  { id: 'conectados', label: 'Usuarios Conectados', icon: 'supervisor_account' },
  { id: 'usuarios',   label: 'Gestión Usuarios',    icon: 'manage_accounts'    },
  { id: 'conexion',   label: 'Conexión BD',         icon: 'dns'                },
  { id: 'sistema',    label: 'Sistema',             icon: 'memory'             },
];

export default function AdminPanel() {
  const [page,       setPage]       = useState('dashboard');
  const [sysInfo,    setSysInfo]    = useState(null);
  const [connUsers,  setConnUsers]  = useState([]);
  const [globalMet,  setGlobalMet]  = useState(null);
  const [users,      setUsers]      = useState([]);
  const [cpuHistory, setCpuHistory] = useState([]);
  const [dbConfig,   setDbConfig]   = useState({ mode: 'local', vmUrl: '', vmToken: '', pgString: '' });

  const cpuRef = useRef([]);

  const user = (() => {
    try { return JSON.parse(localStorage.getItem('auth_user')); } catch { return null; }
  })();

  // ── Carga dbConfig al inicio ─────────────────────────────────
  useEffect(() => {
    window.api.invoke('admin:getDbConfig').then(cfg => {
      if (cfg) setDbConfig(cfg);
    }).catch(() => {});
  }, []);

  // ── Load functions mode-aware ────────────────────────────────

  const loadSys = useCallback(async () => {
    try {
      let info;
      if (IS_VM(dbConfig)) {
        const raw = await vmApiFetch(dbConfig.vmUrl, dbConfig.vmToken, '/api/admin/sysinfo');
        const uptimeSec = raw.uptime || 0;
        info = {
          cpu: { percent: raw.cpu?.usage ?? 0, model: raw.cpu?.model || '—', cores: raw.cpu?.cores || 0, speed: 0 },
          ram: { percent: raw.memory?.usedPercent ?? 0, total: raw.memory?.total ?? 0, used: raw.memory?.used ?? 0, free: raw.memory?.free ?? 0 },
          disk: { percent: 0, total: 0, free: 0 },
          uptime: { hours: Math.floor(uptimeSec / 3600), minutes: Math.floor((uptimeSec % 3600) / 60) },
          hostname: raw.hostname || '—',
          platform: raw.platform || '—',
          processes: { express: true, websocket: true, adb: true, sqlite: true }
        };
      } else {
        info = await window.api.invoke('admin:getSystemInfo');
      }
      setSysInfo(info);
      const now = new Date();
      const label = `${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
      cpuRef.current = [...cpuRef.current.slice(-19), { t: label, v: info?.cpu?.percent ?? 0 }];
      setCpuHistory([...cpuRef.current]);
    } catch {}
  }, [dbConfig]);

  const loadUsers = useCallback(async () => {
    try {
      if (IS_VM(dbConfig)) {
        const raw = await vmApiFetch(dbConfig.vmUrl, dbConfig.vmToken, '/api/admin/connected');
        const mapped = [
          ...( raw.asesores || []).map(a => ({ tipo: 'ASESOR', nombre: a.nombre, asesor_id: a.asesor_id, estado: { nombre_estado: a.nombre_estado } })),
          ...Array(raw.supervisores || 0).fill(null).map((_, i) => ({ tipo: 'SUPERVISOR', nombre: `Supervisor ${i + 1}` }))
        ];
        setConnUsers(mapped);
      } else {
        setConnUsers(await window.api.invoke('admin:getConnectedUsers') || []);
      }
    } catch {}
  }, [dbConfig]);

  const loadMetrics = useCallback(async () => {
    try {
      if (IS_VM(dbConfig)) {
        const data = await vmApiFetch(dbConfig.vmUrl, dbConfig.vmToken, '/api/metricas-equipo');
        setGlobalMet(data);
      } else {
        setGlobalMet(await window.api.invoke('admin:getGlobalMetrics'));
      }
    } catch {}
  }, [dbConfig]);

  const loadUserList = useCallback(async () => {
    try {
      if (IS_VM(dbConfig)) {
        const data = await vmApiFetch(dbConfig.vmUrl, dbConfig.vmToken, '/api/admin/users');
        if (Array.isArray(data)) setUsers(data);
      } else {
        const res = await window.api.invoke('admin:getUsers');
        if (Array.isArray(res)) setUsers(res);
      }
    } catch {}
  }, [dbConfig]);

  const reload = useCallback((type) => {
    if (type === 'sys')      loadSys();
    if (type === 'users')    { loadUsers(); loadUserList(); }
    if (type === 'userList') loadUserList();
    if (type === 'metrics')  loadMetrics();
    if (type === 'all')      { loadSys(); loadUsers(); loadMetrics(); loadUserList(); }
  }, [loadSys, loadUsers, loadMetrics, loadUserList]);

  // Re-cargar todo cuando cambia el modo
  useEffect(() => {
    reload('all');
  }, [dbConfig.mode, dbConfig.vmUrl]);

  // Polling
  useEffect(() => {
    const sysI     = setInterval(loadSys,     3000);
    const usersI   = setInterval(loadUsers,   5000);
    const metricsI = setInterval(loadMetrics, 30000);
    return () => { clearInterval(sysI); clearInterval(usersI); clearInterval(metricsI); };
  }, [loadSys, loadUsers, loadMetrics]);

  async function handleLogout() {
    try { await window.api.invoke('app:logout'); } catch {}
  }

  async function handleOpenSupervisor() {
    try { await window.api.invoke('admin:openSupervisor'); } catch {}
  }

  const vmConnected = IS_VM(dbConfig);

  return (
    <div className="admin-shell">
      {/* Sidebar */}
      <aside className="admin-sidebar">
        <div className="sidebar-brand">
          <span className="material-icons sidebar-brand__icon">shield</span>
          <span className="sidebar-brand__name">UPHONE<br /><small>Admin</small></span>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-nav__section">SISTEMA</div>
          {NAV.map(n => (
            <button key={n.id} className={`sidebar-nav__item ${page === n.id ? 'sidebar-nav__item--active' : ''}`} onClick={() => setPage(n.id)}>
              <span className="material-icons">{n.icon}</span>
              <span>{n.label}</span>
              {n.id === 'conexion' && <ModeBadge mode={dbConfig.mode} />}
            </button>
          ))}
          <div className="sidebar-nav__section" style={{ marginTop: 24 }}>ACCIONES</div>
          <button className="sidebar-nav__item" onClick={handleOpenSupervisor}>
            <span className="material-icons">open_in_new</span>
            <span>Panel Supervisor</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <span className="material-icons" style={{ color: '#ea80fc' }}>admin_panel_settings</span>
            <div>
              <div className="sidebar-user__name">{user?.nombre || 'Admin'}</div>
              <div className="sidebar-user__role">Administrador</div>
            </div>
          </div>
          <button className="btn-icon btn-icon--logout" onClick={handleLogout} title="Cerrar sesión">
            <span className="material-icons">logout</span>
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="admin-main">
        <header className="admin-topbar">
          <div className="topbar-breadcrumb">
            <span className="material-icons" style={{ fontSize: 16 }}>home</span>
            <span>/</span><span>Admin</span><span>/</span>
            <span>{NAV.find(n => n.id === page)?.label}</span>
          </div>
          <div className="topbar-right">
            <div className={`topbar-mode topbar-mode--${dbConfig.mode}`}>
              <span className="material-icons" style={{ fontSize: 14 }}>{vmConnected ? 'cloud' : 'storage'}</span>
              {vmConnected ? `VM PostgreSQL: ${(dbConfig.vmUrl || '').replace(/^https?:\/\//, '').slice(0, 25)}` : 'Local SQLite'}
            </div>
            <div className="topbar-online">
              <span className="online-dot" />
              <span>{connUsers.length} conectados</span>
            </div>
          </div>
        </header>

        <div className="admin-content">
          {page === 'dashboard'  && <PageDashboard sysInfo={sysInfo} cpuHistory={cpuHistory} connUsers={connUsers} globalMetrics={globalMet} dbConfig={dbConfig} reload={reload} />}
          {page === 'conectados' && <PageConectados connUsers={connUsers} dbConfig={dbConfig} reload={reload} />}
          {page === 'usuarios'   && <PageUsuarios users={users} dbConfig={dbConfig} reload={reload} />}
          {page === 'conexion'   && <PageConexion dbConfig={dbConfig} onConfigChange={setDbConfig} />}
          {page === 'sistema'    && <PageSistema sysInfo={sysInfo} dbConfig={dbConfig} reload={reload} />}
        </div>
      </main>
    </div>
  );
}
