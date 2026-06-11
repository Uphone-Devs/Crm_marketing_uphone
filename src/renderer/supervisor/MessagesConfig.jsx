import React, { useState, useEffect, useCallback } from 'react';
import { showToast } from '../shared/Toast';

function buildApiBase() {
  const ws = localStorage.getItem('uphone_ws_ip') || '127.0.0.1';
  if (!ws || ws === '127.0.0.1' || ws === 'localhost') return null;
  return (ws.startsWith('http') ? ws.replace(/\/$/, '') : `http://${ws}:3001`) + '/api';
}

/**
 * Variables disponibles para interpolación en las plantillas de mensaje.
 * Cada variable tiene un token que el supervisor puede insertar
 * y que será reemplazado con datos reales del contacto al momento del envío.
 * Agrupadas para facilitar la selección.
 */
const VARIABLE_GROUPS = [
  {
    label: 'Cliente',
    color: '#64b5f6',
    items: [
      { token: '{nombres_apellidos}', label: 'Nombres y Apellidos', icon: 'person' },
      { token: '{cedula}',            label: 'Cédula',              icon: 'badge' },
      { token: '{telefono}',          label: 'Teléfono',            icon: 'call' },
      { token: '{correo}',            label: 'Correo',              icon: 'mail' },
      { token: '{empresa}',           label: 'Empresa',             icon: 'business' },
      { token: '{contrato}',          label: 'Contrato',            icon: 'description' },
      { token: '{grupo}',             label: 'Grupo',               icon: 'category' },
    ],
  },
  {
    label: 'Financiero',
    color: '#ef4444',
    items: [
      { token: '{valor_mora}',        label: 'Valor en Mora',       icon: 'warning' },
      { token: '{monto_por_cobrar}',  label: 'Monto por Cobrar',    icon: 'account_balance_wallet' },
      { token: '{monto_total}',       label: 'Monto Total',         icon: 'receipt_long' },
      { token: '{valor_intereses}',   label: 'Valor + Intereses',   icon: 'trending_up' },
      { token: '{dias_mora}',         label: 'Días en Mora',        icon: 'hourglass_bottom' },
      { token: '{valor_promocional}', label: 'Valor Promocional',   icon: 'sell' },
      { token: '{numero_cuota}',     label: 'N° de Cuota',         icon: 'format_list_numbered' },
    ],
  },
  {
    label: 'Producto',
    color: '#ba68c8',
    items: [
      { token: '{distribuidor}',      label: 'Distribuidor',        icon: 'store' },
      { token: '{fecha_venta}',       label: 'Fecha de Venta',      icon: 'event' },
      { token: '{modelo}',            label: 'Modelo',              icon: 'smartphone' },
    ],
  },
  {
    label: 'Asesor',
    color: '#00e676',
    items: [
      { token: '{asesor_nombre}',     label: 'Nombre del Asesor',   icon: 'support_agent' },
    ],
  },
];

// Plano para preview / iteración legacy
const VARIABLES = VARIABLE_GROUPS.flatMap(g => g.items);

const EJEMPLO_DATOS = {
  '{nombres_apellidos}': 'Juan Carlos Pérez López',
  '{cedula}': '1712345678',
  '{telefono}': '0991234567',
  '{correo}': 'juan.perez@ejemplo.com',
  '{empresa}': 'UPHONE',
  '{contrato}': 'CTR-2025-00432',
  '{grupo}': 'Smartphones',
  '{valor_mora}': '15.00',
  '{monto_por_cobrar}': '450.00',
  '{monto_total}': '1,250.00',
  '{valor_intereses}': '18.00',
  '{dias_mora}': '3',
  '{valor_promocional}': '875.00',
  '{numero_cuota}': '5',
  '{distribuidor}': 'COMERCIAL ANDES',
  '{fecha_venta}': '15-08-2025',
  '{modelo}': 'Galaxy A54',
  '{asesor_nombre}': 'María González',
};

const CANALES = [
  { key: 'wsp',           label: 'WhatsApp',        icon: 'chat' },
  { key: 'sms',           label: 'SMS (Google)',     icon: 'sms' },
  { key: 'email',         label: 'Correo',           icon: 'mail' },
];

