# Cláusula de Propiedad Intelectual y Confidencialidad — Reglas de Negocio

> **Plantilla de gestión, no asesoría legal.** Debe pasar por **revisión legal** del holding antes
> de firmarse. Su objetivo es proteger el *conocimiento del giro de cobranza* (activo estratégico)
> al entregar el desarrollo a una empresa externa para la migración web (Fase 2).
>
> Anexar al **SOW/contrato** y al [`HANDOFF-AS-IS.md`](../HANDOFF-AS-IS.md). El documento protegido
> es [`DOMAIN-RULES.md`](../DOMAIN-RULES.md) y sus derivados.

---

## 1. Definiciones

- **Conocimiento de Negocio Protegido (CNP):** las reglas de negocio de cobranza contenidas en
  [`DOMAIN-RULES.md`](../DOMAIN-RULES.md), incluyendo —sin limitarse a— la matriz de tipificaciones
  y su categorización, el invariante de **no doble conteo** (pago declarado vs. validado), la lógica
  de métricas de productividad/contactabilidad, la segmentación por tramos de mora, la correlación
  de pagos por número de contrato, la normalización de empresas y la calibración de umbrales
  (intentos máximos, criterios de finalización de gestión).
- **Propietario:** el holding (en adelante, "el Titular").
- **Receptor:** la empresa de desarrollo externa y todo su personal, subcontratistas y afiliados.
- **Finalidad Autorizada:** exclusivamente ejecutar la migración a webapp (Fase 2) descrita en el SOW.

## 2. Titularidad

2.1. El CNP, el código original y todos los entregables derivados de la migración son **propiedad
exclusiva del Titular**. La entrega de documentación o código **no transfiere** titularidad alguna.

2.2. Todo trabajo derivado, mejora o reescritura que el Receptor produzca sobre el CNP se cede al
Titular (*work made for hire* / cesión total de derechos patrimoniales), libre de cargas.

## 3. Licencia limitada

3.1. El Titular otorga al Receptor una licencia **no exclusiva, intransferible, revocable y limitada
en el tiempo** sobre el CNP, **únicamente** para la Finalidad Autorizada.

3.2. Queda **prohibido**: (a) reutilizar el CNP —total o parcialmente— en productos, servicios o
proyectos para terceros; (b) crear obras derivadas fuera de la Finalidad Autorizada; (c) replicar la
lógica de negocio para un sistema competidor; (d) sublicenciar o divulgar el CNP.

## 4. Confidencialidad

4.1. El CNP es **información confidencial y secreto comercial** del Titular. El Receptor lo tratará
con el mismo cuidado que su propia información confidencial y nunca con menos que diligencia razonable.

4.2. El acceso se limita al personal con **necesidad de conocer** para la Finalidad Autorizada, todos
sujetos a obligaciones de confidencialidad equivalentes. El Receptor mantendrá un **registro de
quién accede** al CNP.

4.3. La obligación de confidencialidad **sobrevive** a la terminación del contrato por [N] años
(definir con legal).

4.4. Excepciones estándar: información de dominio público sin culpa del Receptor, desarrollada de
forma independiente y demostrable, o exigida por ley/autoridad (con notificación previa al Titular).

## 5. No competencia / no replicación

5.1. Durante la vigencia y por [N] meses posteriores, el Receptor no desarrollará para sí ni para
terceros un sistema de cobranza que **replique sustancialmente** el CNP.

## 6. Protección de datos (PII)

6.1. La operación maneja datos personales (cédulas, deudas, teléfonos). Aplica la **LOPDP (Ecuador)**.
El tratamiento se rige por el **Acuerdo de Tratamiento de Datos** anexo; el CNP no autoriza acceso a
datos productivos salvo lo pactado allí. Ver ítem 11 de
[`DOCUMENTOS-A-SOLICITAR-PO.md`](DOCUMENTOS-A-SOLICITAR-PO.md).

## 7. Devolución y destrucción

7.1. A la terminación o a requerimiento del Titular, el Receptor devolverá o **destruirá** todas las
copias del CNP (incluidas las de respaldo) y certificará la destrucción por escrito en [N] días.

## 8. Incumplimiento y remedios

8.1. El incumplimiento causa **daño irreparable**; el Titular podrá solicitar **medidas cautelares**
además de daños y perjuicios y las **penalidades** del SOW.

## 9. Control estratégico retenido por el Titular

9.1. El *qué* (contrato funcional) se entrega; el *por qué* estratégico —histórico de decisiones de
calibración, datos de performance, razonamiento detrás de umbrales y tipificaciones— **permanece bajo
custodia del P.O.** y no forma parte de la entrega (ver ADR del P.O. fuera del repositorio).

9.2. Toda desviación respecto al CNP requiere aprobación del P.O. y se registra como **ADR**
(ver [`PO-ROLE-CHARTER.template.md`](PO-ROLE-CHARTER.template.md)).

---

## Firmas

| Rol | Nombre | Fecha | Firma |
|-----|--------|-------|-------|
| Titular (holding) | | | |
| P.O. | | | |
| Empresa de desarrollo (Receptor) | | | |

> Completar los `[N]` con legal. Esta cláusula complementa —no reemplaza— el NDA general y el SOW.
