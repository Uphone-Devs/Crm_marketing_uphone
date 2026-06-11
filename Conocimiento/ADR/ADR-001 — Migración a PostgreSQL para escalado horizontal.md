# ADR-001 — Migración a PostgreSQL para escalado horizontal (T-003)

- **Estado:** Propuesto (Fase 2 — prerrequisito de elasticidad)
- **Fecha:** 2026-06-03
- **Decisores:** P.O., Empresa de desarrollo, Holding
- **Relacionado:** ADR-005 (webapp), [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §8, KNOWN-ISSUES (C5)

---

## Contexto

La arquitectura actual es un **proceso único de Node + SQLite local** en una VM. Esto impide el **escalado horizontal automático**:
- SQLite es un archivo local → no se puede balancear entre varias instancias que compartan la BD.
- El estado del WebSocket (clientes, estados de asesores) vive en **memoria del proceso** → instancias separadas no lo comparten.

Hoy solo cabe **escalado vertical** (más vCPU/RAM), con techo y reinicio. El despliegue objetivo es de ~7 equipos (~63 usuarios), con visión de crecimiento (80–100+).

## Decisión

Migrar la capa de datos a **PostgreSQL** (Azure Database for PostgreSQL Flexible Server) como prerrequisito de escalado horizontal, junto con:
- **Backend stateless** (sin estado en memoria del proceso).
- **Estado WS compartido** (p. ej. Redis pub/sub) + balanceador con afinidad de sesión.

La capa de acceso a datos (`queries.js`) ya está aislada con "una función por query" (patrón Strategy), lo que **acota la migración** a reemplazar esa capa sin reescribir la lógica de negocio.

## Consecuencias

**Positivas:** habilita auto-escalado, réplicas, backups gestionados, alta disponibilidad; elimina el límite del proceso único.
**Negativas / costo:** costo de servicio gestionado; migración de datos y de queries (SQLite→PG: tipos, `json_extract`→JSONB, AUTOINCREMENT→SERIAL/IDENTITY); introducir Redis para WS; mayor complejidad operativa.

## Alternativas consideradas

- **PM2 cluster mode sobre SQLite:** inseguro para escrituras concurrentes (SQLITE_BUSY); como máximo 1 instancia → no escala. Solo sirve como paliativo vertical.
- **Seguir vertical (statu quo):** válido hasta ~150 conexiones WS; no resuelve elasticidad ni HA.
- **Otra DB (MySQL/SQL Server):** PG preferido por JSONB (encaja con `contactos.metadata`) y costo en Azure.

## Referencias
- `docs/ARCHITECTURE.md` §8–9; análisis de carga en handoff; `scripts/load/` (k6).
