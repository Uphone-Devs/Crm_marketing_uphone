/**
 * tests/unit/traficoRutas.test.js
 *
 * El backend empuja ~28 MB/s sostenidos por el túnel y no hay forma de saber
 * qué ruta los genera: no existe logging de peticiones. Esto acumula bytes por
 * ruta y saca un top cada minuto, en vez de una línea por request (que con este
 * volumen inundaría el log y empeoraría el problema que se está midiendo).
 *
 * Puro: no conoce Express. El middleware lo cablea aparte.
 */
const {
  normalizarRuta, crearAcumulador, MAX_RUTAS,
} = require('../../backend/src/infra/traficoRutas');

describe('normalizarRuta', () => {
  it('colapsa los ids numéricos para que la clave no se multiplique', () => {
    expect(normalizarRuta('/api/cdrs/48211/tipificar')).toBe('/api/cdrs/:id/tipificar');
    expect(normalizarRuta('/api/contactos/7')).toBe('/api/contactos/:id');
  });

  it('deja las rutas sin ids tal cual', () => {
    expect(normalizarRuta('/api/cartera-equipo/resumen')).toBe('/api/cartera-equipo/resumen');
  });

  it('descarta la query string, que no aporta a la atribución', () => {
    expect(normalizarRuta('/api/cdrs?usuarioId=31&limit=50')).toBe('/api/cdrs');
  });

  it('no revienta con una ruta vacía o ausente', () => {
    expect(normalizarRuta('')).toBe('/');
    expect(normalizarRuta(undefined)).toBe('/');
  });
});

describe('acumulador', () => {
  it('suma peticiones y bytes por clave', () => {
    const acc = crearAcumulador();
    acc.registrar('GET', '/api/cartera-equipo', 5_000_000);
    acc.registrar('GET', '/api/cartera-equipo', 3_000_000);
    acc.registrar('GET', '/api/cdrs/9/tipificar', 500);

    const top = acc.top(5);
    expect(top[0]).toEqual({ clave: 'GET /api/cartera-equipo', peticiones: 2, bytes: 8_000_000 });
    expect(top[1].peticiones).toBe(1);
  });

  it('ordena por bytes, no por cantidad de peticiones', () => {
    const acc = crearAcumulador();
    for (let i = 0; i < 100; i++) acc.registrar('GET', '/api/chico', 10);
    acc.registrar('GET', '/api/grande', 9_000_000);

    expect(acc.top(2)[0].clave).toBe('GET /api/grande');
  });

  it('ignora bytes no numéricos en vez de ensuciar el total con NaN', () => {
    const acc = crearAcumulador();
    acc.registrar('GET', '/api/x', undefined);
    acc.registrar('GET', '/api/x', 100);
    expect(acc.top(1)[0]).toEqual({ clave: 'GET /api/x', peticiones: 2, bytes: 100 });
  });

  it('vaciar deja el acumulador en cero', () => {
    const acc = crearAcumulador();
    acc.registrar('GET', '/api/x', 100);
    acc.vaciar();
    expect(acc.top(5)).toEqual([]);
  });

  it('devuelve lista vacía cuando no hubo tráfico, nunca null', () => {
    expect(crearAcumulador().top(5)).toEqual([]);
  });

  it('acota la cantidad de claves para no crecer sin límite', () => {
    const acc = crearAcumulador();
    for (let i = 0; i < MAX_RUTAS + 50; i++) acc.registrar('GET', `/api/ruta-${i}`, 1);
    expect(acc.tamano()).toBeLessThanOrEqual(MAX_RUTAS);
  });

  it('aunque esté lleno sigue sumando a las claves que ya conoce', () => {
    const acc = crearAcumulador();
    acc.registrar('GET', '/api/importante', 1000);
    for (let i = 0; i < MAX_RUTAS + 50; i++) acc.registrar('GET', `/api/relleno-${i}`, 1);
    acc.registrar('GET', '/api/importante', 1000);

    const fila = acc.top(MAX_RUTAS).find(f => f.clave === 'GET /api/importante');
    expect(fila.bytes).toBe(2000);
  });
});
