import React, { useState, useEffect, useMemo } from 'react';
import { todayLocalISO } from '../shared/timeUtils';

const TIPO_LABEL = {
  PMP:       'Promesa de Pago',
  PAGO_REAL: 'Pago Realizado',
  AB_PARC:   'Abono Parcial',
  PEND_COMP: 'Pendiente Comprobante',
  INCUMP:    'Compromiso Incumplido',
  REAG:      'Reagendado',
};
const TIPO_COLOR = {
  PMP:        { bg: 'rgba(0,150,255,0.18)',  fg: '#64b5f6' },
  PAGO_REAL:  { bg: 'rgba(0,230,118,0.18)',  fg: 'var(--color-primary)' },
  AB_PARC:    { bg: 'rgba(255,193,7,0.18)',  fg: '#ffd54f' },
  PEND_COMP:  { bg: 'rgba(156,39,176,0.18)', fg: '#ce93d8' },
  INCUMP:     { bg: 'rgba(244,67,54,0.18)',  fg: '#ef9a9a' },
  REAG:       { bg: 'rgba(255,152,0,0.18)',  fg: '#ffcc02' },
};

const fmt$ = (n) => n != null ? `$${Number(n).toFixed(2)}` : '—';
const fmtFechaHora = (ts) => {
  if (!ts || typeof ts !== 'string') return '—';
  try {
    const d = new Date(ts.replace(' ', 'T'));
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-EC', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    });
  } catch { return '—'; }
};
const fmtHora = (ts) => {
  if (!ts || typeof ts !== 'string') return '—';
  try {
    const d = new Date(ts.replace(' ', 'T'));
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return '—'; }
};

