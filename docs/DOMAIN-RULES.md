# Reglas de Negocio — CRM Marketing Uphone

> **Activo crítico del proyecto.** Estas reglas son el *qué* del sistema y **deben preservarse**
> en cualquier reescritura (p. ej. la migración a webapp), independientemente de la tecnología.
> Fuente: lógica en `src/main/database/queries.js`, `db.js` (migraciones) y `wsServer.js`.
> Versión 3.0 · validar contra código y stakeholders antes de cambios.

---

## 1. Roles

- **Asesor:** gestiona su cartera asignada (marca, tipifica, registra compromisos/pagos).
- **Supervisor:** monitorea su equipo en tiempo real, valida pagos, ve métricas/compromisos/cartera **de su equipo**.
- **Admin del sistema:** gestiona usuarios (crear/editar/contraseñas), asigna asesores a supervisores. No mezcla reglas de negocio con administración.

## 2. Estados de marcación del contacto

| Estado | Significado |
|--------|-------------|
| `PENDIENTE` | Sin gestionar |
| `EN_INTENTOS` | Intentado, aún por debajo del máximo de intentos |
| `GESTIONADO` | Alcanzó el máximo de intentos o tipificación que finaliza la gestión |
| `AGENDADO` | Con compromiso/llamada futura (PMP, VOL_CALL, PEND_COMP) |
| `YA_PAGO` | Pago declarado por el asesor |

- Al marcar: `intentos_realizados + 1`. Si `>= maxIntentos` → `GESTIONADO`; si no → `EN_INTENTOS`.
- `orden_marcacion`: el supervisor puede reordenar la cola; un contacto con orden asignado entra en cola sin importar su estado, **excepto** si está `validado_pago = 1` (inmutable).

## 3. Tipificaciones

Cada CDR se tipifica. Atributos: `categoria`, `requiere_agd` (agenda), `finaliza_gestion`, `solo_sistema` (no visible al asesor).

| Código | Descripción | Categoría | Agenda | Finaliza |
|--------|-------------|-----------|--------|----------|
| `PMP` | Compromiso de pago | CONTACTO EXITOSO | sí | sí |
| `AB_PARC` | Abono parcial | CONTACTO EXITOSO | no | sí |
| `VOL_CALL` | Volver a llamar | CONTACTO EXITOSO | sí | sí |
| `PAGO_REAL` | Pago realizado | CONTACTO EXITOSO | no | sí |
| `PEND_COMP` | Pendiente comprobante | CONTACTO EXITOSO | no | sí |
| `NEG_PAG` | Negativa de pago | CONTACTO NEUTRO | no | sí |
| `TER_CON` | Tercero conocido | CONTACTO NEUTRO | no | sí |
| `NC` | No contesta | CONTACTO NEUTRO | no | sí |
| `BUZON` | Buzón | CONTACTO NEUTRO | no | sí |
| `NUM_EQ` | Número equivocado | NO CONTACTADO | no | sí |
| `TIT_FAL` | Titular fallecido | NO CONTACTADO | no | sí |
| `FUERA_SERV` | Fuera de servicio | NO CONTACTADO | no | sí |
| `INCUMP` *(sistema)* | Compromiso incumplido | CONTACTO NEUTRO | no | sí |
| `COMP_CUM` *(sistema)* | Compromiso cumplido | CONTACTO EXITOSO | no | sí |
| `REAG` *(sistema)* | Reagendamiento | CONTACTO EXITOSO | sí | no |

## 4. Compromisos y pagos — **invariante de NO doble conteo**

> **Regla de oro:** un pago/contrato cuenta **una sola vez**, aunque se registre tanto en la gestión del asesor como en la validación del supervisor.

- **Pago declarado vs validado:** `contactos.ya_pago` = declarado por el asesor (sujeto a error de comprobante); `contactos.validado_pago` = confirmado en el módulo de validación (inmutable). `validado_pago = 1` bloquea el contacto de la cola.
- **Confirmar pago desde "Mis Compromisos":** actualiza el **CDR existente** a `PAGO_REAL` (con comprobante/forma de pago/monto) en lugar de crear un CDR nuevo → evita duplicar el compromiso y el valor recaudado.
- **Recaudación verificada** (`getPagosVerificadosPorAsesor`): no suma dos veces CDR + validación para el mismo contrato.
- Compromiso (`PMP`) → puede cumplirse (`COMP_CUM`), reagendarse (`REAG`) o incumplirse (`INCUMP`).

## 5. Modo de marcación

- `MANUAL` · `AUTOMATICA` · `PERSONALIZADO` (config por asesor). Lo controla el supervisor (vía WebSocket). En `PERSONALIZADO`, cada asesor recibe su propio modo/intentos; si no tiene config individual, fallback `MANUAL`/1 intento.

## 6. Métricas (supervisor)

- **Por asesor:** marcaciones, tiempo al aire (productivo), tiempo improductivo, ratio de productividad, gestiones, compromisos.
- **De equipo:** totales agregados **solo del equipo del supervisor** (Bug 4). Activos = asesores con actividad real en el scope (día/campaña).
- **Contactabilidad cruda** y **volumen de llamadas** con filtros por fecha/campaña.
- **Cartera:** análisis por tramos de días en mora (p. ej. 0-30), refinanciada (`CONTRATO REFINANCIADO` ≠ ''/'no'/'0'/'false'), rotación, % de cartera abarcada, evolución por asesor.
- Días en mora y valor en mora provienen de `contactos.metadata` (`json_extract`).

## 7. Validación de pagos

- **Correlación:** se cruzan pagos externos con contactos por `Nº CONTRATO` (y empresa). Resultado por contrato: `PAGADO_COMPLETO`, `PAGO_EXCEDENTE`, `ABONO_PARCIAL`, `SIN_MORA`.
- Confirmación agrupada en **sesiones de validación** (borrado/reversa en bloque).
- Empresas normalizadas (p. ej. TEC/SAS → `TEC_SAS`, SCC → `SCC`).

## 8. Comunicación omnicanal

- Eventos `ACCION_RAPIDA` con `metadata.canal` (WSP/SMS/correo) alimentan la card "Comunicación Omnicanal" del supervisor. `metadata` se guarda como objeto JSON (no doble-stringify).
- Mensajes personalizados por **tramo de días en mora** (un cliente de 3 días ≠ uno de 30).

## 9. Aislamiento de equipos (multi-tenant)

- `usuarios.supervisor_id` define el equipo. El supervisor ve **solo** sus asesores (listas, métricas, compromisos, monitoreo en vivo). El admin ve todo.
- La cuenta admin del sistema no aparece en las listas del supervisor.

## 10. Dispositivo / marcación física

- Marcación vía ADB/scrcpy sobre un Android conectado a la PC del asesor. Evitar falsos positivos: no contabilizar marcaciones cuando el dispositivo no está conectado por ADB.

---

> **Para el equipo de migración web:** esta especificación es el contrato funcional. Cualquier divergencia respecto a estas reglas debe acordarse con el P.O. y registrarse como decisión (ADR).
