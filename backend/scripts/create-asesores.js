require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/db');

const asesores = [
  { nombre: 'Cola Amaguaña',                    email: 'colaamaguaña@uphone.local',    password: 'Cola2026@@'       },
  { nombre: 'Benavides Huerta Solangy Pamela',  email: 'benavideshuerta@uphone.local', password: 'Benvides2026@@'   },
  { nombre: 'German Escobar Anderson Ariel',    email: 'germanescobar@uphone.local',   password: 'German2026@@'     },
  { nombre: 'Parra Tejada Maria Gabriela',      email: 'parratejada@uphone.local',     password: 'Parra2026@@'      },
  { nombre: 'Quiguango Sanchez Renny Alexander',email: 'quiguango@uphone.local',       password: 'Quiguango2026@@'  },
  { nombre: 'Ramirez Mejia Alisson Katherine',  email: 'ramirezmejia@uphone.local',    password: 'Ramirez2026@@'    },
  { nombre: 'Ullauri Andrade Nathaly Alexandra',email: 'ullauriandrade@uphone.local',  password: 'Ullauri2026@@'    },
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
