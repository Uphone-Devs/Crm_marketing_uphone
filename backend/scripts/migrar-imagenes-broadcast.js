/**
 * migrar-imagenes-broadcast.js — Saca las imágenes base64 de mensajes_broadcast
 * a archivos bajo public/uploads/ y deja la URL pública en `imagen_url`.
 *
 * Por qué: la columna guarda data URIs (185 MB contra 276 kB de texto) y
 * GET /api/mensajes-broadcast los devolvía enteros a cada asesor diez veces por
 * minuto — 28 MB/s por el túnel, el event loop bloqueado serializando, y de ahí
 * las transacciones que expiran y los WebSocket que se caen.
 *
 * USO:
 *   node backend/scripts/migrar-imagenes-broadcast.js            ← simula, no escribe
 *   node backend/scripts/migrar-imagenes-broadcast.js --aplicar  ← escribe
 *
 * Seguro de reejecutar: el nombre de archivo es determinista sobre (id,
 * contenido) y las filas ya migradas se saltan. Antes de tocar nada vuelca la
 * columna a un .sql de respaldo con el que se puede revertir fila por fila.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env'), override: true });

const fs   = require('fs');
const path = require('path');
const db   = require('../src/config/db');
const { esDataUri, parsearDataUri, nombreArchivo, urlPublica } = require('../src/infra/imagenDataUri');

const APLICAR = process.argv.includes('--aplicar');
const DIR_DESTINO = path.join(__dirname, '../public/uploads');
const DIR_RESPALDO = path.join(__dirname, '../backups');
const MB = 1024 * 1024;

main().catch((err) => { console.error('\n✖', err.message); process.exit(1); });

async function main() {
  const base = process.env.PUBLIC_URL;
  if (!base) throw new Error('PUBLIC_URL no está definida en backend/.env — hace falta para armar la URL absoluta');

  console.log(APLICAR ? '▶ MODO APLICAR — se escribe en disco y en la base' : '▶ MODO SIMULACIÓN — no se escribe nada');
  console.log(`  base pública: ${base}`);
  console.log(`  destino:      ${DIR_DESTINO}\n`);

  const filas = await db.$queryRaw`SELECT id, imagen_url FROM mensajes_broadcast WHERE imagen_url IS NOT NULL ORDER BY id`;

  const plan = planificar(filas, base);
  informar(plan);

  if (!plan.migrables.length) return void console.log('\nNada que migrar.');
  if (!APLICAR) return void console.log('\nSimulación terminada. Reejecutá con --aplicar para escribir.');

  await respaldar(filas);
  await escribirArchivos(plan.migrables);
  await actualizarFilas(plan.migrables);

  console.log('\n✔ Migración completa.');
}

/** Clasifica sin tocar nada: qué se migra, qué ya está migrado, qué no se pudo leer. */
function planificar(filas, base) {
  const migrables = [];
  const yaMigradas = [];
  const problemas = [];

  for (const fila of filas) {
    const id = Number(fila.id);
    const valor = fila.imagen_url;

    if (!esDataUri(valor)) { yaMigradas.push(id); continue; }
    try {
      const archivo = nombreArchivo(id, valor);
      const { bytes } = parsearDataUri(valor);
      migrables.push({ id, archivo, bytes, url: urlPublica(base, archivo), pesoOriginal: valor.length });
    } catch (err) {
      problemas.push({ id, motivo: err.message });
    }
  }
  return { migrables, yaMigradas, problemas };
}

function informar({ migrables, yaMigradas, problemas }) {
  const ahorro = migrables.reduce((s, m) => s + m.pesoOriginal, 0);
  const enDisco = migrables.reduce((s, m) => s + m.bytes.length, 0);

  console.log(`  a migrar:     ${migrables.length} filas`);
  console.log(`  ya migradas:  ${yaMigradas.length} filas`);
  console.log(`  con problema: ${problemas.length} filas`);
  console.log(`  sale de la base: ${(ahorro / MB).toFixed(1)} MB  →  a disco: ${(enDisco / MB).toFixed(1)} MB`);

  for (const p of problemas) console.log(`    ! id=${p.id}: ${p.motivo}`);
  for (const m of migrables.slice(0, 5)) {
    console.log(`    id=${m.id} ${(m.pesoOriginal / MB).toFixed(2)} MB → ${m.archivo}`);
  }
  if (migrables.length > 5) console.log(`    … y ${migrables.length - 5} más`);
}

/** Vuelca la columna a un .sql con UPDATEs que restauran el valor original. */
async function respaldar(filas) {
  fs.mkdirSync(DIR_RESPALDO, { recursive: true });
  const destino = path.join(DIR_RESPALDO, `imagen-url-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.sql`);

  const salida = fs.createWriteStream(destino, { encoding: 'utf8' });
  salida.write('-- Restaura imagen_url tal como estaba antes de migrar-imagenes-broadcast.js\nBEGIN;\n');
  for (const f of filas) {
    const valor = String(f.imagen_url).replace(/'/g, "''");
    salida.write(`UPDATE mensajes_broadcast SET imagen_url = '${valor}' WHERE id = ${Number(f.id)};\n`);
  }
  salida.write('COMMIT;\n');
  await new Promise((res, rej) => { salida.end(); salida.on('finish', res); salida.on('error', rej); });

  const mb = (fs.statSync(destino).size / MB).toFixed(1);
  console.log(`\n  respaldo: ${destino} (${mb} MB)`);
}

function escribirArchivos(migrables) {
  fs.mkdirSync(DIR_DESTINO, { recursive: true });
  let escritos = 0;
  for (const m of migrables) {
    const destino = path.join(DIR_DESTINO, m.archivo);
    if (!fs.existsSync(destino)) { fs.writeFileSync(destino, m.bytes); escritos++; }
  }
  console.log(`  archivos escritos: ${escritos} (${migrables.length - escritos} ya estaban)`);
}

/** De a una y por id: si algo falla a mitad, lo hecho queda consistente. */
async function actualizarFilas(migrables) {
  let n = 0;
  for (const m of migrables) {
    await db.$executeRaw`UPDATE mensajes_broadcast SET imagen_url = ${m.url} WHERE id = ${m.id}`;
    n++;
    if (n % 100 === 0) console.log(`  filas actualizadas: ${n}/${migrables.length}`);
  }
  console.log(`  filas actualizadas: ${n}/${migrables.length}`);
}
