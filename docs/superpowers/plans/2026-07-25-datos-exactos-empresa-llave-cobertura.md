# Datos Exactos: Llave Compleja + Dimensión Empresa + Cobertura ≤ 100% — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Garantizar que todos los reportes y métricas del CRM sean exactos: cobertura ≤ 100%, datos separados por empresa, sin mezcla entre aperturas, anclados a Nº CONTRATO como llave única.

**Architecture:**
Las métricas actuales fallan porque usan `estado_marcacion` (estado global del contacto) como numerador de cobertura, pero filtran el denominador por apertura — causando porcentajes > 100%. La solución es: (1) columnas desnormalizadas `nro_contrato` + `empresa` en `contactos` para queries eficientes; (2) llave compuesta `empresa|nro_contrato|campana_id` como identificador único de unidad de gestión; (3) cobertura siempre calculada como `DISTINCT nro_contrato CON CDR / DISTINCT nro_contrato TOTAL` dentro del mismo rango de apertura; (4) empresa como dimensión de filtro en todos los endpoints.

**Tech Stack:** PostgreSQL 15, Prisma 5, Express 4, ExcelJS, React 18

---

## Diagnóstico de bugs raíz

| Bug | Causa raíz | Endpoint afectado |
|-----|-----------|-------------------|
| Cobertura > 100% | Numerador = `estado_marcacion != PENDIENTE` (global), denominador = contactos en apertura (filtrado) → numerador puede ser mayor | `/jefe/productividad`, `/actividad-tipificacion` |
| Gestiones > clientes vencidos | `gestiones_totales = COUNT(cdrs)` = N llamadas; `clientes = COUNT(contactos)` = 1 cliente con N llamadas. Es matemáticamente correcto, pero el panel lo mezcla sin contexto | `/jefe/productividad` |
| Datos mezclados entre empresas | No existe filtro/agrupación por empresa en ningún endpoint | Todos |
| Llave por cédula | Si un cliente tiene 2 contratos (2 compras), la cédula se repite → queries por cédula lo cuentan doble | Correlación pagos, cobertura |

---

## Archivos que cambian

| Archivo | Acción | Responsabilidad |
|---------|--------|-----------------|
| `backend/prisma/schema.prisma` | Modificar | Agregar campos `nroContrato`, `empresa`, `claveGestion` a `Contacto` |
| `backend/prisma/migrations/YYYYMMDD_llave_empresa/migration.sql` | Crear | DDL + backfill + índices |
| `backend/src/routes/contactos.routes.js` | Modificar | Poblar los 3 campos nuevos al importar cartera |
| `backend/src/routes/supervisor.routes.js` | Modificar | Arreglar cobertura, agregar dimensión empresa, arreglar avance |
| `src/renderer/supervisor/JefePanel.jsx` | Modificar | Selector empresa, mostrar métricas correctas |
| `src/renderer/supervisor/ActividadGestores.jsx` | Modificar | Filtro empresa en actividad |
| `src/renderer/supervisor/DashboardDirectivo.jsx` | Modificar | Selector empresa |

---

## Reglas de conteo aclaradas (2026-07-25)

| Regla | Detalle |
|-------|---------|
| **Conteo por día** | El mismo `nro_contrato` en 3 días distintos = 3 apariciones en reportes diarios. Cada apertura (por `fecha_asignacion`) es independiente. Apertura anchoring ya lo garantiza. |
| **Mismo contrato, mismo día, múltiples segmentos** | S0+S1+S2 del mismo día → cuenta **1 vez** en cobertura total del día. En desglose por segmento → aparece en cada segmento donde está asignado. |
| **Usuarios `apoyo`** | Hacen llamadas (CDRs existen), pero sus CDRs **no cuentan** en gestiones, cobertura, rankings ni reportes. Filtrar `WHERE usuarios.rol != 'apoyo'` en todos los conteos. |

---

## Task 0: Excluir usuarios apoyo por ID fijo (`APOYO_USER_IDS`)

**Files:**
- Modify: `backend/.env.example` (documentar variable)
- Modify: `backend/src/routes/supervisor.routes.js` (helper + todas las queries)

Sin nuevo rol ni columna. El gestor apoyo tiene rol `asesor` normal, pero su ID se lista en `APOYO_USER_IDS`. Todas las queries de gestiones/cobertura agregan `AND u.id NOT IN (apoyo_ids)`.

- [ ] **Step 1: Agregar variable a `.env.example`**

En `backend/.env.example`, agregar:

```env
# IDs de usuarios apoyo separados por coma — excluidos de todos los reportes
# Ejemplo: APOYO_USER_IDS=5,12
APOYO_USER_IDS=
```

En `backend/.env` (real, no commiteado), agregar el/los IDs reales:
```env
APOYO_USER_IDS=<id_del_gestor_apoyo>
```

