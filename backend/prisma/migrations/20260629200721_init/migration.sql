-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('supervisor', 'jefe_area', 'asesor', 'admin');

-- CreateEnum
CREATE TYPE "EstadoUsuario" AS ENUM ('activo', 'inactivo');

-- CreateEnum
CREATE TYPE "EstadoCampana" AS ENUM ('activa', 'pausada', 'finalizada');

-- CreateEnum
CREATE TYPE "EstadoMarcacion" AS ENUM ('PENDIENTE', 'CONTACTADO', 'NO_CONTACTADO', 'ENVIADO', 'GESTIONADO');

-- CreateEnum
CREATE TYPE "Canal" AS ENUM ('llamada', 'whatsapp', 'rcs', 'gmail');

-- CreateEnum
CREATE TYPE "TipoAgendamiento" AS ENUM ('PMP', 'VOL_CALL');

-- CreateEnum
CREATE TYPE "EstadoAgendamiento" AS ENUM ('pendiente', 'ejecutado', 'cancelado');

-- CreateEnum
CREATE TYPE "TipoEvento" AS ENUM ('ESTADO', 'LLAMADA', 'CONEXION', 'DESCONEXION', 'ACCION_RAPIDA');

-- CreateEnum
CREATE TYPE "TipoConexion" AS ENUM ('USB', 'WIFI', 'LOCAL');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "rol" "Rol" NOT NULL DEFAULT 'asesor',
    "estado" "EstadoUsuario" NOT NULL DEFAULT 'activo',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campanas" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "fecha_inicio" TIMESTAMP(3),
    "fecha_fin" TIMESTAMP(3),
    "supervisor_id" INTEGER,
    "estado" "EstadoCampana" NOT NULL DEFAULT 'activa',

    CONSTRAINT "campanas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contactos" (
    "id" SERIAL NOT NULL,
    "campana_id" INTEGER NOT NULL,
    "cedula" TEXT,
    "nombre_deudor" TEXT,
    "telefono" TEXT NOT NULL,
    "monto_deuda" DECIMAL(12,2),
    "producto" TEXT,
    "estado_marcacion" "EstadoMarcacion" NOT NULL DEFAULT 'PENDIENTE',
    "intentos_realizados" INTEGER NOT NULL DEFAULT 0,
    "asignado_a" INTEGER,
    "metadata" JSONB,
    "whatsapp_status" TEXT NOT NULL DEFAULT 'INACTIVO',
    "rcs_status" TEXT NOT NULL DEFAULT 'ACTIVO',

    CONSTRAINT "contactos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipificaciones" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "requiere_agd" BOOLEAN NOT NULL DEFAULT false,
    "categoria" TEXT NOT NULL DEFAULT 'NO_CONTACTADO',
    "finaliza_gestion" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tipificaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cdrs" (
    "id" SERIAL NOT NULL,
    "contacto_id" INTEGER NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "tipificacion_id" INTEGER,
    "timestamp_inicio" TIMESTAMP(3) NOT NULL,
    "timestamp_ringing" TIMESTAMP(3),
    "timestamp_answered" TIMESTAMP(3),
    "timestamp_fin" TIMESTAMP(3),
    "duracion_seg" INTEGER NOT NULL DEFAULT 0,
    "latencia_ms" INTEGER NOT NULL DEFAULT 0,
    "operadora" TEXT,
    "resultado" TEXT,
    "url_grabacion" TEXT,
    "notas" TEXT,
    "canal" "Canal" NOT NULL DEFAULT 'llamada',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cdrs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sesiones" (
    "id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fin" TIMESTAMP(3),
    "tipo_conexion" "TipoConexion",

    CONSTRAINT "sesiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos" (
    "id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "sesion_id" INTEGER,
    "tipo" "TipoEvento" NOT NULL,
    "estado_id" INTEGER,
    "duracion_seg" INTEGER,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "eventos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config" (
    "clave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,

    CONSTRAINT "config_pkey" PRIMARY KEY ("clave")
);

-- CreateTable
CREATE TABLE "agendamientos" (
    "id" SERIAL NOT NULL,
    "contacto_id" INTEGER NOT NULL,
    "asesor_id" INTEGER NOT NULL,
    "tipo" "TipoAgendamiento" NOT NULL,
    "fecha_hora" TIMESTAMP(3) NOT NULL,
    "notas" TEXT,
    "estado" "EstadoAgendamiento" NOT NULL DEFAULT 'pendiente',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agendamientos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensajes_broadcast" (
    "id" SERIAL NOT NULL,
    "supervisor_id" INTEGER NOT NULL,
    "mensaje" TEXT NOT NULL,
    "segmento_destino" TEXT NOT NULL DEFAULT 'TODOS',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensajes_broadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indicadores_datos" (
    "asesor_id" INTEGER NOT NULL,
    "fecha" TEXT NOT NULL,
    "segmento" TEXT NOT NULL,
    "valores" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "indicadores_datos_pkey" PRIMARY KEY ("asesor_id","fecha","segmento")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "tipificaciones_codigo_key" ON "tipificaciones"("codigo");

-- CreateIndex
CREATE INDEX "agendamientos_fecha_hora_idx" ON "agendamientos"("fecha_hora");

-- CreateIndex
CREATE INDEX "agendamientos_asesor_id_idx" ON "agendamientos"("asesor_id");

-- CreateIndex
CREATE INDEX "agendamientos_estado_idx" ON "agendamientos"("estado");

-- AddForeignKey
ALTER TABLE "campanas" ADD CONSTRAINT "campanas_supervisor_id_fkey" FOREIGN KEY ("supervisor_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contactos" ADD CONSTRAINT "contactos_campana_id_fkey" FOREIGN KEY ("campana_id") REFERENCES "campanas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contactos" ADD CONSTRAINT "contactos_asignado_a_fkey" FOREIGN KEY ("asignado_a") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cdrs" ADD CONSTRAINT "cdrs_contacto_id_fkey" FOREIGN KEY ("contacto_id") REFERENCES "contactos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cdrs" ADD CONSTRAINT "cdrs_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cdrs" ADD CONSTRAINT "cdrs_tipificacion_id_fkey" FOREIGN KEY ("tipificacion_id") REFERENCES "tipificaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_sesion_id_fkey" FOREIGN KEY ("sesion_id") REFERENCES "sesiones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamientos" ADD CONSTRAINT "agendamientos_contacto_id_fkey" FOREIGN KEY ("contacto_id") REFERENCES "contactos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamientos" ADD CONSTRAINT "agendamientos_asesor_id_fkey" FOREIGN KEY ("asesor_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensajes_broadcast" ADD CONSTRAINT "mensajes_broadcast_supervisor_id_fkey" FOREIGN KEY ("supervisor_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
