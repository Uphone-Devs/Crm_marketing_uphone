/**
 * tests/unit/poolMetrics.test.js
 *
 * El error `Unable to start a transaction in the given time` tiene dos causas
 * posibles que producen el mismo mensaje: el pool llegó a su techo, o el event
 * loop se bloqueó más que el `maxWait` de 2000 ms aunque hubiera conexiones
 * libres. `pg_stat_activity` no las distingue porque no sabe qué conexión está
 * tomada por el pool. El `Pool` de `pg` sí: `waitingCount > 0` significa que
 * hay requests en cola esperando conexión.
 *
 * Este módulo es la lectura de esos contadores. Puro a propósito: no importa
 * `pg` ni Prisma, recibe el pool como argumento.
 */
const {
  snapshotPool, formatearSnapshot, SIN_DATOS, esMaxWaitVencido, veredicto,
} = require('../../backend/src/infra/poolMetrics');

const poolFalso = ({ total = 0, libres = 0, esperando = 0, max = 30 }) => ({
  totalCount: total,
  idleCount: libres,
  waitingCount: esperando,
  options: { max },
});

describe('snapshotPool', () => {
  it('mapea los contadores del pool', () => {
    expect(snapshotPool(poolFalso({ total: 27, libres: 26, esperando: 0 }))).toEqual({
      total: 27, libres: 26, esperando: 0, max: 30, saturado: false, medible: true,
    });
  });

  it('marca saturado cuando hay requests en cola — la prueba decisiva', () => {
    expect(snapshotPool(poolFalso({ total: 30, libres: 0, esperando: 4 })).saturado).toBe(true);
  });

  it('marca saturado cuando el total llegó al techo aunque nadie espere todavía', () => {
    expect(snapshotPool(poolFalso({ total: 30, libres: 0, esperando: 0 })).saturado).toBe(true);
  });

  it('no marca saturado con el pool holgado', () => {
    expect(snapshotPool(poolFalso({ total: 9, libres: 8, esperando: 0 })).saturado).toBe(false);
  });

  it('devuelve el caso especial SIN_DATOS si no hay pool, en vez de null', () => {
    expect(snapshotPool(undefined)).toBe(SIN_DATOS);
    expect(SIN_DATOS.medible).toBe(false);
    expect(SIN_DATOS.saturado).toBe(false);
  });

  it('devuelve SIN_DATOS si el objeto no expone los contadores', () => {
    expect(snapshotPool({ options: { max: 30 } })).toBe(SIN_DATOS);
  });

  it('no revienta con un pool sin options', () => {
    const snap = snapshotPool({ totalCount: 5, idleCount: 5, waitingCount: 0 });
    expect(snap.medible).toBe(true);
    expect(snap.saturado).toBe(false);
  });
});

describe('esMaxWaitVencido', () => {
  it('reconoce el P2028 de Prisma', () => {
    expect(esMaxWaitVencido({ code: 'P2028' })).toBe(true);
  });

  it('reconoce el mensaje aunque no venga el código', () => {
    expect(esMaxWaitVencido({ message: 'Transaction API error: Unable to start a transaction in the given time.' })).toBe(true);
  });

  it('no confunde otros fallos de Prisma', () => {
    expect(esMaxWaitVencido({ code: 'P2025', message: 'Record to update not found.' })).toBe(false);
  });

  it('tolera un error vacío o sin forma', () => {
    expect(esMaxWaitVencido(undefined)).toBe(false);
    expect(esMaxWaitVencido({})).toBe(false);
  });
});

describe('veredicto', () => {
  it('con requests en cola culpa al pool', () => {
    expect(veredicto(snapshotPool(poolFalso({ total: 30, libres: 0, esperando: 3 })))).toBe('POOL_EN_COLA');
  });

  it('sin cola y con conexiones libres culpa al event loop', () => {
    expect(veredicto(snapshotPool(poolFalso({ total: 12, libres: 11, esperando: 0 })))).toBe('EVENT_LOOP');
  });

  it('no afirma nada si no pudo medir', () => {
    expect(veredicto(SIN_DATOS)).toBe('INDETERMINADO');
  });
});

describe('formatearSnapshot', () => {
  it('rinde los tres números que hacen falta para diagnosticar', () => {
    const texto = formatearSnapshot(snapshotPool(poolFalso({ total: 30, libres: 0, esperando: 4 })));
    expect(texto).toContain('30/30');
    expect(texto).toContain('libres=0');
    expect(texto).toContain('esperando=4');
  });

  it('dice explícitamente que no hay datos en vez de imprimir ceros engañosos', () => {
    expect(formatearSnapshot(SIN_DATOS)).toMatch(/sin datos/i);
  });
});
