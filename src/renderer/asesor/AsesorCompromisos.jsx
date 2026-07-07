import React, { useState, useEffect, useMemo } from 'react';
import { todayLocalISO } from '../shared/timeUtils';

const TIPO_LABEL = {
  PMP:        'Compromiso de Pago',
  PAGO_REAL:  'Pago Realizado',
  AB_PARC:    'Abono Parcial',
  PEND_COMP:  'Pendiente Comprobante',
  VOL_CALL:   'Volver a Llamar',
  INCUMP:     'Compromiso Incumplido',
  REAG:       'Reagendado',
};
const TIPO_COLOR = {
  PMP:        { bg: 'rgba(0,150,255,0.18)',  fg: '#64b5f6' },
  PAGO_REAL:  { bg: 'rgba(0,230,118,0.18)',  fg: 'var(--color-primary)' },
  AB_PARC:    { bg: 'rgba(255,193,7,0.18)',  fg: '#ffd54f' },
  PEND_COMP:  { bg: 'rgba(156,39,176,0.18)', fg: '#ce93d8' },
  VOL_CALL:   { bg: 'rgba(255,87,34,0.18)',  fg: '#ff8a65' },
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

/**
 * AsesorCompromisos — Vista del asesor de sus propios compromisos del día.
 * Diferencias vs supervisor:
 *  - Sin selector de asesor (filtrado por usuario.id)
 *  - Incluye VOL_CALL (Volver a llamar) además de PMP/PAGO_REAL/AB_PARC/PEND_COMP
 *  - Botón "Gestionar" opcional para volver al dashboard con el contacto cargado
 */
const FORMAS_PAGO = [
  { value: 'deposito',      label: 'Depósito' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'local',         label: 'Pago en local' },
];
const CODIGOS_CONFIRMABLES  = new Set(['PMP', 'AB_PARC', 'PEND_COMP']);
const CODIGOS_REAGENDABLES  = new Set(['PMP', 'AB_PARC', 'PEND_COMP', 'VOL_CALL']);
const CODIGOS_INCUMPLIBLES  = new Set(['PMP', 'AB_PARC', 'PEND_COMP']);

export default function AsesorCompromisos({ usuario, onGestionar, callApi, showToast, onCompromisoAction }) {
  const hoy = todayLocalISO();
  const [fecha, setFecha] = useState(hoy);
  const [tipoFiltro, setTipoFiltro] = useState('');
  const [textoFiltro, setTextoFiltro] = useState('');
  const [registros, setRegistros] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [descargandoXls, setDescargandoXls] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  // Estado del formulario de confirmación de pago
  const [pagoFormId, setPagoFormId]             = useState(null);
  const [pagoMonto, setPagoMonto]               = useState('');
  const [pagoComprobante, setPagoComprobante]   = useState('');
  const [pagoForma, setPagoForma]               = useState('deposito');
  const [pagoGuardando, setPagoGuardando]       = useState(false);
  // Estado del formulario de reagendamiento
  const [reagendaFormId, setReagendaFormId]     = useState(null);
  const [reagendaFecha, setReagendaFecha]       = useState('');
  const [reagendaHora, setReagendaHora]         = useState('');
  const [reagendaMonto, setReagendaMonto]       = useState('');
  const [reagendaGuardando, setReagendaGuardando] = useState(false);
  // Estado botón compromiso incumplido
  const [incumpGuardandoId, setIncumpGuardandoId] = useState(null);

  const cargar = async () => {
    if (!usuario?.id) return;
    setCargando(true);
    try {
      // Usar callApi (resuelve a IPC local o REST según el modo Multi-PC) en
      // lugar de window.api.invoke directo. En Multi-PC los CDRs viven en la BD
      // del supervisor y deben consultarse vía REST /api/mis-compromisos.
      const fn = callApi || ((ch, ...a) => window.api.invoke(ch, ...a));
      const data = await fn(
        'db:getCompromisosEquipo',
        fecha,
        Number(usuario.id),
        { incluirVolCall: true }
      );
      setRegistros(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('[ASESOR_COMPROMISOS] Error:', err);
      setRegistros([]);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { cargar(); /* eslint-disable-next-line */ }, [fecha, usuario?.id]);

  const filtrados = useMemo(() => {
    const txt = textoFiltro.trim().toLowerCase();
    return registros.filter(r => {
      if (tipoFiltro && r.tipificacion_codigo !== tipoFiltro) return false;
      if (!txt) return true;
      const hay = [
        r.nombre_deudor, r.cedula, r.telefono,
        r.tipificacion_desc, r.notas, r.contrato, r.empresa,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(txt);
    });
  }, [registros, textoFiltro, tipoFiltro]);

  // KPIs específicos del asesor
  const cntPMP       = filtrados.filter(r => r.tipificacion_codigo === 'PMP').length;
  const cntPago      = filtrados.filter(r => r.tipificacion_codigo === 'PAGO_REAL').length;
  const cntVolCall   = filtrados.filter(r => r.tipificacion_codigo === 'VOL_CALL').length;
  const totalMonto   = filtrados
    .filter(r => r.tipificacion_codigo !== 'INCUMP' && r.resultado !== 'INCUMP')
    .reduce((s, r) => s + (Number(r.monto_acordado) || 0), 0);

  const notify = (msg, kind = 'info') => {
    if (typeof showToast === 'function') showToast(msg, kind);
    else console.log('[ASESOR_COMPROMISOS]', kind, msg);
  };

  const abrirPagoForm = (e, cdrId, montoAcordado) => {
    e.stopPropagation();
    setPagoFormId(cdrId);
    setPagoMonto(montoAcordado != null ? String(Number(montoAcordado).toFixed(2)) : '');
    setPagoComprobante('');
    setPagoForma('deposito');
    setReagendaFormId(null);
  };

  const handleConfirmarPago = async (e, cdrId) => {
    e.stopPropagation();
    const monto = parseFloat(pagoMonto);
    if (isNaN(monto) || monto <= 0) { notify('Ingresa un valor de pago válido mayor a 0', 'warning'); return; }
    if (!pagoComprobante.trim())     { notify('Ingresa el número de comprobante', 'warning'); return; }
    setPagoGuardando(true);
    try {
      const fn = callApi || ((ch, ...a) => window.api.invoke(ch, ...a));
      const res = await fn('db:confirmarPagoCompromiso', cdrId, {
        montoPagado:  monto,
        comprobante:  pagoComprobante.trim(),
        formaPago:    pagoForma,
      });
      if (res?.success === false) throw new Error(res.error || 'Error al guardar');
      notify('Pago confirmado correctamente', 'success');
      setPagoFormId(null);
      setExpandedId(null);
      await cargar();
      await onCompromisoAction?.();
    } catch (err) {
      notify('Error al confirmar pago: ' + (err.message || err), 'error');
    } finally {
      setPagoGuardando(false);
    }
  };

  const abrirReagendaForm = (e, cdrId, montoAcordado) => {
    e.stopPropagation();
    setReagendaFormId(cdrId);
    const hoyStr = new Date().toISOString().slice(0, 10);
    setReagendaFecha(hoyStr);
    setReagendaHora('08:00');
    setReagendaMonto(montoAcordado != null ? String(Number(montoAcordado).toFixed(2)) : '');
    // cerrar otros formularios
    setPagoFormId(null);
  };

  const handleReagendar = async (e, cdrId) => {
    e.stopPropagation();
    if (!reagendaFecha) { notify('Selecciona una fecha', 'warning'); return; }
    if (!reagendaHora)  { notify('Selecciona una hora', 'warning'); return; }
    setReagendaGuardando(true);
    try {
      const fn = callApi || ((ch, ...a) => window.api.invoke(ch, ...a));
      const res = await fn('db:reagendarCompromiso', cdrId, {
        nuevaFecha: reagendaFecha,
        nuevaHora:  reagendaHora,
        nuevoMonto: reagendaMonto !== '' ? parseFloat(reagendaMonto) : null,
      });
      if (res?.success === false) throw new Error(res.error || 'Error al reagendar');
      notify('Compromiso reagendado correctamente', 'success');
      setReagendaFormId(null);
      setExpandedId(null);
      await cargar();
      await onCompromisoAction?.();
    } catch (err) {
      notify('Error al reagendar: ' + (err.message || err), 'error');
    } finally {
      setReagendaGuardando(false);
    }
  };

  const handleIncumplido = async (e, cdrId) => {
    e.stopPropagation();
    if (!window.confirm('¿Marcar este compromiso como incumplido? El contacto volverá a PENDIENTE.')) return;
    setIncumpGuardandoId(cdrId);
    try {
      const fn = callApi || ((ch, ...a) => window.api.invoke(ch, ...a));
      const res = await fn('db:marcarCompromisoIncumplido', cdrId);
      if (res?.success === false) throw new Error(res.error || 'Error al marcar incumplido');
      notify('Compromiso marcado como incumplido', 'success');
      setExpandedId(null);
      await cargar();
      await onCompromisoAction?.();
    } catch (err) {
      notify('Error: ' + (err.message || err), 'error');
    } finally {
      setIncumpGuardandoId(null);
    }
  };

  const exportarXls = async () => {
    if (filtrados.length === 0 || !usuario?.id) return;
    setDescargandoXls(true);
    try {
      const fn = callApi || ((ch, ...a) => window.api.invoke(ch, ...a));
      const res = await fn('reports:generate', 'mis_compromisos', {
        asesor_id: usuario.id,
        fecha,
        formato: 'xlsx',
        tipo_filtro: tipoFiltro || undefined,
      });
      if (res && res.success === false) throw new Error(res.error || 'Fallo al generar');
      notify('Reporte XLS generado · revisar Documentos/ANTIGRAVITY/Reportes', 'success');
    } catch (err) {
      notify('Error al generar XLS: ' + (err.message || err), 'error');
    } finally {
      setDescargandoXls(false);
    }
  };

  const exportarCsv = () => {
    if (filtrados.length === 0) return;
    const escape = (v) => {
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n;]/.test(s) ? `"${s}"` : s;
    };
    const headers = ['Hora gestión', 'Cliente', 'Cédula', 'Teléfono', 'Empresa', 'Contrato', 'Tipificación', 'Monto acordado', 'Fecha promesa', 'Mora cliente', 'Notas'];
    const rows = filtrados.map(r => [
      fmtHora(r.hora_gestion), r.nombre_deudor || '',
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
    a.download = `mis_compromisos_${fecha}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="widget-card" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div className="widget-header" style={{ marginBottom: 12 }}>
        <div>
          <span className="text-label" style={{ opacity: 0.5 }}>ASESOR · MIS COMPROMISOS</span>
          <h3 className="widget-title" style={{ marginTop: 4 }}>Compromisos y Recalls</h3>
          <p className="text-body-sm" style={{ opacity: 0.4, marginTop: 2, fontSize: 12 }}>
            Tus compromisos de pago (PMP, Pago Realizado, Abono Parcial, Pendiente Comprobante) y "Volver a Llamar"
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button"
            onClick={exportarXls}
            className="btn btn-outline btn-sm"
            style={{ padding: '4px 12px', fontSize: 12, height: 'auto' }}
            disabled={filtrados.length === 0 || descargandoXls}
            title="Descargar reporte en Excel"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              {descargandoXls ? 'sync' : 'table_view'}
            </span>
            {descargandoXls ? 'Generando…' : 'Descargar XLS'}
          </button>
          <button type="button"
            onClick={exportarCsv}
            className="btn btn-outline btn-sm"
            style={{ padding: '4px 12px', fontSize: 12, height: 'auto' }}
            disabled={filtrados.length === 0}
            title="Descargar como CSV"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>download</span>
            CSV
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div style={{
        display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
        padding: '10px 12px', marginBottom: 12, borderRadius: 8,
        background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 12, opacity: 0.5 }}>Fecha</span>
          <input aria-label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={{
            padding: '5px 8px', fontSize: 12, colorScheme: 'dark',
            background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 6, color: 'inherit',
          }} />
          <button type="button"
            onClick={() => setFecha(hoy)}
            style={{
              padding: '4px 8px', fontSize: 12, fontWeight: 700,
              background: 'rgba(0,230,118,0.1)', border: '1px solid rgba(0,230,118,0.3)',
              color: 'var(--color-primary)', borderRadius: 6, cursor: 'pointer',
            }}
          >HOY</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 12, opacity: 0.5 }}>Tipo</span>
          <select value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value)} style={{
            padding: '5px 8px', fontSize: 12,
            background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 6, color: 'inherit',
          }}>
            <option value="">Todos</option>
            <option value="PMP">Compromiso de Pago</option>
            <option value="PAGO_REAL">Pago Realizado</option>
            <option value="AB_PARC">Abono Parcial</option>
            <option value="PEND_COMP">Pendiente Comprobante</option>
            <option value="VOL_CALL">Volver a Llamar</option>
            <option value="INCUMP">Incumplidos</option>
          </select>
        </div>
        <div style={{ flex: '1 1 200px', minWidth: 180, position: 'relative' }}>
          <span className="material-symbols-outlined" style={{
            position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
            fontSize: 14, opacity: 0.4, pointerEvents: 'none',
          }}>search</span>
          <input aria-label="Campo"
            type="text"
            value={textoFiltro}
            onChange={(e) => setTextoFiltro(e.target.value)}
            placeholder="Buscar cliente, cédula, teléfono, contrato..."
            style={{
              width: '100%', padding: '5px 26px 5px 28px', fontSize: 12,
              background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 6, color: 'inherit',
            }}
          />
        </div>
      </div>

      {/* KPI cards */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <KpiCard label="Total registros" value={filtrados.length} color="var(--color-primary)" />
        <KpiCard label="Compromisos PMP" value={cntPMP} color="#64b5f6" />
        <KpiCard label="Pagos realizados" value={cntPago} color="var(--color-primary)" />
        <KpiCard label="Volver a llamar" value={cntVolCall} color="#ff8a65" />
        <KpiCard label="Suma comprometida" value={fmt$(totalMonto)} color="var(--color-primary)" />
      </div>

      {/* Tabla */}
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
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.04)', textAlign: 'left' }}>
                <th style={th}>Hora</th>
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
                      style={{
                        cursor: 'pointer',
                        borderTop: '1px solid rgba(255,255,255,0.04)',
                        background: esIncumplido ? 'rgba(244,67,54,0.04)' : undefined,
                      }}
                    >
                      <td style={td}><span className="text-mono">{fmtHora(r.hora_gestion)}</span></td>
                      <td style={{ ...td, fontWeight: 600 }}>{r.nombre_deudor || '—'}</td>
                      <td style={td}><span className="text-mono">{r.telefono || '—'}</span></td>
                      <td style={td}>
                        {r.empresa
                          ? <span style={{ fontSize: 12, padding: '1px 5px', borderRadius: 99, background: 'rgba(255,255,255,0.06)', opacity: 0.8 }}>{r.empresa}</span>
                          : '—'}
                      </td>
                      <td style={td}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 6px', borderRadius: 99, background: color.bg, color: color.fg }}>
                            {TIPO_LABEL[r.tipificacion_codigo] || r.tipificacion_desc}
                          </span>
                          {r.resultado === 'COMP_CUM' && (
                            <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 6px', borderRadius: 99, background: 'rgba(0,230,118,0.15)', color: 'var(--color-primary)' }}>
                              PAGADO
                            </span>
                          )}
                          {r.resultado === 'REAG' && r.tipificacion_codigo !== 'INCUMP' && (
                            <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 6px', borderRadius: 99, background: 'rgba(255,152,0,0.15)', color: '#ffcc02' }}>
                              REAGENDADO
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>
                        {r.monto_acordado != null
                          ? <span style={{ color: 'var(--color-primary)' }}>{fmt$(r.monto_acordado)}</span>
                          : <span style={{ color: '#ff9800', fontStyle: 'italic', fontSize: 12 }}>sin capturar</span>}
                      </td>
                      <td style={td}>
                        {r.fecha_promesa
                          ? (
                            <div style={{ color: '#64b5f6', fontSize: 12, lineHeight: 1.2 }}>
                              <span style={{ fontWeight: 700 }}>Promesa para las {fmtHora(r.fecha_promesa)}</span><br/>
                              <span style={{ opacity: 0.8 }}>en segmento {r.dias_mora != null ? r.dias_mora : '0'}</span>
                            </div>
                          )
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
                        <td colSpan={8} style={{ padding: '10px 14px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, fontSize: 12 }}>
                            <Detail label="Cédula" value={r.cedula || '—'} mono />
                            <Detail label="Contrato" value={r.contrato || '—'} mono />
                            <Detail label="Mora del cliente" value={r.valor_mora != null ? fmt$(r.valor_mora) : '—'} />
                            <Detail label="Duración llamada" value={r.duracion_seg ? `${Math.floor(r.duracion_seg/60)}:${(r.duracion_seg%60).toString().padStart(2,'0')}` : '—'} mono />
                          </div>
                          {r.notas && (
                            <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(0,0,0,0.2)', borderRadius: 6, fontSize: 12, lineHeight: 1.4, opacity: 0.85 }}>
                              <span style={{ fontSize: 12, opacity: 0.5, fontWeight: 700 }}>NOTAS</span>
                              <p style={{ margin: '4px 0 0' }}>{r.notas}</p>
                            </div>
                          )}
                          {/* Formulario de reagendamiento */}
                          {reagendaFormId === r.cdr_id && (
                            <div style={{
                              marginTop: 12, padding: '12px 14px',
                              background: 'rgba(100,181,246,0.05)',
                              border: '1px solid rgba(100,181,246,0.25)',
                              borderRadius: 8,
                            }} onClick={(e) => e.stopPropagation()}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: '#64b5f6', letterSpacing: 0.5, marginBottom: 10 }}>
                                REAGENDAR COMPROMISO
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                                <div>
                                  <div style={{ fontSize: 12, opacity: 0.5, fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>Nueva fecha</div>
                                  <input aria-label="Nueva fecha"
                                    type="date"
                                    value={reagendaFecha}
                                    onChange={(e) => setReagendaFecha(e.target.value)}
                                    style={{
                                      width: '100%', padding: '6px 8px', fontSize: 12, colorScheme: 'dark',
                                      background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(100,181,246,0.3)',
                                      borderRadius: 6, color: 'inherit',
                                    }}
                                  />
                                </div>
                                <div>
                                  <div style={{ fontSize: 12, opacity: 0.5, fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>Hora coordinada</div>
                                  <input aria-label="Hora coordinada"
                                    type="time"
                                    value={reagendaHora}
                                    onChange={(e) => setReagendaHora(e.target.value)}
                                    style={{
                                      width: '100%', padding: '6px 8px', fontSize: 12, colorScheme: 'dark',
                                      background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(100,181,246,0.3)',
                                      borderRadius: 6, color: 'inherit',
                                    }}
                                  />
                                </div>
                                <div>
                                  <div style={{ fontSize: 12, opacity: 0.5, fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>Nuevo valor ($)</div>
                                  <input aria-label="Campo"
                                    type="number" min="0.01" step="0.01"
                                    value={reagendaMonto}
                                    onChange={(e) => setReagendaMonto(e.target.value)}
                                    placeholder="Sin cambio"
                                    style={{
                                      width: '100%', padding: '6px 8px', fontSize: 12,
                                      background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)',
                                      borderRadius: 6, color: 'inherit',
                                    }}
                                  />
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                <button type="button"
                                  onClick={(e) => { e.stopPropagation(); setReagendaFormId(null); }}
                                  style={{
                                    padding: '5px 12px', fontSize: 12, cursor: 'pointer',
                                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                                    borderRadius: 6, color: 'inherit',
                                  }}
                                >Cancelar</button>
                                <button type="button"
                                  onClick={(e) => handleReagendar(e, r.cdr_id)}
                                  disabled={reagendaGuardando}
                                  style={{
                                    padding: '5px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                                    background: '#1565c0', border: 'none',
                                    borderRadius: 6, color: '#fff', opacity: reagendaGuardando ? 0.6 : 1,
                                  }}
                                >
                                  {reagendaGuardando ? 'Guardando…' : 'Confirmar reagendamiento'}
                                </button>
                              </div>
                            </div>
                          )}
                          {/* Formulario de confirmación de pago */}
                          {pagoFormId === r.cdr_id && (
                            <div style={{
                              marginTop: 12, padding: '12px 14px',
                              background: 'rgba(0,230,118,0.05)',
                              border: '1px solid rgba(0,230,118,0.25)',
                              borderRadius: 8,
                            }} onClick={(e) => e.stopPropagation()}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-primary)', letterSpacing: 0.5, marginBottom: 10 }}>
                                CONFIRMAR PAGO REALIZADO
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                                <div>
                                  <div style={{ fontSize: 12, opacity: 0.5, fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>Valor cancelado ($)</div>
                                  <input aria-label="Campo"
                                    type="number" min="0.01" step="0.01"
                                    value={pagoMonto}
                                    onChange={(e) => setPagoMonto(e.target.value)}
                                    placeholder="0.00"
                                    style={{
                                      width: '100%', padding: '6px 8px', fontSize: 12,
                                      background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,230,118,0.3)',
                                      borderRadius: 6, color: 'inherit',
                                    }}
                                  />
                                </div>
                                <div>
                                  <div style={{ fontSize: 12, opacity: 0.5, fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>Nº Comprobante</div>
                                  <input aria-label="Campo"
                                    type="text"
                                    value={pagoComprobante}
                                    onChange={(e) => setPagoComprobante(e.target.value)}
                                    placeholder="Ej: TRF-00123"
                                    style={{
                                      width: '100%', padding: '6px 8px', fontSize: 12,
                                      background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)',
                                      borderRadius: 6, color: 'inherit',
                                    }}
                                  />
                                </div>
                                <div>
                                  <div style={{ fontSize: 12, opacity: 0.5, fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>Forma de pago</div>
                                  <select
                                    value={pagoForma}
                                    onChange={(e) => setPagoForma(e.target.value)}
                                    style={{
                                      width: '100%', padding: '6px 8px', fontSize: 12,
                                      background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)',
                                      borderRadius: 6, color: 'inherit',
                                    }}
                                  >
                                    {FORMAS_PAGO.map(fp => (
                                      <option key={fp.value} value={fp.value}>{fp.label}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                <button type="button"
                                  onClick={(e) => { e.stopPropagation(); setPagoFormId(null); }}
                                  style={{
                                    padding: '5px 12px', fontSize: 12, cursor: 'pointer',
                                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                                    borderRadius: 6, color: 'inherit',
                                  }}
                                >Cancelar</button>
                                <button type="button"
                                  onClick={(e) => handleConfirmarPago(e, r.cdr_id)}
                                  disabled={pagoGuardando}
                                  style={{
                                    padding: '5px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                                    background: 'var(--color-primary)', border: 'none',
                                    borderRadius: 6, color: '#000', opacity: pagoGuardando ? 0.6 : 1,
                                  }}
                                >
                                  {pagoGuardando ? 'Guardando…' : 'Confirmar pago'}
                                </button>
                              </div>
                            </div>
                          )}

                          <div style={{ marginTop: 10, display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                            {esIncumplido ? (
                              <div style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                padding: '5px 12px', borderRadius: 6, fontSize: 12,
                                background: 'rgba(244,67,54,0.08)', border: '1px solid rgba(244,67,54,0.25)',
                                color: '#ef9a9a',
                              }}>
                                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>cancel</span>
                                Compromiso incumplido — contacto reasignado a PENDIENTE
                              </div>
                            ) : (
                              <>
                                {CODIGOS_CONFIRMABLES.has(r.tipificacion_codigo) && pagoFormId !== r.cdr_id && (
                                  <button type="button"
                                    className="btn btn-sm"
                                    style={{
                                      padding: '4px 12px', fontSize: 12, fontWeight: 700,
                                      background: 'rgba(0,230,118,0.12)', border: '1px solid rgba(0,230,118,0.4)',
                                      color: 'var(--color-primary)', borderRadius: 6, cursor: 'pointer',
                                    }}
                                    onClick={(e) => abrirPagoForm(e, r.cdr_id, r.monto_acordado)}
                                  >
                                    <span className="material-symbols-outlined" style={{ fontSize: 13, verticalAlign: 'middle', marginRight: 3 }}>payments</span>
                                    Pago Realizado
                                  </button>
                                )}
                                {CODIGOS_REAGENDABLES.has(r.tipificacion_codigo) && reagendaFormId !== r.cdr_id && (
                                  <button type="button"
                                    className="btn btn-sm"
                                    style={{
                                      padding: '4px 12px', fontSize: 12, fontWeight: 700,
                                      background: 'rgba(100,181,246,0.12)', border: '1px solid rgba(100,181,246,0.4)',
                                      color: '#64b5f6', borderRadius: 6, cursor: 'pointer',
                                    }}
                                    onClick={(e) => abrirReagendaForm(e, r.cdr_id, r.monto_acordado)}
                                  >
                                    <span className="material-symbols-outlined" style={{ fontSize: 13, verticalAlign: 'middle', marginRight: 3 }}>event_repeat</span>
                                    Reagendar
                                  </button>
                                )}
                                {CODIGOS_INCUMPLIBLES.has(r.tipificacion_codigo) && (
                                  <button type="button"
                                    className="btn btn-sm"
                                    disabled={incumpGuardandoId === r.cdr_id}
                                    style={{
                                      padding: '4px 12px', fontSize: 12, fontWeight: 700,
                                      background: 'rgba(244,67,54,0.12)', border: '1px solid rgba(244,67,54,0.4)',
                                      color: '#ef9a9a', borderRadius: 6, cursor: 'pointer',
                                      opacity: incumpGuardandoId === r.cdr_id ? 0.6 : 1,
                                    }}
                                    onClick={(e) => handleIncumplido(e, r.cdr_id)}
                                  >
                                    <span className="material-symbols-outlined" style={{ fontSize: 13, verticalAlign: 'middle', marginRight: 3 }}>cancel</span>
                                    {incumpGuardandoId === r.cdr_id ? 'Marcando…' : 'Incumplido'}
                                  </button>
                                )}
                              </>
                            )}
                            {onGestionar && r.contacto_id && (
                              <button type="button"
                                className="btn btn-primary btn-sm"
                                style={{ padding: '4px 12px', fontSize: 12 }}
                                onClick={(e) => { e.stopPropagation(); onGestionar(r.contacto_id); }}
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>phone_forwarded</span>
                                Gestionar
                              </button>
                            )}
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

const th = { padding: '8px 10px', fontSize: 12, fontWeight: 700, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.4 };
const td = { padding: '8px 10px', verticalAlign: 'middle' };

function KpiCard({ label, value, color, warn }) {
  return (
    <div style={{
      flex: '1 1 160px', minWidth: 140,
      padding: '10px 14px', borderRadius: 8,
      background: warn ? 'rgba(255,152,0,0.08)' : 'rgba(255,255,255,0.03)',
      border: '1px solid ' + (warn ? 'rgba(255,152,0,0.25)' : 'rgba(255,255,255,0.06)'),
    }}>
      <div style={{ fontSize: 12, opacity: 0.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: color || 'inherit' }}>{value}</div>
    </div>
  );
}

function Detail({ label, value, mono }) {
  return (
    <div>
      <div style={{ fontSize: 12, opacity: 0.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div className={mono ? 'text-mono' : ''} style={{ fontSize: 12, marginTop: 2 }}>{value}</div>
    </div>
  );
}
