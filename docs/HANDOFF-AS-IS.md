# Documento de Handoff — Estado "As-Is"

> Registro formal del estado del proyecto al momento de la transición a la empresa de desarrollo
> del holding. Protege a las partes definiendo qué se entrega, en qué estado y con qué pendientes.
>
> **Fecha de corte:** _[completar]_ · **Versión:** 3.0 · **Entrega:** P.O. ↔ Empresa de desarrollo

---

## 1. Qué se entrega
- Repositorio del **desarrollo original** (Electron/React/SQLite) con arquitectura dual-mode (local + VM).
- Documentación técnica y funcional (`docs/`): arquitectura, reglas de negocio, API, modelo de datos, runbook de despliegue, issues conocidos.
- Suite de pruebas (Vitest) y scripts de carga (k6).

## 2. Estado funcional
- **En producción** con un primer equipo operando sobre VM de Azure (modo remoto).
- Versión 3.0: incluye correcciones de seguridad/aislamiento **implementadas y probadas** (suite verde), **pendientes de desplegar** en la VM (ver ventana de despliegue planificada).
- Cobertura de pruebas centrada en la capa de datos (queries reales) y helpers de seguridad.

## 3. Lo que NO está incluido / fuera de alcance a la fecha
- Migración a **webapp** (Fase 2) — a cargo de la empresa de desarrollo, usando esta documentación como contrato funcional.
- Migración a **PostgreSQL** (T-003) — prerrequisito de escalado horizontal, no ejecutada.
- **Cifrado en reposo** de la BD — decisión arquitectónica pendiente (ADR).
- URL estable del backend (C3) y autoescalado (C5) — ver [`KNOWN-ISSUES.md`](KNOWN-ISSUES.md).

## 4. Issues conocidos al corte
Listados y clasificados en [`KNOWN-ISSUES.md`](KNOWN-ISSUES.md). **Los issues preexistentes a esta fecha quedan registrados aquí**; las correcciones posteriores se gestionan por el proceso de control de cambios acordado.

## 5. Accesos entregados
- Repositorio: _[detallar: lectura/escritura, ramas]_
- VM / infraestructura Azure: _[detallar]_
- Credenciales y secretos: **NO se comparten por el repositorio**; se entregan por canal seguro y se recomienda rotación tras la transición.

## 6. Supuestos y dependencias
- Binarios de `resources/` (ADB/scrcpy/FFmpeg) se entregan por separado (no versionados).
- Operación depende de Android conectado por ADB en cada PC de asesor.

## 7. Criterios de aceptación de la entrega
- [ ] La empresa clona el repo y ejecuta `npm install` + `npm test` (suite verde).
- [ ] Documentación revisada y comprendida (arquitectura + reglas de negocio).
- [ ] Lista de issues conocidos aceptada y firmada.
- [ ] Accesos verificados.

## 8. Firmas
| Rol | Nombre | Fecha | Firma |
|-----|--------|-------|-------|
| P.O. (entrega) | | | |
| Empresa de desarrollo (recibe) | | | |
| Holding (testigo) | | | |

> Este documento deja constancia del estado a la fecha de corte. No constituye garantía sobre defectos no detectados; su propósito es trazabilidad y delimitación de responsabilidades.
