# 🧪 Plan de Pruebas Multi-PC — UPHONE CRM Marketing Uphone v2.0

## Prerrequisitos

| Item | Descripción |
|------|-------------|
| **PC 1** | Servidor/Supervisor (Windows 10+, `.exe` instalado) |
| **PC 2** | Asesor remoto (Windows 10+, `.exe` instalado) |
| **Red** | Ambas PCs en la misma red LAN / WiFi |
| **Celular** | Dispositivo Android con depuración USB habilitada (opcional para test ADB) |
| **Firewall** | Puerto `3001` debe estar abierto en PC 1 para conexiones privadas |

---

## Fase 0: Preparación del Entorno

### 0.1 — Obtener la IP del Supervisor (PC 1)
```
1. Abrir CMD → Escribir: ipconfig
2. Buscar Dirección IPv4 (ej: 192.168.1.108)
3. Anotar la IP → Se usará como parámetro en PC 2
```

### 0.2 — Firewall de Windows (PC 1)
```
1. Panel de Control → Windows Defender Firewall → Permitir aplicación
2. Buscar "CRM Marketing Uphone" y marcar "Privada"
3. Si no aparece: Agregar regla → Puerto 3001 TCP → Permitir conexión doméstica
```

### 0.3 — Credenciales de Test

| Rol | Email | Password | Dónde Login |
|-----|-------|----------|-------------|
| Supervisor | `supervisor1@uphone.local` | `admin2026` | PC 1 |
| Asesor | `asesor@uphone.local` | `asesor2026` | PC 2 |

---

## Fase 1: Conexión y Autenticación

### Test 1.1 — Login del Supervisor (PC 1)
| # | Acción | Resultado Esperado | ✅/❌ |
|---|--------|--------------------|-------|
| 1 | Abrir app en PC 1 | Pantalla de login carga | |
| 2 | Ingresar `supervisor1@uphone.local` / `admin2026` | Login exitoso, redirige al panel Supervisor | |
| 3 | Verificar indicador de estado en TopAppBar | Muestra "CONECTADO" (verde) — WebSocket activo en `127.0.0.1:3001` | |

### Test 1.2 — Login del Asesor (PC 2)
| # | Acción | Resultado Esperado | ✅/❌ |
|---|--------|--------------------|-------|
| 1 | Abrir app en PC 2 | Pantalla de login carga | |
| 2 | Ingresar `asesor@uphone.local` / `asesor2026` | Login exitoso, redirige al panel Asesor | |
| 3 | Ir a Configuración | Aparece campo "IP DEL SUPERVISOR (WEBSOCKET)" | |
| 4 | Ingresar IP de PC 1 (ej: `192.168.1.108`) | | |
| 5 | Click "Guardar y Conectar" | Toast: "IP guardada. Reiniciando WS..." | |
| 6 | Esperar 3 segundos | El WebSocket se reconecta. Estado debe cambiar a CONECTADO | |

### Test 1.3 — Verificación Cruzada de Conexión
| # | Acción | Resultado Esperado | ✅/❌ |
|---|--------|--------------------|-------|
| 1 | En PC 1: Ir a pestaña "Monitoreo" | El asesor de PC 2 aparece en la lista | |
| 2 | Verificar indicador del asesor | Punto verde (online) visible junto al nombre | |
| 3 | En PC 2: Navegar fuera de la app (cerrar/minimizar) | En PC 1: Asesor cambia a offline tras ~15 segundos | |

---

## Fase 2: Flujo de Métricas en Tiempo Real

### Test 2.1 — Cambio de Estado
| # | Acción (PC 2 - Asesor) | Verificar (PC 1 - Supervisor) | ✅/❌ |
|---|------------------------|-------------------------------|-------|
| 1 | Click "En Gestión" | `AdvisorList` muestra "En Gestión" para ese asesor | |
| 2 | Esperar 10 segundos | Timer del asesor alcanza ~00:00:10 en AdvisorList | |
| 3 | Click "Ingreso Datos" | Estado cambia a "Ingreso Datos", timer se reinicia | |
| 4 | Click "Baño" | Estado cambia a "Pausa" | |
| 5 | Esperar > 10 minutos | ⚠️ Alerta visual en AdvisorList (card con borde rojo) | |

### Test 2.2 — Métricas de Marcaciones
| # | Acción (PC 2 - Asesor) | Verificar (PC 1 - Supervisor) | ✅/❌ |
|---|------------------------|-------------------------------|-------|
| 1 | Seleccionar campaña activa | Campaña aparece activa en el asesor | |
| 2 | Cambiar estado a "En Gestión" | Debe obtener primer contacto | |
| 3 | Click "MARCAR" (o marcación automática) | | |
| 4 | Verificar `MetricsOverview` en PC 1 | "Marcaciones Hoy" incrementa de 0 a 1 | |
| 5 | Verificar `AdvisorList` en PC 1 | Columna "Marcaciones" muestra 1 | |
| 6 | Colgar y tipificar "Promesa de Pago" | "Productividad Equipo" se actualiza | |

### Test 2.3 — Heartbeat de Métricas (15 segundos)
| # | Acción | Resultado Esperado | ✅/❌ |
|---|--------|--------------------|-------|
| 1 | Asesor en "En Gestión" durante 20s | El supervisor recibe actualización cada ~15s | |
| 2 | Abrir DevTools del Supervisor (F12 → Console) | Deben aparecer mensajes `METRICAS_ASESOR` periódicamente | |
| 3 | Verificar que los tiempos productivos se actualizan | Timer acumulado sube en MetricsOverview | |

