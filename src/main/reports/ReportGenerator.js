const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { getAsesores, findUserById, getEventosDia, getMetricasDia, getCdrsGestiones, getCarteraEquipo, getCarteraAsesor, getCompromisosEquipo, getDetalleContactabilidad } = require('../database/queries');

// Cargar electron.app solo en contexto Electron; en VM/Node.js no existe
let _electronApp = null;
try { _electronApp = require('electron').app; } catch {}

// Estilos reutilizables ExcelJS
const XLS = {
  BG_DARK:    { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1117' } },
  BG_SECTION: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF161B22' } },
  C_PRIMARY: 'FF00E5FF',
  C_GREEN:   'FF00E676',
  C_YELLOW:  'FFFFB74D',
  C_RED:     'FFEF4444',
  C_MUTED:   'FF8B949E',
  C_BLUE:    'FF64B5F6',
  C_WHITE:   'FFF0F6FC',
};

function getExportDir() {
  let dir;
  if (_electronApp) {
    dir = path.join(_electronApp.getPath('documents'), 'ANTIGRAVITY', 'Reportes');
  } else {
    // Contexto VM/Node.js: directorio temporal dentro del proyecto
    dir = process.env.REPORTS_DIR || path.join(process.cwd(), 'reports_tmp');
  }
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function _todayLocalISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}
function formatDate(fecha) {
  return (fecha || _todayLocalISO()).replace(/-/g, '');
}
// Sufijo HHmmss para nombres únicos — evita EBUSY cuando el archivo previo está abierto
function _timeSuffix() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
}

