# Diccionario de Datos — CRM Marketing Uphone

> **Motor:** PostgreSQL · **ORM:** Prisma · **Schema:** `backend/prisma/schema.prisma`
> **Última revisión:** 2026-08-20

---

## Índice

1. [Tablas](#tablas)
2. [Enumeraciones](#enumeraciones)
3. [Vistas](#vistas)
4. [Relaciones clave](#relaciones-clave)
5. [Índices de performance](#índices-de-performance)
6. [Notas operacionales](#notas-operacionales)

---

## Tablas

### `usuarios`

Cuentas del sistema. Un usuario puede ser asesor, jefe de área o admin. Los asesores tienen `supervisor_id → usuarios.id`.

| Columna | Tipo | Nulo | Default | Descripción |
|---------|------|------|---------|-------------|
| `id` | `Int` | NO | autoincrement | PK |
| `nombre` | `String` | NO | — | Nombre completo |
| `email` | `String` | NO | — | UNIQUE. Login |
| `password_hash` | `String` | NO | — | bcrypt |
| `rol` | `Rol` | NO | `asesor` | jefe_area · asesor · admin |
| `estado` | `EstadoUsuario` | NO | `activo` | activo · inactivo |
| `creado_en` | `DateTime` | NO | `now()` | Timestamp de creación |
| `supervisor_id` | `Int` | SÍ | null | FK → usuarios.id (jefe directo) |

**Índices:** `idx_usuarios_supervisor_id`, `idx_usuarios_rol_estado`

---

### `campanas`

Campañas de cobranza. Agrupan contactos bajo un supervisor responsable.

| Columna | Tipo | Nulo | Default | Descripción |
|---------|------|------|---------|-------------|
| `id` | `Int` | NO | autoincrement | PK |
| `nombre` | `String` | NO | — | Nombre de la campaña |
| `descripcion` | `String` | SÍ | null | Descripción libre |
| `fecha_inicio` | `DateTime` | SÍ | null | Inicio operativo |
| `fecha_fin` | `DateTime` | SÍ | null | Cierre planificado |
| `supervisor_id` | `Int` | SÍ | null | FK → usuarios.id |
| `estado` | `EstadoCampana` | NO | `activa` | activa · pausada · finalizada |
| `meta_diaria` | `Float` | NO | `0` | Meta de gestiones por día |
| `empresa` | `String` | SÍ | null | Empresa dueña de la cartera (TEC SAS, CREDI TV, etc.) |

**Índices:** `idx_campanas_empresa`

---

### `contactos`

Deudores/clientes de la cartera. Un contacto pertenece a una campaña y puede estar asignado a un asesor.

| Columna | Tipo | Nulo | Default | Descripción |
|---------|------|------|---------|-------------|
| `id` | `Int` | NO | autoincrement | PK |
| `campana_id` | `Int` | NO | — | FK → campanas.id |
| `cedula` | `String` | SÍ | null | Cédula/identificación |
| `nombre_deudor` | `String` | SÍ | null | Nombre del deudor |
| `telefono` | `String` | NO | — | Teléfono principal de marcación |
| `monto_deuda` | `Decimal(12,2)` | SÍ | null | Monto total de la deuda |
| `producto` | `String` | SÍ | null | Producto financiero |
| `estado_marcacion` | `EstadoMarcacion` | NO | `PENDIENTE` | Estado actual del contacto |
| `intentos_realizados` | `Int` | NO | `0` | Acumulado de gestiones |
| `asignado_a` | `Int` | SÍ | null | FK → usuarios.id (asesor) |
| `metadata` | `Json` | SÍ | null | Campos extra de Excel: DIAS IMPAGO, VALOR EN MORA, etc. |
| `whatsapp_status` | `String` | NO | `'INACTIVO'` | ACTIVO / INACTIVO — canal habilitado |
| `rcs_status` | `String` | NO | `'ACTIVO'` | ACTIVO / INACTIVO |
| `correo_status` | `String` | NO | `'INACTIVO'` | ACTIVO / INACTIVO |
| `ya_pago` | `Boolean` | NO | `false` | Flag de pago confirmado |
| `validado_pago` | `Boolean` | NO | `false` | Pago validado por supervisor |
| `fecha_asignacion` | `DateTime` | SÍ | null | Cuándo fue asignado al asesor |
| `orden_marcacion` | `Int` | SÍ | null | Prioridad dentro de la cartera del asesor |
| `wsp_enviado_fecha` | `String` | SÍ | null | Fecha último WhatsApp enviado (string YYYY-MM-DD) |
| `rcs_enviado_fecha` | `String` | SÍ | null | Fecha último RCS enviado |
| `correo_enviado_fecha` | `String` | SÍ | null | Fecha último correo enviado |
| `nro_contrato` | `String` | SÍ | null | Número de contrato |
| `empresa` | `String` | SÍ | null | Empresa (denormalizado de campana) |
| `clave_gestion` | `String` | SÍ | null | Clave única de gestión externa |

**Índices:** `idx_contactos_orden_marcacion`, `idx_contactos_ya_pago`, `idx_ct_campana_fecha`, `idx_ct_nro_contrato`, `idx_ct_empresa`, `idx_ct_clave_gestion`, `idx_ct_telefono`, `idx_ct_cedula`, `idx_ct_asignado_estado`, `idx_ct_wsp_fecha`, `idx_ct_rcs_fecha`, `idx_ct_correo_fecha`

> **Nota `metadata`:** JSON libre cargado desde Excel. Claves frecuentes: `"DIAS IMPAGO"`, `"VALOR EN MORA"`, `"Nº CONTRATO"`, `"EMPRESA"`, `"CONTRATO REFINANCIADO"`.

---

### `tipificaciones`

Catálogo de resultados de gestión. Define si una gestión es efectiva, requiere agendamiento, etc.

| Columna | Tipo | Nulo | Default | Descripción |
|---------|------|------|---------|-------------|
| `id` | `Int` | NO | autoincrement | PK |
| `codigo` | `String` | NO | — | UNIQUE. Código corto (ej: "PMP", "NC") |
| `descripcion` | `String` | NO | — | Descripción legible |
| `requiere_agd` | `Boolean` | NO | `false` | Si true, obliga crear agendamiento |
| `categoria` | `String` | NO | `'NO_CONTACTADO'` | Categoría analítica |
| `finaliza_gestion` | `Boolean` | NO | `true` | Si true, cierra el ciclo de la gestión |

---

### `cdrs`

Call Detail Records — registro de cada gestión (llamada, WhatsApp, RCS, correo). Es la tabla transaccional central.

| Columna | Tipo | Nulo | Default | Descripción |
|---------|------|------|---------|-------------|
| `id` | `Int` | NO | autoincrement | PK |
| `contacto_id` | `Int` | NO | — | FK → contactos.id |
| `usuario_id` | `Int` | NO | — | FK → usuarios.id (asesor) |
| `tipificacion_id` | `Int` | SÍ | null | FK → tipificaciones.id |
| `timestamp_inicio` | `DateTime` | NO | — | **Naive-UTC** (wall-clock Guayaquil). Ver nota. |
| `timestamp_ringing` | `DateTime` | SÍ | null | Inicio ring |
| `timestamp_answered` | `DateTime` | SÍ | null | Contestó |
| `timestamp_fin` | `DateTime` | SÍ | null | Fin de llamada |
| `duracion_seg` | `Int` | NO | `0` | Duración en segundos |
| `latencia_ms` | `Int` | NO | `0` | Latencia de respuesta |
| `operadora` | `String` | SÍ | null | Operadora destino |
| `resultado` | `String` | SÍ | null | Resultado textual (también usado para reagendados/incumplidos) |
| `url_grabacion` | `String` | SÍ | null | URL de audio grabado |
| `notas` | `String` | SÍ | null | Observaciones del asesor |
| `canal` | `Canal` | NO | `llamada` | llamada · whatsapp · rcs · gmail |
| `creado_en` | `DateTime` | NO | `now()` | Timestamp de creación del registro |
| `monto_acordado` | `Decimal(12,2)` | SÍ | null | Monto comprometido en la gestión |
| `snapshot_nombre` | `String` | SÍ | null | Nombre del deudor al momento de gestionar |
| `snapshot_cedula` | `String` | SÍ | null | Cédula al momento de gestionar |
| `snapshot_telefono` | `String` | SÍ | null | Teléfono al momento de gestionar |
| `snapshot_empresa` | `String` | SÍ | null | Empresa al momento de gestionar |
| `scheduled_datetime` | `DateTime` | SÍ | null | Fecha/hora de compromiso agendado |

**Índices:** `idx_cdrs_usuario_ts`, `idx_cdrs_ts`, `idx_cdrs_contacto_id_desc`, `idx_cdrs_tipif`, `idx_cdrs_resultado`, `idx_cdrs_usuario_fecha` (fecha Guayaquil para BI)

> **CRÍTICO — `timestamp_inicio` naive-UTC:** El campo almacena la hora wall-clock de Guayaquil sin zona. Para obtener límites de día correctos usar `_gyeDayBounds()`. Las métricas del asesor se calculan por apertura/campaña vía `/metricas-campana/:id`, no por día calendario.

---

### `sesiones`

Sesiones de conexión de un usuario al sistema.

| Columna | Tipo | Nulo | Default | Descripción |
|---------|------|------|---------|-------------|
| `id` | `Int` | NO | autoincrement | PK |
| `usuario_id` | `Int` | NO | — | FK → usuarios.id |
| `inicio` | `DateTime` | NO | `now()` | Inicio de sesión |
| `fin` | `DateTime` | SÍ | null | Fin de sesión (null = activa) |
| `tipo_conexion` | `TipoConexion` | SÍ | null | USB · WIFI · LOCAL |

---

### `eventos`

Eventos de actividad dentro de una sesión: estado ADB, llamadas, conexiones, acciones rápidas.

| Columna | Tipo | Nulo | Default | Descripción |
|---------|------|------|---------|-------------|
| `id` | `Int` | NO | autoincrement | PK |
| `usuario_id` | `Int` | NO | — | FK → usuarios.id |
| `sesion_id` | `Int` | SÍ | null | FK → sesiones.id |
| `tipo` | `TipoEvento` | NO | — | ESTADO · LLAMADA · CONEXION · DESCONEXION · ACCION_RAPIDA |
| `estado_id` | `Int` | SÍ | null | Estado ADB del dispositivo |
| `duracion_seg` | `Int` | SÍ | null | Duración del evento |
| `timestamp` | `DateTime` | NO | `now()` | Momento del evento |
| `metadata` | `Json` | SÍ | null | Datos extra: canal (WSP/RCS/correo), detalles acción |

**Índices:** `idx_ev_usuario_tipo_ts`

---

### `agendamientos`

Compromisos de pago o llamadas agendadas para un contacto.

| Columna | Tipo | Nulo | Default | Descripción |
|---------|------|------|---------|-------------|
| `id` | `Int` | NO | autoincrement | PK |
| `contacto_id` | `Int` | NO | — | FK → contactos.id |
| `asesor_id` | `Int` | NO | — | FK → usuarios.id |
| `tipo` | `TipoAgendamiento` | NO | — | PMP · VOL_CALL |
| `fecha_hora` | `DateTime` | NO | — | Fecha/hora del compromiso |
| `notas` | `String` | SÍ | null | Observaciones |
| `estado` | `EstadoAgendamiento` | NO | `pendiente` | pendiente · ejecutado · cancelado |
| `creado_en` | `DateTime` | NO | `now()` | Timestamp de creación |

**Índices:** `idx_agendamientos_fecha_hora`, `idx_agendamientos_asesor_id`, `idx_agendamientos_estado`

---

### `mensajes_broadcast`

Mensajes enviados por supervisores a sus asesores (broadcast omnicanal).

| Columna | Tipo | Nulo | Default | Descripción |
|---------|------|------|---------|-------------|
| `id` | `Int` | NO | autoincrement | PK |
| `supervisor_id` | `Int` | NO | — | FK → usuarios.id |
| `mensaje` | `String` | NO | — | Cuerpo del mensaje |
| `segmento_destino` | `String` | NO | `'TODOS'` | Segmento de asesores destinatarios |
| `canal` | `String` | NO | `'TODOS'` | Canal de difusión |
| `asunto` | `String` | SÍ | null | Asunto (para correo) |
| `imagen_url` | `String` | SÍ | null | URL de imagen adjunta |
| `creado_en` | `DateTime` | NO | `now()` | Timestamp |
| `activo` | `Boolean` | NO | `true` | Visible para asesores |

---

### `indicadores_datos`

Caché de indicadores calculados por asesor, fecha y segmento. Llave compuesta `(asesor_id, fecha, segmento)`.

| Columna | Tipo | Nulo | Default | Descripción |
|---------|------|------|---------|-------------|
| `asesor_id` | `Int` | NO | — | PK parcial · FK → usuarios.id |
| `fecha` | `String` | NO | — | PK parcial · YYYY-MM-DD |
| `segmento` | `String` | NO | — | PK parcial · nombre del segmento |
| `valores` | `Json` | NO | `{}` | KPIs del segmento en esa fecha |

---

### `segmentos_config`

Configuración de segmentos de cartera (etiqueta, color, icono).

| Columna | Tipo | Nulo | Default | Descripción |
|---------|------|------|---------|-------------|
| `id` | `Int` | NO | autoincrement | PK |
| `clave` | `String(100)` | NO | — | UNIQUE. Identificador del segmento |
| `etiqueta` | `String(255)` | NO | — | Texto visible |
| `color` | `String(50)` | SÍ | null | Color CSS/hex |
| `icono` | `String(100)` | SÍ | null | Nombre de icono |

---

### `sub_gestiones`

Gestiones a referencias/terceros del deudor (familiares, conocidos). Vinculadas a un CDR padre.

| Columna | Tipo | Nulo | Default | Descripción |
|---------|------|------|---------|-------------|
| `id` | `Int` | NO | autoincrement | PK |
| `contacto_id` | `Int` | SÍ | null | FK → contactos.id (ON DELETE CASCADE) |
| `asesor_id` | `Int` | SÍ | null | FK → usuarios.id |
| `cdr_id` | `Int` | SÍ | null | FK → cdrs.id (gestión padre) |
| `telefono` | `String` | SÍ | null | Teléfono de la referencia |
| `notas` | `String` | SÍ | null | Observaciones |
| `nombre_ref` | `String` | SÍ | null | Nombre de la referencia |
| `parentesco` | `String` | SÍ | null | Relación con el deudor |
| `creado_en` | `DateTime` | SÍ | `now()` | Timestamp |

---

### `validacion_pagos`

Pagos reportados por asesores, pendientes o aprobados por supervisor.

| Columna | Tipo | Nulo | Default | Descripción |
|---------|------|------|---------|-------------|
| `id` | `Int` | NO | autoincrement | PK |
| `sesion_id` | `Int` | SÍ | null | FK → validacion_sesiones.id (ON DELETE CASCADE) |
| `contacto_id` | `Int` | SÍ | null | FK → contactos.id (ON DELETE CASCADE) |
| `nombre_deudor` | `String` | SÍ | null | Snapshot nombre |
| `cedula` | `String` | SÍ | null | Snapshot cédula |
| `contrato` | `String` | SÍ | null | Número de contrato |
| `empresa` | `String` | SÍ | null | Empresa |
| `campana_nombre` | `String` | SÍ | null | Snapshot nombre campaña |
| `asesor_nombre` | `String` | SÍ | null | Snapshot nombre asesor |
| `estado_pago` | `String` | SÍ | null | pagado · abono · excedente |
| `valor_en_mora` | `Decimal(12,2)` | SÍ | null | Deuda al momento de validar |
| `monto_pagado` | `Decimal(12,2)` | SÍ | null | Monto efectivamente pagado |
| `validado_por` | `Int` | SÍ | null | FK → usuarios.id (supervisor que validó) |
| `validado_en` | `DateTime` | SÍ | `now()` | Timestamp de validación |

**Índices:** `idx_vp_contacto`, `idx_vp_sesion`, `idx_vp_validado_en`, `idx_vp_fecha` (fecha Guayaquil para BI)

---

### `validacion_sesiones`

Sesión de validación grupal creada por un supervisor. Agrupa múltiples `validacion_pagos`.

| Columna | Tipo | Nulo | Default | Descripción |
|---------|------|------|---------|-------------|
| `id` | `Int` | NO | autoincrement | PK |
| `supervisor_id` | `Int` | SÍ | null | FK → usuarios.id |
| `creado_en` | `DateTime` | SÍ | `now()` | Timestamp |
| `n_pagado` | `Int` | SÍ | `0` | Cantidad de pagos completos |
| `n_excedente` | `Int` | SÍ | `0` | Cantidad excedentes |
| `n_abono` | `Int` | SÍ | `0` | Cantidad abonos |
| `monto_real` | `Decimal(12,2)` | SÍ | `0` | Monto total recaudado |
| `monto_abono` | `Decimal(12,2)` | SÍ | `0` | Monto de abonos |
| `registros` | `Int` | SÍ | `0` | Total de registros en la sesión |

**Índices:** `idx_vs_creado_en`

---

### `metricas_diarias_asesor`

Agregado diario por asesor. Llave compuesta `(asesor_id, fecha)`. Se incrementa al tipificar (PATCH `/cdrs/:id`). Reconstruible desde `cdrs` con `scripts/backfill-metricas-diarias.js`.

| Columna | Tipo | Nulo | Default | Descripción |
|---------|------|------|---------|-------------|
| `asesor_id` | `Int` | NO | — | PK parcial · FK → usuarios.id |
| `fecha` | `String` | NO | — | PK parcial · YYYY-MM-DD |
| `gestiones` | `Int` | NO | `0` | Total gestiones del día |
| `efectivos` | `Int` | NO | `0` | Gestiones con resultado efectivo |
| `neutros` | `Int` | NO | `0` | Gestiones neutras |
| `no_contact` | `Int` | NO | `0` | No contactados |
| `compromisos` | `Int` | NO | `0` | Compromisos de pago |
| `monto_acordado` | `Float` | NO | `0` | Suma montos acordados |
| `monto_recaudado` | `Float` | NO | `0` | Suma montos recaudados |
| `tiempo_aire_seg` | `Int` | NO | `0` | Segundos en llamada |
| `actualizado_en` | `DateTime` | NO | — | Auto-actualizado (updatedAt) |

**Índices:** `idx_mda_fecha`

---

### `config`

Configuración global clave-valor del sistema.

| Columna | Tipo | Nulo | Default | Descripción |
|---------|------|------|---------|-------------|
| `clave` | `String` | NO | — | PK. Identificador de config |
| `valor` | `String` | NO | — | Valor (texto) |

Claves comunes: `modo_marcacion`, `intentos_maximos`, flags de migración.

---

### `update_policy`

Política de ventana horaria para auto-actualizaciones del cliente Electron.

| Columna | Tipo | Nulo | Default | Descripción |
|---------|------|------|---------|-------------|
| `id` | `Int` | NO | `1` | PK (singleton) |
| `enabled` | `Boolean` | NO | `false` | Habilitado/deshabilitado |
| `start_time` | `String` | NO | `'13:00'` | Inicio ventana HH:MM |
| `end_time` | `String` | NO | `'14:00'` | Fin ventana HH:MM |
| `days` | `Int[]` | NO | `[1,2,3,4,5]` | Días de la semana (1=Lunes) |
| `check_interval_min` | `Int` | NO | `30` | Frecuencia de chequeo (minutos) |
| `updated_at` | `DateTime` | NO | — | Auto-actualizado |

---

## Enumeraciones

### `Rol`
| Valor | Descripción |
|-------|-------------|
| `jefe_area` | Supervisor de área, ve todos los asesores de su equipo |
| `asesor` | Gestiona contactos de su cartera asignada |
| `admin` | Acceso total, configuración del sistema |

### `EstadoUsuario`
| Valor | Descripción |
|-------|-------------|
| `activo` | Puede iniciar sesión |
| `inactivo` | Bloqueado |

### `EstadoCampana`
| Valor | Descripción |
|-------|-------------|
| `activa` | En operación |
| `pausada` | Temporalmente detenida |
| `finalizada` | Cerrada definitivamente |

### `EstadoMarcacion`
| Valor | Descripción |
|-------|-------------|
| `PENDIENTE` | No gestionado aún |
| `CONTACTADO` | Se habló con el deudor |
| `NO_CONTACTADO` | Intentos sin respuesta |
| `ENVIADO` | Mensaje enviado (WSP/RCS/correo) |
| `GESTIONADO` | Gestión completa |
| `EN_INTENTOS` | En proceso de intentos |
| `AGENDADO` | Tiene compromiso agendado |
| `YA_PAGO` | Pago confirmado |

### `Canal`
| Valor | Descripción |
|-------|-------------|
| `llamada` | Llamada telefónica ADB |
| `whatsapp` | Mensaje WhatsApp |
| `rcs` | Rich Communication Services |
| `gmail` | Correo electrónico |

### `TipoAgendamiento`
| Valor | Descripción |
|-------|-------------|
| `PMP` | Promesa de pago |
| `VOL_CALL` | Llamada voluntaria agendada |

### `EstadoAgendamiento`
| Valor | Descripción |
|-------|-------------|
| `pendiente` | Aún no ejecutado |
| `ejecutado` | Completado |
| `cancelado` | Cancelado |

### `TipoEvento`
| Valor | Descripción |
|-------|-------------|
| `ESTADO` | Cambio de estado ADB del dispositivo |
| `LLAMADA` | Evento de llamada |
| `CONEXION` | Asesor conectado |
| `DESCONEXION` | Asesor desconectado |
| `ACCION_RAPIDA` | Acción rápida del asesor (WSP, RCS, correo) |

### `TipoConexion`
| Valor | Descripción |
|-------|-------------|
| `USB` | Dispositivo conectado por USB |
| `WIFI` | Dispositivo por WiFi |
| `LOCAL` | Conexión local |

---

## Vistas

### `v_bi_usuario_area`
Mapeo usuario → supervisor. Usada por Power BI para Row Level Security (RLS/DAX).

```sql
SELECT u.id AS usuario_id, u.email, u.nombre, u.rol::text AS rol,
       u.supervisor_id, sup.email AS supervisor_email
FROM usuarios u
LEFT JOIN usuarios sup ON sup.id = u.supervisor_id;
```

### `vista_cdrs`
Vista restringida para Power BI DirectQuery.

```sql
SELECT contacto_id, resultado FROM cdrs;
```

### `vista_contactos`
Vista restringida para Power BI. Incluye `key_pagos` para cruce con pagos.

```sql
SELECT id AS contacto_id, estado_marcacion, intentos_realizados,
       asignado_a, whatsapp_status, rcs_status, correo_status,
       fecha_asignacion, nro_contrato,
       CONCAT(nro_contrato, '-', DATE(fecha_asignacion)) AS key_pagos
FROM contactos;
```

### `vista_usuarios`
Vista restringida para Power BI.

```sql
SELECT id AS id_usuario, nombre, rol::text AS rol, estado FROM usuarios;
```

### `vista_agendamientos`
Vista restringida para Power BI.

```sql
SELECT contacto_id, fecha_hora AS fecha_pago_comp, creado_en, estado
FROM agendamientos;
```

> **Acceso:** El usuario `bi_readonly` (PostgreSQL) solo puede leer estas 5 vistas. Sin acceso directo a tablas base.

---

## Relaciones clave

```
usuarios ──┬── (supervisor_id) ──► usuarios          [auto-referencia jefe/asesor]
           ├── campanas (supervisor_id)
           ├── contactos (asignado_a)
           ├── cdrs (usuario_id)
           ├── sesiones (usuario_id)
           ├── eventos (usuario_id)
           ├── agendamientos (asesor_id)
           ├── mensajes_broadcast (supervisor_id)
           ├── sub_gestiones (asesor_id)
           ├── validacion_pagos (validado_por)
           └── validacion_sesiones (supervisor_id)

campanas ──── contactos (campana_id)

contactos ─┬── cdrs (contacto_id)
           ├── agendamientos (contacto_id)
           ├── sub_gestiones (contacto_id)  [ON DELETE CASCADE]
           └── validacion_pagos (contacto_id) [ON DELETE CASCADE]

cdrs ──────┬── tipificaciones (tipificacion_id)
           └── sub_gestiones (cdr_id)

validacion_sesiones ── validacion_pagos (sesion_id) [ON DELETE CASCADE]
```

---

## Índices de performance

| Índice | Tabla | Columnas | Propósito |
|--------|-------|----------|-----------|
| `idx_usuarios_supervisor_id` | usuarios | supervisor_id | Cargar equipo del jefe |
| `idx_usuarios_rol_estado` | usuarios | rol, estado | Filtrar asesores activos |
| `idx_campanas_empresa` | campanas | empresa | Reportes por empresa |
| `idx_contactos_orden_marcacion` | contactos | asignado_a, orden_marcacion | Cola de marcación del asesor |
| `idx_contactos_ya_pago` | contactos | ya_pago | Excluir pagados de cartera |
| `idx_ct_campana_fecha` | contactos | campana_id, fecha_asignacion | Reportes por campaña/período |
| `idx_ct_nro_contrato` | contactos | nro_contrato | Cruce con Excel de pagos |
| `idx_ct_empresa` | contactos | empresa | Filtro por empresa |
| `idx_ct_asignado_estado` | contactos | asignado_a, estado_marcacion | Cartera por estado |
| `idx_cdrs_usuario_ts` | cdrs | usuario_id, timestamp_inicio | Métricas asesor por tiempo |
| `idx_cdrs_usuario_fecha` | cdrs | usuario_id, DATE(ts GYE) | Power BI DirectQuery |
| `idx_cdrs_contacto_id_desc` | cdrs | contacto_id, id DESC | Última gestión de contacto |
| `idx_cdrs_resultado` | cdrs | resultado | Reagendados/incumplidos |
| `idx_vp_fecha` | validacion_pagos | DATE(validado_en GYE) | Reportes de pagos por día |
| `idx_ct_empresa_campana` | contactos | empresa, campana_id | BI cobranza por empresa |
| `idx_mda_fecha` | metricas_diarias_asesor | fecha | Dashboard histórico |

---

## Notas operacionales

### Timestamps naive-UTC
`cdrs.timestamp_inicio` almacena hora wall-clock de Guayaquil (UTC-5) sin zona explícita. Para calcular límites de día local usar `_gyeDayBounds()` en el backend. **No asumir UTC ni convertir automáticamente.**

### Métricas por apertura
Las métricas del asesor visibles en AsesorPanel se calculan por campaña/apertura via `/metricas-campana/:id`, no por día calendario. `metricas_diarias_asesor` es el histórico acumulado.

### Sistema de vueltas
- Vuelta 1: por `estado_marcacion`
- Vuelta 2+: por `intentos_realizados >= N` (acumulado)
- Excluir contactos con `ya_pago=true` o `compromisoVigente`

### Empresa en datos
La regla de empresa por Excel es: si `FECHA DE VENTA` serial ≥ 46023 → TEC SAS, de lo contrario → empresa original. Este valor se carga en `contactos.empresa` y `campanas.empresa` al importar.

### `bi_readonly` (PostgreSQL)
Usuario de solo lectura para Power BI DirectQuery. Acceso restringido a las 5 vistas listadas. Password configurado manualmente por DBA con `ALTER USER bi_readonly PASSWORD '...'`.
