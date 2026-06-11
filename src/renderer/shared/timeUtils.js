// Helpers de tiempo en HORA LOCAL (no UTC). Necesarios porque las queries
// del backend usan date(col) sobre timestamps almacenados — guardar UTC
// produce desalineación nocturna en Ecuador (UTC-5): gestiones del lunes
// 19:30 local se almacenan como martes 00:30 UTC → no aparecen en filtro
// "hoy=lunes".

export function nowLocalISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, -1); // strip Z
}

export function todayLocalISO() {
  return nowLocalISO().slice(0, 10);
}

// Formatea un timestamp (UTC con Z o local sin Z) como hora local 'HH:MM:SS'.
// Útil para Excel/CSV reports y vistas que deben mostrar hora del usuario.
export function toLocalHora(ts) {
  if (!ts || typeof ts !== 'string') return '';
  try {
    const d = new Date(ts.replace(' ', 'T'));
    if (isNaN(d.getTime())) return ts;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch { return ts; }
}

// Formatea timestamp completo como local 'YYYY-MM-DD HH:MM:SS'.
export function toLocalDateTime(ts) {
  if (!ts || typeof ts !== 'string') return '';
  try {
    const d = new Date(ts.replace(' ', 'T'));
    if (isNaN(d.getTime())) return ts;
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch { return ts; }
}