- [ ] **Step 2: Agregar helper en supervisor.routes.js**

Al inicio de `backend/src/routes/supervisor.routes.js`, después de los `require`:

```js
// IDs de usuarios apoyo — excluidos de gestiones y reportes
const _APOYO_IDS = (process.env.APOYO_USER_IDS || '')
  .split(',')
  .map(s => parseInt(s.trim(), 10))
  .filter(n => !isNaN(n));

// SQL fragment: excluye apoyo en JOINs con usuarios
// Uso: `AND cr.usuario_id ${_APOYO_SQL}` (solo si hay IDs configurados)
function _apoyoExclude(alias = 'cr') {
  if (_APOYO_IDS.length === 0) return '';
  return `AND ${alias}.usuario_id NOT IN (${_APOYO_IDS.join(',')})`;
}
```

- [ ] **Step 3: Aplicar en query de productividad (Task 3)**

En el numerador de `/jefe/productividad`, reemplazar el JOIN de usuarios por:

```js
      JOIN usuarios u   ON u.id  = cr.usuario_id AND u.rol != 'apoyo'
```
→ con:
```js
      -- Excluir CDRs de usuarios apoyo (IDs en APOYO_USER_IDS)
      ${_APOYO_IDS.length ? Prisma.sql`AND cr.usuario_id NOT IN (${Prisma.join(_APOYO_IDS)})` : Prisma.empty}
```

(El JOIN con `usuarios` ya no es necesario — más eficiente evitar el JOIN extra.)

Query completa del numerador:

```js
    const contactosGestionados = await db.$queryRaw`
      SELECT COUNT(DISTINCT COALESCE(co.nro_contrato, co.id::text))::int AS gestionados,
             COUNT(DISTINCT CASE WHEN co.empresa = 'TEC_SAS' THEN COALESCE(co.nro_contrato, co.id::text) END)::int AS gest_tec,
             COUNT(DISTINCT CASE WHEN co.empresa = 'SCC'     THEN COALESCE(co.nro_contrato, co.id::text) END)::int AS gest_scc
      FROM cdrs cr
      JOIN contactos co ON co.id = cr.contacto_id
      WHERE co.fecha_asignacion >= ${fechaDesde}
        AND co.fecha_asignacion <= ${fechaHasta}
        AND cr.timestamp_inicio  >= ${fechaDesde}
        AND cr.timestamp_inicio  <= ${fechaHasta}
        ${_APOYO_IDS.length ? Prisma.sql`AND cr.usuario_id NOT IN (${Prisma.join(_APOYO_IDS)})` : Prisma.empty}
        ${empresa ? Prisma.sql`AND co.empresa = ${empresa}` : Prisma.empty}
        ${cWhere.campanaId ? Prisma.sql`AND co.campana_id = ${cWhere.campanaId}` : Prisma.empty}
        ${cWhere.asignadoA ? Prisma.sql`AND co.asignado_a = ${cWhere.asignadoA}` : Prisma.empty}
    `;
```

- [ ] **Step 4: Aplicar en `detalleRows` de actividad-tipificacion (Task 4)**

En la subquery raw SQL de `detalleRows`, agregar al WHERE:

```sql
-- Excluir apoyo: hardcoded safe (IDs son enteros validados en el helper)
${_APOYO_IDS.length ? `AND cr2.usuario_id NOT IN (${_APOYO_IDS.join(',')})` : ''}
```

- [ ] **Step 5: Aplicar en `gestiones_totales` count (Task 3)**

```js
    const gestiones_totales = await db.cdr.count({
      where: {
        timestampInicio: { gte: fechaDesde, lte: fechaHasta },
        ...(_APOYO_IDS.length ? { usuarioId: { notIn: _APOYO_IDS } } : {}),
        ...(cWhere.campanaId ? { contacto: { campanaId: cWhere.campanaId } } : {}),
        ...(empresa ? { contacto: { empresa } } : {}),
      },
    });
```

- [ ] **Step 6: Aplicar en `_getMetricasAsesor` (Task 6)**

En la query de coberturaRows dentro de `_getMetricasAsesor`, agregar:

```sql
AND cr.usuario_id != ${asesorId}  -- ya filtrado por asesor, apoyo no debería llegar aquí
-- Pero si asesorId pertenece a un apoyo, no debería ser posible llamar esta función
-- Agregar guardia al principio:
```

```js
async function _getMetricasAsesor(asesorId, inicio, fin, empresa = null) {
  if (_APOYO_IDS.includes(asesorId)) return null; // apoyo no genera métricas
  // ... resto de la función
}
```

Y en `/reports/equipo`, filtrar asesores apoyo antes de mapear:

```js
const asesores = (await db.usuario.findMany({ where: { rol: 'asesor' } }))
  .filter(a => !_APOYO_IDS.includes(a.id));
```

