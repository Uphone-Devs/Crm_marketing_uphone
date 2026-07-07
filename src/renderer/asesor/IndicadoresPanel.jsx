import React, { useState, useEffect } from 'react';
import { showToast } from '../shared/Toast';

function safeArithmetic(expr) {
  const s = expr.replace(/\s/g, '');
  if (!/^[0-9+\-*/.()]+$/.test(s)) throw new Error('Invalid expr');
  let i = 0;

  function parseE() {
    let v = parseT();
    while (i < s.length && (s[i] === '+' || s[i] === '-')) {
      const op = s[i++];
      v = op === '+' ? v + parseT() : v - parseT();
    }
    return v;
  }

  function parseT() {
    let v = parseF();
    while (i < s.length && (s[i] === '*' || s[i] === '/')) {
      const op = s[i++];
      v = op === '*' ? v * parseF() : v / parseF();
    }
    return v;
  }

  function parseF() {
    if (s[i] === '(') { i++; const v = parseE(); i++; return v; }
    if (s[i] === '-') { i++; return -parseF(); }
    const start = i;
    while (i < s.length && /[0-9.]/.test(s[i])) i++;
    return parseFloat(s.slice(start, i));
  }

  return parseE();
}

export default function IndicadoresPanel({ callApi, usuario }) {
  const [mes, setMes] = useState(() => (new Date().getMonth() + 1).toString().padStart(2, '0'));
  const [anio, setAnio] = useState(() => new Date().getFullYear().toString());
  const [data, setData] = useState({ '0': {}, '1': {}, '2': {} });
  const [config, setConfig] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadConfigAndData();
  }, [mes, anio]);

  const loadConfigAndData = async () => {
    setLoading(true);
    try {
      const cfgStr = await callApi('db:getIndicadoresConfig');
      let cfg = JSON.parse(cfgStr);
      if (!cfg || cfg.length === 0) {
        cfg = [
          { id: 'v_vencido', name: 'V. VENCIDO', type: 'input' },
          { id: 'cobros', name: 'COBROS', type: 'input' },
          { id: 'efectividad', name: 'EFECTIVIDAD', type: 'formula', expression: '({cobros} / {v_vencido}) * 100' }
        ];
      }
      setConfig(cfg);

      const asesorId = usuario ? usuario.id : null;
      const res = await callApi('db:getIndicadoresRecaudo', asesorId, mes, anio);
      setData(res || { '0': {}, '1': {}, '2': {} });
    } catch (e) {
      console.error("Error cargando indicadores:", e);
    }
    setLoading(false);
  };

  const handleInputChange = (segmentKey, dateStr, fieldId, value) => {
    const val = parseFloat(value);
    const numericValue = isNaN(val) ? 0 : val;

    setData(prev => {
      const newData = { ...prev };
      if (!newData[segmentKey]) newData[segmentKey] = {};
      if (!newData[segmentKey][dateStr]) newData[segmentKey][dateStr] = {};
      
      newData[segmentKey][dateStr] = {
        ...newData[segmentKey][dateStr],
        [fieldId]: numericValue
      };
      return newData;
    });
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      const flatData = [];
      Object.keys(data).forEach(segmentKey => {
        Object.keys(data[segmentKey]).forEach(dateStr => {
          flatData.push({
            fecha: dateStr,
            segmento: segmentKey,
            valores: data[segmentKey][dateStr]
          });
        });
      });

      if (flatData.length > 0) {
        const asesorId = usuario ? usuario.id : null;
        await callApi('db:saveIndicadoresRecaudo', asesorId, flatData);
        showToast('Indicadores guardados correctamente', 'success');
      } else {
        showToast('No hay datos para guardar', 'info');
      }
    } catch (e) {
      console.error('Error guardando indicadores', e);
      showToast('Error al guardar', 'error');
    }
    setSaving(false);
  };

  const evaluateFormula = (expression, rowData) => {
    if (!expression) return '';
    try {
      let evalExpr = expression;
      config.forEach(c => {
        const val = Number(rowData[c.id]) || 0;
        evalExpr = evalExpr.replaceAll(`{${c.id}}`, val);
      });
      const result = safeArithmetic(evalExpr);
      if (!isFinite(result) || isNaN(result)) return '0.00';
      return result.toFixed(2);
    } catch (e) {
      return 'Error';
    }
  };

  const renderTable = (segmentName, segmentKey) => {
    const daysInMonth = new Date(anio, parseInt(mes, 10), 0).getDate();
    const rows = [];
    
    // Calcular Totales del Segmento
    const segmentTotals = {};
    config.forEach(c => {
      if (c.type === 'input') segmentTotals[c.id] = 0;
    });

    for (let i = 1; i <= daysInMonth; i++) {
      const dateStr = `${anio}-${mes}-${String(i).padStart(2, '0')}`;
      const rowData = data[segmentKey]?.[dateStr] || {};
      
      // Sumar inputs para el total
      config.forEach(c => {
        if (c.type === 'input') {
          segmentTotals[c.id] += (parseFloat(rowData[c.id]) || 0);
        }
      });

      const tds = config.map(col => {
        if (col.type === 'input') {
          const val = rowData[col.id] || '';
          return (
            <td key={col.id} style={{ padding: '4px 4px' }}>
              <input aria-label="Campo" 
                type="number" 
                className="input no-spinners" 
                style={{ 
                  width: '100%', 
                  textAlign: 'right', 
                  padding: '5px 6px', 
                  minHeight: '30px', 
                  backgroundColor: 'rgba(255,255,255,0.05)', 
                  color: 'white', 
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '5px',
                  fontSize: '12px',
                  fontWeight: '500',
                  MozAppearance: 'textfield'
                }}
                value={val} 
                onChange={e => handleInputChange(segmentKey, dateStr, col.id, e.target.value)}
                placeholder="0"
              />
              <style>{`
                input[type=number].no-spinners::-webkit-inner-spin-button, 
                input[type=number].no-spinners::-webkit-outer-spin-button { 
                  -webkit-appearance: none; 
                  margin: 0; 
                }
              `}</style>
            </td>
          );
        } else {
          let val = evaluateFormula(col.expression, rowData);
          let colorClass = 'text-muted';
          if (val !== 'Error' && val !== '#DIV/0!' && val !== '') {
            const num = parseFloat(val);
            if (num >= 50) colorClass = 'text-success';
            else if (num > 0) colorClass = 'text-warning';
            val += '%';
          }
          
          return (
            <td key={col.id} style={{ padding: '8px', textAlign: 'center', fontWeight: 'bold' }} className={colorClass}>
              {val}
            </td>
          );
        }
      });

      rows.push(
        <tr key={i} style={{
          borderBottom: '1px solid rgba(255,255,255,0.04)',
          background: i % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent',
          transition: 'background .1s',
        }}>
          <td style={{ padding: '8px 12px', fontWeight: 600, fontSize: 12, color: 'rgba(255,255,255,0.6)', whiteSpace:'nowrap' }}>
            {`${String(i).padStart(2, '0')}/${mes}/${anio}`}
          </td>
          {tds}
        </tr>
      );
    }

    // Fila de Totales
    const totalTds = config.map(col => {
      if (col.type === 'input') {
        return <td key={col.id} style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 'bold', color: 'var(--color-primary)' }}>{segmentTotals[col.id].toFixed(2)}</td>;
      } else {
        let val = evaluateFormula(col.expression, segmentTotals);
        let colorClass = 'text-primary';
        if (val !== 'Error' && val !== '#DIV/0!' && val !== '') val += '%';
        return <td key={col.id} style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 'bold' }} className={colorClass}>{val}</td>;
      }
    });

    return (
      <div style={{ flex: '0 0 420px', width: 420, backgroundColor: 'rgba(255,255,255,0.025)', borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 4px 24px rgba(0,0,0,0.2)', display:'flex', flexDirection:'column' }}>
        {/* Segment header */}
        <div style={{ padding: '10px 16px', background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.07)', display:'flex', alignItems:'center', gap:8 }}>
          <span className="material-symbols-outlined" style={{ fontSize:14, color:'var(--color-primary)' }}>table_chart</span>
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.85)', textTransform: 'uppercase' }}>
            {segmentName}
          </span>
        </div>

        {/* Scrollable area — vertical only, no horizontal bar per card */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', position: 'relative' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
            <thead>
              <tr style={{
                position: 'sticky', top: 0, zIndex: 3,
                background: 'rgba(12,12,20,1)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
              }}>
                <th style={{ padding: '8px 8px', textAlign:'left', fontSize: 12, fontWeight: 700, letterSpacing:'0.07em', color:'rgba(255,255,255,0.4)', textTransform:'uppercase', borderBottom:'1px solid rgba(255,255,255,0.08)', whiteSpace:'nowrap', width: 80 }}>Fecha</th>
                {config.map(c => (
                  <th key={c.id} style={{ padding: '8px 6px', textAlign: c.type === 'input' ? 'center' : 'center', fontSize: 12, fontWeight: 700, letterSpacing:'0.07em', color:'rgba(255,255,255,0.4)', textTransform:'uppercase', borderBottom:'1px solid rgba(255,255,255,0.08)', whiteSpace:'nowrap' }}>
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows}
            </tbody>
          </table>
        </div>

        {/* TOTALES — outside the scroll, always visible at bottom */}
        <div style={{ borderTop: '2px solid var(--color-primary)', background: 'rgba(10,10,18,0.98)', boxShadow: '0 -4px 20px rgba(0,0,0,0.4)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <tbody>
              <tr>
                <td style={{ padding: '10px 12px', fontWeight: 800, fontSize: 12, letterSpacing:'0.1em', color:'var(--color-primary)', textTransform:'uppercase', whiteSpace:'nowrap', textAlign:'left' }}>
                  TOTALES
                </td>
                {totalTds}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderGlobalSummary = () => {
    // Calcular suma global de todos los segmentos
    const globalTotals = {};
    config.forEach(c => {
      if (c.type === 'input') globalTotals[c.id] = 0;
    });

    ['0', '1', '2'].forEach(segmentKey => {
      const segmentData = data[segmentKey] || {};
      Object.values(segmentData).forEach(rowData => {
        config.forEach(c => {
          if (c.type === 'input') {
            globalTotals[c.id] += (parseFloat(rowData[c.id]) || 0);
          }
        });
      });
    });

    return (
      <div style={{ 
        backgroundColor: 'rgba(12, 12, 20, 0.98)', 
        padding: '12px 24px', 
        borderBottom: '1px solid rgba(255,255,255,0.08)', 
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        zIndex: 10,
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingRight: 24, borderRight: '1px solid rgba(255,255,255,0.1)' }}>
          <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: 28 }}>public</span>
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Todos los Segmentos</div>
            <div style={{ color: 'var(--color-primary)', fontSize: 14, fontWeight: 800, textTransform: 'uppercase' }}>Resumen Global</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'nowrap', gap: 32, overflowX: 'auto', flex: 1, scrollbarWidth: 'none' }}>
          {config.map(col => {
            let val;
            let isFormula = col.type === 'formula';
            if (!isFormula) {
              val = globalTotals[col.id].toFixed(2);
            } else {
              val = evaluateFormula(col.expression, globalTotals);
              if (val !== 'Error' && val !== '#DIV/0!' && val !== '') val += '%';
            }
            return (
              <div key={col.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 700, letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>{col.name.toUpperCase()}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: isFormula ? 'var(--color-primary)' : 'white', whiteSpace: 'nowrap' }}>
                  {val}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%', overflow: 'hidden' }}>

      {/* ── Header bar ── */}
      <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', gap: 12 }}>
        <div>
          <h2 className="text-headline-sm" style={{ margin: 0, color: 'var(--color-primary)', fontSize: 15 }}>Mis Indicadores</h2>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 12, opacity: 0.6 }}>Ingresa tus métricas diarias de gestión y recaudo</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <select className="input" value={mes} onChange={e => setMes(e.target.value)} style={{ width: 120, fontSize: 12 }}>
            <option value="01">Enero</option>
            <option value="02">Febrero</option>
            <option value="03">Marzo</option>
            <option value="04">Abril</option>
            <option value="05">Mayo</option>
            <option value="06">Junio</option>
            <option value="07">Julio</option>
            <option value="08">Agosto</option>
            <option value="09">Septiembre</option>
            <option value="10">Octubre</option>
            <option value="11">Noviembre</option>
            <option value="12">Diciembre</option>
          </select>
          <select className="input" value={anio} onChange={e => setAnio(e.target.value)} style={{ width: 88, fontSize: 12 }}>
            <option value="2025">2025</option>
            <option value="2026">2026</option>
            <option value="2027">2027</option>
          </select>
          <button type="button" className="btn btn-icon" onClick={loadConfigAndData} title="Actualizar datos" disabled={loading}>
            <span className={`material-symbols-outlined ${loading ? 'spin' : ''}`}>refresh</span>
          </button>
          <button type="button" className="btn btn-primary" onClick={saveAll} disabled={saving} style={{ padding: '0 16px', fontSize: 12 }}>
            <span className="material-symbols-outlined" style={{ marginRight: 6, fontSize: 16 }}>save</span>
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>

      {/* ── Resumen Global FIJO ── */}
      {!loading && renderGlobalSummary()}

      {/* ── Scrollable content ── */}
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflowX: 'auto', overflowY: 'hidden', padding: '16px 16px 0', display: 'flex', flexDirection: 'column' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
            <div className="dot dot-primary dot-pulse" style={{ width: 32, height: 32 }} />
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 16, paddingBottom: 16, minWidth: 'min-content', flex: 1 }}>
            {renderTable('SEGMENTO CEROS', '0')}
            {renderTable('SEGMENTO UNO', '1')}
            {renderTable('SEGMENTO DOS', '2')}
          </div>
        )}
      </div>
    </div>
  );
}
