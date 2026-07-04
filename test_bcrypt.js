const b = require('./node_modules/bcryptjs');
const hash = '$2b$10$Z2G3AVjcgGXXeg92Rv9P6Ohu5bxOiO7E8u117h1unlqk85quX9Vxi';
const ok = b.compareSync('Johandra2026!', hash);
console.log('Match:', ok);
const newHash = b.hashSync('Johandra2026!', 10);
console.log('New hash:', newHash);
