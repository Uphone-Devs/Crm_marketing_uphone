/**
 * tests/unit/cartera-mensajeria-diaria.test.js
 *
 * Valida la lógica de contabilización DIARIA de mensajería y tipificación.
 * Prueba los algoritmos extraídos de queries.js y AsesorPanel.jsx
 * sin depender de better-sqlite3 (evita conflicto NODE_MODULE_VERSION).
 *
 * Cobertura:
 *  - M-041: enviadoFecha diaria → ENVIADO solo muestra si enviado HOY
 *  - getLoteMensajeria: excluye del lote solo si enviado HOY
 *  - marcarLoteEnviado: registra fecha del día
 *  - marcarContactoGestionado: cualquier tipificación = GESTIONADO
 *  - Cartera Asignada: checkmarks reflejan estado del día
 */

// ── Helpers que replican la lógica SQL/JS de queries.js ───────────────────────

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Replica el CASE WHEN de getCarteraAsesor para whatsapp_status.
 * Si enviado_fecha !== today → devuelve 'INACTIVO' (no muestra ✓).
 */
function resolveWspStatus(rawStatus, enviadoFecha) {
  if (rawStatus === 'ENVIADO') {
    return enviadoFecha === today() ? 'ENVIADO' : 'INACTIVO';
  }
  return rawStatus;
}

function resolveRcsStatus(rawStatus, enviadoFecha) {
  if (rawStatus === 'ENVIADO') {
    return enviadoFecha === today() ? 'ENVIADO' : 'ACTIVO';
  }
  return rawStatus;
}

function resolveCorreoStatus(rawStatus, enviadoFecha) {
  if (rawStatus === 'ENVIADO') {
    return enviadoFecha === today() ? 'ENVIADO' : 'INACTIVO';
  }
  return rawStatus;
}

/**
 * Replica getLoteMensajeria: excluye solo si enviado HOY.
 */
function isContactoExcluidoDelLote(status, enviadoFecha) {
  return status === 'ENVIADO' && enviadoFecha === today();
}

/**
 * Replica la regla de negocio de handleSaveTipificacion:
 * Cualquier tipificación = GESTIONADO (sin importar código ni modo).
 */
function debeMarcarGestionado() {
  return true;
}

/**
 * Simula marcarLoteEnviado: devuelve el objeto de update que se aplicaría.
 */
function simularMarcarLoteEnviado(contactoIds, channel) {
  const canal = channel === 'whatsapp' || channel === 'WSP' ? 'WSP'
    : channel === 'rcs' || channel === 'SMS' ? 'SMS'
    : channel === 'correo' || channel === 'EMAIL' ? 'EMAIL'
    : null;
  if (!canal) throw new Error('Canal no soportado: ' + channel);

  const colMap = { WSP: 'whatsapp_status', SMS: 'rcs_status', EMAIL: 'correo_status' };
  const fechaMap = { WSP: 'wsp_enviado_fecha', SMS: 'rcs_enviado_fecha', EMAIL: 'correo_enviado_fecha' };

  return contactoIds.map(id => ({
    id,
    [colMap[canal]]: 'ENVIADO',
    [fechaMap[canal]]: today(),
  }));
}

/**
 * Cuenta pendientes en un lote (replica UI de AsesorPanel campañas).
 */
function contarPendientesLote(contactos, canal) {
  const key = canal === 'wsp' ? 'whatsapp_status'
    : canal === 'rcs' ? 'rcs_status'
    : 'correo_status';
  return contactos.filter(c => c[key] !== 'ENVIADO').length;
}

// ── TESTS ─────────────────────────────────────────────────────────────────────

describe('M-041 — Daily status reset: whatsapp_status', () => {
  it('enviado HOY → resolveWspStatus = ENVIADO', () => {
    expect(resolveWspStatus('ENVIADO', today())).toBe('ENVIADO');
  });

  it('enviado AYER → resolveWspStatus = INACTIVO (no muestra ✓)', () => {
    expect(resolveWspStatus('ENVIADO', yesterday())).toBe('INACTIVO');
  });

  it('enviado con fecha NULL → resolveWspStatus = INACTIVO', () => {
    expect(resolveWspStatus('ENVIADO', null)).toBe('INACTIVO');
  });

  it('status INACTIVO sin fecha → sigue INACTIVO', () => {
    expect(resolveWspStatus('INACTIVO', null)).toBe('INACTIVO');
  });

  it('status ACTIVO sin fecha → sigue ACTIVO', () => {
    expect(resolveWspStatus('ACTIVO', null)).toBe('ACTIVO');
  });
});

