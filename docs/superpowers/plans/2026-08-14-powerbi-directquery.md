# Power BI DirectQuery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conectar Power BI al PostgreSQL de producción en modo DirectQuery con usuario read-only aislado y RLS por jefe de área.

**Architecture:** Migración Prisma crea usuario `bi_readonly` (SELECT-only) + VIEW `v_bi_usuario_area` para RLS. Gateway ya instalado en VM conecta a `localhost:5432`. Power BI Service usa RLS con `USERPRINCIPALNAME()` mapeado a `supervisor_id` via la vista.

**Tech Stack:** PostgreSQL 14+, Prisma migrations, Power BI Desktop (npgsql driver), Power BI Service, On-premises Data Gateway.

---

## Archivos

| Archivo | Acción |
|---------|--------|
| `backend/prisma/migrations/20260814000000_bi_readonly_setup/migration.sql` | Crear |

---

## Task 1: Crear migración Prisma `bi_readonly_setup`

**Files:**
- Create: `backend/prisma/migrations/20260814000000_bi_readonly_setup/migration.sql`

- [ ] **Step 1: Crear directorio de migración**

```powershell
New-Item -ItemType Directory -Force -Path "backend\prisma\migrations\20260814000000_bi_readonly_setup"
```

- [ ] **Step 2: Escribir el archivo `migration.sql`**

Crear `backend/prisma/migrations/20260814000000_bi_readonly_setup/migration.sql` con el siguiente contenido exacto:

```sql
-- Migración: bi_readonly_setup
-- Crea usuario de solo lectura para Power BI DirectQuery.
-- El password NO se setea aquí (queda bloqueado hasta que el DBA
-- ejecute: ALTER USER bi_readonly PASSWORD 'tu_password_seguro';)

-- ── 1. Crear usuario si no existe ─────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_roles WHERE rolname = 'bi_readonly'
  ) THEN
    CREATE USER bi_readonly
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      LOGIN;
  END IF;
END
$$;

-- ── 2. Permisos de conexión y schema ──────────────────────────
GRANT CONNECT ON DATABASE crm_marketing TO bi_readonly;
GRANT USAGE ON SCHEMA public TO bi_readonly;

-- ── 3. SELECT en todas las tablas y secuencias existentes ─────
GRANT SELECT ON ALL TABLES IN SCHEMA public TO bi_readonly;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO bi_readonly;

-- ── 4. SELECT automático en tablas futuras ────────────────────
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO bi_readonly;

-- ── 5. Revocar escritura explícitamente ───────────────────────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON ALL TABLES IN SCHEMA public FROM bi_readonly;

-- ── 6. Vista de mapeo email → supervisor (usada por RLS DAX) ──
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

-- ── 7. Índices nuevos para queries analíticas ─────────────────

-- cdrs agrupados por usuario + fecha Guayaquil
-- (Power BI filtrará mucho por usuario_id + rango de fecha)
CREATE INDEX IF NOT EXISTS idx_cdrs_usuario_fecha
  ON cdrs (
    usuario_id,
    DATE(timestamp_inicio AT TIME ZONE 'America/Guayaquil')
  );

-- contactos por empresa + campaña
-- (filtro frecuente en reportes de cobranza por empresa)
CREATE INDEX IF NOT EXISTS idx_ct_empresa_campana
  ON contactos (empresa, campana_id);

-- validacion_pagos por fecha Guayaquil
-- (reportes de pagos validados por día)
CREATE INDEX IF NOT EXISTS idx_vp_fecha
  ON validacion_pagos (
    DATE(validado_en AT TIME ZONE 'America/Guayaquil')
  );
```

- [ ] **Step 3: Verificar que Prisma reconoce la migración**

```powershell
cd backend
npx prisma migrate status
```

Esperado: la migración `20260814000000_bi_readonly_setup` aparece como **"Not yet applied"** (o "Pending"). Si aparece como "Applied" ya fue ejecutada antes — revisar con el DBA.

- [ ] **Step 4: Commit de la migración**

```bash
git add backend/prisma/migrations/20260814000000_bi_readonly_setup/migration.sql
git commit -m "feat(db): add bi_readonly user, v_bi_usuario_area view and BI indexes"
```

---

## Task 2: Aplicar migración en VM de producción

**Files:** ninguno (operación en VM)

> ⚠️ Ejecutar en el VM Azure (Windows Server) donde corre PostgreSQL y el backend.

