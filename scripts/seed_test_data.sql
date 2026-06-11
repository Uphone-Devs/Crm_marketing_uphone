-- ── Usuarios de Prueba ────────────────────────────────────
-- admin2026 / asesor2026
INSERT OR IGNORE INTO usuarios (nombre, email, password_hash, rol) 
VALUES ('Alexis Supervisor', 'admin@uphone.com', '$2b$10$gXUks2TZdz6OV8zsorx8SehZpgT6XYDv0QsdPtrvL0Hg81pjFgfwG', 'supervisor');

INSERT OR IGNORE INTO usuarios (nombre, email, password_hash, rol) 
VALUES ('Vendedor de Prueba', 'asesor@uphone.com', '$2b$10$rO4S5ruB8CR5dQpdVlFmuuhxacCWj2BH4.aOPdS.tM26c8wqrxVri', 'asesor');

-- ── Campaña de Simulación ─────────────────────────────────
INSERT OR IGNORE INTO campanas (nombre, descripcion, estado) 
VALUES ('RECUPERACIÓN CARTERA ABRIL', 'Campaña de cobro masivo v2.0', 'activa');

-- ── Contactos de Prueba ───────────────────────────────────
-- Obtenemos el ID de la campaña recién creada
INSERT OR IGNORE INTO contactos (campana_id, nombre_deudor, telefono, monto_deuda, producto, estado_marcacion)
VALUES (1, 'Juan Pérez', '5551234567', 1500.50, 'Crédito Personal', 'PENDIENTE');

INSERT OR IGNORE INTO contactos (campana_id, nombre_deudor, telefono, monto_deuda, producto, estado_marcacion)
VALUES (1, 'María García', '5559876543', 2400.00, 'Tarjeta Premium', 'PENDIENTE');

INSERT OR IGNORE INTO contactos (campana_id, nombre_deudor, telefono, monto_deuda, producto, estado_marcacion)
VALUES (1, 'Carlos López', '5550001111', 850.75, 'Préstamo Auto', 'PENDIENTE');

INSERT OR IGNORE INTO contactos (campana_id, nombre_deudor, telefono, monto_deuda, producto, estado_marcacion)
VALUES (1, 'Elena Rivas', '5552223333', 12000.00, 'Hipotecario', 'PENDIENTE');

INSERT OR IGNORE INTO contactos (campana_id, nombre_deudor, telefono, monto_deuda, producto, estado_marcacion)
VALUES (1, 'Roberto Díaz', '5554445555', 450.25, 'Microcrédito', 'PENDIENTE');
