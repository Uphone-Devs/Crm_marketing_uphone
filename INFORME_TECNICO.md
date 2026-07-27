# Informe Técnico — CRM Marketing UPHONE
**Fecha:** Julio 2026  
**Desarrollador:** Jhon Guamán  
**Repositorio:** https://github.com/Uphone-Devs/Crm_marketing_uphone  

---

## 1. Descripción General del Sistema

**CRM Marketing UPHONE** es una aplicación de escritorio de gestión de cobranza y marketing desarrollada con tecnologías web modernas. Permite a los asesores de cobranza gestionar carteras de clientes, registrar tipificaciones de llamadas, monitorear métricas en tiempo real y generar reportes ejecutivos.

### 1.1 Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| **Escritorio** | Electron 35 + electron-vite |
| **Frontend** | React 19, Vite 7, Material Icons |
| **Backend** | Node.js 24, Express, Socket.io |
| **Base de datos** | PostgreSQL 18.4 |
| **ORM** | Prisma 7 con `@prisma/adapter-pg` |
| **Reportes** | ExcelJS 3.10 (XLSX multi-hoja) |
| **Autenticación** | JWT (8h expiración) |

### 1.2 Arquitectura

```
Electron App
  ├── Main Process (Node.js)
  │     ├── IPC Handlers (db:*, auth:*, app:*)
  │     ├── Scheduler agendamientos (60s tick)
  │     └── Gestión de proceso backend
  │
  ├── Renderer (React + Vite HMR)
  │     ├── LoginPage
  │     ├── AsesorPanel (gestión de cartera)
  │     ├── JefePanel / SupervisorPanel (monitoreo)
  │     └── AdminPanel (configuración)
  │
  └── Backend (Express + Socket.io — Puerto 3001)
        ├── /api/auth — autenticación JWT
        ├── /api/asesores — gestión de asesores
        ├── /api/actividad-tipificacion — métricas en tiempo real
        ├── /api/metricas/:id — métricas por asesor
        ├── /api/reports/* — generación de Excel
        └── WebSocket — eventos en tiempo real
```

---

## 2. Estadísticas del Sistema en Producción

| Métrica | Valor |
|---------|-------|
| Usuarios totales | 23 |
| Asesores activos | 19 |
| Contactos en cartera | 103,101 |
| CDRs registrados | 84,543 |
| Campañas creadas | 39 |
| Tipificaciones configuradas | 26 |
| Commits de desarrollo | 90+ |

---

## 3. Módulos Implementados

### 3.1 Panel del Asesor (`AsesorPanel.jsx`)

- **Cartera de contactos**: Lista de clientes asignados con estado de gestión
- **Marcación ADB**: Integración con Android Debug Bridge para marcación automática
- **Tipificación de llamadas**: 26 códigos de tipificación (CONTACTO EXITOSO, NEUTRO, NO CONTACTADO, etc.)
- **Mensajería multicanal**: Envío de WSP (WhatsApp), RCS y Correo electrónico
- **Métricas de productividad**: Contador de marcaciones, compromisos, tiempo al aire
- **Selección de campaña**: Filtro por campaña activa
- **Estado del asesor**: Disponible, Pausa, Capacitación, etc.

### 3.2 Panel del Jefe de Área (`JefePanel.jsx`)

- **Monitoreo en tiempo real**: Estado de cada asesor vía WebSocket
- **ActividadGestores**: Tabla de actividad con TOTAL LLAMADAS, categorías de tipificación, canales (WSP/RCS/CORREO), avance de cartera
- **Métricas de equipo**: Resumen consolidado de productividad
- **Filtro por empresa**: TODAS / UPHONE (TEC SAS + SCC) / CREDI TV
- **Filtro por campaña**: Drill-down por apertura específica
- **Eventos en tiempo real**: Log de tipificaciones, conexiones/desconexiones

### 3.3 Panel Supervisor (`SupervisorPanel.jsx`)

- **Carteras del equipo**: Vista general de avance por asesor
- **Compromisos**: Seguimiento de pagos acordados y cumplimiento
- **Validación de pagos**: Confirmación y registro de pagos recibidos
- **Contactabilidad**: Análisis de tasas de contacto por hora/segmento
- **Historial**: Trazabilidad de gestiones por período

### 3.4 Panel Administrativo (`AdminPanel.jsx`)

- **Gestión de usuarios**: Crear/editar asesores, jefes, supervisores
- **Carga de carteras**: Importación masiva de contactos desde Excel
- **Gestión de campañas**: Apertura y cierre de campañas
- **Backup de BD**: Descarga de pg_dump en un clic
- **Configuración de mensajes**: Plantillas WSP/RCS/Correo

### 3.5 Sistema de Reportes

