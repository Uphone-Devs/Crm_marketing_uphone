/**
 * tests/unit/actividad-tipificacion-cache.test.js
 *
 * GET /api/actividad-tipificacion alimenta el panel "Actividad Gestores",
 * que se refetchea por cada evento WS TIPIFICACION_REALIZADA (debounce 2s)
 * de cualquier asesor del equipo, con varios supervisores viendo el mismo
 * equipo a la vez. Sin cache, cada refetch dispara ~7 queries pesadas
 * (raw SQL con subqueries EXISTS) contra el pool de PostgreSQL (max 30
 * conexiones) — bajo carga agota el pool, Prisma revienta en connect-timeout
 * y el proceso cae (mismo patrón ya corregido en /metricas-equipo y
 * /metricas-asesores-bulk, commits 7481bac y c192ae2 — ver backend/src/routes/
 * supervisor.routes.js, que sigue exactamente este shape: ck → cache.get →
 * si hit, responder; si no, calcular → cache.set(ck, data, 30_000)).
 *
 * supervisor.routes.js no puede requerirse aquí sin una DATABASE_URL real
 * (aborta el proceso al importar backend/src/config/db.js — falla intencional
 * de arranque). Por eso esta prueba ejerce el módulo de cache real (el mismo
 * que ya usan los 9 endpoints cacheados de ese router) contra el shape exacto
 * que se añade al handler, sin reimplementar la query pesada.
 */
const express = require('express');
const request = require('supertest');
const cache = require('../../backend/src/utils/cache');

function mountActividadTipificacion(app, computeHeavyQuery) {
  app.get('/api/actividad-tipificacion', async (req, res) => {
    const ck = `actividad-tipif:${req.query.uid}:${req.query.fecha || 'hoy'}:${req.query.campanaId || ''}`;
    const hit = cache.get(ck);
    if (hit) return res.json(hit);
    const data = await computeHeavyQuery();
    cache.set(ck, data, 30_000);
    res.json(data);
  });
}

describe('GET /api/actividad-tipificacion — cache anti pool-exhaustion', () => {
  beforeEach(() => cache.clear());

  it('reutiliza el resultado en la segunda llamada dentro del TTL — no repite la query pesada', async () => {
    const heavyQuery = vi.fn().mockResolvedValue({ asesores: ['fake'] });
    const app = express();
    mountActividadTipificacion(app, heavyQuery);

    const r1 = await request(app).get('/api/actividad-tipificacion?uid=1&fecha=2026-09-17');
    expect(r1.status).toBe(200);

    const r2 = await request(app).get('/api/actividad-tipificacion?uid=1&fecha=2026-09-17');
    expect(r2.status).toBe(200);

    // Sin cache este contador sería 2 — cada refetch WS golpea el pool de nuevo.
    expect(heavyQuery).toHaveBeenCalledTimes(1);
    expect(r2.body).toEqual(r1.body);
  });

  it('no comparte cache entre supervisores distintos (aislamiento de equipo)', async () => {
    const heavyQuery = vi.fn().mockResolvedValue({ asesores: ['fake'] });
    const app = express();
    mountActividadTipificacion(app, heavyQuery);

    await request(app).get('/api/actividad-tipificacion?uid=1&fecha=2026-09-17');
    await request(app).get('/api/actividad-tipificacion?uid=2&fecha=2026-09-17');

    expect(heavyQuery).toHaveBeenCalledTimes(2);
  });
});
