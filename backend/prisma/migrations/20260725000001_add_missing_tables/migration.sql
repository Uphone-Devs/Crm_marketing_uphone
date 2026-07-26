-- Tablas presentes en schema.prisma pero sin migración Prisma oficial.
-- Idempotente: usa IF NOT EXISTS + DO blocks para constraints.

-- ── segmentos_config ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "segmentos_config" (
    "id"       SERIAL NOT NULL,
    "clave"    VARCHAR(100) NOT NULL,
    "etiqueta" VARCHAR(255) NOT NULL,
    "color"    VARCHAR(50),
    "icono"    VARCHAR(100),
    CONSTRAINT "segmentos_config_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "segmentos_config_clave_key" ON "segmentos_config"("clave");

-- ── sub_gestiones ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "sub_gestiones" (
    "id"          SERIAL NOT NULL,
    "contacto_id" INTEGER,
    "asesor_id"   INTEGER,
    "cdr_id"      INTEGER,
    "telefono"    TEXT,
    "notas"       TEXT,
    "nombre_ref"  TEXT,
    "parentesco"  TEXT,
    "creado_en"   TIMESTAMP(6) DEFAULT NOW(),
    CONSTRAINT "sub_gestiones_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sub_gestiones_contacto_id_fkey'
    ) THEN
        ALTER TABLE "sub_gestiones"
            ADD CONSTRAINT "sub_gestiones_contacto_id_fkey"
            FOREIGN KEY ("contacto_id") REFERENCES "contactos"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sub_gestiones_asesor_id_fkey'
    ) THEN
        ALTER TABLE "sub_gestiones"
            ADD CONSTRAINT "sub_gestiones_asesor_id_fkey"
            FOREIGN KEY ("asesor_id") REFERENCES "usuarios"("id")
            ON UPDATE NO ACTION;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sub_gestiones_cdr_id_fkey'
    ) THEN
        ALTER TABLE "sub_gestiones"
            ADD CONSTRAINT "sub_gestiones_cdr_id_fkey"
            FOREIGN KEY ("cdr_id") REFERENCES "cdrs"("id")
            ON UPDATE NO ACTION;
    END IF;
END $$;

-- ── validacion_sesiones ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "validacion_sesiones" (
    "id"            SERIAL NOT NULL,
    "supervisor_id" INTEGER,
    "creado_en"     TIMESTAMP(6) DEFAULT NOW(),
    "n_pagado"      INTEGER DEFAULT 0,
    "n_excedente"   INTEGER DEFAULT 0,
    "n_abono"       INTEGER DEFAULT 0,
    "monto_real"    DECIMAL(12,2) DEFAULT 0,
    "monto_abono"   DECIMAL(12,2) DEFAULT 0,
    "registros"     INTEGER DEFAULT 0,
    CONSTRAINT "validacion_sesiones_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'validacion_sesiones_supervisor_id_fkey'
    ) THEN
        ALTER TABLE "validacion_sesiones"
            ADD CONSTRAINT "validacion_sesiones_supervisor_id_fkey"
            FOREIGN KEY ("supervisor_id") REFERENCES "usuarios"("id")
            ON UPDATE NO ACTION;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_vs_creado_en" ON "validacion_sesiones"("creado_en" DESC);

-- ── validacion_pagos ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "validacion_pagos" (
    "id"             SERIAL NOT NULL,
    "sesion_id"      INTEGER,
    "contacto_id"    INTEGER,
    "nombre_deudor"  TEXT,
    "cedula"         TEXT,
    "contrato"       TEXT,
    "empresa"        TEXT,
    "campana_nombre" TEXT,
    "asesor_nombre"  TEXT,
    "estado_pago"    TEXT,
    "valor_en_mora"  DECIMAL(12,2),
    "monto_pagado"   DECIMAL(12,2),
    "validado_por"   INTEGER,
    "validado_en"    TIMESTAMP(6) DEFAULT NOW(),
    CONSTRAINT "validacion_pagos_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'validacion_pagos_sesion_id_fkey'
    ) THEN
        ALTER TABLE "validacion_pagos"
            ADD CONSTRAINT "validacion_pagos_sesion_id_fkey"
            FOREIGN KEY ("sesion_id") REFERENCES "validacion_sesiones"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'validacion_pagos_contacto_id_fkey'
    ) THEN
        ALTER TABLE "validacion_pagos"
            ADD CONSTRAINT "validacion_pagos_contacto_id_fkey"
            FOREIGN KEY ("contacto_id") REFERENCES "contactos"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'validacion_pagos_validado_por_fkey'
    ) THEN
        ALTER TABLE "validacion_pagos"
            ADD CONSTRAINT "validacion_pagos_validado_por_fkey"
            FOREIGN KEY ("validado_por") REFERENCES "usuarios"("id")
            ON UPDATE NO ACTION;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_vp_sesion"   ON "validacion_pagos"("sesion_id");
CREATE INDEX IF NOT EXISTS "idx_vp_contacto" ON "validacion_pagos"("contacto_id");