---

## Fase 3: Gráficas Avanzadas del Supervisor

### Test 3.1 — Charts con Datos Reales
| # | Gráfica | Condición de Test | Resultado Esperado | ✅/❌ |
|---|---------|--------------------|--------------------|-------|
| 1 | **Ahorro por Automatización** | El asesor realizó 5 marcaciones | Valor positivo (ej: $0.06 basado en 5 × 15s × $3/h) | |
| 2 | **Rotación de Cartera** | 5 marcaciones sobre base de 5000 | Pie chart muestra ~0.1% completado | |
| 3 | **MPH por Asesor** | 1 asesor con 5 marcaciones | BarChart horizontal muestra nombre del asesor con valor | |
| 4 | **Contactabilidad** | Sin contactos efectivos aún | Pie chart con 0 contactados / 5 no contactados | |
| 5 | **Tiempo Promedio/Gestión** | 1 asesor activo | BarChart muestra segundos/marcación reales | |
| 6 | **Concurrencia en Vivo** | 1 asesor en "En Gestión" | AreaChart muestra valor 1, no datos ficticios | |

### Test 3.2 — Charts con Actividad Cero
| # | Condición | Resultado Esperado | ✅/❌ |
|---|-----------|--------------------|--------------------|-------|
| 1 | Nadie ha marcado hoy | Todos los charts muestran 0 / vacío (sin datos ficticios) | |
| 2 | `MPH` chart | BarChart muestra asesores con 0 mph | |
| 3 | `Concurrencia` chart | AreaChart con valor 0 (línea plana) | |

---

## Fase 4: Tipificación y Actividad

### Test 4.1 — Tipificación → Notificación Supervisor
| # | Acción (PC 2) | Verificar (PC 1) | ✅/❌ |
|---|---------------|------------------|-------|
| 1 | Colgar llamada | Se abre panel de Tipificación | |
| 2 | Seleccionar "Promesa de Pago", agregar notas | | |
| 3 | Click "Guardar" | Toast aparece en PC 1: "Nueva tipificación de [Asesor]" | |
| 4 | Verificar `ActivityLog` | Evento "tipificó contacto como: Promesa de Pago" aparece | |
| 5 | Verificar `MetricsOverview` | "Productividad Equipo" se actualiza | |

### Test 4.2 — Tipificación → Continuidad Automática
| # | Acción | Resultado Esperado | ✅/❌ |
|---|--------|--------------------|-------|
| 1 | Modo = AUTOMÁTICA (desde TopAppBar supervisor) | En PC 2: modo cambia a AUTOMÁTICA | |
| 2 | Asesor tipifica contacto | Siguiente contacto se carga automáticamente | |
| 3 | Se inicia marcación automática | CDR se crea, grabación se inicia | |

---

## Fase 5: Desconexión y Recuperación

### Test 5.1 — Desconexión del Asesor
| # | Acción | Resultado Esperado | ✅/❌ |
|---|--------|--------------------|-------|
| 1 | En PC 2: Cerrar la app del asesor | | |
| 2 | PC 1: Esperar ~15 segundos | Asesor cambia a "Desconectado" (gris) | |
| 3 | Verificar ActivityLog | Evento "Asesor se desconectó" aparece | |
| 4 | Verificar MetricsOverview | Asesores Activos baja de 1 a 0 | |

### Test 5.2 — Reconexión del Asesor
| # | Acción | Resultado Esperado | ✅/❌ |
|---|--------|--------------------|-------|
| 1 | Re-abrir la app en PC 2, login de nuevo | Login exitoso | |
| 2 | Ir a Configuración → La IP debe estar guardada | IP persiste de sesión anterior | |
| 3 | Regresar a Dashboard | WebSocket se reconecta automáticamente | |
| 4 | Verificar en PC 1 | Asesor reaparece como "online" en AdvisorList | |
| 5 | Verificar Snapshot | Métricas del asesor se restauran desde snapshot WS | |

---

## Fase 6: Modo Marcación (Supervisor → Asesor)

### Test 6.1 — Toggle de Modo
| # | Acción (PC 1) | Verificar (PC 2) | ✅/❌ |
|---|---------------|------------------|-------|
| 1 | Click botón "MANUAL" en TopAppBar | Cambia a "AUTOMÁTICA" | |
| 2 | En PC 2: Verificar console (F12) | Mensaje: `[WS] Modo marcación: AUTOMATICA` | |
| 3 | Click otra vez en TopAppBar | Vuelve a "MANUAL" | |

---

## Checklist de Resultados

| Fase | Tests Pasados | Tests Fallados | Notas |
|------|:------------:|:--------------:|-------|
| 1. Conexión | /3 | | |
| 2. Métricas | /3 | | |
| 3. Gráficas | /2 | | |
| 4. Tipificación | /2 | | |
| 5. Desconexión | /2 | | |
| 6. Modo Marcación | /1 | | |
| **TOTAL** | **/13** | | |

---

> **Criterio de Aceptación:** Mínimo 11/13 tests pasados para considerar el sistema operativo en Multi-PC.
> Tests críticos (no pueden fallar): 1.2, 2.1, 2.2, 5.1
