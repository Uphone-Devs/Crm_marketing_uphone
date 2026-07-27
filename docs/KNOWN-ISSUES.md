# Issues Conocidos y Backlog Técnico

> Estado al momento de la entrega (handoff). Mantener actualizado. Versión 3.0 · 2026-06.

## Críticos / Seguridad
| ID | Tema | Estado | Notas |
|----|------|--------|-------|
| C3 | URL del túnel inestable | Abierto | cloudflared *quick tunnel* rota la URL en cada reinicio. Recomendado: IP pública estática Azure (~$3-4/mes) o named tunnel. |
| SEC-1 | SQLite sin cifrado en reposo | Abierto (ADR pendiente) | El cifrado a nivel app (SQLCipher) solo protege exfiltración de archivo/backup; contra acceso a la VM, lo que protege es control de acceso + clave en Key Vault. |
| SEC-2 | Rotación de `JWT_SECRET` | Recomendado | `.env` nunca estuvo en historial; rotar periódicamente igualmente. |
| SEC-3 | Electron 29 con advisories HIGH | Abierto | `npm audit` reporta múltiples HIGH en Electron <=39.8.4 (ASAR Integrity Bypass, varios use-after-free, registry key injection en Windows). Mitigación real = **upgrade de Electron** (major, breaking → requiere QA de la empresa dev). Hace fallar el job de CI (`npm audit --audit-level=high`, `continue-on-error: false`). |

## CI / Integración continua
| ID | Tema | Estado | Notas |
|----|------|--------|-------|
| CI-1 | Node 20 en CI vs `engines >=22` | ✅ corregido | `@electron/rebuild`/`node-abi` exigen Node ≥22.12; el workflow usaba Node 20 → EBADENGINE y fallo de `npm ci` en PRs de deps. Workflow actualizado a Node 22. |
| CI-2 | Gate `npm audit` rojo por SEC-3 | Abierto (decisión PO) | Mientras Electron no se actualice, el job queda rojo. Opciones: (a) actualizar Electron; (b) bajar gate a `--audit-level=critical`; (c) `continue-on-error: true` documentando el riesgo. **No alterado** unilateralmente por ser sensible a seguridad. |

## Actualizaciones de dependencias (Dependabot) — pendientes al handoff
| PR | Paquete | Salto | Acción recomendada |
|----|---------|-------|--------------------|
| #1 | react group | minor | seguro; mergear tras CI verde |
| #4 | ws 8.20→8.21 | patch | seguro; mergear tras CI verde |
| #5 | @electron/rebuild 4.0.3→4.0.4 | patch | seguro; mergear tras CI verde |
| #10 | vitest 4.1.7→4.1.8 | patch | seguro; mergear tras CI verde |
| #7 | better-sqlite3 12.8→12.10 | minor (nativo) | mergear + `npm rebuild better-sqlite3` |
| #3 | express 4.22→**5.2** | **MAJOR** | breaking; QA de la empresa dev (cambios de API/routing) |
| #6 | vite 5.4→**8.0** | **MAJOR** | breaking; QA (config/plugins) |
| #8 | @vitejs/plugin-react 4.7→**6.0** | **MAJOR** | breaking; QA junto con vite |

## Escalabilidad
| ID | Tema | Estado | Notas |
|----|------|--------|-------|
| C5 | API sin autoescalado | Abierto | Proceso único + SQLite local → solo escala **vertical**. Autoescalado horizontal requiere PostgreSQL (T-003) + backend stateless + estado WS compartido. |
| PERF-1 | Carga masiva de campañas | Mitigable | `express.json` limit 2mb; cargas grandes pueden requerir chunking. |

## Correcciones v3.0 (implementadas, pendientes de deploy)
| ID | Tema | Estado |
|----|------|--------|
| C1 | Fallback silencioso a SQLite local en canal de datos no mapeado | ✅ corregido |
| C2 | Sin manejo global de 401 (sesión zombi) | ✅ corregido |
| C4 | Rate-limit de login por IP (bloqueo colectivo) | ✅ corregido (por email) |
| A1 | `.env` cargado por CWD (JWT_SECRET no cargaba bajo PM2) | ✅ corregido (ruta absoluta) |
| Índices | Full scan en cards de cartera/métricas | ✅ M-037 |
| Bug 3 | Cuenta admin visible a supervisores + apartado de personal en supervisor | ✅ (backend + UI) |
| Bug 4 | Sin aislamiento de equipos por supervisor | ✅ (`supervisor_id` + REST + WS + UI admin) |

## Verificación pendiente (requiere VM)
- Confirmar en la VM: tipo de túnel (C3), IP compartida en rate-limit (C4), `JWT_SECRET`/`NODE_ENV` cargados (A1), specs de la VM.
- Causa raíz del error "Login fallido: Respuesta inválida del servidor" en `admin:vmLogin` (respuesta no-JSON del POST de login) — diagnosticar con curl directo.

## Deuda menor
- Código muerto: `renderPersonalConfig` en `SupervisorPanel.jsx` (apartado removido, función sin uso).
- **Corregido 2026-07-25:** esta línea decía que `backend/` estaba divergente del "backend real (`src/main/apiServer.js`)". Es al revés. El backend de producción es `backend/` (Express + Prisma + PostgreSQL), que `src/main/index.js` arranca como proceso hijo. `src/main/apiServer.js` es código muerto: `initApiServer` solo se invoca desde `src/main/server.js`, un entry que ningún script ni build referencia. Ver `deploy/RUNBOOK.md`.
- Código muerto pendiente de retirar: `src/main/apiServer.js`, `src/main/server.js` y `src/main/database/`. Mientras sigan en el árbol, las mitigaciones que implementan se leen como si estuvieran activas y no lo están — fue el origen de la confusión anterior.
