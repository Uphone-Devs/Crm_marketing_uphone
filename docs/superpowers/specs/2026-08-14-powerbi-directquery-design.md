# Power BI DirectQuery — Diseño de Integración

**Fecha:** 2026-08-14  
**Enfoque:** B — Read-only user + Vista de mapeo email→supervisor  
**Modo:** DirectQuery (tiempo real, sin import/cache)

---

## Arquitectura

```
Power BI Desktop (PC dev)
    │ PostgreSQL connector (npgsql driver)
    │ DirectQuery → IP_VM:5432 (solo durante desarrollo)
    ▼
[VM Azure — Windows Server]
    ├── PostgreSQL :5432
    │     ├── schema public (todas las tablas — acceso total bi_readonly)
    │     ├── usuario: bi_readonly (SELECT only)
    │     └── VIEW v_bi_usuario_area  ← nueva
    │
    └── On-premises Data Gateway (ya instalado y conectado)
          │ conecta a localhost:5432
          ▼
Power BI Service (nube)
    ├── Dataset en modo DirectQuery
    │     └── RLS roles: "Admin" (sin filtro) + "JefeArea" (filtra por supervisor_id)
    └── Reportes / dashboards publicados por analista
```

**Flujo RLS:**
1. Usuario inicia sesión en Power BI Service con email corporativo
2. Power BI evalúa `USERPRINCIPALNAME()` → busca en `v_bi_usuario_area` → obtiene `supervisor_id`
3. DAX filtra `contactos`, `cdrs`, `usuarios` por ese `supervisor_id`
4. Gateway traduce a SQL → ejecuta en Postgres con `bi_readonly`

**Sin cambios en la app CRM.** Solo DB + Power BI config.

---

## Cambios en PostgreSQL

### Usuario `bi_readonly`

```sql
CREATE USER bi_readonly WITH PASSWORD 'BI_PASS_AQUI'
  NOSUPERUSER NOCREATEDB NOCREATEROLE;

GRANT CONNECT ON DATABASE crm_marketing TO bi_readonly;
GRANT USAGE ON SCHEMA public TO bi_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO bi_readonly;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO bi_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO bi_readonly;

-- Explícito: sin escritura
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON ALL TABLES IN SCHEMA public FROM bi_readonly;
```

### Vista `v_bi_usuario_area`

```sql
CREATE OR REPLACE VIEW v_bi_usuario_area AS
SELECT
    u.id            AS usuario_id,
    u.email,
    u.nombre,
    u.rol::text     AS rol,
    u.supervisor_id,
    sup.email       AS supervisor_email
FROM usuarios u
LEFT JOIN usuarios sup ON sup.id = u.supervisor_id;

GRANT SELECT ON v_bi_usuario_area TO bi_readonly;
```

Permite DAX: `LOOKUPVALUE(v_bi_usuario_area[supervisor_id], v_bi_usuario_area[email], USERPRINCIPALNAME())`

### Índices nuevos para queries analíticas

```sql
-- cdrs agrupados por usuario + fecha
CREATE INDEX IF NOT EXISTS idx_cdrs_usuario_fecha
  ON cdrs (usuario_id,
           DATE(timestamp_inicio AT TIME ZONE 'America/Guayaquil'));

-- contactos por empresa + campaña
CREATE INDEX IF NOT EXISTS idx_ct_empresa_campana
  ON contactos (empresa, campana_id);

-- validacion_pagos por fecha
CREATE INDEX IF NOT EXISTS idx_vp_fecha
  ON validacion_pagos (DATE(validado_en AT TIME ZONE 'America/Guayaquil'));
```

**Migración Prisma oficial** — `backend/prisma/migrations/20260814000000_bi_readonly_setup/migration.sql`

Todo el SQL (usuario, grants, vista, índices) va en esa migración. `prisma migrate deploy` en el VM la aplica igual que las 15 migraciones anteriores — nada queda suelto fuera del sistema de migraciones.

> ⚠️ El password de `bi_readonly` NO va en la migración. La migración crea el usuario con un placeholder; el DBA lo cambia con `ALTER USER bi_readonly PASSWORD '...'` fuera de git.

---

## Row-Level Security en Power BI

### Roles

| Rol | Filtro DAX | Asignado a |
|-----|-----------|------------|
| `Admin` | sin filtro | Admin / analista |
| `JefeArea` | ver abajo | Jefes de área |

### Filtro DAX — tabla `usuarios` (rol JefeArea)

```dax
[supervisor_id] = LOOKUPVALUE(
    v_bi_usuario_area[supervisor_id],
    v_bi_usuario_area[email], USERPRINCIPALNAME()
)
|| [id] = LOOKUPVALUE(
    v_bi_usuario_area[usuario_id],
    v_bi_usuario_area[email], USERPRINCIPALNAME()
)
```

Esto asegura que el jefe ve a sus asesores Y a sí mismo en la tabla usuarios.  
Las demás tablas (`contactos`, `cdrs`) se filtran en cascada a través de las relaciones del modelo.

---

## Performance

### Índices existentes — suficientes para DirectQuery

| Índice | Tabla | Cubre |
|--------|-------|-------|
| `idx_cdrs_ts` | cdrs.timestamp_inicio | Filtros por fecha |
| `idx_cdrs_contacto_id_desc` | cdrs.(contacto_id, id DESC) | CDRs por contacto |
| `idx_ct_campana_fecha` | contactos.(campana_id, fecha_asignacion) | Cartera por campaña |
| `idx_mda_fecha` | metricas_diarias_asesor.fecha | Dashboards históricos |
| `idx_usuarios_supervisor_id` | usuarios.supervisor_id | RLS join |

### Configuración Gateway

- Query timeout: **120 segundos**
- Conexión: `localhost:5432` / DB `crm_marketing` / usuario `bi_readonly`

### Riesgo analista

Cross-joins sin filtro de fecha sobre `cdrs` × `contactos` pueden ser lentos.  
Documentar: siempre aplicar filtro de fecha o campaña antes de cruzar tablas grandes.

---

## Seguridad

- `bi_readonly` password en `.env` del VM como `BI_DB_PASSWORD` — nunca en código
- Puerto 5432 **no se abre** al exterior — Gateway accede solo por `localhost`
- Acceso desde PC dev: túnel SSH `ssh -L 5432:localhost:5432 usuario@vm-ip`
- `bi_readonly` tiene solo `SELECT` — confirmado con REVOKE explícito

---

## Orden de implementación

| # | Paso | Estado |
|---|------|--------|
| 1 | Crear migración Prisma `20260814000000_bi_readonly_setup/migration.sql` | pendiente |
| 2 | `prisma migrate deploy` en VM → aplica usuario + grants + vista + índices | pendiente |
| 3 | DBA cambia password: `ALTER USER bi_readonly PASSWORD '...'` en VM | pendiente |
| 4 | En Gateway (ya instalado): agregar fuente de datos PostgreSQL con `bi_readonly` | pendiente |
| 5 | Instalar npgsql en PC dev → conectar Power BI Desktop → validar todas las tablas | pendiente |
| 6 | Publicar dataset a Power BI Service → vincular al Gateway existente | pendiente |
| 7 | Definir roles RLS en dataset → asignar usuarios → validar aislamiento jefe_area | pendiente |

---

## Fuera de scope

- No se modifica la app CRM
- No se crean reportes en Power BI (trabajo del analista)
- No se instala el Gateway (ya está conectado)
- No se crea schema `bi` separado (analista accede a tablas crudas)
