import React, { useEffect, useState, useMemo } from 'react';

const TIPO_LABEL = {
  PMP: 'Promesa de Pago',
  PAGO_REAL: 'Pago Realizado',
  AB_PARC: 'Abono Parcial',
  PEND_COMP: 'Pendiente Comprobante',
};
const TIPO_COLOR = {
  PMP:       { bg: 'rgba(0,150,255,0.18)',  fg: '#64b5f6' },
  PAGO_REAL: { bg: 'rgba(0,230,118,0.18)',  fg: 'var(--color-primary)' },
  AB_PARC:   { bg: 'rgba(255,193,7,0.18)',  fg: '#ffd54f' },
  PEND_COMP: { bg: 'rgba(156,39,176,0.18)', fg: '#ce93d8' },
};

const fmt$ = (n) => n != null ? `$${Number(n).toFixed(2)}` : '—';
const fmtHora = (ts) => {
  if (!ts || typeof ts !== 'string') return '—';
  try {
    const d = new Date(ts.replace(' ', 'T'));
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return '—'; }
};

/**
 * Modal de detalle de métricas (Promesas / Recaudado).
 * - tipo: 'PROMESAS' | 'RECAUDADO'
 * - fecha: 'YYYY-MM-DD' o null (todos los días)
 * - campanaId: number o null
 */
