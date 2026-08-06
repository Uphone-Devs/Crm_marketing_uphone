require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/db');

const asesores = [
  { nombre: 'Cola Amaguaña',                    email: 'colaamaguaña@uphone.local',    password: 'REDACTED'       },
  { nombre: 'Benavides Huerta Solangy Pamela',  email: 'benavideshuerta@uphone.local', password: 'REDACTED'   },
  { nombre: 'German Escobar Anderson Ariel',    email: 'germanescobar@uphone.local',   password: 'REDACTED'     },
  { nombre: 'Parra Tejada Maria Gabriela',      email: 'parratejada@uphone.local',     password: 'REDACTED'      },
  { nombre: 'Quiguango Sanchez Renny Alexander',email: 'quiguango@uphone.local',       password: 'REDACTED'  },
  { nombre: 'Ramirez Mejia Alisson Katherine',  email: 'ramirezmejia@uphone.local',    password: 'REDACTED'    },
  { nombre: 'Ullauri Andrade Nathaly Alexandra',email: 'ullauriandrade@uphone.local',  password: 'REDACTED'    },
];

async function main() {
  for (const a of asesores) {
    const passwordHash = await bcrypt.hash(a.password, 10);
    const r = await prisma.usuario.upsert({
      where:  { email: a.email },
      update: { nombre: a.nombre, passwordHash, estado: 'activo' },
      create: { nombre: a.nombre, email: a.email, passwordHash, rol: 'asesor', estado: 'activo' },
    });
    console.log(`✅ ${r.id} | ${r.email} | ${r.rol}`);
  }
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
