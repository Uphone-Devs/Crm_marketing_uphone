# Query Optimization Spec — CRM Backend

**Objetivo**: eliminar bottlenecks de DB sin romper ninguna funcionalidad existente.  
**Orden de ejecución**: de mayor a menor impacto. Cada fix es independiente.

---

## FIX 1 — Correlated EXISTS → LEFT JOIN  
**Archivo**: `backend/src/routes/supervisor.routes.js:235–248`  
**Endpoint**: `GET /api/actividad-tipificacion`  
**Impacto**: 🔴 CRÍTICO — N subqueries por fila de contactos

### Problema
```sql
CASE WHEN EXISTS (
  SELECT 1 FROM cdrs cr2
  WHERE cr2.contacto_id = co.id        -- ← correlación: evalúa por cada fila
    AND cr2.timestamp_inicio >= $inicio
    AND cr2.timestamp_inicio <= $fin
    ${apoyoSql}
) THEN 1 ELSE 0 END AS has_cdr
FROM contactos co
WHERE co.asignado_a IN (...)
```
Si hay 300 contactos → 300 EXISTS subqueries separadas al planner.

### Fix
Reemplazar EXISTS por LEFT JOIN en la subquery:
```sql
SELECT co.id, co.asignado_a, co.clave_gestion, <segExpr> AS seg,
  CASE WHEN cr2.contacto_id IS NOT NULL THEN 1 ELSE 0 END AS has_cdr
FROM contactos co
LEFT JOIN LATERAL (
  SELECT 1 AS hit FROM cdrs cr2
  WHERE cr2.contacto_id = co.id
    AND cr2.timestamp_inicio >= $inicio
    AND cr2.timestamp_inicio <= $fin
    <apoyoSql>
  LIMIT 1
) cr2 ON true
WHERE co.asignado_a IN (...)
  <campSql> <empSql> <fechaSql>
```
`LATERAL ... LIMIT 1` = semijoin — el planner puede usar index `cdrs(contacto_id, timestamp_inicio)`.

**Índice requerido** (crear en la VM antes de desplegar):
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cdrs_contacto_ts
  ON cdrs (contacto_id, timestamp_inicio);
```

---

## FIX 2 — N individual UPDATEs → unnest bulk UPDATE  
**Archivo**: `backend/src/routes/supervisor.routes.js:1142–1145`  
**Endpoint**: `POST /api/cartera/reordenar`  
**Impacto**: 🔴 CRÍTICO — 1 round-trip por contacto reordenado

### Problema
```javascript
const updates = contactoIdsEnOrden.map((id, i) =>
  db.contacto.update({ where: { id: Number(id) }, data: { ordenMarcacion: i + 1 } })
);
await db.$transaction(updates);  // 1 UPDATE × N contactos dentro de 1 tx
```
Reordenar 200 contactos = 200 UPDATE statements secuenciales en la misma conexión.

### Fix
```javascript
// Reemplazar las 4 líneas con:
const pairs = contactoIdsEnOrden.map((id, i) => ({ id: Number(id), orden: i + 1 }));
await db.$executeRaw`
  UPDATE contactos AS co
  SET orden_marcacion = v.orden
  FROM (
    SELECT UNNEST(${pairs.map(p => p.id)}::int[]) AS id,
           UNNEST(${pairs.map(p => p.orden)}::int[]) AS orden
  ) v
  WHERE co.id = v.id
    AND co.asignado_a = ${asesorId}
`;
```
1 solo UPDATE. El `AND co.asignado_a = $asesorId` evita que un asesor reordene contactos de otro.

---

## FIX 3 — /cartera sin límite  
**Archivo**: `backend/src/routes/supervisor.routes.js:2581–2596`  
**Endpoint**: `GET /api/cartera?campanaId=X`  
**Impacto**: 🟠 ALTO — devuelve todos los contactos del asesor sin techo

### Problema
```javascript
const contactos = await db.contacto.findMany({
  where,
  include: { campana: ..., agendamientos: ... },
  orderBy: [...],
  // ← sin take
});
```
Asesor con 800 contactos → 800 filas × include = carga masiva por request.

### Fix
Agregar paginación por cursor:
```javascript
const limite   = Math.min(parseInt(req.query.limite) || 300, 500);
const cursorId = req.query.cursor ? parseInt(req.query.cursor) : undefined;

