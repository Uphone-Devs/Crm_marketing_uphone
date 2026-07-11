import React, { useState, useRef, useEffect } from 'react';
import { showToast } from '../shared/Toast';
import ExcelJS from 'exceljs';
const _EMPTY_ARR = [];
const _EMPTY_OBJ = {};

const SIN_GESTOR = '__SIN_GESTOR__';

const normalizarNombre = (s) => (s || '').toLowerCase().trim().replace(/\s+/g, ' ');

function buildApiBase() {
  const ws = localStorage.getItem('uphone_ws_ip') || '127.0.0.1';
  return (ws.startsWith('http') ? ws.replace(/\/$/, '') : `http://${ws}:3001`) + '/api';
}

async function vmFetch(apiBase, token, path, options = _EMPTY_OBJ) {
  const res = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function parsearXLSX(f) {
  const buffer = await f.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const ws = workbook.worksheets[0];
  const row1 = ws.getRow(1);
  if (!row1?.values) throw new Error('El archivo no tiene datos en la fila 1 (cabecera).');

  const rawHeaders = Array.isArray(row1.values) ? row1.values : Object.values(row1.values);
  const headers = rawHeaders.map(h => (h?.toString() || '').trim().toUpperCase());

  const findIdx = (patterns) =>
    headers.findIndex(h => h && patterns.some(p => h.includes(p)));
  const findIdxExact = (patterns) =>
    headers.findIndex(h => h && patterns.some(p => h === p));

  const telIdx    = findIdx(['TELEFONO', 'CELULAR', 'MOVIL', 'CONTACTO']);
  const nomIdx    = findIdx(['NOMBRE', 'NOMBRES', 'CLIENTE']);
  const apeIdx    = findIdx(['APELLIDO', 'APELLIDOS']);
  const cedIdx    = findIdx(['CEDULA', 'IDENTIFICACION', 'DNI', 'CÉDULA']);
  const montoIdx  = (() => {
    const idx = findIdx(['VALOR EN MORA', 'MONTO POR COBRAR', 'DEUDA TOTAL', 'MONTO', 'VALOR', 'DEUDA', 'SALDO', 'TOTAL']);
    return idx !== -1 ? idx : findIdxExact(['MORA']);
  })();
  const prodIdx   = findIdx(['PRODUCTO', 'GRUPO', 'CARTERA', 'CAMPAÑA', 'LOT']);
  const gestorIdx = findIdx(['GESTOR', 'AGENTE', 'COBRADOR']);
  const fventaIdx = findIdx(['FECHA DE VENTA', 'FECHA VENTA', 'FECHA DE COMPRA', 'FECHA COMPRA']);

  // #7 — Empresa según fecha de compra: >= 2026-01-01 → UPHONE TEC SAS; <= 2025-12-31 → UPHONE SCC.
  // Serial Excel de 2026-01-01 = 46023 (epoch 1899-12-30).
  const SERIAL_2026 = 46023;
  const empresaPorSerial = (serial) => serial >= SERIAL_2026 ? 'UPHONE TEC SAS' : 'UPHONE SCC';
  const empresaDeFechaVenta = (row) => {
    if (fventaIdx <= 0) return '';
    const v = row.getCell(fventaIdx).value;
    let serial = null;
    if (typeof v === 'number') serial = v;
    else if (v instanceof Date) serial = Math.floor((v.getTime() - Date.UTC(1899, 11, 30)) / 86400000);
    else {
      const s = String((v && typeof v === 'object' && 'result' in v ? v.result : v) ?? '').trim();
      if (/^\d+(\.\d+)?$/.test(s)) serial = parseFloat(s);
    }
    return serial != null ? empresaPorSerial(serial) : '';
  };

  const contactos = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const getVal = (idx) => {
      if (idx <= 0) return '';
      const cell = row.getCell(idx);
      const v = cell.value;
      if (v == null) return '';
      if (typeof v === 'object' && 'result' in v) return String(v.result ?? '').trim();
      if (typeof v === 'object' && 'richText' in v) return v.richText.map(x => x.text).join('').trim();
      return String(v).trim();
    };
    const telefono = getVal(telIdx).replace(/\D/g, '');
    if (!telefono) return;

    const metadata = {};
    headers.forEach((header, index) => {
      if (header && index > 0) metadata[header] = getVal(index);
    });
    // #7 — Etiquetar empresa por fecha de compra (para validación y cruce por empresa).
    const empresaCliente = empresaDeFechaVenta(row);
    if (empresaCliente) metadata['EMPRESA'] = empresaCliente;

    contactos.push({
      telefono,
      cedula:   getVal(cedIdx),
      nombre:   `${getVal(nomIdx)} ${getVal(apeIdx)}`.trim() || 'Cliente Sin Nombre',
      monto:    parseFloat(getVal(montoIdx).replace(/[^0-9.]/g, '')) || 0,
      producto: getVal(prodIdx) || 'General',
      gestor:   gestorIdx > 0 ? getVal(gestorIdx) : '',
      metadata,
    });
  });

  return { contactos, hayGestor: gestorIdx > 0 };
}

