import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';

// El backend es CommonJS; el resto de la app es ESM.
const require = createRequire(import.meta.url);
const { cacheado, cacheGET, invalidar, purgar } = require('../../backend/src/utils/cache.js');

// Claves unicas por test: el cache es un singleton de modulo y persiste entre casos.
let n = 0;
const k = (s) => `${s}:${++n}`;

describe('cache de dashboards', () => {
  let ejecuciones;

  beforeEach(() => { ejecuciones = 0; });

  const lento = (ms = 30, valor = 'v1') =>
    () => new Promise((r) => setTimeout(() => { ejecuciones++; r(valor); }, ms));

  it('coalesce requests concurrentes en una sola ejecucion', async () => {
    // El caso real: 6 supervisores refrescando el mismo panel dentro de la misma
    // ventana de polling. Sin esto, 6 queries identicas sobre 151k contactos.
    const clave = k('panel');
    const fn = lento();
    const res = await Promise.all(Array.from({ length: 6 }, () => cacheado(clave, 1000, fn)));

    expect(ejecuciones).toBe(1);
    expect(res).toEqual(Array(6).fill('v1'));
  });

  it('no recalcula dentro del TTL y si recalcula al vencer', async () => {
    const clave = k('ttl');
    const fn = lento(1);

    await cacheado(clave, 1000, fn);
    await cacheado(clave, 1000, fn);
    expect(ejecuciones).toBe(1);

    await cacheado(clave, 0, fn); // TTL vencido
    expect(ejecuciones).toBe(2);
  });

  it('no cachea un rechazo: el siguiente intento reintenta', async () => {
    // Cachear un error dejaria el panel roto durante todo el TTL.
    const clave = k('falla');
    let intentos = 0;
    const falla = async () => { intentos++; throw new Error('boom'); };

    await expect(cacheado(clave, 10_000, falla)).rejects.toThrow('boom');
    await expect(cacheado(clave, 10_000, falla)).rejects.toThrow('boom');
    expect(intentos).toBe(2);

    // Y un exito posterior si se cachea con normalidad.
    await cacheado(clave, 10_000, async () => 'ok');
    await expect(cacheado(clave, 10_000, async () => 'no-deberia-correr')).resolves.toBe('ok');
  });

  it('invalidar(prefijo) fuerza el recalculo', async () => {
    const clave = 'equipo:99';
    await cacheado(clave, 10_000, async () => [1, 2, 3]);
    invalidar('equipo:');

    let recalculo = false;
    await cacheado(clave, 10_000, async () => { recalculo = true; return [9]; });
    expect(recalculo).toBe(true);
  });

  it('purgar elimina entradas vencidas', async () => {
    // Sin purga, las claves con fecha/campana quedan residentes para siempre.
    const clave = k('viejo');
    await cacheado(clave, 10_000, async () => 'x');
    purgar(0);

    let repuesto = false;
    await cacheado(clave, 10_000, async () => { repuesto = true; return 'y'; });
    expect(repuesto).toBe(true);
  });
});

describe('cacheGET (middleware de dashboards)', () => {
  const mkReq = (userId, url, method = 'GET') => ({ method, originalUrl: url, user: { id: userId } });

  const mkRes = () => ({
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(h, v) { this.headers[h] = v; },
    json(b) { this.body = b; return this; },
  });

  // Simula el paso por el middleware y, si llega al handler, lo ejecuta.
  const pasar = (mw, req, res, handler) => {
    mw(req, res, () => handler && handler(req, res));
    return res;
  };

  it('sirve el segundo GET del mismo usuario sin ejecutar el handler', async () => {
    const mw = cacheGET(10_000);
    const url = '/jefe/indicadores?fecha=2026-08-04';
    let ejecuciones = 0;
    const handler = (_q, r) => { ejecuciones++; r.json({ total: 42 }); };

    const r1 = pasar(mw, mkReq(7, url), mkRes(), handler);
    const r2 = pasar(mw, mkReq(7, url), mkRes(), handler);

    expect(ejecuciones).toBe(1);
    expect(r1.headers['X-Cache']).toBe('MISS');
    expect(r2.headers['X-Cache']).toBe('HIT');
    expect(r2.body).toEqual({ total: 42 });
  });

  it('aisla por usuario: otro supervisor no recibe el agregado del primero', async () => {
    // El riesgo real de una clave mal armada: ver los datos del equipo de otro.
    const mw = cacheGET(10_000);
    const url = '/cartera-equipo';

    pasar(mw, mkReq(1, url), mkRes(), (_q, r) => r.json({ equipo: 'uno' }));
    const otro = pasar(mw, mkReq(2, url), mkRes(), (_q, r) => r.json({ equipo: 'dos' }));

    expect(otro.headers['X-Cache']).toBe('MISS');
    expect(otro.body).toEqual({ equipo: 'dos' });
  });

  it('distingue por query string: otra fecha es otra entrada', async () => {
    const mw = cacheGET(10_000);
    pasar(mw, mkReq(9, '/jefe/productividad?fecha=2026-08-03'), mkRes(), (_q, r) => r.json({ d: 3 }));
    const otra = pasar(mw, mkReq(9, '/jefe/productividad?fecha=2026-08-04'), mkRes(), (_q, r) => r.json({ d: 4 }));

    expect(otra.headers['X-Cache']).toBe('MISS');
    expect(otra.body).toEqual({ d: 4 });
  });

  it('no cachea respuestas que no son 2xx', async () => {
    // Un 500 cacheado dejaria el panel roto durante todo el TTL.
    const mw = cacheGET(10_000);
    const url = '/jefe/morosidad';
    let ejecuciones = 0;
    const handlerError = (_q, r) => { ejecuciones++; r.statusCode = 500; r.json({ error: 'boom' }); };

    pasar(mw, mkReq(4, url), mkRes(), handlerError);
    pasar(mw, mkReq(4, url), mkRes(), handlerError);

    expect(ejecuciones).toBe(2);
  });

  it('recalcula cuando vence el TTL', async () => {
    const mw = cacheGET(0);
    const url = '/jefe/tendencia-semanal';
    let ejecuciones = 0;
    const handler = (_q, r) => { ejecuciones++; r.json({ n: ejecuciones }); };

    pasar(mw, mkReq(5, url), mkRes(), handler);
    pasar(mw, mkReq(5, url), mkRes(), handler);

    expect(ejecuciones).toBe(2);
  });

  it('deja pasar los metodos que no son GET', async () => {
    const mw = cacheGET(10_000);
    let ejecuciones = 0;
    const handler = (_q, r) => { ejecuciones++; r.json({ ok: true }); };

    pasar(mw, mkReq(6, '/cartera-equipo', 'POST'), mkRes(), handler);
    const segundo = pasar(mw, mkReq(6, '/cartera-equipo', 'POST'), mkRes(), handler);

    expect(ejecuciones).toBe(2);
    expect(segundo.headers['X-Cache']).toBeUndefined();
  });
});