/**
 * MessagesConfig — Pestaña del supervisor para configurar plantillas
 * de mensajes que los asesores enviarán como acción rápida post-gestión.
 *
 * Responsabilidad única: Leer/escribir plantillas desde/hacia la tabla config.
 * No conoce la UI del asesor ni la lógica de envío.
 */
export default function MessagesConfig() {
  const [templates, setTemplates] = useState({});
  const [codigoPais, setCodigoPais] = useState('593');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('wsp');
  const [focusedField, setFocusedField] = useState('wsp');
  const [previewActive, setPreviewActive] = useState(false);
  const [tramos, setTramos] = useState([]);
  const [tramoExpandido, setTramoExpandido] = useState(null);
  const [tramoTabActivo, setTramoTabActivo] = useState('wsp');

  const loadTemplates = useCallback(async () => {
    try {
      const apiBase = buildApiBase();
      const authToken = localStorage.getItem('auth_token');
      let config;
      if (apiBase) {
        const res = await fetch(`${apiBase}/config`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        config = await res.json();
      } else {
        config = await window.api.invoke('db:getAllConfig');
      }
      setTemplates({
        wsp: config.msg_template_wsp || '',
        sms: config.msg_template_sms || '',
        email_subject: config.msg_template_email_subject || '',
        email_body: config.msg_template_email_body || '',
      });
      setCodigoPais(config.codigo_pais || '593');
      try {
        const parsed = JSON.parse(config.msg_tramos || '[]');
        setTramos(Array.isArray(parsed) ? parsed : []);
      } catch { setTramos([]); }
    } catch (err) {
      showToast('Error al cargar plantillas', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  async function handleSave() {
    setSaving(true);
    try {
      const apiBase = buildApiBase();
      const authToken = localStorage.getItem('auth_token');
      const configs = [
        ['msg_template_wsp',           templates.wsp],
        ['msg_template_sms',           templates.sms],
        ['msg_template_email_subject', templates.email_subject],
        ['msg_template_email_body',    templates.email_body],
        ['codigo_pais',                codigoPais],
        ['msg_tramos',                 JSON.stringify(tramos)],
      ];
      if (apiBase) {
        await Promise.all(configs.map(([clave, valor]) =>
          fetch(`${apiBase}/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
            body: JSON.stringify({ clave, valor }),
          })
        ));
      } else {
        for (const [clave, valor] of configs) {
          await window.api.invoke('db:setConfig', clave, valor);
        }
      }
      showToast('Plantillas guardadas correctamente', 'success');
    } catch (err) {
      showToast('Error al guardar', 'error');
    } finally {
      setSaving(false);
    }
  }

  function insertVariable(token) {
    const target = (activeTab === 'email' && focusedField === 'email_subject') ? 'email_subject' : 
                   (activeTab === 'email' && focusedField === 'email_body') ? 'email_body' : 
                   activeTab;

    setTemplates(prev => ({
      ...prev,
      [target]: (prev[target] || '') + token,
    }));
  }

  function insertVarInTramo(tramoId, token) {
    const fieldKey = tramoTabActivo === 'email' ? 'email_body' : tramoTabActivo;
    setTramos(prev => prev.map(t =>
      t.id === tramoId ? { ...t, [fieldKey]: (t[fieldKey] || '') + token } : t
    ));
  }

  function addTramo() {
    const sorted = [...tramos].sort((a, b) => (a.desde ?? 0) - (b.desde ?? 0));
    const last = sorted[sorted.length - 1];
    const newDesde = last ? (last.hasta >= 0 ? last.hasta + 1 : 0) : 0;
    const newT = { id: Date.now(), label: '', desde: newDesde, hasta: -1, wsp: '', sms: '', email_subject: '', email_body: '' };
    setTramos(prev => [...prev, newT]);
    setTramoExpandido(newT.id);
    setTramoTabActivo('wsp');
  }

  function updateTramo(id, field, value) {
    setTramos(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));
  }

  function deleteTramo(id) {
    setTramos(prev => prev.filter(t => t.id !== id));
    if (tramoExpandido === id) setTramoExpandido(null);
  }

  /** Reemplaza los tokens de la plantilla con datos de ejemplo */
  function renderPreview(text) {
    if (!text) return '(Plantilla vacía)';
    let result = text;
    Object.entries(EJEMPLO_DATOS).forEach(([token, value]) => {
      result = result.replaceAll(token, value);
    });
    return result;
  }

  const tramosOrdenados = [...tramos].sort((a, b) => (a.desde ?? 0) - (b.desde ?? 0));

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
        <span className="spinner" />
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h3 className="text-headline-sm" style={{ marginBottom: 8 }}>
          <span className="material-symbols-outlined" style={{ verticalAlign: 'middle', marginRight: 8, color: 'var(--color-primary)' }}>chat</span>
          Plantillas de Mensajes
        </h3>
        <p className="text-body-sm" style={{ opacity: 0.6, maxWidth: 600 }}>
          Configure las plantillas que los asesores usarán como acción rápida al finalizar cada gestión de cobro. 
          Use las variables disponibles para personalizar el mensaje con datos del cliente.
        </p>
      </div>

      {/* Código de país */}
      <div className="card" style={{ marginBottom: 16, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 20, opacity: 0.6 }}>public</span>
        <div style={{ flex: 1 }}>
          <span className="text-label-sm" style={{ opacity: 0.6 }}>CÓDIGO DE PAÍS (WHATSAPP)</span>
          <p className="text-body-sm" style={{ opacity: 0.4, fontSize: 11, margin: 0 }}>Se antepone automáticamente al número del contacto</p>
        </div>
        <input
          className="input"
          type="text"
          value={codigoPais}
          onChange={e => setCodigoPais(e.target.value.replace(/\D/g, ''))}
          style={{ width: 80, textAlign: 'center', fontWeight: 700 }}
          maxLength={4}
        />
      </div>

      {/* Tabs de canal */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          {CANALES.map(c => (
            <button
              key={c.key}
              className={`btn ${activeTab === c.key ? '' : 'btn-ghost'}`}
              style={{
                flex: 1,
                borderRadius: 0,
                borderBottom: activeTab === c.key ? '2px solid var(--color-primary)' : '2px solid transparent',
                padding: '12px 8px',
                fontSize: 12,
                fontWeight: activeTab === c.key ? 700 : 400,
                opacity: activeTab === c.key ? 1 : 0.5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
              onClick={() => setActiveTab(c.key)}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{c.icon}</span>
              {c.label}
            </button>
          ))}
        </div>

        <div style={{ padding: 20 }}>
          {/* Variables agrupadas */}
          <div style={{ marginBottom: 16 }}>
            <label className="text-label-sm" style={{ display: 'block', marginBottom: 8, opacity: 0.5 }}>
              INSERTAR VARIABLE
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {VARIABLE_GROUPS.map(g => (
                <div key={g.label} style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.05)',
                }}>
                  <div style={{
                    fontSize: 9, fontWeight: 800, letterSpacing: 0.6,
                    textTransform: 'uppercase', marginBottom: 6, color: g.color, opacity: 0.85,
                  }}>
                    {g.label}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {g.items.map(v => (
                      <button
                        key={v.token}
                        className="btn btn-outline btn-sm"
                        style={{
                          fontSize: 10.5, display: 'flex', alignItems: 'center', gap: 4,
                          padding: '5px 9px', borderColor: `${g.color}33`,
                        }}
                        onClick={() => insertVariable(v.token)}
                        title={`Insertar ${v.token}`}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 13, color: g.color }}>{v.icon}</span>
                        {v.label}
                        <code style={{
                          fontSize: 9, opacity: 0.55, marginLeft: 3, padding: '1px 4px',
                          background: 'rgba(0,0,0,0.25)', borderRadius: 3, fontFamily: 'monospace',
                        }}>{v.token}</code>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Editor */}
          <div style={{ marginBottom: 16 }}>
            {activeTab === 'email' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label className="text-label-sm" style={{ display: 'block', marginBottom: 8, opacity: 0.6 }}>
                    ASUNTO DEL CORREO
                  </label>
                  <input
                    type="text"
                    className="input"
                    style={{ width: '100%', padding: 12, fontFamily: 'monospace' }}
                    value={templates.email_subject}
                    onFocus={() => setFocusedField('email_subject')}
                    onChange={e => setTemplates(prev => ({ ...prev, email_subject: e.target.value }))}
                    placeholder="Escriba el asunto del correo..."
                  />
                </div>
                <div>
                  <label className="text-label-sm" style={{ display: 'block', marginBottom: 8, opacity: 0.6 }}>
                    CUERPO DEL CORREO
                  </label>
                  <textarea
                    className="input"
                    style={{
                      width: '100%',
                      minHeight: 200,
                      resize: 'vertical',
                      padding: 12,
                      fontFamily: 'monospace',
                      fontSize: 13,
                      lineHeight: 1.6,
                    }}
                    value={templates.email_body}
                    onFocus={() => setFocusedField('email_body')}
                    onChange={e => setTemplates(prev => ({ ...prev, email_body: e.target.value }))}
                    placeholder="Escriba el cuerpo del mensaje aquí..."
                  />
                </div>
              </div>
            ) : (
              <>
                <label className="text-label-sm" style={{ display: 'block', marginBottom: 8, opacity: 0.6 }}>
                  PLANTILLA DEL MENSAJE
                </label>
                <textarea
                  className="input"
                  style={{
                    width: '100%',
                    minHeight: 200,
                    resize: 'vertical',
                    padding: 12,
                    fontFamily: 'monospace',
                    fontSize: 13,
                    lineHeight: 1.6,
                  }}
                  value={templates[activeTab] || ''}
                  onFocus={() => setFocusedField(activeTab)}
                  onChange={e => setTemplates(prev => ({ ...prev, [activeTab]: e.target.value }))}
                  placeholder="Escriba la plantilla del mensaje aquí..."
                />
              </>
            )}
          </div>

          {/* Preview */}
          <div style={{ marginBottom: 16 }}>
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginBottom: 8, fontSize: 11 }}
              onClick={() => setPreviewActive(!previewActive)}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                {previewActive ? 'visibility_off' : 'visibility'}
              </span>
              {previewActive ? 'Ocultar Vista Previa' : 'Mostrar Vista Previa'}
            </button>

            {previewActive && (
              <div style={{
                background: 'rgba(0,229,255,0.04)',
                border: '1px solid rgba(0,229,255,0.15)',
                borderRadius: 8,
                padding: 16,
              }}>
                <span className="text-label-sm" style={{ display: 'block', marginBottom: 8, color: 'var(--color-primary)', fontSize: 10 }}>
                  VISTA PREVIA CON DATOS DE EJEMPLO
                </span>
                {activeTab === 'email' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                      <span style={{ fontSize: 11, opacity: 0.5, display: 'block' }}>ASUNTO:</span>
                      <p className="text-body-sm" style={{ fontWeight: 600, margin: 0 }}>{renderPreview(templates.email_subject)}</p>
                    </div>
                    <div style={{ height: 1, background: 'rgba(255,255,255,0.1)' }} />
                    <div>
                      <span style={{ fontSize: 11, opacity: 0.5, display: 'block' }}>CUERPO:</span>
                      <p className="text-body-sm" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, margin: 0 }}>
                        {renderPreview(templates.email_body)}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-body-sm" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, margin: 0 }}>
                    {renderPreview(templates[activeTab])}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Tramos por Días en Mora ──────────────────────────────────── */}
      <div style={{ marginTop: 28 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <h4 className="text-headline-sm" style={{ margin: '0 0 4px', fontSize: 15 }}>
              <span className="material-symbols-outlined" style={{ verticalAlign: 'middle', marginRight: 6, fontSize: 18, color: '#ff9800' }}>schedule_send</span>
              Plantillas por Tramo de Mora
            </h4>
            <p className="text-body-sm" style={{ opacity: 0.5, margin: 0, fontSize: 11 }}>
              Mensajes diferenciados según días en mora del cliente. Si coincide con un tramo se usa esa plantilla; si no, la global.
            </p>
          </div>
          <button className="btn btn-outline btn-sm" style={{ flexShrink: 0, marginLeft: 16 }} onClick={addTramo}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
            Agregar Tramo
          </button>
        </div>

        {tramosOrdenados.length === 0 ? (
          <div style={{
            padding: '28px 24px', textAlign: 'center', opacity: 0.4,
            border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 8,
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 36, display: 'block', marginBottom: 8 }}>format_list_numbered</span>
            <p style={{ margin: 0, fontSize: 12 }}>Sin tramos configurados. Se enviará la plantilla global a todos los clientes.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tramosOrdenados.map((tramo) => {
              const expanded = tramoExpandido === tramo.id;
              return (
                <div key={tramo.id} className="card" style={{ overflow: 'visible' }}>
                  {/* Header del tramo */}
                  <div
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                      cursor: 'pointer', borderRadius: expanded ? '8px 8px 0 0' : 8,
                      background: expanded ? 'rgba(255,152,0,0.04)' : 'transparent',
                    }}
                    onClick={() => { setTramoExpandido(expanded ? null : tramo.id); setTramoTabActivo('wsp'); }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#ff9800', flexShrink: 0 }}>
                      {expanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
                    </span>
                    <div style={{
                      background: 'rgba(255,152,0,0.15)', border: '1px solid rgba(255,152,0,0.3)',
                      borderRadius: 6, padding: '2px 10px', fontSize: 11, fontWeight: 800, color: '#ff9800',
                      whiteSpace: 'nowrap', flexShrink: 0,
                    }}>
                      {tramo.desde ?? 0} – {(tramo.hasta >= 0) ? `${tramo.hasta} días` : '∞'}
                    </div>
                    <input
                      className="input"
                      value={tramo.label || ''}
                      onChange={e => { e.stopPropagation(); updateTramo(tramo.id, 'label', e.target.value); }}
                      onClick={e => e.stopPropagation()}
                      placeholder="Ej: Mora inicial · Mora media · Mora crítica…"
                      style={{ flex: 1, fontSize: 11, padding: '3px 8px', minWidth: 0 }}
                    />
                    {/* Indicadores de canales configurados */}
                    <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                      {[
                        { k: 'wsp',        label: 'WSP',   color: '#4caf50' },
                        { k: 'sms',        label: 'SMS',   color: '#2196f3' },
                        { k: 'email_body', label: 'Email', color: '#9c27b0' },
                      ].map(ch => (
                        <span key={ch.k} style={{
                          fontSize: 9, padding: '1px 5px', borderRadius: 4, fontWeight: 700,
                          background: tramo[ch.k] ? `${ch.color}22` : 'rgba(255,255,255,0.05)',
                          border: `1px solid ${tramo[ch.k] ? `${ch.color}55` : 'transparent'}`,
                          color: tramo[ch.k] ? ch.color : 'rgba(255,255,255,0.25)',
                        }}>
                          {ch.label}
                        </span>
                      ))}
                    </div>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={e => { e.stopPropagation(); deleteTramo(tramo.id); }}
                      style={{ padding: 4, flexShrink: 0, color: 'rgba(244,67,54,0.7)' }}
                      title="Eliminar tramo"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                    </button>
                  </div>

                  {/* Cuerpo expandido */}
                  {expanded && (
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: 16 }}>
                      {/* Rango */}
                      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                        <div style={{ flex: 1 }}>
                          <label className="text-label-sm" style={{ display: 'block', marginBottom: 4, opacity: 0.55, fontSize: 9 }}>
                            DESDE (días mora, inclusivo)
                          </label>
                          <input
                            type="number" min="0" className="input"
                            value={tramo.desde ?? 0}
                            onChange={e => updateTramo(tramo.id, 'desde', Math.max(0, parseInt(e.target.value) || 0))}
                            style={{ fontWeight: 700, fontSize: 14 }}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label className="text-label-sm" style={{ display: 'block', marginBottom: 4, opacity: 0.55, fontSize: 9 }}>
                            HASTA (días mora, inclusivo · -1 = sin límite)
                          </label>
                          <input
                            type="number" min="-1" className="input"
                            value={tramo.hasta ?? -1}
                            onChange={e => updateTramo(tramo.id, 'hasta', parseInt(e.target.value))}
                            style={{ fontWeight: 700, fontSize: 14 }}
                          />
                        </div>
                      </div>

                      {/* Tabs de canal del tramo */}
                      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 12 }}>
                        {CANALES.map(c => (
                          <button
                            key={c.key}
                            className={`btn ${tramoTabActivo === c.key ? '' : 'btn-ghost'}`}
                            style={{
                              flex: 1, borderRadius: 0,
                              borderBottom: tramoTabActivo === c.key ? '2px solid #ff9800' : '2px solid transparent',
                              padding: '8px', fontSize: 11,
                              fontWeight: tramoTabActivo === c.key ? 700 : 400,
                              opacity: tramoTabActivo === c.key ? 1 : 0.5,
                              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                            }}
                            onClick={() => setTramoTabActivo(c.key)}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{c.icon}</span>
                            {c.label}
                          </button>
                        ))}
                      </div>

                      {/* Variables */}
                      <div style={{ marginBottom: 10 }}>
                        <label className="text-label-sm" style={{ display: 'block', marginBottom: 5, opacity: 0.45, fontSize: 9 }}>
                          INSERTAR VARIABLE{tramoTabActivo === 'email' ? ' (se agrega al cuerpo del correo)' : ''}
                        </label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {VARIABLE_GROUPS.map(g => (
                            <div key={g.label} style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              {g.items.map(v => (
                                <button
                                  key={v.token}
                                  className="btn btn-outline btn-sm"
                                  style={{
                                    fontSize: 9.5, padding: '3px 7px', borderColor: `${g.color}33`,
                                    display: 'flex', alignItems: 'center', gap: 3,
                                  }}
                                  onClick={() => insertVarInTramo(tramo.id, v.token)}
                                >
                                  <span className="material-symbols-outlined" style={{ fontSize: 11, color: g.color }}>{v.icon}</span>
                                  <code style={{ fontSize: 8, opacity: 0.65 }}>{v.token}</code>
                                </button>
                              ))}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Editor de plantilla */}
                      {tramoTabActivo === 'email' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <div>
                            <label className="text-label-sm" style={{ display: 'block', marginBottom: 5, opacity: 0.6, fontSize: 10 }}>ASUNTO</label>
                            <input
                              type="text" className="input"
                              value={tramo.email_subject || ''}
                              onChange={e => updateTramo(tramo.id, 'email_subject', e.target.value)}
                              style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
                              placeholder="Asunto del correo para este tramo…"
                            />
                          </div>
                          <div>
                            <label className="text-label-sm" style={{ display: 'block', marginBottom: 5, opacity: 0.6, fontSize: 10 }}>CUERPO</label>
                            <textarea
                              className="input"
                              value={tramo.email_body || ''}
                              onChange={e => updateTramo(tramo.id, 'email_body', e.target.value)}
                              style={{ width: '100%', minHeight: 140, resize: 'vertical', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6 }}
                              placeholder="Cuerpo del correo para este tramo…"
                            />
                          </div>
                        </div>
                      ) : (
                        <textarea
                          className="input"
                          value={tramo[tramoTabActivo] || ''}
                          onChange={e => updateTramo(tramo.id, tramoTabActivo, e.target.value)}
                          style={{ width: '100%', minHeight: 140, resize: 'vertical', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6 }}
                          placeholder={`Plantilla ${tramoTabActivo.toUpperCase()} para ${tramo.desde ?? 0}–${tramo.hasta >= 0 ? tramo.hasta : '∞'} días de mora…`}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Botón Guardar */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16, gap: 12 }}>
        <button className="btn btn-ghost" onClick={loadTemplates} disabled={saving}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>refresh</span>
          Restaurar
        </button>
        <button className="btn btn-primary btn-lg" onClick={handleSave} disabled={saving}>
          {saving ? (
            <><span className="spinner" style={{ width: 16, height: 16 }} /> Guardando...</>
          ) : (
            <><span className="material-symbols-outlined" style={{ fontSize: 18 }}>save</span> Guardar Plantillas</>
          )}
        </button>
      </div>
    </div>
  );
}
