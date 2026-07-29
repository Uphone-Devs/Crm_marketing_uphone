/**
 * seed-catalogo.js — Catálogo mínimo para producción.
 *
 * Solo tipificaciones: es un catálogo obligatorio que la operación necesita para
 * clasificar gestiones. Idempotente (upsert), seguro de repetir en cada release.
 *
 * NO crea usuarios ni datos de prueba. Para eso está `seed.js`, que es un seed de
 * DEMO — usuarios con contraseña conocida y 50 deudores ficticios — y no debe
 * ejecutarse jamás contra la base de la VM.
 *
 *   node prisma/seed-catalogo.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const prisma = require('../src/config/db');

const TIPIFICACIONES = [
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

async function main() {
  console.log('🌱 Sembrando catálogo de tipificaciones...');

  await Promise.all(TIPIFICACIONES.map(tip =>
    prisma.tipificacion.upsert({
      where: { codigo: tip.codigo },
      update: { descripcion: tip.descripcion, categoria: tip.categoria, requiereAgd: tip.requiereAgd },
      create: tip,
    })
  ));

  const total = await prisma.tipificacion.count();
  console.log(`  ✅ ${TIPIFICACIONES.length} tipificaciones sincronizadas (${total} en la base)`);
}

main()
  .catch((e) => {
    console.error('❌ Error en seed de catálogo:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