- [ ] **Step 7: Commit**

```bash
git add backend/.env.example backend/src/routes/supervisor.routes.js
git commit -m "feat(apoyo): exclude apoyo user IDs from all gestiones/cobertura/report queries via APOYO_USER_IDS env"
```

---

## Task 1: Migración — columnas `nro_contrato`, `empresa`, `clave_gestion`

**Files:**
- Modify: `backend/prisma/schema.prisma` (modelo `Contacto`)
- Create: `backend/prisma/migrations/20260725000000_llave_empresa/migration.sql`

- [ ] **Step 1: Agregar campos al schema Prisma**

En `backend/prisma/schema.prisma`, dentro de `model Contacto { ... }`, agregar ANTES de `@@index`:

```prisma
nroContrato     String?            @map("nro_contrato")
empresa         String?
claveGestion    String?            @map("clave_gestion")
```

Y agregar índices al final del modelo:

```prisma
@@index([nroContrato], map: "idx_ct_nro_contrato")
@@index([empresa], map: "idx_ct_empresa")
@@index([claveGestion], map: "idx_ct_clave_gestion")
```

- [ ] **Step 2: Crear migración SQL manual**

Crear `backend/prisma/migrations/20260725000000_llave_empresa/migration.sql`:

```sql
-- Agregar columnas
ALTER TABLE contactos
  ADD COLUMN IF NOT EXISTS nro_contrato   VARCHAR(100),
  ADD COLUMN IF NOT EXISTS empresa        VARCHAR(30),
  ADD COLUMN IF NOT EXISTS clave_gestion  VARCHAR(200);

-- Backfill nro_contrato desde metadata
UPDATE contactos
SET nro_contrato = TRIM(metadata->>'Nº CONTRATO')
WHERE metadata IS NOT NULL
  AND TRIM(metadata->>'Nº CONTRATO') <> '';

-- Backfill empresa desde metadata (ya viene del importador)
UPDATE contactos
SET empresa = CASE
  WHEN TRIM(metadata->>'EMPRESA') IN ('TEC_SAS','TEC SAS','UPHONE TEC SAS') THEN 'TEC_SAS'
  WHEN TRIM(metadata->>'EMPRESA') IN ('SCC','S.C.C','UPHONE SCC','UPHONE S.C.C') THEN 'SCC'
  ELSE 'SCC'
END
WHERE metadata IS NOT NULL;

-- Backfill clave_gestion: empresa|nro_contrato|campana_id
-- Esta llave identifica de forma única una unidad de gestión:
-- mismo contrato en misma campaña = misma unidad (aunque aparezca en S0, S1, S2)
UPDATE contactos
SET clave_gestion = CONCAT(
  COALESCE(empresa, 'SCC'), '|',
  COALESCE(nro_contrato, id::text), '|',
  campana_id::text
)
WHERE empresa IS NOT NULL OR nro_contrato IS NOT NULL;

-- Índices
CREATE INDEX IF NOT EXISTS idx_ct_nro_contrato  ON contactos (nro_contrato);
CREATE INDEX IF NOT EXISTS idx_ct_empresa       ON contactos (empresa);
CREATE INDEX IF NOT EXISTS idx_ct_clave_gestion ON contactos (clave_gestion);
```

- [ ] **Step 3: Registrar migración en Prisma y aplicar**

```bash
cd backend
# Registrar la migración manual sin re-crear el SQL
npx prisma migrate resolve --applied 20260725000000_llave_empresa
# Luego ejecutar el SQL directamente:
psql -U postgres -d crm_marketing -f prisma/migrations/20260725000000_llave_empresa/migration.sql
```

Verificar:
```sql
SELECT nro_contrato, empresa, clave_gestion FROM contactos LIMIT 5;
-- Debe mostrar valores poblados, no NULL
```

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260725000000_llave_empresa/
git commit -m "feat(schema): add nro_contrato, empresa, clave_gestion to contactos"
```

---

## Task 2: Poblar campos al importar cartera

**Files:**
- Modify: `backend/src/routes/contactos.routes.js`

Buscar la ruta `POST /api/contactos/importar` (o la que crea contactos en bulk desde Excel). Agregar extracción de los 3 campos al construir cada objeto contacto.

- [ ] **Step 1: Localizar el bloque de construcción de contactos**

```bash
grep -n "importar\|createMany\|Nº CONTRATO\|EMPRESA\|nroContrato" backend/src/routes/contactos.routes.js | head -30
```

- [ ] **Step 2: Agregar extracción de campos en el mapper de filas**

Encontrar donde se construye cada objeto para `db.contacto.createMany`. Agregar:

```js
// Dentro del mapper que convierte cada fila del Excel en objeto Prisma:
function _normEmpresa(raw) {
  const v = (raw || '').trim().toUpperCase();
  if (v.includes('TEC')) return 'TEC_SAS';
  return 'SCC';
}

