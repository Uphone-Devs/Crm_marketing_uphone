/**
 * check-ffmpeg.js — Verifica la instalación de FFmpeg y lista dispositivos de audio.
 *
 * Uso: node scripts/check-ffmpeg.js
 */

const { execSync } = require('child_process');

console.log('╔══════════════════════════════════════════╗');
console.log('║   UPHONE Terminal — Verificación FFmpeg  ║');
console.log('╚══════════════════════════════════════════╝\n');

// 1. Verificar FFmpeg
try {
  const version = execSync('ffmpeg -version', { encoding: 'utf8' });
  const versionLine = version.split('\n')[0];
  console.log(`✅ FFmpeg encontrado: ${versionLine}`);
} catch {
  console.log('❌ FFmpeg NO encontrado en PATH');
  console.log('   Instala FFmpeg desde: https://ffmpeg.org/download.html');
  console.log('   O usa: winget install Gyan.FFmpeg');
  process.exit(1);
}

// 2. Listar dispositivos de audio
console.log('\n── Dispositivos de audio DirectShow ──');
try {
  const output = execSync('ffmpeg -list_devices true -f dshow -i dummy 2>&1', {
    encoding: 'utf8',
    timeout: 5000,
  });

  const audioSection = output.split('DirectShow audio devices')[1];
  if (audioSection) {
    const lines = audioSection.split('\n');
    let count = 0;
    for (const line of lines) {
      const match = line.match(/"([^"]+)"/);
      if (match && !line.includes('Alternative name')) {
        count++;
        console.log(`   ${count}. ${match[1]}`);
      }
    }
    if (count === 0) console.log('   ⚠️ No se encontraron dispositivos de audio');
  }
} catch (e) {
  // ffmpeg exits with error when listing devices, but output is in stderr
  const output = e.stderr || e.stdout || e.message;
  const lines = output.split('\n');
  let inAudio = false;
  let count = 0;
  for (const line of lines) {
    if (line.includes('DirectShow audio devices')) inAudio = true;
    if (inAudio) {
      const match = line.match(/"([^"]+)"/);
      if (match && !line.includes('Alternative name')) {
        count++;
        console.log(`   ${count}. ${match[1]}`);
      }
    }
  }
  if (count === 0) console.log('   ⚠️ No se encontraron dispositivos de audio');
}

// 3. Verificar ADB
console.log('\n── Android Debug Bridge (ADB) ──');
try {
  const version = execSync('adb version', { encoding: 'utf8' });
  const versionLine = version.split('\n')[0];
  console.log(`✅ ADB encontrado: ${versionLine}`);

  const devices = execSync('adb devices -l', { encoding: 'utf8' });
  const deviceLines = devices.split('\n').filter(l => l.includes('device') && !l.startsWith('List'));
  if (deviceLines.length > 0) {
    console.log(`   📱 ${deviceLines.length} dispositivo(s) conectado(s):`);
    deviceLines.forEach(l => console.log(`      ${l.trim()}`));
  } else {
    console.log('   ℹ️ No hay dispositivos conectados');
  }
} catch {
  console.log('⚠️ ADB no encontrado (opcional para modo local)');
}

console.log('\n✅ Verificación completa\n');
