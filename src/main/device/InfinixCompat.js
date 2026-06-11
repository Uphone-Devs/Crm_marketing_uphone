const path = require('path');
const { spawn } = require('child_process');
const { app } = require('electron');

// VIDs conocidos de chipsets MediaTek usados en INFINIX
const INFINIX_VENDOR_IDS = ['0xe8d', '0x1bbb', '0x2970', '0x0e8d'];

const INFINIX_ADB_FLAGS = [
  '--no-audio',
  '--window-borderless',
  '--stay-awake'
];

const DEV_MODE_GUIDE = {
  default: 'Ajustes → Acerca del teléfono → tocar "Número de compilación" 7 veces → volver a Ajustes → Opciones de desarrollador → activar Depuración USB',
  INFINIX_HOT: 'Ajustes → Sistema → Acerca del teléfono → Número de compilación (7 toques)',
  INFINIX_NOTE: 'Ajustes → Sobre el teléfono → Versión de compilación (7 toques)'
};

function isInfinixDevice(deviceInfo) {
  if (!deviceInfo) return false;
  const info = deviceInfo.toLowerCase();
  return info.includes('infinix') || info.includes(' x6') || info.includes(' x5') || info.includes('hot');
}

function getInfinixGuide(model) {
  if (!model) return DEV_MODE_GUIDE.default;
  const m = model.toUpperCase();
  if (m.includes('INFINIX_HOT') || m.includes('HOT')) return DEV_MODE_GUIDE.INFINIX_HOT;
  if (m.includes('INFINIX_NOTE') || m.includes('NOTE')) return DEV_MODE_GUIDE.INFINIX_NOTE;
  return DEV_MODE_GUIDE.default;
}

function getScrcpyFlags(model) {
  if (isInfinixDevice(model)) {
    return INFINIX_ADB_FLAGS;
  }
  return [];
}

module.exports = { isInfinixDevice, getInfinixGuide, getScrcpyFlags, INFINIX_ADB_FLAGS };
