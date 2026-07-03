# backend/ — Servidor Standalone (DEUDA TÉCNICA)

> **ESTADO: NO INTEGRADO — No ejecutar en producción junto al app Electron.**

## Qué es

Servidor Express + Prisma + PostgreSQL heredado del CRM Marketing original.
Fue la base de partida antes de migrar a la arquitectura Electron + SQLite.

## Por qué existe

Conservado como punto de partida para una posible **Fase 2** con backend cloud
(acceso web sin Electron, múltiples sucursales, PostgreSQL compartido).

## Por qué NO está activo

El app Electron ya tiene su propio servidor API en `src/main/apiServer.js`
(Express + better-sqlite3, puerto 3001). Ambos servidores duplican endpoints
y compiten en el mismo puerto si se levantan simultáneamente.

## Diferencias críticas vs el app activo

| Característica | `backend/` (este) | `src/main/apiServer.js` (activo) |
|---|---|---|
| Base de datos | PostgreSQL (Prisma) | SQLite (better-sqlite3) |
| Migraciones | Prisma migrate | M-007 → M-040 en `db.js` |
| Autenticación | JWT + Prisma | JWT + bcrypt directo |
| WebSocket | Socket.io | WS nativo |
| S3 grabaciones | ✅ implementado | ❌ no implementado |
| Métricas jefe | ❌ no implementado | ✅ `/api/jefe/*` completo |
| Validación pagos | ❌ no implementado | ✅ completo |
| Agendamientos | ❌ no implementado | ✅ completo |
| Schema sincronizado | ❌ desactualizado (faltan M-011→M-040) | ✅ al día |

## Cómo activar (si se necesita en Fase 2)

1. Instalar PostgreSQL y crear la BD
2. Configurar `backend/.env` con `DATABASE_URL` real
3. `cd backend && npm install && npx prisma migrate deploy && npm run seed`
4. Sincronizar schema Prisma con columnas de M-011→M-040 (ver `src/main/database/db.js`)
5. Mover a repo separado para evitar conflicto de puertos

## Dependencias externas requeridas

- PostgreSQL >= 14
- AWS S3 bucket (para `storage/s3.service.js`)
- Variables en `backend/.env`: `DATABASE_URL`, `JWT_SECRET`, `AWS_*`

## Deuda técnica registrada

- [ ] Sincronizar `schema.prisma` con columnas M-011 → M-040
- [ ] Implementar endpoints `/api/jefe/*` equivalentes
- [ ] Implementar validación de pagos
- [ ] Implementar agendamientos
- [ ] Mover a repositorio separado antes de Fase 2
- [ ] Eliminar dependencia `socket.io` (unificar con WS nativo)
- [ ] Configurar `backend/.env` con credenciales reales de producción
