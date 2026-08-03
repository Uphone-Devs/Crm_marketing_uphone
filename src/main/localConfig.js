const fs   = require('fs');
const path = require('path');
const { app } = require('electron');

let _data     = null;
let _filePath = null;

function _ensureLoaded() {
  if (_data !== null) return;
  _filePath = path.join(app.getPath('userData'), 'local-config.json');
  try {
    _data = JSON.parse(fs.readFileSync(_filePath, 'utf8'));
  } catch {
    _data = {};
  }
}

function _persist() {
  fs.writeFileSync(_filePath, JSON.stringify(_data, null, 2), 'utf8');
}

function getLocalConfig(key) {
  _ensureLoaded();
  return _data[key] ?? null;
}

function setLocalConfig(key, value) {
  _ensureLoaded();
  _data[key] = value;
  _persist();
}

module.exports = { getLocalConfig, setLocalConfig };
