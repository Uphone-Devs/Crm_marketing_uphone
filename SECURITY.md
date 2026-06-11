# Política de Seguridad — CRM Marketing Uphone

## 🛡️ Reporte de Vulnerabilidades

Si encuentras una vulnerabilidad de seguridad, por favor **NO** crees un issue público.

Envía un correo a: **<alexispillajouph@gmail.com>**

## 📦 Versiones Soportadas

| Versión | Soportada          |
|---------|--------------------|
| 2.0.0   | ✅ Actual          |
| 1.x     | ❌ Sin soporte     |

## 🔍 Proceso de Escaneo

- **Dependabot** escanea dependencias automáticamente cada semana (lunes 9 AM EC)
- **npm audit** corre en CI en cada push y PR a `main`
- Vulnerabilidades `HIGH` o `CRÍTICAS` bloquean el merge
- PRs de actualización automática se abren agrupados por ecosistema

## 🔒 Buenas Prácticas

- JWT_SECRET externalizado en `.env` (nunca en código)
- Rate limiting activo en `/api/auth/*`
- CORS restringido a LAN (localhost + 192.168.x.x)
- `contextIsolation: true` + `nodeIntegration: false` en Electron
- Base de datos (`*.db`) excluida de git

## 📋 Compliance de Licencias

Todas las dependencias usan licencias permisivas compatibles con software propietario:

- **MIT:** 482 paquetes (82% de las transitivas)
- **ISC:** 62 paquetes
- **Apache-2.0:** 14 paquetes
- **BSD:** 17 paquetes
- **Única dual:** `jszip` (MIT OR GPL-3.0) → se elige MIT

No hay dependencias GPL, AGPL ni SSPL. El proyecto es apto para distribución comercial sin restricciones de licencia.