// En el objeto de cada contacto:
const nroContrato = (meta['Nº CONTRATO'] || meta['CONTRATO'] || '').trim() || null;
const empresa     = _normEmpresa(meta['EMPRESA'] || '');
const claveGestion = empresa && nroContrato && campanaId
  ? `${empresa}|${nroContrato}|${campanaId}`
  : null;

// Agregar al objeto:
{
  // ... campos existentes ...
  nroContrato,
  empresa,
  claveGestion,
}
```

- [ ] **Step 3: Verificar que no rompe importación existente**

```bash
# Probar con una apertura pequeña de prueba desde el panel admin
# Luego verificar:
psql -U postgres -d crm_marketing -c "SELECT nro_contrato, empresa, clave_gestion FROM contactos ORDER BY id DESC LIMIT 10;"
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/contactos.routes.js
git commit -m "feat(importar): populate nro_contrato, empresa, clave_gestion on cartera import"
```

---

## Task 3: Fix `/jefe/productividad` — cobertura ≤ 100%, anclar a apertura

**Files:**
- Modify: `backend/src/routes/supervisor.routes.js` (línea ~1686)

El bug: `gestionados = contacto.count({ estadoMarcacion != PENDIENTE })` es estado global, no anclado a apertura. Si el supervisor filtra por `fechaDesde=2026-07-01`, el denominador (cartera de esa fecha) puede ser menor que el numerador (todos los gestionados históricos).

- [ ] **Step 1: Reescribir la query de productividad**

Reemplazar el bloque actual en `/jefe/productividad` (~línea 1693-1710) con:

```js
router.get('/jefe/productividad', async (req, res, next) => {
  if (!isSupervisor(req.user.rol)) return res.status(403).json({ error: 'Acceso denegado' });
  try {
    const cWhere = await resolveContactoWhere(req.query);
    const empresa = req.query.empresa || null; // 'TEC_SAS' | 'SCC' | null = ambas
    if (empresa) cWhere.empresa = empresa;

    // Rango de apertura (anclado a fechaDesde/fechaHasta de asignación)
    const { inicio, fin } = _gyeDayBounds(req.query.fecha || 'hoy');
    const fechaDesde = req.query.fechaDesde ? new Date(req.query.fechaDesde + 'T00:00:00.000Z') : inicio;
    const fechaHasta = req.query.fechaHasta ? new Date(req.query.fechaHasta + 'T23:59:59.999Z') : fin;

    // Denominador: contratos ÚNICOS asignados en el rango de apertura
    // Anclado por fecha_asignacion, deduplicado por nro_contrato (no cédula)
    const contactosApertura = await db.$queryRaw`
      SELECT COUNT(DISTINCT COALESCE(nro_contrato, id::text))::int AS total,
             COUNT(DISTINCT CASE WHEN empresa = 'TEC_SAS' THEN COALESCE(nro_contrato, id::text) END)::int AS total_tec,
             COUNT(DISTINCT CASE WHEN empresa = 'SCC'     THEN COALESCE(nro_contrato, id::text) END)::int AS total_scc
      FROM contactos
      WHERE fecha_asignacion >= ${fechaDesde}
        AND fecha_asignacion <= ${fechaHasta}
        ${empresa ? Prisma.sql`AND empresa = ${empresa}` : Prisma.empty}
        ${cWhere.campanaId ? Prisma.sql`AND campana_id = ${cWhere.campanaId}` : Prisma.empty}
        ${cWhere.asignadoA ? Prisma.sql`AND asignado_a = ${cWhere.asignadoA}` : Prisma.empty}
    `;

    // Numerador: contratos ÚNICOS que tienen al menos 1 CDR en el rango
    // Excluye CDRs de usuarios apoyo (IDs en _APOYO_IDS / env APOYO_USER_IDS)
    const contactosGestionados = await db.$queryRaw`
      SELECT COUNT(DISTINCT COALESCE(co.nro_contrato, co.id::text))::int AS gestionados,
             COUNT(DISTINCT CASE WHEN co.empresa = 'TEC_SAS' THEN COALESCE(co.nro_contrato, co.id::text) END)::int AS gest_tec,
             COUNT(DISTINCT CASE WHEN co.empresa = 'SCC'     THEN COALESCE(co.nro_contrato, co.id::text) END)::int AS gest_scc
      FROM cdrs cr
      JOIN contactos co ON co.id = cr.contacto_id
      WHERE co.fecha_asignacion >= ${fechaDesde}
        AND co.fecha_asignacion <= ${fechaHasta}
        AND cr.timestamp_inicio  >= ${fechaDesde}
        AND cr.timestamp_inicio  <= ${fechaHasta}
        ${_APOYO_IDS.length ? Prisma.sql`AND cr.usuario_id NOT IN (${Prisma.join(_APOYO_IDS)})` : Prisma.empty}
        ${empresa ? Prisma.sql`AND co.empresa = ${empresa}` : Prisma.empty}
        ${cWhere.campanaId ? Prisma.sql`AND co.campana_id = ${cWhere.campanaId}` : Prisma.empty}
        ${cWhere.asignadoA ? Prisma.sql`AND co.asignado_a = ${cWhere.asignadoA}` : Prisma.empty}
    `;

    // CDRs totales (gestiones = intentos de contacto, NO clientes únicos)
    const gestiones_totales = await db.cdr.count({
      where: {
        timestampInicio: { gte: fechaDesde, lte: fechaHasta },
        ...(cWhere.campanaId ? { contacto: { campanaId: cWhere.campanaId } } : {}),
        ...(empresa ? { contacto: { empresa } } : {}),
      },
    });

    const cartera_total  = Number(contactosApertura[0]?.total     || 0);
    const gestionados    = Number(contactosGestionados[0]?.gestionados || 0);
    // Cobertura = % contratos únicos contactados — NUNCA supera 100%
    const cobertura      = cartera_total > 0 ? Math.min(100, Math.round((gestionados / cartera_total) * 100)) : 0;

    res.json({
      avance_cartera: cobertura,  // alias para compatibilidad frontend
      cobertura,
      gestiones_totales,          // CDRs = intentos totales (puede ser > clientes)
      cartera_total,              // contratos únicos en apertura
      contactados_unicos: gestionados,
      por_empresa: {
        TEC_SAS: {
          total:      Number(contactosApertura[0]?.total_tec || 0),
          gestionados: Number(contactosGestionados[0]?.gest_tec || 0),
        },
        SCC: {
          total:      Number(contactosApertura[0]?.total_scc || 0),
          gestionados: Number(contactosGestionados[0]?.gest_scc || 0),
        },
      },
    });
  } catch (err) { next(err); }
});
```

- [ ] **Step 2: Verificar en Postman o curl**

```bash
curl "http://localhost:3001/api/jefe/productividad?fechaDesde=2026-07-01&campanaId=5" \
  -H "Authorization: Bearer TOKEN"