export default function DetalleMetricaModal({ tipo, fecha, campanaId, onClose }) {
  const [registros, setRegistros] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState('');

  // Códigos a filtrar según tipo
  const codigosFiltro = tipo === 'PROMESAS'
    ? ['PMP']
    : ['PAGO_REAL', 'AB_PARC', 'PEND_COMP'];

  const titulo = tipo === 'PROMESAS' ? 'Detalle · Promesas de Pago' : 'Detalle · Ya Recaudado';
  const subtitulo = tipo === 'PROMESAS'
    ? 'CDRs tipificados como PMP — promesas pendientes de cobro'
    : 'CDRs tipificados como Pago Realizado / Abono Parcial / Pendiente Comprobante';

  useEffect(() => {
    let cancelled = false;
    setCargando(true);
    window.api.invoke('db:getCompromisosEquipo', fecha || null, null)
      .then(data => {
        if (cancelled) return;
        const arr = Array.isArray(data) ? data : [];
        // Filtrar por códigos del tipo
        let filtrados = arr.filter(r => codigosFiltro.includes(r.tipificacion_codigo));
        // Filtro adicional por campaña si aplica (en frontend porque el endpoint no soporta campaña)
        if (campanaId) {
          filtrados = filtrados.filter(r => {
            // No tenemos campana_id directo en el response; usamos contacto_id como proxy si no viene
            return true; // se filtra arriba en backend si llega de getCompromisosEquipo con filtro
          });
        }
        setRegistros(filtrados);
      })
      .catch(err => {
        console.error('[DETALLE]', err);
        if (!cancelled) setRegistros([]);
      })
      .finally(() => { if (!cancelled) setCargando(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, fecha]);

  const visible = useMemo(() => {
    const txt = busqueda.trim().toLowerCase();
    if (!txt) return registros;
    return registros.filter(r => [
      r.asesor_nombre, r.nombre_deudor, r.cedula, r.telefono, r.contrato,
      r.empresa, r.notas, r.tipificacion_desc,
    ].filter(Boolean).join(' ').toLowerCase().includes(txt));
  }, [registros, busqueda]);

  const totalMonto = visible.reduce((s, r) => s + (Number(r.monto_acordado) || 0), 0);
  const conMonto = visible.filter(r => r.monto_acordado != null).length;
  const sinMonto = visible.length - conMonto;

  const exportarXls = async () => {
    if (visible.length === 0) return;
    try {
      const res = await window.api.invoke('reports:generate', 'detalle_metrica', {
        tipoMet: tipo,
        fecha: fecha || null,
        formato: 'xlsx',
      });
      if (res?.success && res.archivo) {
        await window.api.invoke('shell:openPath', res.archivo);
      } else {
        alert('Error al generar XLS: ' + (res?.error || 'desconocido'));
      }
    } catch (err) {
      alert('Error: ' + (err.message || err));
    }
  };

  const exportarCsv = () => {
    if (visible.length === 0) return;
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const headers = ['Hora gestión', 'Asesor', 'Cliente', 'Cédula', 'Teléfono', 'Empresa', 'Contrato', 'Tipificación', 'Monto', 'Fecha promesa', 'Mora', 'Notas'];
    const rows = visible.map(r => [
      fmtHora(r.hora_gestion), r.asesor_nombre || '', r.nombre_deudor || '',
      r.cedula || '', r.telefono || '', r.empresa || '', r.contrato || '',
      TIPO_LABEL[r.tipificacion_codigo] || r.tipificacion_desc || '',
      r.monto_acordado != null ? Number(r.monto_acordado).toFixed(2) : '',
      r.fecha_promesa || '',
      r.valor_mora != null ? Number(r.valor_mora).toFixed(2) : '',
      r.notas || '',
    ].map(esc).join(','));
    const csv = '﻿' + headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `detalle_${tipo.toLowerCase()}_${fecha || 'todas'}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.75)', zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#121212', color: 'inherit',
          borderRadius: 12, maxWidth: 1400, width: '100%', maxHeight: '90vh',
          display: 'flex', flexDirection: 'column',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <span style={{ fontSize: 10, opacity: 0.5, fontWeight: 700, letterSpacing: 0.5 }}>SUPERVISOR · DETALLE</span>
            <h3 style={{ margin: '4px 0 0', fontSize: 16 }}>{titulo}</h3>
            <p style={{ margin: '2px 0 0', fontSize: 11, opacity: 0.5 }}>{subtitulo}</p>
            {(fecha || campanaId) && (
              <p style={{ margin: '2px 0 0', fontSize: 10, opacity: 0.4, fontStyle: 'italic' }}>
                Filtrado por: {fecha && `día ${fecha}`}{fecha && campanaId && ' · '}{campanaId && `campaña #${campanaId}`}
              </p>
            )}
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: 'inherit',
            cursor: 'pointer', display: 'flex', padding: 4,
          }}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Toolbar */}
        <div style={{
          padding: '10px 18px', borderBottom: '1px solid rgba(255,255,255,0.05)',
          display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <div style={{ flex: '1 1 200px', position: 'relative', minWidth: 180 }}>
            <span className="material-symbols-outlined" style={{
              position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
              fontSize: 14, opacity: 0.4, pointerEvents: 'none',
            }}>search</span>
            <input
              type="text"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar asesor, cliente, cédula, contrato, notas..."
              style={{
                width: '100%', padding: '5px 10px 5px 28px', fontSize: 12,
                background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 6, color: 'inherit', outline: 'none',
              }}
            />
          </div>
          <Kpi label="Registros" value={visible.length} color="var(--color-primary)" />
          <Kpi label="Con monto" value={conMonto} color="#64b5f6" />
          <Kpi label="Sin monto" value={sinMonto} color="#ff9800" warn={sinMonto > 0} />
          <Kpi label="Suma" value={fmt$(totalMonto)} color="var(--color-primary)" />
          <button onClick={exportarXls} disabled={visible.length === 0}
            className="btn btn-outline btn-sm"
            title="Descargar como Excel"
            style={{ padding: '5px 12px', fontSize: 11, height: 'auto' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>table_view</span>
            XLS
          </button>
          <button onClick={exportarCsv} disabled={visible.length === 0}
            className="btn btn-outline btn-sm"
            title="Descargar como CSV"
            style={{ padding: '5px 12px', fontSize: 11, height: 'auto' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>download</span>
            CSV
          </button>
        </div>

        {/* Tabla */}
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
          {cargando ? (
            <div style={{ padding: 60, textAlign: 'center', opacity: 0.5 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 32 }}>sync</span>
              <p style={{ marginTop: 8, fontSize: 12 }}>Cargando...</p>
            </div>
          ) : visible.length === 0 ? (
            <div style={{ padding: 60, textAlign: 'center', opacity: 0.4 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 36 }}>folder_off</span>
              <p style={{ marginTop: 8, fontSize: 12 }}>Sin registros para los filtros aplicados</p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)', textAlign: 'left', position: 'sticky', top: 0 }}>
                  <th style={th}>Hora</th>
                  <th style={th}>Asesor</th>
                  <th style={th}>Cliente</th>
                  <th style={th}>Cédula</th>
                  <th style={th}>Teléfono</th>
                  <th style={th}>Empresa</th>
                  <th style={th}>Contrato</th>
                  <th style={th}>Tipo</th>
                  <th style={{ ...th, textAlign: 'right' }}>Monto</th>
                  <th style={th}>Fecha Promesa</th>
                  <th style={{ ...th, textAlign: 'right' }}>Mora</th>
                  <th style={th}>Notas</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(r => {
                  const color = TIPO_COLOR[r.tipificacion_codigo] || { bg: 'rgba(255,255,255,0.08)', fg: '#ccc' };
                  return (
                    <tr key={`d-${r.cdr_id}`} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={td}><span className="text-mono" style={{ fontSize: 10 }}>{fmtHora(r.hora_gestion)}</span></td>
                      <td style={td}>{r.asesor_nombre || '—'}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{r.nombre_deudor || '—'}</td>
                      <td style={td}><span className="text-mono">{r.cedula || '—'}</span></td>
                      <td style={td}><span className="text-mono">{r.telefono || '—'}</span></td>
                      <td style={td}>
                        {r.empresa ? (
                          <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 99, background: 'rgba(255,255,255,0.06)' }}>{r.empresa}</span>
                        ) : '—'}
                      </td>
                      <td style={td}><span className="text-mono" style={{ fontSize: 10 }}>{r.contrato || '—'}</span></td>
                      <td style={td}>
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 99,
                          background: color.bg, color: color.fg, whiteSpace: 'nowrap',
                        }}>
                          {TIPO_LABEL[r.tipificacion_codigo] || r.tipificacion_desc}
                        </span>
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>
                        {r.monto_acordado != null
                          ? <span style={{ color: 'var(--color-primary)' }}>{fmt$(r.monto_acordado)}</span>
                          : <span style={{ color: '#ff9800', fontStyle: 'italic', fontSize: 10 }}>sin capturar</span>}
                      </td>
                      <td style={td}>
                        {r.fecha_promesa ? (
                          <span style={{ color: '#64b5f6', fontSize: 10 }}>⏰ {fmtHora(r.fecha_promesa)}</span>
                        ) : <span style={{ opacity: 0.3 }}>—</span>}
                      </td>
                      <td style={{ ...td, textAlign: 'right', color: '#ef4444', fontWeight: 600 }}>
                        {r.valor_mora != null ? fmt$(r.valor_mora) : '—'}
                      </td>
                      <td style={{ ...td, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.75 }}
                          title={r.notas || ''}>
                        {r.notas || <span style={{ opacity: 0.3 }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

const th = { padding: '8px 10px', fontSize: 10, fontWeight: 700, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.4 };
const td = { padding: '7px 10px', verticalAlign: 'middle' };

function Kpi({ label, value, color, warn }) {
  return (
    <div style={{
      padding: '6px 10px', borderRadius: 6, minWidth: 80,
      background: warn ? 'rgba(255,152,0,0.1)' : 'rgba(255,255,255,0.04)',
      border: '1px solid ' + (warn ? 'rgba(255,152,0,0.25)' : 'rgba(255,255,255,0.06)'),
    }}>
      <div style={{ fontSize: 8, opacity: 0.5, fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color: color || 'inherit' }}>{value}</div>
    </div>
  );
}
