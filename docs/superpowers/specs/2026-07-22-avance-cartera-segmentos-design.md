# Avance de Cartera por Segmentos — Spec

**Fecha:** 2026-07-22  
**Estado:** Aprobado

---

## Problema

1. La card "AVANCE CARTERA" siempre muestra ~49% independientemente de la campaña seleccionada.
2. No existe desglose de avance por segmento (S0, S1, S2 — días en mora, vienen del Excel).
3. Las 3 cards KPI tienen diseño visual plano sin identidad por tipo.

---

## Causa del Bug (avance siempre 49%)

`/api/jefe/productividad` usa `resolveContactoWhere` que sí aplica `campanaId`, pero:
- Contactos nuevos importados pueden tener `estadoMarcacion = NULL`.
- Prisma `{ not: 'PENDIENTE' }` genera `<> 'PENDIENTE'` en PostgreSQL → excluye NULLs del conteo de gestionados pero los incluye en `cartera_total` → ratio incorrecto.
- Fix: usar `estadoMarcacion: { notIn: ['PENDIENTE'] }` y verificar que el import setea `estadoMarcacion = 'PENDIENTE'` explícitamente.

---

## Solución

### Backend — `/api/jefe/productividad`

Agregar a la respuesta existente el campo `segmentos`:

```json
{
  "avance_cartera": 49.4,
  "cartera_total": 75186,
  "gestionados": 37211,
  "segmentos": {
    "0": { "total": 25000, "gestionados": 12400, "pct": 49.6 },
    "1": { "total": 18000, "gestionados": 8100,  "pct": 45.0 },
    "2": { "total": 32186, "gestionados": 16711, "pct": 51.9 }
  }
}
```

Query de segmentos: agrupar contactos por `metadata->>'SEGMENTO'` (PostgreSQL JSONB) filtrando por el mismo `cWhere`. Solo incluir segmentos 0, 1, 2.

Fix bug: cambiar el count de `gestionados` de `{ not: 'PENDIENTE' }` a `{ notIn: ['PENDIENTE'] }` para excluir explícitamente solo PENDIENTE (no NULLs).

### Frontend — Card AVANCE CARTERA expandida

Reemplazar el componente `<AvanceCartera>` actual con nuevo layout:

```
┌─────────────────────────────────────────────────┐
│ ↗ AVANCE CARTERA          [Campaña ▾] selector  │
│                                                  │
│ GLOBAL  37,211 / 75,186                    49%  │
│ ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░   │
│                                                  │
│ S0  12,400 / 25,000   ██████████░░░░░░░   49%   │
│ S1   8,100 / 18,000   █████████░░░░░░░░   45%   │
│ S2  16,711 / 32,186   ██████████░░░░░░░   52%   │
└─────────────────────────────────────────────────┘
```

- Selector de campaña: lista todas las campañas ordenadas por fecha desc (endpoint existente `/api/campanas`)
- Cambiar campaña en el selector → re-fetch local del avance sin afectar otros KPIs
- Colores: Global `#1DE9B6`, S0 `#00E5FF`, S1 `#FFD740`, S2 `#F50057`
- Barra Global: height 6px; barras segmento: height 4px

### Frontend — Rediseño 3 cards KPI

| Card | Color borde | Icono |
|------|-------------|-------|
| LLAMADAS TIPIFICADAS HOY | `#00E5FF` cyan | `call` |
| AVANCE CARTERA | `#1DE9B6` verde | `trending_up` |
| NO CONTACTADOS | `#F50057` rojo | `person_off` |

Cambios visuales:
- Borde izquierdo 3px de color identitario
- Número principal: 28px bold
- Subtexto: 11px, opacity 0.55
- Fondo card: `rgba(255,255,255,0.03)`, hover: `rgba(255,255,255,0.06)`
- Transición hover suave 150ms

---

## Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `backend/src/routes/supervisor.routes.js` | Fix bug gestionados + agregar query segmentos |
| `src/renderer/supervisor/DashboardDirectivo.jsx` | Nuevo layout card avance + rediseño KPI cards |

---

## Criterios de éxito

- Avance muestra 0% para campaña nueva con todos en PENDIENTE.
- Al cambiar campaña en el selector, avance y segmentos se actualizan sin recargar dashboard.
- S0 + S1 + S2 suman aproximadamente al global (puede haber contactos sin segmento).
- Las 3 cards KPI tienen bordes de color y hover visible.