// Convierte cualquier timestamp (UTC con Z o local sin Z) a string local
// 'YYYY-MM-DD HH:MM:SS' para mostrar en Excel/PDF. Sin conversión cuando ya
// está en local; resta offset si tiene Z (UTC).
function toLocalDateTime(ts) {
  if (!ts || typeof ts !== 'string') return '';
  try {
    const d = new Date(ts.replace(' ', 'T'));
    if (isNaN(d.getTime())) return ts;
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch { return ts; }
}

function segundosAHora(seg) {
  const h = Math.floor(seg / 3600).toString().padStart(2, '0');
  const m = Math.floor((seg % 3600) / 60).toString().padStart(2, '0');
  const s = (seg % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

// ─── HELPER: agregar métricas de un rango de fechas ────────────────────────
function _getMetricasRango(asesorId, fechaInicio, fechaFin) {
  const SUMA = [
    'total_marcaciones', 'tiempo_al_aire', 'tiempo_muerto', 'total_compromisos',
    'contactos_efectivos', 'cdrs_total', 'cdrs_neutros', 'cdrs_no_contactados',
    'cdrs_sin_tipificar', 'monto_comprometido', 'promesas_pago', 'monto_prometido',
    'pagos_recaudados', 'monto_recaudado', 'compromisos_cumplidos',
    'compromisos_incumplidos', 'compromisos_reagendados',
    'wsp_enviados', 'sms_enviados', 'correos_enviados',
  ];

  const inicio = new Date(fechaInicio);
  const fin    = new Date(fechaFin);
  const dias   = [];
  for (let d = new Date(inicio); d <= fin; d.setDate(d.getDate() + 1)) {
    dias.push(d.toISOString().slice(0, 10));
  }

  const agg = {};
  SUMA.forEach(k => { agg[k] = 0; });

  for (const dia of dias) {
    const m = getMetricasDia(asesorId, dia);
    SUMA.forEach(k => { agg[k] += (m[k] || 0); });
  }

  // Recalcular ratios derivados
  const aire   = agg.tiempo_al_aire;
  const muerto = agg.tiempo_muerto;
  agg.ratio_productividad = (aire + muerto) > 0 ? Math.round((aire / (aire + muerto)) * 100) : 0;
  const marc  = agg.total_marcaciones;
  const compr = agg.total_compromisos;
  agg.ratio_eficacia = marc > 0 ? Math.round((compr / marc) * 100) : 0;

  // Cartera: tomar del primer día del rango (stock, no acumula por día)
  const cartera = getMetricasDia(asesorId, fechaFin);
  agg.total_asignados  = cartera.total_asignados  || 0;
  agg.gestionados_base = cartera.gestionados_base || 0;
  agg.mora_total_base  = cartera.mora_total_base  || 0;

  return agg;
}

// ─── REPORTE DIARIO / RANGO POR ASESOR ─────────────────────────────────────
async function generarReporteDiario(asesor_id, fecha, formato = 'xlsx', fechaFin = null) {
  const asesor = findUserById(parseInt(asesor_id));
  if (!asesor) throw new Error('Asesor no encontrado');

  const f    = fecha    || _todayLocalISO();
  const fFin = fechaFin || f;
  const esRango = f !== fFin;

  const metricas = esRango ? _getMetricasRango(asesor_id, f, fFin) : getMetricasDia(asesor_id, f);
  const eventos  = getEventosDia(asesor_id, f);

  const rangoLabel = esRango ? `${f} al ${fFin}` : f;
  const sufijo     = esRango ? `${formatDate(f)}_${formatDate(fFin)}` : formatDate(f);
  const nombreArchivo = `reporte_operativo_${asesor.nombre.replace(/\s+/g, '_')}_${sufijo}_${_timeSuffix()}.${formato}`;
  const rutaArchivo   = path.join(getExportDir(), nombreArchivo);

  if (formato === 'xlsx') {
    await generarXlsxDiario(asesor, metricas, eventos, rutaArchivo, rangoLabel);
  } else if (formato === 'pdf') {
    await generarPdfDiario(asesor, metricas, eventos, rutaArchivo, rangoLabel);
  } else if (formato === 'csv') {
    generarCsvDiario(asesor, metricas, rutaArchivo);
  }

  return { success: true, archivo: rutaArchivo };
}

async function generarXlsxDiario(asesor, metricas, eventos, rutaArchivo, fechaDisplay) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ANTIGRAVITY';

  // ── Hoja 1: Informe Operativo ──────────────────────────────
  const ws = wb.addWorksheet('Informe Operativo');

  ws.columns = [
    { width: 34 }, // A: label izquierdo
    { width: 20 }, // B: valor izquierdo
    { width: 3  }, // C: separador visual
    { width: 34 }, // D: label derecho
    { width: 20 }, // E: valor derecho
  ];

  // Título
  ws.mergeCells('A1:E1');
  const cTitle = ws.getCell('A1');
  cTitle.value = `INFORME OPERATIVO — ${asesor.nombre.toUpperCase()}`;
  cTitle.font  = { bold: true, size: 16, color: { argb: XLS.C_PRIMARY } };
  cTitle.fill  = XLS.BG_DARK;
  cTitle.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 32;

  ws.mergeCells('A2:E2');
  const cSub = ws.getCell('A2');
  cSub.value = `Período: ${fechaDisplay}   ·   Generado: ${new Date().toLocaleString('es')}`;
  cSub.font  = { size: 9, color: { argb: XLS.C_MUTED } };
  cSub.fill  = XLS.BG_DARK;
  cSub.alignment = { horizontal: 'center' };

  // Helpers de sección
  const addSection = (label) => {
    ws.addRow([]);
    const rn = ws.lastRow.number;
    ws.mergeCells(`A${rn}:E${rn}`);
    const cell = ws.getCell(`A${rn}`);
    cell.value = `  ${label}`;
    cell.font  = { bold: true, size: 11, color: { argb: XLS.C_PRIMARY } };
    cell.fill  = XLS.BG_SECTION;
    ws.getRow(rn).height = 22;
  };

  const addMetric = (labelL, valueL, colorL, labelR = null, valueR = null, colorR = null) => {
    ws.addRow([labelL, valueL, '', labelR || '', valueR != null ? valueR : '']);
    const row = ws.lastRow;
    row.getCell(1).font = { size: 10, color: { argb: XLS.C_MUTED } };
    row.getCell(2).font = { bold: true, size: 11, color: { argb: colorL || XLS.C_WHITE } };
    row.getCell(2).alignment = { horizontal: 'right' };
    if (labelR !== null) {
      row.getCell(4).font = { size: 10, color: { argb: XLS.C_MUTED } };
      row.getCell(5).font = { bold: true, size: 11, color: { argb: colorR || XLS.C_WHITE } };
      row.getCell(5).alignment = { horizontal: 'right' };
    }
    row.height = 18;
  };

  const fmtMonto = (v) => `$${Number(v || 0).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pctColor = (v, ok = 70, warn = 40) => v >= ok ? XLS.C_GREEN : v >= warn ? XLS.C_YELLOW : XLS.C_RED;
  const tasaContactabilidad = (metricas.cdrs_total || 0) > 0
    ? Math.round(((metricas.contactos_efectivos || 0) / (metricas.cdrs_total || 0)) * 100)
    : 0;
  const totalDigital = (metricas.wsp_enviados || 0) + (metricas.sms_enviados || 0) + (metricas.correos_enviados || 0);

  // ── SECCIÓN 1: Actividad de Llamadas ──
  addSection('ACTIVIDAD DE LLAMADAS');
  addMetric('Marcaciones totales',    metricas.total_marcaciones || 0,      XLS.C_PRIMARY,
            'Eficacia (Compromisos/Marc)', `${metricas.ratio_eficacia || 0}%`, pctColor(metricas.ratio_eficacia || 0, 15, 5));
  addMetric('Tiempo al aire',         segundosAHora(metricas.tiempo_al_aire || 0), XLS.C_GREEN,
            'Tiempo muerto',          segundosAHora(metricas.tiempo_muerto || 0),  XLS.C_MUTED);
  addMetric('Productividad',          `${metricas.ratio_productividad || 0}%`,     pctColor(metricas.ratio_productividad || 0));

  // ── SECCIÓN 2: Contactabilidad ──
  addSection('CONTACTABILIDAD');
  addMetric('CDRs tipificados',       metricas.cdrs_total || 0,             XLS.C_PRIMARY,
            'Tasa de contactabilidad',`${tasaContactabilidad}%`,            pctColor(tasaContactabilidad, 30, 15));
  addMetric('Contactos efectivos',    metricas.contactos_efectivos || 0,    XLS.C_GREEN,
            'Contactos neutros',      metricas.cdrs_neutros || 0,           XLS.C_YELLOW);
  addMetric('No contactados',         metricas.cdrs_no_contactados || 0,    'FF9E9E9E',
            'Sin tipificar',          metricas.cdrs_sin_tipificar || 0,     XLS.C_MUTED);

  // ── SECCIÓN 3: Compromisos y Recaudo ──
  addSection('COMPROMISOS Y RECAUDO');
  addMetric('Promesas de pago (PMP)', metricas.promesas_pago || 0,          XLS.C_PRIMARY,
            'Monto comprometido',     fmtMonto(metricas.monto_comprometido),XLS.C_GREEN);
  addMetric('Pagos recaudados',       metricas.pagos_recaudados || 0,       XLS.C_GREEN,
            'Monto recaudado',        fmtMonto(metricas.monto_recaudado),   XLS.C_GREEN);
  addMetric('Compromisos cumplidos',  metricas.compromisos_cumplidos || 0,  XLS.C_GREEN,
            'Compromisos incumplidos',metricas.compromisos_incumplidos || 0,(metricas.compromisos_incumplidos || 0) > 0 ? XLS.C_RED : XLS.C_MUTED);
  addMetric('Reagendamientos',        metricas.compromisos_reagendados || 0,XLS.C_YELLOW);

  // ── SECCIÓN 4: Canales Digitales ──
  addSection('CANALES DIGITALES');
  addMetric('WhatsApp enviados',      metricas.wsp_enviados || 0,           XLS.C_GREEN,
            'Total acciones digitales',totalDigital,                        totalDigital > 0 ? XLS.C_PRIMARY : XLS.C_MUTED);
  addMetric('SMS enviados',           metricas.sms_enviados || 0,           XLS.C_YELLOW,
            'Correos enviados',       metricas.correos_enviados || 0,       XLS.C_BLUE);

  // ── Hoja 2: Historial de Eventos ──────────────────────────
  const wsEv = wb.addWorksheet('Historial Eventos');
  wsEv.mergeCells('A1:E1');
  const cEvTitle = wsEv.getCell('A1');
  cEvTitle.value = `Historial de Eventos — ${asesor.nombre} — ${fechaDisplay}`;
  cEvTitle.font  = { bold: true, size: 12, color: { argb: XLS.C_PRIMARY } };
  cEvTitle.fill  = XLS.BG_DARK;
  cEvTitle.alignment = { horizontal: 'center' };
  wsEv.addRow([]);
  const hEvRow = wsEv.addRow(['HORA', 'TIPO', 'ID ESTADO', 'DURACIÓN (seg)', 'METADATA']);
  hEvRow.font = { bold: true };
  hEvRow.fill = XLS.BG_SECTION;
  for (const ev of eventos) {
    wsEv.addRow([toLocalDateTime(ev.timestamp), ev.tipo, ev.estado_id || '-', ev.duracion_seg || '-', ev.metadata || '-']);
  }
  wsEv.columns = [{ width: 22 }, { width: 18 }, { width: 12 }, { width: 16 }, { width: 50 }];
  wsEv.views = [{ state: 'frozen', ySplit: 3 }];

  await wb.xlsx.writeFile(rutaArchivo);
}

async function generarPdfDiario(asesor, metricas, eventos, rutaArchivo, fechaDisplay) {
  const tasaContactabilidad = (metricas.cdrs_total || 0) > 0
    ? Math.round(((metricas.contactos_efectivos || 0) / (metricas.cdrs_total || 0)) * 100)
    : 0;
  const totalDigital = (metricas.wsp_enviados || 0) + (metricas.sms_enviados || 0) + (metricas.correos_enviados || 0);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const stream = fs.createWriteStream(rutaArchivo);
    doc.pipe(stream);

    const section = (label) => {
      doc.moveDown(0.8);
      doc.fontSize(12).fillColor('#00E5FF').text(label);
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor('#8B949E');
    };
    const metricLine = (label, value) => {
      doc.fillColor('#8B949E').text(`${label}: `, { continued: true });
      doc.fillColor('#F0F6FC').text(String(value));
    };

    // Header
    doc.fontSize(18).fillColor('#00E5FF').text(`INFORME OPERATIVO — ${asesor.nombre}`, { align: 'center' });
    doc.fontSize(11).fillColor('#8B949E').text(`Período: ${fechaDisplay}`, { align: 'center' });
    doc.moveDown();

    // Sección 1
    section('ACTIVIDAD DE LLAMADAS');
    metricLine('Marcaciones',     metricas.total_marcaciones || 0);
    metricLine('Tiempo al aire',  segundosAHora(metricas.tiempo_al_aire || 0));
    metricLine('Tiempo muerto',   segundosAHora(metricas.tiempo_muerto || 0));
    metricLine('Productividad',   `${metricas.ratio_productividad || 0}%`);
    metricLine('Eficacia',        `${metricas.ratio_eficacia || 0}%`);

    // Sección 2
    section('CONTACTABILIDAD');
    metricLine('CDRs tipificados',     metricas.cdrs_total || 0);
    metricLine('Contactos efectivos',  metricas.contactos_efectivos || 0);
    metricLine('Contactos neutros',    metricas.cdrs_neutros || 0);
    metricLine('No contactados',       metricas.cdrs_no_contactados || 0);
    metricLine('Tasa contactabilidad', `${tasaContactabilidad}%`);

    // Sección 3
    section('COMPROMISOS Y RECAUDO');
    metricLine('Promesas de pago',    metricas.promesas_pago || 0);
    metricLine('Pagos recaudados',    metricas.pagos_recaudados || 0);
    metricLine('Monto comprometido',  `$${Number(metricas.monto_comprometido || 0).toFixed(2)}`);
    metricLine('Monto recaudado',     `$${Number(metricas.monto_recaudado || 0).toFixed(2)}`);
    metricLine('Cumplidos',           metricas.compromisos_cumplidos || 0);
    metricLine('Incumplidos',         metricas.compromisos_incumplidos || 0);

    // Sección 4
    section('CANALES DIGITALES');
    metricLine('WhatsApp', metricas.wsp_enviados || 0);
    metricLine('SMS',      metricas.sms_enviados || 0);
    metricLine('Correos',  metricas.correos_enviados || 0);
    metricLine('Total acciones digitales', totalDigital);

    // Eventos (resumen)
    if (eventos.length > 0) {
      section('HISTORIAL DE EVENTOS (primeros 40)');
      for (const ev of eventos.slice(0, 40)) {
        doc.fontSize(9).fillColor('#8B949E')
          .text(`[${toLocalDateTime(ev.timestamp)}] ${ev.tipo}${ev.estado_id ? ' → ' + ev.estado_id : ''}${ev.duracion_seg ? ' (' + ev.duracion_seg + 's)' : ''}`);
      }
    }

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

// ─── REPORTE DE EQUIPO ───────────────────────────────────────────────────
async function generarReporteEquipo(fecha, formato = 'xlsx', fechaFin = null) {
  const asesores  = getAsesores();
  const f    = fecha    || _todayLocalISO();
  const fFin = fechaFin || f;
  const esRango    = f !== fFin;
  const rangoLabel = esRango ? `${f} al ${fFin}` : f;
  const sufijo     = esRango ? `${formatDate(f)}_${formatDate(fFin)}` : formatDate(f);

  const nombreArchivo = `informe_operativo_equipo_${sufijo}_${_timeSuffix()}.${formato}`;
  const rutaArchivo   = path.join(getExportDir(), nombreArchivo);

  const dataEquipo = asesores.map(a => {
    const m = esRango ? _getMetricasRango(a.id, f, fFin) : getMetricasDia(a.id, f);
    return { nombre: a.nombre, id: a.id, ...m };
  });

  if (formato === 'csv') {
    const COLS = [
      'Asesor','Marcaciones','T. Aire','Productividad%','Eficacia%',
      'CDRs','Efectivos','Neutros','No Contactados','Tasa Contact%',
      'Compromisos','M. Comprometido','M. Recaudado',
      'WhatsApp','SMS','Correos','Total Digital',
    ];
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = dataEquipo.map(d => {
      const tasa = (d.cdrs_total || 0) > 0 ? Math.round(((d.contactos_efectivos || 0) / d.cdrs_total) * 100) : 0;
      const td   = (d.wsp_enviados || 0) + (d.sms_enviados || 0) + (d.correos_enviados || 0);
      return [
        d.nombre, d.total_marcaciones || 0, segundosAHora(d.tiempo_al_aire || 0),
        d.ratio_productividad || 0, d.ratio_eficacia || 0,
        d.cdrs_total || 0, d.contactos_efectivos || 0, d.cdrs_neutros || 0, d.cdrs_no_contactados || 0, tasa,
        d.total_compromisos || 0,
        Number(d.monto_comprometido || 0).toFixed(2), Number(d.monto_recaudado || 0).toFixed(2),
        d.wsp_enviados || 0, d.sms_enviados || 0, d.correos_enviados || 0, td,
      ].map(esc).join(',');
    });
    fs.writeFileSync(rutaArchivo, '﻿' + COLS.join(',') + '\n' + rows.join('\n'), 'utf8');
    return { success: true, archivo: rutaArchivo };
  }

  // XLSX
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ANTIGRAVITY';

  // ── Hoja 1: Ranking Operativo ──────────────────────────────
  const ws = wb.addWorksheet('Ranking Operativo');

  const COL_WIDTHS = [26, 11, 13, 13, 11, 9, 11, 11, 13, 10, 13, 18, 16, 9, 9, 11, 13];
  ws.columns = COL_WIDTHS.map(w => ({ width: w }));

  // Fila 1: Título
  ws.mergeCells('A1:Q1');
  const cT = ws.getCell('A1');
  cT.value = `INFORME OPERATIVO DEL EQUIPO — ${rangoLabel.toUpperCase()}`;
  cT.font  = { bold: true, size: 15, color: { argb: XLS.C_PRIMARY } };
  cT.fill  = XLS.BG_DARK;
  cT.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 30;

  // Fila 2: Generado
  ws.mergeCells('A2:Q2');
  const cG = ws.getCell('A2');
  cG.value = `Generado: ${new Date().toLocaleString('es')}   ·   ${dataEquipo.length} asesores`;
  cG.font  = { size: 9, color: { argb: XLS.C_MUTED } };
  cG.fill  = XLS.BG_DARK;
  cG.alignment = { horizontal: 'center' };

  // Fila 3: Grupos de columnas
  const grupos = [
    { label: '', col: 'A', end: 'A' },
    { label: 'LLAMADAS',           col: 'B', end: 'E' },
    { label: 'CONTACTABILIDAD',    col: 'F', end: 'J' },
    { label: 'COMPROMISOS Y RECAUDO', col: 'K', end: 'M' },
    { label: 'CANALES DIGITALES',  col: 'N', end: 'Q' },
  ];
  const grupoRow = ws.addRow([]);
  ws.getRow(3).height = 18;
  for (const g of grupos) {
    if (!g.label) continue;
    ws.mergeCells(`${g.col}3:${g.end}3`);
    const cell = ws.getCell(`${g.col}3`);
    cell.value = g.label;
    cell.font  = { bold: true, size: 9, color: { argb: XLS.C_MUTED } };
    cell.fill  = XLS.BG_DARK;
    cell.alignment = { horizontal: 'center' };
  }

  // Fila 4: Encabezados de columna
  const HEADERS = [
    'Asesor',
    'Marc.', 'T. Aire', 'Productiv.%', 'Eficacia%',
    'CDRs', 'Efectivos', 'Neutros', 'No Cont.', 'Tasa%',
    'Compromisos', 'M. Comprometido', 'M. Recaudado',
    'WSP', 'SMS', 'Correos', 'Total Digital',
  ];
  const hRow = ws.addRow(HEADERS);
  hRow.font  = { bold: true, size: 10 };
  hRow.fill  = XLS.BG_SECTION;
  hRow.alignment = { horizontal: 'center', wrapText: true };
  ws.getRow(4).height = 24;

  // Acumuladores para fila de totales
  const totales = new Array(HEADERS.length).fill(0);
  totales[0] = 'TOTAL EQUIPO';
  let filasConActividad = 0;

  // Ordenar por marcaciones desc
  const ordenados = [...dataEquipo].sort((a, b) => (b.total_marcaciones || 0) - (a.total_marcaciones || 0));

  for (const d of ordenados) {
    const tasa = (d.cdrs_total || 0) > 0
      ? Math.round(((d.contactos_efectivos || 0) / d.cdrs_total) * 100)
      : 0;
    const td = (d.wsp_enviados || 0) + (d.sms_enviados || 0) + (d.correos_enviados || 0);
    const prod = d.ratio_productividad || 0;

    const rowData = [
      d.nombre,
      d.total_marcaciones || 0,
      segundosAHora(d.tiempo_al_aire || 0),
      `${prod}%`,
      `${d.ratio_eficacia || 0}%`,
      d.cdrs_total || 0,
      d.contactos_efectivos || 0,
      d.cdrs_neutros || 0,
      d.cdrs_no_contactados || 0,
      `${tasa}%`,
      d.total_compromisos || 0,
      Number(d.monto_comprometido || 0).toFixed(2),
      Number(d.monto_recaudado || 0).toFixed(2),
      d.wsp_enviados || 0,
      d.sms_enviados || 0,
      d.correos_enviados || 0,
      td,
    ];

    const row = ws.addRow(rowData);
    row.height = 18;
    row.getCell(1).font = { bold: true, color: { argb: XLS.C_WHITE } };
    // Marcaciones — cyan
    row.getCell(2).font = { bold: true, color: { argb: XLS.C_PRIMARY } };
    // Productividad — color semáforo
    row.getCell(4).font = { bold: true, color: { argb: prod >= 70 ? XLS.C_GREEN : prod >= 40 ? XLS.C_YELLOW : XLS.C_RED } };
    // Efectivos — verde
    row.getCell(7).font = { bold: true, color: { argb: XLS.C_GREEN } };
    // No contactados — gris
    row.getCell(9).font = { color: { argb: '9E9E9E' } };
    // Tasa
    row.getCell(10).font = { bold: true, color: { argb: tasa >= 30 ? XLS.C_GREEN : tasa >= 15 ? XLS.C_YELLOW : XLS.C_RED } };
    // Compromisos — cyan si > 0
    if ((d.total_compromisos || 0) > 0) row.getCell(11).font = { bold: true, color: { argb: XLS.C_PRIMARY } };
    // Montos — verde
    row.getCell(12).font = { bold: true, color: { argb: XLS.C_GREEN } };
    row.getCell(13).font = { bold: true, color: { argb: XLS.C_GREEN } };
    // Digital
    if ((d.wsp_enviados || 0) > 0) row.getCell(14).font = { bold: true, color: { argb: XLS.C_GREEN } };
    if ((d.sms_enviados || 0) > 0) row.getCell(15).font = { bold: true, color: { argb: XLS.C_YELLOW } };
    if ((d.correos_enviados || 0) > 0) row.getCell(16).font = { bold: true, color: { argb: XLS.C_BLUE } };
    if (td > 0) row.getCell(17).font = { bold: true, color: { argb: XLS.C_PRIMARY } };

    // Acumular totales (solo campos numéricos)
    const NUM_COLS = [1, 5, 9, 13, 14, 15, 16]; // índices 0-based de los que son numéricos
    totales[1]  += (d.total_marcaciones || 0);
    totales[5]  += (d.cdrs_total || 0);
    totales[6]  += (d.contactos_efectivos || 0);
    totales[7]  += (d.cdrs_neutros || 0);
    totales[8]  += (d.cdrs_no_contactados || 0);
    totales[10] += (d.total_compromisos || 0);
    totales[11] += (d.monto_comprometido || 0);
    totales[12] += (d.monto_recaudado || 0);
    totales[13] += (d.wsp_enviados || 0);
    totales[14] += (d.sms_enviados || 0);
    totales[15] += (d.correos_enviados || 0);
    totales[16] += td;
    if ((d.total_marcaciones || 0) > 0) filasConActividad++;
  }

  // Fila de totales
  ws.addRow([]);
  const tData = totales.map((v, i) => {
    if (i === 0)  return 'TOTAL EQUIPO';
    if (i === 2)  return '—';            // T. Aire: no aplica sumar
    if (i === 3)  return filasConActividad > 0 ? `${Math.round(totales[3] / Math.max(1, filasConActividad))}% prom.` : '—'; // promedio prod
    if (i === 4)  return '—';
    if (i === 9)  return totales[5] > 0 ? `${Math.round((totales[6] / totales[5]) * 100)}%` : '0%'; // tasa global
    if (i === 11) return Number(v).toFixed(2);
    if (i === 12) return Number(v).toFixed(2);
    return v;
  });
  const totRow = ws.addRow(tData);
  totRow.height = 22;
  totRow.font   = { bold: true, size: 11, color: { argb: XLS.C_WHITE } };
  totRow.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B2030' } };
  totRow.getCell(2).font  = { bold: true, color: { argb: XLS.C_PRIMARY } };
  totRow.getCell(12).font = { bold: true, color: { argb: XLS.C_GREEN } };
  totRow.getCell(13).font = { bold: true, color: { argb: XLS.C_GREEN } };

  ws.views = [{ state: 'frozen', ySplit: 4, xSplit: 1 }];

  // ── Hoja 2: Resumen Canales Digitales ─────────────────────
  const wsD = wb.addWorksheet('Canales Digitales');
  wsD.columns = [{ width: 26 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 16 }];
  wsD.mergeCells('A1:E1');
  const cDT = wsD.getCell('A1');
  cDT.value = `Canales Digitales por Asesor — ${rangoLabel}`;
  cDT.font  = { bold: true, size: 13, color: { argb: XLS.C_PRIMARY } };
  cDT.fill  = XLS.BG_DARK;
  cDT.alignment = { horizontal: 'center' };
  wsD.addRow([]);
  const hDRow = wsD.addRow(['Asesor', 'WhatsApp', 'SMS', 'Correos', 'Total Digital']);
  hDRow.font = { bold: true };
  hDRow.fill = XLS.BG_SECTION;
  for (const d of ordenados) {
    const td = (d.wsp_enviados || 0) + (d.sms_enviados || 0) + (d.correos_enviados || 0);
    const r  = wsD.addRow([d.nombre, d.wsp_enviados || 0, d.sms_enviados || 0, d.correos_enviados || 0, td]);
    if ((d.wsp_enviados || 0) > 0) r.getCell(2).font = { bold: true, color: { argb: XLS.C_GREEN } };
    if ((d.sms_enviados || 0) > 0) r.getCell(3).font = { bold: true, color: { argb: XLS.C_YELLOW } };
    if ((d.correos_enviados || 0) > 0) r.getCell(4).font = { bold: true, color: { argb: XLS.C_BLUE } };
    if (td > 0) r.getCell(5).font = { bold: true, color: { argb: XLS.C_PRIMARY } };
  }
  wsD.views = [{ state: 'frozen', ySplit: 3 }];

  await wb.xlsx.writeFile(rutaArchivo);
  return { success: true, archivo: rutaArchivo };
}

function generarCsvDiario(asesor, metricas, rutaArchivo) {
  const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const td  = (metricas.wsp_enviados || 0) + (metricas.sms_enviados || 0) + (metricas.correos_enviados || 0);
  const tasa = (metricas.cdrs_total || 0) > 0
    ? Math.round(((metricas.contactos_efectivos || 0) / metricas.cdrs_total) * 100)
    : 0;
  const COLS = [
    'Asesor','Marcaciones','T. Aire','Productividad%','Eficacia%',
    'CDRs','Efectivos','Neutros','No Contactados','Tasa Contact%',
    'Compromisos','M. Comprometido','M. Recaudado',
    'WhatsApp','SMS','Correos','Total Digital',
  ];
  const vals = [
    asesor.nombre,
    metricas.total_marcaciones || 0,
    segundosAHora(metricas.tiempo_al_aire || 0),
    `${metricas.ratio_productividad || 0}%`,
    `${metricas.ratio_eficacia || 0}%`,
    metricas.cdrs_total || 0,
    metricas.contactos_efectivos || 0,
    metricas.cdrs_neutros || 0,
    metricas.cdrs_no_contactados || 0,
    `${tasa}%`,
    metricas.total_compromisos || 0,
    Number(metricas.monto_comprometido || 0).toFixed(2),
    Number(metricas.monto_recaudado || 0).toFixed(2),
    metricas.wsp_enviados || 0,
    metricas.sms_enviados || 0,
    metricas.correos_enviados || 0,
    td,
  ];
  fs.writeFileSync(rutaArchivo, '﻿' + COLS.join(',') + '\n' + vals.map(esc).join(','), 'utf8');
}

// ─── REPORTE DE GESTIONES ────────────────────────────────────────────────────
async function generarReporteGestiones(asesor_id, fecha, formato = 'xlsx') {
  const asesor = findUserById(parseInt(asesor_id));
  if (!asesor) throw new Error('Asesor no encontrado');
  const f = fecha || null; // null = sin filtro de fecha → muestra todo el historial
  const gestiones = getCdrsGestiones(asesor_id, f);
  const nombreArchivo = `gestiones_${asesor.nombre.replace(/\s+/g, '_')}_${formatDate(f)}_${_timeSuffix()}.${formato}`;
  const rutaArchivo = path.join(getExportDir(), nombreArchivo);
  await _escribirGestiones(gestiones, rutaArchivo, `Gestiones — ${asesor.nombre} — ${f}`, formato);
  return { success: true, archivo: rutaArchivo };
}

async function generarReporteGestionesEquipo(fecha, formato = 'xlsx') {
  const f = fecha || _todayLocalISO();
  const gestiones = getCdrsGestiones(null, f);
  const nombreArchivo = `gestiones_equipo_${formatDate(f)}_${_timeSuffix()}.${formato}`;
  const rutaArchivo = path.join(getExportDir(), nombreArchivo);
  await _escribirGestiones(gestiones, rutaArchivo, `Gestiones Equipo — ${f}`, formato);
  return { success: true, archivo: rutaArchivo };
}

async function _escribirGestiones(gestiones, rutaArchivo, titulo, formato) {
  const COLS = [
    'Fecha/Hora', 'Asesor', 'Cliente', 'CI/Cédula', 'Teléfono',
    'Empresa', 'Contrato', 'Tipificación',
    'Monto Acordado', 'Fecha Promesa', 'Mora Cliente',
    'Observaciones', 'Subgestiones (Tel | Nombre | Parentesco | Nota)',
  ];
  const fmtMonto = (v) => v != null ? Number(v).toFixed(2) : '';
  const buildRow = (g) => [
    toLocalDateTime(g.fecha_hora),
    g.asesor || '',
    g.cliente || '',
    g.ci || '',
    g.telefono || '',
    g.empresa || '',
    g.contrato || '',
    g.tipificacion || '',
    fmtMonto(g.monto_acordado),
    toLocalDateTime(g.fecha_promesa),
    fmtMonto(g.valor_mora),
    g.observaciones || '',
    g.subgestiones || '',
  ];

  if (formato === 'csv') {
    const escape = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = gestiones.map(g => buildRow(g).map(escape).join(','));
    fs.writeFileSync(rutaArchivo, '﻿' + COLS.join(',') + '\n' + rows.join('\n'), 'utf8');
    return;
  }

  // xlsx (default)
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ANTIGRAVITY';
  const ws = wb.addWorksheet('Gestiones');

  const lastCol = String.fromCharCode(64 + COLS.length); // 'M' para 13 cols
  ws.mergeCells(`A1:${lastCol}1`);
  ws.getCell('A1').value = titulo;
  ws.getCell('A1').font = { bold: true, size: 13, color: { argb: 'FF58A6FF' } };
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1117' } };
  ws.getCell('A1').alignment = { horizontal: 'center' };

  ws.addRow([]);
  const hRow = ws.addRow(COLS);
  hRow.font = { bold: true };
  hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF161B22' } };

  // Resaltar filas de compromisos (PMP/PAGO_REAL/AB_PARC/PEND_COMP)
  const COMPROMISO_CODES = new Set(['PMP', 'PAGO_REAL', 'AB_PARC', 'PEND_COMP']);
  for (const g of gestiones) {
    const row = ws.addRow(buildRow(g));
    if (COMPROMISO_CODES.has(g.tipificacion_codigo)) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3A2E' } };
      // Monto en columna I (9), color verde si tiene; ámbar si está vacío
      const cellMonto = row.getCell(9);
      if (g.monto_acordado != null) {
        cellMonto.font = { bold: true, color: { argb: 'FF00E676' } };
      } else {
        cellMonto.value = 'SIN CAPTURAR';
        cellMonto.font = { italic: true, color: { argb: 'FFFFB74D' } };
      }
    }
    // Subgestiones en col M (13): resaltar en naranja suave si hay datos
    if (g.subgestiones) {
      row.getCell(13).font = { italic: true, color: { argb: 'FFFFB74D' } };
    }
  }
  ws.columns.forEach((col, i) => {
    col.width = [20, 18, 22, 14, 14, 12, 14, 20, 14, 18, 14, 35, 50][i] || 16;
  });
  await wb.xlsx.writeFile(rutaArchivo);
}

// ─── REPORTE CARTERA EQUIPO ─────────────────────────────────────────────────
async function generarCarteraEquipo(contactoIds, formato = 'xlsx') {
  const ESTADO_LABEL = {
    PENDIENTE: 'Pendiente',
    EN_INTENTOS: 'En intentos',
    AGENDADO: 'Agendado',
    GESTIONADO: 'Gestionado',
    YA_PAGO: 'Ya pagó',
  };

  // Obtener cartera completa y filtrar por IDs si vienen
  const todos = getCarteraEquipo();
  const filtrados = (Array.isArray(contactoIds) && contactoIds.length > 0)
    ? todos.filter(r => contactoIds.includes(r.id))
    : todos;

  const nombreArchivo = `carteras_equipo_${formatDate()}_${_timeSuffix()}.${formato}`;
  const rutaArchivo = path.join(getExportDir(), nombreArchivo);

  const COLS = [
    'Asesor', 'Estado', 'Cliente', 'Cédula', 'Teléfono',
    'Empresa', 'Contrato', 'Campaña',
    'Gestiones', 'Última Tipificación', 'Asignado', 'Mora', 'Días Mora',
  ];

  const parseMeta = (r) => { try { return JSON.parse(r.metadata || '{}'); } catch { return {}; } };
  const buildRow = (r) => {
    const meta = parseMeta(r);
    const diasRaw = meta['DIAS IMPAGO'] || meta['DIAS EN INPAGO'] || meta['DIAS MORA'];
    const diasMora = diasRaw != null && diasRaw !== '' ? (parseInt(diasRaw, 10) || diasRaw) : '';
    return [
      r.asesor_nombre || '—',
      ESTADO_LABEL[r.estado_marcacion] || r.estado_marcacion || '',
      r.nombre_deudor || '',
      r.cedula || '',
      r.telefono || '',
      meta['EMPRESA'] || '',
      meta['Nº CONTRATO'] || meta['CONTRATO'] || '',
      r.campana_nombre || '',
      r.gestiones_count || 0,
      r.ultima_tipificacion || '',
      r.fecha_asignacion ? r.fecha_asignacion.slice(0, 10) : '',
      meta['VALOR EN MORA'] != null ? Number(meta['VALOR EN MORA']).toFixed(2) : (r.monto_deuda != null ? Number(r.monto_deuda).toFixed(2) : ''),
      diasMora,
    ];
  };

  if (formato === 'csv') {
    const escape = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = filtrados.map(r => buildRow(r).map(escape).join(','));
    fs.writeFileSync(rutaArchivo, '﻿' + COLS.join(',') + '\n' + rows.join('\n'), 'utf8');
    return { success: true, archivo: rutaArchivo };
  }

  // xlsx
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ANTIGRAVITY';
  const ws = wb.addWorksheet('Carteras');

  const lastCol = String.fromCharCode(64 + COLS.length); // L
  ws.mergeCells(`A1:${lastCol}1`);
  ws.getCell('A1').value = `Carteras del Equipo — ${_todayLocalISO()} (${filtrados.length} registros)`;
  ws.getCell('A1').font = { bold: true, size: 13, color: { argb: 'FF58A6FF' } };
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1117' } };
  ws.getCell('A1').alignment = { horizontal: 'center' };

  ws.addRow([]);
  const hRow = ws.addRow(COLS);
  hRow.font = { bold: true };
  hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF161B22' } };

  // Color por estado en columna B
  const ESTADO_COLOR = {
    PENDIENTE:   'FFFFB74D',
    EN_INTENTOS: 'FFFBC02D',
    AGENDADO:    'FF64B5F6',
    GESTIONADO:  'FF00E676',
    YA_PAGO:     'FFCE93D8',
  };

  for (const r of filtrados) {
    const row = ws.addRow(buildRow(r));
    const estadoColor = ESTADO_COLOR[r.estado_marcacion];
    if (estadoColor) {
      const cellEstado = row.getCell(2);
      cellEstado.font = { bold: true, color: { argb: estadoColor } };
    }
    // Mora en columna 12 → bold rojo si > 0
    const cellMora = row.getCell(12);
    if (cellMora.value && parseFloat(cellMora.value) > 0) {
      cellMora.font = { bold: true, color: { argb: 'FFEF4444' } };
    }
    // Gestiones col 9 → verde si > 0
    const cellGest = row.getCell(9);
    if (r.gestiones_count > 0) {
      cellGest.font = { bold: true, color: { argb: 'FF00E676' } };
    }
    // Días Mora col 13 → naranja si > 0
    const cellDias = row.getCell(13);
    if (cellDias.value && parseInt(cellDias.value, 10) > 0) {
      cellDias.font = { bold: true, color: { argb: 'FFFF9800' } };
    }
  }
  ws.columns.forEach((col, i) => {
    col.width = [18, 14, 22, 14, 14, 12, 14, 18, 10, 22, 12, 12, 10][i] || 14;
  });

  // Freeze top rows (header)
  ws.views = [{ state: 'frozen', ySplit: 3 }];

  await wb.xlsx.writeFile(rutaArchivo);
  return { success: true, archivo: rutaArchivo };
}

// ─── REPORTE CARTERA INDIVIDUAL (ASESOR) ────────────────────────────────────
async function generarCarteraAsesor(asesorId, formato = 'xlsx', filtros = {}) {
  const ESTADO_LABEL = {
    PENDIENTE: 'Pendiente',
    EN_INTENTOS: 'En intentos',
    AGENDADO: 'Agendado',
    GESTIONADO: 'Gestionado',
    YA_PAGO: 'Ya pagó',
  };

  const asesor = findUserById(asesorId);
  const nombreAsesor = asesor?.nombre || `asesor_${asesorId}`;
  const todos = getCarteraAsesor(asesorId);

  // Aplicar filtros opcionales server-side
  const fechaDesde = filtros.fecha_desde || '';
  const fechaHasta = filtros.fecha_hasta || '';
  const estado = filtros.estado && filtros.estado !== 'TODOS' ? filtros.estado : '';
  const extraerFechaIso = (raw) => (raw && typeof raw === 'string' && raw.length >= 10) ? raw.slice(0, 10) : '';

  const filtrados = todos.filter(r => {
    if (estado && r.estado_marcacion !== estado) return false;
    if (fechaDesde || fechaHasta) {
      const f = extraerFechaIso(r.fecha_asignacion);
      if (fechaDesde && (!f || f < fechaDesde)) return false;
      if (fechaHasta && (!f || f > fechaHasta)) return false;
    }
    return true;
  });

  const safeName = nombreAsesor.replace(/[^a-zA-Z0-9_-]/g, '_');
  const nombreArchivo = `cartera_${safeName}_${formatDate()}_${_timeSuffix()}.${formato}`;
  const rutaArchivo = path.join(getExportDir(), nombreArchivo);

  const COLS = [
    'Estado', 'Cliente', 'Cédula', 'Teléfono',
    'Empresa', 'Contrato', 'Campaña',
    'Gestiones', 'Última Tipificación', 'Asignado', 'Mora',
  ];

  const parseMeta = (r) => { try { return JSON.parse(r.metadata || '{}'); } catch { return {}; } };
  const buildRow = (r) => {
    const meta = parseMeta(r);
    return [
      ESTADO_LABEL[r.estado_marcacion] || r.estado_marcacion || '',
      r.nombre_deudor || '',
      r.cedula || '',
      r.telefono || '',
      meta['EMPRESA'] || '',
      meta['Nº CONTRATO'] || meta['CONTRATO'] || '',
      r.campana_nombre || '',
      r.gestiones_count || 0,
      r.ultima_tipificacion || '',
      r.fecha_asignacion ? r.fecha_asignacion.slice(0, 10) : '',
      meta['VALOR EN MORA'] != null ? Number(meta['VALOR EN MORA']).toFixed(2) : (r.monto_deuda != null ? Number(r.monto_deuda).toFixed(2) : ''),
    ];
  };

  if (formato === 'csv') {
    const escape = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = filtrados.map(r => buildRow(r).map(escape).join(','));
    fs.writeFileSync(rutaArchivo, '﻿' + COLS.join(',') + '\n' + rows.join('\n'), 'utf8');
    return { success: true, archivo: rutaArchivo };
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'ANTIGRAVITY';
  const ws = wb.addWorksheet('Cartera');

  const lastCol = String.fromCharCode(64 + COLS.length); // K
  ws.mergeCells(`A1:${lastCol}1`);
  const rangoTxt = (fechaDesde || fechaHasta) ? ` (${fechaDesde || '...'} a ${fechaHasta || '...'})` : '';
  ws.getCell('A1').value = `Cartera de ${nombreAsesor}${rangoTxt} — ${filtrados.length} clientes`;
  ws.getCell('A1').font = { bold: true, size: 13, color: { argb: 'FF58A6FF' } };
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1117' } };
  ws.getCell('A1').alignment = { horizontal: 'center' };

  ws.addRow([]);
  const hRow = ws.addRow(COLS);
  hRow.font = { bold: true };
  hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF161B22' } };

  const ESTADO_COLOR = {
    PENDIENTE:   'FFFFB74D',
    EN_INTENTOS: 'FFFBC02D',
    AGENDADO:    'FF64B5F6',
    GESTIONADO:  'FF00E676',
    YA_PAGO:     'FFCE93D8',
  };

  for (const r of filtrados) {
    const row = ws.addRow(buildRow(r));
    const estadoColor = ESTADO_COLOR[r.estado_marcacion];
    if (estadoColor) row.getCell(1).font = { bold: true, color: { argb: estadoColor } };
    const cellMora = row.getCell(11);
    if (cellMora.value && parseFloat(cellMora.value) > 0) cellMora.font = { bold: true, color: { argb: 'FFEF4444' } };
    const cellGest = row.getCell(8);
    if (r.gestiones_count > 0) cellGest.font = { bold: true, color: { argb: 'FF00E676' } };
  }
  ws.columns.forEach((col, i) => { col.width = [14, 22, 14, 14, 12, 14, 18, 10, 22, 12, 12][i] || 14; });
  ws.views = [{ state: 'frozen', ySplit: 3 }];

  await wb.xlsx.writeFile(rutaArchivo);
  return { success: true, archivo: rutaArchivo };
}

// ─── REPORTE DETALLE MÉTRICA (Promesas / Recaudado) ─────────────────────────
async function generarDetalleMetrica(tipoMet, fecha, formato = 'xlsx') {
  const TIPO_LABEL = {
    PMP: 'Promesa de Pago',
    PAGO_REAL: 'Pago Realizado',
    AB_PARC: 'Abono Parcial',
    PEND_COMP: 'Pendiente Comprobante',
  };
  const codigos = tipoMet === 'PROMESAS' ? ['PMP'] : ['PAGO_REAL', 'AB_PARC', 'PEND_COMP'];
  const titulo = tipoMet === 'PROMESAS' ? 'Detalle — Promesas de Pago' : 'Detalle — Ya Recaudado';

  const all = getCompromisosEquipo(fecha || null, null);
  const filtrados = (Array.isArray(all) ? all : []).filter(r => codigos.includes(r.tipificacion_codigo));

  const nombreArchivo = `detalle_${tipoMet.toLowerCase()}_${formatDate(fecha)}_${_timeSuffix()}.${formato}`;
  const rutaArchivo = path.join(getExportDir(), nombreArchivo);

  const COLS = [
    'Hora Gestión', 'Asesor', 'Cliente', 'Cédula', 'Teléfono',
    'Empresa', 'Contrato', 'Tipificación',
    'Monto Acordado', 'Fecha Promesa', 'Mora Cliente', 'Notas',
  ];

  const fmtMonto = (v) => v != null ? Number(v).toFixed(2) : '';
  const buildRow = (r) => [
    toLocalDateTime(r.hora_gestion),
    r.asesor_nombre || '',
    r.nombre_deudor || '',
    r.cedula || '',
    r.telefono || '',
    r.empresa || '',
    r.contrato || '',
    TIPO_LABEL[r.tipificacion_codigo] || r.tipificacion_desc || '',
    fmtMonto(r.monto_acordado),
    toLocalDateTime(r.fecha_promesa),
    fmtMonto(r.valor_mora),
    r.notas || '',
  ];

  if (formato === 'csv') {
    const escape = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = filtrados.map(r => buildRow(r).map(escape).join(','));
    fs.writeFileSync(rutaArchivo, '﻿' + COLS.join(',') + '\n' + rows.join('\n'), 'utf8');
    return { success: true, archivo: rutaArchivo };
  }

  // xlsx
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ANTIGRAVITY';
  const ws = wb.addWorksheet('Detalle');
  const lastCol = String.fromCharCode(64 + COLS.length);
  ws.mergeCells(`A1:${lastCol}1`);
  const fechaTxt = fecha ? ` — ${fecha}` : ' — todas las fechas';
  ws.getCell('A1').value = `${titulo}${fechaTxt} (${filtrados.length} registros)`;
  ws.getCell('A1').font = { bold: true, size: 13, color: { argb: 'FF58A6FF' } };
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1117' } };
  ws.getCell('A1').alignment = { horizontal: 'center' };
  ws.addRow([]);
  const hRow = ws.addRow(COLS);
  hRow.font = { bold: true };
  hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF161B22' } };

  const TIP_COLOR = {
    PMP: 'FF64B5F6',
    PAGO_REAL: 'FF00E676',
    AB_PARC: 'FFFFD54F',
    PEND_COMP: 'FFCE93D8',
  };
  for (const r of filtrados) {
    const row = ws.addRow(buildRow(r));
    const tipCol = TIP_COLOR[r.tipificacion_codigo];
    if (tipCol) row.getCell(8).font = { bold: true, color: { argb: tipCol } };
    const cellMonto = row.getCell(9);
    if (r.monto_acordado != null) cellMonto.font = { bold: true, color: { argb: 'FF00E676' } };
    else { cellMonto.value = 'SIN CAPTURAR'; cellMonto.font = { italic: true, color: { argb: 'FFFFB74D' } }; }
    const cellMora = row.getCell(11);
    if (cellMora.value && parseFloat(cellMora.value) > 0) cellMora.font = { bold: true, color: { argb: 'FFEF4444' } };
  }
  ws.columns.forEach((col, i) => {
    col.width = [18, 18, 22, 14, 14, 12, 14, 18, 14, 18, 12, 35][i] || 14;
  });
  ws.views = [{ state: 'frozen', ySplit: 3 }];
  await wb.xlsx.writeFile(rutaArchivo);
  return { success: true, archivo: rutaArchivo };
}

// ─── REPORTE CONTACTABILIDAD POR HORA ───────────────────────────────────────
async function generarContactabilidadHora(fecha, asesorId, formato = 'xlsx', campanaId = null) {
  const data = getDetalleContactabilidad(fecha || null, asesorId || null, campanaId || null);
  const arr = Array.isArray(data) ? data : [];

  const fechaTxt = fecha || 'todas las fechas';
  const nombreArchivo = `contactabilidad_${formatDate(fecha)}_${_timeSuffix()}.${formato}`;
  const rutaArchivo = path.join(getExportDir(), nombreArchivo);

  const COLS = [
    'Hora Inicio', 'Hora Fin', 'Duración (seg)', 'Asesor',
    'Cliente', 'Cédula', 'Teléfono', 'Empresa', 'Contrato',
    'Tipificación', 'Categoría', 'Notas',
  ];

  const fmtDur = (s) => s != null ? Number(s).toString() : '';
  const buildRow = (r) => [
    toLocalDateTime(r.hora_inicio),
    toLocalDateTime(r.hora_fin),
    fmtDur(r.duracion_seg),
    r.asesor_nombre || '',
    r.nombre_deudor || '',
    r.cedula || '',
    r.telefono || '',
    r.empresa || '',
    r.contrato || '',
    r.tipificacion_desc || '',
    r.tipificacion_categoria || '',
    r.notas || '',
  ];

  if (formato === 'csv') {
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = arr.map(r => buildRow(r).map(esc).join(','));
    fs.writeFileSync(rutaArchivo, '﻿' + COLS.join(',') + '\n' + rows.join('\n'), 'utf8');
    return { success: true, archivo: rutaArchivo };
  }

  // xlsx
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ANTIGRAVITY';
  const ws = wb.addWorksheet('Contactabilidad');
  const lastCol = String.fromCharCode(64 + COLS.length);
  ws.mergeCells(`A1:${lastCol}1`);
  ws.getCell('A1').value = `Contactabilidad por Hora — ${fechaTxt} (${arr.length} gestiones)`;
  ws.getCell('A1').font = { bold: true, size: 13, color: { argb: 'FF58A6FF' } };
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1117' } };
  ws.getCell('A1').alignment = { horizontal: 'center' };
  ws.addRow([]);
  const hRow = ws.addRow(COLS);
  hRow.font = { bold: true };
  hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF161B22' } };

  const CAT_COLOR = {
    'CONTACTO_EFECTIVO': 'FF00E676',
    'CONTACTO EXITOSO':  'FF00E676',
    'CONTACTO_NEUTRO':   'FFFBC02D',
    'CONTACTO NEUTRO':   'FFFBC02D',
    'NO_CONTACTADO':     'FF9E9E9E',
    'NO CONTACTADO':     'FF9E9E9E',
  };
  for (const r of arr) {
    const row = ws.addRow(buildRow(r));
    const catCol = CAT_COLOR[r.tipificacion_categoria];
    if (catCol) row.getCell(11).font = { bold: true, color: { argb: catCol } };
  }
  ws.columns.forEach((col, i) => {
    col.width = [22, 22, 12, 18, 22, 14, 14, 14, 14, 22, 18, 35][i] || 14;
  });
  ws.views = [{ state: 'frozen', ySplit: 3 }];
  await wb.xlsx.writeFile(rutaArchivo);
  return { success: true, archivo: rutaArchivo };
}

// ─── REPORTE VOLUMEN DE MARCACIÓN POR HORA ────────────────────────────────
async function generarVolumenHora(fecha, asesorId, formato = 'xlsx', campanaId = null) {
  const data = getDetalleContactabilidad(fecha || null, asesorId || null, campanaId || null);
  const arr = Array.isArray(data) ? data : [];

  const fechaTxt = fecha || 'todas las fechas';
  const nombreArchivo = `volumen_marcacion_${formatDate(fecha)}_${_timeSuffix()}.${formato}`;
  const rutaArchivo = path.join(getExportDir(), nombreArchivo);

  // Construir resumen por asesor y hora pico
  const porAsesor = new Map();
  const buckets = new Array(24).fill(0).map((_, h) => ({ h, total: 0, byAsesor: new Map() }));
  for (const r of arr) {
    if (r.usuario_id == null) continue;
    const name = r.asesor_nombre || `Asesor ${r.usuario_id}`;
    if (!porAsesor.has(r.usuario_id)) {
      porAsesor.set(r.usuario_id, { id: r.usuario_id, nombre: name, total: 0, peakH: null, peakV: 0, horasActivas: 0 });
    }
    const ag = porAsesor.get(r.usuario_id);
    ag.total++;
    const h = r.hora_bucket;
    if (h != null && h >= 0 && h <= 23) {
      buckets[h].total++;
      buckets[h].byAsesor.set(r.usuario_id, (buckets[h].byAsesor.get(r.usuario_id) || 0) + 1);
    }
  }
  // Hora pico individual + horas activas
  for (const [aid, ag] of porAsesor) {
    let peakH = null, peakV = 0;
    let horasActivas = 0;
    buckets.forEach(b => {
      const v = b.byAsesor.get(aid) || 0;
      if (v > 0) horasActivas++;
      if (v > peakV) { peakV = v; peakH = b.h; }
    });
    ag.peakH = peakH;
    ag.peakV = peakV;
    ag.horasActivas = horasActivas;
  }
  const totalGeneral = arr.length;
  const horaPico = buckets.reduce((max, b) => b.total > max.total ? b : max, { h: null, total: 0 });

  // CSV: solo CDR-level
  const COLS = [
    'Hora Inicio', 'Hora Fin', 'Hora (bucket)', 'Duración (seg)', 'Asesor',
    'Cliente', 'Cédula', 'Teléfono', 'Empresa', 'Contrato',
    'Tipificación', 'Categoría', 'Notas',
  ];
  const fmtDur = (s) => s != null ? Number(s).toString() : '';
  const buildRow = (r) => [
    toLocalDateTime(r.hora_inicio),
    toLocalDateTime(r.hora_fin),
    r.hora_bucket != null ? `${String(r.hora_bucket).padStart(2, '0')}:00` : '',
    fmtDur(r.duracion_seg),
    r.asesor_nombre || '',
    r.nombre_deudor || '',
    r.cedula || '',
    r.telefono || '',
    r.empresa || '',
    r.contrato || '',
    r.tipificacion_desc || '',
    r.tipificacion_categoria || '',
    r.notas || '',
  ];

  if (formato === 'csv') {
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = arr.map(r => buildRow(r).map(esc).join(','));
    fs.writeFileSync(rutaArchivo, '﻿' + COLS.join(',') + '\n' + rows.join('\n'), 'utf8');
    return { success: true, archivo: rutaArchivo };
  }

  // XLSX con dos hojas: Detalle (CDRs) + Resumen (asesor)
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ANTIGRAVITY';

  // Hoja 1: Resumen por Asesor
  const wsR = wb.addWorksheet('Resumen Asesor');
  wsR.mergeCells('A1:F1');
  wsR.getCell('A1').value = `Volumen de Marcación por Hora — Resumen — ${fechaTxt} (${totalGeneral} marcaciones · ${porAsesor.size} asesores)`;
  wsR.getCell('A1').font = { bold: true, size: 13, color: { argb: 'FF58A6FF' } };
  wsR.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1117' } };
  wsR.getCell('A1').alignment = { horizontal: 'center' };
  wsR.addRow([]);
  if (horaPico.h != null) {
    wsR.addRow([`Pico global: ${String(horaPico.h).padStart(2, '0')}:00 — ${horaPico.total} marcaciones`]);
    wsR.getCell(`A${wsR.lastRow.number}`).font = { italic: true, color: { argb: 'FF00E676' } };
    wsR.addRow([]);
  }
  const hRowR = wsR.addRow(['Asesor', 'Marcaciones', '% del Total', 'Hora Pico', 'Pico (n)', 'Promedio/hora']);
  hRowR.font = { bold: true };
  hRowR.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF161B22' } };
  const resumenOrden = Array.from(porAsesor.values()).sort((a, b) => b.total - a.total);
  for (const a of resumenOrden) {
    const promedio = a.horasActivas > 0 ? (a.total / a.horasActivas).toFixed(1) : '0.0';
    const row = wsR.addRow([
      a.nombre,
      a.total,
      totalGeneral > 0 ? `${Math.round((a.total / totalGeneral) * 100)}%` : '0%',
      a.peakH != null ? `${String(a.peakH).padStart(2, '0')}:00` : '—',
      a.peakV,
      promedio,
    ]);
    row.getCell(2).font = { bold: true, color: { argb: 'FF00E5FF' } };
  }
  wsR.columns.forEach((col, i) => { col.width = [28, 14, 14, 12, 12, 14][i] || 14; });
  wsR.views = [{ state: 'frozen', ySplit: horaPico.h != null ? 5 : 3 }];

  // Hoja 2: Detalle CDRs
  const wsD = wb.addWorksheet('Detalle');
  const lastCol = String.fromCharCode(64 + COLS.length);
  wsD.mergeCells(`A1:${lastCol}1`);
  wsD.getCell('A1').value = `Volumen de Marcación por Hora — Detalle — ${fechaTxt} (${arr.length} CDRs)`;
  wsD.getCell('A1').font = { bold: true, size: 13, color: { argb: 'FF58A6FF' } };
  wsD.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1117' } };
  wsD.getCell('A1').alignment = { horizontal: 'center' };
  wsD.addRow([]);
  const hRowD = wsD.addRow(COLS);
  hRowD.font = { bold: true };
  hRowD.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF161B22' } };

  const CAT_COLOR = {
    'CONTACTO_EFECTIVO': 'FF00E676',
    'CONTACTO EXITOSO':  'FF00E676',
    'CONTACTO_NEUTRO':   'FFFBC02D',
    'CONTACTO NEUTRO':   'FFFBC02D',
    'NO_CONTACTADO':     'FF9E9E9E',
    'NO CONTACTADO':     'FF9E9E9E',
  };
  for (const r of arr) {
    const row = wsD.addRow(buildRow(r));
    const catCol = CAT_COLOR[r.tipificacion_categoria];
    if (catCol) row.getCell(12).font = { bold: true, color: { argb: catCol } };
  }
  wsD.columns.forEach((col, i) => {
    col.width = [22, 22, 12, 12, 22, 22, 14, 14, 14, 14, 22, 18, 35][i] || 14;
  });
  wsD.views = [{ state: 'frozen', ySplit: 3 }];

  await wb.xlsx.writeFile(rutaArchivo);
  return { success: true, archivo: rutaArchivo };
}

// ─── REPORTE MIS COMPROMISOS (asesor) ───────────────────────────────────────
async function generarMisCompromisos(asesorId, fecha, formato = 'xlsx', opts = {}) {
  const TIPO_LABEL = {
    PMP:        'Compromiso de Pago',
    PAGO_REAL:  'Pago Realizado',
    AB_PARC:    'Abono Parcial',
    PEND_COMP:  'Pendiente Comprobante',
    VOL_CALL:   'Volver a Llamar',
  };
  const TIPO_COLOR = {
    PMP:        'FF64B5F6',
    PAGO_REAL:  'FF00E676',
    AB_PARC:    'FFFFD54F',
    PEND_COMP:  'FFCE93D8',
    VOL_CALL:   'FFFF8A65',
  };

  const asesor = findUserById(parseInt(asesorId));
  if (!asesor) throw new Error('Asesor no encontrado');

  const all = getCompromisosEquipo(fecha || null, parseInt(asesorId), { incluirVolCall: true });
  const arr = Array.isArray(all) ? all : [];
  const tipoFiltro = opts.tipo_filtro && opts.tipo_filtro !== 'TODOS' ? opts.tipo_filtro : '';
  const filtrados = tipoFiltro ? arr.filter(r => r.tipificacion_codigo === tipoFiltro) : arr;

  const safeName = (asesor.nombre || `asesor_${asesorId}`).replace(/[^a-zA-Z0-9_-]/g, '_');
  const nombreArchivo = `mis_compromisos_${safeName}_${formatDate(fecha)}_${_timeSuffix()}.${formato}`;
  const rutaArchivo = path.join(getExportDir(), nombreArchivo);

  const COLS = [
    'Hora Gestión', 'Cliente', 'Cédula', 'Teléfono',
    'Empresa', 'Contrato', 'Tipificación',
    'Monto Acordado', 'Fecha Promesa', 'Mora Cliente',
    'Duración (s)', 'Notas',
  ];

  const fmtMonto = (v) => v != null ? Number(v).toFixed(2) : '';
  const buildRow = (r) => [
    toLocalDateTime(r.hora_gestion),
    r.nombre_deudor || '',
    r.cedula || '',
    r.telefono || '',
    r.empresa || '',
    r.contrato || '',
    TIPO_LABEL[r.tipificacion_codigo] || r.tipificacion_desc || '',
    fmtMonto(r.monto_acordado),
    toLocalDateTime(r.fecha_promesa),
    fmtMonto(r.valor_mora),
    r.duracion_seg != null ? Number(r.duracion_seg) : '',
    r.notas || '',
  ];

  if (formato === 'csv') {
    const escape = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = filtrados.map(r => buildRow(r).map(escape).join(','));
    fs.writeFileSync(rutaArchivo, '﻿' + COLS.join(',') + '\n' + rows.join('\n'), 'utf8');
    return { success: true, archivo: rutaArchivo };
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'ANTIGRAVITY';
  const ws = wb.addWorksheet('Mis Compromisos');
  const lastCol = String.fromCharCode(64 + COLS.length);
  ws.mergeCells(`A1:${lastCol}1`);
  const fechaTxt = fecha ? ` — ${fecha}` : ' — todas las fechas';
  const tipoTxt = tipoFiltro ? ` · ${TIPO_LABEL[tipoFiltro] || tipoFiltro}` : '';
  ws.getCell('A1').value = `Mis Compromisos de ${asesor.nombre}${fechaTxt}${tipoTxt} (${filtrados.length} registros)`;
  ws.getCell('A1').font = { bold: true, size: 13, color: { argb: 'FF58A6FF' } };
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1117' } };
  ws.getCell('A1').alignment = { horizontal: 'center' };
  ws.addRow([]);
  const hRow = ws.addRow(COLS);
  hRow.font = { bold: true };
  hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF161B22' } };

  for (const r of filtrados) {
    const row = ws.addRow(buildRow(r));
    const tipCol = TIPO_COLOR[r.tipificacion_codigo];
    if (tipCol) row.getCell(7).font = { bold: true, color: { argb: tipCol } };
    const cellMonto = row.getCell(8);
    if (r.monto_acordado != null) cellMonto.font = { bold: true, color: { argb: 'FF00E676' } };
    else { cellMonto.value = 'SIN CAPTURAR'; cellMonto.font = { italic: true, color: { argb: 'FFFFB74D' } }; }
    const cellMora = row.getCell(10);
    if (cellMora.value && parseFloat(cellMora.value) > 0) cellMora.font = { bold: true, color: { argb: 'FFEF4444' } };
  }
  ws.columns.forEach((col, i) => {
    col.width = [18, 22, 14, 14, 14, 14, 20, 14, 18, 12, 12, 35][i] || 14;
  });
  ws.views = [{ state: 'frozen', ySplit: 3 }];
  await wb.xlsx.writeFile(rutaArchivo);
  return { success: true, archivo: rutaArchivo };
}

// ─── ENTRY POINT ────────────────────────────────────────────────────────────
async function generate(tipo, params = {}) {
  try {
    if (tipo === 'diario') {
      return await generarReporteDiario(params.asesor_id, params.fecha, params.formato || 'xlsx', params.fechaFin || null);
    }
    if (tipo === 'equipo') {
      return await generarReporteEquipo(params.fecha, params.formato || 'xlsx', params.fechaFin || null);
    }
    if (tipo === 'gestiones') {
      return await generarReporteGestiones(params.asesor_id, params.fecha, params.formato || 'xlsx');
    }
    if (tipo === 'gestiones_equipo') {
      return await generarReporteGestionesEquipo(params.fecha, params.formato || 'xlsx');
    }
    if (tipo === 'cartera_equipo') {
      return await generarCarteraEquipo(params.contactoIds || [], params.formato || 'xlsx');
    }
    if (tipo === 'cartera_asesor') {
      return await generarCarteraAsesor(params.asesor_id, params.formato || 'xlsx', {
        fecha_desde: params.fecha_desde,
        fecha_hasta: params.fecha_hasta,
        estado: params.estado,
      });
    }
    if (tipo === 'detalle_metrica') {
      return await generarDetalleMetrica(params.tipoMet, params.fecha || null, params.formato || 'xlsx');
    }
    if (tipo === 'contactabilidad_hora') {
      return await generarContactabilidadHora(params.fecha || null, params.asesor_id || null, params.formato || 'xlsx', params.campana_id || null);
    }
    if (tipo === 'volumen_hora') {
      return await generarVolumenHora(params.fecha || null, params.asesor_id || null, params.formato || 'xlsx', params.campana_id || null);
    }
    if (tipo === 'mis_compromisos') {
      return await generarMisCompromisos(params.asesor_id, params.fecha || null, params.formato || 'xlsx', {
        tipo_filtro: params.tipo_filtro,
      });
    }
    throw new Error(`Tipo de reporte desconocido: ${tipo}`);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { generate };
