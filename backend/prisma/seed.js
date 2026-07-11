require('dotenv').config();
const prisma = require('../src/config/db');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;

async function main() {
  console.log('🌱 Iniciando seed de datos...');

  // ── 1. Usuarios (1 supervisor + 9 asesores) ──────────────
  const passwordHash = await bcrypt.hash('uphone2026', SALT_ROUNDS);

  const usuarios = [
    { nombre: 'Jefe_1', email: 'jefe1@uphone.local', rol: 'jefe_area' },
    { nombre: 'Asesor_1',     email: 'asesor1@uphone.local',     rol: 'asesor' },
    { nombre: 'Asesor_2',     email: 'asesor2@uphone.local',     rol: 'asesor' },
    { nombre: 'Asesor_3',     email: 'asesor3@uphone.local',     rol: 'asesor' },
    { nombre: 'Asesor_4',     email: 'asesor4@uphone.local',     rol: 'asesor' },
    { nombre: 'Asesor_5',     email: 'asesor5@uphone.local',     rol: 'asesor' },
    { nombre: 'Asesor_6',     email: 'asesor6@uphone.local',     rol: 'asesor' },
    { nombre: 'Asesor_7',     email: 'asesor7@uphone.local',     rol: 'asesor' },
    { nombre: 'Asesor_8',     email: 'asesor8@uphone.local',     rol: 'asesor' },
    { nombre: 'Asesor_9',     email: 'asesor9@uphone.local',     rol: 'asesor' },
  ];

  await Promise.all(usuarios.map(userData =>
    prisma.usuario.upsert({
      where: { email: userData.email },
      update: {},
      create: { ...userData, passwordHash },
    })
  ));
  console.log(`  ✅ ${usuarios.length} usuarios creados`);

  // ── 2. Tipificaciones base ────────────────────────────────
  const tipificaciones = [
    { codigo: 'CON_PAGO',    descripcion: 'Contactado - Promesa de pago',           requiereAgd: true,  categoria: 'CONTACTO EXITOSO'  },
    { codigo: 'CON_SIN',     descripcion: 'Contactado - Sin compromiso',            requiereAgd: false, categoria: 'CONTACTO NEUTRO'   },
    { codigo: 'NO_CON',      descripcion: 'No contactado - No contesta',            requiereAgd: false, categoria: 'NO CONTACTADO'     },
    { codigo: 'NO_CON_OCU',  descripcion: 'No contactado - Ocupado',                requiereAgd: false, categoria: 'NO CONTACTADO'     },
    { codigo: 'INCORRECTO',  descripcion: 'Número incorrecto o fuera de servicio',  requiereAgd: false, categoria: 'NO CONTACTADO'     },
    { codigo: 'BUZON',       descripcion: 'Ingresó a buzón de voz',                 requiereAgd: false, categoria: 'CONTACTO NEUTRO'   },
    { codigo: 'COLGADO',     descripcion: 'Llamada colgada antes de contacto',      requiereAgd: false, categoria: 'NO CONTACTADO'     },
    { codigo: 'NEGOCIACION', descripcion: 'En negociación activa',                  requiereAgd: true,  categoria: 'CONTACTO EXITOSO'  },
    { codigo: 'PMP',         descripcion: 'Promesa de Pago',                        requiereAgd: true,  categoria: 'CONTACTO EXITOSO'  },
    { codigo: 'CUE',         descripcion: 'Cuenta inexistente',                     requiereAgd: false, categoria: 'NO CONTACTADO'     },
    { codigo: 'NC',          descripcion: 'No contactado',                          requiereAgd: false, categoria: 'CONTACTO NEUTRO'   },
    { codigo: 'REF',         descripcion: 'Refutación',                             requiereAgd: false, categoria: 'CONTACTO NEUTRO'   },
    { codigo: 'EQ',          descripcion: 'Equivocado',                             requiereAgd: false, categoria: 'NO CONTACTADO'     },
    { codigo: 'SUS',         descripcion: 'Suspendido',                             requiereAgd: false, categoria: 'NO CONTACTADO'     },
    { codigo: 'NEG',         descripcion: 'Negativa total',                         requiereAgd: false, categoria: 'CONTACTO NEUTRO'   },
    { codigo: 'TER',         descripcion: 'Tercero',                                requiereAgd: false, categoria: 'CONTACTO NEUTRO'   },
    { codigo: 'VOL_CALL',    descripcion: 'Voluntad de llamar',                     requiereAgd: true,  categoria: 'CONTACTO EXITOSO'  },
    { codigo: 'PAGO_REAL',   descripcion: 'Pago real confirmado',                   requiereAgd: false, categoria: 'CONTACTO EXITOSO'  },
    { codigo: 'AB_PARC',     descripcion: 'Abono parcial',                          requiereAgd: false, categoria: 'CONTACTO EXITOSO'  },
    { codigo: 'PEND_COMP',   descripcion: 'Compromiso pendiente',                   requiereAgd: false, categoria: 'CONTACTO EXITOSO'  },
    { codigo: 'APAGADO',     descripcion: 'Teléfono apagado',                       requiereAgd: false, categoria: 'NO CONTACTADO'     },
    { codigo: 'NO_DISP',     descripcion: 'No disponible',                          requiereAgd: false, categoria: 'CONTACTO NEUTRO'   },
    { codigo: 'NO_WSP',      descripcion: 'No tiene WhatsApp',                      requiereAgd: false, categoria: 'CONTACTO NEUTRO'   },
    { codigo: 'REF_ELIM',    descripcion: 'Referencia - eliminar',                  requiereAgd: false, categoria: 'NO CONTACTADO'     },
    { codigo: 'NOTIFICADO',  descripcion: 'Cliente notificado',                     requiereAgd: false, categoria: 'CONTACTO NEUTRO'   },
  ];

  await Promise.all(tipificaciones.map(tipData =>
    prisma.tipificacion.upsert({
      where: { codigo: tipData.codigo },
      update: { categoria: tipData.categoria },
      create: tipData,
    })
  ));
  console.log(`  ✅ ${tipificaciones.length} tipificaciones creadas`);

  // ── 3. Campaña de prueba con 50 contactos ─────────────────
  const campana = await prisma.campana.upsert({
    where: { id: 1 },
    update: {},
    create: {
      nombre: 'Campaña Demo Q2-2026',
      descripcion: 'Campaña de prueba para desarrollo local con 50 registros de deuda simulados.',
      fechaInicio: new Date(),
      fechaFin: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // +30 días
      estado: 'activa',
    },
  });

  // Generar 50 contactos con datos variados
  const existingContactos = await prisma.contacto.count({ where: { campanaId: campana.id } });
  if (existingContactos === 0) {
    const contactos = [];
    for (let i = 1; i <= 50; i++) {
      const asesorAsignado = ((i - 1) % 9) + 2; // IDs 2-10 (asesores)
      contactos.push({
        campanaId: campana.id,
        nombreDeudor: `Deudor_${String(i).padStart(3, '0')}`,
        telefono: `09${String(80000000 + i)}`,
        montoDeuda: parseFloat((Math.random() * 5000 + 200).toFixed(2)),
        producto: ['Crédito Personal', 'Tarjeta VISA', 'Préstamo Auto', 'Línea de Crédito'][i % 4],
        estadoMarcacion: 'PENDIENTE',
        asignadoA: asesorAsignado,
      });
    }

    await prisma.contacto.createMany({ data: contactos });
    console.log(`  ✅ 50 contactos creados para campaña "${campana.nombre}"`);
  } else {
    console.log(`  ⏭  Contactos ya existentes (${existingContactos}), omitiendo...`);
  }

  console.log('🎉 Seed completado exitosamente.');
}

main()
  .catch((e) => {
    console.error('❌ Error en seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