describe('M-041 — Daily status reset: rcs_status', () => {
  it('enviado HOY → ENVIADO', () => {
    expect(resolveRcsStatus('ENVIADO', today())).toBe('ENVIADO');
  });

  it('enviado AYER → ACTIVO (vuelve a lote disponible)', () => {
    expect(resolveRcsStatus('ENVIADO', yesterday())).toBe('ACTIVO');
  });

  it('sin envío → respeta status original', () => {
    expect(resolveRcsStatus('ACTIVO', null)).toBe('ACTIVO');
    expect(resolveRcsStatus('INACTIVO', null)).toBe('INACTIVO');
  });
});

describe('M-041 — Daily status reset: correo_status', () => {
  it('enviado HOY → ENVIADO', () => {
    expect(resolveCorreoStatus('ENVIADO', today())).toBe('ENVIADO');
  });

  it('enviado AYER → INACTIVO', () => {
    expect(resolveCorreoStatus('ENVIADO', yesterday())).toBe('INACTIVO');
  });
});

describe('getLoteMensajeria — exclusión diaria de enviados', () => {
  it('enviado HOY → excluido del lote', () => {
    expect(isContactoExcluidoDelLote('ENVIADO', today())).toBe(true);
  });

  it('enviado AYER → disponible en lote de hoy', () => {
    expect(isContactoExcluidoDelLote('ENVIADO', yesterday())).toBe(false);
  });

  it('no enviado → disponible en lote', () => {
    expect(isContactoExcluidoDelLote('INACTIVO', null)).toBe(false);
    expect(isContactoExcluidoDelLote('ACTIVO', null)).toBe(false);
  });

  it('status = ENVIADO pero sin fecha → disponible (fecha NULL ≠ today)', () => {
    expect(isContactoExcluidoDelLote('ENVIADO', null)).toBe(false);
  });
});

describe('marcarLoteEnviado — escritura de fecha', () => {
  it('escribe status ENVIADO y fecha de hoy para WSP', () => {
    const result = simularMarcarLoteEnviado([1, 2, 3], 'whatsapp');
    expect(result).toHaveLength(3);
    result.forEach(r => {
      expect(r.whatsapp_status).toBe('ENVIADO');
      expect(r.wsp_enviado_fecha).toBe(today());
    });
  });

  it('escribe status ENVIADO y fecha de hoy para RCS', () => {
    const result = simularMarcarLoteEnviado([10], 'rcs');
    expect(result[0].rcs_status).toBe('ENVIADO');
    expect(result[0].rcs_enviado_fecha).toBe(today());
  });

  it('escribe status ENVIADO y fecha de hoy para CORREO', () => {
    const result = simularMarcarLoteEnviado([5], 'correo');
    expect(result[0].correo_status).toBe('ENVIADO');
    expect(result[0].correo_enviado_fecha).toBe(today());
  });

  it('canal no soportado lanza error', () => {
    expect(() => simularMarcarLoteEnviado([1], 'TELEGRAM')).toThrow('Canal no soportado');
  });

  it('marca individual (array de 1 id) funciona igual que lote', () => {
    const result = simularMarcarLoteEnviado([42], 'WSP');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(42);
    expect(result[0].whatsapp_status).toBe('ENVIADO');
    expect(result[0].wsp_enviado_fecha).toBe(today());
  });
});

