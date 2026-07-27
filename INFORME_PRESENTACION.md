# Sistema CRM Marketing UPHONE
## Informe de Desarrollo y Funcionalidades
**Julio 2026**

---

## ¿Qué es el sistema?

Es una aplicación de escritorio para la gestión de cobranza. Permite a los jefes de área supervisar en tiempo real el trabajo de los asesores, y a los asesores gestionar su cartera de clientes de forma organizada.

---

## ¿Qué puede hacer el sistema?

### Para el Asesor
- Ver su lista de clientes asignados (cartera)
- Registrar llamadas y su resultado (tipificación)
- Enviar mensajes por WhatsApp, RCS y Correo masivamente
- Ver sus propias estadísticas del día (llamadas, compromisos, tiempo)
- Registrar compromisos de pago y hacer seguimiento

### Para el Jefe de Área / Supervisor
- Ver en pantalla quién está trabajando en tiempo real
- Monitorear cuántas llamadas hace cada asesor y sus resultados
- Ver el avance de cada asesor en su cartera (porcentaje gestionado)
- Filtrar información por empresa (UPHONE o CREDI TV)
- Filtrar por campaña específica
- Descargar reportes en Excel con toda la información del día

### Para el Administrador
- Crear y gestionar usuarios del sistema
- Cargar carteras de clientes desde archivos Excel
- Abrir y cerrar campañas de cobranza
- Hacer respaldo de la base de datos con un clic

---

## Datos del sistema en producción

| | |
|--|--|
| Asesores activos | 19 |
| Clientes en cartera | 103,101 |
| Llamadas registradas | 84,543 |
| Campañas creadas | 39 |

---

## Empresas que maneja el sistema

| Empresa | Descripción |
|---------|-------------|
| **UPHONE** | Agrupa TEC SAS y SCC |
| **CREDI TV** | Cartera independiente |

El sistema identifica automáticamente a qué empresa pertenece cada cliente según la fecha de venta registrada en el archivo de apertura.

---

## Reportes disponibles

El sistema genera archivos Excel con un clic para:

1. **Gestiones del equipo** — todas las llamadas del día con resultado, monto acordado y datos del cliente
2. **Reporte diario** — resumen de productividad del día
3. **Vencimientos y gestiones** — análisis por días de mora del cliente (S0, S1, S2)
4. **Contactabilidad por hora** — en qué horas del día se logra más contacto
5. **Informe operativo por asesor** — rendimiento detallado individual
6. **Reporte de cuotas** — cruce con el archivo de aperturas

Todos los reportes se pueden filtrar por fecha, empresa y campaña.

---

## Problemas encontrados y solucionados

### 1. Total de llamadas no coincidía
**Problema:** El panel del supervisor mostraba menos llamadas de las que el asesor había realizado.  
**Causa:** El sistema solo contaba llamadas con resultado registrado, ignorando las llamadas sin respuesta.  
**Solución:** Ahora se cuentan todas las llamadas realizadas.

### 2. Los contadores de WhatsApp, RCS y Correo no se actualizaban
**Problema:** Los contadores de mensajes enviados permanecían en 0 aunque los asesores hubieran enviado mensajes.  
**Causa:** El sistema buscaba los mensajes en el registro de llamadas en lugar de buscarlo directamente en la tabla de clientes.  
**Solución:** Los contadores ahora leen directamente el estado de envío de cada cliente.

### 3. Las métricas tardaban en actualizarse
**Problema:** Cuando un asesor registraba una tipificación, el supervisor debía esperar hasta 30 segundos para ver el cambio.  
**Causa:** La actualización del panel del supervisor no se disparaba al recibir la notificación de nueva tipificación.  
**Solución:** Ahora al recibir la notificación, el sistema refresca inmediatamente los datos.

### 4. El avance de cartera mostraba 0% en campañas antiguas
**Problema:** Las campañas abiertas en días anteriores mostraban 0% de avance, aunque los asesores ya hubieran gestionado gran parte.  
**Causa:** El sistema buscaba clientes asignados solo en la fecha de hoy, sin considerar que la campaña se abrió antes.  
**Solución:** Cuando se selecciona una campaña específica, el sistema busca por campaña en lugar de por fecha.

### 5. El reporte Excel no coincidía con la pantalla
**Problema:** El número de gestiones en el Excel era menor al que aparecía en la tabla de actividad del supervisor.  
**Causa:** El Excel solo exportaba llamadas con resultado registrado, mientras la pantalla ya mostraba todas las llamadas.  
**Solución:** El Excel ahora exporta todas las llamadas, igual que la pantalla.

---

## Seguridad del sistema

- Acceso con usuario y contraseña
- Sesiones con tiempo de expiración (8 horas)
- Cada rol solo puede ver lo que le corresponde
- Registro de actividad (auditoría)
- Respaldo de base de datos disponible para el administrador

---

## Tecnología utilizada

El sistema funciona como aplicación de escritorio instalable en Windows. La base de datos es PostgreSQL y almacena más de 100,000 registros de clientes con toda su información histórica. La comunicación en tiempo real entre asesores y supervisores usa tecnología WebSocket (similar a los chats modernos).

---

*Sistema desarrollado para UPHONE — Julio 2026*
