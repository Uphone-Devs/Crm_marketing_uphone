# Manual de Usuario — CRM Marketing Uphone

> Guía de uso por rol (Asesor · Supervisor · Administrador). Versión 3.0.
> Las capturas se agregan en cada sección marcada con `[captura]`.

---

## 1. Acceso al sistema

1. Abrir la aplicación **CRM Marketing Uphone**.
2. Ingresar **correo** y **contraseña**.
3. (Modo remoto) Si opera contra el servidor central, configurar la **IP/URL del servidor** en "Configurar IP del Servidor".
4. El sistema abre el panel según el **rol**: Asesor, Supervisor o Administrador.

`[captura: pantalla de login]`

> La sesión expira por seguridad; al expirar se solicita iniciar sesión de nuevo.

---

## 2. Rol ASESOR

Panel de gestión de cobranza telefónica.

### 2.1 Consola del asesor
- **Estado de gestión:** En Gestión / Pausa / Almuerzo / Capacitación / Reunión.
- **Marcación:** se llama al contacto vía el teléfono Android conectado (ADB/scrcpy). El número se marca desde la cola asignada.
- **Cola de contactos:** el sistema entrega el siguiente contacto pendiente de la campaña asignada.

`[captura: consola del asesor]`

### 2.2 Tipificar una gestión
Al terminar una llamada, registrar el resultado (tipificación): Compromiso de pago (PMP), Abono parcial, No contesta, Negativa de pago, etc. Algunas (PMP, Volver a llamar) generan un **agendamiento**.

### 2.3 Mis Compromisos
Lista de compromisos de pago del asesor. Para confirmar un pago:
1. Abrir el contacto en **Mis Compromisos**.
2. Botón **Pago Realizado** → ingresar **monto**, **comprobante** y **forma de pago** (depósito/transferencia/local).
3. El sistema marca el pago **sin duplicar** el valor (no recontar el mismo contrato).

### 2.4 Cartera Asignada
Contactos asignados al asesor, con días en mora y valor en mora.

### 2.5 Historial de Gestiones
Registro de las gestiones realizadas (llamadas, tipificaciones, referencias).

---

## 3. Rol SUPERVISOR

Monitoreo y gestión de **su equipo** (solo ve a los asesores asignados a él).

### 3.1 Monitoreo en tiempo real
- Estado de cada asesor de su equipo (en línea, en gestión, pausa…).
- Métricas en vivo: marcaciones, tiempo al aire, productividad.
- Modo de marcación del equipo: **Manual / Automática / Personalizado**.

`[captura: monitoreo del supervisor]`

### 3.2 Métricas
Indicadores del equipo: contactabilidad, volumen de llamadas, promesas y pagos, monto comprometido y recaudado. Filtros por **fecha** y **campaña**.

### 3.3 Campañas
Crear campañas y asignar contactos a los asesores.

### 3.4 Carteras
Composición de la cartera del equipo; reordenar la cola de marcación de cada asesor.

### 3.5 Validación de Pagos
Cruzar pagos externos (por **Nº de contrato**) con los contactos para confirmar recaudación, agrupado en **sesiones de validación**. Evita doble conteo entre la gestión del asesor y la validación.

### 3.6 Compromisos
Compromisos de pago del equipo, con cumplimiento/incumplimiento.

### 3.7 Reportes
Exportación a Excel de gestiones, métricas y cartera.

> El supervisor **no** gestiona usuarios; eso corresponde al Administrador.

---

## 4. Rol ADMINISTRADOR

Gestión central del sistema.

### 4.1 Gestión de Usuarios
- Crear/editar asesores y supervisores; cambiar contraseñas.
- **Asignar cada asesor a un supervisor** (selector "Supervisor (equipo)") → define qué equipo ve cada supervisor.
- La cuenta de administrador del sistema es visible solo para el admin.

`[captura: gestión de usuarios]`

### 4.2 Usuarios Conectados / Sistema
- Ver usuarios conectados en tiempo real.
- Información del sistema (CPU, memoria, conexiones).

### 4.3 Conexión BD
Configuración de la fuente de datos (local / servidor remoto) y obtención de token de monitoreo.

---

## 5. Conceptos clave

- **Tipificación:** resultado registrado de cada gestión.
- **Compromiso (PMP):** promesa de pago; puede cumplirse, reagendarse o incumplirse.
- **Aislamiento por equipo:** cada supervisor ve solo a sus asesores asignados.
- **No doble conteo:** un pago/contrato se cuenta una sola vez, aunque se registre en gestión y en validación.

---

## 6. Problemas frecuentes

| Síntoma | Acción |
|---------|--------|
| No marca el teléfono | Verificar que el Android esté conectado por ADB y con depuración USB activa |
| Sesión expirada | Volver a iniciar sesión |
| Supervisor no ve asesores | El Administrador debe asignarle asesores (supervisor_id) |
| No conecta al servidor | Verificar la IP/URL del servidor y la red |

---

*Para soporte técnico, contactar al área de TI del holding.*
