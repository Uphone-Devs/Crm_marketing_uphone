import { useState, useEffect, useCallback } from 'react';

export default function RankingLideres({ campanaId, callApi, refreshSignal }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    if (!campanaId) return;
    setLoading(true);
    try {
      const result = await callApi('db:getRankingApertura', campanaId);
      setData(result);
    } catch {
      // silencio — no romper el panel si falla
    } finally {
      setLoading(false);
    }
  }, [campanaId, callApi]);

  useEffect(() => { fetch(); }, [fetch, refreshSignal]);

  if (!campanaId) return null;

  return (
    <div style={{ display: 'flex', gap: 12, padding: '10px 0' }}>
      <LiderCard
        titulo="🥇 Mayor Recaudo"
        nombre={data?.recaudado?.nombre}
        valor={data?.recaudado?.monto != null
          ? `$${Number(data.recaudado.monto).toLocaleString('es-EC', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
          : null}
        loading={loading}
      />
      <LiderCard
        titulo="🥇 Mayor Unidades"
        nombre={data?.unidades?.nombre}
        valor={data?.unidades?.count != null
          ? `${data.unidades.count} pago${data.unidades.count !== 1 ? 's' : ''}`
          : null}
        loading={loading}
      />
    </div>
  );
}

function LiderCard({ titulo, nombre, valor, loading }) {
  return (
    <div style={{
      flex: 1,
      background: 'var(--color-surface, #1e1e2e)',
      border: '1px solid var(--color-border, #2a2a3e)',
      borderRadius: 8,
      padding: '10px 14px',
      minWidth: 0,
    }}>
      <div style={{ fontSize: 10, opacity: 0.5, fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>
        {titulo}
      </div>
      {loading ? (
        <div style={{ fontSize: 12, opacity: 0.4 }}>...</div>
      ) : nombre ? (
        <>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary, #7c6af7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {nombre}
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', marginTop: 2 }}>
            {valor}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, opacity: 0.3 }}>Sin datos</div>
      )}
    </div>
  );
}
