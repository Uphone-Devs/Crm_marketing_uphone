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
  const password = process.env.SEED_PASSWORD;
  if (!password) {
    console.error('❌ SEED_PASSWORD env var no definida. Agregar a .env antes de correr el seed.');
    process.exit(1);
  }
  const hash = bcrypt.hashSync(password, 10);

  const users = [
    { nombre: 'Administrador',  email: 'admin@sistema.local',     rol: 'admin',     estado: 'activo', passwordHash: hash },
    { nombre: 'Supervisor CRM', email: 'supervisor@sistema.local', rol: 'jefe_area', estado: 'activo', passwordHash: hash },
    { nombre: 'Gestor Cobros',  email: 'gestor@sistema.local',     rol: 'asesor',    estado: 'activo', passwordHash: hash },
  ];

  await Promise.all(users.map(async (u) => {
    const existing = await db.usuario.findUnique({ where: { email: u.email } });
    if (existing) {
      await db.usuario.update({ where: { email: u.email }, data: { passwordHash: hash, estado: 'activo', rol: u.rol } });
      console.log(`Actualizado: ${u.email} (rol: ${u.rol})`);
    } else {
      await db.usuario.create({ data: u });
      console.log(`Creado: ${u.email} (rol: ${u.rol})`);
    }
  }));

  console.log('\nSeed completado. Cambiar contraseñas desde el panel admin antes de usar en producción.');
}

main()
  .catch(e => { console.error('❌ Error:', e); process.exit(1); })
  .finally(() => db.$disconnect());
