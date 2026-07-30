/**
 * backfill-metricas-diarias.js — Reconstruye metricas_diarias_asesor desde cdrs.
 *
 * La tabla metricas_diarias_asesor (migracion 20260729000001) nace vacia: el
 * upsert incremental en PATCH /api/cdrs/:id (cdrs.routes.js) solo suma hacia
 * adelante desde que se despliegue. Sin este backfill, /jefe/tendencia-semanal
 * (que lee "dias cerrados" de esta tabla) muestra $0 en los ultimos 6 dias
 * hasta que se acumulen datos nuevos.
 *
 * Replica EXACTAMENTE la misma logica de categorizacion que el upsert en vivo
 * (mismos codigos/categorias de tipificacion, mismos campos), agregada sobre
 * TODO el historico de una sola vez. Idempotente: ON CONFLICT sobrescribe con
 * el valor recalculado (no suma sobre lo existente), asi que se puede correr
 * mas de una vez sin duplicar.
 *
 * Uso: node backend/scripts/backfill-metricas-diarias.js
 */

require('dotenv').config();
const prisma = require('../src/config/db');

async function main() {
  console.log('Recalculando metricas_diarias_asesor desde cdrs...');

  const result = await prisma.$executeRaw`
    INSERT INTO metricas_diarias_asesor
      (asesor_id, fecha, gestiones, efectivos, neutros, no_contact, compromisos, monto_acordado, tiempo_aire_seg, actualizado_en)
    SELECT
      cd.usuario_id AS asesor_id,
      cd.timestamp_inicio::date::text AS fecha,
      COUNT(*)::int AS gestiones,
      COUNT(*) FILTER (WHERE t.categoria IN ('CONTACTO_EFECTIVO', 'CONTACTO EXITOSO'))::int AS efectivos,
      COUNT(*) FILTER (WHERE t.categoria IN ('CONTACTO_NEUTRO', 'CONTACTO NEUTRO'))::int AS neutros,
      COUNT(*) FILTER (WHERE t.categoria IN ('NO_CONTACTADO', 'NO CONTACTADO'))::int AS no_contact,
      COUNT(*) FILTER (WHERE t.codigo IN ('PMP', 'PAGO_REAL', 'AB_PARC', 'PEND_COMP'))::int AS compromisos,
      COALESCE(SUM(cd.monto_acordado), 0)::float AS monto_acordado,
      COALESCE(SUM(cd.duracion_seg), 0)::int AS tiempo_aire_seg,
      NOW() AS actualizado_en
    FROM cdrs cd
    LEFT JOIN tipificaciones t ON t.id = cd.tipificacion_id
    WHERE cd.tipificacion_id IS NOT NULL
    GROUP BY cd.usuario_id, cd.timestamp_inicio::date
    ON CONFLICT (asesor_id, fecha) DO UPDATE SET
      gestiones       = EXCLUDED.gestiones,
      efectivos       = EXCLUDED.efectivos,
      neutros         = EXCLUDED.neutros,
      no_contact      = EXCLUDED.no_contact,
      compromisos     = EXCLUDED.compromisos,
      monto_acordado  = EXCLUDED.monto_acordado,
      tiempo_aire_seg = EXCLUDED.tiempo_aire_seg,
      actualizado_en  = NOW()
  `;

  console.log(`Listo — ${result} filas asesor+dia insertadas/actualizadas.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Error en backfill:', err);
  await prisma.$disconnect();
  process.exit(1);
});
