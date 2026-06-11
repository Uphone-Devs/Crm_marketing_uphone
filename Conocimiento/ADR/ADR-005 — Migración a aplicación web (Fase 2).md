# ADR-002 — Migración a aplicación web (Fase 2)

- **Estado:** Propuesto (a cargo de la empresa de desarrollo del holding)
- **Fecha:** 2026-06-03
- **Decisores:** P.O., Empresa de desarrollo, Holding
- **Relacionado:** ADR-001 (PostgreSQL), [`docs/DOMAIN-RULES.md`](../../docs/DOMAIN-RULES.md), [`docs/API-REFERENCE.md`](../../docs/API-REFERENCE.md)

---

## Contexto

El holding asigna el proyecto a una empresa de desarrollo que planea **migrar la terminal de escritorio (Electron) a una aplicación web**. El desarrollo **original se mantiene** con su arquitectura actual; la webapp es un nuevo desarrollo en paralelo. El P.O. controla el avance comparando la webapp contra la **especificación funcional** (no contra el código).

**Restricción de dominio dura:** el control del **teléfono Android (ADB/scrcpy)** y la captura de audio son capacidades de **escritorio local**; una webapp en navegador no puede ejecutarlas directamente. Esto condiciona el alcance de la migración (la marcación física requiere un componente local/puente o un cambio de canal de telefonía).

## Decisión

1. La **documentación de este repositorio es el contrato funcional** de la migración. En particular, [`DOMAIN-RULES.md`](../../docs/DOMAIN-RULES.md) (reglas de negocio) y [`API-REFERENCE.md`](../../docs/API-REFERENCE.md) deben preservarse semánticamente.
2. Toda **desviación** respecto a las reglas de negocio se aprueba por el P.O. y se registra como **nuevo ADR**.
3. La telefonía/ADB se trata como **decisión aparte** (puente local, WebRTC/SIP, o integración con central) — no se asume resuelta por el navegador.
4. La webapp debería construirse sobre la capa de datos de **ADR-001 (PostgreSQL)** para nacer escalable.

## Consecuencias

**Positivas:** acceso multiplataforma sin instalador; despliegue centralizado; base para escalar; separa claramente "qué" (reglas) de "cómo" (tecnología).
**Negativas / riesgos:** **riesgo de pérdida del IP de negocio** si no se respeta `DOMAIN-RULES.md`; la marcación física/audio no es trivial en web; doble mantenimiento temporal (original + webapp); necesidad de paridad de datos durante la transición.

## Alternativas consideradas

- **Reescribir sin documentación-contrato:** alto riesgo de regresiones de negocio (no-doble-conteo, tipificaciones, aislamiento). Descartado.
- **PWA/Electron híbrido:** podría conservar capacidades locales; a evaluar por la empresa de desarrollo según el canal de telefonía elegido.

## Referencias
- `docs/DOMAIN-RULES.md`, `docs/API-REFERENCE.md`, `docs/ARCHITECTURE.md` §9.
