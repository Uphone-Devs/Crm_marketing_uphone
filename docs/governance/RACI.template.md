# Matriz RACI (PLANTILLA)

> R = Responsable (ejecuta) · A = Aprobador (rinde cuentas, 1 solo) · C = Consultado · I = Informado.
> Completar/ajustar y firmar. Actores: **PO** (Product Owner), **DEV** (empresa de desarrollo), **HLD** (holding/sponsor), **OPS** (operación de cobranza), **LEG** (legal).

| Actividad | PO | DEV | HLD | OPS | LEG |
|-----------|----|----|-----|-----|-----|
| Priorización del backlog/roadmap | A/R | C | C | C | — |
| Definición de reglas de negocio | A/R | C | I | C | — |
| Diseño técnico / arquitectura webapp | C | A/R | I | — | — |
| Implementación | I | A/R | — | — | — |
| Criterios de aceptación (DoD) | A/R | C | I | C | — |
| Aceptación de entregables | A/R | R | I | C | — |
| Control de cambios de alcance | A | R | C/A* | I | — |
| Gestión de accesos (repo/VM/prod) | C | R | A | — | C |
| Protección de datos (PII/LOPDP) | C | R | A | I | A/R |
| Contrato / SOW / IP | C | C | A | — | A/R |
| Despliegue a producción | A | R | I | C | — |
| Operación diaria / soporte N1 | I | C | I | A/R | — |
| Registro de decisiones (ADR) | A/R | C | I | — | — |

\* Cambios que afectan presupuesto/plazo: aprueba el holding.

## Firmas
| Actor | Nombre | Fecha | Firma |
|-------|--------|-------|-------|
| PO | | | |
| DEV | | | |
| HLD | | | |
