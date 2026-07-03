require('dotenv').config();
const db = require('./src/config/db');
const bcrypt = require('bcryptjs');

async function main() {
  const hash = await bcrypt.hash('***CREDENTIAL_REMOVED***', 10);
  await db.usuario.upsert({
    where: { email: 'admin@sistema.local' },
    update: { passwordHash: hash },
    create: { nombre: 'Admin Master', email: 'admin@sistema.local', passwordHash: hash, rol: 'admin', estado: 'activo' }
  });
  console.log('Admin upserted en postgres');
  await db.$disconnect();
}
main();
