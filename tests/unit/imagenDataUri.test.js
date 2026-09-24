/**
 * tests/unit/imagenDataUri.test.js
 *
 * Las imágenes de mensajes_broadcast viven como data URI base64 dentro de la
 * fila: 185 MB contra 276 kB de texto, servidos enteros a cada asesor diez
 * veces por minuto. Esto es la parte pura del migrador que las saca a archivo.
 *
 * Nada de I/O acá: decidir y escribir van separados para poder probar la
 * decisión sin tocar el disco ni la base.
 */
const {
  esDataUri, parsearDataUri, nombreArchivo, urlPublica,
} = require('../../backend/src/infra/imagenDataUri');

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('esDataUri', () => {
  it('reconoce un data URI de imagen', () => {
    expect(esDataUri(`data:image/png;base64,${PNG_1PX}`)).toBe(true);
  });

  it('no confunde una URL ya migrada', () => {
    expect(esDataUri('https://crm.ejemplo.com/public/uploads/mensaje-857.png')).toBe(false);
  });

  it('tolera vacío y ausente sin romper', () => {
    expect(esDataUri('')).toBe(false);
    expect(esDataUri(null)).toBe(false);
    expect(esDataUri(undefined)).toBe(false);
  });
});

describe('parsearDataUri', () => {
  it('devuelve mime, extensión y bytes', () => {
    const r = parsearDataUri(`data:image/png;base64,${PNG_1PX}`);
    expect(r.mime).toBe('image/png');
    expect(r.extension).toBe('.png');
    expect(Buffer.isBuffer(r.bytes)).toBe(true);
    expect(r.bytes.subarray(1, 4).toString()).toBe('PNG');
  });

  it('mapea jpeg a .jpg y webp a .webp', () => {
    expect(parsearDataUri('data:image/jpeg;base64,AAAA').extension).toBe('.jpg');
    expect(parsearDataUri('data:image/webp;base64,AAAA').extension).toBe('.webp');
  });

  it('rechaza un mime que no sea imagen en vez de escribir cualquier cosa', () => {
    expect(() => parsearDataUri('data:text/html;base64,AAAA')).toThrow(/no permitido/i);
  });

  it('rechaza lo que no es data URI', () => {
    expect(() => parsearDataUri('https://ejemplo.com/x.png')).toThrow(/data uri/i);
  });
});

describe('nombreArchivo', () => {
  it('es estable para el mismo id y contenido: reejecutar no duplica archivos', () => {
    const a = nombreArchivo(857, `data:image/png;base64,${PNG_1PX}`);
    const b = nombreArchivo(857, `data:image/png;base64,${PNG_1PX}`);
    expect(a).toBe(b);
    expect(a).toMatch(/^mensaje-857-[0-9a-f]{8}\.png$/);
  });

  it('cambia si cambia el contenido, para no servir una imagen vieja cacheada', () => {
    const a = nombreArchivo(857, `data:image/png;base64,${PNG_1PX}`);
    const b = nombreArchivo(857, 'data:image/png;base64,QUJDRA==');
    expect(a).not.toBe(b);
  });
});

describe('urlPublica', () => {
  it('arma la URL absoluta sobre la base configurada', () => {
    expect(urlPublica('https://crm.ejemplo.com', 'mensaje-857-deadbeef.png'))
      .toBe('https://crm.ejemplo.com/public/uploads/mensaje-857-deadbeef.png');
  });

  it('no duplica la barra si la base termina en una', () => {
    expect(urlPublica('https://crm.ejemplo.com/', 'x.png'))
      .toBe('https://crm.ejemplo.com/public/uploads/x.png');
  });

  it('exige base: una URL relativa no resuelve desde el renderer de Electron', () => {
    expect(() => urlPublica('', 'x.png')).toThrow(/base/i);
  });
});