- [ ] **Step 1: Pull del commit en VM**

```powershell
# En el VM, dentro de la carpeta del proyecto
git pull origin main
```

Verificar que aparece el archivo `backend/prisma/migrations/20260814000000_bi_readonly_setup/migration.sql`.

- [ ] **Step 2: Aplicar migración**

```powershell
cd backend
npx prisma migrate deploy
```

Esperado en output:
```
1 migration found in prisma/migrations

Applying migration `20260814000000_bi_readonly_setup`

The following migration(s) have been applied:

migrations/
  └─ 20260814000000_bi_readonly_setup/
    └─ migration.sql
```

Si aparece error `role "bi_readonly" already exists` — ignorar, el `DO $$ IF NOT EXISTS` lo maneja. Si aparece otro error, leer el mensaje y corregir.

- [ ] **Step 3: Setear password del usuario bi_readonly**

Conectar a PostgreSQL como superusuario y ejecutar:

```sql
ALTER USER bi_readonly PASSWORD 'TU_PASSWORD_SEGURO_AQUI';
```

Guardar el password en el gestor de contraseñas del equipo. **Nunca en git.**

- [ ] **Step 4: Verificar usuario y vista creados**

```sql
-- Verificar usuario
SELECT rolname, rolcanlogin, rolsuper FROM pg_roles WHERE rolname = 'bi_readonly';
-- Esperado: rolcanlogin=true, rolsuper=false

-- Verificar vista
SELECT * FROM v_bi_usuario_area LIMIT 3;
-- Esperado: filas con usuario_id, email, nombre, rol, supervisor_id, supervisor_email

-- Verificar índices nuevos
SELECT indexname FROM pg_indexes
WHERE tablename IN ('cdrs','contactos','validacion_pagos')
  AND indexname IN ('idx_cdrs_usuario_fecha','idx_ct_empresa_campana','idx_vp_fecha');
-- Esperado: 3 filas
```

- [ ] **Step 5: Probar conexión con bi_readonly**

```powershell
psql -U bi_readonly -d crm_marketing -h localhost -c "SELECT COUNT(*) FROM contactos;"
```

Esperado: número de registros sin error. Si pide password, ingresarlo.

- [ ] **Step 6: Verificar que bi_readonly NO puede escribir**

```powershell
psql -U bi_readonly -d crm_marketing -h localhost -c "DELETE FROM config WHERE 1=0;"
```

Esperado: `ERROR: permission denied for table config`

---

## Task 3: Configurar fuente de datos en Gateway

**Files:** ninguno (configuración en UI del Gateway)

> Realizarlo en el VM Azure donde está el On-premises Data Gateway instalado.

- [ ] **Step 1: Abrir On-premises Data Gateway en VM**

Abrir la aplicación "On-premises data gateway" en el VM.

- [ ] **Step 2: Agregar fuente de datos PostgreSQL**

En la pestaña **"Data sources"** → **"Add data source"**:

| Campo | Valor |
|-------|-------|
| Data source type | PostgreSQL |
| Server | `localhost` |
| Database | `crm_marketing` |
| Authentication method | Basic |
| Username | `bi_readonly` |
| Password | (el password seteado en Task 2 Step 3) |

- [ ] **Step 3: Verificar conexión**

Hacer clic en **"Test connection"**.  
Esperado: `"Connection successful."`

---

## Task 4: Conectar Power BI Desktop

**Files:** ninguno (configuración en Power BI Desktop — PC de desarrollo)

- [ ] **Step 1: Instalar driver npgsql**

Descargar e instalar **Npgsql** (PostgreSQL connector para Power BI):  
`https://github.com/npgsql/npgsql/releases` → instalar el `.msi` de la última release estable.

Reiniciar Power BI Desktop después de instalar.

- [ ] **Step 2: Conectar a PostgreSQL en modo DirectQuery**

En Power BI Desktop:  
**Inicio → Obtener datos → PostgreSQL**

| Campo | Valor |
|-------|-------|
| Servidor | IP del VM (ej: `20.x.x.x`) o `localhost` si hay túnel SSH |
| Base de datos | `crm_marketing` |
| Modo de conectividad de datos | **DirectQuery** |

Credenciales: usuario `bi_readonly` + password.

> Para acceso desde PC dev sin exponer puerto 5432: abrir túnel SSH primero:
> ```powershell
> ssh -L 5432:localhost:5432 usuario@IP_VM
> ```
> Luego conectar a `localhost` en Power BI.

