/**
 * queries.js — Capa de acceso a datos (better-sqlite3).
 *
 * API sincrónica de better-sqlite3:
 *   db.prepare(sql).all(params)   → Array de objetos
 *   db.prepare(sql).get(params)   → Objeto o undefined
 *   db.prepare(sql).run(params)   → { changes, lastInsertRowid }
 *
 * Principio S.O.L.I.D. (S): Cada función hace UNA query.
 * Strategy Pattern: Misma interfaz pública que puede implementarse
 * con PostgreSQL/MySQL cambiando solo este archivo.
 */

const { getDb } = require('./db');

// ═══════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════

function findUserByEmail(email) {
  const db = getDb();
  return db.prepare('SELECT * FROM usuarios WHERE email = ? AND estado = ?').get(email, 'activo');
}

function findUserById(id) {
  const db = getDb();
  return db.prepare('SELECT id, nombre, email, rol, estado, creado_en FROM usuarios WHERE id = ?').get(id);
}

// ═══════════════════════════════════════════════════════════════
// USUARIOS / ASESORES
// ═══════════════════════════════════════════════════════════════

function getAsesores(opts = {}) {
  // Bug 4: aislamiento por equipo. Si se pasa supervisorId, solo los asesores de
  // ese supervisor; sin él (admin), todos. Asesores legacy sin supervisor_id no
  // aparecen para ningún supervisor (el admin los reasigna por UI).
  const db = getDb();
  const { supervisorId = null } = opts;
  if (supervisorId != null) {
    return db.prepare(
      "SELECT id, nombre, email, rol, estado FROM usuarios WHERE rol = 'asesor' AND estado = 'activo' AND supervisor_id = ? ORDER BY nombre"
    ).all(supervisorId);
  }
  return db.prepare("SELECT id, nombre, email, rol, estado FROM usuarios WHERE rol = 'asesor' AND estado = 'activo' ORDER BY nombre").all();
}

function getSupervisorIdDeAsesor(asesorId) {
  // Bug 4: supervisor_id del asesor, para filtrar broadcasts WS por grupo.
  const db = getDb();
  const row = db.prepare('SELECT supervisor_id FROM usuarios WHERE id = ?').get(asesorId);
  return row && row.supervisor_id != null ? row.supervisor_id : null;
}

function getAllUsuarios() {
  // Bug 3: vista del supervisor — nunca expone la cuenta admin del sistema.
  const db = getDb();
  return db.prepare("SELECT id, nombre, email, rol, estado FROM usuarios WHERE estado = ? AND rol != 'admin' ORDER BY rol, nombre").all('activo');
}

function insertUsuario({ nombre, email, passwordHash, rol = 'asesor', supervisorId = null }) {
  // Bug 4: el asesor se crea ya asignado a su supervisor (aislamiento de equipo).
  const db = getDb();
  return db.prepare(
    "INSERT INTO usuarios (nombre, email, password_hash, rol, supervisor_id) VALUES (?, ?, ?, ?, ?)"
  ).run(nombre, email, passwordHash, rol, supervisorId);
}

// Alias para mantener compatibilidad si se requiere en otros módulos
const insertAsesor = insertUsuario;

function updateAsesor(id, { nombre, estado }) {
  const db = getDb();
  return db.prepare(
    "UPDATE usuarios SET nombre = COALESCE(?, nombre), estado = COALESCE(?, estado) WHERE id = ?"
  ).run(nombre, estado, id);
}

function deleteAsesor(id) {
  const db = getDb();
  // Eliminación en cascada: limpia historial vinculado antes de borrar el usuario.
  // Necesario porque foreign_keys = ON está activo y las FK no tienen ON DELETE CASCADE.
  const cascade = db.transaction(() => {
    db.prepare("UPDATE contactos SET asignado_a = NULL WHERE asignado_a = ?").run(id);
    db.prepare("UPDATE campanas SET supervisor_id = NULL WHERE supervisor_id = ?").run(id);
    db.prepare("DELETE FROM eventos WHERE usuario_id = ?").run(id);
    db.prepare("DELETE FROM cdrs WHERE usuario_id = ?").run(id);
    db.prepare("DELETE FROM sesiones WHERE usuario_id = ?").run(id);
    return db.prepare("DELETE FROM usuarios WHERE id = ?").run(id);
  });
  return cascade();
}

function anonymizeAsesor(id) {
  const db = getDb();
  // Anonimización: elimina datos personales pero preserva el usuario_id en la DB.
  // CDRs, eventos, sesiones y métricas quedan intactos para reportes históricos.
  return db.prepare(`
    UPDATE usuarios
    SET nombre        = 'Asesor ' || CAST(id AS TEXT) || ' (anonimizado)',
        email         = 'anonimizado_' || CAST(id AS TEXT) || '@uphone.local',
        password_hash = '',
        estado        = 'inactivo'
    WHERE id = ?
  `).run(id);
}

// ── ADMIN: Gestión completa de usuarios ─────────────────────────

function getAllUsuariosAdmin(viewerRol = 'supervisor') {
  // Bug 3: solo el admin ve la cuenta admin. Cualquier otro rol (o default seguro)
  // recibe la lista sin la cuenta raíz del sistema.
  const db = getDb();
  const where = viewerRol === 'admin' ? '' : "WHERE rol != 'admin'";
  return db.prepare(`SELECT id, nombre, email, rol, estado, supervisor_id, creado_en FROM usuarios ${where} ORDER BY rol, nombre`).all();
}

