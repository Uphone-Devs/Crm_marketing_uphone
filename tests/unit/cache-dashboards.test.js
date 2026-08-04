import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';

// El backend es CommonJS; el resto de la app es ESM.
const require = createRequire(import.meta.url);
const { cacheado, invalidar, purgar } = require('../../backend/src/utils/cache.js');

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
