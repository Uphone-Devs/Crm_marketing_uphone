import { useMemo } from 'react';
import Modal from '../shared/Modal';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts';

/**
 * MetricDetailModal — Ranking comparativo de asesores por tipo de métrica.
 *
 * Props:
 *   - metricas: { [asesorId]: { total_marcaciones, total_gestiones, total_compromisos, tiempo_al_aire, eficiencia, estado_actual_id } }
 *   - metricasEquipo: objeto con detalleAsesores desde DB (fuente primaria)
 *   - asesores: array de { id, nombre }
 *   - metricType: 'mph' | 'rotacion' | 'contactabilidad' | 'concurrencia' | 'ringtime'
 */
export default function MetricDetailModal({ open, onClose, metricType, metricTitle, asesores, metricas = {}, metricasEquipo = null, rotDetalle = null }) {

  const unitLabel = {
    rotacion: '%',
    contactabilidad: '%',
    concurrencia: 'activo',
    gestiones: 'gest.',
  }[metricType] || '';

  const data = useMemo(() => {
    // Para rotacion, usar rotDetalle que tiene total_asignados + gestionados_base reales
    let sourceList;
    if (metricType === 'rotacion' && rotDetalle?.length > 0) {
      sourceList = rotDetalle.map(d => ({ nombre: d.asesor?.nombre, m: d.metricas || {} }));
    } else {
      sourceList = metricasEquipo?.detalleAsesores?.length > 0
        ? metricasEquipo.detalleAsesores.map(d => ({ nombre: d.asesor.nombre, m: d.metricas }))
        : (asesores || []).map(a => ({ nombre: a.nombre, m: metricas[a.id] || {} }));
    }

    return sourceList.map(({ nombre, m }) => {
      const marcaciones    = m.total_marcaciones  || 0;
      const gestiones      = m.total_gestiones    || 0;
      const compromisos    = m.total_compromisos  || 0;
      const eficiencia     = m.ratio_productividad || m.eficiencia || 0;
      const enGestion      = m.estado_actual_id === 1 ? 1 : 0;
      const totalAsignados = m.total_asignados  || 0;
      const gestionadosBase = m.gestionados_base || 0;

      let val = 0;
      let extra = null; // info adicional para mostrar en tooltip / tabla
      switch (metricType) {
        case 'rotacion':
          // % de cartera asignada con al menos una gestión completada
          val = totalAsignados > 0 ? Math.round((gestionadosBase / totalAsignados) * 100) : 0;
          extra = `${gestionadosBase} / ${totalAsignados}`;
          break;
        case 'contactabilidad':
          val = gestiones > 0 ? Math.round((compromisos / gestiones) * 100) : 0;
          break;
        case 'concurrencia':
          val = enGestion;
          break;
        case 'gestiones':
          val = marcaciones;
          break;
        default:
          val = eficiencia;
      }

      return { name: nombre.split(' ')[0], value: val, fullName: nombre, extra };
    }).sort((a, b) => b.value - a.value);
  }, [asesores, metricType, metricas, metricasEquipo]);

  const summaryStats = useMemo(() => {
    if (!data.length) return null;
    const values = data.map(d => d.value);
    const total = values.reduce((s, v) => s + v, 0);
    return {
      total,
      avg: Math.round(total / values.length),
      max: Math.max(...values),
    };
  }, [data]);

  const colorPalette = ['#00E5FF', '#2979FF', '#651FFF', '#00B0FF', '#1DE9B6'];

  return (
    <Modal open={open} onClose={onClose} title={`Detalle por Asesor: ${metricTitle}`}>
      <div style={{ padding: '1rem', width: '100%', minWidth: '560px' }}>

        {summaryStats && (
          <div style={{ display: 'flex', gap: 32, marginBottom: 20, padding: '12px 20px', background: 'rgba(255,255,255,0.04)', borderRadius: 8 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Total Equipo</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-primary)' }}>
                {summaryStats.total} <span style={{ fontSize: 11, fontWeight: 400 }}>{unitLabel}</span>
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Promedio</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>
                {summaryStats.avg} <span style={{ fontSize: 11, fontWeight: 400 }}>{unitLabel}</span>
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Más Alto</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#1DE9B6' }}>
                {summaryStats.max} <span style={{ fontSize: 11, fontWeight: 400 }}>{unitLabel}</span>
              </div>
            </div>
          </div>
        )}

        <div style={{ height: Math.max(180, data.length * 52 + 40) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 8, right: 72, left: 10, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(255,255,255,0.05)" />
              <XAxis type="number" stroke="rgba(255,255,255,0.3)" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} />
              <YAxis dataKey="name" type="category" stroke="rgba(255,255,255,0.3)" tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12 }} width={80} />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.02)' }}
                contentStyle={{ background: '#121212', border: '1px solid #333', borderRadius: 8 }}
                formatter={(value, _name, props) => {
                  const ex = props.payload.extra;
                  const main = `${value} ${unitLabel}`;
                  return [ex ? `${main} · ${ex}` : main, props.payload.fullName];
                }}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={28} fill={colorPalette[0]}>
                {data.map((_entry, index) => (
                  <Cell key={`cell-${index}`} fill={colorPalette[index % colorPalette.length]} />
                ))}
                <LabelList
                  dataKey="value"
                  position="right"
                  style={{ fill: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 600 }}
                  formatter={(v) => `${v} ${unitLabel}`}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

      </div>
    </Modal>
  );
}