# cobertura debe ser ≤ 100
# cartera_total debe coincidir con los contactos de esa apertura
# por_empresa debe mostrar TEC_SAS y SCC separados
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/supervisor.routes.js
git commit -m "fix(productividad): anchor coverage to apertura range, deduplicate by nro_contrato, cap at 100%"
```

---

## Task 4: Fix `/actividad-tipificacion` — avance por segmento anclado a apertura

**Files:**
- Modify: `backend/src/routes/supervisor.routes.js` (línea ~130-380)

El endpoint actual calcula avance usando `COUNT(*)` y `estado_marcacion != PENDIENTE` (global). Debe usar CDRs del día/rango y deduplicar por `clave_gestion`.

- [ ] **Step 1: Reemplazar `detalleRows` query en actividad-tipificacion**

Localizar el bloque `detalleRows` (~línea 162). Reemplazar la subquery de avance:

```js
// detalleRows: contactos únicos por asesor+segmento de la apertura anclada
// Usa nro_contrato para deduplicar (un cliente con 2 contratos cuenta 2x si
// ambos están vencidos, pero el mismo contrato en 2 segmentos cuenta 1x)
asesorIdList.length === 0 ? Promise.resolve([]) : (() => {
  const idsStr     = asesorIdList.join(',');
  const campClause = campanaId ? `AND campana_id = ${campanaId}` : '';
  const SEG_EXPR   = `CASE
    WHEN COALESCE(
      CASE WHEN metadata->>'DIAS IMPAGO'  ~ '^[0-9]+$' THEN (metadata->>'DIAS IMPAGO')::int  END,
      CASE WHEN metadata->>'DIAS EN MORA' ~ '^[0-9]+$' THEN (metadata->>'DIAS EN MORA')::int END,
      CASE WHEN metadata->>'DIAS MORA'    ~ '^[0-9]+$' THEN (metadata->>'DIAS MORA')::int    END
    ) >= 2 THEN '2'
    WHEN COALESCE(...) = 1 THEN '1'
    WHEN COALESCE(...) = 0 THEN '0'
    ELSE 'sin_seg' END`;
  return db.$queryRawUnsafe(`
    SELECT asignado_a,
           seg,
           COUNT(DISTINCT clave_gestion)::int AS total,
           COUNT(DISTINCT CASE
             WHEN EXISTS (
               SELECT 1 FROM cdrs cr2
               WHERE cr2.contacto_id = sub.id
                 AND cr2.timestamp_inicio >= '${inicio.toISOString()}'
                 AND cr2.timestamp_inicio <= '${fin.toISOString()}'
             ) THEN clave_gestion END)::int   AS gestionados
    FROM (
      SELECT id, asignado_a, clave_gestion, ${SEG_EXPR} AS seg
      FROM contactos
      WHERE asignado_a IN (${idsStr})
        ${campClause}
        AND DATE(fecha_asignacion AT TIME ZONE 'America/Guayaquil') = '${fechaYmd}'::date
    ) sub
    GROUP BY asignado_a, seg
  `);
})(),
```

- [ ] **Step 2: Agregar `empresa` a la query de canal (canalRows)**

En `canalRows`, agregar GROUP BY empresa para separar datos:

```sql
SELECT usuario_id, canal, seg, empresa, COUNT(*)::int AS total
FROM (
  SELECT cr.usuario_id, cr.canal, ${SEG_CO} AS seg, co.empresa
  FROM cdrs cr
  JOIN contactos co ON co.id = cr.contacto_id
  WHERE cr.usuario_id IN (${idsStr})
    AND cr.timestamp_inicio >= '${isoInicio}' AND cr.timestamp_inicio <= '${isoFin}'
    AND cr.canal IN ('whatsapp', 'rcs', 'gmail')
    ${campClause}
) t
GROUP BY usuario_id, canal, seg, empresa
```

- [ ] **Step 3: Agregar `avance_global.por_empresa` en respuesta**

En el bloque que construye `avance_global` (~línea 372):

```js
const avance_global = {
  total:      globalTotal,
  gestionados: globalGest,
  pct: globalTotal > 0 ? Math.min(100, Math.round(globalGest / globalTotal * 100)) : 0,
  por_empresa: {
    TEC_SAS: { total: avanceArr.reduce((s,x) => s + (x.segmentos?.tec_total||0), 0), gestionados: 0 },
    SCC:     { total: avanceArr.reduce((s,x) => s + (x.segmentos?.scc_total||0), 0), gestionados: 0 },
  },
};
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/supervisor.routes.js
git commit -m "fix(actividad): deduplicate by clave_gestion, anchor gestioned to CDR range, add empresa breakdown"
```

---

## Task 5: Dimensión empresa en `resolveContactoWhere`

**Files:**
- Modify: `backend/src/routes/supervisor.routes.js` (función `resolveContactoWhere`)

- [ ] **Step 1: Agregar `empresa` al helper**

Localizar `resolveContactoWhere` y agregar:

```js
// Agregar dentro de resolveContactoWhere():
if (q.empresa && ['TEC_SAS', 'SCC'].includes(q.empresa)) {
  where.empresa = q.empresa;
}
```

Esto propaga el filtro de empresa a TODOS los endpoints que usan este helper: `/jefe/top-asesores`, `/jefe/morosidad`, `/jefe/tendencia-semanal`, `/jefe/indicadores`.

- [ ] **Step 2: Verificar endpoints afectados**

```bash
grep -n "resolveContactoWhere" backend/src/routes/supervisor.routes.js
# Verificar que todos los endpoints ahora aceptan ?empresa=TEC_SAS
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/supervisor.routes.js
git commit -m "feat(empresa): add empresa filter to resolveContactoWhere — propagates to all metric endpoints"
```

---

## Task 6: Fix reportes Excel — empresa, nro_contrato, cobertura real

**Files:**
- Modify: `backend/src/routes/supervisor.routes.js` (funciones `_getMetricasAsesor`, `_buildOperativoWb`, rutas `/reports/equipo` y `/reports/diario`)

- [ ] **Step 1: Agregar cobertura a `_getMetricasAsesor`**

Al final de `_getMetricasAsesor`, agregar:

```js
// Cobertura anclada: contratos únicos con CDR / contratos únicos asignados
const [coberturaRows] = await db.$queryRaw`
  SELECT
    COUNT(DISTINCT COALESCE(co.nro_contrato, co.id::text))::int AS total,
    COUNT(DISTINCT CASE WHEN cr.id IS NOT NULL
      THEN COALESCE(co.nro_contrato, co.id::text) END)::int      AS gestionados
  FROM contactos co
  LEFT JOIN cdrs cr ON cr.contacto_id = co.id
    AND cr.usuario_id  = ${asesorId}
    AND cr.timestamp_inicio >= ${inicio}
    AND cr.timestamp_inicio <= ${fin}
  WHERE co.asignado_a = ${asesorId}
    AND co.fecha_asignacion >= ${inicio}
    AND co.fecha_asignacion <= ${fin}
`;

