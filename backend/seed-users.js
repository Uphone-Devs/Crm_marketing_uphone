/**
 * seed-users.js — Crea usuarios de prueba: admin, supervisor, gestor
 */
require('dotenv').config();

const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

async function main() {
  const password = 'Admin2026!';
  const hash = bcrypt.hashSync(password, 10);

  const users = [
    { nombre: 'Administrador',  email: 'admin@sistema.local',      rol: 'admin',      estado: 'activo', passwordHash: hash },
    { nombre: 'Supervisor CRM', email: 'supervisor@sistema.local',  rol: 'supervisor', estado: 'activo', passwordHash: hash },
    { nombre: 'Gestor Cobros',  email: 'gestor@sistema.local',      rol: 'asesor',     estado: 'activo', passwordHash: hash },
  ];

  for (const u of users) {
    const existing = await db.usuario.findUnique({ where: { email: u.email } });
    if (existing) {
      await db.usuario.update({ where: { email: u.email }, data: { passwordHash: hash, estado: 'activo', rol: u.rol } });
      console.log(`✅ Actualizado: ${u.email} (rol: ${u.rol})`);
    } else {
      await db.usuario.create({ data: u });
      console.log(`✅ Creado: ${u.email} (rol: ${u.rol})`);
    }
  }

  console.log('\n📋 Credenciales de acceso:');
  console.log('─'.repeat(50));
  console.log('Admin:      admin@sistema.local      / Admin2026!');
  console.log('Supervisor: supervisor@sistema.local  / Admin2026!');
  console.log('Gestor:     gestor@sistema.local      / Admin2026!');
  console.log('─'.repeat(50));
}

main()
  .catch(e => { console.error('❌ Error:', e); process.exit(1); })
  .finally(() => db.$disconnect());
