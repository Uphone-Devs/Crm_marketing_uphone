let _addToastFn = null;

export function setAddToastFn(fn) {
  _addToastFn = fn;
}

export function showToast(message, type = 'info', duration = 2500, opts = {}) {
  if (_addToastFn) _addToastFn({ message, type, duration, id: Date.now() + Math.random(), ...opts });
}
