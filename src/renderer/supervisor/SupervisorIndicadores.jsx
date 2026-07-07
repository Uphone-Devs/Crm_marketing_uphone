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

export default function SupervisorIndicadores({ callApi }) {
  const [tab, setTab] = useState('config'); // 'config' | 'monitoreo'
  const [config, setConfig] = useState([]);
  const [loading, setLoading] = useState(true);

  // Monitoreo State
  const [asesores, setAsesores] = useState([]);
  const [selectedAsesor, setSelectedAsesor] = useState('');
  const [mes, setMes] = useState(() => (new Date().getMonth() + 1).toString().padStart(2, '0'));
  const [anio, setAnio] = useState(() => new Date().getFullYear().toString());
  const [datosAsesor, setDatosAsesor] = useState({});

  useEffect(() => {
    loadConfig();
    loadAsesores();
  }, []);

  useEffect(() => {
    if (tab === 'monitoreo' && selectedAsesor) {
      loadDatosAsesor();
    }
  }, [tab, selectedAsesor, mes, anio]);

  const loadConfig = async () => {
    try {
      const res = await callApi('db:getIndicadoresConfig');
      let parsed = JSON.parse(res);
      if (!parsed || parsed.length === 0) {
        parsed = [
          { id: 'v_vencido', name: 'V. VENCIDO', type: 'input' },
          { id: 'cobros', name: 'COBROS', type: 'input' },
          { id: 'efectividad', name: 'EFECTIVIDAD', type: 'formula', expression: '({cobros} / {v_vencido}) * 100' }
        ];
      }
      setConfig(parsed);
    } catch (e) {
      console.error(e);
      setConfig([]);
    }
    setLoading(false);
  };

  const loadAsesores = async () => {
    try {
      const wsIp = localStorage.getItem('uphone_ws_ip');
      const isVm = wsIp && wsIp !== '127.0.0.1' && wsIp !== 'localhost';
      if (isVm) {
        const token = localStorage.getItem('auth_token');
        const base  = wsIp.startsWith('http') ? wsIp.replace(/\/$/, '') : `http://${wsIp}:3001`;
        const res   = await fetch(`${base}/api/admin/users`, { headers: { Authorization: `Bearer ${token}` } });
        const data  = await res.json();
        setAsesores(Array.isArray(data) ? data : []);
      } else {
        const res = await callApi('db:getAsesores');
        setAsesores(res || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadDatosAsesor = async () => {
    try {
      const res = await callApi('db:getIndicadoresRecaudo', selectedAsesor, mes, anio);
      setDatosAsesor(res || { '0': {}, '1': {}, '2': {} });
    } catch (e) {
      console.error(e);
    }
  };

  const saveConfig = async () => {
    try {
      await callApi('db:saveIndicadoresConfig', JSON.stringify(config));
      showToast('Configuración guardada', 'success');
    } catch (e) {
      showToast('Error al guardar', 'error');
    }
  };

  const addColumn = () => {
    const id = 'col_' + Date.now();
    setConfig([...config, { id, name: 'Nueva Columna', type: 'input', expression: '' }]);
  };

  const updateColumn = (index, field, value) => {
    const newConfig = [...config];
    newConfig[index][field] = value;
    setConfig(newConfig);
  };

  const deleteColumn = (index) => {
    const newConfig = [...config];
    newConfig.splice(index, 1);
    setConfig(newConfig);
  };

  // Evaluador matemático seguro
  const evaluateFormula = (expression, rowData) => {
    if (!expression) return '';
    try {
      let evalExpr = expression;
      config.forEach(c => {
        const val = rowData[c.id] || 0;
        evalExpr = evalExpr.replaceAll(`{${c.id}}`, val);
      });
      const result = safeArithmetic(evalExpr);
      if (!isFinite(result) || isNaN(result)) return '0.00';
      return result.toFixed(2);
    } catch (e) {
      return 'Error';
    }
  };

  const renderMonitoreoTable = (segmentName, segmentKey) => {
    const daysInMonth = new Date(anio, parseInt(mes, 10), 0).getDate();
    const rows = [];
    
    // Calcular Totales del Segmento
    const segmentTotals = {};
    config.forEach(c => {
      if (c.type === 'input') segmentTotals[c.id] = 0;
    });

    for (let i = 1; i <= daysInMonth; i++) {
      const dateStr = `${anio}-${mes}-${String(i).padStart(2, '0')}`;
      const rowData = datosAsesor[segmentKey]?.[dateStr] || {};
      
      // Sumar inputs para el total
      config.forEach(c => {
        if (c.type === 'input') {
          segmentTotals[c.id] += (parseFloat(rowData[c.id]) || 0);
        }
      });

      const tds = config.map(col => {
        let val = '';
        if (col.type === 'input') {
          val = rowData[col.id] !== undefined ? rowData[col.id] : '-';
        } else {
          val = evaluateFormula(col.expression, rowData);
          if (val !== '-' && val !== 'Error' && val !== '#DIV/0!') val += '%';
        }
        return (
          <td key={col.id} style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>
            {val}
          </td>
        );
      });

      rows.push(
        <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
          <td style={{ padding: '8px', textAlign: 'center', fontWeight: '500' }}>
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
        return <td key={col.id} style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' }} className={colorClass}>{val}</td>;
      }
    });

    return (
      <div style={{ flex: 1, minWidth: 400, backgroundColor: 'var(--bg-panel)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
        <h3 style={{ textAlign: 'center', backgroundColor: 'var(--color-primary-dark)', color: 'white', padding: '12px', margin: 0, fontSize: '1rem' }}>
          {segmentName}
        </h3>
        <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ position: 'sticky', top: 0, backgroundColor: 'var(--bg-color)', zIndex: 1 }}>
              <tr>
                <th style={{ padding: '12px', borderBottom: '2px solid var(--border-color)', color: 'var(--text-muted)' }}>FECHA</th>
                {config.map(c => (
                  <th key={c.id} style={{ padding: '12px', borderBottom: '2px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows}
            </tbody>
            <tfoot style={{ position: 'sticky', bottom: 0, zIndex: 2 }}>
              <tr style={{
                background: 'linear-gradient(90deg, rgba(10,10,18,0.98), rgba(18,18,30,0.98))',
                borderTop: '2px solid var(--color-primary)',
                boxShadow: '0 -4px 20px rgba(0,0,0,0.5)',
              }}>
                <td style={{
                  padding: '11px 12px',
                  textAlign: 'center',
                  fontWeight: 800,
                  fontSize: 12,
                  letterSpacing: '0.1em',
                  color: 'var(--color-primary)',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                }}>TOTALES</td>
                {totalTds}
              </tr>
            </tfoot>
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
      const segmentData = datosAsesor[segmentKey] || {};
      Object.values(segmentData).forEach(rowData => {
        config.forEach(c => {
          if (c.type === 'input') {
            globalTotals[c.id] += (parseFloat(rowData[c.id]) || 0);
          }
        });
      });
    });

    return (
      <div style={{ backgroundColor: 'var(--bg-panel)', padding: '20px 24px', borderRadius: 16, border: '1px solid rgba(255,255,255,0.05)', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
        <h3 style={{ margin: '0 0 16px 0', color: 'var(--color-primary)', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="material-symbols-outlined">public</span>
          Resumen Global (Todos los Segmentos)
        </h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
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
              <div key={col.id} style={{ flex: '1 1 200px', backgroundColor: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 600, letterSpacing: 1 }}>{col.name.toUpperCase()}</div>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: isFormula ? 'var(--color-primary)' : 'white' }}>
                  {val}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  if (loading) return <div style={{ padding: 24 }}>Cargando...</div>;

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 24, height: '100%', overflowY: 'auto' }}>
      
      {/* HEADER TABS */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <button type="button"
          style={{
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '10px 16px',
            background: tab === 'config' ? 'rgba(255,255,255,0.06)' : 'transparent',
            border: 'none',
            borderBottom: tab === 'config' ? '2px solid var(--color-primary)' : '2px solid transparent',
            borderRadius: '8px 8px 0 0',
            cursor: 'pointer',
            color: tab === 'config' ? '#fff' : 'rgba(255,255,255,0.45)',
            fontSize: 12, fontWeight: tab === 'config' ? 700 : 500,
            letterSpacing: '0.05em', textTransform: 'uppercase',
            transition: 'background .15s, opacity .15s, border-color .15s, color .15s',
          }}
          onClick={() => setTab('config')}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>settings</span>
          Constructor de Fórmulas
        </button>
        <button type="button"
          style={{
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '10px 16px',
            background: tab === 'monitoreo' ? 'rgba(255,255,255,0.06)' : 'transparent',
            border: 'none',
            borderBottom: tab === 'monitoreo' ? '2px solid var(--color-primary)' : '2px solid transparent',
            borderRadius: '8px 8px 0 0',
            cursor: 'pointer',
            color: tab === 'monitoreo' ? '#fff' : 'rgba(255,255,255,0.45)',
            fontSize: 12, fontWeight: tab === 'monitoreo' ? 700 : 500,
            letterSpacing: '0.05em', textTransform: 'uppercase',
            transition: 'background .15s, opacity .15s, border-color .15s, color .15s',
          }}
          onClick={() => setTab('monitoreo')}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>monitoring</span>
          Monitoreo de Asesores
        </button>
      </div>

      {/* TAB: CONFIGURACIÓN */}
      {tab === 'config' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ margin: 0 }}>Columnas e Indicadores</h2>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14 }}>Define las columnas que los asesores deben llenar y las fórmulas que se calcularán automáticamente.</p>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button type="button" className="btn" onClick={addColumn}>+ Añadir Columna</button>
              <button type="button" className="btn btn-primary" onClick={saveConfig}>Guardar Configuración</button>
            </div>
          </div>

          <div style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 12, padding: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '12px' }}>ID (Variables)</th>
                  <th style={{ textAlign: 'left', padding: '12px' }}>Nombre Mostrado</th>
                  <th style={{ textAlign: 'left', padding: '12px' }}>Tipo</th>
                  <th style={{ textAlign: 'left', padding: '12px' }}>Fórmula Matemática</th>
                  <th style={{ textAlign: 'left', padding: '12px' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {config.map((col, idx) => (
                  <tr key={col.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '12px', fontFamily: 'monospace', color: 'var(--color-primary)' }}>
                      {`{${col.id}}`}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <input 
                        className="input" 
                        value={col.name} 
                        onChange={e => updateColumn(idx, 'name', e.target.value)} 
                        placeholder="Ej. Valor Vencido"
                      />
                    </td>
                    <td style={{ padding: '12px' }}>
                      <select className="input" value={col.type} onChange={e => updateColumn(idx, 'type', e.target.value)}>
                        <option value="input">Entrada Manual (Número)</option>
                        <option value="formula">Fórmula (Automático)</option>
                      </select>
                    </td>
                    <td style={{ padding: '12px' }}>
                      {col.type === 'formula' ? (
                        <input aria-label="Campo" 
                          className="input" 
                          style={{ width: '100%', fontFamily: 'monospace' }}
                          value={col.expression} 
                          onChange={e => updateColumn(idx, 'expression', e.target.value)} 
                          placeholder="Ej. ({cobros} / {v_vencido}) * 100"
                        />
                      ) : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>N/A</span>}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <button type="button" className="btn btn-icon" onClick={() => deleteColumn(idx)} style={{ color: 'var(--color-danger)' }}>
                        <span className="material-symbols-outlined">delete</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            
            <div style={{ marginTop: 24, padding: 16, backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 8 }}>
              <h4 style={{ marginTop: 0 }}>Instrucciones para Fórmulas:</h4>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: 'var(--text-muted)' }}>
                <li>Para usar el valor de otra columna, escribe su ID entre llaves. Ej: <code>{`{v_vencido}`}</code>.</li>
                <li>Operadores soportados: <code>+</code> (Suma), <code>-</code> (Resta), <code>*</code> (Multiplicación), <code>/</code> (División), <code>()</code> (Paréntesis).</li>
                <li>Ejemplo de efectividad: <code>{`({cobros} / {v_vencido}) * 100`}</code></li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* TAB: MONITOREO */}
      {tab === 'monitoreo' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', backgroundColor: 'var(--bg-panel)', padding: '20px', borderRadius: 12 }}>
            <div style={{ flex: 1 }}>
              <label className="text-muted" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>Seleccionar Asesor</label>
              <select className="input" style={{ width: '100%' }} value={selectedAsesor} onChange={e => setSelectedAsesor(e.target.value)}>
                <option value="">-- Elige un asesor --</option>
                {asesores.filter(a => a.rol === 'asesor' && a.estado === 'activo').map(a => (
                  <option key={a.id} value={a.id}>{a.nombre}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-muted" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>Mes</label>
              <select className="input" value={mes} onChange={e => setMes(e.target.value)}>
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
            </div>
            <div>
              <label className="text-muted" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>Año</label>
              <select className="input" value={anio} onChange={e => setAnio(e.target.value)}>
                <option value="2025">2025</option>
                <option value="2026">2026</option>
                <option value="2027">2027</option>
              </select>
            </div>
          </div>

          {!selectedAsesor ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
              Selecciona un asesor de la lista para ver sus indicadores.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 16 }}>
              {renderGlobalSummary()}
              <div style={{ display: 'flex', gap: 24, overflowX: 'auto', paddingBottom: 16 }}>
                {renderMonitoreoTable('SEGMENTO CEROS', '0')}
                {renderMonitoreoTable('SEGMENTO UNO', '1')}
                {renderMonitoreoTable('SEGMENTO DOS', '2')}
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
