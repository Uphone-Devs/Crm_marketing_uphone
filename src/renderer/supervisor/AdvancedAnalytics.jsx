import React, { useState, useEffect } from 'react';

export default function AdvancedAnalytics() {
  const [stats, setStats] = useState(null);
  const [roi, setRoi] = useState(null);

  useEffect(() => {
    async function loadData() {
      const roiData = await window.api.invoke('adb:getROI');
      setRoi(roiData);
      
      // En una versión real, aquí pediríamos más agregaciones
      setStats({
        ringTime: 14,
        idleTime: 8,
        contactability: 65
      });
    }
    loadData();
  }, []);

  if (!roi) return <div className="spinner" />;

  return (
    <div className="analytics-container" style={{ padding: 24 }}>
      <h2 className="text-headline-md" style={{ marginBottom: 24 }}>Analítica Avanzada & ROI</h2>
      
      <div className="asesor-layout-grid">
        {/* Card ROI */}
        <div className="widget-card glow-primary">
          <div className="widget-header">
            <span className="text-label" style={{ opacity: 0.5 }}>IMPACTO ECONÓMICO UPHONE</span>
          </div>
          <div style={{ marginTop: 16 }}>
            <p className="text-body-sm" style={{ opacity: 0.6 }}>Ahorro por Automatización (Mensual Estimado)</p>
            <h3 style={{ fontSize: 42, fontWeight: 800, color: 'var(--color-primary)' }}>${roi.dineroAhorrado}</h3>
            <p className="text-label-sm" style={{ marginTop: 8 }}>
              EQUIVALE A <strong>{roi.horasAhorradas} HORAS</strong> DE TRABAJO AGENTE RECUPERADAS
            </p>
          </div>
        </div>

        {/* Card Operativas */}
        <div className="widget-card">
          <div className="widget-header">
            <span className="text-label" style={{ opacity: 0.5 }}>EFICIENCIA OPERATIVA</span>
          </div>
          <div className="stats-table" style={{ marginTop: 16 }}>
            <div className="stats-row">
              <span className="text-body-sm">Contactabilidad Cruda</span>
              <span className="stats-value">{stats?.contactability}%</span>
            </div>
            <div className="stats-row">
              <span className="text-body-sm">Ring Time Promedio</span>
              <span className="stats-value">{stats?.ringTime}s</span>
            </div>
            <div className="stats-row">
              <span className="text-body-sm">Idle Time (Punto Ciego)</span>
              <span className="stats-value" style={{ color: 'var(--color-danger)' }}>{stats?.idleTime}s</span>
            </div>
          </div>
        </div>
      </div>

      <div className="widget-card" style={{ marginTop: 24 }}>
        <h3 className="widget-title">Efectividad por Operadora (Ecuador)</h3>
        <div style={{ height: 200, display: 'flex', alignItems: 'flex-end', gap: 12, marginTop: 20 }}>
          <div style={{ flex: 1, height: '80%', background: 'var(--color-primary)', borderRadius: 4, position: 'relative' }}>
            <span style={{ position: 'absolute', bottom: -25, left: 0, fontSize: 10 }}>CLARO</span>
          </div>
          <div style={{ flex: 1, height: '65%', background: 'var(--color-primary)', borderRadius: 4, position: 'relative', opacity: 0.7 }}>
             <span style={{ position: 'absolute', bottom: -25, left: 0, fontSize: 10 }}>MOVISTAR</span>
          </div>
          <div style={{ flex: 1, height: '40%', background: 'var(--color-primary)', borderRadius: 4, position: 'relative', opacity: 0.5 }}>
             <span style={{ position: 'absolute', bottom: -25, left: 0, fontSize: 10 }}>CNT</span>
          </div>
          <div style={{ flex: 1, height: '20%', background: 'var(--color-primary)', borderRadius: 4, position: 'relative', opacity: 0.3 }}>
             <span style={{ position: 'absolute', bottom: -25, left: 0, fontSize: 10 }}>OTROS</span>
          </div>
        </div>
      </div>
    </div>
  );
}