async function parsearCSV(texto) {
  const lineas = texto.split('\n').filter(l => l.trim());
  if (lineas.length < 2) return { contactos: [], hayGestor: false };

  const headers = lineas[0].split(',').map(h => h.trim().toUpperCase());
  const findIdx = (patterns) =>
    headers.findIndex(h => patterns.some(p => h.includes(p)));

  const telIdx    = findIdx(['TELEFONO', 'CELULAR']);
  const nomIdx    = findIdx(['NOMBRE']);
  const apeIdx    = findIdx(['APELLIDO']);
  const cedIdx    = findIdx(['CEDULA']);
  const montoIdx  = findIdx(['VALOR EN MORA', 'MONTO POR COBRAR', 'DEUDA TOTAL', 'MONTO', 'VALOR']);
  const prodIdx   = findIdx(['PRODUCTO', 'GRUPO']);
  const gestorIdx = findIdx(['GESTOR', 'AGENTE', 'COBRADOR']);

  const contactos = lineas.slice(1).reduce((acc, linea) => {
    const cols = linea.split(',');
    const telefono = (cols[telIdx] || '').replace(/"/g, '').replace(/\D/g, '').trim();
    if (!telefono) return acc;

    const metadata = {};
    headers.forEach((h, i) => {
      if (h) metadata[h] = (cols[i] || '').replace(/"/g, '').trim();
    });

    acc.push({
      telefono,
      cedula:   (cols[cedIdx]   || '').replace(/"/g, '').trim(),
      nombre:   `${cols[nomIdx] || ''} ${cols[apeIdx] || ''}`.replace(/"/g, '').trim() || 'Cliente CSV',
      monto:    parseFloat((cols[montoIdx] || '').replace(/[^0-9.]/g, '')) || 0,
      producto: prodIdx !== -1 ? (cols[prodIdx] || '').replace(/"/g, '').trim() : 'Base CSV',
      gestor:   gestorIdx !== -1 ? (cols[gestorIdx] || '').replace(/"/g, '').trim() : '',
      metadata,
    });
    return acc;
  }, []);

  return { contactos, hayGestor: gestorIdx !== -1 };
}

function agruparPorGestor(contactos) {
  const map = new Map();
  for (const c of contactos) {
    const key = c.gestor?.trim() || SIN_GESTOR;
    if (!map.has(key)) map.set(key, { contactos: [], monto: 0 });
    const g = map.get(key);
    g.contactos.push(c);
    g.monto += c.monto;
  }
  const sorted = new Map([...map.entries()].sort((a, b) => {
    if (a[0] === SIN_GESTOR) return 1;
    if (b[0] === SIN_GESTOR) return -1;
    return a[0].localeCompare(b[0]);
  }));
  return sorted;
}

export default function Campaigns({ asesores: asesoresProp, usuario, estadosWS = _EMPTY_OBJ }) {
  const apiBase   = buildApiBase();
  const isRemote  = !!apiBase;
  const authToken = localStorage.getItem('auth_token');
  const [asesoresVm, setAsesoresVm]           = useState(null);
  const [asesoresVmLoading, setAsesoresVmLoading] = useState(isRemote);
  const [asesoresVmError, setAsesoresVmError]   = useState(null);

  // En VM mode NUNCA usar IDs locales — causaría asignacion a usuarios inexistentes en la VM
  const asesores = isRemote ? (asesoresVm || []) : asesoresProp;

  useEffect(() => {
    if (!isRemote) return;
    setAsesoresVmLoading(true);
    setAsesoresVmError(null);
    vmFetch(apiBase, authToken, '/asesores')
      .then(data => {
        setAsesoresVm(Array.isArray(data) ? data : []);
        setAsesoresVmLoading(false);
      })
      .catch(err => {
        setAsesoresVmError('No se pudieron cargar los asesores de la VM: ' + (err.message || 'error de red'));
        setAsesoresVmLoading(false);
      });
  }, [isRemote]);
  // ── Upload ──
  const [file, setFile]           = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [parseando, setParseando] = useState(false);

  // ── Parsed result ──
  // grupos: Map<string, { contactos: [], monto: number }>
  const [grupos, setGrupos]         = useState(null);
  const [tieneColumnaGestor, setTieneColumnaGestor] = useState(false);

  // ── Distribution config ──
  const [nombreCampana, setNombreCampana] = useState('');
  // mapeo: { [gestor]: asesorId (string) | 'skip' | '' }
  const [mapeo, setMapeo]           = useState({});
  const [procesando, setProcesando] = useState(false);
  const [lastSummary, setLastSummary] = useState(null);

  // ── Dashboard ──
  const [existingCampaigns, setExistingCampaigns] = useState([]);
  const [loadingDashboard, setLoadingDashboard]   = useState(false);
  const [errorStatus, setErrorStatus]             = useState(null);


  const fileInputRef = useRef(null);

  useEffect(() => { fetchCampaigns(); }, []);


  // ════════════════════════════════════════════════
  // Dashboard
  // ════════════════════════════════════════════════
  const fetchCampaigns = async () => {
    setLoadingDashboard(true);
    setErrorStatus(null);
    try {
      const data = isRemote
        ? await vmFetch(apiBase, authToken, '/campanas/dashboard')
        : await window.api.invoke('db:getCampanasDashboard');
      setExistingCampaigns(data || []);
    } catch (err) {
      setErrorStatus(err.message);
      showToast('No se pudo cargar el historial de campañas', 'error');
    } finally {
      setLoadingDashboard(false);
    }
  };

  const handleDeleteAsesorDeBasе = async (campanaId, campanaNombre, asesorId, asesorNombre) => {
    if (!window.confirm(`¿Eliminar los contactos de "${asesorNombre}" en la campaña "${campanaNombre}"?\n\nSe eliminarán los contactos y agendamientos pendientes.\nEl historial de gestiones (CDRs) se CONSERVA con los datos del cliente guardados.`)) return;
    try {
      const res = isRemote
        ? await vmFetch(apiBase, authToken, `/campanas/${campanaId}/asesores/${asesorId}`, { method: 'DELETE' })
        : await window.api.invoke('db:deleteContactosPorAsesor', campanaId, asesorId);
      if (res.success) {
        showToast(`Contactos de ${asesorNombre} eliminados (${res.deleted} registros)`, 'success');
        fetchCampaigns();
      }
    } catch (err) {
      showToast('Error al eliminar: ' + err.message, 'error');
    }
  };

  // ════════════════════════════════════════════════
  // Upload / Drag & Drop
  // ════════════════════════════════════════════════
  const handleDragOver  = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = ()  => setIsDragging(false);
  const handleDrop      = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length) processFile(e.dataTransfer.files[0]);
  };
  const handleFileChange = (e) => {
    if (e.target.files.length) processFile(e.target.files[0]);
  };

  const resetUpload = () => {
    setFile(null);
    setGrupos(null);
    setMapeo({});
    setNombreCampana('');
    setTieneColumnaGestor(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ════════════════════════════════════════════════
  // Parse
  // ════════════════════════════════════════════════
  const processFile = async (f) => {
    const valido = ['text/csv', 'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
    if (!valido.includes(f.type) && !f.name.endsWith('.csv') && !f.name.endsWith('.xlsx')) {
      showToast('Formato no soportado. Sube CSV o Excel.', 'error');
      return;
    }
    setFile(f);
    setParseando(true);
    setGrupos(null);
    setLastSummary(null);
    try {
      const { contactos, hayGestor } = f.name.endsWith('.csv')
        ? await parsearCSV(await f.text())
        : await parsearXLSX(f);

      if (contactos.length === 0) {
        showToast('No se encontraron contactos con teléfono válido.', 'warning');
        setFile(null);
        return;
      }

      const gruposMap = agruparPorGestor(contactos);
      setGrupos(gruposMap);
      setTieneColumnaGestor(hayGestor);
      initMapeo(gruposMap);
      showToast(
        hayGestor
          ? `${contactos.length} contactos detectados — ${gruposMap.size} gestor(es) encontrados`
          : `${contactos.length} contactos listos. Sin columna GESTOR — asigna el asesor destino.`,
        'success'
      );
    } catch (err) {
      console.error(err);
      showToast('Error al leer archivo: ' + err.message, 'error');
      setFile(null);
    } finally {
      setParseando(false);
    }
  };


  // ════════════════════════════════════════════════
  // Grouping + auto-match
  // ════════════════════════════════════════════════

  const initMapeo = (gruposMap) => {
    const m = {};
    for (const [gestor] of gruposMap) {
      if (gestor === SIN_GESTOR) {
        m[gestor] = '';
        continue;
      }
      const match = asesores.find(
        a => normalizarNombre(a.nombre) === normalizarNombre(gestor)
      );
      m[gestor] = match ? String(match.id) : '';
    }
    setMapeo(m);
  };

  // ════════════════════════════════════════════════
  // Auto-Distribute equitativo (monto + unidades)
  // ════════════════════════════════════════════════
  const handleAutoDistribuir = () => {
    if (!grupos || asesores.length === 0) return;

    // Filtrar solo los asesores que estén conectados/activos actualmente (estadosWS)
    const asesoresActivos = asesores.filter(a => estadosWS && estadosWS[a.id]);
    if (asesoresActivos.length === 0) {
      return showToast('No hay asesores activos/conectados para distribuir la cartera automáticamente.', 'warning');
    }

    // 1. Aplanar todos los contactos de todos los grupos en un solo array
    const todosContactos = [];
    for (const [, data] of grupos.entries()) {
      for (const c of data.contactos) {
        todosContactos.push({ ...c, _monto: c.monto || 0 });
      }
    }
    if (todosContactos.length === 0) return showToast('No hay contactos para distribuir.', 'warning');

    // 2. Mezcla aleatoria (Fisher-Yates) para evitar sesgo por orden de archivo
    for (let i = todosContactos.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [todosContactos[i], todosContactos[j]] = [todosContactos[j], todosContactos[i]];
    }

    // 3. Contadores por asesor activo { id -> { monto, count } }
    const acumulado = {};
    for (const a of asesoresActivos) {
      acumulado[String(a.id)] = { monto: 0, count: 0 };
    }

    // 4. Asignar cada contacto al asesor activo con menor monto acumulado (greedy)
    const asignacion = {};
    const buckets = {};
    for (const a of asesoresActivos) buckets[String(a.id)] = [];

    for (const c of todosContactos) {
      // Seleccionar asesor activo con menor monto acumulado
      let mejorId = String(asesoresActivos[0].id);
      let mejorMonto = acumulado[mejorId].monto;
      let mejorCount = acumulado[mejorId].count;
      for (const a of asesoresActivos) {
        const aid = String(a.id);
        const { monto, count } = acumulado[aid];
        if (monto < mejorMonto || (monto === mejorMonto && count < mejorCount)) {
          mejorId = aid;
          mejorMonto = monto;
          mejorCount = count;
        }
      }
      buckets[mejorId].push(c);
      acumulado[mejorId].monto += c._monto;
      acumulado[mejorId].count += 1;
    }

    // 5. Reconstruir grupos sintéticos — un grupo por asesor
    const nuevosGrupos = new Map();
    const nuevoMapeo = {};
    for (const a of asesoresActivos) {
      const aid = String(a.id);
      const contactosAsesor = buckets[aid];
      if (contactosAsesor.length === 0) continue;
      const monto = contactosAsesor.reduce((s, c) => s + (c._monto || 0), 0);
      nuevosGrupos.set(a.nombre, { contactos: contactosAsesor, monto });
      nuevoMapeo[a.nombre] = aid;
    }

    setGrupos(nuevosGrupos);
    setMapeo(nuevoMapeo);
    setTieneColumnaGestor(false);

    const resumen = asesoresActivos
      .filter(a => acumulado[String(a.id)].count > 0)
      .map(a => `${a.nombre.split(' ')[0]}: ${acumulado[String(a.id)].count}`)
      .join(' · ');
    showToast(`Distribuido a ${asesoresActivos.length} asesor(es) activo(s) — ${resumen}`, 'success');
  };

  // ════════════════════════════════════════════════
  // Distribute
  // ════════════════════════════════════════════════
  const handleDistribuir = async () => {
    if (isRemote && (!asesoresVm || asesoresVm.length === 0))
      return showToast('Los asesores de la VM no están cargados. Espera o reintenta la conexión.', 'error');
    if (!nombreCampana.trim()) return showToast('Asigna un nombre al lote / campaña.', 'error');

    const sinConfigurar = [...grupos.entries()].filter(
      ([g, d]) => mapeo[g] !== 'skip' && !mapeo[g] && d.contactos.length > 0
    );
    if (sinConfigurar.length > 0) {
      return showToast(
        `${sinConfigurar.length} fila(s) sin asesor asignado. Asigna o marca "Ignorar".`,
        'warning'
      );
    }

    const gruposActivos = [...grupos.entries()].filter(
      ([g, d]) => mapeo[g] && mapeo[g] !== 'skip' && d.contactos.length > 0
    );
    if (gruposActivos.length === 0) return showToast('Todos los grupos están marcados como Ignorar.', 'error');

    const totalContactos = gruposActivos.reduce((s, [, d]) => s + d.contactos.length, 0);
    setProcesando(true);

    try {
      const resC = isRemote
        ? await vmFetch(apiBase, authToken, '/campanas', { method: 'POST', body: JSON.stringify({
            nombre: nombreCampana.trim(),
            descripcion: `Cartera general. ${totalContactos} registros. ${gruposActivos.length} asesor(es).`,
          }) })
        : await window.api.invoke('db:insertCampana', {
            nombre: nombreCampana.trim(),
            descripcion: `Cartera general. ${totalContactos} registros. ${gruposActivos.length} asesor(es).`,
            supervisor_id: usuario?.id,
          });
      if (!resC.success) throw new Error('No se pudo crear la campaña.');

      let totalInsertados = 0;
      const desglose = [];

      const resultadosInsercion = await Promise.all(
        [...gruposActivos].map(async ([gestor, { contactos }]) => {
          const asesorId = Number(mapeo[gestor]);
          const res = isRemote
            ? await vmFetch(apiBase, authToken, `/campanas/${resC.id}/contactos`, { method: 'POST', body: JSON.stringify({ asesorId, contactos }) })
            : await window.api.invoke('db:insertContactos', resC.id, asesorId, contactos);
          return { gestor, contactos, asesorId, res };
        })
      );
      for (const { gestor, contactos, asesorId, res } of resultadosInsercion) {
        if (res.success) {
          totalInsertados += res.count;
          // Notificar al asesor para que recargue cartera sin reiniciar el CRM
          window.api.invoke('ws:notifyCarteraAsignada', asesorId).catch(() => {});
          const asesor = asesores.find(a => a.id === asesorId);

          // Financials por asesor calculados desde los contactos ya en memoria
          let montoMora = 0, montoCobrar = 0;
          for (const c of contactos) {
            const meta = c.metadata || {};
            const moraKey   = Object.keys(meta).find(k => k === 'VALOR EN MORA' || k === 'MORA');
            const cobrarKey = Object.keys(meta).find(k => k === 'MONTO POR COBRAR' || k === 'TOTAL A COBRAR');
            montoMora   += parseFloat(((moraKey   ? meta[moraKey]   : '') || '').toString().replace(/[^0-9.]/g, '')) || 0;
            montoCobrar += parseFloat(((cobrarKey ? meta[cobrarKey] : '') || '').toString().replace(/[^0-9.]/g, '')) || c.monto || 0;
          }

          desglose.push({
            gestor:      gestor === SIN_GESTOR ? 'Sin gestor' : gestor,
            asesor:      asesor?.nombre || '—',
            count:       res.count,
            montoMora,
            montoCobrar,
            firstCedula: contactos[0]?.cedula || '—',
            lastCedula:  contactos[contactos.length - 1]?.cedula || '—',
          });
        }
      }

      const summary = isRemote
        ? await vmFetch(apiBase, authToken, `/campanas/${resC.id}/summary`)
        : await window.api.invoke('db:getCampaignSummary', resC.id);
      setLastSummary({ ...summary, desglose });
      showToast(`${totalInsertados} contactos distribuidos en ${gruposActivos.length} asesor(es).`, 'success');
      resetUpload();
      fetchCampaigns();
    } catch (err) {
      console.error(err);
      showToast('Error al distribuir: ' + err.message, 'error');
    } finally {
      setProcesando(false);
    }
  };

  // ════════════════════════════════════════════════
  // Helpers UI
  // ════════════════════════════════════════════════
  const totalActivos = grupos
    ? [...grupos.entries()]
        .filter(([g, d]) => mapeo[g] && mapeo[g] !== 'skip' && d.contactos.length > 0)
        .reduce((s, [, d]) => s + d.contactos.length, 0)
    : 0;

  const autoMatchCount = grupos
    ? [...grupos.keys()].filter(
        g => g !== SIN_GESTOR && mapeo[g] && mapeo[g] !== 'skip'
      ).length
    : 0;

  // ════════════════════════════════════════════════
  // Render
  // ════════════════════════════════════════════════
  return (
    <div className="sup-campanas-tab" style={{ padding: 'var(--space-md)' }}>

      {/* ── Banner modo servidor ── */}
      {isRemote ? (
        <div style={{ maxWidth: 900, margin: '0 auto 12px', padding: '8px 14px', borderRadius: 8, background: 'rgba(29,233,182,0.1)', border: '1px solid rgba(29,233,182,0.3)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#1DE9B6' }}>cloud_done</span>
          <span style={{ fontSize: 12, color: '#1DE9B6' }}>VM activa — las campañas se guardan en el servidor remoto ({localStorage.getItem('uphone_ws_ip')})</span>
        </div>
      ) : (
        <div style={{ maxWidth: 900, margin: '0 auto 12px', padding: '8px 14px', borderRadius: 8, background: 'rgba(255,152,0,0.1)', border: '1px solid rgba(255,152,0,0.4)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#ff9800' }}>warning</span>
          <span style={{ fontSize: 12, color: '#ff9800' }}>Modo local activo — las campañas se guardan en la BD local (SQLite). Para usar la VM, configura la URL del servidor en la pestaña <strong>Configuración</strong>.</span>
        </div>
      )}

      {/* ── Card principal ── */}
      <div className="card" style={{ maxWidth: 900, margin: '0 auto' }}>
        <div className="widget-header">
          <div>
            <h3 className="widget-title">Distribución de Cartera</h3>
            <p className="text-body-sm" style={{ opacity: 0.6 }}>
              Carga el archivo general y distribuye por gestor a cada asesor.
            </p>
          </div>
          <span className="material-symbols-outlined">group_add</span>
        </div>

        {/* ── Guard VM: esperando asesores ── */}
        {isRemote && asesoresVmLoading && (
          <div style={{ padding: '32px 0', textAlign: 'center', opacity: 0.6 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 28, display: 'block', marginBottom: 8 }}>sync</span>
            <p style={{ fontSize: 13 }}>Cargando asesores desde la VM...</p>
          </div>
        )}

        {isRemote && !asesoresVmLoading && asesoresVmError && (
          <div style={{ padding: '24px', borderRadius: 8, background: 'rgba(244,67,54,0.1)', border: '1px solid rgba(244,67,54,0.3)', margin: '16px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#f44336' }}>error</span>
              <strong style={{ fontSize: 13, color: '#f44336' }}>Error al conectar con la VM</strong>
            </div>
            <p style={{ fontSize: 12, opacity: 0.8, margin: '0 0 12px' }}>{asesoresVmError}</p>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => {
              setAsesoresVmLoading(true); setAsesoresVmError(null);
              vmFetch(apiBase, authToken, '/asesores')
                .then(data => { setAsesoresVm(Array.isArray(data) ? data : []); setAsesoresVmLoading(false); })
                .catch(err => { setAsesoresVmError('No se pudieron cargar los asesores: ' + (err.message || 'error de red')); setAsesoresVmLoading(false); });
            }}>Reintentar</button>
          </div>
        )}

        {/* ── Zona de upload (oculta tras parseo) ── */}
        {!grupos && !asesoresVmLoading && !asesoresVmError && (
          <div
            style={{
              border: `2px dashed ${isDragging ? 'var(--color-primary)' : 'rgba(255,255,255,0.1)'}`,
              borderRadius: 'var(--radius-md)',
              padding: '48px 20px',
              textAlign: 'center',
              marginTop: 24,
              backgroundColor: isDragging ? 'rgba(0,255,170,0.05)' : 'transparent',
              transition: 'background 0.2s ease, opacity 0.2s ease, border-color 0.2s ease, color 0.2s ease',
            }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {parseando ? (
              <>
                <span className="material-symbols-outlined" style={{ fontSize: 48, color: 'var(--color-primary)', marginBottom: 16, display: 'block' }}>sync</span>
                <p className="text-body">Analizando archivo...</p>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined" style={{ fontSize: 48, color: isDragging ? 'var(--color-primary)' : 'rgba(255,255,255,0.2)', marginBottom: 16, display: 'block' }}>
                  file_upload
                </span>
                <p className="text-body" style={{ marginBottom: 8 }}>
                  Arrastra tu cartera general en Excel / CSV
                </p>
                <p className="text-body-sm" style={{ opacity: 0.5, marginBottom: 16 }}>
                  El archivo debe incluir columna <strong>GESTOR</strong> para distribución automática
                </p>
                <input aria-label="GESTOR"
                  type="file"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  onChange={handleFileChange}
                />
                <button type="button" className="btn btn-outline" onClick={() => fileInputRef.current.click()}>
                  <span className="material-symbols-outlined">search</span>
                  Buscar Archivo
                </button>
              </>
            )}
          </div>
        )}

        {/* ── Tabla de distribución ── */}
        {grupos && (
          <div style={{ marginTop: 24 }}>

            {/* Barra info archivo + reset */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-sm)', marginBottom: 20, border: '1px solid rgba(255,255,255,0.07)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: 20 }}>description</span>
                <div>
                  <p className="text-body-sm" style={{ fontWeight: 600, margin: 0 }}>{file?.name}</p>
                  <p style={{ fontSize: 12, opacity: 0.5, margin: 0 }}>
                    {totalActivos.toLocaleString()} contactos listos para asignar
                    {tieneColumnaGestor && autoMatchCount > 0 && (
                      <span style={{ color: 'var(--color-primary)', marginLeft: 8 }}>
                        · {autoMatchCount} gestor(es) auto-detectados
                      </span>
                    )}
                    {!tieneColumnaGestor && (
                      <span style={{ color: '#ff9800', marginLeft: 8 }}>
                        · Sin columna GESTOR — asignación manual
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <button type="button" className="btn btn-sm btn-ghost" onClick={resetUpload} style={{ padding: '4px 10px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
                Cambiar
              </button>
            </div>

            {/* Nombre de campaña */}
            <div style={{ marginBottom: 20 }}>
              <label className="reporte-form__label">Nombre del Lote / Campaña</label>
              <input aria-label="Nombre del Lote / Campaña"
                type="text"
                className="input"
                placeholder="Ej: Cartera Vencida Mayo 2026"
                value={nombreCampana}
                onChange={e => setNombreCampana(e.target.value)}
                style={{ maxWidth: 400 }}
              />
            </div>

            {/* ── Barra de acciones: auto-distribuir + info ── */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              marginBottom: 16, flexWrap: 'wrap',
            }}>
              <button type="button"
                className="btn"
                onClick={handleAutoDistribuir}
                disabled={procesando || !grupos || asesores.length === 0}
                title="Reparte los contactos de forma equitativa solo a los asesores CONECTADOS hoy"
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: 'linear-gradient(135deg, rgba(0,230,118,0.15) 0%, rgba(0,180,100,0.05) 100%)',
                  border: '1px solid rgba(0,230,118,0.4)',
                  color: '#00e676',
                  fontSize: 13, fontWeight: 600,
                  padding: '10px 20px',
                  borderRadius: 'var(--radius-md)',
                  cursor: (procesando || !grupos || asesores.length === 0) ? 'not-allowed' : 'pointer',
                  opacity: (procesando || !grupos || asesores.length === 0) ? 0.5 : 1,
                  boxShadow: '0 4px 15px rgba(0,230,118,0.1)',
                  transition: 'background 0.2s ease, opacity 0.2s ease, border-color 0.2s ease, color 0.2s ease',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}
                onMouseOver={(e) => {
                  if (!(procesando || !grupos || asesores.length === 0)) {
                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(0,230,118,0.25) 0%, rgba(0,180,100,0.15) 100%)';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,230,118,0.2)';
                  }
                }}
                onFocus={(e) => {
                  if (!(procesando || !grupos || asesores.length === 0)) {
                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(0,230,118,0.25) 0%, rgba(0,180,100,0.15) 100%)';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,230,118,0.2)';
                  }
                }}
                onMouseOut={(e) => {
                  if (!(procesando || !grupos || asesores.length === 0)) {
                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(0,230,118,0.15) 0%, rgba(0,180,100,0.05) 100%)';
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 4px 15px rgba(0,230,118,0.1)';
                  }
                }}
                onBlur={(e) => {
                  if (!(procesando || !grupos || asesores.length === 0)) {
                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(0,230,118,0.15) 0%, rgba(0,180,100,0.05) 100%)';
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 4px 15px rgba(0,230,118,0.1)';
                  }
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>bolt</span>
                Reparto Automático (Asesores Activos)
              </button>
              {grupos && asesores.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 13, opacity: 0.8, fontWeight: 500 }}>
                    {[...grupos.values()].reduce((s, d) => s + d.contactos.length, 0).toLocaleString()} contactos totales
                  </span>
                  <span style={{ fontSize: 12, color: '#00e676', opacity: 0.8 }}>
                    Se distribuirá entre los {asesores.filter(a => estadosWS && estadosWS[a.id]).length} asesor(es) conectados actualmente.
                  </span>
                </div>
              )}
            </div>

            {/* Tabla gestores */}
            <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', marginBottom: 20 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, opacity: 0.7 }}>
                      {tieneColumnaGestor ? 'GESTOR (del archivo)' : 'GRUPO'}
                    </th>
                    <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600, opacity: 0.7 }}>Contactos</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, opacity: 0.7 }}>Monto total</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, opacity: 0.7 }}>Asignar a Asesor</th>
                  </tr>
                </thead>
                <tbody>
                  {[...grupos.entries()].map(([gestor, data], idx) => {
                    const esSinGestor = gestor === SIN_GESTOR;
                    const val = mapeo[gestor] || '';
                    const autoMatch = !esSinGestor && !!asesores.find(
                      a => normalizarNombre(a.nombre) === normalizarNombre(gestor)
                    );

                    return (
                      <tr
                        key={gestor}
                        style={{
                          background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
                          opacity: val === 'skip' ? 0.4 : 1,
                          transition: 'opacity 0.2s',
                        }}
                      >
                        {/* Nombre gestor */}
                        <td style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 16, opacity: 0.5 }}>
                              {esSinGestor ? 'person_off' : 'person'}
                            </span>
                            <span style={{ fontWeight: esSinGestor ? 400 : 600, fontStyle: esSinGestor ? 'italic' : 'normal', opacity: esSinGestor ? 0.6 : 1 }}>
                              {esSinGestor ? 'Sin gestor asignado' : gestor}
                            </span>
                            {autoMatch && (
                              <span style={{ fontSize: 12, background: 'rgba(0,255,170,0.12)', color: 'var(--color-primary)', padding: '2px 7px', borderRadius: 99, fontWeight: 700 }}>
                                AUTO
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Cantidad */}
                        <td style={{ padding: '10px 14px', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.04)', fontWeight: 700, color: 'var(--color-primary)' }}>
                          {data.contactos.length.toLocaleString()}
                        </td>

                        {/* Monto */}
                        <td style={{ padding: '10px 14px', textAlign: 'right', borderBottom: '1px solid rgba(255,255,255,0.04)', color: '#ff9800', fontWeight: 600 }}>
                          ${data.monto.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>

                        {/* Dropdown asesor */}
                        <td style={{ padding: '8px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <select
                            className="input"
                            style={{ fontSize: 13, padding: '6px 10px', width: '100%' }}
                            value={val}
                            onChange={e => setMapeo(prev => ({ ...prev, [gestor]: e.target.value }))}
                          >
                            <option value="">— Seleccionar asesor —</option>
                            {asesores.map(a => (
                              <option key={a.id} value={String(a.id)}>{a.nombre}</option>
                            ))}
                            <option value="skip">🚫 Ignorar este grupo</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>

                {/* Footer totales */}
                <tfoot>
                  <tr style={{ background: 'rgba(255,255,255,0.04)', borderTop: '2px solid rgba(255,255,255,0.1)' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 700, fontSize: 12, opacity: 0.7 }}>
                      {grupos.size} grupo(s)
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 800, color: 'var(--color-primary)' }}>
                      {[...grupos.values()].reduce((s, d) => s + d.contactos.length, 0).toLocaleString()}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 800, color: '#ff9800' }}>
                      ${[...grupos.values()].reduce((s, d) => s + d.monto, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Botón distribuir */}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button"
                className="btn btn-primary"
                onClick={handleDistribuir}
                disabled={procesando}
                style={{ gap: 8 }}
              >
                {procesando ? (
                  <>
                    <span className="material-symbols-outlined" style={{ fontSize: 18, animation: 'spin 1s linear infinite' }}>sync</span>
                    Procesando...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>send</span>
                    Distribuir y Asignar ({totalActivos.toLocaleString()} contactos)
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ── Resumen post-distribución ── */}
        {lastSummary && (
          <div style={{
            marginTop: 24,
            padding: 24,
            background: 'rgba(76,175,80,0.05)',
            borderRadius: 12,
            border: '1px solid rgba(76,175,80,0.2)',
            animation: 'fadeIn 0.3s ease',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <div style={{ padding: 8, background: '#4caf50', borderRadius: '50%', display: 'flex' }}>
                <span className="material-symbols-outlined" style={{ color: 'white', fontSize: 20 }}>check</span>
              </div>
              <div>
                <h4 className="text-headline-xs" style={{ margin: 0 }}>Cartera Distribuida con Éxito</h4>
                <p className="text-body-sm" style={{ opacity: 0.6 }}>Desglose por asesor:</p>
              </div>
            </div>

            {/* Desglose por asesor — tabla completa */}
            {lastSummary.desglose?.length > 0 && (() => {
              const fmt = (n) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
              const totalMora    = lastSummary.desglose.reduce((s, d) => s + (d.montoMora   || 0), 0);
              const totalCobrar  = lastSummary.desglose.reduce((s, d) => s + (d.montoCobrar || 0), 0);
              const totalCount   = lastSummary.desglose.reduce((s, d) => s + (d.count       || 0), 0);
              const thStyle = { padding: '9px 12px', textAlign: 'left', opacity: 0.6, fontWeight: 600, whiteSpace: 'nowrap' };
              const tdStyle = { padding: '9px 12px', borderTop: '1px solid rgba(255,255,255,0.04)', verticalAlign: 'middle' };

              return (
                <div style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, overflow: 'hidden', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                        <th style={thStyle}>Gestor</th>
                        <th style={thStyle}>Asesor asignado</th>
                        <th style={{ ...thStyle, textAlign: 'center' }}>Contactos</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Valor en Mora</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Monto por Cobrar</th>
                        <th style={{ ...thStyle, textAlign: 'center' }}>1era Cédula</th>
                        <th style={{ ...thStyle, textAlign: 'center' }}>Última Cédula</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lastSummary.desglose.map((d) => (
                        <tr key={d.gestor}>
                          <td style={{ ...tdStyle, opacity: 0.8 }}>{d.gestor}</td>
                          <td style={{ ...tdStyle, color: 'var(--color-primary)', fontWeight: 600 }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 4 }}>person</span>
                            {d.asesor}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 700 }}>{d.count.toLocaleString()}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--color-danger)', fontWeight: 600 }}>{fmt(d.montoMora)}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', color: '#ff9800', fontWeight: 600 }}>{fmt(d.montoCobrar)}</td>
                          <td style={{ ...tdStyle, textAlign: 'center', opacity: 0.75, fontFamily: 'monospace' }}>{d.firstCedula}</td>
                          <td style={{ ...tdStyle, textAlign: 'center', opacity: 0.75, fontFamily: 'monospace' }}>{d.lastCedula}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: 'rgba(255,255,255,0.04)', borderTop: '2px solid rgba(255,255,255,0.1)' }}>
                        <td style={{ padding: '9px 12px', fontWeight: 700, opacity: 0.6, fontSize: 12 }}>TOTALES</td>
                        <td />
                        <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 800, color: 'var(--color-primary)' }}>{totalCount.toLocaleString()}</td>
                        <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 800, color: 'var(--color-danger)' }}>{fmt(totalMora)}</td>
                        <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 800, color: '#ff9800' }}>{fmt(totalCobrar)}</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              );
            })()}

            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLastSummary(null)}>
                Cerrar Resumen
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Panel de Control de Bases ── */}
      <div className="card" style={{ maxWidth: 1000, margin: '24px auto 0' }}>
        <div className="widget-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <div>
            <h3 className="widget-title">Panel de Control de Bases</h3>
            <p className="text-body-sm" style={{ opacity: 0.6 }}>Historial de lotes cargados y asignados.</p>
          </div>
          <div style={{ display: 'flex', gap: 12, marginLeft: 'auto' }}>
            <button type="button" className="btn btn-sm btn-outline" onClick={fetchCampaigns} disabled={loadingDashboard}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                {loadingDashboard ? 'sync' : 'refresh'}
              </span>
              {loadingDashboard ? 'Cargando...' : 'Actualizar'}
            </button>
            <span className="material-symbols-outlined">analytics</span>
          </div>
        </div>

        <div className="gestion-table-wrapper" style={{ marginTop: 20, maxHeight: 400, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 4 }}>
          {loadingDashboard && (
            <div style={{ padding: '40px 0', textAlign: 'center' }}>
              <p className="text-body-sm">Cargando campañas...</p>
            </div>
          )}

          {!loadingDashboard && errorStatus && (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--color-danger)' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 32, display: 'block', marginBottom: 8 }}>error</span>
              <p>Error: {errorStatus}</p>
            </div>
          )}

          {!loadingDashboard && !errorStatus && existingCampaigns.length === 0 && (
            <div style={{ padding: '40px 0', textAlign: 'center', opacity: 0.5 }}>
              <p>No hay bases de datos cargadas actualmente.</p>
            </div>
          )}
          {!loadingDashboard && !errorStatus && existingCampaigns.length > 0 && (() => {
            // Agrupar filas por campaña para rowSpan
            const grupos = [];
            let prev = null;
            for (const row of existingCampaigns) {
              if (!prev || prev.id !== row.id) {
                prev = { id: row.id, nombre: row.nombre, fecha_inicio: row.fecha_inicio, supervisor_nombre: row.supervisor_nombre, filas: [] };
                grupos.push(prev);
              }
              prev.filas.push(row);
            }
            const fmt = (n) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            const fmtFecha = (f) => !f ? 'N/A' : (f.includes(' ') || f.includes('T'))
              ? new Date(f).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
              : f.split('-').reverse().join('/');
            const bdr = '1px solid rgba(255,255,255,0.05)';

            return (
              <table className="excel-style-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.05)', borderBottom: '2px solid rgba(255,255,255,0.1)' }}>
                    <th style={{ padding: '12px', textAlign: 'left', border: bdr }}>Nombre del Lote</th>
                    <th style={{ padding: '12px', textAlign: 'left', border: bdr }}>Subida</th>
                    {usuario?.id === 1 && <th style={{ padding: '12px', textAlign: 'left', border: bdr }}>Jefe de Area</th>}
                    <th style={{ padding: '12px', textAlign: 'left', border: bdr }}>Asesor</th>
                    <th style={{ padding: '12px', textAlign: 'center', border: bdr }}>Contactos</th>
                    <th style={{ padding: '12px', textAlign: 'right', border: bdr }}>Valor en Mora</th>
                    <th style={{ padding: '12px', textAlign: 'center', border: bdr }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {grupos.map((grp) =>
                    grp.filas.map((fila, fi) => {
                      const esPrimera = fi === 0;
                      const span = grp.filas.length;
                      const bgBase = 'transparent';
                      const bgAlt  = 'rgba(255,255,255,0.015)';
                      const borderTop = esPrimera && grupos.indexOf(grp) > 0
                        ? '2px solid rgba(255,255,255,0.08)'
                        : undefined;

                      return (
                        <tr key={`${grp.id}-${fi}`} className="excel-row-hover" style={{ background: fi % 2 === 0 ? bgBase : bgAlt, borderTop }}>
                          {esPrimera && (
                            <>
                              <td rowSpan={span} style={{ padding: '10px 12px', border: bdr, fontWeight: 700, verticalAlign: 'middle', borderRight: '2px solid rgba(255,255,255,0.08)' }}>
                                {grp.nombre}
                              </td>
                              <td rowSpan={span} style={{ padding: '10px 12px', border: bdr, color: 'rgba(255,255,255,0.7)', verticalAlign: 'middle' }}>
                                {fmtFecha(grp.fecha_inicio)}
                              </td>
                              {usuario?.id === 1 && (
                                <td rowSpan={span} style={{ padding: '10px 12px', border: bdr, color: 'var(--color-primary)', fontWeight: 500, verticalAlign: 'middle' }}>
                                  {grp.supervisor_nombre || 'SISTEMA'}
                                </td>
                              )}
                            </>
                          )}
                          <td style={{ padding: '10px 12px', border: bdr }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 14, opacity: 0.5 }}>person</span>
                              {fila.asesor_nombre || '—'}
                            </div>
                          </td>
                          <td style={{ padding: '10px 12px', border: bdr, textAlign: 'center', fontWeight: 700, color: 'var(--color-primary)' }}>
                            {(fila.total_contactos || 0).toLocaleString()}
                          </td>
                          <td style={{ padding: '10px 12px', border: bdr, textAlign: 'right', color: 'var(--color-danger)', fontWeight: 600 }}>
                            {fmt(fila.monto_mora)}
                          </td>
                          <td style={{ padding: '10px 12px', border: bdr, textAlign: 'center' }}>
                            <button type="button"
                              className="btn btn-sm btn-ghost"
                              style={{ padding: 4, minHeight: 'auto' }}
                              title={`Eliminar contactos de ${fila.asesor_nombre}`}
                              onClick={() => handleDeleteAsesorDeBasе(grp.id, grp.nombre, fila.asesor_id, fila.asesor_nombre)}
                            >
                              <span className="material-symbols-outlined" style={{ color: 'var(--color-danger)', fontSize: 18 }}>delete</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            );
          })()}
        </div>
      </div>

    </div>
  );
}
