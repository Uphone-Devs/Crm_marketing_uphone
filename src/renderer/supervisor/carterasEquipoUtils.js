// Helpers puros para CarterasEquipo.jsx — separados del componente para poder
// testearlos con vitest sin necesitar un entorno DOM/React (ver tests/unit/carterasEquipoUtils.test.js).

// Cola de marcación: PENDIENTE/EN_INTENTOS por defecto. Cualquier otro estado
// (GESTIONADO, AGENDADO, YA_PAGO declarado) entra si el supervisor le asignó
// orden_marcacion explícito. Solo YA_PAGO validado bancariamente queda blindado.
export function estaEnCola(r) {
  if (r.validado_pago === 1) return false;
  if (r.estado_marcacion === 'EN_INTENTOS' || r.estado_marcacion === 'PENDIENTE') return true;
  if (r.orden_marcacion != null) return true;
  return false;
}

// Acepta 'YYYY-MM-DD' o 'YYYY-MM-DD HH:MM:SS' — slice los primeros 10 chars
export function extraerFechaIso(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.length >= 10 ? raw.slice(0, 10) : '';
}

export function coincideTexto(r, txtLower) {
  if (!txtLower) return true;
  let meta = {};
  try { meta = JSON.parse(r.metadata || '{}'); } catch (_) { /* metadata inválida: se ignora */ }
  const hay = [
    r.nombre_deudor, r.cedula, r.telefono, r.producto,
    r.asesor_nombre, r.campana_nombre,
    meta['Nº CONTRATO'], meta['CONTRATO'], meta['EMPRESA'],
  ].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(txtLower);
}

// Filtra estado/texto/fecha sobre filas YA CARGADAS de un asesor. No filtra
// por asesor — el caller decide a qué asesor(es) le pasa esta función.
export function aplicarFiltrosFila(rows, { filtroEstado = 'TODOS', filtroTexto = '', filtroDesde = '', filtroHasta = '' } = {}) {
  const txt = (filtroTexto || '').trim().toLowerCase();
  return rows.filter(r => {
    if (filtroEstado !== 'TODOS' && r.estado_marcacion !== filtroEstado) return false;
    if (filtroDesde || filtroHasta) {
      const f = extraerFechaIso(r.fecha_asignacion);
      if (filtroDesde && (!f || f < filtroDesde)) return false;
      if (filtroHasta && (!f || f > filtroHasta)) return false;
    }
    return coincideTexto(r, txt);
  });
}

// Suma los conteos por asesor de GET /cartera-equipo/resumen en totales de equipo.
// Sirve para mostrar KPIs exactos antes de cargar el detalle de ningún asesor.
export function sumarResumen(resumen) {
  const acc = { total: 0, pendientes: 0, en_intentos: 0, agendados: 0, gestionados: 0, ya_pago: 0, asesores: 0 };
  for (const a of resumen || []) {
    acc.total       += a.total       || 0;
    acc.pendientes  += a.pendientes  || 0;
    acc.en_intentos += a.en_intentos || 0;
    acc.agendados   += a.agendados   || 0;
    acc.gestionados += a.gestionados || 0;
    acc.ya_pago     += a.ya_pago     || 0;
    acc.asesores    += 1;
  }
  return acc;
}