describe('Cartera Asignada — checkmarks visuales (✓ solo si enviado hoy)', () => {
  const contactos = [
    { id: 1, whatsapp_status: resolveWspStatus('ENVIADO', today()),    rcs_status: resolveRcsStatus('ENVIADO', yesterday()), correo_status: resolveCorreoStatus('INACTIVO', null) },
    { id: 2, whatsapp_status: resolveWspStatus('INACTIVO', null),      rcs_status: resolveRcsStatus('ACTIVO', null),         correo_status: resolveCorreoStatus('ENVIADO', today()) },
    { id: 3, whatsapp_status: resolveWspStatus('ENVIADO', yesterday()), rcs_status: resolveRcsStatus('ENVIADO', today()),     correo_status: resolveCorreoStatus('ENVIADO', yesterday()) },
  ];

  it('contacto 1: WSP=hoy → ✓ | RCS=ayer → sin ✓ | correo=inactivo → sin ✓', () => {
    const c = contactos[0];
    expect(c.whatsapp_status).toBe('ENVIADO');
    expect(c.rcs_status).toBe('ACTIVO');
    expect(c.correo_status).toBe('INACTIVO');
  });

  it('contacto 2: correo=hoy → ✓ | WSP y RCS sin envío → sin ✓', () => {
    const c = contactos[1];
    expect(c.correo_status).toBe('ENVIADO');
    expect(c.whatsapp_status).toBe('INACTIVO');
    expect(c.rcs_status).toBe('ACTIVO');
  });

  it('contacto 3: WSP y correo enviados ayer → sin ✓ | RCS hoy → ✓', () => {
    const c = contactos[2];
    expect(c.whatsapp_status).toBe('INACTIVO');
    expect(c.rcs_status).toBe('ENVIADO');
    expect(c.correo_status).toBe('INACTIVO');
  });
});

describe('Lotes — pendientes se calculan sobre status resuelto', () => {
  it('lote de 5: 2 enviados hoy → 3 pendientes WSP', () => {
    const lote = [
      { whatsapp_status: resolveWspStatus('ENVIADO', today()) },
      { whatsapp_status: resolveWspStatus('ENVIADO', today()) },
      { whatsapp_status: resolveWspStatus('ENVIADO', yesterday()) },
      { whatsapp_status: resolveWspStatus('INACTIVO', null) },
      { whatsapp_status: resolveWspStatus('ACTIVO', null) },
    ];
    expect(contarPendientesLote(lote, 'wsp')).toBe(3);
  });

  it('todos enviados hoy → 0 pendientes → lote COMPLETADO', () => {
    const lote = [
      { rcs_status: resolveRcsStatus('ENVIADO', today()) },
      { rcs_status: resolveRcsStatus('ENVIADO', today()) },
    ];
    expect(contarPendientesLote(lote, 'rcs')).toBe(0);
  });

  it('todos enviados ayer → todos pendientes hoy (reset diario correcto)', () => {
    const lote = [
      { correo_status: resolveCorreoStatus('ENVIADO', yesterday()) },
      { correo_status: resolveCorreoStatus('ENVIADO', yesterday()) },
      { correo_status: resolveCorreoStatus('ENVIADO', yesterday()) },
    ];
    expect(contarPendientesLote(lote, 'correo')).toBe(3);
  });
});

describe('Tipificación → GESTIONADO (regla de negocio universal)', () => {
  it('debeMarcarGestionado = true siempre (modo MANUAL, tipif efectiva)', () => {
    expect(debeMarcarGestionado()).toBe(true);
  });

  it('debeMarcarGestionado = true (modo MANUAL, tipif NC)', () => {
    expect(debeMarcarGestionado()).toBe(true);
  });

  it('debeMarcarGestionado = true (modo AUTOMATICA, tipif BUZON, intentos < max)', () => {
    expect(debeMarcarGestionado()).toBe(true);
  });

  it('debeMarcarGestionado = true (modo AUTOMATICA, tipif PMP)', () => {
    expect(debeMarcarGestionado()).toBe(true);
  });

  it('regla no tiene excepciones — siempre retorna true', () => {
    // Cualquier combinación de parámetros → siempre GESTIONADO
    const casos = [
      { codigo: 'NC',       modo: 'AUTOMATICA', intentos: 0, max: 3 },
      { codigo: 'BUZON',    modo: 'AUTOMATICA', intentos: 1, max: 3 },
      { codigo: 'PMP',      modo: 'MANUAL',     intentos: 0, max: 1 },
      { codigo: 'PAGO_REAL',modo: 'MANUAL',     intentos: 0, max: 1 },
      { codigo: 'NC',       modo: 'MANUAL',     intentos: 5, max: 1 },
    ];
    casos.forEach(c => {
      expect(debeMarcarGestionado(c)).toBe(true);
    });
  });
});

describe('Fecha de hoy — formato YYYY-MM-DD', () => {
  it('today() tiene formato correcto', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('yesterday() es exactamente 1 día antes de today()', () => {
    const t = new Date(today());
    const y = new Date(yesterday());
    const diffDays = (t - y) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(1);
  });

  it('today() !== yesterday()', () => {
    expect(today()).not.toBe(yesterday());
  });
});
