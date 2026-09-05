require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = require('../src/config/db');

function generarPassword() {
  return crypto.randomBytes(12).toString('base64url');
}

async function main() {
  console.log('⚠️  GUARDAR estas contraseñas ahora — no se vuelven a mostrar:\n');
  const roles = [
    { nombre: 'Administrador', email: 'admin@uphone.local',  rol: 'admin'     },
    { nombre: 'Jefe de Area',  email: 'jefe@uphone.local',   rol: 'jefe_area' },
    { nombre: 'Gestor Demo',   email: 'gestor@uphone.local', rol: 'asesor'    },
  ];
  for (const u of roles) {
    const password = generarPassword();
    const passwordHash = await bcrypt.hash(password, 10);
    const r = await prisma.usuario.upsert({
      where:  { email: u.email },
      update: {},
      create: { ...u, passwordHash },
    });
    console.log(`  ${r.email}  →  ${password}`);
  }
  console.log('\n✅ Roles creados.');
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