function updateUsuarioAdmin(id, { nombre, email, rol, estado, supervisorId }) {
  // Bug 4: supervisor_id solo se actualiza si viene en el payload (permite reasignar
  // asesores legacy sin borrar el grupo al editar otros campos). null = desasignar.
  const db = getDb();
  const sets = ['nombre = ?', 'email = ?', 'rol = ?', 'estado = ?'];
  const params = [nombre, email, rol, estado];
  if (supervisorId !== undefined) {
    sets.push('supervisor_id = ?');
    params.push(supervisorId);
  }
  params.push(id);
  return db.prepare(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

function toggleUsuarioEstado(id) {
  const db = getDb();
  const user = db.prepare('SELECT estado FROM usuarios WHERE id = ?').get(id);
  if (!user) return { error: 'Usuario no encontrado' };
  const nuevo = user.estado === 'activo' ? 'inactivo' : 'activo';
  db.prepare('UPDATE usuarios SET estado = ? WHERE id = ?').run(nuevo, id);
  return { estado: nuevo };
}

function changePasswordAdmin(id, passwordHash) {
  const db = getDb();
  return db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(passwordHash, id);
}

// ═══════════════════════════════════════════════════════════════
// CAMPAÑAS
// ═══════════════════════════════════════════════════════════════

function getCampanas() {
  const db = getDb();
  return db.prepare("SELECT id, nombre, descripcion, fecha_inicio, fecha_fin, supervisor_id, estado FROM campanas WHERE estado = 'activa' ORDER BY id DESC").all();
}

function getMetaDiariaCampanas() {
  const db = getDb();
  const hoy = new Date().toISOString().slice(0, 10);

  // Migrar columna si falta
  try {
    const cols = db.prepare("PRAGMA table_info(campanas)").all().map(c => c.name);
    if (!cols.includes('meta_diaria')) {
      db.prepare("ALTER TABLE campanas ADD COLUMN meta_diaria REAL NOT NULL DEFAULT 0").run();
    }
  } catch (_) {}

  // Intentar query con monto_acordado
  try {
    const colsCdr = db.prepare("PRAGMA table_info(cdrs)").all().map(c => c.name);
    if (colsCdr.includes('monto_acordado')) {
      const rows = db.prepare(`
        SELECT c.id, c.nombre, c.estado, COALESCE(c.meta_diaria, 0) AS meta_diaria,
               COALESCE(SUM(CASE WHEN substr(cdr.creado_en,1,10) = ?
                                  AND cdr.monto_acordado IS NOT NULL
                                 THEN CAST(cdr.monto_acordado AS REAL) ELSE 0 END), 0) AS cobrado_hoy
        FROM campanas c
        LEFT JOIN contactos ct ON ct.campana_id = c.id
        LEFT JOIN cdrs cdr     ON cdr.contacto_id = ct.id
        WHERE c.estado = 'activa'
        GROUP BY c.id
        ORDER BY c.id DESC
      `).all(hoy);
      return rows.map(r => ({
        ...r,
        cobrado_hoy: r.cobrado_hoy || 0,
        pct_cumplimiento: r.meta_diaria > 0
          ? Math.round((r.cobrado_hoy / r.meta_diaria) * 10000) / 100
          : 0,
      }));
    }
  } catch (err) {
    console.warn('[getMetaDiariaCampanas] query completa falló:', err.message);
  }

  // Fallback: solo campañas sin cobrado
  try {
    const rows = db.prepare(`
      SELECT c.id, c.nombre, c.estado, COALESCE(c.meta_diaria, 0) AS meta_diaria,
             0 AS cobrado_hoy
      FROM campanas c
      WHERE c.estado = 'activa'
      ORDER BY c.id DESC
    `).all();
    return rows.map(r => ({
      ...r,
      cobrado_hoy: 0,
      pct_cumplimiento: 0,
    }));
  } catch (err) {
    console.warn('[getMetaDiariaCampanas] fallback falló:', err.message);
    return [];
  }
}

function setMetaDiariaCampana(campanaId, valor) {
  const db = getDb();
  db.prepare("UPDATE campanas SET meta_diaria = ? WHERE id = ?").run(parseFloat(valor) || 0, Number(campanaId));
  return { ok: true };
}

function getCampanasPorAsesor(asesorId) {
  const db = getDb();
  const idNum = Number(asesorId);
  // Retorna campañas que tienen al menos un contacto asignado a este asesor
  // Relajamos 'activa' temporalmente o permitimos variaciones de caja
  return db.prepare(`
    SELECT DISTINCT c.* 
    FROM campanas c
    JOIN contactos con ON c.id = con.campana_id
    WHERE CAST(con.asignado_a AS INTEGER) = ? 
    AND (c.estado = 'activa' OR c.estado = 'ACTIVA' OR c.estado IS NULL)
    ORDER BY c.id DESC
  `).all(idNum);
}

function insertCampana({ nombre, descripcion, supervisor_id }) {
  const db = getDb();
  return db.prepare(
    "INSERT INTO campanas (nombre, descripcion, fecha_inicio, supervisor_id, estado) VALUES (?, ?, datetime('now', 'localtime'), ?, 'activa')"
  ).run(nombre, descripcion, supervisor_id || null);
}

function insertContactos(campanaId, asesorId, contactos) {
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(contactos)").all().map(c => c.name);
  const hasFechaAsig = cols.includes('fecha_asignacion');
  const stmt = hasFechaAsig
    ? db.prepare(
        "INSERT INTO contactos (campana_id, cedula, nombre_deudor, telefono, monto_deuda, producto, asignado_a, metadata, fecha_asignacion) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))"
      )
    : db.prepare(
        "INSERT INTO contactos (campana_id, cedula, nombre_deudor, telefono, monto_deuda, producto, asignado_a, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      );

  const insertMany = db.transaction((contacts) => {
    let count = 0;
    for (const c of contacts) {
      if (!c.telefono) continue;
      stmt.run(
        campanaId,
        c.cedula || '',
        c.nombre || '',
        c.telefono,
        c.monto || 0,
        c.producto || '',
        asesorId,
        c.metadata ? JSON.stringify(c.metadata) : null
      );
      count++;
    }
    return count;
  });

  return insertMany(contactos);
}

function getCampanaById(id) {
  const db = getDb();
  const campana = db.prepare('SELECT * FROM campanas WHERE id = ?').get(id);
  if (!campana) return null;

  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN estado_marcacion = 'PENDIENTE' THEN 1 ELSE 0 END) as pendientes,
      SUM(CASE WHEN estado_marcacion = 'GESTIONADO' THEN 1 ELSE 0 END) as gestionados
    FROM contactos WHERE campana_id = ?
  `).get(id);

  return { ...campana, ...stats };
}

function getContactoById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM contactos WHERE id = ?').get(id);
}

function getSiguienteContacto(campanaId, asesorId) {
  const db = getDb();

  // Obtener configuración de intentos máximo
  const configIntentos = db.prepare('SELECT valor FROM config WHERE clave = ?').get('intentos_marcacion');
  const maxIntentos = configIntentos ? parseInt(configIntentos.valor) : 1;

  // Regla maestra: el supervisor manda. Si asignó orden_marcacion al contacto,
  // entra en cola sin importar su estado (GESTIONADO, AGENDADO, YA_PAGO decl, etc.),
  // EXCEPTO si está validado bancariamente (validado_pago=1) — eso es inmutable.
  // Por defecto (sin orden asignada), solo entran PENDIENTE y EN_INTENTOS con intentos
  // disponibles, como siempre.
  const cols = db.prepare("PRAGMA table_info(contactos)").all().map(c => c.name);
  const hasValidado = cols.includes('validado_pago');
  const hasOrden = cols.includes('orden_marcacion');
  const filtroValidado = hasValidado ? 'AND validado_pago = 0' : 'AND ya_pago = 0';
  const contacto = db.prepare(`
    SELECT * FROM contactos
    WHERE campana_id = ?
    AND (asignado_a IS NULL OR asignado_a = ?)
    ${filtroValidado}
    AND (
      estado_marcacion = 'PENDIENTE'
      OR (estado_marcacion = 'EN_INTENTOS' AND COALESCE(intentos_realizados, 0) < ?)
    )
    ORDER BY
      CASE WHEN ${hasOrden ? 'orden_marcacion' : 'NULL'} IS NULL THEN 1 ELSE 0 END,
      ${hasOrden ? 'orden_marcacion' : 'id'} ASC,
      CASE WHEN estado_marcacion = 'EN_INTENTOS' THEN 0 ELSE 1 END,
      id ASC
    LIMIT 1
  `).get(campanaId, asesorId, maxIntentos);

  if (contacto && !contacto.asignado_a) {
    db.prepare('UPDATE contactos SET asignado_a = ? WHERE id = ?').run(asesorId, contacto.id);
    contacto.asignado_a = asesorId;
  }

  return contacto;
}

function getCampaignSummary(campanaId) {
  const db = getDb();
  const summary = db.prepare('SELECT COUNT(*) as total FROM contactos WHERE campana_id = ?').get(campanaId);
  const rows = db.prepare('SELECT monto_deuda, metadata FROM contactos WHERE campana_id = ?').all(campanaId);
  
  const first = db.prepare('SELECT cedula FROM contactos WHERE campana_id = ? ORDER BY id ASC LIMIT 1').get(campanaId);
  const last = db.prepare('SELECT cedula FROM contactos WHERE campana_id = ? ORDER BY id DESC LIMIT 1').get(campanaId);
  
  let totalMonto = 0;
  let totalMora = 0;

  rows.forEach(r => {
    try {
      const meta = r.metadata ? JSON.parse(r.metadata) : {};
      
      // 1. MONTO POR COBRAR (Prioritario)
      const cobroKey = Object.keys(meta).find(k => k === 'MONTO POR COBRAR' || k === 'TOTAL A COBRAR');
      if (cobroKey && meta[cobroKey]) {
        const val = meta[cobroKey].toString().replace(/[^0-9.]/g, '');
        totalMonto += parseFloat(val) || 0;
      } else {
        totalMonto += (r.monto_deuda || 0);
      }

      // 2. VALOR EN MORA (Prioritario)
      const moraKey = Object.keys(meta).find(k => k === 'VALOR EN MORA' || k === 'MORA');
      if (moraKey && meta[moraKey]) {
        const val = meta[moraKey].toString().replace(/[^0-9.]/g, '');
        totalMora += parseFloat(val) || 0;
      }
    } catch (e) {
      totalMonto += (r.monto_deuda || 0);
    }
  });

  return {
    total: summary.total || 0,
    monto: totalMonto,
    montoMora: totalMora,
    firstCedula: first?.cedula || 'N/A',
    lastCedula: last?.cedula || 'N/A'
  };
}

function getCampanasDashboard() {
  const db = getDb();
  try {
    // Una fila por (campaña × asesor) para mostrar el desglose real de asignaciones
    return db.prepare(`
      SELECT
        c.id,
        c.nombre,
        c.fecha_inicio,
        u_sup.nombre      AS supervisor_nombre,
        ct.asignado_a     AS asesor_id,
        u_as.nombre       AS asesor_nombre,
        COUNT(ct.id)  AS total_contactos,
        SUM(COALESCE(
          CAST(NULLIF(TRIM(json_extract(ct.metadata, '$."VALOR EN MORA"')), '') AS REAL),
          ct.monto_deuda,
          0
        )) AS monto_mora
      FROM campanas c
      LEFT JOIN usuarios u_sup ON u_sup.id = c.supervisor_id
      LEFT JOIN contactos ct   ON ct.campana_id = c.id
      LEFT JOIN usuarios u_as  ON u_as.id = ct.asignado_a
      GROUP BY c.id, ct.asignado_a
      ORDER BY c.id DESC, u_as.nombre ASC
    `).all();
  } catch (err) {
    console.error('Error en getCampanasDashboard:', err);
    throw err;
  }
}

function _backfillSnapshotsPorContactos(db, whereClause, params) {
  const hasSnap = db.prepare("PRAGMA table_info(cdrs)").all().some(c => c.name === 'snapshot_nombre');
  if (!hasSnap) return;
  // Garantía pre-delete: poblar snapshots ANTES de borrar los contactos.
  // COALESCE preserva valores ya capturados; solo rellena los NULL.
  db.prepare(`
    UPDATE cdrs SET
      snapshot_nombre   = COALESCE(snapshot_nombre,   (SELECT nombre_deudor FROM contactos WHERE id = cdrs.contacto_id)),
      snapshot_cedula   = COALESCE(snapshot_cedula,   (SELECT cedula        FROM contactos WHERE id = cdrs.contacto_id)),
      snapshot_telefono = COALESCE(snapshot_telefono, (SELECT telefono      FROM contactos WHERE id = cdrs.contacto_id)),
      snapshot_empresa  = COALESCE(snapshot_empresa,  (SELECT json_extract(metadata, '$."EMPRESA"') FROM contactos WHERE id = cdrs.contacto_id))
    WHERE contacto_id IN (${whereClause})
  `).run(...params);
}

function deleteContactosPorAsesorEnCampana(campanaId, asesorId) {
  const db = getDb();
  const subq = 'SELECT id FROM contactos WHERE campana_id = ? AND asignado_a = ?';
  const transaction = db.transaction(() => {
    // PASO 1 — backfill snapshots antes del DELETE (dentro de la misma transacción).
    // Si falla el backfill, la transacción entera hace rollback y los contactos sobreviven.
    _backfillSnapshotsPorContactos(db, subq, [campanaId, asesorId]);
    // PASO 2 — eliminar agendamientos y contactos
    db.prepare(`DELETE FROM agendamientos WHERE contacto_id IN (${subq})`).run(campanaId, asesorId);
    const res = db.prepare('DELETE FROM contactos WHERE campana_id = ? AND asignado_a = ?').run(campanaId, asesorId);
    const { cnt } = db.prepare('SELECT COUNT(*) as cnt FROM contactos WHERE campana_id = ?').get(campanaId);
    if (cnt === 0) db.prepare('DELETE FROM campanas WHERE id = ?').run(campanaId);
    return res.changes;
  });
  return { success: true, deleted: transaction() };
}

function deleteCampana(id) {
  const db = getDb();
  const transaction = db.transaction(() => {
    // PASO 1 — backfill snapshots antes del DELETE (garantía de trazabilidad completa)
    _backfillSnapshotsPorContactos(db, 'SELECT id FROM contactos WHERE campana_id = ?', [id]);
    // PASO 2 — eliminar en orden FK
    db.prepare('DELETE FROM agendamientos WHERE contacto_id IN (SELECT id FROM contactos WHERE campana_id = ?)').run(id);
    db.prepare('DELETE FROM contactos WHERE campana_id = ?').run(id);
    db.prepare('DELETE FROM campanas WHERE id = ?').run(id);
  });
  transaction();
  return { success: true };
}

// ═══════════════════════════════════════════════════════════════
// CDRs (Call Detail Records)
// ═══════════════════════════════════════════════════════════════

// Helpers de tiempo en HORA LOCAL (no UTC). Necesarios porque las queries usan
// date(col) que extrae el día tal como está almacenado — guardar UTC produce
// desalineación nocturna en Ecuador (UTC-5): gestiones del lunes 19:30 local
// se almacenan como martes 00:30 UTC → no aparecen en filtro "hoy=lunes".
function _nowLocalISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, -1); // strip Z
}
function _todayLocalISO() {
  return _nowLocalISO().slice(0, 10);
}

// Devuelve un fragmento SQL que extrae la fecha LOCAL (YYYY-MM-DD) de una
// columna timestamp, tolerante a mezcla de formatos en la BD:
//  - Local sin Z (post-fix): '2026-05-15T14:30:00' → substr toma '2026-05-15'.
//  - UTC con Z (legacy): '2026-05-15T01:00:00Z' → date(col, 'localtime') convierte
//    a hora Ecuador (14-05-2026 20:00) y extrae '2026-05-14'.
// Detección: presencia de 'Z' o '+' en el string indica timezone explícito (UTC).
function _dateLocalExpr(col) {
  return `(CASE
    WHEN instr(${col}, 'Z') > 0 OR instr(${col}, '+') > 0
      THEN date(${col}, 'localtime')
    ELSE substr(${col}, 1, 10)
  END)`;
}

// Variante "match" que devuelve fragmento WHERE con OR triple — más robusto
// para casos edge. El parámetro fecha se debe pasar 3 veces consecutivas en params.
function _dateLocalMatch(col) {
  return `(substr(${col}, 1, 10) = ? OR date(${col}, 'localtime') = ? OR date(${col}) = ?)`;
}

function _dateRangeMatch(col) {
  return `(substr(${col}, 1, 10) BETWEEN ? AND ?
    OR date(${col}, 'localtime') BETWEEN ? AND ?
    OR date(${col}) BETWEEN ? AND ?)`;
}

function insertCdr({ contactoId, usuarioId, timestampInicio }) {
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(cdrs)").all().map(c => c.name);
  const hasSnap = cols.includes('snapshot_nombre');
  // Si el timestamp recibido termina en 'Z' (UTC), convertir a hora local.
  // En modo multi-PC, el renderer y el API server pueden mandar UTC.
  const ts = timestampInicio
    ? (timestampInicio.endsWith('Z') || timestampInicio.endsWith('z')
        ? (() => { const d = new Date(timestampInicio); const tz = d.getTimezoneOffset() * 60000; return new Date(d.getTime() - tz).toISOString().slice(0, -1); })()
        : timestampInicio)
    : _nowLocalISO();
  if (hasSnap) {
    // Capturar snapshot del contacto para preservar trazabilidad
    const ct = db.prepare(`
      SELECT nombre_deudor, cedula, telefono, json_extract(metadata, '$."EMPRESA"') AS empresa
      FROM contactos WHERE id = ?
    `).get(contactoId);
    return db.prepare(`
      INSERT INTO cdrs (contacto_id, usuario_id, timestamp_inicio, creado_en,
        snapshot_nombre, snapshot_cedula, snapshot_telefono, snapshot_empresa)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(contactoId, usuarioId, ts, ts,
      ct?.nombre_deudor || null, ct?.cedula || null, ct?.telefono || null, ct?.empresa || null);
  }
  return db.prepare(
    'INSERT INTO cdrs (contacto_id, usuario_id, timestamp_inicio, creado_en) VALUES (?, ?, ?, ?)'
  ).run(contactoId, usuarioId, ts, ts);
}

function marcarContactoGestionado(contactoId) {
  const db = getDb();
  return db.prepare(
    "UPDATE contactos SET estado_marcacion = 'GESTIONADO' WHERE id = ?"
  ).run(contactoId);
}

// Elimina un compromiso mal ingresado: limpia la tipificación del CDR y
// resetea el contacto a PENDIENTE para que pueda gestionarse de nuevo.
function eliminarCompromiso(cdrId) {
  const db = getDb();
  const cdr = db.prepare('SELECT contacto_id, usuario_id FROM cdrs WHERE id = ?').get(Number(cdrId));
  if (!cdr) throw new Error('CDR no encontrado');
  db.prepare('UPDATE cdrs SET tipificacion_id = NULL, resultado = NULL, monto_acordado = NULL WHERE id = ?').run(Number(cdrId));
  if (cdr.contacto_id) {
    db.prepare("UPDATE contactos SET estado_marcacion = 'PENDIENTE', ya_pago = 0 WHERE id = ?").run(cdr.contacto_id);
    db.prepare("UPDATE agendamientos SET estado = 'cancelado' WHERE contacto_id = ? AND asesor_id = ? AND estado NOT IN ('ejecutado', 'cancelado')").run(cdr.contacto_id, cdr.usuario_id);
  }
  return { success: true };
}

// Confirmación de pago directo desde la vista "Mis Compromisos" del asesor.
// Actualiza el CDR existente a PAGO_REAL sin crear un nuevo CDR, evitando
// que el monto se cuente dos veces en las KPIs de monto_recaudado.
function confirmarPagoCompromiso(cdrId, { montoPagado, comprobante, formaPago } = {}) {
  const db = getDb();
  const tipPagoReal = db.prepare("SELECT id FROM tipificaciones WHERE codigo = 'PAGO_REAL' LIMIT 1").get();
  if (!tipPagoReal) throw new Error("Tipificación PAGO_REAL no encontrada — verifique el seed de tipificaciones");

  const cols = db.prepare("PRAGMA table_info(cdrs)").all().map(c => c.name);
  const sets = ['tipificacion_id = ?', 'resultado = ?'];
  // COMP_CUM distingue "pago confirmado desde Mis Compromisos" de un PAGO_REAL de gestión normal.
  // tipificacion_id sigue siendo PAGO_REAL para que los KPIs financieros cuenten correctamente.
  const vals = [tipPagoReal.id, 'COMP_CUM'];

  if (montoPagado != null)  { sets.push('monto_acordado = ?'); vals.push(Number(montoPagado)); }
  if (cols.includes('monto_pagado'))  { sets.push('monto_pagado = ?');  vals.push(montoPagado != null ? Number(montoPagado) : null); }
  if (cols.includes('comprobante'))   { sets.push('comprobante = ?');   vals.push(comprobante  || null); }
  if (cols.includes('forma_pago'))    { sets.push('forma_pago = ?');    vals.push(formaPago    || null); }

  vals.push(Number(cdrId));
  const r = db.prepare(`UPDATE cdrs SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

  // Marcar el contacto como ya_pago para retirarlo de la cola
  const cdr = db.prepare('SELECT contacto_id FROM cdrs WHERE id = ?').get(Number(cdrId));
  if (cdr?.contacto_id) {
    db.prepare("UPDATE contactos SET ya_pago = 1, estado_marcacion = 'YA_PAGO' WHERE id = ?").run(cdr.contacto_id);
  }

  return { success: r.changes > 0, changes: r.changes };
}

// Actualiza la fecha/hora del agendamiento existente y el monto acordado del CDR.
// Cancela el agendamiento anterior e inserta uno nuevo para evitar duplicados.
function reagendarCompromiso(cdrId, { nuevaFecha, nuevaHora, nuevoMonto } = {}) {
  const db = getDb();
  if (!nuevaFecha || !nuevaHora) throw new Error('nuevaFecha y nuevaHora son obligatorios');
  const cdr = db.prepare('SELECT contacto_id, usuario_id FROM cdrs WHERE id = ?').get(Number(cdrId));
  if (!cdr) throw new Error('CDR no encontrado');

  if (nuevoMonto != null) {
    const cols = db.prepare('PRAGMA table_info(cdrs)').all().map(c => c.name);
    if (cols.includes('monto_acordado')) {
      db.prepare('UPDATE cdrs SET monto_acordado = ? WHERE id = ?').run(Number(nuevoMonto), Number(cdrId));
    }
  }

  const fechaHoraAgend = `${nuevaFecha} ${nuevaHora}:00`;
  db.prepare(
    "UPDATE agendamientos SET estado = 'cancelado' WHERE contacto_id = ? AND asesor_id = ? AND estado NOT IN ('ejecutado', 'cancelado')"
  ).run(cdr.contacto_id, cdr.usuario_id);
  db.prepare(
    "INSERT INTO agendamientos (contacto_id, asesor_id, tipo, fecha_hora) VALUES (?, ?, 'PMP', ?)"
  ).run(cdr.contacto_id, cdr.usuario_id, fechaHoraAgend);
  // Marcar el CDR como reagendado para que aparezca en el Estado de Compromisos
  db.prepare("UPDATE cdrs SET resultado = 'REAG' WHERE id = ?").run(Number(cdrId));

  return { success: true };
}

// Marca un compromiso como incumplido: cambia la tipificación a INCUMP,
// resetea el contacto a PENDIENTE y cancela agendamientos pendientes.
function marcarCompromisoIncumplido(cdrId) {
  const db = getDb();
  let tipIncump = db.prepare("SELECT id FROM tipificaciones WHERE codigo = 'INCUMP' LIMIT 1").get();
  if (!tipIncump) {
    const r = db.prepare(
      "INSERT INTO tipificaciones (codigo, descripcion, categoria, finaliza_gestion) VALUES ('INCUMP', 'Compromiso Incumplido', 'CONTACTO_NEUTRO', 1)"
    ).run();
    tipIncump = { id: r.lastInsertRowid };
  }
  const cdr = db.prepare('SELECT contacto_id, usuario_id FROM cdrs WHERE id = ?').get(Number(cdrId));
  if (!cdr) throw new Error('CDR no encontrado');

  db.prepare("UPDATE cdrs SET tipificacion_id = ?, resultado = 'INCUMP' WHERE id = ?").run(tipIncump.id, Number(cdrId));
  if (cdr.contacto_id) {
    db.prepare("UPDATE contactos SET ya_pago = 0, estado_marcacion = 'PENDIENTE' WHERE id = ?").run(cdr.contacto_id);
    db.prepare(
      "UPDATE agendamientos SET estado = 'cancelado' WHERE contacto_id = ? AND asesor_id = ? AND estado NOT IN ('ejecutado', 'cancelado')"
    ).run(cdr.contacto_id, cdr.usuario_id);
  }
  return { success: true };
}

// Pago DECLARADO por el asesor en tipificación PAGO_REAL.
// Marca ya_pago=1, validado_pago=0, estado='YA_PAGO'. Validado=0 → recallable
// si el supervisor le asigna orden en Carteras (caso comprobante con novedad).
// La validación bancaria (confirmarPagos) lo "blinda" elevando validado_pago=1.
function marcarYaPagoDeclarado(contactoId) {
  const db = getDb();
  return db.prepare(
    "UPDATE contactos SET ya_pago = 1, validado_pago = 0, estado_marcacion = 'YA_PAGO' WHERE id = ?"
  ).run(contactoId);
}

function incrementarIntentoContacto(contactoId, maxIntentos) {
  const db = getDb();
  
  // Obtener intentos actuales
  const contacto = db.prepare('SELECT intentos_realizados FROM contactos WHERE id = ?').get(contactoId);
  const intentosActuales = contacto?.intentos_realizados || 0;
  const nuevosIntentos = intentosActuales + 1;

  // Determinar estado: si alcanzó máximo → GESTIONADO, si no → EN_INTENTOS
  const nuevoEstado = nuevosIntentos >= maxIntentos ? 'GESTIONADO' : 'EN_INTENTOS';

  return db.prepare(
    "UPDATE contactos SET estado_marcacion = ?, intentos_realizados = ? WHERE id = ?"
  ).run(nuevoEstado, nuevosIntentos, contactoId);
}

function resetearIntentosContacto(contactoId) {
  const db = getDb();
  return db.prepare(
    "UPDATE contactos SET intentos_realizados = 0, estado_marcacion = 'PENDIENTE' WHERE id = ?"
  ).run(contactoId);
}

/**
 * Progreso del asesor con filtros opcionales:
 * - opts.campanaId: solo contactos de esa campaña
 * - opts.fecha: 'YYYY-MM-DD' → "gestionados hoy" = CDRs finalizadores en ese día
 *   (total = todos los asignados; gestionados = los que tienen CDR hoy con tipif finalizadora)
 * Sin filtros → comportamiento histórico (todos los asignados / todos los GESTIONADO).
 */
function getProgresoAsesor(asesorId, opts = {}) {
  const db = getDb();
  const { campanaId, fecha } = opts;
  const where = ['c.asignado_a = ?'];
  const params = [asesorId];
  if (campanaId) { where.push('c.campana_id = ?'); params.push(campanaId); }
  // Cuando hay filtro de fecha explícito, restringir TOTAL a la cartera
  // asignada ese día (date(fecha_asignacion) = ?). Antes solo filtraba el
  // numerador (gestionados) → causaba ratios engañosos como 0/2205 cuando
  // el supervisor filtraba "hoy" y aún no había subido cartera ese día.
  if (fecha) { where.push('date(c.fecha_asignacion) = ?'); params.push(fecha); }

  const total = db.prepare(
    `SELECT COUNT(*) AS n FROM contactos c WHERE ${where.join(' AND ')}`
  ).get(...params).n;

  let gestionados;
  if (fecha) {
    // Gestionados ese día = contactos asignados ese día con CDR ese día cuya
    // tipificación finaliza gestión. Alineado con el TOTAL filtrado arriba.
    const filtroCamp = campanaId ? 'AND c.campana_id = ?' : '';
    const cdrCols = db.prepare("PRAGMA table_info(cdrs)").all().map(x => x.name);
    const tsCol = cdrCols.includes('timestamp_inicio') ? 'cd.timestamp_inicio'
                : cdrCols.includes('creado_en') ? 'cd.creado_en'
                : "'1970-01-01'";
    const p2 = campanaId ? [asesorId, fecha, fecha, campanaId] : [asesorId, fecha, fecha];
    gestionados = db.prepare(`
      SELECT COUNT(DISTINCT c.id) AS n
      FROM contactos c
      JOIN cdrs cd ON cd.contacto_id = c.id AND cd.usuario_id = c.asignado_a
      JOIN tipificaciones t ON cd.tipificacion_id = t.id
      WHERE c.asignado_a = ?
        AND date(c.fecha_asignacion) = ?
        AND ${_dateLocalExpr(tsCol)} = ?
        AND t.finaliza_gestion = 1 ${filtroCamp}
    `).get(...p2).n;
  } else {
    gestionados = db.prepare(
      `SELECT COUNT(*) AS n FROM contactos c WHERE ${where.join(' AND ')} AND c.estado_marcacion = 'GESTIONADO'`
    ).get(...params).n;
  }

  return { total, gestionados };
}

function getProgresoCampana(campanaId, asesorId) {
  const db = getDb();
  const hoy = _todayLocalISO();
  // Progreso DIARIO: solo contactos asignados HOY (fecha_asignacion o creado_en como fallback)
  const dateExpr = "date(COALESCE(fecha_asignacion, creado_en), 'localtime') = ?";
  const filtro = asesorId
    ? `campana_id = ? AND (asignado_a = ? OR asignado_a IS NULL) AND ${dateExpr}`
    : `campana_id = ? AND ${dateExpr}`;
  const params = asesorId ? [campanaId, asesorId, hoy] : [campanaId, hoy];
  const total      = db.prepare(`SELECT COUNT(*) as c FROM contactos WHERE ${filtro}`).get(...params).c;
  const gestionados = db.prepare(`SELECT COUNT(*) as c FROM contactos WHERE ${filtro} AND estado_marcacion = 'GESTIONADO'`).get(...params).c;
  return { total, gestionados };
}

function updateCdr(id, { tipificacionId, timestampFin, duracionSeg, resultado, urlGrabacion, notas, montoAcordado, scheduledDatetime }) {
  const db = getDb();
  const cdrCols = db.prepare("PRAGMA table_info(cdrs)").all().map(c => c.name);
  const hasScheduled = cdrCols.includes('scheduled_datetime');

  // timestampFin viene del renderer en UTC (new Date().toISOString()).
  // Convertir a hora local para alinear con timestamp_inicio que ya es local.
  const tsFin = timestampFin
    ? (timestampFin.endsWith('Z') || timestampFin.endsWith('z')
        ? (() => { const d = new Date(timestampFin); const tz = d.getTimezoneOffset() * 60000; return new Date(d.getTime() - tz).toISOString().slice(0, -1); })()
        : timestampFin)
    : _nowLocalISO();

  const schedCol = hasScheduled ? ', scheduled_datetime = COALESCE(?, scheduled_datetime)' : '';
  const updateCdrStmt = db.prepare(`
    UPDATE cdrs SET
      tipificacion_id = COALESCE(?, tipificacion_id),
      timestamp_fin = COALESCE(?, timestamp_fin),
      duracion_seg = COALESCE(?, duracion_seg),
      resultado = COALESCE(?, resultado),
      url_grabacion = COALESCE(?, url_grabacion),
      notas = COALESCE(?, notas),
      monto_acordado = COALESCE(?, monto_acordado)
      ${schedCol}
    WHERE id = ?
  `);

  const args = [tipificacionId, tsFin, duracionSeg, resultado, urlGrabacion, notas,
    montoAcordado != null ? Number(montoAcordado) : null];
  if (hasScheduled) args.push(scheduledDatetime || null);
  args.push(id);
  updateCdrStmt.run(...args);

  // M-016: vincular sub-gestiones huérfanas (cdr_id IS NULL) del mismo
  // contacto+asesor del día actual al CDR recién tipificado
  try {
    const hasSub = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sub_gestiones'").get();
    if (hasSub) {
      const cols = db.prepare("PRAGMA table_info(sub_gestiones)").all().map(c => c.name);
      if (cols.includes('cdr_id')) {
        const cdr = db.prepare('SELECT contacto_id, usuario_id FROM cdrs WHERE id = ?').get(id);
        if (cdr && cdr.contacto_id && cdr.usuario_id) {
          db.prepare(`
            UPDATE sub_gestiones
            SET cdr_id = ?
            WHERE cdr_id IS NULL
              AND contacto_id = ?
              AND asesor_id = ?
              AND date(creado_en) = date('now', 'localtime')
          `).run(id, cdr.contacto_id, cdr.usuario_id);
        }
      }
    }
  } catch (_) { /* tolerante */ }

  return { success: true };
}

function getCdrsByContacto(contactoId) {
  const db = getDb();

  const cdrs = db.prepare(`
    SELECT
      c.id, c.timestamp_inicio AS timestamp, c.timestamp_fin, c.resultado, c.notas,
      COALESCE(c.duracion_seg,
        CASE WHEN c.timestamp_fin IS NOT NULL
          THEN CAST((julianday(c.timestamp_fin) - julianday(c.timestamp_inicio)) * 86400 AS INTEGER)
          ELSE NULL END
      ) AS duracion_seg,
      t.descripcion AS tipificacion_desc, t.codigo AS tipificacion_codigo,
      u.nombre AS asesor_nombre, 'CDR' AS tipo, NULL AS telefono_ref, NULL AS cdr_id
    FROM cdrs c
    JOIN tipificaciones t ON c.tipificacion_id = t.id
    LEFT JOIN usuarios u ON c.usuario_id = u.id
    WHERE c.contacto_id = ? AND c.tipificacion_id IS NOT NULL
    ORDER BY c.timestamp_inicio DESC
  `).all(contactoId);

  let refs = [];
  const hasSub = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='sub_gestiones'"
  ).get();
  if (hasSub) {
    const cols = db.prepare("PRAGMA table_info(sub_gestiones)").all().map(c => c.name);
    const hasCdrId      = cols.includes('cdr_id');
    const hasNombreRef  = cols.includes('nombre_ref');
    const hasParentesco = cols.includes('parentesco');
    refs = db.prepare(`
      SELECT
        sg.id, sg.creado_en AS timestamp, NULL AS timestamp_fin, NULL AS resultado, sg.notas,
        NULL AS duracion_seg,
        'Llamada a referencia' AS tipificacion_desc, 'REF' AS tipificacion_codigo,
        u.nombre AS asesor_nombre, 'REF' AS tipo, sg.telefono AS telefono_ref,
        ${hasCdrId      ? 'sg.cdr_id'      : 'NULL'} AS cdr_id,
        ${hasNombreRef  ? 'sg.nombre_ref'  : 'NULL'} AS nombre_ref,
        ${hasParentesco ? 'sg.parentesco'  : 'NULL'} AS parentesco
      FROM sub_gestiones sg
      LEFT JOIN usuarios u ON sg.asesor_id = u.id
      WHERE sg.contacto_id = ?
      ORDER BY sg.creado_en DESC
    `).all(contactoId);
  }

  return { cdrs, refs };
}

function insertSubGestion({ contactoId, asesorId, cdrId, telefono, notas, nombreRef, parentesco }) {
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(sub_gestiones)").all().map(c => c.name);
  const hasCdrId      = cols.includes('cdr_id');
  const hasNombreRef  = cols.includes('nombre_ref');
  const hasParentesco = cols.includes('parentesco');

  const fields = ['contacto_id', 'asesor_id', 'telefono', 'notas'];
  const values = [contactoId, asesorId, telefono, notas || null];
  if (hasCdrId)      { fields.push('cdr_id');      values.push(cdrId || null); }
  if (hasNombreRef)  { fields.push('nombre_ref');   values.push(nombreRef || null); }
  if (hasParentesco) { fields.push('parentesco');   values.push(parentesco || null); }

  return db.prepare(
    `INSERT INTO sub_gestiones (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`
  ).run(...values);
}

function getSubGestionesByContacto(contactoId) {
  const db = getDb();
  const hasSub = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sub_gestiones'").get();
  if (!hasSub) return [];
  const cols = db.prepare("PRAGMA table_info(sub_gestiones)").all().map(c => c.name);
  const hasNombreRef  = cols.includes('nombre_ref');
  const hasParentesco = cols.includes('parentesco');
  const hasCdrId      = cols.includes('cdr_id');
  return db.prepare(`
    SELECT
      sg.id, sg.telefono, sg.notas, sg.creado_en,
      ${hasNombreRef  ? 'sg.nombre_ref'  : 'NULL'} AS nombre_ref,
      ${hasParentesco ? 'sg.parentesco'  : 'NULL'} AS parentesco,
      ${hasCdrId      ? 'sg.cdr_id'      : 'NULL'} AS cdr_id,
      u.nombre AS asesor_nombre
    FROM sub_gestiones sg
    LEFT JOIN usuarios u ON sg.asesor_id = u.id
    WHERE sg.contacto_id = ?
    ORDER BY sg.creado_en DESC
  `).all(contactoId);
}

function buscarContactoPorCedula(cedula) {
  const db = getDb();
  if (!cedula || !cedula.trim()) return null;
  return db.prepare(
    'SELECT id, nombre_deudor, cedula FROM contactos WHERE TRIM(cedula) = ? LIMIT 1'
  ).get(cedula.trim());
}

function getAllReferencias({ asesorId = null, fecha = null, parentesco = null, limite = 2000 } = {}) {
  const db = getDb();
  const hasSub = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sub_gestiones'").get();
  if (!hasSub) return [];
  const cols = db.prepare("PRAGMA table_info(sub_gestiones)").all().map(c => c.name);
  const hasNR  = cols.includes('nombre_ref');
  const hasPA  = cols.includes('parentesco');
  const hasCDR = cols.includes('cdr_id');

  const params = [];
  const where  = [];
  if (asesorId)   { where.push('sg.asesor_id = ?');            params.push(Number(asesorId)); }
  if (fecha)      { where.push("date(sg.creado_en) = ?");      params.push(fecha); }
  if (parentesco) { where.push('sg.parentesco = ?');           params.push(parentesco); }
  params.push(limite);

  return db.prepare(`
    SELECT
      sg.id, sg.telefono, sg.notas, sg.creado_en,
      sg.contacto_id, sg.asesor_id,
      ${hasNR  ? 'sg.nombre_ref'  : 'NULL'} AS nombre_ref,
      ${hasPA  ? 'sg.parentesco'  : 'NULL'} AS parentesco,
      ${hasCDR ? 'sg.cdr_id'      : 'NULL'} AS cdr_id,
      u.nombre  AS asesor_nombre,
      ct.nombre_deudor, ct.cedula, ct.telefono AS telefono_principal
    FROM sub_gestiones sg
    LEFT JOIN usuarios  u  ON sg.asesor_id   = u.id
    LEFT JOIN contactos ct ON sg.contacto_id = ct.id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY sg.creado_en DESC
    LIMIT ?
  `).all(...params);
}

function getCdrsByUsuario(usuarioId, fecha) {
  const db = getDb();
  const f = fecha || _todayLocalISO();
  const hasSnap = db.prepare("PRAGMA table_info(cdrs)").all().some(c => c.name === 'snapshot_nombre');
  return db.prepare(`
    SELECT
      c.*,
      t.codigo as tipificacion_codigo, t.descripcion as tipificacion_desc,
      ${hasSnap
        ? "COALESCE(ct.nombre_deudor, c.snapshot_nombre) AS nombre_deudor, COALESCE(ct.telefono, c.snapshot_telefono) AS telefono"
        : "ct.nombre_deudor, ct.telefono"
      },
      COALESCE(c.timestamp_inicio, c.creado_en, '-') as hora_gestion,
      COALESCE(c.duracion_seg,
        CASE WHEN c.timestamp_fin IS NOT NULL
          THEN CAST((julianday(c.timestamp_fin) - julianday(c.timestamp_inicio)) * 86400 AS INTEGER)
          ELSE NULL END
      ) AS duracion_seg,
      (SELECT a.fecha_hora FROM agendamientos a
       WHERE a.contacto_id = c.contacto_id
         AND a.asesor_id = c.usuario_id
         AND (date(a.creado_en) = date(c.creado_en) OR date(a.fecha_hora) = date(c.creado_en) OR date(a.creado_en) = date(c.timestamp_inicio))
       ORDER BY ABS(strftime('%s', a.creado_en) - strftime('%s', COALESCE(c.creado_en, c.timestamp_inicio))) ASC
       LIMIT 1) as agendamiento_hora
    FROM cdrs c
    LEFT JOIN tipificaciones t ON c.tipificacion_id = t.id
    LEFT JOIN contactos ct ON c.contacto_id = ct.id
    WHERE c.usuario_id = ?
      AND (date(c.creado_en, 'localtime') = ? OR date(c.timestamp_inicio) = ? OR date(c.creado_en) = ?)
    ORDER BY c.creado_en DESC, c.id DESC
  `).all(usuarioId, f, f, f);
}

/**
 * Bitácora completa del asesor — todos los CDRs históricos sin filtro de fecha.
 * Persistente entre sesiones; el asesor ve sus gestiones de todos los días.
 * @param {number} asesorId
 * @param {number} limite — default 500
 */
/**
 * Cartera completa asignada a un asesor con estado de gestión y métricas por cliente.
 * Cada fila incluye datos del contacto + último CDR/tipificación + conteo de gestiones.
 * Permite al asesor ver qué clientes tiene asignados y cuáles ya fueron trabajados.
 */
function getCarteraAsesor(asesorId, campanaId = null) {
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(contactos)").all().map(c => c.name);
  const hasFechaAsig = cols.includes('fecha_asignacion');
  const hasOrden = cols.includes('orden_marcacion');
  const hasValidado = cols.includes('validado_pago');
  const hasWspFecha = cols.includes('wsp_enviado_fecha');
  const hasRcsFecha = cols.includes('rcs_enviado_fecha');
  const hasCorreoFecha = cols.includes('correo_enviado_fecha');

  // Status ENVIADO solo si enviado HOY — contabilización diaria
  const wspStatusExpr = hasWspFecha
    ? `CASE WHEN ct.whatsapp_status = 'ENVIADO' AND ct.wsp_enviado_fecha = date('now','localtime') THEN 'ENVIADO' WHEN ct.whatsapp_status = 'ENVIADO' THEN 'INACTIVO' ELSE ct.whatsapp_status END`
    : 'ct.whatsapp_status';
  const rcsStatusExpr = hasRcsFecha
    ? `CASE WHEN ct.rcs_status = 'ENVIADO' AND ct.rcs_enviado_fecha = date('now','localtime') THEN 'ENVIADO' WHEN ct.rcs_status = 'ENVIADO' THEN 'ACTIVO' ELSE ct.rcs_status END`
    : 'ct.rcs_status';
  const correoStatusExpr = hasCorreoFecha
    ? `CASE WHEN ct.correo_status = 'ENVIADO' AND ct.correo_enviado_fecha = date('now','localtime') THEN 'ENVIADO' WHEN ct.correo_status = 'ENVIADO' THEN 'INACTIVO' ELSE ct.correo_status END`
    : 'ct.correo_status';

  const campanaFilter = campanaId ? ' AND ct.campana_id = ?' : '';
  const params = campanaId ? [asesorId, campanaId] : [asesorId];

  // PASO 1: contactos base
  const contactos = db.prepare(`
    SELECT
      ct.id, ct.cedula, ct.nombre_deudor, ct.telefono,
      ct.monto_deuda, ct.producto, ct.metadata,
      ct.estado_marcacion, ct.intentos_realizados,
      ct.ya_pago, ct.campana_id,
      (${wspStatusExpr}) AS whatsapp_status,
      (${rcsStatusExpr}) AS rcs_status,
      (${correoStatusExpr}) AS correo_status,
      ${hasValidado ? 'ct.validado_pago' : '0 AS validado_pago'},
      ${hasOrden ? 'ct.orden_marcacion' : 'NULL AS orden_marcacion'},
      ${hasFechaAsig ? 'ct.fecha_asignacion' : 'NULL AS fecha_asignacion'},
      cmp.nombre AS campana_nombre
    FROM contactos ct
    LEFT JOIN campanas cmp ON ct.campana_id = cmp.id
    WHERE ct.asignado_a = ?${campanaFilter}
    ORDER BY
      ${hasOrden ? 'CASE WHEN ct.orden_marcacion IS NULL THEN 1 ELSE 0 END, ct.orden_marcacion ASC,' : ''}
      CASE ct.estado_marcacion
        WHEN 'EN_INTENTOS' THEN 0
        WHEN 'PENDIENTE'   THEN 1
        WHEN 'AGENDADO'    THEN 2
        WHEN 'GESTIONADO'  THEN 3
        WHEN 'YA_PAGO'     THEN 4
        ELSE 5
      END,
      ct.id ASC
  `).all(...params);

  if (contactos.length === 0) return [];

  // PASO 2: gestiones_count — solo contactos de la cartera actual (no historial de campañas anteriores)
  const gestionesMap = new Map();
  const ids = contactos.map(c => c.id);
  if (ids.length > 0) {
    const ph = ids.map(() => '?').join(',');
    db.prepare(`
      SELECT contacto_id, COUNT(*) as n
      FROM cdrs
      WHERE usuario_id = ?
      AND contacto_id IN (${ph})
      GROUP BY contacto_id
    `).all(asesorId, ...ids).forEach(r => gestionesMap.set(r.contacto_id, r.n));
  }

  // PASO 3: última tipificación por contacto (un solo query agregado)
  const ultimasMap = new Map();
  const cdrCols = db.prepare("PRAGMA table_info(cdrs)").all().map(c => c.name);
  const hasCreado = cdrCols.includes('creado_en');
  const hasTsInicio = cdrCols.includes('timestamp_inicio');
  const tsCol = hasTsInicio ? 'cdrs.timestamp_inicio'
              : hasCreado   ? 'cdrs.creado_en'
                            : 'cdrs.id'; // fallback al ID como proxy temporal
  // Tomar la MAX(id) por contacto → la fila más reciente
  db.prepare(`
    SELECT cdrs.contacto_id, t.descripcion, t.codigo, ${tsCol} AS ts
    FROM cdrs
    JOIN tipificaciones t ON cdrs.tipificacion_id = t.id
    WHERE cdrs.id IN (
      SELECT MAX(id) FROM cdrs
      WHERE contacto_id IN (SELECT id FROM contactos WHERE asignado_a = ?)
        AND tipificacion_id IS NOT NULL
      GROUP BY contacto_id
    )
  `).all(asesorId).forEach(r => ultimasMap.set(r.contacto_id, r));

  // PASO 4: merge en JS
  for (const c of contactos) {
    c.gestiones_count = gestionesMap.get(c.id) || 0;
    const ult = ultimasMap.get(c.id);
    c.ultima_gestion = ult ? ult.ts : null;
    c.ultima_tipificacion = ult ? ult.descripcion : null;
    c.ultima_tip_codigo = ult ? ult.codigo : null;
  }
  return contactos;
}

/**
 * Cartera completa de TODOS los asesores — vista supervisor.
 * Igual estructura que getCarteraAsesor pero sin filtro de asesor; incluye
 * nombre del asesor para agrupar/filtrar en frontend.
 */
function getCarteraEquipo() {
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(contactos)").all().map(c => c.name);
  const hasFechaAsig = cols.includes('fecha_asignacion');
  const hasOrden = cols.includes('orden_marcacion');
  const hasValidado = cols.includes('validado_pago');

  // PASO 1: contactos base — orden idéntico a getSiguienteContacto dentro de cada asesor
  const contactos = db.prepare(`
    SELECT
      ct.id, ct.cedula, ct.nombre_deudor, ct.telefono,
      ct.monto_deuda, ct.producto, ct.metadata,
      ct.estado_marcacion, ct.intentos_realizados,
      ct.ya_pago, ct.campana_id, ct.asignado_a,
      ct.whatsapp_status, ct.rcs_status, ct.correo_status,
      ${hasValidado ? 'ct.validado_pago' : '0 AS validado_pago'},
      ${hasOrden ? 'ct.orden_marcacion' : 'NULL AS orden_marcacion'},
      u.nombre AS asesor_nombre,
      ${hasFechaAsig ? 'ct.fecha_asignacion' : 'NULL AS fecha_asignacion'},
      cmp.nombre AS campana_nombre,
      cmp.fecha_inicio AS campana_fecha
    FROM contactos ct
    LEFT JOIN usuarios u ON ct.asignado_a = u.id
    LEFT JOIN campanas cmp ON ct.campana_id = cmp.id
    WHERE ct.asignado_a IS NOT NULL
    ORDER BY
      u.nombre ASC,
      ${hasOrden ? 'CASE WHEN ct.orden_marcacion IS NULL THEN 1 ELSE 0 END, ct.orden_marcacion ASC,' : ''}
      CASE ct.estado_marcacion
        WHEN 'EN_INTENTOS' THEN 0
        WHEN 'PENDIENTE'   THEN 1
        WHEN 'AGENDADO'    THEN 2
        WHEN 'GESTIONADO'  THEN 3
        WHEN 'YA_PAGO'     THEN 4
        ELSE 5
      END,
      ct.id ASC
  `).all();

  if (contactos.length === 0) return [];

  // PASO 2: gestiones_count agregado por contacto
  const gestionesMap = new Map();
  db.prepare(`
    SELECT contacto_id, COUNT(*) as n
    FROM cdrs
    GROUP BY contacto_id
  `).all().forEach(r => gestionesMap.set(r.contacto_id, r.n));

  // PASO 3: última tipificación por contacto
  const cdrCols = db.prepare("PRAGMA table_info(cdrs)").all().map(c => c.name);
  const hasCreado = cdrCols.includes('creado_en');
  const hasTsInicio = cdrCols.includes('timestamp_inicio');
  const tsCol = hasTsInicio ? 'cdrs.timestamp_inicio'
              : hasCreado   ? 'cdrs.creado_en'
                            : 'cdrs.id';
  const ultimasMap = new Map();
  db.prepare(`
    SELECT cdrs.contacto_id, t.descripcion, t.codigo, ${tsCol} AS ts
    FROM cdrs
    LEFT JOIN tipificaciones t ON cdrs.tipificacion_id = t.id
    WHERE cdrs.id IN (SELECT MAX(id) FROM cdrs GROUP BY contacto_id)
  `).all().forEach(r => ultimasMap.set(r.contacto_id, r));

  // PASO 4: merge
  for (const c of contactos) {
    c.gestiones_count = gestionesMap.get(c.id) || 0;
    const ult = ultimasMap.get(c.id);
    c.ultima_gestion = ult ? ult.ts : null;
    c.ultima_tipificacion = ult ? ult.descripcion : null;
    c.ultima_tip_codigo = ult ? ult.codigo : null;
  }
  return contactos;
}

function getBitacoraAsesor(asesorId, limite = 500) {
  const db = getDb();
  // Detectar columnas opcionales para tolerancia con esquemas distintos
  const cdrCols = db.prepare("PRAGMA table_info(cdrs)").all().map(c => c.name);
  const hasCreadoEn = cdrCols.includes('creado_en');
  const hasTsInicio  = cdrCols.includes('timestamp_inicio');
  const hasMontoAcordado = cdrCols.includes('monto_acordado');
  const hasDuracionSeg = cdrCols.includes('duracion_seg');
  const hasUrlGrabacion = cdrCols.includes('url_grabacion');
  const hasResultado = cdrCols.includes('resultado');
  const hasNotas = cdrCols.includes('notas');

  // Preferir timestamp_inicio (siempre hora local) sobre creado_en (UTC en filas viejas)
  const horaBase = hasTsInicio ? 'COALESCE(c.timestamp_inicio, c.creado_en)' : (hasCreadoEn ? 'c.creado_en' : "'1970-01-01'");

  const hasSnap = cdrCols.includes('snapshot_nombre');
  return db.prepare(`
    SELECT
      c.id, c.contacto_id, c.usuario_id, c.tipificacion_id,
      c.timestamp_inicio, c.timestamp_fin,
      ${hasCreadoEn ? 'c.creado_en' : "NULL AS creado_en"},
      ${hasResultado ? 'c.resultado' : "NULL AS resultado"},
      ${hasNotas ? 'c.notas' : "NULL AS notas"},
      ${hasUrlGrabacion ? 'c.url_grabacion' : "NULL AS url_grabacion"},
      ${hasMontoAcordado ? 'c.monto_acordado' : "NULL AS monto_acordado"},
      t.codigo AS tipificacion_codigo, t.descripcion AS tipificacion_desc,
      ${hasSnap
        ? "COALESCE(ct.nombre_deudor, c.snapshot_nombre) AS nombre_deudor, COALESCE(ct.telefono, c.snapshot_telefono) AS telefono"
        : "ct.nombre_deudor, ct.telefono"
      },
      ct.cedula,
      ${horaBase} AS hora_gestion,
      ${hasDuracionSeg
        ? `COALESCE(c.duracion_seg, CASE WHEN c.timestamp_fin IS NOT NULL THEN CAST((julianday(c.timestamp_fin) - julianday(c.timestamp_inicio)) * 86400 AS INTEGER) ELSE NULL END) AS duracion_seg`
        : `CASE WHEN c.timestamp_fin IS NOT NULL THEN CAST((julianday(c.timestamp_fin) - julianday(c.timestamp_inicio)) * 86400 AS INTEGER) ELSE NULL END AS duracion_seg`
      },
      date(${horaBase}) AS fecha_gestion,
      ct.metadata AS metadata
    FROM cdrs c
    LEFT JOIN tipificaciones t ON c.tipificacion_id = t.id
    LEFT JOIN contactos ct ON c.contacto_id = ct.id
    WHERE c.usuario_id = ?
      AND c.tipificacion_id IS NOT NULL
    ORDER BY ${horaBase} DESC, c.id DESC
    LIMIT ?
  `).all(asesorId, limite);
}

/**
 * Refs históricas del asesor (sub-gestiones todas, sin filtro fecha).
 */
function getRefsBitacora(asesorId, limite = 1000) {
  const db = getDb();
  const hasSub = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sub_gestiones'").get();
  if (!hasSub) return [];
  const cols = db.prepare("PRAGMA table_info(sub_gestiones)").all().map(c => c.name);
  const hasCdrId      = cols.includes('cdr_id');
  const hasNombreRef  = cols.includes('nombre_ref');
  const hasParentesco = cols.includes('parentesco');
  return db.prepare(`
    SELECT sg.id, sg.telefono, sg.notas, sg.creado_en AS timestamp,
           sg.contacto_id,
           ct.nombre_deudor, ct.telefono AS telefono_principal,
           date(sg.creado_en) AS fecha_gestion,
           ${hasCdrId      ? 'sg.cdr_id'     : 'NULL'} AS cdr_id,
           ${hasNombreRef  ? 'sg.nombre_ref'  : 'NULL'} AS nombre_ref,
           ${hasParentesco ? 'sg.parentesco'  : 'NULL'} AS parentesco
    FROM sub_gestiones sg
    LEFT JOIN contactos ct ON sg.contacto_id = ct.id
    WHERE sg.asesor_id = ?
    ORDER BY sg.creado_en DESC
    LIMIT ?
  `).all(asesorId, limite);
}

function getSubGestionesByAsesor(asesorId, fecha) {
  const db = getDb();
  const hasSub = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sub_gestiones'").get();
  if (!hasSub) return [];
  const f = fecha || _todayLocalISO();
  const cols = db.prepare("PRAGMA table_info(sub_gestiones)").all().map(c => c.name);
  const hasCdrId = cols.includes('cdr_id');
  return db.prepare(`
    SELECT sg.id, sg.telefono, sg.notas, sg.creado_en AS timestamp,
           ${hasCdrId ? 'sg.cdr_id' : 'NULL'} AS cdr_id
    FROM sub_gestiones sg
    WHERE sg.asesor_id = ?
      AND date(sg.creado_en) = ?
    ORDER BY sg.creado_en ASC
  `).all(asesorId, f);
}

function getAllCdrs(filtros = {}) {
  const db = getDb();
  let sql = `
    SELECT c.*, t.codigo as tipificacion_codigo, t.descripcion as tipificacion_desc,
           ct.nombre_deudor, ct.telefono, u.nombre as asesor_nombre
    FROM cdrs c
    LEFT JOIN tipificaciones t ON c.tipificacion_id = t.id
    LEFT JOIN contactos ct ON c.contacto_id = ct.id
    LEFT JOIN usuarios u ON c.usuario_id = u.id
    WHERE c.tipificacion_id IS NOT NULL
  `;
  const params = [];

  if (filtros.asesorId) {
    sql += ' AND c.usuario_id = ?';
    params.push(filtros.asesorId);
  }
  if (filtros.fecha) {
    sql += ' AND date(c.creado_en) = ?';
    params.push(filtros.fecha);
  }

  sql += ' ORDER BY c.creado_en DESC LIMIT 100';
  return db.prepare(sql).all(...params);
}

function getCdrsGestiones(asesorId = null, fecha = null) {
  const db = getDb();
  const cdrCols = db.prepare("PRAGMA table_info(cdrs)").all().map(c => c.name);
  const hasCreadoEn = cdrCols.includes('creado_en');
  const hasTsInicio = cdrCols.includes('timestamp_inicio');
  const hasMonto = cdrCols.includes('monto_acordado');
  const hasNotas = cdrCols.includes('notas');

  const fechaHora = hasTsInicio ? 'COALESCE(c.timestamp_inicio, c.creado_en)'
                  : hasCreadoEn ? 'c.creado_en'
                  : "'1970-01-01'";

  // PASO 1: CDRs base (sin subquery correlated, sin JOIN a contactos/usuarios para evitar
  // bug "no such column" en algunos esquemas)
  const params = [];
  let where = 'c.tipificacion_id IS NOT NULL';
  if (asesorId) { where += ' AND c.usuario_id = ?'; params.push(Number(asesorId)); }
  if (fecha)    { where += ` AND ${_dateLocalMatch(fechaHora)}`; params.push(fecha, fecha, fecha); }

  const cdrs = db.prepare(`
    SELECT
      c.id          AS cdr_id,
      c.contacto_id,
      c.usuario_id,
      ${fechaHora}  AS fecha_hora,
      t.codigo      AS tipificacion_codigo,
      t.descripcion AS tipificacion,
      ${hasNotas ? 'c.notas' : 'NULL'} AS observaciones,
      ${hasMonto ? 'c.monto_acordado' : 'NULL'} AS monto_acordado
    FROM cdrs c
    LEFT JOIN tipificaciones t ON c.tipificacion_id = t.id
    WHERE ${where}
    ORDER BY ${fechaHora} DESC
    LIMIT 5000
  `).all(...params);

  if (cdrs.length === 0) return [];

  // PASO 2: enriquecer con asesor, contacto, agendamiento y sub-gestiones
  const getUsr = db.prepare('SELECT nombre FROM usuarios WHERE id = ?');
  const getCt  = db.prepare('SELECT nombre_deudor, cedula, telefono, metadata FROM contactos WHERE id = ?');
  const getAg  = db.prepare(`
    SELECT fecha_hora FROM agendamientos
    WHERE contacto_id = ? AND asesor_id = ?
      AND estado != 'cancelado'
    ORDER BY id DESC LIMIT 1
  `);

  const hasSub033 = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sub_gestiones'").get();
  let getSubCdr = null;
  if (hasSub033) {
    const subCols = db.prepare("PRAGMA table_info(sub_gestiones)").all().map(c => c.name);
    const hasNR = subCols.includes('nombre_ref');
    const hasPA = subCols.includes('parentesco');
    const hasCDR = subCols.includes('cdr_id');
    if (hasCDR) {
      getSubCdr = db.prepare(`
        SELECT telefono, notas,
          ${hasNR ? 'nombre_ref' : 'NULL'} AS nombre_ref,
          ${hasPA ? 'parentesco' : 'NULL'} AS parentesco
        FROM sub_gestiones WHERE cdr_id = ?
      `);
    }
  }

  for (const c of cdrs) {
    const usr = getUsr.get(c.usuario_id);
    c.asesor = usr ? usr.nombre : null;
    const ct = c.contacto_id ? getCt.get(c.contacto_id) : null;
    c.cliente  = ct ? ct.nombre_deudor : null;
    c.ci       = ct ? ct.cedula        : null;
    c.telefono = ct ? ct.telefono      : null;
    c.empresa = null; c.contrato = null; c.valor_mora = null;
    if (ct && ct.metadata) {
      try {
        const m = JSON.parse(ct.metadata);
        c.empresa  = m['EMPRESA'] || null;
        c.contrato = m['Nº CONTRATO'] || m['CONTRATO'] || null;
        const moraRaw = m['VALOR EN MORA'];
        if (moraRaw != null) {
          const parsed = parseFloat(String(moraRaw).replace(/[^0-9.-]/g, ''));
          c.valor_mora = isNaN(parsed) ? null : parsed;
        }
      } catch (_) {}
    }
    const ag = c.contacto_id ? getAg.get(c.contacto_id, c.usuario_id) : null;
    c.fecha_promesa = ag ? ag.fecha_hora : null;

    if (getSubCdr && c.cdr_id) {
      const subs = getSubCdr.all(c.cdr_id);
      c.subgestiones = subs.length > 0
        ? subs.map(s => [s.telefono, s.nombre_ref, s.parentesco, s.notas].filter(Boolean).join(' | ')).join('; ')
        : null;
    } else {
      c.subgestiones = null;
    }
  }
  return cdrs;
}

// ═══════════════════════════════════════════════════════════════
// TIPIFICACIONES
// ═══════════════════════════════════════════════════════════════

function getTipificaciones() {
  const db = getDb();
  return db.prepare('SELECT * FROM tipificaciones ORDER BY codigo').all();
}

function getTipificacionById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM tipificaciones WHERE id = ?').get(id);
}

function actualizarEstadoContacto(contactoId, estado) {
  const db = getDb();
  return db.prepare(
    'UPDATE contactos SET estado_marcacion = ? WHERE id = ?'
  ).run(estado, contactoId);
}

// ═══════════════════════════════════════════════════════════════
// CONTACTABILIDAD (M-004)
// ═══════════════════════════════════════════════════════════════

function getContactabilidadDia(usuarioId, fecha = null) {
  const db = getDb();
  const hoy = fecha || _todayLocalISO();
  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN t.categoria = 'CONTACTO_EFECTIVO' THEN 1 ELSE 0 END) as efectivos,
      SUM(CASE WHEN t.categoria = 'NO_CONTACTADO'    THEN 1 ELSE 0 END) as no_contactados
    FROM cdrs c
    LEFT JOIN tipificaciones t ON c.tipificacion_id = t.id
    WHERE c.usuario_id = ? AND date(c.timestamp_inicio) = ?
      AND c.tipificacion_id IS NOT NULL
  `).get(usuarioId, hoy);
  const tasa = row.total > 0 ? Math.round(((row.efectivos || 0) / row.total) * 100) : 0;
  return {
    total: row.total || 0,
    efectivos: row.efectivos || 0,
    no_contactados: row.no_contactados || 0,
    tasa
  };
}

// ═══════════════════════════════════════════════════════════════
// AGENDAMIENTOS (M-006)
// ═══════════════════════════════════════════════════════════════

function insertAgendamiento(data) {
  const contactoId = data.contacto_id || data.contactoId;
  const asesorId = data.asesor_id || data.asesorId;
  const tipo = data.tipo;
  const fechaHora = data.fecha_hora || data.fechaHora;
  const notas = data.notas;
  
  return getDb().prepare(`
    INSERT INTO agendamientos (contacto_id, asesor_id, tipo, fecha_hora, notas)
    VALUES (?, ?, ?, ?, ?)
  `).run(contactoId, asesorId, tipo, fechaHora, notas || null);
}

function getAgendamientosPorAsesor(asesorId, estado = null) {
  const db = getDb();
  let sql = `
    SELECT a.*, c.nombre_deudor, c.telefono, c.cedula, u.nombre as asesor_nombre
    FROM agendamientos a
    JOIN contactos c ON a.contacto_id = c.id
    JOIN usuarios  u ON a.asesor_id   = u.id
    WHERE a.asesor_id = ?
  `;
  const params = [asesorId];
  if (estado) {
    sql += ' AND a.estado = ?';
    params.push(estado);
  }
  sql += ' ORDER BY a.fecha_hora ASC';
  return db.prepare(sql).all(...params);
}

function getAgendamientosPendientes() {
  const db = getDb();
  return db.prepare(`
    SELECT a.*, c.nombre_deudor, c.telefono, c.cedula, u.nombre as asesor_nombre
    FROM agendamientos a
    LEFT JOIN contactos c ON a.contacto_id = c.id
    LEFT JOIN usuarios  u ON a.asesor_id   = u.id
    WHERE a.estado NOT IN ('ejecutado', 'cancelado')
    ORDER BY a.fecha_hora ASC
  `).all();
}

function marcarAgendamientoEjecutado(id) {
  return getDb().prepare(
    "UPDATE agendamientos SET estado='ejecutado' WHERE id=?"
  ).run(id);
}

function cancelarAgendamiento(id) {
  return getDb().prepare(
    "UPDATE agendamientos SET estado='cancelado' WHERE id=?"
  ).run(id);
}

// ═══════════════════════════════════════════════════════════════
// SESIONES
// ═══════════════════════════════════════════════════════════════

function iniciarSesion(usuarioId, tipoConexion) {
  const db = getDb();
  return db.prepare(
    "INSERT INTO sesiones (usuario_id, tipo_conexion) VALUES (?, ?)"
  ).run(usuarioId, tipoConexion);
}

function cerrarSesion(sesionId) {
  const db = getDb();
  return db.prepare(
    "UPDATE sesiones SET fin = datetime('now') WHERE id = ?"
  ).run(sesionId);
}

// ═══════════════════════════════════════════════════════════════
// EVENTOS
// ═══════════════════════════════════════════════════════════════

function insertEvento({ usuario_id, sesion_id = null, tipo, estado_id = null, duracion_seg = null, metadata }) {
  const db = getDb();
  return db.prepare(
    `INSERT INTO eventos (usuario_id, sesion_id, tipo, estado_id, duracion_seg, timestamp, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(usuario_id, sesion_id, tipo, estado_id, duracion_seg, _nowLocalISO(), metadata ? JSON.stringify(metadata) : null);
}

function getEventosDia(usuarioId, fecha) {
  const db = getDb();
  const f = fecha || _todayLocalISO();
  return db.prepare(
    `SELECT * FROM eventos WHERE usuario_id = ? AND date(timestamp) = ? ORDER BY timestamp ASC`
  ).all(usuarioId, f);
}

// ═══════════════════════════════════════════════════════════════
// MÉTRICAS
// ═══════════════════════════════════════════════════════════════

function getMetricasDia(usuarioId, fecha = null, opts = {}) {
  const db = getDb();
  const fechaInicio = fecha || _todayLocalISO();
  const fechaFin    = opts.fechaFin || fechaInicio;
  const campanaId   = opts.campanaId || null;

  // Filtro extra "AND c.contacto_id IN (SELECT id FROM contactos WHERE campana_id=?)"
  // aplicado en queries que tocan CDRs vía c.contacto_id.
  const campFilterCdr = campanaId
    ? ' AND c.contacto_id IN (SELECT id FROM contactos WHERE campana_id = ?)'
    : '';
  const campParam = campanaId ? [campanaId] : [];

  // Filtros para queries de cartera (stock de contactos).
  // - Campaña: siempre filtra cuando se pasa
  // - Fecha: solo cuando es explícita (no aplica al default "hoy")
  //   Usa fecha_asignacion (M-019). Si el contacto no la tiene, no entra (NULL no matchea).
  const carteraFilters  = [];
  const carteraParams   = [];
  if (campanaId) {
    carteraFilters.push('campana_id = ?');
    carteraParams.push(campanaId);
  }
  if (fecha !== null) {
    carteraFilters.push('date(fecha_asignacion) BETWEEN ? AND ?');
    carteraParams.push(fechaInicio, fechaFin);
  }
  const carteraExtraSql = carteraFilters.length ? ' AND ' + carteraFilters.join(' AND ') : '';

  // Filtros de fecha tolerantes a timestamps UTC (legacy) y locales (nuevos).
  const cdrDateExpr    = _dateLocalExpr('c.timestamp_inicio');
  const evDateExpr     = _dateLocalExpr('e.timestamp');
  const evDateExprAlias = _dateLocalExpr('timestamp');

  // Marcaciones = CDRs de canal 'llamada' únicamente (no WhatsApp, RCS, Correo)
  // Triple-OR para cubrir timestamps UTC (Z), locales y sin zona horaria.
  const cdrMarcas = db.prepare(
    `SELECT COUNT(*) as total FROM cdrs c WHERE c.usuario_id = ? AND (c.canal = 'llamada' OR c.canal IS NULL)
     AND (
       substr(c.timestamp_inicio, 1, 10) BETWEEN ? AND ?
       OR date(c.timestamp_inicio, 'localtime') BETWEEN ? AND ?
       OR date(c.creado_en, 'localtime') BETWEEN ? AND ?
     )${campFilterCdr}`
  ).get(usuarioId, fechaInicio, fechaFin, fechaInicio, fechaFin, fechaInicio, fechaFin, ...campParam);

  const marcaciones = { total: cdrMarcas?.total ?? 0 };

  // Tiempo al aire (CDRs)
  const tiempoAire = db.prepare(
    `SELECT COALESCE(ROUND(SUM((julianday(c.timestamp_fin) - julianday(c.timestamp_inicio)) * 86400)), 0) as total FROM cdrs c WHERE c.usuario_id = ? AND ${cdrDateExpr} BETWEEN ? AND ? AND c.timestamp_fin IS NOT NULL${campFilterCdr}`
  ).get(usuarioId, fechaInicio, fechaFin, ...campParam);

  // Tiempo muerto = eventos ESTADO (no filtra por campaña — es estado global del asesor)
  const tiempoMuerto = db.prepare(
    `SELECT COALESCE(SUM(duracion_seg), 0) as total FROM eventos WHERE usuario_id = ? AND tipo = 'ESTADO' AND estado_id IN (2,3,4,5) AND ${evDateExprAlias} BETWEEN ? AND ?`
  ).get(usuarioId, fechaInicio, fechaFin);

  // Promesas de pago (PMP) — excluye explícitamente resultado=INCUMP aunque cambie la tipificación
  const promesasPago = db.prepare(
    `SELECT COUNT(*) as total FROM cdrs c JOIN tipificaciones t ON c.tipificacion_id = t.id WHERE c.usuario_id = ? AND ${cdrDateExpr} BETWEEN ? AND ? AND t.codigo = 'PMP' AND (c.resultado IS NULL OR c.resultado != 'INCUMP')${campFilterCdr}`
  ).get(usuarioId, fechaInicio, fechaFin, ...campParam);

  // Pagos recaudados (AB_PARC, PAGO_REAL, PEND_COMP) — ídem excluye incumplidos
  const pagosRecaudados = db.prepare(
    `SELECT COUNT(*) as total FROM cdrs c JOIN tipificaciones t ON c.tipificacion_id = t.id WHERE c.usuario_id = ? AND ${cdrDateExpr} BETWEEN ? AND ? AND t.codigo IN ('PAGO_REAL', 'AB_PARC', 'PEND_COMP') AND (c.resultado IS NULL OR c.resultado != 'INCUMP')${campFilterCdr}`
  ).get(usuarioId, fechaInicio, fechaFin, ...campParam);

  const compromisos = { total: (promesasPago?.total ?? 0) + (pagosRecaudados?.total ?? 0) };

  // Estado de compromisos — usa resultado directo (sin JOIN) para no depender de tipificaciones
  // COMP_CUM = confirmado desde Mis Compromisos | INCUMP = incumplido | REAG = reagendado
  // Doble criterio: CDR creado hoy O agendamiento activo para hoy
  // Permite contabilizar compromisos de días previos que vencen hoy
  const _compExistsAg = `EXISTS (SELECT 1 FROM agendamientos ag WHERE ag.contacto_id = c.contacto_id AND ag.asesor_id = c.usuario_id AND (substr(ag.fecha_hora,1,10) BETWEEN ? AND ? OR date(ag.fecha_hora) BETWEEN ? AND ?) AND ag.estado != 'cancelado')`;
  const compCumplidos = db.prepare(
    `SELECT COUNT(*) as total FROM cdrs c WHERE c.usuario_id = ? AND c.resultado = 'COMP_CUM' AND (${cdrDateExpr} BETWEEN ? AND ? OR ${_compExistsAg})${campFilterCdr}`
  ).get(usuarioId, fechaInicio, fechaFin, fechaInicio, fechaFin, fechaInicio, fechaFin, ...campParam);

  const compIncumplidos = db.prepare(
    `SELECT COUNT(*) as total FROM cdrs c WHERE c.usuario_id = ? AND c.resultado = 'INCUMP' AND (${cdrDateExpr} BETWEEN ? AND ? OR ${_compExistsAg})${campFilterCdr}`
  ).get(usuarioId, fechaInicio, fechaFin, fechaInicio, fechaFin, fechaInicio, fechaFin, ...campParam);

  const compReagendados = db.prepare(
    `SELECT COUNT(*) as total FROM cdrs c WHERE c.usuario_id = ? AND c.resultado = 'REAG' AND (${cdrDateExpr} BETWEEN ? AND ? OR ${_compExistsAg})${campFilterCdr}`
  ).get(usuarioId, fechaInicio, fechaFin, fechaInicio, fechaFin, fechaInicio, fechaFin, ...campParam);

  // Total Asignados — base del asesor.
  // Aplica filtro de campaña y/o fecha de asignación cuando se piden explícitamente.
  const totalAsignados = db.prepare(
    `SELECT COUNT(*) as total FROM contactos WHERE asignado_a = ?${carteraExtraSql}`
  ).get(usuarioId, ...carteraParams);

  // Gestionados Base — contactos "ya tocados" (no pendientes ni en intentos).
  // Incluye GESTIONADO, AGENDADO y YA_PAGO porque todos representan cartera con
  // al menos una gestión completada (CDR con tipif terminadora).
  const gestionadosBase = db.prepare(
    `SELECT COUNT(*) as total FROM contactos
     WHERE asignado_a = ?
       AND estado_marcacion IN ('GESTIONADO','AGENDADO','YA_PAGO')${carteraExtraSql}`
  ).get(usuarioId, ...carteraParams);

  // Contactos efectivos
  const contactosEfectivos = db.prepare(`
    SELECT COUNT(*) as total FROM cdrs c
    JOIN tipificaciones t ON c.tipificacion_id = t.id
    WHERE c.usuario_id = ? AND ${cdrDateExpr} BETWEEN ? AND ?
      AND t.categoria IN ('CONTACTO_EFECTIVO', 'CONTACTO EXITOSO')${campFilterCdr}
  `).get(usuarioId, fechaInicio, fechaFin, ...campParam);

  // Contactabilidad por categoría — los 4 conteos deben sumar cdrs_total.
  // Tolerantes a variaciones de naming ('CONTACTO_NEUTRO' vs 'CONTACTO NEUTRO').
  // Usamos triple-OR para cubrir timestamps UTC (Z), locales y sin zona horaria.
  const cdrsTotal = db.prepare(
    `SELECT COUNT(*) as total FROM cdrs c WHERE c.usuario_id = ? AND c.tipificacion_id IS NOT NULL
     AND (
       substr(c.timestamp_inicio, 1, 10) BETWEEN ? AND ?
       OR date(c.timestamp_inicio, 'localtime') BETWEEN ? AND ?
       OR date(c.creado_en, 'localtime') BETWEEN ? AND ?
     )${campFilterCdr}`
  ).get(usuarioId, fechaInicio, fechaFin, fechaInicio, fechaFin, fechaInicio, fechaFin, ...campParam);

  const cdrsNeutros = db.prepare(`
    SELECT COUNT(*) as total FROM cdrs c
    JOIN tipificaciones t ON c.tipificacion_id = t.id
    WHERE c.usuario_id = ? AND ${cdrDateExpr} BETWEEN ? AND ?
      AND t.categoria IN ('CONTACTO_NEUTRO', 'CONTACTO NEUTRO')${campFilterCdr}
  `).get(usuarioId, fechaInicio, fechaFin, ...campParam);

  const cdrsNoContactados = db.prepare(`
    SELECT COUNT(*) as total FROM cdrs c
    JOIN tipificaciones t ON c.tipificacion_id = t.id
    WHERE c.usuario_id = ? AND ${cdrDateExpr} BETWEEN ? AND ?
      AND t.categoria IN ('NO_CONTACTADO', 'NO CONTACTADO')${campFilterCdr}
  `).get(usuarioId, fechaInicio, fechaFin, ...campParam);

  const cdrsSinTipificar = db.prepare(`
    SELECT COUNT(*) as total FROM cdrs c
    WHERE c.usuario_id = ? AND ${cdrDateExpr} BETWEEN ? AND ?
      AND c.tipificacion_id IS NULL${campFilterCdr}
  `).get(usuarioId, fechaInicio, fechaFin, ...campParam);

  // Monto prometido (PMP) — excluye incumplidos por resultado Y por tipificación
  const montoPrometido = db.prepare(`
    SELECT COALESCE(SUM(c.monto_acordado), 0) as total
    FROM cdrs c
    JOIN tipificaciones t ON c.tipificacion_id = t.id
    WHERE c.usuario_id = ? AND ${cdrDateExpr} BETWEEN ? AND ?
      AND t.codigo = 'PMP'
      AND c.monto_acordado IS NOT NULL
      AND (c.resultado IS NULL OR c.resultado != 'INCUMP')${campFilterCdr}
  `).get(usuarioId, fechaInicio, fechaFin, ...campParam);

  // Monto recaudado declarado — excluye incumplidos
  const montoRecaudado = db.prepare(`
    SELECT COALESCE(SUM(c.monto_acordado), 0) as total
    FROM cdrs c
    JOIN tipificaciones t ON c.tipificacion_id = t.id
    WHERE c.usuario_id = ? AND ${cdrDateExpr} BETWEEN ? AND ?
      AND t.codigo IN ('PAGO_REAL', 'AB_PARC', 'PEND_COMP')
      AND c.monto_acordado IS NOT NULL
      AND (c.resultado IS NULL OR c.resultado != 'INCUMP')${campFilterCdr}
  `).get(usuarioId, fechaInicio, fechaFin, ...campParam);

  const montoComprometido = { total: (montoPrometido?.total ?? 0) + (montoRecaudado?.total ?? 0) };

  // Mora total base — respeta filtros de campaña + fecha de asignación.
  const moraBase = db.prepare(`
    SELECT COALESCE(SUM(
      CAST(NULLIF(TRIM(json_extract(metadata, '$."VALOR EN MORA"')), '') AS REAL)
    ), 0) as total FROM contactos WHERE asignado_a = ?${carteraExtraSql}
  `).get(usuarioId, ...carteraParams);

  const aire = tiempoAire?.total ?? 0;
  const muerto = tiempoMuerto?.total ?? 0;
  const ratio = (aire + muerto) > 0 ? Math.round((aire / (aire + muerto)) * 100) : 0;

  const totalMarcas = marcaciones?.total ?? 0;
  const totalCompro = compromisos?.total ?? 0;
  const eficacia = totalMarcas > 0 ? Math.round((totalCompro / totalMarcas) * 100) : 0;

  // Acciones rápidas del día — contadas desde eventos tipo='ACCION_RAPIDA'.
  // metadata.canal ∈ { 'WSP', 'SMS', 'EMAIL' } + metadata.contacto_id.
  // Cuando hay filtro de campaña, se restringe a contactos de esa campaña.
  let wspEnviados = 0, smsEnviados = 0, correosEnviados = 0;
  try {
    let extraWhere = '';
    const extraParams = [];
    if (campanaId) {
      extraWhere = ` AND CAST(json_extract(metadata, '$.contacto_id') AS INTEGER)
                     IN (SELECT id FROM contactos WHERE campana_id = ?)`;
      extraParams.push(campanaId);
    }
    const accCount = (canal) => db.prepare(`
      SELECT COUNT(*) as total FROM eventos
      WHERE usuario_id = ? AND tipo = 'ACCION_RAPIDA' AND ${evDateExprAlias} BETWEEN ? AND ?
        AND json_extract(metadata, '$.canal') = ?${extraWhere}
    `).get(usuarioId, fechaInicio, fechaFin, canal, ...extraParams)?.total ?? 0;
    wspEnviados     = accCount('WSP');
    smsEnviados     = accCount('SMS');
    correosEnviados = accCount('EMAIL');
  } catch (_) { /* tolerante */ }

  // ── Desglose por segmento (S0, S1, S2) ──────────────────────────
  // Segmento se determina a partir del metadata JSON del contacto:
  //   DIAS IMPAGO / DIAS EN INPAGO / DIAS MORA
  //   S0 = 0 días | S1 = 1 día | S2 = 2+ días
  // Expresión SQL para extraer segmento desde metadata del contacto
  const segExpr = `CASE
    WHEN CAST(COALESCE(
      NULLIF(json_extract(ct.metadata, '$."DIAS IMPAGO"'), ''),
      NULLIF(json_extract(ct.metadata, '$."DIAS EN INPAGO"'), ''),
      NULLIF(json_extract(ct.metadata, '$."DIAS MORA"'), ''),
      '0'
    ) AS INTEGER) = 0 THEN 0
    WHEN CAST(COALESCE(
      NULLIF(json_extract(ct.metadata, '$."DIAS IMPAGO"'), ''),
      NULLIF(json_extract(ct.metadata, '$."DIAS EN INPAGO"'), ''),
      NULLIF(json_extract(ct.metadata, '$."DIAS MORA"'), ''),
      '0'
    ) AS INTEGER) = 1 THEN 1
    ELSE 2
  END`;

  // Marcaciones por segmento
  let marcacionesDetalle = [0, 0, 0];
  try {
    const rows = db.prepare(`
      SELECT ${segExpr} AS seg, COUNT(*) AS n
      FROM cdrs c
      JOIN contactos ct ON c.contacto_id = ct.id
      WHERE c.usuario_id = ? AND ${cdrDateExpr} BETWEEN ? AND ?${campFilterCdr}
      GROUP BY seg
    `).all(usuarioId, fechaInicio, fechaFin, ...campParam);
    for (const r of rows) marcacionesDetalle[r.seg] = r.n;
  } catch (_) { /* tolerante */ }

  // Acciones rápidas por segmento (WSP, SMS, EMAIL)
  let wspDetalle = { 0: 0, 1: 0, 2: 0 };
  let smsDetalle = { 0: 0, 1: 0, 2: 0 };
  let emailDetalle = { 0: 0, 1: 0, 2: 0 };
  try {
    let accExtraWhere = '';
    const accExtraParams = [];
    if (campanaId) {
      accExtraWhere = ` AND ct.campana_id = ?`;
      accExtraParams.push(campanaId);
    }
    const accBySegCanal = db.prepare(`
      SELECT json_extract(e.metadata, '$.canal') AS canal, ${segExpr.replace(/ct\./g, 'ct.')} AS seg, COUNT(*) AS n
      FROM eventos e
      JOIN contactos ct ON CAST(json_extract(e.metadata, '$.contacto_id') AS INTEGER) = ct.id
      WHERE e.usuario_id = ? AND e.tipo = 'ACCION_RAPIDA' AND ${evDateExprAlias.replace('timestamp', 'e.timestamp')} BETWEEN ? AND ?${accExtraWhere}
      GROUP BY canal, seg
    `).all(usuarioId, fechaInicio, fechaFin, ...accExtraParams);
    for (const r of accBySegCanal) {
      if (r.canal === 'WSP')   wspDetalle[r.seg]   = r.n;
      if (r.canal === 'SMS')   smsDetalle[r.seg]   = r.n;
      if (r.canal === 'EMAIL') emailDetalle[r.seg]  = r.n;
    }
  } catch (_) { /* tolerante */ }

  // Compromisos por segmento
  let compromisosDetalle = { 0: 0, 1: 0, 2: 0 };
  try {
    const rows = db.prepare(`
      SELECT ${segExpr} AS seg, COUNT(*) AS n
      FROM cdrs c
      JOIN tipificaciones t ON c.tipificacion_id = t.id
      JOIN contactos ct ON c.contacto_id = ct.id
      WHERE c.usuario_id = ? AND ${cdrDateExpr} BETWEEN ? AND ?
        AND t.codigo IN ('PMP', 'PAGO_REAL', 'AB_PARC', 'PEND_COMP')
        AND (c.resultado IS NULL OR c.resultado != 'INCUMP')${campFilterCdr}
      GROUP BY seg
    `).all(usuarioId, fechaInicio, fechaFin, ...campParam);
    for (const r of rows) compromisosDetalle[r.seg] = r.n;
  } catch (_) { /* tolerante */ }

  return {
    total_marcaciones:   totalMarcas,
    marcaciones_detalle: marcacionesDetalle,
    tiempo_al_aire:      aire,
    tiempo_muerto:       muerto,
    ratio_productividad: ratio,
    ratio_eficacia:      eficacia,
    total_compromisos:   totalCompro,
    compromisos_detalle: compromisosDetalle,
    total_asignados:     totalAsignados?.total  ?? 0,
    gestionados_base:    gestionadosBase?.total ?? 0,
    contactos_efectivos: contactosEfectivos?.total ?? 0,
    cdrs_total:          cdrsTotal?.total          ?? 0,
    cdrs_neutros:        cdrsNeutros?.total        ?? 0,
    cdrs_no_contactados: cdrsNoContactados?.total  ?? 0,
    cdrs_sin_tipificar:  cdrsSinTipificar?.total   ?? 0,
    monto_comprometido:      montoComprometido?.total ?? 0,
    promesas_pago:           promesasPago?.total    ?? 0,
    monto_prometido:         montoPrometido?.total  ?? 0,
    pagos_recaudados:        pagosRecaudados?.total  ?? 0,
    monto_recaudado:         montoRecaudado?.total   ?? 0,
    mora_total_base:         moraBase?.total ?? 0,
    compromisos_cumplidos:   compCumplidos?.total   ?? 0,
    compromisos_incumplidos: compIncumplidos?.total ?? 0,
    compromisos_reagendados: compReagendados?.total ?? 0,
    wsp_enviados:        wspEnviados,
    wsp_detalle:         wspDetalle,
    sms_enviados:        smsEnviados,
    sms_detalle:         smsDetalle,
    correos_enviados:    correosEnviados,
    email_detalle:       emailDetalle,
  };
}

/**
 * Drill-down: lista detallada de compromisos de pago del día (o rango).
 * Devuelve cada CDR con tipificación PMP/PAGO_REAL/AB_PARC/PEND_COMP, incluyendo:
 * - Asesor que gestionó
 * - Cliente, cédula, teléfono
 * - Tipificación + descripción
 * - Monto acordado (NULL si asesor no lo capturó)
 * - Fecha/hora promesa de pago (de agendamientos vinculados)
 * - Empresa (TEC SAS / SCC) extraída de metadata
 * - Hora de la gestión, notas, mora del cliente, contacto/cdr ids
 *
 * @param {string|null} fecha — YYYY-MM-DD; null = hoy
 * @param {number|null} asesorId — filtrar por asesor (opcional)
 */
function getCompromisosEquipo(fecha = null, asesorId = null, opts = {}) {
  const db = getDb();
  const fi = fecha || _todayLocalISO();
  const ff = opts.fechaFin || fi;

  // Detección dinámica de columnas (tolerancia a esquemas viejos/nuevos)
  const cdrCols = db.prepare("PRAGMA table_info(cdrs)").all().map(c => c.name);
  const hasCreado       = cdrCols.includes('creado_en');
  const hasTsInicio     = cdrCols.includes('timestamp_inicio');
  const hasMonto        = cdrCols.includes('monto_acordado');
  const hasDuracion     = cdrCols.includes('duracion_seg');
  const hasResultado    = cdrCols.includes('resultado');
  const hasNotas        = cdrCols.includes('notas');
  const hasScheduled    = cdrCols.includes('scheduled_datetime');

  // Columna de tiempo a usar (preferir timestamp_inicio, fallback creado_en)
  const horaCol = hasTsInicio ? 'c.timestamp_inicio'
                : hasCreado   ? 'c.creado_en'
                              : "'1970-01-01'";

  // Códigos incluidos: por defecto compromisos de pago. La vista del asesor
  // pasa opts.incluirVolCall=true para sumar "Volver a llamar" (VOL_CALL).
  // REAG incluido: cuando asesor tipifica "Reagendamiento" desde TipificacionDialog
  // el CDR queda con tipificacion_codigo=REAG y debe aparecer en Compromisos.
  const codigos = ['PMP', 'PAGO_REAL', 'AB_PARC', 'PEND_COMP', 'REAG', 'INCUMP'];
  if (opts.incluirVolCall) codigos.push('VOL_CALL');
  const codigosPlaceholders = codigos.map(() => '?').join(',');

  // PASO 1: obtener CDRs candidatos.
  // Triple criterio de fecha:
  //   a) CDR creado en la fecha (flujo mismo-día)
  //   b) CDR tiene agendamiento ACTIVO para esa fecha (reagendamientos de días previos)
  //   c) CDR INCUMP con agendamiento (incluso cancelado) para esa fecha — persiste para control
  // _dateRangeMatch = 6 params; cada EXISTS usa BETWEEN x2 = 4 params. Total: 6+4+4 = 14
  const params = [fi, ff, fi, ff, fi, ff,   // _dateRangeMatch
                  fi, ff, fi, ff,            // primer EXISTS (2 BETWEEN)
                  fi, ff, fi, ff,            // segundo EXISTS (2 BETWEEN)
                  ...codigos];
  let where = `(${_dateRangeMatch(horaCol)} OR EXISTS (
    SELECT 1 FROM agendamientos ag
    WHERE ag.contacto_id = c.contacto_id
      AND ag.asesor_id   = c.usuario_id
      AND (substr(ag.fecha_hora, 1, 10) BETWEEN ? AND ? OR date(ag.fecha_hora) BETWEEN ? AND ?)
      AND ag.estado != 'cancelado'
  ) OR (c.resultado = 'INCUMP' AND EXISTS (
    SELECT 1 FROM agendamientos ag
    WHERE ag.contacto_id = c.contacto_id
      AND ag.asesor_id   = c.usuario_id
      AND (substr(ag.fecha_hora, 1, 10) BETWEEN ? AND ? OR date(ag.fecha_hora) BETWEEN ? AND ?)
  ))) AND t.codigo IN (${codigosPlaceholders})`;
  if (asesorId) { where += ' AND c.usuario_id = ?'; params.push(asesorId); }
  // Bug 4: aislamiento por equipo — solo CDRs de asesores del supervisor dado.
  if (opts.supervisorId != null) {
    where += ' AND c.usuario_id IN (SELECT id FROM usuarios WHERE supervisor_id = ?)';
    params.push(opts.supervisorId);
  }

  const cdrs = db.prepare(`
    SELECT
      c.id          AS cdr_id,
      c.contacto_id,
      c.usuario_id,
      ${horaCol}    AS hora_gestion,
      ${hasDuracion  ? 'c.duracion_seg'     : 'NULL AS duracion_seg'},
      ${hasMonto     ? 'c.monto_acordado'   : 'NULL AS monto_acordado'},
      ${hasNotas     ? 'c.notas'            : 'NULL AS notas'},
      ${hasResultado ? 'c.resultado'        : 'NULL AS resultado'},
      ${hasScheduled ? 'c.scheduled_datetime' : 'NULL AS scheduled_datetime'},
      t.codigo      AS tipificacion_codigo,
      t.descripcion AS tipificacion_desc
    FROM cdrs c
    JOIN tipificaciones t ON c.tipificacion_id = t.id
    WHERE ${where}
    ORDER BY ${horaCol} DESC
  `).all(...params);

  if (cdrs.length === 0) return [];

  // PASO 2: enriquecer cada CDR con datos de asesor, contacto y agendamiento
  // (queries simples por fila — N+1 aceptable porque N es pequeño en compromisos diarios)
  const hasSnap2 = db.prepare("PRAGMA table_info(cdrs)").all().some(c => c.name === 'snapshot_nombre');
  const getUsr   = db.prepare('SELECT nombre FROM usuarios WHERE id = ?');
  const getCt    = db.prepare('SELECT nombre_deudor, cedula, telefono, metadata FROM contactos WHERE id = ?');
  const getSnap2 = hasSnap2
    ? db.prepare('SELECT snapshot_nombre, snapshot_cedula, snapshot_telefono, snapshot_empresa FROM cdrs WHERE id = ?')
    : null;
  const getAg  = db.prepare(`
    SELECT fecha_hora FROM agendamientos
    WHERE contacto_id = ? AND asesor_id = ?
      AND estado != 'cancelado'
    ORDER BY id DESC LIMIT 1
  `);

  for (const c of cdrs) {
    const usr = getUsr.get(c.usuario_id);
    c.asesor_nombre = usr ? usr.nombre : null;

    const ct   = c.contacto_id ? getCt.get(c.contacto_id) : null;
    const snap = getSnap2 ? getSnap2.get(c.cdr_id) : null;
    // Contacto en vivo primero; si fue eliminado (mezcla de cartera), usar snapshot
    c.nombre_deudor = ct?.nombre_deudor || snap?.snapshot_nombre || null;
    c.cedula        = ct?.cedula        || snap?.snapshot_cedula  || null;
    c.telefono      = ct?.telefono      || snap?.snapshot_telefono || null;
    c.empresa = null;
    c.valor_mora = null;
    c.contrato = null;
    if (ct && ct.metadata) {
      try {
        const m = JSON.parse(ct.metadata);
        c.empresa  = m['EMPRESA'] || snap?.snapshot_empresa || null;
        c.contrato = m['Nº CONTRATO'] || m['CONTRATO'] || null;
        const moraRaw = m['VALOR EN MORA'];
        if (moraRaw != null) {
          const parsed = parseFloat(String(moraRaw).replace(/[^0-9.-]/g, ''));
          c.valor_mora = isNaN(parsed) ? null : parsed;
        }
      } catch (_) { /* metadata corrupto */ }
    } else if (!ct) {
      c.empresa = snap?.snapshot_empresa || null;
    }

    // scheduled_datetime en CDR tiene prioridad; fallback a agendamientos
    if (c.scheduled_datetime) {
      c.fecha_promesa = c.scheduled_datetime;
    } else {
      const ag = c.contacto_id ? getAg.get(c.contacto_id, c.usuario_id) : null;
      c.fecha_promesa = ag ? ag.fecha_hora : null;
    }
  }

  return cdrs;
}

/**
 * Detalle de contactabilidad por gestión. Cada CDR retorna:
 * - hora_inicio, hora_fin, duracion_seg, tipificacion, asesor, cliente, etc
 * Opcionalmente filtra por fecha y/o asesorId.
 */
/**
 * Recaudación verificada por asesor — sin doble conteo.
 * Regla: cada contacto_id se cuenta UNA VEZ aunque haya múltiples CDRs PAGO_REAL
 * o aparezca también en validaciones_pago. Monto preferido: validado > declarado CDR.
 *
 * @param {string|null} fecha      YYYY-MM-DD; null = hoy
 * @param {number|null} campanaId  filtrar por campaña
 */
function getPagosVerificadosPorAsesor(fecha = null, campanaId = null, fechaFin = null) {
  const db = getDb();
  const fi = fecha || _todayLocalISO();
  const ff = fechaFin || fi;

  const cdrCols   = db.prepare('PRAGMA table_info(cdrs)').all().map(c => c.name);
  const hasTsIn   = cdrCols.includes('timestamp_inicio');
  const hasCreado = cdrCols.includes('creado_en');
  const hasMonto  = cdrCols.includes('monto_acordado');

  const dateCol  = hasTsIn ? 'c.timestamp_inicio' : hasCreado ? 'c.creado_en' : "'1970-01-01'";
  const dateExpr = _dateRangeMatch(dateCol);

  const params = [fi, ff, fi, ff, fi, ff];  // 6 params para _dateRangeMatch
  let campFilter = '';
  if (campanaId) {
    campFilter = ' AND c.contacto_id IN (SELECT id FROM contactos WHERE campana_id = ?)';
    params.push(campanaId);
  }

  // PASO 1 — todos los CDRs de tipo pago del día (ORDER ASC → el último sobrescribe en el Map)
  const rows = db.prepare(`
    SELECT c.id AS cdr_id, c.contacto_id, c.usuario_id,
           ${hasMonto ? 'c.monto_acordado' : 'NULL AS monto_acordado'}
    FROM cdrs c
    JOIN tipificaciones t ON c.tipificacion_id = t.id
    WHERE t.codigo IN ('PAGO_REAL', 'AB_PARC', 'PEND_COMP')
      AND ${dateExpr}
      ${campFilter}
    ORDER BY c.id ASC
  `).all(...params);

  if (rows.length === 0) return [];

  // PASO 2 — deduplicar por contacto_id: el CDR con mayor id gana (último tipificado)
  const byContacto = new Map();
  for (const r of rows) {
    byContacto.set(r.contacto_id, {
      cdr_id:    r.cdr_id,
      usuario_id: r.usuario_id,
      monto:     r.monto_acordado != null ? Number(r.monto_acordado) : 0,
    });
  }

  // PASO 3 — verificar si cada contacto tiene validación del supervisor (sin filtro fecha)
  const contactoIds = Array.from(byContacto.keys()).filter(id => id != null);
  const validadosMap = new Map();
  if (contactoIds.length > 0) {
    try {
      const ph = contactoIds.map(() => '?').join(',');
      db.prepare(`
        SELECT contacto_id, MAX(COALESCE(monto_pagado, 0)) AS monto_pagado
        FROM validaciones_pago
        WHERE contacto_id IN (${ph})
        GROUP BY contacto_id
      `).all(...contactoIds).forEach(v => validadosMap.set(v.contacto_id, Number(v.monto_pagado)));
    } catch (_) { /* tolerante — tabla puede no tener registros */ }
  }

  // PASO 4 — agrupar por asesor
  const getUsr = db.prepare('SELECT nombre FROM usuarios WHERE id = ?');
  const asesoresMap = new Map();

  for (const [contactoId, pago] of byContacto.entries()) {
    const uid = pago.usuario_id;
    if (!asesoresMap.has(uid)) {
      const u = getUsr.get(uid);
      asesoresMap.set(uid, {
        asesor_id:           uid,
        asesor_nombre:       u ? u.nombre : `Asesor ${uid}`,
        contratos:           0,
        monto_total:         0,
        contratos_validados: 0,
        monto_validado:      0,
      });
    }
    const a = asesoresMap.get(uid);
    const montoVal = validadosMap.has(contactoId) ? validadosMap.get(contactoId) : null;
    const montoFinal = montoVal != null ? montoVal : pago.monto;

    a.contratos++;
    a.monto_total += montoFinal;
    if (montoVal != null) {
      a.contratos_validados++;
      a.monto_validado += montoVal;
    }
  }

  return Array.from(asesoresMap.values()).sort((a, b) => b.monto_total - a.monto_total);
}

function getDetalleContactabilidad(fecha = null, asesorId = null, campanaId = null, fechaFin = null) {
  const db = getDb();
  const cdrCols = db.prepare("PRAGMA table_info(cdrs)").all().map(c => c.name);
  const hasCreado = cdrCols.includes('creado_en');
  const hasTsInicio = cdrCols.includes('timestamp_inicio');
  const hasTsFin = cdrCols.includes('timestamp_fin');
  const hasDur = cdrCols.includes('duracion_seg');
  const hasNotas = cdrCols.includes('notas');
  const hasSnap = cdrCols.includes('snapshot_nombre');

  const horaInicio = hasTsInicio ? 'c.timestamp_inicio'
                   : hasCreado   ? 'c.creado_en'
                                 : "'1970-01-01'";
  const horaFin = hasTsFin ? 'c.timestamp_fin' : 'NULL';

  // PASO 1: CDRs tipificados (solo gestiones completadas — sin CDRs huérfanos ni DIAL_EXTERNO)
  const params = [];
  let where = '1=1 AND c.tipificacion_id IS NOT NULL';
  if (fecha) {
    const ff = fechaFin || fecha;
    where += ` AND date(${horaInicio}) BETWEEN ? AND ?`;
    params.push(fecha, ff);
  }
  if (asesorId) { where += ' AND c.usuario_id = ?'; params.push(asesorId); }
  if (campanaId) {
    where += ' AND c.contacto_id IN (SELECT id FROM contactos WHERE campana_id = ?)';
    params.push(campanaId);
  }

  const cdrs = db.prepare(`
    SELECT
      c.id AS cdr_id,
      c.contacto_id,
      c.usuario_id,
      ${horaInicio} AS hora_inicio,
      ${horaFin}    AS hora_fin,
      ${hasDur ? 'c.duracion_seg' : 'NULL AS duracion_seg'},
      ${hasNotas ? 'c.notas' : 'NULL AS notas'},
      t.codigo      AS tipificacion_codigo,
      t.descripcion AS tipificacion_desc,
      t.categoria   AS tipificacion_categoria
    FROM cdrs c
    LEFT JOIN tipificaciones t ON c.tipificacion_id = t.id
    WHERE ${where}
    ORDER BY ${horaInicio} DESC
  `).all(...params);

  if (cdrs.length === 0) return [];

  // PASO 2: enrich asesor + cliente (con snapshot fallback)
  const getUsr = db.prepare('SELECT nombre FROM usuarios WHERE id = ?');
  const getCt  = db.prepare('SELECT nombre_deudor, cedula, telefono, metadata FROM contactos WHERE id = ?');
  const getSnap = hasSnap ? db.prepare('SELECT snapshot_nombre, snapshot_cedula, snapshot_telefono, snapshot_empresa FROM cdrs WHERE id = ?') : null;

  for (const c of cdrs) {
    const u = getUsr.get(c.usuario_id);
    c.asesor_nombre = u ? u.nombre : null;
    const ct = c.contacto_id ? getCt.get(c.contacto_id) : null;
    c.nombre_deudor = ct ? ct.nombre_deudor : null;
    c.cedula = ct ? ct.cedula : null;
    c.telefono = ct ? ct.telefono : null;
    c.empresa = null;
    c.contrato = null;
    if (ct && ct.metadata) {
      try {
        const m = JSON.parse(ct.metadata);
        c.empresa = m['EMPRESA'] || null;
        c.contrato = m['Nº CONTRATO'] || m['CONTRATO'] || null;
      } catch (_) {}
    }
    // Snapshot solo aplica para CDRs reales (cdr_id no nulo)
    if (!c.nombre_deudor && getSnap && c.cdr_id != null) {
      const snap = getSnap.get(c.cdr_id);
      if (snap) {
        c.nombre_deudor = snap.snapshot_nombre;
        c.cedula = c.cedula || snap.snapshot_cedula;
        c.telefono = c.telefono || snap.snapshot_telefono;
        c.empresa = c.empresa || snap.snapshot_empresa;
      }
    }
    // Calcular hora (0-23) para agrupar
    if (c.hora_inicio && typeof c.hora_inicio === 'string') {
      try {
        const d = new Date(c.hora_inicio.replace(' ', 'T'));
        if (!isNaN(d.getTime())) c.hora_bucket = d.getHours();
      } catch (_) {}
    }
  }
  return cdrs;
}

function getMetricasEquipo(fecha = null, opts = {}) {
  // Bug 4: si opts.supervisorId, agrega solo el equipo de ese supervisor.
  const asesores = getAsesores(opts.supervisorId != null ? { supervisorId: opts.supervisorId } : {});
  const detalles = asesores.map(a => ({ asesor: a, metricas: getMetricasDia(a.id, fecha, opts) }));

  // Activos = asesores con actividad real en el scope filtrado (día/campaña).
  // Antes: totalConectados = asesores.length (total registrados) → distorsionaba el contador
  // y diluía promedio de productividad cuando se filtraba por día.
  const detallesActivos = detalles.filter(d =>
    (d.metricas.total_marcaciones || 0) > 0 ||
    (d.metricas.tiempo_al_aire    || 0) > 0 ||
    (d.metricas.tiempo_muerto     || 0) > 0
  );
  const totalConectados = detallesActivos.length;
  const marcacionesTotales = detalles.reduce((s, r) => s + r.metricas.total_marcaciones, 0);
  const tiempoAlAireSeg = detalles.reduce((s, r) => s + r.metricas.tiempo_al_aire, 0);
  const promedioProductividad = totalConectados > 0
    ? Math.round(detallesActivos.reduce((s, r) => s + r.metricas.ratio_productividad, 0) / totalConectados)
    : 0;

  const montoComprometidoTotal  = detalles.reduce((s, r) => s + r.metricas.monto_comprometido,  0);
  const moraTotal               = detalles.reduce((s, r) => s + r.metricas.mora_total_base,      0);
  const contactosEfectivosTotal = detalles.reduce((s, r) => s + r.metricas.contactos_efectivos,  0);
  const totalCompromisosEquipo  = detalles.reduce((s, r) => s + r.metricas.total_compromisos,    0);
  const tasaRecuperacion        = moraTotal > 0 ? Math.round((montoComprometidoTotal / moraTotal) * 10000) / 100 : 0;

  const promesasPagoTotal   = detalles.reduce((s, r) => s + r.metricas.promesas_pago,    0);
  const montoPrometidoTotal = detalles.reduce((s, r) => s + r.metricas.monto_prometido,  0);
  const pagosRecaudadosTotal  = detalles.reduce((s, r) => s + r.metricas.pagos_recaudados,  0);
  const montoRecaudadoTotal   = detalles.reduce((s, r) => s + r.metricas.monto_recaudado,   0);

  const wspEnviadosTotal     = detalles.reduce((s, r) => s + (r.metricas.wsp_enviados     || 0), 0);
  const smsEnviadosTotal     = detalles.reduce((s, r) => s + (r.metricas.sms_enviados     || 0), 0);
  const correosEnviadosTotal = detalles.reduce((s, r) => s + (r.metricas.correos_enviados || 0), 0);

  // Contactabilidad por categoría — agregados al equipo
  const cdrsTotalEquipo          = detalles.reduce((s, r) => s + (r.metricas.cdrs_total          || 0), 0);
  const cdrsNeutrosTotal         = detalles.reduce((s, r) => s + (r.metricas.cdrs_neutros        || 0), 0);
  const cdrsNoContactadosTotal   = detalles.reduce((s, r) => s + (r.metricas.cdrs_no_contactados || 0), 0);
  const cdrsSinTipificarTotal    = detalles.reduce((s, r) => s + (r.metricas.cdrs_sin_tipificar  || 0), 0);

  return {
    totalConectados,
    marcacionesTotales,
    promedioProductividad,
    tiempoAlAireSeg,
    montoComprometidoTotal,
    moraTotal,
    contactosEfectivosTotal,
    totalCompromisosEquipo,
    tasaRecuperacion,
    promesasPagoTotal,
    montoPrometidoTotal,
    pagosRecaudadosTotal,
    montoRecaudadoTotal,
    wspEnviadosTotal,
    smsEnviadosTotal,
    correosEnviadosTotal,
    cdrsTotalEquipo,
    cdrsNeutrosTotal,
    cdrsNoContactadosTotal,
    cdrsSinTipificarTotal,
    detalleAsesores: detalles,
  };
}

// ═══════════════════════════════════════════════════════════════
// MENSAJERÍA (WhatsApp, RCS, Correo)
// ═══════════════════════════════════════════════════════════════

function toggleContactoMensajeria(contactoId, channel, newState, usuarioId = null) {
  const db = getDb();
  let column = '';
  if (channel === 'whatsapp') column = 'whatsapp_status';
  else if (channel === 'rcs') column = 'rcs_status';
  else if (channel === 'correo') column = 'correo_status';
  else throw new Error('Canal no soportado: ' + channel);

  // Asegurar que la columna exista (migración en tiempo de ejecución)
  if (channel === 'correo') {
    try {
      db.prepare(`ALTER TABLE contactos ADD COLUMN correo_status TEXT DEFAULT 'INACTIVO'`).run();
    } catch (e) {
      // Ignorar error si la columna ya existe
    }
  }

  const stmt = db.prepare(`UPDATE contactos SET ${column} = ? WHERE id = ?`);
  const result = stmt.run(newState, contactoId);

  if (newState === 'ENVIADO' && usuarioId) {
    const mapCanal = { whatsapp: 'WSP', rcs: 'SMS', correo: 'EMAIL' };
    try {
      // Usamos insertEvento para garantizar que se asigne el timestamp correcto (_nowLocalISO)
      // y se formatee el metadata correctamente.
      insertEvento({
        usuario_id: usuarioId,
        tipo: 'ACCION_RAPIDA',
        metadata: { canal: mapCanal[channel], contacto_id: contactoId }
      });
    } catch (e) {
      console.warn('[DB] Error guardando evento ACCION_RAPIDA:', e.message);
    }
  }

  return result;
}

function getLoteMensajeria(asesorId, channel, limit = 200) {
  const db = getDb();
  let column = '';
  let fechaCol = '';
  if (channel === 'whatsapp' || channel === 'WSP') { column = 'whatsapp_status'; fechaCol = 'wsp_enviado_fecha'; }
  else if (channel === 'rcs' || channel === 'SMS') { column = 'rcs_status'; fechaCol = 'rcs_enviado_fecha'; }
  else if (channel === 'correo' || channel === 'EMAIL') { column = 'correo_status'; fechaCol = 'correo_enviado_fecha'; }
  else throw new Error('Canal no soportado: ' + channel);

  const cols = db.prepare("PRAGMA table_info(contactos)").all().map(c => c.name);
  const hasFechaCol = cols.includes(fechaCol);

  // Excluir solo si fue enviado HOY — enviados de días anteriores vuelven al lote
  const enviadoHoyExpr = hasFechaCol
    ? `(${column} = 'ENVIADO' AND ${fechaCol} = date('now','localtime'))`
    : `${column} = 'ENVIADO'`;

  return db.prepare(`
    SELECT * FROM contactos
    WHERE asignado_a = ? AND NOT (${enviadoHoyExpr})
    ORDER BY CAST(monto_deuda AS REAL) DESC
    LIMIT ?
  `).all(asesorId, limit);
}

function marcarLoteEnviado(asesorId, channel, contactoIds) {
  if (!contactoIds || contactoIds.length === 0) return { changes: 0 };
  const db = getDb();
  let column = '';
  let fechaCol = '';
  let mapCanal = '';
  if (channel === 'whatsapp' || channel === 'WSP') { column = 'whatsapp_status'; fechaCol = 'wsp_enviado_fecha'; mapCanal = 'WSP'; }
  else if (channel === 'rcs' || channel === 'SMS') { column = 'rcs_status'; fechaCol = 'rcs_enviado_fecha'; mapCanal = 'SMS'; }
  else if (channel === 'correo' || channel === 'EMAIL') { column = 'correo_status'; fechaCol = 'correo_enviado_fecha'; mapCanal = 'EMAIL'; }
  else throw new Error('Canal no soportado: ' + channel);

  if (column === 'correo_status') {
    try { db.prepare(`ALTER TABLE contactos ADD COLUMN correo_status TEXT DEFAULT 'INACTIVO'`).run(); } catch (e) {}
  }
  // Asegurar columna de fecha (M-041)
  try { db.prepare(`ALTER TABLE contactos ADD COLUMN ${fechaCol} TEXT DEFAULT NULL`).run(); } catch (e) {}

  const placeholders = contactoIds.map(() => '?').join(',');
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD local
  const stmt = db.prepare(
    `UPDATE contactos SET ${column} = 'ENVIADO', ${fechaCol} = ? WHERE id IN (${placeholders})`
  );

  const tx = db.transaction(() => {
    const result = stmt.run(today, ...contactoIds);
    for (const cid of contactoIds) {
      insertEvento({
        usuario_id: asesorId,
        sesion_id: null,
        tipo: 'ACCION_RAPIDA',
        estado_id: null,
        duracion_seg: null,
        metadata: { canal: mapCanal, contacto_id: cid }
      });
    }
    return result;
  });

  return tx();
}

// ═══════════════════════════════════════════════════════════════
// ROTACIÓN DE CARTERA — rango de fechas + campaña
// ═══════════════════════════════════════════════════════════════

/**
 * Retorna detalleAsesores con total_asignados y gestionados_base
 * filtrados por rango de fecha_asignacion y/o campaña.
 * Shape compatible con detalleAsesores de getMetricasEquipo.
 */
function getRotacionCarteraPeriodo(opts = {}) {
  const db = getDb();
  const asesores = getAsesores();

  return asesores.map(a => {
    const filters = ['asignado_a = ?'];
    const params  = [a.id];

    if (opts.campanaId) {
      filters.push('campana_id = ?');
      params.push(Number(opts.campanaId));
    }
    if (opts.fechaInicio) {
      filters.push('date(fecha_asignacion) >= ?');
      params.push(opts.fechaInicio);
    }
    if (opts.fechaFin) {
      filters.push('date(fecha_asignacion) <= ?');
      params.push(opts.fechaFin);
    }

    const where = filters.join(' AND ');

    const totalAsignados = db.prepare(
      `SELECT COUNT(*) as total FROM contactos WHERE ${where}`
    ).get(...params);

    const gestionadosBase = db.prepare(
      `SELECT COUNT(*) as total FROM contactos
       WHERE ${where}
         AND estado_marcacion IN ('GESTIONADO','AGENDADO','YA_PAGO')`
    ).get(...params);

    return {
      asesor: a,
      metricas: {
        total_asignados:  totalAsignados?.total  ?? 0,
        gestionados_base: gestionadosBase?.total ?? 0,
      },
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

function getConfig(clave) {
  const db = getDb();
  const row = db.prepare('SELECT valor FROM config WHERE clave = ?').get(clave);
  return row ? row.valor : null;
}

function setConfig(clave, valor) {
  const db = getDb();
  return db.prepare('INSERT OR REPLACE INTO config (clave, valor) VALUES (?, ?)').run(clave, valor);
}

function getAllConfig() {
  const db = getDb();
  const rows = db.prepare('SELECT clave, valor FROM config').all();
  return rows.reduce((acc, r) => { acc[r.clave] = r.valor; return acc; }, {});
}

// ═══════════════════════════════════════════════════════════════
// VALIDACIÓN DE PAGOS
// ═══════════════════════════════════════════════════════════════

function _normEmpresa(str) {
  if (!str) return '';
  const s = str.toUpperCase();
  if (s.includes('TEC') || s.includes('SAS')) return 'TEC_SAS';
  if (s.includes('SCC') || s.includes('S.C.C')) return 'SCC';
  return s.replace(/[^A-Z0-9]/g, '');
}

function correlacionarPagos(pagosData, opts = {}) {
  const { asesorId = null, fecha = null, campanaId = null } = opts;
  // pagosData: [{ contrato, cedula, nombreCliente, fechaPago, montoPagado, empresa }]
  const porContrato = new Map();
  for (const p of pagosData) {
    const key = String(p.contrato ?? '').trim();
    if (!key) continue;
    if (!porContrato.has(key)) {
      porContrato.set(key, {
        contrato: key, cedula: p.cedula, nombreCliente: p.nombreCliente,
        empresa: p.empresa, montoPagadoTotal: 0, ultimaFecha: p.fechaPago, cuotas: 0,
      });
    }
    const e = porContrato.get(key);
    e.montoPagadoTotal += parseFloat(p.montoPagado) || 0;
    e.cuotas++;
    if ((p.fechaPago || '') > (e.ultimaFecha || '')) e.ultimaFecha = p.fechaPago;
  }

  const contratos = [...porContrato.keys()];
  if (!contratos.length) return { matches: [], totalContratos: 0, totalMatches: 0 };

  const db = getDb();
  const matches = [];
  const BATCH = 900;
  const extraWhere = [
    asesorId  ? 'AND ct.asignado_a = ?'            : '',
    fecha     ? "AND date(ct.fecha_asignacion) = ?" : '',
    campanaId ? 'AND ct.campana_id = ?'             : '',
  ].join(' ');

  for (let i = 0; i < contratos.length; i += BATCH) {
    const batch = contratos.slice(i, i + BATCH);
    const ph = batch.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT ct.id, ct.nombre_deudor, ct.cedula, ct.ya_pago,
             ct.campana_id, ct.asignado_a, ct.metadata, ct.monto_deuda,
             c.nombre AS campana_nombre,
             u.nombre AS asesor_nombre
      FROM contactos ct
      JOIN campanas c ON ct.campana_id = c.id
      LEFT JOIN usuarios u ON ct.asignado_a = u.id
      WHERE CAST(json_extract(ct.metadata, '$."Nº CONTRATO"') AS TEXT) IN (${ph})
      ${extraWhere}
    `).all(...batch,
      ...(asesorId  ? [asesorId]  : []),
      ...(fecha     ? [fecha]     : []),
      ...(campanaId ? [campanaId] : [])
    );

    for (const row of rows) {
      let meta = {};
      try { meta = JSON.parse(row.metadata || '{}'); } catch {}
      const contratoContacto = String(meta['Nº CONTRATO'] ?? '').trim();
      const pago = porContrato.get(contratoContacto);
      if (!pago) continue;
      const empresaMatch = !pago.empresa || !meta['EMPRESA'] ||
        _normEmpresa(pago.empresa) === _normEmpresa(meta['EMPRESA']);
      const _moraRaw = meta['VALOR EN MORA'] ?? meta['MONTO POR COBRAR'] ?? '';
      const _moraMeta = parseFloat(String(_moraRaw).replace(/[^0-9.-]/g, ''));
      const valorEnMora = (!isNaN(_moraMeta) && _moraMeta > 0)
        ? _moraMeta
        : (row.monto_deuda > 0 ? row.monto_deuda : 0);

      const diff = pago.montoPagadoTotal - valorEnMora;
      const estadoPago = valorEnMora <= 0
        ? 'SIN_MORA'
        : diff >= -0.01
          ? (diff > 0.01 ? 'PAGO_EXCEDENTE' : 'PAGADO_COMPLETO')
          : 'ABONO_PARCIAL';

      matches.push({
        contactoId:    row.id,
        nombreDeudor:  row.nombre_deudor,
        cedula:        row.cedula,
        campanaId:     row.campana_id,
        campanaNombre: row.campana_nombre,
        asesorNombre:  row.asesor_nombre || 'Sin asignar',
        contrato:      contratoContacto,
        empresa:       meta['EMPRESA'] || pago.empresa || '',
        montoPagado:   pago.montoPagadoTotal,
        valorEnMora,
        diferencia:    diff,
        estadoPago,
        ultimaFecha:   pago.ultimaFecha,
        cuotas:        pago.cuotas,
        yaPago:        row.ya_pago === 1,
        empresaMatch,
      });
    }
  }

  return { matches, totalContratos: contratos.length, totalMatches: matches.length };
}

function confirmarPagos(contactoIds, supervisorId, matches) {
  const db = getDb();
  const relevant = matches.filter(m => contactoIds.includes(m.contactoId));
  const montoTotal = relevant.reduce((s, m) => s + (m.montoPagado || 0), 0);
  let sesionId;

  db.transaction(() => {
    // Crear sesión de validación para esta corrida
    const resSesion = db.prepare(
      "INSERT INTO sesiones_validacion (supervisor_id, total_registros, monto_total) VALUES (?,?,?)"
    ).run(supervisorId || null, relevant.length, montoTotal);
    sesionId = resSesion.lastInsertRowid;

    // Validación bancaria → validado_pago=1 (inmutable, NO recallable).
    // orden_marcacion=NULL para sacarlo de cualquier cola residual.
    const updContacto = db.prepare(
      "UPDATE contactos SET ya_pago = 1, validado_pago = 1, estado_marcacion = 'YA_PAGO', orden_marcacion = NULL WHERE id = ?"
    );
    const insVal = db.prepare(`
      INSERT INTO validaciones_pago
        (contacto_id, campana_id, contrato, cedula, empresa, monto_pagado, ultima_fecha, cuotas,
         validado_por, estado_pago, valor_en_mora, sesion_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    // CDR más reciente de tipo compromiso → resultado='COMP_CUM' para contabilizar en métricas
    const getLastCdrCompromiso = db.prepare(`
      SELECT c.id FROM cdrs c
      JOIN tipificaciones t ON c.tipificacion_id = t.id
      WHERE c.contacto_id = ?
        AND t.codigo IN ('PMP', 'AB_PARC', 'PEND_COMP', 'REAG')
      ORDER BY c.id DESC LIMIT 1
    `);
    const updCdrCompCum = db.prepare("UPDATE cdrs SET resultado = 'COMP_CUM' WHERE id = ?");

    for (const m of relevant) {
      // ABONO_PARCIAL: registrar sin excluir del marcador
      if (m.estadoPago !== 'ABONO_PARCIAL') {
        updContacto.run(m.contactoId);
      }
      // Marcar CDR compromiso como cumplido → contabiliza en getMetricasDia y getCompromisosEquipo
      const lastCdr = getLastCdrCompromiso.get(m.contactoId);
      if (lastCdr) updCdrCompCum.run(lastCdr.id);
      insVal.run(
        m.contactoId, m.campanaId, m.contrato, m.cedula, m.empresa,
        m.montoPagado, m.ultimaFecha, m.cuotas, supervisorId || null,
        m.estadoPago || null, m.valorEnMora || 0, sesionId
      );
    }
  })();
  return { success: true, updated: relevant.length, sesionId };
}

function getSesionesValidacion() {
  const db = getDb();
  return db.prepare(`
    SELECT
      s.id, s.creado_en, s.total_registros, s.monto_total,
      u.nombre AS supervisor_nombre,
      COUNT(vp.id)                                                            AS registros,
      COALESCE(SUM(vp.monto_pagado), 0)                                       AS monto_real,
      COALESCE(SUM(CASE WHEN vp.estado_pago = 'PAGADO_COMPLETO'  THEN 1 ELSE 0 END), 0) AS n_pagado,
      COALESCE(SUM(CASE WHEN vp.estado_pago = 'PAGO_EXCEDENTE'   THEN 1 ELSE 0 END), 0) AS n_excedente,
      COALESCE(SUM(CASE WHEN vp.estado_pago = 'ABONO_PARCIAL'    THEN 1 ELSE 0 END), 0) AS n_abono,
      COALESCE(SUM(CASE WHEN vp.estado_pago = 'ABONO_PARCIAL'    THEN vp.monto_pagado ELSE 0 END), 0) AS monto_abono,
      COALESCE(SUM(CASE WHEN vp.estado_pago IN ('PAGADO_COMPLETO','PAGO_EXCEDENTE') THEN vp.monto_pagado ELSE 0 END), 0) AS monto_pagado
    FROM sesiones_validacion s
    LEFT JOIN usuarios u ON s.supervisor_id = u.id
    LEFT JOIN validaciones_pago vp ON vp.sesion_id = s.id
    GROUP BY s.id
    ORDER BY s.creado_en DESC
  `).all();
}

function eliminarSesion(sesionId) {
  const db = getDb();
  db.transaction(() => {
    // Revertir contactos que fueron marcados YA_PAGO en esta sesión (no ABONO_PARCIAL)
    db.prepare(`
      UPDATE contactos SET ya_pago = 0, validado_pago = 0, estado_marcacion = 'PENDIENTE'
      WHERE id IN (
        SELECT contacto_id FROM validaciones_pago
        WHERE sesion_id = ? AND (estado_pago IS NULL OR estado_pago != 'ABONO_PARCIAL')
      )
    `).run(sesionId);
    db.prepare("DELETE FROM validaciones_pago WHERE sesion_id = ?").run(sesionId);
    db.prepare("DELETE FROM sesiones_validacion WHERE id = ?").run(sesionId);
  })();
  return { success: true };
}

function getHistorialValidaciones() {
  const db = getDb();
  return db.prepare(`
    SELECT
      vp.id, vp.contacto_id, vp.contrato, vp.cedula, vp.sesion_id,
      s.creado_en AS sesion_fecha,
      -- Fallback empresa: si se guardó vacío, derivar desde metadata del contacto
      COALESCE(
        NULLIF(TRIM(vp.empresa), ''),
        NULLIF(TRIM(json_extract(ct.metadata, '$."EMPRESA"')), '')
      ) AS empresa,
      vp.monto_pagado, vp.ultima_fecha, vp.cuotas,
      vp.validado_en, vp.estado_pago,
      COALESCE(
        CASE WHEN vp.valor_en_mora > 0 THEN vp.valor_en_mora ELSE NULL END,
        CAST(NULLIF(TRIM(json_extract(ct.metadata, '$."VALOR EN MORA"')), '') AS REAL),
        ct.monto_deuda,
        0
      ) AS valor_en_mora,
      ct.nombre_deudor, ct.ya_pago,
      c.nombre  AS campana_nombre,
      u.nombre  AS validado_por_nombre
    FROM validaciones_pago vp
    LEFT JOIN sesiones_validacion s  ON vp.sesion_id   = s.id
    LEFT JOIN contactos ct           ON vp.contacto_id = ct.id
    LEFT JOIN campanas  c            ON vp.campana_id  = c.id
    LEFT JOIN usuarios  u  ON vp.validado_por = u.id
    ORDER BY vp.validado_en DESC
  `).all();
}

function revertirValidacion(contactoId) {
  const db = getDb();
  db.transaction(() => {
    db.prepare("UPDATE contactos SET ya_pago = 0, validado_pago = 0, estado_marcacion = 'PENDIENTE' WHERE id = ?").run(contactoId);
    db.prepare("DELETE FROM validaciones_pago WHERE contacto_id = ?").run(contactoId);
  })();
  return { success: true };
}

function getMetricasValidacion(fecha = null, opts = {}) {
  const db = getDb();
  const campanaId = opts.campanaId || null;

  // Construir WHERE dinámico para validaciones_pago según filtros
  const where = [];
  const params = [];
  if (fecha) {
    where.push("date(validado_en) = ?");
    params.push(fecha);
  }
  if (campanaId) {
    where.push("campana_id = ?");
    params.push(campanaId);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totales = db.prepare(`
    SELECT
      COUNT(*)                                                                      AS contratos_saldados,
      COALESCE(SUM(monto_pagado), 0)                                               AS monto_validado,
      COALESCE(SUM(CASE WHEN estado_pago = 'PAGO_EXCEDENTE' THEN 1    ELSE 0 END), 0) AS excedentes_count,
      COALESCE(SUM(CASE WHEN estado_pago = 'PAGO_EXCEDENTE'
                        THEN monto_pagado - valor_en_mora ELSE 0 END), 0)          AS monto_excedente
    FROM validaciones_pago
    ${whereSql}
  `).get(...params);

  const porEmpresa = db.prepare(`
    SELECT empresa,
           COUNT(*) AS total,
           COALESCE(SUM(monto_pagado), 0) AS monto
    FROM validaciones_pago
    ${whereSql}
    GROUP BY empresa
    ORDER BY empresa
  `).all(...params);

  // Mora base: stock actual de cartera (no varía por día). Solo se filtra por campaña si aplica.
  const moraBase = db.prepare(`
    SELECT COALESCE(SUM(
      CAST(NULLIF(TRIM(json_extract(metadata, '$."VALOR EN MORA"')), '') AS REAL)
    ), 0) AS total FROM contactos
    ${campanaId ? 'WHERE campana_id = ?' : ''}
  `).get(...(campanaId ? [campanaId] : []));

  const tasaRecuperacion = moraBase.total > 0
    ? Math.round((totales.monto_validado / moraBase.total) * 10000) / 100
    : 0;

  return {
    contratosSaldados: totales.contratos_saldados || 0,
    montoValidado:     totales.monto_validado     || 0,
    excedentesCount:   totales.excedentes_count   || 0,
    montoExcedente:    totales.monto_excedente     || 0,
    moraBase:          moraBase.total              || 0,
    tasaRecuperacion,
    porEmpresa,
  };
}

/**
 * setOrdenMarcacionBatch — reordena la cola de marcación de un asesor.
 * Acepta un array de IDs en el orden deseado y asigna orden_marcacion = 1..N.
 * Valida que TODOS los contactos pertenezcan al asesorId (anti-reasignación
 * cruzada). Atómico en transacción — si un id no matchea, aborta todo.
 *
 * @param {number} asesorId
 * @param {number[]} contactoIdsEnOrden — IDs en el orden deseado
 * @returns {{ actualizados: number }}
 */
function setOrdenMarcacionBatch(asesorId, contactoIdsEnOrden) {
  const db = getDb();
  if (!Array.isArray(contactoIdsEnOrden) || contactoIdsEnOrden.length === 0) {
    return { actualizados: 0 };
  }
  const cols = db.prepare("PRAGMA table_info(contactos)").all().map(c => c.name);
  if (!cols.includes('orden_marcacion')) {
    throw new Error('Migración M-026 no aplicada: columna orden_marcacion no existe');
  }
  // Validar pertenencia
  const placeholders = contactoIdsEnOrden.map(() => '?').join(',');
  const owned = db.prepare(`SELECT id FROM contactos WHERE asignado_a = ? AND id IN (${placeholders})`)
    .all(asesorId, ...contactoIdsEnOrden);
  if (owned.length !== contactoIdsEnOrden.length) {
    throw new Error(`Algunos contactos no pertenecen al asesor ${asesorId} (esperados ${contactoIdsEnOrden.length}, encontrados ${owned.length})`);
  }
  const upd = db.prepare('UPDATE contactos SET orden_marcacion = ? WHERE id = ? AND asignado_a = ?');
  const tx = db.transaction((ids) => {
    let n = 0;
    ids.forEach((id, idx) => {
      const r = upd.run(idx + 1, id, asesorId);
      n += r.changes;
    });
    return n;
  });
  const actualizados = tx(contactoIdsEnOrden);
  return { actualizados };
}

// ═══════════════════════════════════════════════════════════════
// EVOLUCIÓN DE CARTERA
// ═══════════════════════════════════════════════════════════════

function getCarteraAnalisis(opts = {}) {
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(contactos)").all().map(c => c.name);
  const hasFechaAsig = cols.includes('fecha_asignacion');
  const hasYaPago = cols.includes('ya_pago');

  const { fechaAsig = null, desdeD = 0, hastaD = 30, campanaId = null } = opts;
  const fechaWhere = (hasFechaAsig && fechaAsig) ? "AND date(ct.fecha_asignacion) = ?" : "";
  const campanaWhere = campanaId ? "AND ct.campana_id = ?" : "";
  const params = [
    desdeD, hastaD,
    ...(hasFechaAsig && fechaAsig ? [fechaAsig] : []),
    ...(campanaId ? [campanaId] : []),
  ];

  return db.prepare(`
    SELECT
      CASE WHEN EXISTS (SELECT 1 FROM cdrs c WHERE c.contacto_id = ct.id)
           THEN 'REALIZADA' ELSE 'NO REALIZADA' END AS gestion,
      COUNT(ct.id) AS num_clientes,
      COALESCE(SUM(
        CAST(NULLIF(TRIM(json_extract(ct.metadata, '$."VALOR EN MORA"')), '') AS REAL)
      ), 0) AS valor_cobrar,
      COALESCE(SUM(CASE WHEN ${hasYaPago ? 'ct.ya_pago' : '0'} = 1 THEN
        CAST(NULLIF(TRIM(json_extract(ct.metadata, '$."VALOR EN MORA"')), '') AS REAL)
      ELSE 0 END), 0) AS suma_pago
    FROM contactos ct
    WHERE COALESCE(CAST(NULLIF(TRIM(json_extract(ct.metadata, '$."DIAS IMPAGO"')), '') AS INTEGER), 0)
          BETWEEN ? AND ?
    ${fechaWhere}
    ${campanaWhere}
    GROUP BY gestion
    ORDER BY gestion
  `).all(...params);
}

function getGestionesAsesores(opts = {}) {
  const db = getDb();
  const { desde = null, hasta = null, campanaId = null } = opts;
  const hoy = new Date().toISOString().slice(0, 10);
  const d = desde || hoy;
  const h = hasta || desde || hoy;

  const campanaJoin = campanaId ? "AND ct2.campana_id = ?" : "";
  const params = campanaId ? [d, h, campanaId] : [d, h];

  const rows = db.prepare(`
    SELECT
      u.id     AS asesor_id,
      u.nombre,
      (
        SELECT COUNT(DISTINCT c2.contacto_id)
        FROM cdrs c2
        JOIN contactos ct2 ON ct2.id = c2.contacto_id AND ct2.asignado_a = u.id
        WHERE date(c2.timestamp_inicio) BETWEEN ? AND ?
        ${campanaJoin}
      ) AS gestiones
    FROM usuarios u
    WHERE u.rol = 'asesor' AND u.estado = 'activo'
    ORDER BY u.nombre
  `).all(...params);

  const periodo = (desde && hasta && desde !== hasta) ? `${desde}|${hasta}` : d;
  const metas = db.prepare(`
    SELECT asesor_id, valor_recaudado, meta_diaria, meta_semanal, meta_mensual
    FROM metas_asesores
    WHERE periodo = ?
  `).all(periodo);
  const metasMap = Object.fromEntries(metas.map(m => [m.asesor_id, m]));

  return rows.map(r => ({
    ...r,
    periodo,
    valor_recaudado: metasMap[r.asesor_id]?.valor_recaudado ?? 0,
    meta_diaria:     metasMap[r.asesor_id]?.meta_diaria     ?? 0,
    meta_semanal:    metasMap[r.asesor_id]?.meta_semanal    ?? 0,
    meta_mensual:    metasMap[r.asesor_id]?.meta_mensual    ?? 0,
  }));
}

function upsertMetaAsesor({ asesorId, periodo, campo, valor }) {
  const db = getDb();
  const allowed = ['valor_recaudado', 'meta_diaria', 'meta_semanal', 'meta_mensual'];
  if (!allowed.includes(campo)) throw new Error(`Campo inválido: ${campo}`);
  db.prepare(`
    INSERT INTO metas_asesores (asesor_id, periodo, ${campo})
    VALUES (?, ?, ?)
    ON CONFLICT(asesor_id, periodo) DO UPDATE SET ${campo} = excluded.${campo}
  `).run(asesorId, periodo, valor);
  return { ok: true };
}

function getCarteraRefinanciada(opts = {}) {
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(contactos)").all().map(c => c.name);
  const hasFechaAsig = cols.includes('fecha_asignacion');

  const { fechaAsig = null, campanaId = null, campoRef = 'CONTRATO REFINANCIADO' } = opts;
  const safeField = String(campoRef || 'CONTRATO REFINANCIADO').replace(/[^a-zA-Z0-9 _\-ÁáÉéÍíÓóÚúÑñÀàÄäËëÏïÖöÜü]/g, '').trim() || 'CONTRATO REFINANCIADO';

  const fechaWhere   = (hasFechaAsig && fechaAsig) ? "AND date(ct.fecha_asignacion) = ?" : "";
  const campanaWhere = campanaId ? "AND ct.campana_id = ?" : "";
  const baseParams   = [
    ...(hasFechaAsig && fechaAsig ? [fechaAsig] : []),
    ...(campanaId ? [campanaId] : []),
  ];

  const refinWhere = `
    WHERE LOWER(TRIM(COALESCE(json_extract(ct.metadata, '$."${safeField}"'), '')))
          NOT IN ('', 'no', '0', 'false')
    ${fechaWhere}
    ${campanaWhere}
  `;

  const resumen = db.prepare(`
    SELECT
      COUNT(ct.id) AS total_clientes,
      COALESCE(SUM(CAST(NULLIF(TRIM(json_extract(ct.metadata, '$."VALOR EN MORA"')), '') AS REAL)), 0) AS total_mora,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM cdrs c WHERE c.contacto_id = ct.id) THEN 1 ELSE 0 END) AS gestionados,
      SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM cdrs c WHERE c.contacto_id = ct.id) THEN 1 ELSE 0 END) AS no_gestionados
    FROM contactos ct
    ${refinWhere}
  `).get(...baseParams) || { total_clientes: 0, total_mora: 0, gestionados: 0, no_gestionados: 0 };

  const clientes = db.prepare(`
    SELECT
      ct.id,
      ct.nombre_deudor,
      ct.cedula,
      ct.telefono,
      COALESCE(u.nombre, '—')                                                                         AS asesor,
      COALESCE(CAST(NULLIF(TRIM(json_extract(ct.metadata, '$."VALOR EN MORA"')), '') AS REAL), 0)    AS valor_mora,
      COALESCE(CAST(NULLIF(TRIM(json_extract(ct.metadata, '$."DIAS IMPAGO"')), '') AS INTEGER), 0)   AS dias_impago,
      COALESCE(json_extract(ct.metadata, '$."EMPRESA"'), '')                                          AS empresa,
      ${hasFechaAsig ? "date(ct.fecha_asignacion)" : "NULL"}                                          AS fecha_asignacion,
      CASE WHEN EXISTS (SELECT 1 FROM cdrs c WHERE c.contacto_id = ct.id) THEN 1 ELSE 0 END          AS gestionado
    FROM contactos ct
    LEFT JOIN usuarios u ON u.id = ct.asignado_a
    ${refinWhere}
    ORDER BY u.nombre ASC, ct.nombre_deudor ASC
  `).all(...baseParams);

  return { resumen, clientes };
}

function getMetadataKeys(opts = {}) {
  const db = getDb();
  const { campanaId = null } = opts;
  try {
    const rows = db.prepare(
      `SELECT metadata FROM contactos ${campanaId ? 'WHERE campana_id = ?' : ''} LIMIT 30`
    ).all(...(campanaId ? [campanaId] : []));
    const keys = new Set();
    rows.forEach(r => {
      try { Object.keys(JSON.parse(r.metadata || '{}')).forEach(k => keys.add(k)); } catch (_) {}
    });
    return [...keys].sort();
  } catch (_) { return []; }
}

function insertMensajeBroadcast(supervisor_id, mensaje, segmento_destino) {
  const db = getDb();
  try {
    const segmento = segmento_destino || 'TODOS';
    
    // Inactivar mensajes anteriores para el mismo segmento (reemplazo en tiempo real)
    db.prepare(`
      UPDATE mensajes_broadcast 
      SET activo = 0 
      WHERE segmento_destino = ? AND activo = 1
    `).run(segmento);

    const stmt = db.prepare(`
      INSERT INTO mensajes_broadcast (supervisor_id, mensaje, segmento_destino, activo)
      VALUES (?, ?, ?, 1)
    `);
    const info = stmt.run(supervisor_id, mensaje, segmento);
    return { success: true, id: info.lastInsertRowid };
  } catch (err) {
    console.error('Error insertMensajeBroadcast:', err);
    throw err;
  }
}

function deleteMensajeBroadcast(id) {
  const db = getDb();
  try {
    db.prepare(`UPDATE mensajes_broadcast SET activo = 0 WHERE id = ?`).run(id);
    return { success: true };
  } catch (err) {
    console.error('Error deleteMensajeBroadcast:', err);
    return { success: false, error: err.message };
  }
}

function getMensajesBroadcast() {
  const db = getDb();
  try {
    const stmt = db.prepare(`
      SELECT m.*, u.nombre as supervisor_nombre,
        (
          SELECT COUNT(DISTINCT co.id)
          FROM validaciones_pago vp
          JOIN contactos co ON co.cedula = vp.cedula
          WHERE co.estado_marcacion IN ('PAGADO', 'PAGADO_PARCIAL', 'PAGADO_LOTE')
            AND vp.ultima_fecha >= m.creado_en
            AND (
              m.segmento_destino = 'TODOS'
              OR (m.segmento_destino = 'TRAMO_0' AND (co.metadata LIKE '%"DIAS IMPAGO": "0"%' OR co.metadata LIKE '%"DIAS IMPAGO": 0%'))
              OR (m.segmento_destino = 'TRAMO_1' AND CAST(json_extract(co.metadata, '$."DIAS IMPAGO"') AS INTEGER) BETWEEN 1 AND 30)
              OR (m.segmento_destino = 'TRAMO_2' AND CAST(json_extract(co.metadata, '$."DIAS IMPAGO"') AS INTEGER) BETWEEN 31 AND 60)
              OR (m.segmento_destino = 'PLAZO' AND CAST(json_extract(co.metadata, '$."DIAS IMPAGO"') AS INTEGER) > 60)
              OR (m.segmento_destino = 'MENSUALES' AND co.metadata LIKE '%"TIPO CAMPANA": "MENSUAL"%')
              OR (m.segmento_destino = 'QUINCENALES' AND co.metadata LIKE '%"TIPO CAMPANA": "QUINCENAL"%')
              OR (m.segmento_destino NOT IN ('TODOS','TRAMO_0','TRAMO_1','TRAMO_2','PLAZO','MENSUALES','QUINCENALES'))
            )
        ) as pagos_posteriores
      FROM mensajes_broadcast m
      JOIN usuarios u ON m.supervisor_id = u.id
      ORDER BY m.creado_en DESC
      LIMIT 100
    `);
    return stmt.all();
  } catch (err) {
    console.error('Error getMensajesBroadcast:', err);
    return [];
  }
}

function getSegmentosConfig() {
  const db = getDb();
  try {
    return db.prepare(`SELECT clave as key, etiqueta as label, color, icono as icon, 'transparent' as gradient FROM segmentos_config ORDER BY id ASC`).all();
  } catch (err) {
    console.error('Error getSegmentosConfig:', err);
    return [];
  }
}

function insertSegmentoConfig(clave, etiqueta, color) {
  const db = getDb();
  try {
    db.prepare(`INSERT INTO segmentos_config (clave, etiqueta, color) VALUES (?, ?, ?)`).run(clave, etiqueta, color);
    return { success: true };
  } catch (err) {
    console.error('Error insertSegmentoConfig:', err);
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// RANKINGS DE ASESORES
// ═══════════════════════════════════════════════════════════════

function getGestoresRanking() {
  return [];
}

function getRankingLlamadas(fecha) {
  return { totalEquipo: 0, asesores: [], debugError: null };
}

function getRankingGeneralAsesores(fecha) {
  const db = getDb();
  const f = fecha || _todayLocalISO();

  // 1. Asesores activos
  const asesores = db.prepare("SELECT id, nombre FROM usuarios WHERE rol = 'asesor' AND estado = 'activo' ORDER BY nombre").all();

  const getSegmento = (metaStr) => {
    try {
      if (!metaStr) return '0';
      const m = JSON.parse(metaStr);
      const val = m['DIAS IMPAGO'] || m['DIAS EN INPAGO'] || m['DIAS MORA'] || m['dias_impago'] || m['dias_mora'] || 0;
      const d = parseInt(val, 10);
      if (isNaN(d)) return '0';
      if (d === 0) return '0';
      if (d === 1) return '1';
      return '2'; // 2 o más
    } catch { return '0'; }
  };

  const ranking = asesores.map(a => ({
    id: a.id,
    nombre: a.nombre,
    canales: {
      whatsapp: { global: 0, '0': 0, '1': 0, '2': 0 },
      rcs:      { global: 0, '0': 0, '1': 0, '2': 0 },
      gmail:    { global: 0, '0': 0, '1': 0, '2': 0 },
      llamada:  { global: 0, '0': 0, '1': 0, '2': 0 }
    }
  }));

  const rankingMap = {};
  ranking.forEach(r => rankingMap[r.id] = r);

  try {
    // 3. Contar CDRs (llamadas)
    const cdrs = db.prepare(`
      SELECT c.usuario_id, ct.metadata
      FROM cdrs c
      LEFT JOIN contactos ct ON c.contacto_id = ct.id
      WHERE date(c.timestamp_inicio) = ? OR date(c.creado_en) = ?
    `).all(f, f);

    for (const cdr of cdrs) {
      if (rankingMap[cdr.usuario_id]) {
        const seg = getSegmento(cdr.metadata);
        rankingMap[cdr.usuario_id].canales.llamada.global += 1;
        if (['0', '1', '2'].includes(seg)) {
          rankingMap[cdr.usuario_id].canales.llamada[seg] += 1;
        }
      }
    }

    // 4. Contar Eventos ACCION_RAPIDA
    const eventos = db.prepare(`
      SELECT e.usuario_id, e.metadata, ct.metadata as contacto_metadata
      FROM eventos e
      LEFT JOIN contactos ct ON CAST(json_extract(e.metadata, '$.contacto_id') AS INTEGER) = ct.id
      WHERE e.tipo = 'ACCION_RAPIDA' AND date(e.timestamp) = ?
    `).all(f);

    for (const ev of eventos) {
      if (rankingMap[ev.usuario_id]) {
        try {
          const meta = ev.metadata ? JSON.parse(ev.metadata) : {};
          let canalStr = meta.canal || '';
          
          let tab = null;
          if (canalStr === 'WSP') tab = 'whatsapp';
          else if (canalStr === 'SMS') tab = 'rcs';
          else if (canalStr === 'EMAIL') tab = 'gmail';

          if (tab) {
            const seg = getSegmento(ev.contacto_metadata);
            rankingMap[ev.usuario_id].canales[tab].global += 1;
            if (['0', '1', '2'].includes(seg)) {
              rankingMap[ev.usuario_id].canales[tab][seg] += 1;
            }
          }
        } catch(e) {}
      }
    }
  } catch(e) {
    console.error('Error en getRankingGeneralAsesores:', e);
  }

  return ranking;
}


// ═══════════════════════════════════════════════════════════════
// PANEL JEFE DE COBRANZA — Queries de KPIs y Métricas
// Spec: Todas las fórmulas siguen el documento spec_panel_jefe.md
// Regla: COALESCE en toda división para prevenir NaN/Infinity/null
// Extracción de segmento y distribuidor via json_extract(metadata)
// ═══════════════════════════════════════════════════════════════

/**
 * Construye cláusula WHERE dinámica según filtros opcionales.
 * @param {object} filtros - { fechaInicio, fechaFin, segmento, distribuidor, campanaId }
 * @returns {{ where: string, params: any[] }}
 */
function _buildFiltros(filtros = {}) {
  const conditions = [];
  const params = [];

  if (filtros.campanaId) {
    conditions.push('c.campana_id = ?');
    params.push(filtros.campanaId);
  }
  if (filtros.segmento !== undefined && filtros.segmento !== null && filtros.segmento !== 'todos') {
    conditions.push("CAST(json_extract(c.metadata, '$.segmento') AS TEXT) = ?");
    params.push(String(filtros.segmento));
  }
  if (filtros.distribuidor) {
    conditions.push("json_extract(c.metadata, '$.distribuidor') = ?");
    params.push(filtros.distribuidor);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  return { where, params };
}

/**
 * Indicadores monetarios y por unidades, globales y desglosados por segmento.
 * Spec §2.1 y §2.2
 * @param {object} filtros - { campanaId, segmento, distribuidor }
 * @returns {{ global: object, porSegmento: object[] }}
 */
function getIndicadoresCobranza(filtros = {}) {
  const db = getDb();
  const { where, params } = _buildFiltros(filtros);

  // ── Consolidado global ──────────────────────────────────────────
  const globalRow = db.prepare(`
    SELECT
      COALESCE(SUM(c.monto_deuda), 0)                                         AS valor_vencido,
      COALESCE(SUM(CASE WHEN c.estado_marcacion = 'PAGADO' THEN c.monto_deuda ELSE 0 END), 0) AS valor_cobrado,
      COUNT(c.id)                                                               AS unidades_vencidas,
      COUNT(CASE WHEN c.estado_marcacion = 'PAGADO' THEN 1 END)               AS unidades_cobradas
    FROM contactos c
    ${where}
  `).get(...params);

  const gVencido   = globalRow.valor_vencido   ?? 0;
  const gCobrado   = globalRow.valor_cobrado   ?? 0;
  const gUVen      = globalRow.unidades_vencidas ?? 0;
  const gUCob      = globalRow.unidades_cobradas ?? 0;

  const global = {
    valor_vencido:          gVencido,
    valor_cobrado:          gCobrado,
    diferencia_monetaria:   gVencido - gCobrado,
    pct_recuperacion:       gVencido > 0 ? Math.round((gCobrado / gVencido) * 10000) / 100 : 0,
    unidades_vencidas:      gUVen,
    unidades_cobradas:      gUCob,
    diferencia_unidades:    gUVen - gUCob,
    pct_recuperacion_und:   gUVen > 0 ? Math.round((gUCob / gUVen) * 10000) / 100 : 0,
  };

  // ── Desglose por segmento (0, 1, 2 y Sin asignar) ──────────────
  const segExpr = `CASE
    WHEN CAST(COALESCE(
      NULLIF(json_extract(c.metadata, '$."DIAS IMPAGO"'), ''),
      NULLIF(json_extract(c.metadata, '$."dias impago"'), ''),
      NULLIF(json_extract(c.metadata, '$."DIAS EN INPAGO"'), ''),
      NULLIF(json_extract(c.metadata, '$."dias en inpago"'), ''),
      NULLIF(json_extract(c.metadata, '$."DIAS MORA"'), ''),
      NULLIF(json_extract(c.metadata, '$."dias mora"'), ''),
      '0'
    ) AS INTEGER) <= 0 THEN '0'
    WHEN CAST(COALESCE(
      NULLIF(json_extract(c.metadata, '$."DIAS IMPAGO"'), ''),
      NULLIF(json_extract(c.metadata, '$."dias impago"'), ''),
      NULLIF(json_extract(c.metadata, '$."DIAS EN INPAGO"'), ''),
      NULLIF(json_extract(c.metadata, '$."dias en inpago"'), ''),
      NULLIF(json_extract(c.metadata, '$."DIAS MORA"'), ''),
      NULLIF(json_extract(c.metadata, '$."dias mora"'), ''),
      '0'
    ) AS INTEGER) = 1 THEN '1'
    ELSE '2'
  END`;

  const segRows = db.prepare(`
    SELECT
      ${segExpr} AS segmento,
      COALESCE(SUM(c.monto_deuda), 0)                                                AS valor_vencido,
      COALESCE(SUM(CASE WHEN c.estado_marcacion = 'PAGADO' THEN c.monto_deuda ELSE 0 END), 0) AS valor_cobrado,
      COUNT(c.id)                                                                     AS unidades_vencidas,
      COUNT(CASE WHEN c.estado_marcacion = 'PAGADO' THEN 1 END)                     AS unidades_cobradas,
      SUM(
        (SELECT COUNT(*) FROM cdrs cd 
         JOIN tipificaciones t ON cd.tipificacion_id = t.id 
         WHERE cd.contacto_id = c.id 
           AND t.codigo IN ('PMP', 'PAGO_REAL', 'AB_PARC', 'PEND_COMP') 
           AND (cd.resultado IS NULL OR cd.resultado != 'INCUMP')
        )
      ) AS total_promesas
    FROM contactos c
    ${where}
    GROUP BY segmento
    ORDER BY segmento
  `).all(...params);

  const porSegmento = segRows.map(r => {
    const vencido = r.valor_vencido ?? 0;
    const cobrado = r.valor_cobrado ?? 0;
    const uVen    = r.unidades_vencidas ?? 0;
    const uCob    = r.unidades_cobradas ?? 0;
    const promesas = r.total_promesas ?? 0;
    return {
      segmento:              r.segmento,
      valor_vencido:         vencido,
      valor_cobrado:         cobrado,
      diferencia_monetaria:  vencido - cobrado,
      pct_recuperacion:      vencido > 0 ? Math.round((cobrado / vencido) * 10000) / 100 : 0,
      unidades_vencidas:     uVen,
      unidades_cobradas:     uCob,
      diferencia_unidades:   uVen - uCob,
      pct_recuperacion_und:  uVen > 0 ? Math.round((uCob / uVen) * 10000) / 100 : 0,
      promesas:              promesas,
    };
  });

  return { global, porSegmento };
}

/**
 * Productividad: gestiones por canal, avance de cartera y cobertura única.
 * Spec §2.3
 * @param {object} filtros - { campanaId, fechaInicio, fechaFin }
 */
function getProductividadJefe(filtros = {}) {
  const db = getDb();
  const params = [];
  const cdrConditions = ['1=1'];

  if (filtros.campanaId) {
    cdrConditions.push('co.campana_id = ?');
    params.push(filtros.campanaId);
  }
  if (filtros.fechaInicio) {
    cdrConditions.push("DATE(cd.creado_en) >= ?");
    params.push(filtros.fechaInicio);
  }
  if (filtros.fechaFin) {
    cdrConditions.push("DATE(cd.creado_en) <= ?");
    params.push(filtros.fechaFin);
  }

  const cdrWhere = cdrConditions.join(' AND ');

  // Gestiones por canal (CDRs)
  const gestionesCanalRows = db.prepare(`
    SELECT
      COALESCE(cd.canal, 'llamada') AS canal,
      COUNT(cd.id)                  AS total
    FROM cdrs cd
    JOIN contactos co ON co.id = cd.contacto_id
    WHERE ${cdrWhere}
    GROUP BY canal
  `).all(...params);

  // Compromisos vigentes (agendamientos PMP pendientes)
  const compromisos = db.prepare(`
    SELECT COUNT(id) AS total FROM agendamientos WHERE estado = 'pendiente'
  `).get();

  // Cartera total (base de comparación)
  const carteraFiltros = filtros.campanaId ? { campanaId: filtros.campanaId } : {};
  const { global: indicadores } = getIndicadoresCobranza(carteraFiltros);
  const carteraTotal = indicadores.unidades_vencidas;

  // Reducir a objeto canal→total
  const canales = { llamada: 0, whatsapp: 0, correo: 0, rcs: 0, sms: 0 };
  for (const row of gestionesCanalRows) {
    const key = (row.canal || 'llamada').toLowerCase();
    canales[key] = row.total;
  }

  const gestionesTotales = Object.values(canales).reduce((a, b) => a + b, 0) + (compromisos?.total ?? 0);
  const avanceCartera    = carteraTotal > 0 ? Math.round((gestionesTotales / carteraTotal) * 10000) / 100 : 0;

  // Cobertura única: contactos con al menos 1 CDR vs total
  const contactadosUnicos = db.prepare(`
    SELECT COUNT(DISTINCT cd.contacto_id) AS total
    FROM cdrs cd
    JOIN contactos co ON co.id = cd.contacto_id
    WHERE ${cdrWhere}
  `).get(...params);

  const cobertura = carteraTotal > 0
    ? Math.round(((contactadosUnicos?.total ?? 0) / carteraTotal) * 10000) / 100
    : 0;

  return {
    canales,
    compromisos:        compromisos?.total ?? 0,
    gestiones_totales:  gestionesTotales,
    cartera_total:      carteraTotal,
    avance_cartera:     avanceCartera,
    contactados_unicos: contactadosUnicos?.total ?? 0,
    cobertura,
  };
}

/**
 * Top N asesores por canal o por valor recuperado.
 * Spec §2 (Rankings)
 * @param {'llamada'|'whatsapp'|'correo'|'rcs'|'global'} canal
 * @param {number} limit - default 5
 */
function getTopAsesoresJefe(canal = 'global', limit = 5) {
  const db = getDb();

  if (canal === 'global') {
    const segExpr = `CASE
      WHEN CAST(COALESCE(
        NULLIF(json_extract(co.metadata, '$."DIAS IMPAGO"'), ''),
        NULLIF(json_extract(co.metadata, '$."dias impago"'), ''),
        NULLIF(json_extract(co.metadata, '$."DIAS EN INPAGO"'), ''),
        NULLIF(json_extract(co.metadata, '$."dias en inpago"'), ''),
        NULLIF(json_extract(co.metadata, '$."DIAS MORA"'), ''),
        NULLIF(json_extract(co.metadata, '$."dias mora"'), ''),
        '0'
      ) AS INTEGER) <= 0 THEN '0'
      WHEN CAST(COALESCE(
        NULLIF(json_extract(co.metadata, '$."DIAS IMPAGO"'), ''),
        NULLIF(json_extract(co.metadata, '$."dias impago"'), ''),
        NULLIF(json_extract(co.metadata, '$."DIAS EN INPAGO"'), ''),
        NULLIF(json_extract(co.metadata, '$."dias en inpago"'), ''),
        NULLIF(json_extract(co.metadata, '$."DIAS MORA"'), ''),
        NULLIF(json_extract(co.metadata, '$."dias mora"'), ''),
        '0'
      ) AS INTEGER) = 1 THEN '1'
      ELSE '2'
    END`;

    const rows = db.prepare(`
      SELECT 
        u.id, 
        u.nombre AS asesor,
        ${segExpr} AS segmento,
        COUNT(cd.id) AS gestiones,
        SUM(CASE WHEN t.codigo = 'PMP' THEN 1 ELSE 0 END) AS promesas,
        SUM(CASE WHEN t.codigo IN ('PAGO_REAL', 'AB_PARC', 'COMP_CUM') THEN 1 ELSE 0 END) AS cumplidas,
        SUM(CASE WHEN cd.resultado = 'INCUMP' THEN 1 ELSE 0 END) AS vencidas
      FROM usuarios u
      LEFT JOIN cdrs cd ON u.id = cd.usuario_id
      LEFT JOIN contactos co ON co.id = cd.contacto_id
      LEFT JOIN tipificaciones t ON t.id = cd.tipificacion_id
      WHERE u.rol = 'asesor'
      GROUP BY u.id, segmento
    `).all();

    const asesoresMap = {};
    for (const r of rows) {
      if (!asesoresMap[r.id]) {
         asesoresMap[r.id] = {
           asesor: r.asesor,
           total_gestiones: 0,
           segmentos: {
             '0': { gestiones: 0, promesas: 0, cumplidas: 0, vencidas: 0 },
             '1': { gestiones: 0, promesas: 0, cumplidas: 0, vencidas: 0 },
             '2': { gestiones: 0, promesas: 0, cumplidas: 0, vencidas: 0 }
           }
         };
      }
      // If the LEFT JOIN found nothing, it still returns one row with gestiones=0 and a default segment (usually '0')
      // We only map it if there are actual gestiones or we just map it anyway, it will be 0.
      const s = r.segmento || '0';
      if (asesoresMap[r.id].segmentos[s]) {
         asesoresMap[r.id].segmentos[s].gestiones += (r.gestiones || 0);
         asesoresMap[r.id].segmentos[s].promesas += (r.promesas || 0);
         asesoresMap[r.id].segmentos[s].cumplidas += (r.cumplidas || 0);
         asesoresMap[r.id].segmentos[s].vencidas += (r.vencidas || 0);
         asesoresMap[r.id].total_gestiones += (r.gestiones || 0);
      }
    }
    
    return Object.values(asesoresMap)
      .sort((a, b) => b.total_gestiones - a.total_gestiones)
      .slice(0, limit);
  }

  // Ranking por gestiones en un canal específico
  return db.prepare(`
    SELECT
      u.id,
      u.nombre,
      COUNT(cd.id) AS gestiones
    FROM cdrs cd
    JOIN usuarios u ON u.id = cd.usuario_id
    WHERE u.rol = 'asesor' AND LOWER(COALESCE(cd.canal, 'llamada')) = LOWER(?)
    GROUP BY u.id
    ORDER BY gestiones DESC
    LIMIT ?
  `).all(canal, limit);
}

/**
 * Morosidad agrupada por distribuidor.
 * Spec §2.4
 * Morosos = contactos con estado_marcacion NOT IN ('PAGADO','PAGADO_PARCIAL')
 */
function getMorosidadPorDistribuidor() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      COALESCE(json_extract(c.metadata, '$.distribuidor'), 'Sin asignar') AS distribuidor,
      COUNT(c.id)                                                           AS total_entregados,
      COUNT(CASE WHEN c.estado_marcacion NOT IN ('PAGADO','PAGADO_PARCIAL','PAGADO_LOTE') THEN 1 END) AS total_morosos
    FROM contactos c
    GROUP BY distribuidor
    ORDER BY total_morosos DESC
  `).all();

  return rows.map(r => ({
    distribuidor:    r.distribuidor,
    total_entregados: r.total_entregados,
    total_morosos:   r.total_morosos,
    pct_morosidad:   r.total_entregados > 0
      ? Math.round((r.total_morosos / r.total_entregados) * 10000) / 100
      : 0,
  }));
}

