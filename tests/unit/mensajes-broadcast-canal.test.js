/**
 * tests/unit/mensajes-broadcast-canal.test.js
 *
 * Valida la lógica de selección de mensaje broadcast por canal + segmento.
 * Replica getMensajeParaContacto de AsesorPanel.jsx — sin DOM ni React.
 */

// ── Réplica de la función a implementar ──────────────────────────────────────

function getMensajeParaContacto(contacto, diasMoraVal, canal = 'TODOS', mensajesBroadcast = []) {
  const dias = parseInt(diasMoraVal, 10) || 0;
  const segmento = dias === 0 ? 'TRAMO_0' : dias === 1 ? 'TRAMO_1' : 'TRAMO_2';
  if (!mensajesBroadcast.length) return '';
  const activos = mensajesBroadcast.filter(m => m.activo === 1 || m.activo === true);
  const match =
    activos.find(m => m.segmento_destino === segmento  && m.canal === canal)   ||
    activos.find(m => m.segmento_destino === segmento  && m.canal === 'TODOS') ||
    activos.find(m => m.segmento_destino === 'TODOS'   && m.canal === canal)   ||
    activos.find(m => m.segmento_destino === 'TODOS'   && m.canal === 'TODOS');
  if (!match) return '';
  return match.mensaje
    .replace(/\{nombre\}/gi, contacto.nombre_deudor || '')
    .replace(/\{deuda\}/gi,  contacto.monto_deuda   || '')
    .replace(/\{cedula\}/gi, contacto.cedula         || '')
    .replace(/\{dias\}/gi,   String(dias))
    .replace(/\{telefono\}/gi, contacto.telefono     || '');
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const contacto = {
  nombre_deudor: 'Juan Pérez',
  monto_deuda:   '500',
  cedula:        '0912345678',
  telefono:      '0991234567',
};

function msg(segmento_destino, canal, texto = 'TEXTO') {
  return { id: Math.random(), mensaje: texto, segmento_destino, canal, activo: 1 };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('getMensajeParaContacto — prioridad canal + segmento', () => {

  test('sin mensajes → cadena vacía', () => {
    expect(getMensajeParaContacto(contacto, 0, 'WSP', [])).toBe('');
  });

  test('match exacto canal + segmento gana sobre todo', () => {
    const lista = [
      msg('TRAMO_0', 'TODOS', 'GENERAL'),
      msg('TRAMO_0', 'WSP',   'EXACTO'),
      msg('TODOS',   'WSP',   'CANAL_GENERAL'),
    ];
    expect(getMensajeParaContacto(contacto, 0, 'WSP', lista)).toBe('EXACTO');
  });

  test('nivel 2: segmento exacto + canal TODOS cuando no hay exacto', () => {
    const lista = [
      msg('TRAMO_0', 'TODOS',  'SEG_GENERAL'),
      msg('TODOS',   'WSP',    'CANAL_GENERAL'),
    ];
    expect(getMensajeParaContacto(contacto, 0, 'WSP', lista)).toBe('SEG_GENERAL');
  });

  test('nivel 3: TODOS segmento + canal exacto', () => {
    const lista = [
      msg('TODOS', 'WSP',    'CANAL_WSP'),
      msg('TODOS', 'CORREO', 'CANAL_CORREO'),
    ];
    expect(getMensajeParaContacto(contacto, 0, 'WSP', lista)).toBe('CANAL_WSP');
  });

  test('nivel 4: TODOS + TODOS como último fallback', () => {
    const lista = [msg('TODOS', 'TODOS', 'GLOBAL')];
    expect(getMensajeParaContacto(contacto, 0, 'WSP', lista)).toBe('GLOBAL');
  });

  test('TRAMO_1 (1 día mora) usa segmento TRAMO_1', () => {
    const lista = [
      msg('TRAMO_0', 'WSP', 'TRAMO0_MSG'),
      msg('TRAMO_1', 'WSP', 'TRAMO1_MSG'),
    ];
    expect(getMensajeParaContacto(contacto, 1, 'WSP', lista)).toBe('TRAMO1_MSG');
  });

  test('TRAMO_2 (2+ días mora)', () => {
    const lista = [msg('TRAMO_2', 'RCS', 'TRAMO2_RCS')];
    expect(getMensajeParaContacto(contacto, 5, 'RCS', lista)).toBe('TRAMO2_RCS');
  });

  test('interpolación de variables en mensaje', () => {
    const lista = [msg('TODOS', 'TODOS', 'Hola {nombre}, debe ${deuda} en {dias} días. Tel: {telefono}')];
    const resultado = getMensajeParaContacto(contacto, 2, 'WSP', lista);
    expect(resultado).toBe('Hola Juan Pérez, debe $500 en 2 días. Tel: 0991234567');
  });

  test('mensajes inactivos (activo=0) ignorados', () => {
    const lista = [
      { id: 1, mensaje: 'INACTIVO', segmento_destino: 'TRAMO_0', canal: 'WSP', activo: 0 },
      msg('TODOS', 'TODOS', 'FALLBACK'),
    ];
    expect(getMensajeParaContacto(contacto, 0, 'WSP', lista)).toBe('FALLBACK');
  });

  test('sin match para canal específico y sin fallback → cadena vacía', () => {
    const lista = [msg('TRAMO_0', 'RCS', 'SOLO_RCS')];
    expect(getMensajeParaContacto(contacto, 0, 'WSP', lista)).toBe('');
  });
});