export default function Compromisos({ callApi, asesores = [] }) {
  const hoy = todayLocalISO();
  const [fecha, setFecha] = useState(hoy);
  const [asesorId, setAsesorId] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState('');
  const [textoFiltro, setTextoFiltro] = useState('');
  const [registros, setRegistros] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [eliminandoId, setEliminandoId] = useState(null);

  const cargar = async () => {
    setCargando(true);
    try {
      const data = await callApi('db:getCompromisosEquipo', fecha, asesorId ? Number(asesorId) : null);
      setRegistros(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('[COMPROMISOS] Error:', err);
      setRegistros([]);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { cargar(); /* eslint-disable-next-line */ }, [fecha, asesorId]);

  const handleEliminar = async (cdrId) => {
    if (!window.confirm('¿Eliminar este compromiso? El contacto volverá a estado PENDIENTE.')) return;
    setEliminandoId(cdrId);
    try {
      await callApi('db:eliminarCompromiso', cdrId);
      await cargar();
      setExpandedId(null);
    } catch (err) {
      console.error('[ELIMINAR_COMP]', err);
    } finally {
      setEliminandoId(null);
    }
  };

  const filtrados = useMemo(() => {
    const txt = textoFiltro.trim().toLowerCase();
    return registros.filter(r => {
      if (tipoFiltro && r.tipificacion_codigo !== tipoFiltro) return false;
      if (!txt) return true;
      const hay = [
        r.nombre_deudor, r.cedula, r.telefono, r.asesor_nombre,
        r.tipificacion_desc, r.notas, r.contrato, r.empresa,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(txt);
    });
  }, [registros, textoFiltro, tipoFiltro]);

  const activos = filtrados.filter(r => r.tipificacion_codigo !== 'INCUMP' && r.resultado !== 'INCUMP');
  const totalMonto = activos.reduce((s, r) => s + (Number(r.monto_acordado) || 0), 0);
  const conMonto = activos.filter(r => r.monto_acordado != null).length;
  const sinMonto = activos.length - conMonto;

  const exportarCsv = () => {
    if (filtrados.length === 0) return;
    const escape = (v) => {
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n;]/.test(s) ? `"${s}"` : s;
    };
    const headers = ['Hora gestión', 'Asesor', 'Cliente', 'Cédula', 'Teléfono', 'Empresa', 'Contrato', 'Tipificación', 'Monto acordado', 'Fecha promesa', 'Mora cliente', 'Notas'];
    const rows = filtrados.map(r => [
      fmtHora(r.hora_gestion), r.asesor_nombre || '', r.nombre_deudor || '',
      r.cedula || '', r.telefono || '', r.empresa || '', r.contrato || '',
      TIPO_LABEL[r.tipificacion_codigo] || r.tipificacion_desc || '',
      r.monto_acordado != null ? Number(r.monto_acordado).toFixed(2) : '',
      r.fecha_promesa || '', r.valor_mora != null ? Number(r.valor_mora).toFixed(2) : '',
      r.notas || '',
    ].map(escape).join(','));
    const csv = '﻿' + headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `compromisos_${fecha}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="widget-card" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div className="widget-header" style={{ marginBottom: 12 }}>
        <div>
          <span className="text-label" style={{ opacity: 0.5 }}>SUPERVISOR · DRILL-DOWN</span>
          <h3 className="widget-title" style={{ marginTop: 4 }}>Compromisos de Pago</h3>
          <p className="text-body-sm" style={{ opacity: 0.4, marginTop: 2, fontSize: 11 }}>
            Detalle de PMP, Pago Realizado, Abono Parcial, Pendiente Comprobante e Incumplidos
          </p>
        </div>
      </div>

      {/* ── Filtros ── */}
      <div style={{
        display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
        padding: '10px 12px', marginBottom: 12, borderRadius: 8,
        background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 10, opacity: 0.5 }}>Fecha</span>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={{
            padding: '5px 8px', fontSize: 11, colorScheme: 'dark',
            background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 6, color: 'inherit', outline: 'none',
          }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 10, opacity: 0.5 }}>Asesor</span>
          <select value={asesorId} onChange={(e) => setAsesorId(e.target.value)} style={{
            padding: '5px 8px', fontSize: 11,
            background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 6, color: 'inherit', outline: 'none',
          }}>
            <option value="">Todos</option>
            {asesores.map(a => (<option key={a.id} value={a.id}>{a.nombre}</option>))}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 10, opacity: 0.5 }}>Tipo</span>
          <select value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value)} style={{
            padding: '5px 8px', fontSize: 11,
            background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 6, color: 'inherit', outline: 'none',
          }}>
            <option value="">Todos</option>
            <option value="PMP">Promesa de Pago</option>
            <option value="PAGO_REAL">Pago Realizado</option>
            <option value="AB_PARC">Abono Parcial</option>
            <option value="PEND_COMP">Pendiente Comprobante</option>
            <option value="INCUMP">Incumplidos</option>
            <option value="REAG">Reagendados</option>
          </select>
        </div>
        <div style={{ flex: '1 1 200px', minWidth: 180, position: 'relative' }}>
          <span className="material-symbols-outlined" style={{
            position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
            fontSize: 14, opacity: 0.4, pointerEvents: 'none',
          }}>search</span>
          <input
            type="text"
            value={textoFiltro}
            onChange={(e) => setTextoFiltro(e.target.value)}
            placeholder="Buscar cliente, cédula, teléfono, contrato..."
            style={{
              width: '100%', padding: '5px 26px 5px 28px', fontSize: 11,
              background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 6, color: 'inherit', outline: 'none',
            }}
          />
        </div>
      </div>

      {/* ── KPI cards ── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <KpiCard label="Total registros" value={filtrados.length} color="var(--color-primary)" />
        <KpiCard label="Con monto capturado" value={conMonto} color="#64b5f6" />
        <KpiCard label="Sin monto" value={sinMonto} color="#ff9800" warn={sinMonto > 0} />
        <KpiCard label="Suma comprometida" value={fmt$(totalMonto)} color="var(--color-primary)" />
      </div>

      {/* ── Tabla ── */}
      {cargando ? (
        <div style={{ padding: '40px 0', textAlign: 'center', opacity: 0.5 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 32 }}>sync</span>
          <p className="text-body-sm" style={{ marginTop: 8 }}>Cargando...</p>
        </div>
      ) : filtrados.length === 0 ? (
        <div style={{ padding: '40px 0', textAlign: 'center', opacity: 0.4 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 36 }}>handshake</span>
          <p className="text-body-sm" style={{ marginTop: 8 }}>Sin compromisos para los filtros aplicados</p>
        </div>
      ) : (
        <div style={{ borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.04)', textAlign: 'left' }}>
                <th style={th}>Hora</th>
                <th style={th}>Asesor</th>
                <th style={th}>Cliente</th>
                <th style={th}>Tel.</th>
                <th style={th}>Empresa</th>
                <th style={th}>Tipo</th>
                <th style={{ ...th, textAlign: 'right' }}>Monto</th>
                <th style={th}>Fecha promesa</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(r => {
                const isOpen = expandedId === r.cdr_id;
                const esIncumplido = r.tipificacion_codigo === 'INCUMP' || r.resultado === 'INCUMP';
                const color = TIPO_COLOR[r.tipificacion_codigo] || { bg: 'rgba(255,255,255,0.08)', fg: '#ccc' };
                return (
                  <React.Fragment key={`cmp-${r.cdr_id}`}>
                    <tr
                      onClick={() => setExpandedId(isOpen ? null : r.cdr_id)}
                      style={{ cursor: 'pointer', borderTop: '1px solid rgba(255,255,255,0.04)', background: esIncumplido ? 'rgba(244,67,54,0.04)' : undefined }}
                    >
                      <td style={td}><span className="text-mono">{fmtHora(r.hora_gestion)}</span></td>
                      <td style={td}>{r.asesor_nombre || '—'}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{r.nombre_deudor || '—'}</td>
                      <td style={td}><span className="text-mono">{r.telefono || '—'}</span></td>
                      <td style={td}>
                        {r.empresa
                          ? <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 99, background: 'rgba(255,255,255,0.06)', opacity: 0.8 }}>{r.empresa}</span>
                          : '—'}
                      </td>
                      <td style={td}>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 99, background: color.bg, color: color.fg }}>
                          {TIPO_LABEL[r.tipificacion_codigo] || r.tipificacion_desc}
                        </span>
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>
                        {r.monto_acordado != null
                          ? <span style={{ color: 'var(--color-primary)' }}>{fmt$(r.monto_acordado)}</span>
                          : <span style={{ color: '#ff9800', fontStyle: 'italic', fontSize: 10 }}>sin capturar</span>}
                      </td>
                      <td style={td}>
                        {r.fecha_promesa
                          ? <span style={{ color: '#64b5f6' }}>⏰ {fmtFechaHora(r.fecha_promesa)}</span>
                          : <span style={{ opacity: 0.3 }}>—</span>}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 14, opacity: 0.4, transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>
                          chevron_right
                        </span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                        <td colSpan={9} style={{ padding: '10px 14px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, fontSize: 11 }}>
                            <Detail label="Cédula" value={r.cedula || '—'} mono />
                            <Detail label="Contrato" value={r.contrato || '—'} mono />
                            <Detail label="Mora del cliente" value={r.valor_mora != null ? fmt$(r.valor_mora) : '—'} />
                            <Detail label="Duración llamada" value={r.duracion_seg ? `${Math.floor(r.duracion_seg/60)}:${(r.duracion_seg%60).toString().padStart(2,'0')}` : '—'} mono />
                          </div>
                          {r.notas && (
                            <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(0,0,0,0.2)', borderRadius: 6, fontSize: 11, lineHeight: 1.4, opacity: 0.85 }}>
                              <span style={{ fontSize: 9, opacity: 0.5, fontWeight: 700 }}>NOTAS</span>
                              <p style={{ margin: '4px 0 0' }}>{r.notas}</p>
                            </div>
                          )}
                          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleEliminar(r.cdr_id); }}
                              disabled={eliminandoId === r.cdr_id}
                              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', borderRadius: 6, border: '1px solid rgba(244,67,54,0.4)', background: 'rgba(244,67,54,0.12)', color: '#ef5350' }}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>delete</span>
                              {eliminandoId === r.cdr_id ? 'Eliminando...' : 'Eliminar compromiso'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const th = { padding: '8px 10px', fontSize: 10, fontWeight: 700, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.4 };
const td = { padding: '8px 10px', verticalAlign: 'middle' };

function KpiCard({ label, value, color, warn }) {
  return (
    <div style={{
      flex: '1 1 160px', minWidth: 140,
      padding: '10px 14px', borderRadius: 8,
      background: warn ? 'rgba(255,152,0,0.08)' : 'rgba(255,255,255,0.03)',
      border: '1px solid ' + (warn ? 'rgba(255,152,0,0.25)' : 'rgba(255,255,255,0.06)'),
    }}>
      <div style={{ fontSize: 9, opacity: 0.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: color || 'inherit' }}>{value}</div>
    </div>
  );
}

function Detail({ label, value, mono }) {
  return (
    <div>
      <div style={{ fontSize: 9, opacity: 0.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div className={mono ? 'text-mono' : ''} style={{ fontSize: 12, marginTop: 2 }}>{value}</div>
    </div>
  );
}
