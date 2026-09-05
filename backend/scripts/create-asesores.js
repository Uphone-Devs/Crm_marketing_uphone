require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = require('../src/config/db');

const asesores = [
  { nombre: 'Cola Amaguaña',                    email: 'colaamaguaña@uphone.local'    },
  { nombre: 'Benavides Huerta Solangy Pamela',  email: 'benavideshuerta@uphone.local' },
  { nombre: 'German Escobar Anderson Ariel',    email: 'germanescobar@uphone.local'   },
  { nombre: 'Parra Tejada Maria Gabriela',      email: 'parratejada@uphone.local'     },
  { nombre: 'Quiguango Sanchez Renny Alexander',email: 'quiguango@uphone.local'       },
  { nombre: 'Ramirez Mejia Alisson Katherine',  email: 'ramirezmejia@uphone.local'    },
  { nombre: 'Ullauri Andrade Nathaly Alexandra',email: 'ullauriandrade@uphone.local'  },
];

function generarPassword() {
  return crypto.randomBytes(12).toString('base64url');
}

async function main() {
  console.log('⚠️  GUARDAR estas contraseñas ahora — no se vuelven a mostrar:\n');
  for (const a of asesores) {
    const password = generarPassword();
    const passwordHash = await bcrypt.hash(password, 10);
    const r = await prisma.usuario.upsert({
      where:  { email: a.email },
      update: { nombre: a.nombre, passwordHash, estado: 'activo' },
      create: { nombre: a.nombre, email: a.email, passwordHash, rol: 'asesor', estado: 'activo' },
    });
    console.log(`  ${r.email}  →  ${password}`);
  }
  console.log('\n✅ Usuarios creados/actualizados.');
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