const coberturaTotal = Number(coberturaRows?.total     || 0);
const coberturaGest  = Number(coberturaRows?.gestionados || 0);
const coberturaPct   = coberturaTotal > 0
  ? Math.min(100, Math.round(coberturaGest / coberturaTotal * 100))
  : 0;

return {
  // ... campos existentes ...
  coberturaTotal,
  coberturaGest,
  coberturaPct,   // NUNCA supera 100
};
```

- [ ] **Step 2: Actualizar `_buildOperativoWb` — agregar columnas empresa y cobertura**

```js
function _buildOperativoWb(dataEquipo, titulo) {
  const COLS = [
    'Empresa','Asesor','Cartera Única','Gestionados','Cobertura%',
    'Marcaciones','T. Aire','Productividad%','Eficacia%',
    'CDRs','Efectivos','Neutros','No Contactados',
    'Compromisos','M. Comprometido','M. Recaudado',
    'WhatsApp','RCS/SMS','Correos','Total Digital',
  ];
  // ... resto del builder igual pero con las columnas nuevas ...
  // En el row:
  ws.addRow([
    d.empresa || 'N/A',
    d.nombre,
    d.coberturaTotal,
    d.coberturaGest,
    d.coberturaPct,
    d.totalMarcaciones,
    d.tiempoAlAire,
    d.productividad,
    d.eficacia,
    d.cdrsTotal,
    d.efectivos,
    d.neutros,
    d.noContactados,
    d.compromisos,
    d.montoComprometido,
    d.montoRecaudado,
    d.wspEnviados,
    d.rcsEnviados,
    d.correosEnviados,
    d.wspEnviados + d.rcsEnviados + d.correosEnviados,
  ]);
```

- [ ] **Step 3: En `/reports/equipo`, pasar empresa a `_getMetricasAsesor`**

```js
// Modificar la firma:
async function _getMetricasAsesor(asesorId, inicio, fin, empresa = null) {
  // Agregar filtro empresa en coberturaRows si aplica:
  // AND (${empresa ? Prisma.sql`co.empresa = ${empresa}` : Prisma.sql`TRUE`})
}

// En /reports/equipo:
const empresa = req.query.empresa || null;
const dataEquipo = await Promise.all(
  asesores.map(async a => ({
    empresa,
    nombre: a.nombre,
    ...await _getMetricasAsesor(a.id, inicio, fin, empresa)
  }))
);
```

- [ ] **Step 4: Agregar hoja resumen por empresa al workbook**

```js
// Después de la hoja principal, agregar hoja de resumen:
const wsSummary = wb.addWorksheet('Resumen por Empresa');
wsSummary.addRow(['Empresa', 'Cartera', 'Gestionados', 'Cobertura%', 'Marcaciones', 'Compromisos', 'M.Recaudado']);

const byEmpresa = {};
for (const d of dataEquipo) {
  const emp = d.empresa || 'N/A';
  if (!byEmpresa[emp]) byEmpresa[emp] = { cartera: 0, gestionados: 0, marcaciones: 0, compromisos: 0, recaudado: 0 };
  byEmpresa[emp].cartera      += d.coberturaTotal;
  byEmpresa[emp].gestionados  += d.coberturaGest;
  byEmpresa[emp].marcaciones  += d.totalMarcaciones;
  byEmpresa[emp].compromisos  += d.compromisos;
  byEmpresa[emp].recaudado    += d.montoRecaudado;
}
for (const [emp, totales] of Object.entries(byEmpresa)) {
  const pct = totales.cartera > 0
    ? Math.min(100, Math.round(totales.gestionados / totales.cartera * 100))
    : 0;
  wsSummary.addRow([emp, totales.cartera, totales.gestionados, pct, totales.marcaciones, totales.compromisos, totales.recaudado]);
}
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/supervisor.routes.js
git commit -m "feat(reports): add empresa dimension, real coverage %, nro_contrato dedup to Excel reports"
```

---

## Task 7: Frontend — selector empresa en JefePanel y ActividadGestores

**Files:**
- Modify: `src/renderer/supervisor/JefePanel.jsx`
- Modify: `src/renderer/supervisor/ActividadGestores.jsx`
- Modify: `src/renderer/supervisor/DashboardDirectivo.jsx`

- [ ] **Step 1: Agregar estado `empresa` en JefePanel**

En JefePanel, cerca de los otros estados de filtro:

```jsx
const [empresa, setEmpresa] = useState(''); // '' = ambas

// Selector UI (agregar junto al selector de campaña):
<select value={empresa} onChange={e => setEmpresa(e.target.value)}
  style={{ marginLeft: 8, padding: '4px 8px', borderRadius: 4 }}>
  <option value="">Todas las empresas</option>
  <option value="TEC_SAS">Uphone TEC SAS</option>
  <option value="SCC">Uphone SCC</option>
</select>
```

- [ ] **Step 2: Propagar `empresa` a todas las llamadas API del JefePanel**

En todas las funciones que llaman `/api/jefe/*` y `/api/reports/*`:

```js
const params = new URLSearchParams({ ...otrosParams });
if (empresa) params.set('empresa', empresa);
const url = `${apiBase}/jefe/productividad?${params}`;
```

- [ ] **Step 3: Mostrar `por_empresa` en dashboard**

En el componente de métricas del JefePanel, si `empresa === ''`, mostrar desglose:

```jsx
{data.por_empresa && empresa === '' && (
  <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
    {['TEC_SAS', 'SCC'].map(emp => (
      <div key={emp} style={{ flex: 1, padding: 8, background: 'rgba(255,255,255,0.05)', borderRadius: 6 }}>
        <div style={{ fontSize: 11, opacity: 0.6 }}>{emp === 'TEC_SAS' ? 'Uphone TEC SAS' : 'Uphone SCC'}</div>
        <div>{data.por_empresa[emp]?.gestionados || 0} / {data.por_empresa[emp]?.total || 0}</div>
        <div style={{ fontSize: 11 }}>
          {data.por_empresa[emp]?.total > 0
            ? Math.min(100, Math.round(data.por_empresa[emp].gestionados / data.por_empresa[emp].total * 100))
            : 0}%
        </div>
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 4: Agregar `empresa` prop a ActividadGestores**

```jsx
// En JefePanel donde se renderiza ActividadGestores:
<ActividadGestores
  apiBase={apiBase}
  authToken={authToken}
  refreshSignal={actividadRefresh}
  estadosWS={estadosWS}
  campanas={campanas}
  empresa={empresa}   // ← nuevo
/>

// En ActividadGestores.jsx, agregar al URLSearchParams de cargar():
if (empresa) qs.set('empresa', empresa);
// Y al useEffect:
useEffect(() => { cargar(fecha, campanaId, empresa); }, [fecha, campanaId, empresa, cargar]);
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/supervisor/JefePanel.jsx src/renderer/supervisor/ActividadGestores.jsx src/renderer/supervisor/DashboardDirectivo.jsx
git commit -m "feat(ui): add empresa selector to JefePanel, ActividadGestores, DashboardDirectivo"
```

---

## Task 8: Validación final y documentación de llave

**Files:**
- Modify: `docs/DOMAIN-RULES.md`
- Modify: `docs/KNOWN-ISSUES.md`

- [ ] **Step 1: Verificar cobertura nunca > 100% en todos los reportes**

```bash
# Descargar reporte Excel y verificar:
curl "http://localhost:3001/api/reports/equipo?fechaDesde=2026-07-01&fechaHasta=2026-07-25" \
  -H "Authorization: Bearer TOKEN" --output test.xlsx
# Abrir test.xlsx y verificar que Cobertura% máximo = 100
```

- [ ] **Step 2: Verificar que `clave_gestion` es única por campaña+contrato**

```sql
-- Debe ser 0 duplicados
SELECT clave_gestion, COUNT(*) FROM contactos
GROUP BY clave_gestion HAVING COUNT(*) > 1;
```

- [ ] **Step 3: Documentar reglas de la llave en DOMAIN-RULES.md**

Agregar sección:

```markdown
## Llave de Gestión (clave_gestion)

Formato: `{empresa}|{nro_contrato}|{campana_id}`

Reglas:
- Empresa: 'TEC_SAS' (fecha_venta >= 2026-01-01) | 'SCC' (anterior)
- nro_contrato: campo `Nº CONTRATO` del Excel de apertura (no cédula)
- Un cliente con 2 contratos = 2 claves distintas = 2 unidades de gestión independientes
- El mismo contrato en S0, S1, S2 = 1 sola clave = 1 unidad de cobertura
- Cobertura = COUNT(DISTINCT clave_gestion WHERE has_cdr) / COUNT(DISTINCT clave_gestion) ≤ 100%
- Gestiones (CDRs) pueden ser mayores que contratos únicos (múltiples llamadas al mismo cliente)
```

- [ ] **Step 4: Commit final**

```bash
git add docs/DOMAIN-RULES.md docs/KNOWN-ISSUES.md
git commit -m "docs: document clave_gestion rules, empresa dimension, coverage formula"
git push
```

---

## Checklist de validación

- [ ] Cobertura `/jefe/productividad` ≤ 100% siempre
- [ ] `cartera_total` = contratos únicos por `nro_contrato` (no cédula)
- [ ] Filtro `?empresa=TEC_SAS` funciona en todos los endpoints
- [ ] Excel: columna "Empresa", "Cartera Única", "Cobertura%" presente
- [ ] Excel: hoja "Resumen por Empresa" con totales
- [ ] `clave_gestion` sin duplicados en DB
- [ ] Selector empresa en JefePanel filtra todo el dashboard
- [ ] ActividadGestores respeta filtro empresa
- [ ] Push a main con CI verde
