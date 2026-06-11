/**
 * tests/unit/queries-evolucion-cartera.test.js
 *
 * Prueba las queries REALES de evolución de cartera (src/main/database/queries.js)
 * contra una BD temporal con schema + migraciones reales (helper realDb).
 *
 * Por qué BD real: la copia inline anterior divergía del código de producción
 *   - getCarteraAnalisis real envuelve DIAS IMPAGO en COALESCE(...,0) → NULL cuenta como 0.
 *   - getCarteraRefinanciada real filtra el campo 'CONTRATO REFINANCIADO' (no 'REFINANCIADO'),
 *     excluye 'no'/'0'/'false' y retorna { resumen, clientes }.
 *
 * PRIME DIRECTIVE v2.1 — F.I.R.S.T.
 */

const { setupRealDb, HASH } = require('../helpers/realDb');
const { getCarteraAnalisis, getCarteraRefinanciada } = require('../../src/main/database/queries');

/** Inserta un contacto con metadata JSON. Devuelve su id. */
function insertContacto(d, { telefono, nombre, cedula, estado, intentos, metadata, fecha, yaPago = 0 }) {
  const r = d.prepare(`
    INSERT INTO contactos
      (campana_id, telefono, nombre_deudor, cedula, estado_marcacion, intentos_realizados, metadata, fecha_asignacion, ya_pago)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(telefono, nombre, cedula, estado, intentos, JSON.stringify(metadata), fecha, yaPago);
  return Number(r.lastInsertRowid);
}

function seedFixture(d) {
  d.prepare("INSERT INTO usuarios (nombre,email,password_hash,rol) VALUES ('Super','sup@t.com',?,'supervisor')").run(HASH);
  d.prepare("INSERT INTO campanas (nombre,supervisor_id,estado,fecha_inicio) VALUES ('C1',1,'activa','2026-01-01')").run();

  // 1: 20 días, sin CDR, sin pago, 2026-05-10
  insertContacto(d, { telefono: '001', nombre: 'Juan', cedula: '001', estado: 'PENDIENTE', intentos: 0,
    metadata: { 'DIAS IMPAGO': '20', 'VALOR EN MORA': '100.00' }, fecha: '2026-05-10' });
  // 2: 20 días, CON CDR, CON pago, 2026-05-10
  insertContacto(d, { telefono: '002', nombre: 'Pedro', cedula: '002', estado: 'GESTIONADO', intentos: 1,
    metadata: { 'DIAS IMPAGO': '20', 'VALOR EN MORA': '200.00' }, fecha: '2026-05-10', yaPago: 1 });
  // 3: 40 días, sin CDR, 2026-05-15 (fuera de rango 0-30)
  insertContacto(d, { telefono: '003', nombre: 'Maria', cedula: '003', estado: 'PENDIENTE', intentos: 0,
    metadata: { 'DIAS IMPAGO': '40', 'VALOR EN MORA': '300.00' }, fecha: '2026-05-15' });
  // 4: 10 días, refinanciado, 2026-05-10
  insertContacto(d, { telefono: '004', nombre: 'Ana', cedula: '004', estado: 'PENDIENTE', intentos: 0,
    metadata: { 'DIAS IMPAGO': '10', 'VALOR EN MORA': '50.00', 'CONTRATO REFINANCIADO': 'SI' }, fecha: '2026-05-10' });
  // 5: 5 días, refinanciado, 2026-05-20
  insertContacto(d, { telefono: '005', nombre: 'Luis', cedula: '005', estado: 'PENDIENTE', intentos: 0,
    metadata: { 'DIAS IMPAGO': '5', 'VALOR EN MORA': '80.00', 'CONTRATO REFINANCIADO': 'SI' }, fecha: '2026-05-20' });

  // CDR para contacto 2 (Pedro) → única gestión REALIZADA
  d.prepare("INSERT INTO cdrs (contacto_id,usuario_id,timestamp_inicio) VALUES (2,1,'2026-05-10T10:00:00')").run();
}

const harness = setupRealDb({ name: 'evol-cartera', seed: seedFixture });

// ═══════════════════════════════════════════════════════════
// getCarteraAnalisis (query REAL)
// ═══════════════════════════════════════════════════════════
describe('getCarteraAnalisis', () => {
  it('sin filtros agrupa contactos de 0-30 días por gestión', () => {
    const rows = getCarteraAnalisis();
    // En rango 0-30: 1(20),2(20),4(10),5(5). Excluido 3 (40 días).
    // CDR solo en 2 → REALIZADA=1; sin CDR → NO REALIZADA = 1,4,5 = 3.
    expect(rows.length).toBe(2);
    const realizada = rows.find(r => r.gestion === 'REALIZADA');
    const noRealizada = rows.find(r => r.gestion === 'NO REALIZADA');
    expect(realizada.num_clientes).toBe(1);
    expect(noRealizada.num_clientes).toBe(3);
  });

  it('rango 16-30 excluye contactos de menos de 16 días', () => {
    const rows = getCarteraAnalisis({ desdeD: 16, hastaD: 30 });
    const total = rows.reduce((s, r) => s + r.num_clientes, 0);
    expect(total).toBe(2); // solo 1 y 2 (20 días)
  });

  it('suma_pago suma solo VALOR EN MORA de contactos con ya_pago=1', () => {
    const rows = getCarteraAnalisis();
    const realizada = rows.find(r => r.gestion === 'REALIZADA');
    expect(realizada.suma_pago).toBe(200); // solo Pedro
  });

  it('filtro fechaAsig restringe por fecha_asignacion', () => {
    const rows = getCarteraAnalisis({ fechaAsig: '2026-05-10' });
    const total = rows.reduce((s, r) => s + r.num_clientes, 0);
    expect(total).toBe(3); // 1,2,4 (5 es 05-20)
  });

  it('COALESCE: un contacto sin DIAS IMPAGO cuenta como 0 días → incluido en 0-30', () => {
    // Comportamiento REAL que la copia inline NO tenía (CAST sin COALESCE → NULL excluido).
    insertContacto(harness.db, { telefono: '006', nombre: 'SinDias', cedula: '006', estado: 'PENDIENTE', intentos: 0,
      metadata: { 'VALOR EN MORA': '10.00' }, fecha: '2026-05-10' });
    const rows = getCarteraAnalisis();
    const noRealizada = rows.find(r => r.gestion === 'NO REALIZADA');
    expect(noRealizada.num_clientes).toBe(4); // 1,4,5 + SinDias(0 días)
  });
});

// ═══════════════════════════════════════════════════════════
// getCarteraRefinanciada (query REAL → { resumen, clientes })
// ═══════════════════════════════════════════════════════════
describe('getCarteraRefinanciada', () => {
  it('sin filtros resume los contactos con CONTRATO REFINANCIADO', () => {
    const { resumen, clientes } = getCarteraRefinanciada();
    expect(resumen.total_clientes).toBe(2); // Ana y Luis
    expect(clientes.length).toBe(2);
  });

  it('con fechaAsig filtra a una sola fecha', () => {
    const { resumen, clientes } = getCarteraRefinanciada({ fechaAsig: '2026-05-10' });
    expect(resumen.total_clientes).toBe(1); // solo Ana
    expect(resumen.total_mora).toBe(50);
    expect(clientes[0].valor_mora).toBe(50);
  });

  it("excluye valores 'no'/'0'/'false' (no solo el vacío)", () => {
    insertContacto(harness.db, { telefono: '007', nombre: 'NoRefin', cedula: '007', estado: 'PENDIENTE', intentos: 0,
      metadata: { 'DIAS IMPAGO': '12', 'VALOR EN MORA': '15.00', 'CONTRATO REFINANCIADO': 'NO' }, fecha: '2026-05-10' });
    const { resumen } = getCarteraRefinanciada();
    expect(resumen.total_clientes).toBe(2); // sigue siendo solo Ana y Luis
  });

  it('contactos sin el campo refinanciado no aparecen', () => {
    const { resumen } = getCarteraRefinanciada();
    expect(resumen.total_clientes).toBe(2); // Juan/Pedro/Maria excluidos
  });
});