| Reporte | Endpoint | Descripción |
|---------|----------|-------------|
| Gestiones equipo | `/reports/gestiones_equipo` | CDRs del equipo en período |
| Gestiones asesor | `/reports/gestiones` | CDRs por asesor |
| Reporte diario | `/reports/diario` | Resumen operativo diario |
| Vencimientos | `/reports/vencimientos_gestiones` | Gestiones por segmento mora |
| Contactabilidad hora | `/reports/contactabilidad_hora` | Contactabilidad por franja |
| Informe operativo | `/reports/informe_operativo` | Informe por asesor multi-hoja |
| Cuotas/Apertura | `/reports/cuotas_apertura` | Cruce con archivo de aperturas |

Todos los reportes soportan filtros: **fecha**, **empresa** (UPHONE/CREDI TV), **campaña**, **asesor**.

---

## 4. Dimensiones de Empresa

El sistema maneja tres entidades empresariales:

| Código DB | Nombre Mostrado | Regla |
|-----------|----------------|-------|
| `TEC_SAS` | TEC SAS | Fecha venta serial Excel ≥ 46023 |
| `SCC` | SCC | Fecha venta serial Excel < 46023 |
| `CREDI_TV` | CREDI TV | Campaña independiente |
| `UPHONE` | UPHONE | Agrupación TEC_SAS + SCC |

---

## 5. Sistema de Segmentación de Cartera

Los contactos se clasifican en 3 segmentos según días de mora:

| Segmento | Días de Mora | Prioridad |
|----------|-------------|-----------|
| S0 | 0 días | Baja |
| S1 | 1 día | Media |
| S2 | ≥ 2 días | Alta |

Las métricas de WSP/RCS/CORREO y el avance de cartera se detallan por segmento.

---

## 6. Tiempo Real (WebSocket)

### 6.1 Eventos emitidos por el asesor

| Evento | Descripción |
|--------|-------------|
| `METRICAS_ASESOR` | Actualización de métricas (marcaciones, compromisos, tiempos) |
| `TIPIFICACION_REALIZADA` | Nueva tipificación completada |
| `ASESOR_CONECTADO` | Asesor inicia sesión |
| `ASESOR_DESCONECTADO` | Asesor cierra sesión |
| `ESTADO_CAMBIO` | Cambio de estado (Disponible → Pausa, etc.) |

### 6.2 Fusión WS + DB

El supervisor fusiona datos en tiempo real (WS) con datos de DB (polling 30s):
- **Marcaciones/compromisos**: fuente WS, fallback DB
- **Avance cartera**: siempre desde DB (query exacta)
- **WSP/RCS/CORREO**: desde DB (`contactos.whatsapp_status = 'ENVIADO'`)

---

## 7. Bugs Corregidos (Sesión Actual)

### Bug 1 — TOTAL LLAMADAS menor que gestiones del asesor

**Problema:** El endpoint `/actividad-tipificacion` tenía `tipificacionId: { not: null }` en el `groupBy` de CDRs → excluía llamadas sin tipificar del conteo.

**Impacto:** El supervisor veía menos llamadas de las que el asesor había realizado realmente.

**Fix aplicado en:** `backend/src/routes/supervisor.routes.js`
```javascript
// ANTES:
db.cdr.groupBy({
  where: { tipificacionId: { not: null }, ... }
})

// DESPUÉS:
db.cdr.groupBy({
  where: { /* sin filtro tipificacionId */ }
})
// CDRs sin tipificación: solo suman al total, no a categorías
```

**Commit:** `f722d6c`

---

### Bug 2 — WSP/RCS/CORREO no actualizaban en tiempo real

**Problema:** Los contadores WSP/RCS/CORREO leían de `canales_apertura` (CDRs por canal), que generalmente estaba vacío porque los canales son `whatsapp`/`rcs`/`gmail` pero los mensajes masivos no crean CDRs.

**Fix aplicado en:** `backend/src/routes/supervisor.routes.js`
```sql
-- Nueva query directa a contactos:
SELECT asignado_a,
  COUNT(CASE WHEN whatsapp_status = 'ENVIADO' THEN 1 END)::int AS wsp,
  COUNT(CASE WHEN rcs_status      = 'ENVIADO' THEN 1 END)::int AS rcs,
  COUNT(CASE WHEN correo_status   = 'ENVIADO' THEN 1 END)::int AS correo
FROM contactos
WHERE asignado_a IN (${idsStr})
GROUP BY asignado_a
```

**Commit:** `9b8a1b0`

---

### Bug 3 — Pestaña Métricas con lag de 30s

**Problema:** El handler `TIPIFICACION_REALIZADA` del WebSocket solo actualizaba el log de eventos, pero no refrescaba la DB de métricas. El refresh tardaba hasta 30s (polling).

**Fix aplicado en:** `src/renderer/supervisor/JefePanel.jsx`
```javascript
if (msg.tipo === 'TIPIFICACION_REALIZADA') {
  agregarEvento('LLAMADA_TIPIFICADA', `...`);
  setActividadRefresh(p => p + 1);
  setCarterasRefresh(p => p + 1);
  cargarMetricasAsesores();   // ← NUEVO: refresh inmediato
  cargarMetricasEquipo();     // ← NUEVO: refresh inmediato
}
```