/**
 * Recaudación diaria de los últimos N días.
 * Spec §2.4 — Indicadores Semanales
 * @param {number} dias - default 7
 */
function getRecaudacionSemanal(dias = 7) {
  const db = getDb();
  // Usamos CDRs con resultado de pago. Si existe monto_pagado lo usamos,
  // si no, usamos monto_deuda del contacto cuando está marcado PAGADO.
  const rows = db.prepare(`
    SELECT
      DATE(cd.creado_en)                                AS fecha,
      COUNT(DISTINCT co.id)                              AS num_pagos,
      COALESCE(SUM(co.monto_deuda), 0)                  AS valor_cobrado
    FROM cdrs cd
    JOIN contactos co ON co.id = cd.contacto_id
    WHERE co.estado_marcacion = 'PAGADO'
      AND DATE(cd.creado_en) >= DATE('now', ?)
    GROUP BY fecha
    ORDER BY fecha ASC
  `).all(`-${dias} days`);

  return rows;
}

/**
 * Proyección mensual: meta vs cobrado acumulado en el mes en curso.
 * Spec §2.4
 */
function getProyeccionMensual() {
  const db = getDb();

  // Meta mensual desde tabla config (clave: meta_mensual_usd)
  const metaRow = db.prepare("SELECT valor FROM config WHERE clave = 'meta_mensual_usd'").get();
  const metaMensual = metaRow ? parseFloat(metaRow.valor) || 0 : 0;

  // Cobrado acumulado en el mes en curso
  const cobradoRow = db.prepare(`
    SELECT
      COALESCE(SUM(co.monto_deuda), 0)  AS cobrado_mes,
      COUNT(DISTINCT co.id)              AS pagos_mes
    FROM cdrs cd
    JOIN contactos co ON co.id = cd.contacto_id
    WHERE co.estado_marcacion = 'PAGADO'
      AND strftime('%Y-%m', cd.creado_en) = strftime('%Y-%m', 'now')
  `).get();

  const cobradoMes = cobradoRow?.cobrado_mes ?? 0;
  const pagosMes   = cobradoRow?.pagos_mes   ?? 0;
  const diferencia = metaMensual - cobradoMes;
  const pctCumplimiento = metaMensual > 0
    ? Math.round((cobradoMes / metaMensual) * 10000) / 100
    : 0;

  return {
    meta_mensual:     metaMensual,
    cobrado_mes:      cobradoMes,
    pagos_mes:        pagosMes,
    diferencia:       diferencia,
    pct_cumplimiento: pctCumplimiento,
  };
}