const contactos = await db.contacto.findMany({
  where,
  include: { campana: { select: { nombre: true } }, agendamientos: { ... } },
  orderBy: [{ ordenMarcacion: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
  take: limite + 1,
  ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
});

const hasMore = contactos.length > limite;
if (hasMore) contactos.pop();
// res.json añade: { contactos, hasMore, nextCursor: hasMore ? contactos.at(-1).id : null }
```
**Nota**: el renderer actual carga toda la cartera en una sola llamada. Si el equipo usa paginación, hay que coordinar con el frontend (AsesorPanel). Alternativa más segura corto plazo: solo poner `take: 500` sin paginación, y loggear si algún asesor lo alcanza.

---

## FIX 4 — /bitacora sin techo de límite  
**Archivo**: `backend/src/routes/supervisor.routes.js:2691`  
**Endpoint**: `GET /api/bitacora?limite=N`  
**Impacto**: 🟡 MEDIO — cliente puede pedir `limite=100000`

### Problema
```javascript
const limite = parseInt(req.query.limite) || 500;  // sin cap máximo
```

### Fix (1 línea)
```javascript
const limite = Math.min(parseInt(req.query.limite) || 200, 500);
```

---

## FIX 5 — GIN index en metadata para JSONB scans  
**Archivo**: `backend/src/routes/supervisor.routes.js:67–99` (`resolveContactoWhere`)  
**Impacto**: 🟡 MEDIO — seq scan en JSONB cuando hay filtros de metadata

### Problema
`resolveContactoWhere` hace `SELECT id FROM contactos WHERE metadata->>'DISTRIBUIDOR' ILIKE $n` — fullscan de JSONB sin índice.

### Fix (solo SQL en VM, no toca código)
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contactos_metadata_gin
  ON contactos USING GIN (metadata jsonb_path_ops);
```
`jsonb_path_ops` cubre operadores `@>` y `?`. Las queries ILIKE en campos de texto dentro de JSONB **no** usan GIN — solo funcionarían con `=` o `@>`. El índice ayuda si se migra a `metadata @> '{"DISTRIBUIDOR":"X"}'` pero no a `ILIKE '%x%'`.

**Impacto real**: el GIN reduce scans de filtros exactos. Los ILIKE actuales siguen siendo seq scans. Fix completo requeriría cambiar las queries a búsqueda exacta o mover los campos clave a columnas reales.

---

## FIX 6 — DELETE campana/asesor carga IDs en memoria  
**Archivo**: `backend/src/routes/campanas.routes.js:279–290`  
**Endpoint**: `DELETE /api/campanas/:id/asesores/:asesorId`  
**Impacto**: 🟡 MEDIO — carga N IDs en Node antes de eliminar

### Problema
```javascript
const contactosIds = (await db.contacto.findMany({
  where: { campanaId, asignadoA: asesorId },
  select: { id: true },
})).map(c => c.id);

await db.$transaction([
  db.agendamiento.deleteMany({ where: { contactoId: { in: contactosIds } } }),
  db.cdr.deleteMany({ where: { contactoId: { in: contactosIds } } }),
  db.contacto.deleteMany({ where: { id: { in: contactosIds } } }),
]);
```
Con 1000 contactos → Array de 1000 IDs en memoria + IN clause gigante.

### Fix
```javascript
await db.$executeRaw`
  DELETE FROM agendamientos WHERE contacto_id IN (
    SELECT id FROM contactos WHERE campana_id = ${campanaId} AND asignado_a = ${asesorId}
  )
`;
await db.$executeRaw`
  DELETE FROM cdrs WHERE contacto_id IN (
    SELECT id FROM contactos WHERE campana_id = ${campanaId} AND asignado_a = ${asesorId}
  )
`;
await db.$executeRaw`
  DELETE FROM contactos WHERE campana_id = ${campanaId} AND asignado_a = ${asesorId}
`;
```
Todo en DB, sin cargar IDs en Node. Orden: dependencias primero.

---

## Orden de ejecución

| # | Fix | Archivo | Líneas | Riesgo |
|---|-----|---------|--------|--------|
| 1 | Crear índice `idx_cdrs_contacto_ts` | VM psql | — | ninguno |
| 2 | EXISTS → LEFT JOIN LATERAL | supervisor.routes.js | 229–249 | bajo |
| 3 | N UPDATEs → unnest bulk | supervisor.routes.js | 1142–1145 | bajo |
| 4 | take: 500 en /cartera | supervisor.routes.js | 2581 | bajo |
| 5 | Min/max en /bitacora | supervisor.routes.js | 2691 | mínimo |
| 6 | Subquery DELETE campana | campanas.routes.js | 279–290 | bajo |
| 7 | GIN index metadata (opcional) | VM psql | — | ninguno |

**Regla**: cada fix va en commit separado. Probar en local antes de push a VM.