**Commit:** `a991d6f`

---

### Bug 4 — AVANCE CARTERA en 0% para campañas de días anteriores

**Problema:** Las queries `detalleRows` y `canalRows` tenían:
```sql
AND DATE(co.fecha_asignacion AT TIME ZONE 'America/Guayaquil') = '2026-07-25'::date
```
Esto excluía todos los contactos de campañas abiertas en días anteriores, ya que `fecha_asignacion` se establece al momento de la apertura.

**Fix aplicado en:** `backend/src/routes/supervisor.routes.js`
```javascript
// Omitir filtro fecha_asignacion cuando hay campanaId
${campanaId ? '' : `AND DATE(co.fecha_asignacion AT TIME ZONE 'America/Guayaquil') = '${fechaYmd}'::date`}
```

**Commit:** `d7d7c3c`

---

### Bug 5 — Reporte Excel de gestiones no coincidía con ActividadGestores

**Problema:** El reporte Excel filtraba `tipificacionId: { not: null }` → solo exportaba CDRs tipificados. Pero ActividadGestores (fix Bug 1) mostraba todos los CDRs. Los números no coincidían.

**Fix aplicado en:** `backend/src/routes/supervisor.routes.js`
```javascript
// ANTES:
const cdrs = await db.cdr.findMany({
  where: {
    tipificacionId: { not: null },  // ← eliminado
    ...
  }
})
```

CDRs sin tipificación ahora aparecen en el Excel con celda de Tipificación vacía.

**Commit:** `62b6f84`

---

## 8. Seguridad Implementada

- **JWT** con expiración de 8 horas
- **Roles y permisos**: `admin`, `jefe_area`, `supervisor`, `asesor`
- **Auditoría**: registro de acciones críticas
- **Aislamiento AUDIO_CHUNK**: mensajes de audio solo visibles al supervisor correspondiente
- **CSP (Content Security Policy)**: headers de seguridad en Electron
- **Backup BD**: endpoint protegido por rol `admin`
- **npm audit**: 0 vulnerabilidades críticas (fixes aplicados)

---

## 9. Base de Datos PostgreSQL

### 9.1 Tablas principales

| Tabla | Descripción |
|-------|-------------|
| `usuarios` | Asesores, jefes, supervisores, admins |
| `contactos` | 103,101 registros de deudores |
| `cdrs` | 84,543 registros de llamadas |
| `tipificaciones` | 26 códigos de resultado |
| `campanas` | 39 aperturas de cartera |
| `agendamientos` | Compromisos de pago |
| `validaciones_pago` | Pagos confirmados |
| `audit_logs` | Trazabilidad de acciones |

### 9.2 Migraciones

8 migraciones oficiales de Prisma aplicadas. Migraciones de emergencia inline en `src/index.js` del Electron para compatibilidad con SQLite local (asesores sin conexión).

### 9.3 Timezone

Todos los timestamps se almacenan en UTC. Las consultas usan:
```sql
AT TIME ZONE 'America/Guayaquil'
```
para calcular límites de día correctos (Ecuador, UTC-5).

---

## 10. Configuración de Producción

```
Backend:     node backend/src/index.js   — Puerto 3001
Frontend:    Electron app (modo remoto)  — Conecta a http://[IP]:3001
PostgreSQL:  localhost:5432              — DB: crm_marketing
```

### 10.1 Variables de entorno (`.env`)

```env
DATABASE_URL="postgresql://postgres:[password]@localhost:5432/crm_marketing?schema=public"
JWT_SECRET=[secreto]
JWT_EXPIRES_IN=8h
PORT=3001
HOST=0.0.0.0
```

### 10.2 Modos de operación

| Modo | Descripción |
|------|-------------|
| **Local** | Electron inicia su propio backend. Campo servidor = `127.0.0.1` |
| **Remoto** | Asesor se conecta al backend del jefe. Campo servidor = `[IP del jefe]:3001` |

---

## 11. Flujo de Trabajo Típico

```
1. Jefe abre el sistema → autenticación → abre campaña
2. Asesores se conectan → ven su cartera asignada
3. Asesor selecciona contacto → marca por ADB o manualmente
4. CDR creado → asesor tipifica la llamada
5. WS emite TIPIFICACION_REALIZADA → JefePanel refresca métricas
6. ActividadGestores actualiza TOTAL LLAMADAS, categorías, avance
7. Fin del día → jefe descarga reporte Excel → análisis de gestión
```

---

## 12. Repositorio y Control de Versiones

- **Repositorio:** https://github.com/Uphone-Devs/Crm_marketing_uphone
- **Rama principal:** `main`
- **Total commits:** 90+ commits de desarrollo
- **Última versión:** `62b6f84` — fix(reports): include all CDRs in gestiones xlsx

---

*Documento generado el 26 de julio de 2026*
