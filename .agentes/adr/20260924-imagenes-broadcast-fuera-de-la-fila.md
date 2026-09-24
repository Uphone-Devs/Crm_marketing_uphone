# Sacar las imágenes de los mensajes broadcast fuera de la fila

Fecha: 2026-09-24
Estado: aceptado

## Contexto

Un día entero de diagnóstico sobre picos de CPU, 500 intermitentes al tipificar
y una supuesta fuga de memoria terminó en un único endpoint.

Instrumentado el tráfico saliente por ruta, el reporte fue inequívoco:

```
[TRAFICO] 1171.4MB/min → GET /api/mensajes-broadcast 1171.2MB/10req
                       | GET /api/admin/connected 0.1MB/12req
                       | GET /api/mis-compromisos 0.1MB/20req  …
```

**117 MB por respuesta, diez veces por minuto.** Todo lo demás sumaba 0,1 MB.

La causa está en la base:

```
973 mensajes · texto 276 kB · imagen_url 185 MB
id 857 → chars_imagen 2663322 → data:image/png;base64,iVBORw0KGgo…
```

Las imágenes se guardan como data URI base64 dentro de `imagen_url`, y el
endpoint devolvía las 973 filas sin filtrar por `activo`, cacheando el
resultado por usuario durante dos minutos.

Ese solo endpoint explica todos los síntomas del día:

| Síntoma | Mecanismo |
|---|---|
| 28 MB/s sostenidos por el túnel | 117 MB × 10/min |
| `cloudflared` al 42% de un núcleo | cifra y reenvía esos bytes |
| Event loop bloqueado | `JSON.stringify` de 117 MB tarda segundos |
| Transacción por lotes expirando a 5,6 s | no consigue turno en el loop |
| WebSocket cayendo y reconectando | el heartbeat mata al que no responde a tiempo |
| RSS de 1,9 GB en dos horas | la caché reteniendo esos payloads |

La "fuga de memoria" que se venía investigando desde el 21-09 no era una fuga.

## Decisión

Dos cambios independientes, que se pueden desplegar por separado.

**1. El endpoint deja de mandar lo que nadie lee.** El cliente ya descarta las
inactivas (`AsesorPanel.jsx:1839`) y elige con `.find()` por empresa, segmento y
canal, así que solo consume la primera coincidencia de cada combinación. La rama
del asesor pasa a `WHERE mb.activo` más `DISTINCT ON (empresa, segmento_destino,
canal)`. Para el asesor el resultado es idéntico; el volumen baja a decenas de
filas. Las ramas de jefe y admin quedan como estaban: administran mensajes y
necesitan ver los inactivos.

**2. Las imágenes salen a archivo.** `backend/scripts/migrar-imagenes-broadcast.js`
las escribe bajo `public/uploads/` y deja la URL absoluta en `imagen_url`. Esa
ruta ya se sirve con `Cache-Control: max-age=31536000, immutable`, así que
Cloudflare las cachea en el edge y la VM sirve cada imagen una sola vez.

No hace falta redistribuir el cliente: hace `img.src = imagen_url`, y una URL
funciona igual que un data URI.

## Consecuencias

**A favor:** la respuesta al asesor baja de 117 MB a cientos de kB — tres
órdenes de magnitud. Se desbloquea el event loop, que era la causa común de los
500 al tipificar y del churn de WebSocket. La base adelgaza 185 MB.

**En contra, y no es menor:** el asesor copia el correo con imagen comprimiéndola
por un `<canvas>` (`AsesorPanel.jsx:3864-3881`). Con un data URI eso funciona;
con una URL de otro origen el canvas queda contaminado y `toDataURL` lanza. El
código ya cae de vuelta a usar la URL tal cual, así que el flujo no se rompe,
pero el correo pasa a referenciar la imagen en vez de incrustarla y algunos
clientes la muestran bloqueada hasta que el destinatario acepta ver imágenes.

Se cierra con una línea en el cliente (`img.crossOrigin = 'anonymous'`), pero eso
exige build y redistribución, así que va aparte. Se aceptó la degradación
temporal: un adjunto que el destinatario debe desbloquear es preferible a diez
asesores con el sistema inutilizable.

**Riesgo del migrador:** modifica 973 filas de producción. Simula por defecto,
sólo escribe con `--aplicar`, vuelca la columna completa a un `.sql` de
restauración antes de tocar nada, y el nombre de archivo es determinista sobre
(id, contenido), así que reejecutarlo no duplica ni corrompe. El hash en el
nombre es necesario porque `public/uploads` se sirve como inmutable: reusar una
URL dejaría la imagen vieja cacheada un año.

**Deuda que queda:** `cache.set` no acota por tamaño. Con payloads chicos deja de
importar, pero el mismo patrón puede repetirse en otro endpoint.

## Métricas

**Big O:** el endpoint pasa de O(n) sobre todos los mensajes históricos a O(k)
sobre las combinaciones vigentes de (empresa, segmento, canal), que es acotado y
no crece con el tiempo. El `DISTINCT ON` ordena, O(n log n) en base, contra
serializar y transferir n filas completas en Node.

**Big I:** de I(n) a I(0) para este problema. Hoy exige que alguien note el pico
de CPU, abra el Monitor de recursos, muestree y deduzca. Después no exige nada:
el volumen deja de crecer con la cantidad de mensajes acumulados.