- [ ] **Step 3: Validar que todas las tablas y la vista aparecen**

En el Navigator de Power BI, verificar que se ven:
- `agendamientos`, `campanas`, `cdrs`, `config`, `contactos`
- `eventos`, `indicadores_datos`, `mensajes_broadcast`
- `metricas_diarias_asesor`, `segmentos_config`
- `sesiones`, `sub_gestiones`, `tipificaciones`
- `update_policy`, `usuarios`
- `validacion_pagos`, `validacion_sesiones`
- **`v_bi_usuario_area`** ← confirmar que aparece

Seleccionar todas → **Cargar**.

- [ ] **Step 4: Definir roles RLS en Power BI Desktop**

**Modelado → Administrar roles → Crear rol**

**Rol: `Admin`**  
Sin filtros — admin ve todo.

**Rol: `JefeArea`**  
Tabla: `usuarios`, filtro DAX:

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

Este filtro hace que el jefe vea sus asesores (`supervisor_id = jefe.id`) Y a sí mismo (`id = jefe.id`). Las tablas `contactos` y `cdrs` se filtran en cascada a través de las relaciones del modelo.

- [ ] **Step 5: Probar RLS localmente**

**Modelado → Ver como → Roles: JefeArea**  
Ingresar email de un jefe de área real (ej: `jaquelinequinatoa@uphone.local`).

Verificar en tabla `usuarios`: solo aparecen el jefe y sus asesores.  
Verificar en tabla `contactos`: solo aparecen contactos asignados al equipo de ese jefe.

---

## Task 5: Publicar a Power BI Service

**Files:** ninguno (publicación desde Power BI Desktop)

- [ ] **Step 1: Publicar dataset**

En Power BI Desktop: **Inicio → Publicar**  
Seleccionar workspace de destino → Publicar.

Esperado: `"Publishing to Power BI... Success!"`

- [ ] **Step 2: Vincular dataset al Gateway en Power BI Service**

En Power BI Service → **Workspaces → [tu workspace] → Datasets → [nombre del dataset] → Configuración**

En sección **"Gateway connections"**:  
Seleccionar el Gateway instalado en VM → seleccionar la fuente de datos `crm_marketing` (bi_readonly).  
Guardar.

- [ ] **Step 3: Asignar usuarios a roles RLS**

En Power BI Service → **Dataset → Seguridad**

| Rol | Emails a asignar |
|-----|-----------------|
| `Admin` | jhonguaman.a@uphone.local (u otros admins/analistas) |
| `JefeArea` | jaquelinequinatoa@uphone.local (y demás jefes de área) |

- [ ] **Step 4: Verificar aislamiento RLS en Service**

En Power BI Service → **Dataset → Seguridad → Probar como rol: JefeArea**  
Ingresar email de jefe de área.

Verificar:
- Tabla `usuarios`: solo ve su equipo
- Tabla `contactos`: solo ve contactos de su equipo
- Tabla `cdrs`: solo ve CDRs de su equipo

- [ ] **Step 5: Verificar que Admin ve todo**

Probar como rol `Admin` → verificar que aparecen todos los usuarios y contactos de todas las áreas.

---

## Notas de riesgo

1. **Password en migración:** La migración NO setea password — `bi_readonly` queda bloqueado hasta que el DBA ejecute `ALTER USER bi_readonly PASSWORD '...'` manualmente. Sin ese paso, Gateway no puede conectar.

2. **Puerto 5432 no expuesto:** Acceso desde PC dev requiere túnel SSH. No abrir 5432 al exterior.

3. **Analista sin filtro de fecha:** Cross-joins sobre `cdrs` × `contactos` sin filtro pueden ser lentos (cdrs puede tener millones de filas). Documentar al analista: siempre filtrar por fecha o campaña primero.

4. **ALTER DEFAULT PRIVILEGES:** Solo aplica a tablas creadas DESPUÉS de la migración por el rol que ejecutó el GRANT. Si en el futuro se agregan tablas con un rol diferente, repetir el GRANT manualmente.

5. **`rolname = 'jefe_area'` en RLS:** La columna `rol` en `usuarios` es un enum de Postgres. La vista `v_bi_usuario_area` lo castea a `TEXT` con `u.rol::text` para que Power BI lo trate como string en DAX.