// ── Indicadores de Recaudo (Dinámicos) ──────────────────────
function getIndicadoresRecaudo(asesorId, mes, anio) {
  const db = getDb();
  if (!asesorId || !mes || !anio) return { '0': {}, '1': {}, '2': {} };
  const likeDate = `${anio}-${String(mes).padStart(2, '0')}-%`;
  
  const rows = db.prepare(`
    SELECT segmento, fecha, valores
    FROM indicadores_datos
    WHERE asesor_id = ? AND fecha LIKE ?
  `).all(asesorId, likeDate);

  const result = { '0': {}, '1': {}, '2': {} };
  for (const row of rows) {
    if (!result[row.segmento]) result[row.segmento] = {};
    try {
      result[row.segmento][row.fecha] = JSON.parse(row.valores);
    } catch(e) {
      result[row.segmento][row.fecha] = {};
    }
  }
  return result;
}

function saveIndicadoresRecaudo(asesorId, datosArray) {
  const db = getDb();
  if (!asesorId || !Array.isArray(datosArray)) return;

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO indicadores_datos (asesor_id, fecha, segmento, valores)
    VALUES (?, ?, ?, ?)
  `);

  const tx = db.transaction((items) => {
    for (const item of items) {
      if (!item.fecha || !item.segmento) continue;
      stmt.run(asesorId, item.fecha, item.segmento, JSON.stringify(item.valores || {}));
    }
  });

  tx(datosArray);
}

module.exports = {
  // Auth
  findUserByEmail, findUserById,
  // Usuarios
  getAsesores, getSupervisorIdDeAsesor, getAllUsuarios, insertUsuario, insertAsesor, updateAsesor, deleteAsesor, anonymizeAsesor,
  // Admin: gestión completa de usuarios
  getAllUsuariosAdmin, updateUsuarioAdmin, toggleUsuarioEstado, changePasswordAdmin,
  // Campañas
  getCampanas, getCampanasPorAsesor, getCampanaById, getContactoById, getSiguienteContacto, insertCampana, insertContactos,
  getCampaignSummary, getCampanasDashboard, deleteCampana, deleteContactosPorAsesorEnCampana,
  getMetaDiariaCampanas, setMetaDiariaCampana,
  // CDRs
  insertCdr, updateCdr, marcarContactoGestionado, marcarYaPagoDeclarado, eliminarCompromiso, confirmarPagoCompromiso, reagendarCompromiso, marcarCompromisoIncumplido, incrementarIntentoContacto, resetearIntentosContacto, getCdrsByUsuario, getSubGestionesByAsesor, getSubGestionesByContacto, buscarContactoPorCedula, getAllReferencias, getCdrsByContacto, insertSubGestion, getAllCdrs, getCdrsGestiones, getBitacoraAsesor, getRefsBitacora, getCarteraAsesor, getCarteraEquipo, setOrdenMarcacionBatch,
  // Tipificaciones
  getTipificaciones, getTipificacionById, actualizarEstadoContacto,
  // Contactabilidad (M-004)
  getContactabilidadDia,
  // Agendamientos (M-006)
  insertAgendamiento, getAgendamientosPorAsesor, getAgendamientosPendientes,
  marcarAgendamientoEjecutado, cancelarAgendamiento,
  // Sesiones
  iniciarSesion, cerrarSesion,
  // Eventos
  insertEvento, getEventosDia,
  // Validación de Pagos
  correlacionarPagos, confirmarPagos, getMetricasValidacion, getHistorialValidaciones, revertirValidacion,
  getSesionesValidacion, eliminarSesion,
  // Métricas
  getMetricasDia, getMetricasEquipo, getCompromisosEquipo, getProgresoAsesor, getDetalleContactabilidad, getPagosVerificadosPorAsesor,
  // Config
  getConfig, setConfig, getAllConfig,
  // Progreso
  getProgresoCampana,
  getRotacionCarteraPeriodo,
  // Evolución de Cartera
  getCarteraAnalisis, getCarteraRefinanciada, getMetadataKeys,
  getGestionesAsesores, upsertMetaAsesor,
  // Rankings
  getGestoresRanking, getRankingLlamadas, getRankingGeneralAsesores,
  // Mensajes Broadcast
  insertMensajeBroadcast, deleteMensajeBroadcast, getMensajesBroadcast,
  // ── Panel Jefe de Cobranza (Spec §2) ──
  getIndicadoresCobranza,
  getProductividadJefe,
  getTopAsesoresJefe,
  getMorosidadPorDistribuidor,
  getRecaudacionSemanal,
  getProyeccionMensual,
  toggleContactoMensajeria,
  getLoteMensajeria,
  marcarLoteEnviado,
  getIndicadoresRecaudo,
  saveIndicadoresRecaudo,
  // Segmentos
  getSegmentosConfig,
  insertSegmentoConfig
};

