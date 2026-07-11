import React, { useState, useRef, useEffect, useCallback } from 'react';
import { showToast } from '../shared/Toast';
import { todayLocalISO } from '../shared/timeUtils';
import ExcelJS from 'exceljs';

function buildApiBase() {
  const ws = localStorage.getItem('uphone_ws_ip') || '127.0.0.1';
  return (ws.startsWith('http') ? ws.replace(/\/$/, '') : `http://${ws}:3001`) + '/api';
}
async function vmFetch(apiBase, token, path, options = {}) {
  const res = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const EMPRESAS = [
  { key: 'SCC',     label: 'UPHONE SCC',     color: '#00ff7f' },
  { key: 'TEC_SAS', label: 'UPHONE TEC SAS', color: '#7eb8ff' },
];

const ESTADO_CFG = {
  PAGADO_COMPLETO: { label: 'PAGADO',         color: '#00ff7f', bg: 'rgba(0,255,127,0.12)',  icon: 'check_circle'   },
  PAGO_EXCEDENTE:  { label: 'EXCEDENTE',      color: '#ffc107', bg: 'rgba(255,193,7,0.12)',  icon: 'expand_circle_down' },
  ABONO_PARCIAL:   { label: 'ABONO PARCIAL',  color: '#ff9800', bg: 'rgba(255,152,0,0.10)',  icon: 'timelapse'      },
  SIN_MORA:        { label: 'SIN MORA',       color: '#aaa',    bg: 'rgba(255,255,255,0.06)', icon: 'help'           },
};

const fmt$ = (n) => {
  if (!n && n !== 0) return '—';
  return `$${Number(n).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

async function parsePagosExcel(file, empresaKey) {
  const buffer = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const pagos = [];

  wb.eachSheet((ws) => {
    const getStr = (v) => {
      if (v == null) return '';
      if (v.richText) return v.richText.map(x => x.text).join('').trim();
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      return String(v).trim();
    };

    // La fila de encabezados NO es fija: algunos reportes tienen título merged en fila 1
    // (headers en fila 2) y otros tienen headers directo en fila 1. Detectar la primera
    // fila (entre 1 y 6) que contenga la columna CONTRATO.
    let headerRowNum = -1;
    let headers = [];
    for (let rn = 1; rn <= 6; rn++) {
      const vals = ws.getRow(rn).values;
      if (!vals || vals.length < 2) continue;
      const hs = vals.slice(1).map(getStr);
      if (hs.some(h => h.toUpperCase().includes('CONTRATO'))) {
        headerRowNum = rn;
        headers = hs;
        break;
      }
    }
    if (headerRowNum === -1) return; // hoja sin estructura esperada

    const idxOf = (...names) => {
      for (const n of names) {
        const i = headers.findIndex(h => h.toUpperCase().includes(n.toUpperCase()));
        if (i !== -1) return i + 1; // back to 1-based cell index
      }
      return -1;
    };

    const contratoIdx = idxOf('CONTRATO');
    const montoIdx    = idxOf('MONTO PAGADO');
    const fechaIdx    = idxOf('FECHA DE PAGO');
    const cedulaIdx   = idxOf('CÉDULA', 'CEDULA');
    const nombreIdx   = idxOf('NOMBRE DEL CLIENTE', 'NOMBRE CLIENTE');

    if (contratoIdx < 1) return; // hoja sin estructura esperada

    ws.eachRow((row, rowNum) => {
      if (rowNum <= headerRowNum) return;
      const raw = (i) => i < 1 ? null : row.getCell(i).value;
      const str = (i) => getStr(raw(i));

      const contrato = str(contratoIdx).replace(/\D/g, '');
      if (!contrato) return;

      const montoRaw = raw(montoIdx);
      const monto = typeof montoRaw === 'number'
        ? montoRaw
        : parseFloat(String(montoRaw ?? '').replace(/[^0-9.-]/g, '')) || 0;

      let fecha = str(fechaIdx);
      if (!fecha) {
        const rv = raw(fechaIdx);
        if (rv instanceof Date) fecha = rv.toISOString().slice(0, 10);
      }

      pagos.push({
        contrato,
        cedula:        str(cedulaIdx),
        nombreCliente: str(nombreIdx),
        fechaPago:     fecha.slice(0, 10),
        montoPagado:   monto,
        empresa:       empresaKey,
      });
    });
  });

  return pagos;
}

function TablaRegistros({ rows, histFiltro, onRevertir }) {
  const filtrados = rows.filter(r => {
    if (!histFiltro) return true;
    const q = histFiltro.toLowerCase();
    return (r.contrato || '').toLowerCase().includes(q)
      || (r.nombre_deudor || '').toLowerCase().includes(q)
      || (r.empresa || '').toLowerCase().includes(q);
  });
  if (!filtrados.length) return <p style={{ padding: '16px', opacity: 0.3, fontSize: 12, textAlign: 'center' }}>Sin resultados</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed', minWidth: 750 }}>
        <colgroup>
          <col style={{ width: 75 }} /><col style={{ width: 140 }} /><col style={{ width: 105 }} />
          <col style={{ width: 100 }} /><col style={{ width: 88 }} /><col style={{ width: 88 }} />
          <col style={{ width: 110 }} /><col style={{ width: 44 }} />
        </colgroup>
        <thead>
          <tr style={{ background: 'rgba(0,0,0,0.4)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            {['Contrato','Cliente','Empresa / Campaña','Tipo de Pago','En Mora','Pagado','Confirmado',''].map(h => (
              <th key={h} style={{ padding: '7px 8px', textAlign: 'left', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.55 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtrados.map((r, i) => {
            let ep2 = r.estado_pago;
            if (!ep2 && r.valor_en_mora > 0) {
              const d = r.monto_pagado - r.valor_en_mora;
              ep2 = d > 0.01 ? 'PAGO_EXCEDENTE' : d >= -0.01 ? 'PAGADO_COMPLETO' : 'ABONO_PARCIAL';
            }
            const cfg = ESTADO_CFG[ep2] || ESTADO_CFG.SIN_MORA;
            const esTEC = (r.empresa || '').toUpperCase().includes('TEC');
            return (
              <tr key={r.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontWeight: 700, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.contrato}</td>
                <td style={{ padding: '6px 8px', overflow: 'hidden' }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, fontSize: 12 }}>{r.nombre_deudor}</div>
                  <div style={{ fontSize: 12, opacity: 0.4, marginTop: 1 }}>{r.cedula}</div>
                </td>
                <td style={{ padding: '6px 8px', overflow: 'hidden' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, padding: '1px 5px', borderRadius: 20, display: 'inline-block', background: esTEC ? 'rgba(126,184,255,0.1)' : 'rgba(0,255,127,0.08)', color: esTEC ? '#7eb8ff' : 'var(--color-primary)', border: `1px solid ${esTEC ? 'rgba(126,184,255,0.3)' : 'rgba(0,255,127,0.25)'}`, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.empresa || '—'}</span>
                  <div style={{ fontSize: 12, opacity: 0.45, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.campana_nombre}</div>
                </td>
                <td style={{ padding: '6px 8px' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 6px', borderRadius: 20, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}55`, display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 12 }}>{cfg.icon}</span>{cfg.label}
                  </span>
                </td>
                <td style={{ padding: '6px 8px', fontSize: 12, opacity: 0.75 }}>{r.valor_en_mora > 0 ? fmt$(r.valor_en_mora) : <span style={{ opacity: 0.3 }}>—</span>}</td>
                <td style={{ padding: '6px 8px', fontWeight: 700, color: 'var(--color-primary)', fontSize: 12 }}>{fmt$(r.monto_pagado)}</td>
                <td style={{ padding: '6px 8px', overflow: 'hidden' }}>
                  <div style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{(r.validado_en || '').slice(0, 16).replace('T', ' ')}</div>
                  <div style={{ fontSize: 12, opacity: 0.4, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.validado_por_nombre || '—'}</div>
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                  <button type="button" title="Revertir" onClick={() => onRevertir(r)} style={{ background: 'transparent', border: '1px solid rgba(255,82,82,0.3)', borderRadius: 6, padding: '4px 5px', cursor: 'pointer', color: '#ff5252', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>undo</span>
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function esElegible(m) {
  return m.estadoPago === 'PAGADO_COMPLETO' ||
    m.estadoPago === 'PAGO_EXCEDENTE'  ||
    m.estadoPago === 'ABONO_PARCIAL';
}

export default function ValidacionPagos({ usuario }) {
  // slots[key] = { file, pagos } | null
  const [slots, setSlots] = useState({ SCC: null, TEC_SAS: null });
  const [procesando, setProcesando]   = useState(false);
  const [resultado, setResultado]     = useState(null);
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [confirmando, setConfirmando] = useState(false);
  const [filtroEstado, setFiltroEstado] = useState('TODOS');
  const [filtroEmpresa, setFiltroEmpresa] = useState('TODAS');
  const [historial, setHistorial] = useState([]);
  const [histFiltro, setHistFiltro] = useState('');
  const [sesiones, setSesiones] = useState([]);
  const [sesionAbierta, setSesionAbierta] = useState(null);
  const [corrAsesorId, setCorrAsesorId] = useState('');
  const [corrFecha,    setCorrFecha]    = useState('');
  const [asesores,     setAsesores]     = useState([]);
  const [corrCampanaId, setCorrCampanaId] = useState('');
  const [campanas,      setCampanas]      = useState([]);
  const fileRefs = { SCC: useRef(null), TEC_SAS: useRef(null) };
  const apiBase   = buildApiBase();
  const isRemote  = !!apiBase;
  const authToken = localStorage.getItem('auth_token');

  const cargarHistorial = useCallback(async () => {
    try {
      const [data, sData] = isRemote
        ? await Promise.all([
            vmFetch(apiBase, authToken, '/validacion/historial'),
            vmFetch(apiBase, authToken, '/validacion/sesiones'),
          ])
        : await Promise.all([
            window.api.invoke('validacion:getHistorial'),
            window.api.invoke('validacion:getSesiones'),
          ]);
      setHistorial(data || []);
      setSesiones(sData || []);
    } catch (err) {
      console.error('Error cargando historial:', err);
    }
  }, []);

  useEffect(() => { cargarHistorial(); }, [cargarHistorial]);

  useEffect(() => {
    (isRemote ? vmFetch(apiBase, authToken, '/asesores') : window.api.invoke('db:getAsesores'))
      .then(data => setAsesores(data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    (isRemote ? vmFetch(apiBase, authToken, '/campanas') : window.api.invoke('db:getCampanas'))
      .then(data => setCampanas(data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    setResultado(null);
    setSeleccionados(new Set());
  }, [corrAsesorId, corrFecha, corrCampanaId]);

  async function handleEliminarSesion(sesion) {
    const label = (sesion.creado_en || '').slice(0, 16).replace('T', ' ');
    if (!window.confirm(`¿Eliminar la sesión del ${label}?\n\n${sesion.registros} registros · ${sesion.n_pagado + sesion.n_excedente} contactos volverán a la cola.\n\nEsta acción no se puede deshacer.`)) return;
    try {
      const res = isRemote
        ? await vmFetch(apiBase, authToken, `/validacion/sesiones/${sesion.id}`, { method: 'DELETE' })
        : await window.api.invoke('validacion:eliminarSesion', sesion.id);
      if (res.success) {
        showToast(`Sesión eliminada — ${sesion.n_pagado + sesion.n_excedente} contactos reactivados`, 'info');
        if (sesionAbierta === sesion.id) setSesionAbierta(null);
        cargarHistorial();
      } else {
        showToast(res.error || 'Error al eliminar', 'error');
      }
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  }

  async function handleRevertir(row) {
    if (!window.confirm(`¿Revertir la validación de "${row.nombre_deudor}" (${row.contrato})?\n\nEl contacto volverá a la cola de gestión.`)) return;
    try {
      const res = isRemote
        ? await vmFetch(apiBase, authToken, `/validacion/revertir/${row.contacto_id}`, { method: 'POST' })
        : await window.api.invoke('validacion:revertir', row.contacto_id);
      if (res.success) {
        showToast(`Validación revertida — ${row.nombre_deudor} vuelve a la cola`, 'info');
        cargarHistorial();
      } else {
        showToast(res.error || 'Error al revertir', 'error');
      }
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  }

  async function descargarHistorialExcel() {
    if (!historial.length) return;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Historial Validaciones');
    ws.columns = [
      { header: 'Contrato',       key: 'contrato',          width: 14 },
      { header: 'Cliente',        key: 'nombre_deudor',     width: 28 },
      { header: 'Cédula',         key: 'cedula',            width: 14 },
      { header: 'Empresa',        key: 'empresa',           width: 16 },
      { header: 'Campaña',        key: 'campana_nombre',    width: 22 },
      { header: 'Estado Pago',    key: 'estado_pago',       width: 18 },
      { header: 'Valor en Mora',  key: 'valor_en_mora',     width: 14 },
      { header: 'Monto Pagado',   key: 'monto_pagado',      width: 14 },
      { header: 'Diferencia',     key: 'diferencia',        width: 12 },
      { header: 'Cuotas',         key: 'cuotas',            width: 8  },
      { header: 'Últ. Pago',      key: 'ultima_fecha',      width: 13 },
      { header: 'Validado Por',   key: 'validado_por_nombre', width: 20 },
      { header: 'Validado En',    key: 'validado_en',       width: 20 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A2E' } };
    historial.forEach(r => {
      ws.addRow({
        ...r,
        diferencia: (r.monto_pagado || 0) - (r.valor_en_mora || 0),
      });
    });
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `historial_validaciones_${todayLocalISO()}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleSlotFile(empresaKey, e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setProcesando(true);
    try {
      const pagos = await parsePagosExcel(file, empresaKey);
      setSlots(prev => ({ ...prev, [empresaKey]: { name: file.name, pagos } }));
      showToast(`${pagos.length.toLocaleString()} registros cargados para ${EMPRESAS.find(x => x.key === empresaKey)?.label}`, 'success');
    } catch (err) {
      showToast('Error leyendo archivo: ' + err.message, 'error');
    } finally {
      setProcesando(false);
      if (fileRefs[empresaKey].current) fileRefs[empresaKey].current.value = '';
    }
  }

  function clearSlot(key) {
    setSlots(prev => ({ ...prev, [key]: null }));
    setResultado(null);
    setSeleccionados(new Set());
  }

  async function handleCorrelacionar() {
    if (!canCorrelate) return;
    const todosPagos = [
      ...(slots.SCC?.pagos     || []),
      ...(slots.TEC_SAS?.pagos || []),
    ];
    if (!todosPagos.length) return;
    setProcesando(true);
    setResultado(null);
    setSeleccionados(new Set());
    try {
      const opts = { asesorId: corrAsesorId ? Number(corrAsesorId) : null, fecha: corrFecha, campanaId: corrCampanaId ? Number(corrCampanaId) : null };
      const res = isRemote
        ? await vmFetch(apiBase, authToken, '/validacion/correlacionar', { method: 'POST', body: JSON.stringify({ pagosData: todosPagos, opts }) })
        : await window.api.invoke('validacion:correlacionar', todosPagos, opts);
      setResultado(res);
      if (!res.totalMatches) {
        showToast('Sin coincidencias en campañas activas', 'warning');
        return;
      }
      // Auto-seleccionar solo PAGADO_COMPLETO y PAGO_EXCEDENTE
      const autoSel = new Set(
        res.matches
          .filter(m => !m.yaPago && (
            m.estadoPago === 'PAGADO_COMPLETO' ||
            m.estadoPago === 'PAGO_EXCEDENTE'  ||
            m.estadoPago === 'ABONO_PARCIAL'
          ))
          .map(m => m.contactoId)
      );
      setSeleccionados(autoSel);
      const nCompletos = res.matches.filter(m => !m.yaPago && (m.estadoPago === 'PAGADO_COMPLETO' || m.estadoPago === 'PAGO_EXCEDENTE')).length;
      const nAbonos   = res.matches.filter(m => !m.yaPago && m.estadoPago === 'ABONO_PARCIAL').length;
      showToast(
        `${res.totalMatches} coincidencias · ${nCompletos} pagos completos · ${nAbonos} abonos parciales`,
        'info'
      );
    } catch (err) {
      showToast('Error correlación: ' + err.message, 'error');
    } finally {
      setProcesando(false);
    }
  }

  async function handleConfirmar() {
    if (!seleccionados.size) return;
    setConfirmando(true);
    try {
      const ids = [...seleccionados];
      const matchesSel = resultado.matches.filter(m => seleccionados.has(m.contactoId));
      const res = isRemote
        ? await vmFetch(apiBase, authToken, '/validacion/confirmar', { method: 'POST', body: JSON.stringify({ contactoIds: ids, matches: matchesSel }) })
        : await window.api.invoke('validacion:confirmarPagos', ids, matchesSel, usuario?.id);
      if (res.success) {
        const nPagados = matchesSel.filter(m => m.estadoPago !== 'ABONO_PARCIAL').length;
        const nAbonos  = matchesSel.filter(m => m.estadoPago === 'ABONO_PARCIAL').length;
        const msg = [
          nPagados && `${nPagados} excluidos del marcador`,
          nAbonos  && `${nAbonos} abonos registrados`,
        ].filter(Boolean).join(' · ');
        showToast(msg, 'success');
        cargarHistorial();
        setResultado(prev => ({
          ...prev,
          matches: prev.matches.map(m => {
            if (!seleccionados.has(m.contactoId)) return m;
            // ABONO_PARCIAL: queda visible (sigue en cola), solo refresh del historial
            return m.estadoPago === 'ABONO_PARCIAL' ? m : { ...m, yaPago: true };
          }),
        }));
        setSeleccionados(new Set());
      } else {
        showToast(res.error || 'Error al confirmar', 'error');
      }
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      setConfirmando(false);
    }
  }

  // ABONO_PARCIAL es seleccionable pero solo se registra (no excluye del marcador)

  const matchesFiltrados = (resultado?.matches ?? []).filter(m => {
    if (filtroEstado !== 'TODOS' && m.estadoPago !== filtroEstado) return false;
    if (filtroEmpresa !== 'TODAS') {
      // empresa del contacto (metadata) o empresa del slot
      const empContacto = (m.empresa || '').toUpperCase();
      if (filtroEmpresa === 'SCC'     && !empContacto.includes('SCC')) return false;
      if (filtroEmpresa === 'TEC_SAS' && !empContacto.includes('TEC') && !empContacto.includes('SAS')) return false;
    }
    return true;
  });

  const statsByEstado = resultado
    ? Object.keys(ESTADO_CFG).reduce((acc, k) => {
        acc[k] = resultado.matches.filter(m => m.estadoPago === k);
        return acc;
      }, {})
    : {};

  const totalSelMonto = resultado?.matches
    .filter(m => seleccionados.has(m.contactoId))
    .reduce((s, m) => s + (m.montoPagado || 0), 0) ?? 0;

  const anySlot = slots.SCC || slots.TEC_SAS;
  const canCorrelate = !!(anySlot && corrFecha);

  return (
    <div style={{ padding: '16px 20px', width: '100%', boxSizing: 'border-box', overflowX: 'auto' }}>

      {/* Header */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 22, color: 'var(--color-primary)' }}>verified</span>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 900, color: 'var(--color-on-surface)', margin: 0 }}>Validación de Pagos</h2>
          <p style={{ fontSize: 12, opacity: 0.5, margin: 0 }}>Carga los reportes de cuotas por empresa para excluir clientes ya solventes del marcador.</p>
        </div>
      </div>

      {/* Upload slots */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {EMPRESAS.map(emp => {
          const slot = slots[emp.key];
          return (
            <div key={emp.key} style={{
              background: 'linear-gradient(145deg, #151515, #080808)',
              border: `1px ${slot ? 'solid' : 'dashed'} ${slot ? emp.color + '55' : 'rgba(255,255,255,0.12)'}`,
              borderRadius: 12, padding: 16,
              transition: 'border-color 0.2s',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: emp.color, display: 'inline-block' }} />
                <span style={{ fontWeight: 800, fontSize: 13, color: emp.color }}>{emp.label}</span>
              </div>

              {slot ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 20, color: emp.color }}>table_view</span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{slot.pagos.length.toLocaleString()} registros cargados</div>
                      <div style={{ fontSize: 12, opacity: 0.5 }}>{slot.name}</div>
                    </div>
                  </div>
                  <button type="button"
                    className="btn btn-outline"
                    style={{ fontSize: 12, padding: '5px 10px', color: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}
                    onClick={() => clearSlot(emp.key)}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 4 }}>delete</span>
                    Quitar archivo
                  </button>
                </div>
              ) : (
                <div
                  style={{ textAlign: 'center', cursor: 'pointer', padding: '12px 0' }}
                  onClick={() => fileRefs[emp.key].current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault();
                    if (e.dataTransfer.files[0]) handleSlotFile(emp.key, { target: { files: e.dataTransfer.files } });
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 32, color: emp.color, opacity: 0.6, display: 'block', marginBottom: 8 }}>upload_file</span>
                  <p style={{ fontSize: 12, opacity: 0.55, margin: 0 }}>Arrastra o haz clic</p>
                  <p style={{ fontSize: 12, opacity: 0.35, margin: '4px 0 0' }}>ReportUphone_ReporteCuotas_*.xlsx</p>
                </div>
              )}
              <input aria-label="Arrastra o haz clic"
                ref={fileRefs[emp.key]}
                type="file" accept=".xlsx,.xls" hidden
                onChange={e => handleSlotFile(emp.key, e)}
              />
            </div>
          );
        })}
      </div>

      {/* Correlate bar */}
      {anySlot && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          {/* Selector asesor */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 17, color: 'var(--color-primary)', opacity: 0.7 }}>person_search</span>
            <select
              value={corrAsesorId}
              onChange={e => setCorrAsesorId(e.target.value)}
              style={{
                background: '#151515', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 8, color: 'var(--color-on-surface)',
                fontSize: 12, padding: '7px 10px', cursor: 'pointer',
              }}
            >
              <option value="">Todos los asesores</option>
              {asesores.map(a => (
                <option key={a.id} value={a.id}>{a.nombre}</option>
              ))}
            </select>
          </div>

          {/* Fecha asignación */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 17, color: 'var(--color-primary)', opacity: 0.7 }}>calendar_today</span>
            <input aria-label="Campo"
              type="date"
              value={corrFecha}
              onChange={e => setCorrFecha(e.target.value)}
              style={{
                background: '#151515', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 8, color: 'var(--color-on-surface)',
                fontSize: 12, padding: '7px 10px',
              }}
            />
          </div>

          {/* Selector campaña */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 17, color: 'var(--color-primary)', opacity: 0.7 }}>campaign</span>
            <select
              value={corrCampanaId}
              onChange={e => setCorrCampanaId(e.target.value)}
              style={{
                background: '#151515', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 8, color: 'var(--color-on-surface)',
                fontSize: 12, padding: '7px 10px', cursor: 'pointer',
              }}
            >
              <option value="">Todas las campañas</option>
              {campanas.map(c => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </div>

          {/* Botón */}
          <button type="button"
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '10px 20px' }}
            onClick={handleCorrelacionar}
            disabled={procesando || !canCorrelate}
            title={!canCorrelate ? 'Seleccioná una fecha para correlacionar' : ''}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>sync</span>
            {procesando ? 'Correlacionando…' : 'Correlacionar con Campañas'}
          </button>
        </div>
      )}

      {/* Stats cards */}
      {resultado && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, marginBottom: 14 }}>
          {[
            { label: 'Contratos reporte', value: Number(resultado.totalContratos ?? 0).toLocaleString(), color: 'var(--color-on-surface)', icon: 'receipt_long' },
            { label: 'Coincidencias',     value: Number(resultado.totalMatches ?? 0).toLocaleString(),   color: 'var(--color-primary)',    icon: 'link' },
            { label: 'Pagos completos',   value: ((statsByEstado.PAGADO_COMPLETO?.length||0) + (statsByEstado.PAGO_EXCEDENTE?.length||0)).toString(), color: '#00ff7f', icon: 'check_circle' },
            { label: 'Abonos parciales',  value: (statsByEstado.ABONO_PARCIAL?.length || 0).toString(), color: '#ff9800', icon: 'timelapse' },
            { label: 'Seleccionados',     value: seleccionados.size.toString(), color: '#ffc107', icon: 'done_all' },
            { label: 'Monto a validar',   value: fmt$(totalSelMonto), color: 'var(--color-danger)', icon: 'payments' },
          ].map((s) => (
            <div key={s.label} style={{
              background: 'linear-gradient(145deg, #151515, #080808)',
              border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10, padding: '10px 14px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 14, color: s.color }}>{s.icon}</span>
                <span style={{ fontSize: 12, opacity: 0.6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</span>
              </div>
              <div style={{ fontSize: 20, fontWeight: 900, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      {resultado && resultado.totalMatches > 0 && (
        <>
          {/* Filtros + acciones */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
            {/* Filtro estado */}
            <div style={{ display: 'flex', gap: 5 }}>
              {['TODOS', ...Object.keys(ESTADO_CFG)].map(k => (
                <button type="button"
                  key={k}
                  className={`btn ${filtroEstado === k ? 'btn-primary' : 'btn-outline'}`}
                  style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => setFiltroEstado(k)}
                >
                  {k === 'TODOS' ? 'Todos' : ESTADO_CFG[k].label}
                  {k !== 'TODOS' && statsByEstado[k] && (
                    <span style={{ marginLeft: 5, opacity: 0.7 }}>({statsByEstado[k].length})</span>
                  )}
                </button>
              ))}
            </div>
            {/* Filtro empresa */}
            <div style={{ display: 'flex', gap: 5 }}>
              {['TODAS', ...EMPRESAS.map(e => e.key)].map(k => (
                <button type="button"
                  key={k}
                  className={`btn ${filtroEmpresa === k ? 'btn-primary' : 'btn-outline'}`}
                  style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => setFiltroEmpresa(k)}
                >
                  {k === 'TODAS' ? 'Todas empresas' : EMPRESAS.find(e => e.key === k)?.label}
                </button>
              ))}
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button type="button"
                className="btn btn-outline"
                style={{ fontSize: 12, padding: '5px 10px' }}
                onClick={() => {
                  const elegibles = matchesFiltrados.filter(
                    m => !m.yaPago && (m.estadoPago === 'PAGADO_COMPLETO' || m.estadoPago === 'PAGO_EXCEDENTE')
                  );
                  setSeleccionados(new Set(elegibles.map(m => m.contactoId)));
                }}
              >
                Sel. pagos completos
              </button>
              <button type="button"
                className="btn btn-outline"
                style={{ fontSize: 12, padding: '5px 10px' }}
                onClick={() => {
                  const abonos = matchesFiltrados.filter(m => m.estadoPago === 'ABONO_PARCIAL');
                  setSeleccionados(prev => {
                    const n = new Set(prev);
                    abonos.forEach(m => n.add(m.contactoId));
                    return n;
                  });
                }}
              >
                Sel. abonos
              </button>
              <button type="button"
                className="btn btn-outline"
                style={{ fontSize: 12, padding: '5px 10px' }}
                onClick={() => setSeleccionados(new Set())}
              >
                Limpiar
              </button>
              <button type="button"
                className="btn btn-primary"
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                onClick={handleConfirmar}
                disabled={!seleccionados.size || confirmando}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>verified</span>
                {confirmando ? 'Guardando…' : `Confirmar ${seleccionados.size} pagados`}
              </button>
            </div>
          </div>

          <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)', width: '100%' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed', minWidth: 999 }}>
              <colgroup>
                <col style={{ width: 34 }} />   {/* checkbox */}
                <col style={{ width: 88 }} />   {/* contrato */}
                <col style={{ width: 175 }} />  {/* cliente/cédula */}
                <col style={{ width: 98 }} />   {/* empresa */}
                <col style={{ width: 130 }} />  {/* campaña */}
                <col style={{ width: 90 }} />   {/* en mora */}
                <col style={{ width: 90 }} />   {/* pagado */}
                <col style={{ width: 82 }} />   {/* diferencia */}
                <col style={{ width: 82 }} />   {/* últ. pago */}
                <col style={{ width: 130 }} />  {/* estado */}
              </colgroup>
              <thead>
                <tr style={{ background: 'rgba(0,0,0,0.4)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <th style={{ width: 34, padding: '8px 10px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      style={{ accentColor: 'var(--color-primary)' }}
                      checked={
                        matchesFiltrados.filter(m => !m.yaPago && esElegible(m)).length > 0 &&
                        matchesFiltrados.filter(m => !m.yaPago && esElegible(m))
                          .every(m => seleccionados.has(m.contactoId))
                      }
                      onChange={e => {
                        const elegibles = matchesFiltrados.filter(m => !m.yaPago && esElegible(m));
                        if (e.target.checked) {
                          setSeleccionados(prev => {
                            const n = new Set(prev);
                            elegibles.forEach(m => n.add(m.contactoId));
                            return n;
                          });
                        } else {
                          setSeleccionados(prev => {
                            const n = new Set(prev);
                            elegibles.forEach(m => n.delete(m.contactoId));
                            return n;
                          });
                        }
                      }}
                    />
                  </th>
                  {['Contrato','Cliente / Cédula','Empresa','Campaña','Gestor','En Mora','Pagado','Diferencia','Últ. Pago','Estado'].map(h => (
                    <th key={h} style={{
                      padding: '8px 8px', textAlign: 'left', fontWeight: 800, fontSize: 12,
                      textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.65, whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matchesFiltrados.map((m, i) => {
                  const cfg = ESTADO_CFG[m.estadoPago] || ESTADO_CFG.SIN_MORA;
                  const elegible = esElegible(m);
                  const sel = seleccionados.has(m.contactoId);
                  return (
                    <tr
                      key={m.contactoId}
                      style={{
                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                        background: m.yaPago
                          ? 'rgba(0,255,127,0.04)'
                          : sel ? 'rgba(255,193,7,0.05)' : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                        cursor: (m.yaPago || !elegible) ? 'default' : 'pointer',
                        opacity: m.estadoPago === 'ABONO_PARCIAL' ? 0.85 : 1,
                      }}
                      onClick={() => {
                        if (m.yaPago || !elegible) return;
                        setSeleccionados(prev => {
                          const n = new Set(prev);
                          n.has(m.contactoId) ? n.delete(m.contactoId) : n.add(m.contactoId);
                          return n;
                        });
                      }}
                    >
                      <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                        {m.yaPago
                          ? <span className="material-symbols-outlined" style={{ fontSize: 14, color: 'var(--color-primary)' }}>check_circle</span>
                          : elegible
                            ? <input aria-label="Campo" type="checkbox" checked={sel} onChange={() => {}} style={{ accentColor: 'var(--color-primary)' }} />
                            : <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#ff9800', opacity: 0.6 }}>block</span>
                        }
                      </td>
                      <td style={{ padding: '6px 8px', fontWeight: 700, fontFamily: 'monospace', fontSize: 12 }}>{m.contrato}</td>
                      <td style={{ padding: '6px 8px', overflow: 'hidden' }}>
                        <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>{m.nombreDeudor}</div>
                        <div style={{ fontSize: 12, opacity: 0.55, marginTop: 1 }}>{m.cedula}</div>
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 6px', borderRadius: 20,
                          background: m.empresa?.toUpperCase().includes('TEC') ? 'rgba(126,184,255,0.1)' : 'rgba(0,255,127,0.08)',
                          color: m.empresa?.toUpperCase().includes('TEC') ? '#7eb8ff' : 'var(--color-primary)',
                          border: `1px solid ${m.empresa?.toUpperCase().includes('TEC') ? 'rgba(126,184,255,0.3)' : 'rgba(0,255,127,0.25)'}`,
                          display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {m.empresa || '—'}
                        </span>
                      </td>
                      <td style={{ padding: '6px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.75, fontSize: 12 }}>{m.campanaNombre}</td>
                      <td style={{ padding: '6px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, opacity: 0.85 }}>{m.asesorNombre || '—'}</td>
                      <td style={{ padding: '6px 8px', opacity: 0.8, fontSize: 12 }}>{fmt$(m.valorEnMora)}</td>
                      <td style={{ padding: '6px 8px', fontWeight: 700, color: 'var(--color-primary)', fontSize: 12 }}>{fmt$(m.montoPagado)}</td>
                      <td style={{ padding: '6px 8px', fontWeight: 700, fontSize: 12,
                        color: m.diferencia > 0.01 ? '#ffc107' : m.diferencia < -0.01 ? '#ff9800' : 'var(--color-primary)',
                      }}>
                        {m.diferencia > 0.01 ? '+' : ''}{fmt$(m.diferencia)}
                      </td>
                      <td style={{ padding: '6px 8px', opacity: 0.65, whiteSpace: 'nowrap', fontSize: 12 }}>{m.ultimaFecha?.slice(0,10) || '—'}</td>
                      <td style={{ padding: '7px 10px' }}>
                        <span style={{
                          fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                          background: m.yaPago ? 'rgba(0,255,127,0.1)' : cfg.bg,
                          color: m.yaPago ? 'var(--color-primary)' : cfg.color,
                          border: `1px solid ${m.yaPago ? 'rgba(0,255,127,0.3)' : cfg.color + '55'}`,
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                        }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 12 }}>
                            {m.yaPago ? 'verified' : cfg.icon}
                          </span>
                          {m.yaPago ? 'CONFIRMADO' : cfg.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p style={{ fontSize: 12, opacity: 0.35, marginTop: 8 }}>
            {matchesFiltrados.length} filas · Solo pagos completos y excedentes pueden confirmarse · Abonos parciales quedan en gestión activa
          </p>
        </>
      )}

      {/* ── Historial de Validaciones Confirmadas ── */}
      {(() => {
        const consolidado = historial.reduce((acc, r) => {
          let ep = r.estado_pago;
          if (!ep && r.valor_en_mora > 0) {
            const diff = r.monto_pagado - r.valor_en_mora;
            if (diff > 0.01)       ep = 'PAGO_EXCEDENTE';
            else if (diff >= -0.01) ep = 'PAGADO_COMPLETO';
            else                    ep = 'ABONO_PARCIAL';
          }
          acc.total++;
          acc.montoTotal += r.monto_pagado || 0;
          if (!acc.porEstado[ep]) acc.porEstado[ep] = { count: 0, monto: 0 };
          acc.porEstado[ep].count++;
          acc.porEstado[ep].monto += r.monto_pagado || 0;
          const empNorm = (r.empresa || '').toUpperCase();
          const empKey = (empNorm.includes('TEC') || empNorm.includes('SAS')) ? 'TEC_SAS'
            : empNorm.includes('SCC') ? 'SCC' : null;
          if (empKey) {
            if (!acc.porEmpresa[empKey]) acc.porEmpresa[empKey] = { count: 0, monto: 0 };
            acc.porEmpresa[empKey].count++;
            acc.porEmpresa[empKey].monto += r.monto_pagado || 0;
          }
          return acc;
        }, { total: 0, montoTotal: 0, porEstado: {}, porEmpresa: {} });


        return (
        <div style={{ marginTop: 28 }}>

          {/* Card grand consolidado */}
          <div style={{ background: 'linear-gradient(145deg, #151515, #080808)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '14px 18px', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: consolidado.total > 0 ? 14 : 0 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--color-primary)', opacity: 0.8 }}>history</span>
              <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.6 }}>Historial de Validaciones Confirmadas</span>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
              {historial.length > 0 && <span style={{ fontSize: 12, opacity: 0.45 }}>{historial.length} registros · {sesiones.length} sesiones</span>}
              <button type="button" className="btn btn-outline" style={{ fontSize: 12, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 6 }} onClick={descargarHistorialExcel} disabled={!historial.length}>
                <span className="material-symbols-outlined" style={{ fontSize: 15 }}>download</span>Exportar
              </button>
            </div>

            {consolidado.total > 0 && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ background: 'rgba(0,255,127,0.06)', border: '1px solid rgba(0,255,127,0.15)', borderRadius: 10, padding: '10px 16px', minWidth: 130 }}>
                  <div style={{ fontSize: 12, opacity: 0.55, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Total Validado</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--color-primary)', lineHeight: 1 }}>{consolidado.total}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-primary)', opacity: 0.75, marginTop: 3 }}>{fmt$(consolidado.montoTotal)}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flex: 1 }}>
                  {Object.entries(ESTADO_CFG).filter(([k]) => k !== 'SIN_MORA').map(([k, cfg]) => {
                    const data = consolidado.porEstado[k] || { count: 0, monto: 0 };
                    return (
                      <div key={k} style={{ background: cfg.bg, border: `1px solid ${cfg.color}33`, borderRadius: 10, padding: '10px 14px', minWidth: 110, opacity: data.count === 0 ? 0.45 : 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 12, color: cfg.color }}>{cfg.icon}</span>
                          <span style={{ fontSize: 12, opacity: 0.6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{cfg.label}</span>
                        </div>
                        <div style={{ fontSize: 20, fontWeight: 900, color: cfg.color, lineHeight: 1 }}>{data.count}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: cfg.color, opacity: 0.7, marginTop: 3 }}>{data.monto > 0 ? fmt$(data.monto) : '—'}</div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center' }}>
                  {EMPRESAS.map(emp => {
                    const data = consolidado.porEmpresa[emp.key] || { count: 0, monto: 0 };
                    return (
                      <div key={emp.key} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '6px 12px', opacity: data.count === 0 ? 0.45 : 1 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: emp.color, flexShrink: 0 }} />
                        <span style={{ fontSize: 12, color: emp.color, fontWeight: 700, minWidth: 100 }}>{emp.label}</span>
                        <span style={{ fontSize: 12, fontWeight: 700 }}>{data.count}</span>
                        <span style={{ fontSize: 12, opacity: 0.55 }}>{data.monto > 0 ? fmt$(data.monto) : '—'}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {historial.length === 0 && (
              <div style={{ textAlign: 'center', padding: '20px 0', opacity: 0.3, fontSize: 12 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 32, display: 'block', marginBottom: 6 }}>inventory_2</span>
                Sin validaciones confirmadas aún
              </div>
            )}
          </div>

          {/* Registros sin sesión (historial legacy o sesión borrada) */}
          {(() => {
            const sesionIds = new Set(sesiones.map(s => s.id));
            const huerfanos = historial.filter(r => !r.sesion_id || !sesionIds.has(r.sesion_id));
            if (!huerfanos.length) return null;
            const abierta = sesionAbierta === '__huerfanos__';
            return (
              <div style={{ marginBottom: 8, border: `1px solid ${abierta ? 'rgba(255,152,0,0.25)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 10, overflow: 'hidden' }}>
                <div onClick={() => setSesionAbierta(abierta ? null : '__huerfanos__')} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', background: 'rgba(255,255,255,0.02)', userSelect: 'none' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#ff9800', opacity: 0.7 }}>history</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>Registros sin sesión agrupada</div>
                    <div style={{ fontSize: 12, opacity: 0.4 }}>{huerfanos.length} contratos validados anteriormente</div>
                  </div>
                  <span className="material-symbols-outlined" style={{ fontSize: 18, opacity: 0.4, transform: abierta ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>expand_more</span>
                </div>
                {abierta && (
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '10px 14px' }}>
                    <input aria-label="Buscar contrato, cliente, empresa…" type="text" placeholder="Buscar contrato, cliente, empresa…" value={histFiltro} onChange={e => setHistFiltro(e.target.value)}
                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '6px 12px', fontSize: 12, color: '#fff', width: 280, marginBottom: 10 }} />
                    <TablaRegistros rows={huerfanos} histFiltro={histFiltro} onRevertir={handleRevertir} />
                  </div>
                )}
              </div>
            );
          })()}

          {/* Lista de sesiones */}
          {sesiones.map(ses => {
            const abierta = sesionAbierta === ses.id;
            const registrosSesion = historial.filter(r => r.sesion_id === ses.id);
            const label = (ses.creado_en || '').slice(0, 16).replace('T', ' ');
            return (
              <div key={ses.id} style={{ marginBottom: 8, border: `1px solid ${abierta ? 'rgba(0,255,127,0.2)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 10, overflow: 'hidden', transition: 'border-color 0.2s' }}>
                <div onClick={() => setSesionAbierta(abierta ? null : ses.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', background: abierta ? 'rgba(0,255,127,0.04)' : 'rgba(255,255,255,0.02)', userSelect: 'none' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--color-primary)', opacity: 0.7 }}>receipt_long</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{label}</div>
                    <div style={{ fontSize: 12, opacity: 0.4 }}>{ses.supervisor_nombre || 'Sin Jefe de Area'}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {ses.n_pagado > 0 && <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'rgba(0,255,127,0.1)', color: '#00ff7f', border: '1px solid rgba(0,255,127,0.25)' }}>✓ {ses.n_pagado} pagados</span>}
                    {ses.n_excedente > 0 && <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'rgba(255,193,7,0.1)', color: '#ffc107', border: '1px solid rgba(255,193,7,0.25)' }}>↑ {ses.n_excedente} excedentes</span>}
                    {ses.n_abono > 0 && <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'rgba(255,152,0,0.1)', color: '#ff9800', border: '1px solid rgba(255,152,0,0.25)' }}>~ {ses.n_abono} abonos · {fmt$(ses.monto_abono)}</span>}
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 90 }}>
                    <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--color-primary)' }}>{fmt$(ses.monto_real)}</div>
                    <div style={{ fontSize: 12, opacity: 0.4 }}>{ses.registros} contratos</div>
                  </div>
                  <button type="button" title="Eliminar sesión en bloque" onClick={e => { e.stopPropagation(); handleEliminarSesion(ses); }} style={{ background: 'transparent', border: '1px solid rgba(255,82,82,0.3)', borderRadius: 6, padding: '4px 6px', cursor: 'pointer', color: '#ff5252', display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 15 }}>delete_sweep</span>
                  </button>
                  <span className="material-symbols-outlined" style={{ fontSize: 18, opacity: 0.4, transform: abierta ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }}>expand_more</span>
                </div>
                {abierta && (
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '10px 14px' }}>
                    <input aria-label="Buscar contrato, cliente, empresa…" type="text" placeholder="Buscar contrato, cliente, empresa…" value={histFiltro} onChange={e => setHistFiltro(e.target.value)}
                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '6px 12px', fontSize: 12, color: '#fff', width: 280, marginBottom: 10 }} />
                    <TablaRegistros rows={registrosSesion} histFiltro={histFiltro} onRevertir={handleRevertir} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
      })()}
    </div>
  );
}
