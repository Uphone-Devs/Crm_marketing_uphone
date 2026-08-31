require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/db');

async function main() {
  const hash = await bcrypt.hash('REDACTED', 10);
  const usuarios = [
    { nombre: 'Administrador', email: 'admin@uphone.local',  passwordHash: hash, rol: 'admin'     },
    { nombre: 'Jefe de Area',  email: 'jefe@uphone.local',   passwordHash: hash, rol: 'jefe_area' },
    { nombre: 'Gestor Demo',   email: 'gestor@uphone.local', passwordHash: hash, rol: 'asesor'    },
  ];
  for (const u of usuarios) {
    const r = await prisma.usuario.upsert({ where: { email: u.email }, update: {}, create: u });
    console.log(`✅ ${r.id} | ${r.email} | ${r.rol}`);
  }
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
