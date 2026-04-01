import { useMemo, useState } from 'react'
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine, Area,
} from 'recharts'

export type KpiMeta = {
  key: string
  label: string
  unit: string
  good_direction: 'high' | 'low' | null
  warn_below?: number | null
  crit_below?: number | null
  warn_above?: number | null
  crit_above?: number | null
}

export type CellKpiData = {
  province: string
  node: string
  hourly: Record<string, number | string | null>[]
}

export type KpiDataset = {
  kpis: Record<string, CellKpiData>
  kpi_meta: KpiMeta[]
}

type Props = {
  kpiData: KpiDataset | null
  selectedCellId: string | null
  cellPrbHistogram?: number[][] | null  // [N_PRB][24] averaged
  onClose: () => void
  onUploadKpi?: () => void
}

const KPI_COLORS = ['#38bdf8','#a855f7','#f97316','#22c55e','#eab308','#ec4899']
const PRB_COLOR = '#ef4444'

function avgPrbByHour(histogram: number[][]): number[] {
  // histogram[prb][hour] — average across all PRBs per hour
  if (!histogram || histogram.length === 0) return []
  const nHours = histogram[0]?.length ?? 24
  const result: number[] = []
  for (let h = 0; h < nHours; h++) {
    let sum = 0, count = 0
    for (const prb of histogram) {
      if (prb[h] != null) { sum += prb[h]; count++ }
    }
    result.push(count > 0 ? Math.round(sum / count * 10) / 10 : -120)
  }
  return result
}

function getKpiStatus(value: number | null, meta: KpiMeta): 'good' | 'warn' | 'crit' | 'neutral' {
  if (value == null) return 'neutral'
  if (meta.good_direction === 'high') {
    if (meta.crit_below != null && value < meta.crit_below) return 'crit'
    if (meta.warn_below != null && value < meta.warn_below) return 'warn'
    return 'good'
  }
  if (meta.good_direction === 'low') {
    if (meta.crit_above != null && value > meta.crit_above) return 'crit'
    if (meta.warn_above != null && value > meta.warn_above) return 'warn'
    return 'good'
  }
  return 'neutral'
}

const STATUS_COLOR = { good: '#22c55e', warn: '#eab308', crit: '#ef4444', neutral: '#94a3b8' }

