import React, { useEffect, useState, useMemo } from 'react';
import Modal from '../shared/Modal';

/**
 * ContactabilidadDrillDown — Lista de CDRs filtrados por asesor + categoría.
 *
 * Usado al hacer click en una celda específica de la card "Contactabilidad Cruda"
 * (cruce asesor × categoría). Reutiliza `db:getDetalleContactabilidad` y filtra
 * client-side por categoría.
 *
 * Props:
 *  - open: boolean
 *  - onClose: () => void
 *  - asesorId, asesorNombre: el asesor seleccionado
 *  - categoria: 'EFECTIVO' | 'NEUTRO' | 'NO_CONTACTADO' | 'SIN_TIPIFICAR'
 *  - fecha, campanaId: filtros heredados del panel Métricas
 */

const CAT_INFO = {
  EFECTIVO:       { label: 'Efectivos',        color: '#00E676', match: (cat) => cat === 'CONTACTO_EFECTIVO' || cat === 'CONTACTO EXITOSO' },
  NEUTRO:         { label: 'Neutros',          color: '#FBC02D', match: (cat) => cat === 'CONTACTO_NEUTRO'   || cat === 'CONTACTO NEUTRO' },
  NO_CONTACTADO:  { label: 'No Contactados',   color: '#9E9E9E', match: (cat) => cat === 'NO_CONTACTADO'     || cat === 'NO CONTACTADO' },
  SIN_TIPIFICAR:  { label: 'Sin Tipificar',    color: '#ff8a65', match: (cat) => cat == null || cat === '' },
};

const fmtHora = (ts) => {
  if (!ts || typeof ts !== 'string') return '—';
  try {
    const d = new Date(ts.replace(' ', 'T'));
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return '—'; }
};
const fmtDuracion = (seg) => {
  if (!seg || seg <= 0) return '—';
  const m = Math.floor(seg / 60);
  const s = seg % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export default function ContactabilidadDrillDown({ open, onClose, asesorId, asesorNombre, categoria, fecha, fechaFin, campanaId }) {
  const [registros, setRegistros] = useState([]);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!open || !asesorId || !categoria) return;
    setCargando(true);
    window.api.invoke('db:getDetalleContactabilidad', fecha || null, asesorId, campanaId || null, fechaFin || null)
      .then(r => setRegistros(Array.isArray(r) ? r : []))
      .catch(err => { console.error('[DRILL_CONTACT]', err); setRegistros([]); })
      .finally(() => setCargando(false));
  }, [open, asesorId, categoria, fecha, fechaFin, campanaId]);

  const info = CAT_INFO[categoria] || {};
  const filtrados = useMemo(() => {
    if (!info.match) return [];
    return registros.filter(r => info.match(r.tipificacion_categoria));
  }, [registros, info]);

  const exportarCsv = () => {
    if (filtrados.length === 0) return;
    const escape = (v) => {
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n;]/.test(s) ? `"${s}"` : s;
    };
    const headers = ['Hora', 'Cliente', 'Cédula', 'Teléfono', 'Empresa', 'Contrato', 'Tipificación', 'Duración', 'Notas'];
    const rows = filtrados.map(r => [
      fmtHora(r.hora_inicio), r.nombre_deudor || '', r.cedula || '', r.telefono || '',
      r.empresa || '', r.contrato || '',
      r.tipificacion_codigo || (r.tipificacion_categoria == null ? 'SIN_TIP' : ''),
      fmtDuracion(r.duracion_seg), r.notas || '',
    ].map(escape).join(','));
    const csv = '﻿' + headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contactabilidad_${asesorNombre?.replace(/\s+/g, '_') || 'asesor'}_${categoria}_${fecha || 'hoy'}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Modal open={open} onClose={onClose} title={`${info.label || categoria} · ${asesorNombre || ''}`}>
      <div style={{ padding: '0.5rem 1rem 1rem', minWidth: 720, maxWidth: 980 }}>
        {/* Header con resumen */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '10px 12px', marginBottom: 10, borderRadius: 8,
          background: 'rgba(255,255,255,0.03)', border: `1px solid ${info.color}33`, borderLeft: `3px solid ${info.color}`,
        }}>
          <div>
            <div style={{ fontSize: 10, opacity: 0.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {fecha ? `Día ${fecha}` : 'Hoy'}{campanaId ? ` · Campaña #${campanaId}` : ''}
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: info.color, marginTop: 2 }}>
              {filtrados.length.toLocaleString()} <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.7 }}>{info.label?.toLowerCase()}</span>
            </div>
          </div>
          <button
            onClick={exportarCsv}
            className="btn btn-outline btn-sm"
            style={{ padding: '4px 12px', fontSize: 12, height: 'auto' }}
            disabled={filtrados.length === 0}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>download</span>
            CSV
          </button>
        </div>

        {/* Tabla */}
        {cargando ? (
          <div style={{ padding: '40px 0', textAlign: 'center', opacity: 0.5 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 28 }}>sync</span>
            <p className="text-body-sm" style={{ marginTop: 8 }}>Cargando...</p>
          </div>
        ) : filtrados.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center', opacity: 0.4 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 32 }}>inbox</span>
            <p className="text-body-sm" style={{ marginTop: 8 }}>Sin registros en esta categoría</p>
          </div>
        ) : (
          <div style={{ borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)', overflow: 'hidden', maxHeight: 500, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead style={{ position: 'sticky', top: 0, background: '#1a1a1a', zIndex: 1 }}>
                <tr style={{ textAlign: 'left' }}>
                  <th style={th}>Hora</th>
                  <th style={th}>Cliente</th>
                  <th style={th}>Tel.</th>
                  <th style={th}>Empresa</th>
                  <th style={th}>Tipif.</th>
                  <th style={{ ...th, textAlign: 'right' }}>Dur.</th>
                  <th style={th}>Notas</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((r, i) => (
                  <tr key={`${r.cdr_id}-${i}`} style={{
                    borderTop: '1px solid rgba(255,255,255,0.04)',
                    background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                  }}>
                    <td style={td}><span className="text-mono">{fmtHora(r.hora_inicio)}</span></td>
                    <td style={{ ...td, fontWeight: 600 }}>{r.nombre_deudor || '—'}</td>
                    <td style={td}><span className="text-mono">{r.telefono || '—'}</span></td>
                    <td style={td}>
                      {r.empresa
                        ? <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 99, background: 'rgba(255,255,255,0.06)', opacity: 0.8 }}>{r.empresa}</span>
                        : '—'}
                    </td>
                    <td style={td}>
                      {r.tipificacion_codigo
                        ? <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 99, background: `${info.color}22`, color: info.color }}>{r.tipificacion_codigo}</span>
                        : <span style={{ fontSize: 9, fontStyle: 'italic', opacity: 0.5 }}>sin tipificar</span>}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}><span className="text-mono">{fmtDuracion(r.duracion_seg)}</span></td>
                    <td style={{ ...td, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.75 }}>{r.notas || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

const th = { padding: '8px 10px', fontSize: 10, fontWeight: 700, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: '1px solid rgba(255,255,255,0.08)' };
const td = { padding: '7px 10px', verticalAlign: 'middle' };