export default function KPIPanel({ kpiData, selectedCellId, cellPrbHistogram, onClose, onUploadKpi }: Props) {
  const [activeCellId, setActiveCellId] = useState<string | null>(null)
  const [selectedKpis, setSelectedKpis] = useState<Set<string>>(
    new Set(['cell_avail', 'erab_access', 'prb_dl', 'dl_tput_mbps'])
  )
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [compareDate, setCompareDate] = useState<string | null>(null)

  const cellId = activeCellId ?? selectedCellId ?? null

  const cellData = cellId && kpiData ? kpiData.kpis[cellId] : null
  const meta = kpiData?.kpi_meta ?? []
  const availableCells = kpiData ? Object.keys(kpiData.kpis).sort() : []

  // Unique dates in the data
  const dates = useMemo(() => {
    if (!cellData) return []
    const d = [...new Set(cellData.hourly.map(r => r.date as string))].sort()
    return d
  }, [cellData])

  // Auto-select last date (most recent)
  const currentDate = selectedDate ?? dates[dates.length - 1] ?? null

  // Filter rows by date + build chart data (merged with compare date)
  const chartData = useMemo(() => {
    if (!cellData || !currentDate) return []
    const rows = cellData.hourly.filter(r => r.date === currentDate)
    const cmpRows = compareDate
      ? cellData.hourly.filter(r => r.date === compareDate)
      : []
    // Index compare rows by hora for fast lookup
    const cmpByHora = new Map(cmpRows.map(r => [r.hora as string, r]))
    const prbByHour = avgPrbByHour(cellPrbHistogram ?? [])
    return rows.map((r) => {
      const entry: Record<string, unknown> = { hora: r.hora }
      const cmp = cmpByHora.get(r.hora as string)
      for (const m of meta) {
        const v = r[m.key]
        entry[m.key] = v != null ? Number(v) : null
        if (compareDate && cmp) {
          const cv = cmp[m.key]
          entry[`${m.key}__cmp`] = cv != null ? Number(cv) : null
        }
      }
      const hour = parseInt(String(r.hora).split(':')[0] ?? '0')
      entry['prb_interference'] = prbByHour[hour] ?? null
      return entry
    })
  }, [cellData, currentDate, compareDate, cellPrbHistogram, meta])

  // Summary stats per KPI (avg of current date)
  const summaryStats = useMemo(() => {
    if (!chartData.length) return {}
    const stats: Record<string, number | null> = {}
    for (const m of meta) {
      const vals = chartData.map(r => r[m.key] as number | null).filter(v => v != null) as number[]
      stats[m.key] = vals.length ? Math.round(vals.reduce((a,b) => a+b, 0) / vals.length * 100) / 100 : null
    }
    return stats
  }, [chartData, meta])

  // Interference correlation: Pearson between avg PRB dBm and each KPI
  const correlations = useMemo(() => {
    const prbVals = chartData.map(r => r['prb_interference'] as number | null).filter(v => v != null) as number[]
    if (prbVals.length < 3) return {}
    const result: Record<string, number> = {}
    for (const m of meta) {
      const kpiVals = chartData.map(r => r[m.key] as number | null).filter(v => v != null) as number[]
      if (kpiVals.length < 3 || kpiVals.length !== prbVals.length) continue
      const n = prbVals.length
      const mx = prbVals.reduce((a,b) => a+b) / n
      const my = kpiVals.reduce((a,b) => a+b) / n
      let num = 0, dx = 0, dy = 0
      for (let i = 0; i < n; i++) {
        num += (prbVals[i]-mx)*(kpiVals[i]-my)
        dx  += (prbVals[i]-mx)**2
        dy  += (kpiVals[i]-my)**2
      }
      const r = dx*dy > 0 ? num / Math.sqrt(dx*dy) : 0
      result[m.key] = Math.round(r * 100) / 100
    }
    return result
  }, [chartData, meta])

  const toggleKpi = (key: string) => {
    setSelectedKpis(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const hasPrb = (cellPrbHistogram?.length ?? 0) > 0

  return (
    <div className="kpi-panel">
      <div className="kpi-panel-header">
        <div>
          <span className="kpi-panel-title">KPI Dashboard</span>
          {cellData && <span className="kpi-panel-subtitle">{cellId} · {cellData.province}</span>}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {onUploadKpi && (
            <button className="icon-button" onClick={onUploadKpi} title="Cargar kpi_data.json">
              ↑ JSON
            </button>
          )}
          <button className="icon-button" onClick={onClose}>✕</button>
        </div>
      </div>

      {/* Cell selector */}
      <div className="kpi-cell-selector">
        <label>Celda:</label>
        <select value={cellId ?? ''} onChange={e => setActiveCellId(e.target.value || null)}>
          <option value="">-- seleccionar --</option>
          {availableCells.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {dates.length > 1 && (
          <>
            <label>Fecha:</label>
            <select value={currentDate ?? ''} onChange={e => { setSelectedDate(e.target.value); setCompareDate(null) }}>
              {dates.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <label style={{ color: '#818cf8' }}>vs:</label>
            <select
              value={compareDate ?? ''}
              onChange={e => setCompareDate(e.target.value || null)}
              style={{ borderColor: compareDate ? 'rgba(129,140,248,0.5)' : undefined }}
            >
              <option value="">— sin comparar —</option>
              {dates.filter(d => d !== currentDate).map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </>
        )}
      </div>

      {!cellData && (
        <div className="kpi-empty">
          {availableCells.length === 0
            ? 'Sin datos KPI cargados. Sube kpi_data.json.'
            : 'Selecciona una celda GALX del mapa o del selector.'}
        </div>
      )}

      {cellData && (
        <>
          {/* KPI selector chips */}
          <div className="kpi-selector">
            {meta.map((m, i) => (
              <button
                key={m.key}
                className={`kpi-chip ${selectedKpis.has(m.key) ? 'active' : ''}`}
                style={{ '--chip-color': KPI_COLORS[i % KPI_COLORS.length] } as React.CSSProperties}
                onClick={() => toggleKpi(m.key)}
              >
                {m.label}
                {summaryStats[m.key] != null && (
                  <span className="kpi-chip-val" style={{ color: STATUS_COLOR[getKpiStatus(summaryStats[m.key]!, m)] }}>
                    {summaryStats[m.key]}{m.unit ? ' ' + m.unit : ''}
                  </span>
                )}
              </button>
            ))}
            <button
              className={`kpi-chip ${hasPrb ? 'active prb-chip' : 'disabled'}`}
              style={{ '--chip-color': PRB_COLOR } as React.CSSProperties}
            >
              Interf. PRB (dBm)
              {!hasPrb && <span style={{ fontSize: 10, opacity: 0.6 }}> (sin datos)</span>}
            </button>
          </div>

          {/* Correlation badges */}
          {hasPrb && Object.keys(correlations).length > 0 && (
            <div className="kpi-correlations">
              <span className="kpi-corr-title">Correlación interferencia ↔ KPI:</span>
              {meta.filter(m => correlations[m.key] != null && selectedKpis.has(m.key)).map(m => {
                const r = correlations[m.key]
                const impact = Math.abs(r) > 0.6 ? 'ALTO' : Math.abs(r) > 0.35 ? 'MEDIO' : 'BAJO'
                const color = Math.abs(r) > 0.6 ? '#ef4444' : Math.abs(r) > 0.35 ? '#eab308' : '#94a3b8'
                const direction = r > 0 ? '↑' : '↓'
                return (
                  <span key={m.key} className="kpi-corr-badge" style={{ borderColor: color, color }}>
                    {m.label}: {direction}{Math.abs(r).toFixed(2)} <strong>{impact}</strong>
                  </span>
                )
              })}
            </div>
          )}

          {/* Main chart */}
          <div className="kpi-chart-container">
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={chartData} margin={{ top: 8, right: 60, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="hora" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                {/* Left Y: KPIs */}
                <YAxis yAxisId="kpi" tick={{ fill: '#94a3b8', fontSize: 11 }} width={45} />
                {/* Right Y: PRB dBm */}
                <YAxis yAxisId="prb" orientation="right" tick={{ fill: '#ef4444', fontSize: 11 }} width={50}
                  domain={[-130, -80]} label={{ value: 'dBm', angle: 90, position: 'insideRight', fill: '#ef4444', fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#e2e8f0', fontWeight: 600 }}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />

                {/* KPI lines — primary date */}
                {meta.map((m, i) => selectedKpis.has(m.key) && (
                  <Line
                    key={m.key}
                    yAxisId="kpi"
                    type="monotone"
                    dataKey={m.key}
                    name={`${m.label}${compareDate ? ` (${currentDate})` : ''}`}
                    stroke={KPI_COLORS[i % KPI_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                ))}

                {/* KPI lines — compare date (dashed) */}
                {compareDate && meta.map((m, i) => selectedKpis.has(m.key) && (
                  <Line
                    key={`${m.key}__cmp`}
                    yAxisId="kpi"
                    type="monotone"
                    dataKey={`${m.key}__cmp`}
                    name={`${m.label} (${compareDate})`}
                    stroke={KPI_COLORS[i % KPI_COLORS.length]}
                    strokeWidth={1.5}
                    strokeDasharray="5 3"
                    dot={false}
                    connectNulls
                    opacity={0.65}
                  />
                ))}

                {/* PRB interference area */}
                {hasPrb && (
                  <Area
                    yAxisId="prb"
                    type="monotone"
                    dataKey="prb_interference"
                    name="Interf. PRB avg"
                    stroke={PRB_COLOR}
                    fill={PRB_COLOR}
                    fillOpacity={0.15}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                )}

                {/* Reference lines */}
                {meta.filter(m => selectedKpis.has(m.key) && m.warn_below).map(m => (
                  <ReferenceLine key={'w_'+m.key} yAxisId="kpi" y={m.warn_below!} stroke="#eab308" strokeDasharray="4 2" strokeWidth={1} />
                ))}
                {meta.filter(m => selectedKpis.has(m.key) && m.crit_below).map(m => (
                  <ReferenceLine key={'c_'+m.key} yAxisId="kpi" y={m.crit_below!} stroke="#ef4444" strokeDasharray="4 2" strokeWidth={1} />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Multi-date delta summary */}
          {compareDate && (
            <div className="kpi-date-compare-bar">
              <span className="kpi-date-compare-label">
                <span style={{ color: 'var(--c-accent2)' }}>Δ</span> {compareDate} → {currentDate}:
              </span>
              {meta.filter(m => selectedKpis.has(m.key)).map(m => {
                const curr = summaryStats[m.key]
                const cmpVals = chartData.map(r => r[`${m.key}__cmp`] as number | null).filter(v => v != null) as number[]
                const cmpAvg = cmpVals.length ? Math.round(cmpVals.reduce((a,b) => a+b,0) / cmpVals.length * 100) / 100 : null
                if (curr == null || cmpAvg == null) return null
                const delta = curr - cmpAvg
                const improved = m.good_direction === 'high' ? delta > 0 : delta < 0
                const sign = delta > 0 ? '+' : ''
                return (
                  <span
                    key={m.key}
                    className="kpi-date-delta-chip"
                    style={{ color: Math.abs(delta) < 0.01 ? '#94a3b8' : improved ? '#22c55e' : '#ef4444' }}
                  >
                    {m.label}: {sign}{delta.toFixed(1)}{m.unit}
                  </span>
                )
              })}
            </div>
          )}

          {/* KPI status cards */}
          <div className="kpi-cards">
            {meta.filter(m => selectedKpis.has(m.key)).map(m => {
              const val = summaryStats[m.key]
              const status = getKpiStatus(val, m)
              return (
                <div key={m.key} className={`kpi-card kpi-card--${status}`}>
                  <div className="kpi-card-label">{m.label}</div>
                  <div className="kpi-card-value">
                    {val != null ? `${val}${m.unit ? ' '+m.unit : ''}` : 'N/A'}
                  </div>
                  {correlations[m.key] != null && hasPrb && (
                    <div className="kpi-card-corr">
                      r={correlations[m.key] > 0 ? '+' : ''}{correlations[m.key]}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
