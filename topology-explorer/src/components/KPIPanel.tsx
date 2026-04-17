import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine, Area, Bar,
} from 'recharts'
import type { InterferenceSample } from '../types'

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
  cellPrbHistogram?: number[][] | null
  interferenceSamples?: InterferenceSample[]
  onClose: () => void
  onUploadKpi?: () => void
}

const CELL_COLORS = ['#38bdf8', '#a855f7', '#f97316', '#22c55e', '#ec4899', '#eab308', '#14b8a6', '#f43f5e']
const KPI_COLORS = ['#38bdf8', '#a855f7', '#f97316', '#22c55e', '#eab308', '#ec4899']
const PRB_COLOR = '#ef4444'

// ── PRB Spectrogram ──────────────────────────────────────────────────────────
function dbmToColor(dbm: number): [number, number, number] {
  const thermal = -108
  const ceiling = -72
  const t = Math.max(0, Math.min(1, (dbm - thermal) / (ceiling - thermal)))
  if (t < 0.25) return [Math.round(15 + t * 60), Math.round(30 + t * 320), Math.round(60 + t * 560)]
  if (t < 0.5) { const tt = (t - 0.25) * 4; return [Math.round(30 + tt * 200), Math.round(110 + tt * 100), Math.round(200 - tt * 170)] }
  if (t < 0.75) { const tt = (t - 0.5) * 4; return [Math.round(230 + tt * 25), Math.round(210 - tt * 150), Math.round(30 - tt * 20)] }
  const tt = (t - 0.75) * 4
  return [Math.round(255 - tt * 30), Math.round(60 - tt * 55), 10]
}

function PrbSpectrogram({ histogram, label }: { histogram: number[][]; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const N = histogram.length
  const CELL_W = Math.max(2, Math.floor(320 / 24))
  const CELL_H = Math.max(1, Math.min(3, Math.floor(140 / N)))
  const canvasWidth = 24 * CELL_W
  const canvasHeight = N * CELL_H

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const imageData = new ImageData(canvasWidth, canvasHeight)
    const data = imageData.data
    for (let rowRev = 0; rowRev < N; rowRev++) {
      const prb = N - 1 - rowRev
      for (let h = 0; h < 24; h++) {
        const val = histogram[prb]?.[h] ?? -120
        const [r, g, b] = dbmToColor(val)
        for (let dy = 0; dy < CELL_H; dy++) {
          for (let dx = 0; dx < CELL_W; dx++) {
            const px = (rowRev * CELL_H + dy) * canvasWidth + (h * CELL_W + dx)
            const idx = px * 4
            data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = 255
          }
        }
      }
    }
    ctx.putImageData(imageData, 0, 0)
  }, [histogram, N, CELL_W, CELL_H, canvasWidth, canvasHeight])

  return (
    <div className="kpi-spectrogram">
      <div className="kpi-spectrogram-header">
        <span className="material-icons-round" style={{ fontSize: 14, color: '#ef4444' }}>grid_on</span>
        <span>{label}</span>
      </div>
      <canvas
        ref={canvasRef}
        width={canvasWidth}
        height={canvasHeight}
        style={{ width: '100%', height: canvasHeight, imageRendering: 'pixelated', borderRadius: 4 }}
      />
      <div className="kpi-spectrogram-legend">
        <span style={{ color: 'rgb(15,110,200)', fontSize: '0.6rem' }}>Bajo</span>
        <span style={{ background: 'linear-gradient(90deg, rgb(15,110,200), rgb(230,210,30), rgb(255,60,10))', width: 80, height: 6, borderRadius: 3, display: 'inline-block' }} />
        <span style={{ color: 'rgb(255,60,10)', fontSize: '0.6rem' }}>Alto</span>
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function avgPrbByHour(histogram: number[][]): number[] {
  if (!histogram || histogram.length === 0) return []
  const nHours = histogram[0]?.length ?? 24
  const result: number[] = []
  for (let h = 0; h < nHours; h++) {
    let sum = 0, count = 0
    for (const prb of histogram) { if (prb[h] != null) { sum += prb[h]; count++ } }
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

function buildChartData(
  cellData: CellKpiData,
  dates: string[],
  meta: KpiMeta[],
  prbHistogram?: number[][] | null,
) {
  const rows = cellData.hourly.filter(r => dates.includes(r.date as string))
  const byHora = new Map<string, Record<string, number[]>>()
  for (const r of rows) {
    const hora = r.hora as string
    if (!byHora.has(hora)) byHora.set(hora, {})
    const bucket = byHora.get(hora)!
    for (const m of meta) {
      const v = r[m.key]
      if (v != null) { if (!bucket[m.key]) bucket[m.key] = []; bucket[m.key].push(Number(v)) }
    }
  }
  const prbByHour = avgPrbByHour(prbHistogram ?? [])
  return [...byHora.keys()].sort().map(hora => {
    const bucket = byHora.get(hora)!
    const entry: Record<string, unknown> = { hora }
    for (const m of meta) {
      const vals = bucket[m.key]
      entry[m.key] = vals?.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100 : null
    }
    const hour = parseInt(hora.split(':')[0] ?? '0')
    entry['prb_interference'] = prbByHour[hour] ?? null
    return entry
  })
}

function buildIntfData(samples: InterferenceSample[], cellId: string) {
  const cellSamples = samples.filter(s => s.cellId === cellId)
  if (cellSamples.length === 0) return []
  const byHour = new Map<string, { ni: number[]; pusch: number[]; pucch: number[]; score: number[] }>()
  for (const s of cellSamples) {
    if (!byHour.has(s.hour)) byHour.set(s.hour, { ni: [], pusch: [], pucch: [], score: [] })
    const b = byHour.get(s.hour)!
    if (s.ni_db != null) b.ni.push(s.ni_db)
    if (s.pusch_bler != null) b.pusch.push(s.pusch_bler)
    if (s.pucch_bler != null) b.pucch.push(s.pucch_bler)
    if (s.score != null) b.score.push(s.score)
  }
  const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 1000) / 1000 : null
  return [...byHour.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([hour, b]) => ({
    hora: hour, ni_db: avg(b.ni), pusch_bler: avg(b.pusch), pucch_bler: avg(b.pucch), score: avg(b.score),
  }))
}

function avgStat(data: Record<string, unknown>[], key: string): number | null {
  const vals = data.map(r => r[key] as number | null).filter(v => v != null) as number[]
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100 : null
}

// ── Cell Card (single cell within grid) ──────────────────────────────────────

function CellCard({
  cellId,
  cellData,
  meta,
  dates,
  compareDatesArr,
  selectedKpis,
  color,
  interferenceSamples,
  prbHistogram,
  isCompact,
}: {
  cellId: string
  cellData: CellKpiData
  meta: KpiMeta[]
  dates: string[]
  compareDatesArr: string[]
  selectedKpis: Set<string>
  color: string
  interferenceSamples?: InterferenceSample[]
  prbHistogram?: number[][] | null
  isCompact: boolean
}) {
  const chartData = useMemo(() => buildChartData(cellData, dates, meta, prbHistogram), [cellData, dates, meta, prbHistogram])
  const cmpData = useMemo(
    () => compareDatesArr.length > 0 ? buildChartData(cellData, compareDatesArr, meta, prbHistogram) : [],
    [cellData, compareDatesArr, meta, prbHistogram],
  )
  const intfData = useMemo(
    () => interferenceSamples ? buildIntfData(interferenceSamples, cellId) : [],
    [interferenceSamples, cellId],
  )
  const stats = useMemo(() => {
    const s: Record<string, number | null> = {}
    for (const m of meta) s[m.key] = avgStat(chartData, m.key)
    return s
  }, [chartData, meta])
  const cmpStats = useMemo(() => {
    const s: Record<string, number | null> = {}
    for (const m of meta) s[m.key] = avgStat(cmpData, m.key)
    return s
  }, [cmpData, meta])

  const chartH = isCompact ? 180 : 240
  const hasPrb = (prbHistogram?.length ?? 0) > 0

  return (
    <div className="kpi-cell-card" style={{ borderColor: color + '40' }}>
      {/* Card header */}
      <div className="kpi-cell-card-header">
        <div className="kpi-cell-card-dot" style={{ background: color }} />
        <span className="kpi-cell-card-id">{cellId}</span>
        <span className="kpi-cell-card-prov">{cellData.province}</span>
      </div>

      {/* KPI summary chips */}
      <div className="kpi-cell-card-stats">
        {meta.filter(m => selectedKpis.has(m.key)).map(m => {
          const val = stats[m.key]
          const status = getKpiStatus(val, m)
          return (
            <span key={m.key} className="kpi-cell-stat-chip" style={{ color: STATUS_COLOR[status] }}>
              {m.label}: {val != null ? `${val}${m.unit ? ' ' + m.unit : ''}` : 'N/A'}
            </span>
          )
        })}
      </div>

      {/* Primary chart */}
      <div className="kpi-cell-card-chart">
        <div className="kpi-chart-label">
          {dates.length > 1 ? `Promedio ${dates.length} días` : dates[0] ?? ''}
        </div>
        <ResponsiveContainer width="100%" height={chartH}>
          <ComposedChart data={chartData} syncId="kpi-sync" margin={{ top: 4, right: 50, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="hora" tick={{ fill: '#64748b', fontSize: 9 }} interval={isCompact ? 3 : 1} />
            <YAxis yAxisId="kpi" tick={{ fill: '#64748b', fontSize: 9 }} width={35} />
            <YAxis yAxisId="prb" orientation="right" tick={{ fill: '#ef4444', fontSize: 9 }} width={40}
              domain={[-130, -80]} />
            <Tooltip
              contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
              labelStyle={{ color: '#e2e8f0', fontWeight: 600 }}
            />
            {!isCompact && <Legend wrapperStyle={{ fontSize: 10 }} />}
            {meta.map((m, i) => selectedKpis.has(m.key) && (
              <Line key={m.key} yAxisId="kpi" type="monotone" dataKey={m.key} name={m.label}
                stroke={KPI_COLORS[i % KPI_COLORS.length]} strokeWidth={1.5} dot={false} connectNulls />
            ))}
            {hasPrb && (
              <Area yAxisId="prb" type="monotone" dataKey="prb_interference" name="Interf. PRB"
                stroke={PRB_COLOR} fill={PRB_COLOR} fillOpacity={0.12} strokeWidth={1.5} dot={false} connectNulls />
            )}
            {meta.filter(m => selectedKpis.has(m.key) && m.warn_below).map(m => (
              <ReferenceLine key={'w_' + m.key} yAxisId="kpi" y={m.warn_below!} stroke="#eab308" strokeDasharray="4 2" strokeWidth={1} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Compare chart */}
      {cmpData.length > 0 && (
        <div className="kpi-cell-card-chart" style={{ borderTop: '1px solid rgba(129,140,248,0.15)', paddingTop: 6 }}>
          <div className="kpi-chart-label" style={{ color: '#818cf8' }}>
            Comparación — {compareDatesArr.join(', ')}
          </div>
          <ResponsiveContainer width="100%" height={chartH}>
            <ComposedChart data={cmpData} syncId="kpi-sync" margin={{ top: 4, right: 50, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="hora" tick={{ fill: '#64748b', fontSize: 9 }} interval={isCompact ? 3 : 1} />
              <YAxis yAxisId="kpi" tick={{ fill: '#64748b', fontSize: 9 }} width={35} />
              <YAxis yAxisId="prb" orientation="right" tick={{ fill: '#ef4444', fontSize: 9 }} width={40} domain={[-130, -80]} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }} />
              {meta.map((m, i) => selectedKpis.has(m.key) && (
                <Line key={m.key} yAxisId="kpi" type="monotone" dataKey={m.key} name={m.label}
                  stroke={KPI_COLORS[i % KPI_COLORS.length]} strokeWidth={1.5} strokeDasharray="6 3" dot={false} connectNulls />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Delta bar */}
      {cmpData.length > 0 && (
        <div className="kpi-cell-card-delta">
          {meta.filter(m => selectedKpis.has(m.key)).map(m => {
            const curr = stats[m.key]; const cmp = cmpStats[m.key]
            if (curr == null || cmp == null) return null
            const delta = curr - cmp
            const improved = m.good_direction === 'high' ? delta > 0 : delta < 0
            return (
              <span key={m.key} className="kpi-cell-delta-chip"
                style={{ color: Math.abs(delta) < 0.01 ? '#94a3b8' : improved ? '#22c55e' : '#ef4444' }}>
                {m.label}: {delta > 0 ? '+' : ''}{delta.toFixed(1)}{m.unit}
              </span>
            )
          })}
        </div>
      )}

      {/* Interference PUSCH/PUCCH */}
      {intfData.length > 0 && (
        <div className="kpi-cell-card-intf">
          <div className="kpi-intf-header" style={{ marginBottom: 4 }}>
            <span className="material-icons-round" style={{ fontSize: 13, color: '#f97316' }}>cell_tower</span>
            <span style={{ fontSize: '0.72rem' }}>PUSCH / PUCCH BLER</span>
          </div>
          <ResponsiveContainer width="100%" height={140}>
            <ComposedChart data={intfData} syncId="kpi-sync" margin={{ top: 4, right: 40, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="hora" tick={{ fill: '#64748b', fontSize: 9 }} interval={isCompact ? 3 : 1} />
              <YAxis yAxisId="bler" tick={{ fill: '#64748b', fontSize: 9 }} width={30} domain={[0, 'auto']} />
              <YAxis yAxisId="ni" orientation="right" tick={{ fill: '#ef4444', fontSize: 9 }} width={35} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
                formatter={(value, name) => {
                  const v = Number(value ?? 0)
                  if (String(name).includes('NI')) return [`${v.toFixed(1)} dBm`, String(name)]
                  return [`${(v * 100).toFixed(1)}%`, String(name)]
                }} />
              <Bar yAxisId="bler" dataKey="pusch_bler" name="PUSCH" fill="#f97316" fillOpacity={0.7} radius={[2, 2, 0, 0]} barSize={5} />
              <Bar yAxisId="bler" dataKey="pucch_bler" name="PUCCH" fill="#a855f7" fillOpacity={0.7} radius={[2, 2, 0, 0]} barSize={5} />
              <Line yAxisId="ni" type="monotone" dataKey="ni_db" name="NI (dBm)" stroke="#ef4444" strokeWidth={1.5} dot={{ r: 2 }} connectNulls />
              <ReferenceLine yAxisId="bler" y={0.2} stroke="#ef4444" strokeDasharray="4 2" strokeWidth={1} />
              <ReferenceLine yAxisId="bler" y={0.1} stroke="#eab308" strokeDasharray="4 2" strokeWidth={1} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* PRB Spectrogram mini */}
      {hasPrb && prbHistogram && (
        <PrbSpectrogram histogram={prbHistogram} label={`PRB ${cellId}`} />
      )}
    </div>
  )
}

// ── Main Panel ───────────────────────────────────────────────────────────────

export default function KPIPanel({ kpiData, selectedCellId, cellPrbHistogram, interferenceSamples, onClose, onUploadKpi }: Props) {
  const [selectedCells, setSelectedCells] = useState<string[]>([])
  const [bandFilter, setBandFilter] = useState<string>('all')
  const [searchCell, setSearchCell] = useState('')
  const [selectedKpis, setSelectedKpis] = useState<Set<string>>(
    new Set(['cell_avail', 'erab_access', 'prb_dl', 'dl_tput_mbps'])
  )
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set())
  const [compareDates, setCompareDates] = useState<Set<string>>(new Set())

  const meta = kpiData?.kpi_meta ?? []
  const allCellIds = useMemo(() => kpiData ? Object.keys(kpiData.kpis).sort() : [], [kpiData])

  // Extract band from cell ID (e.g. GALX0911M1A → try to find pattern)
  const cellBands = useMemo(() => {
    const map = new Map<string, string>()
    for (const cid of allCellIds) {
      // Common patterns: last char or last 2 chars encode band/sector
      // Group by prefix without last 1-2 chars as "band group"
      const match = cid.match(/^(.+?)(\d{1,2}[A-Z]?)$/)
      map.set(cid, match ? match[1] : cid.slice(0, -1))
    }
    return map
  }, [allCellIds])

  const availableBands = useMemo(() => {
    const bands = new Set(cellBands.values())
    return [...bands].sort()
  }, [cellBands])

  // Filtered cell list
  const filteredCells = useMemo(() => {
    let cells = allCellIds
    if (bandFilter !== 'all') cells = cells.filter(c => cellBands.get(c) === bandFilter)
    if (searchCell.trim()) {
      const q = searchCell.trim().toLowerCase()
      cells = cells.filter(c => c.toLowerCase().includes(q))
    }
    return cells
  }, [allCellIds, bandFilter, cellBands, searchCell])

  // Auto-add selectedCellId
  useEffect(() => {
    if (selectedCellId && kpiData?.kpis[selectedCellId] && !selectedCells.includes(selectedCellId)) {
      setSelectedCells(prev => prev.length === 0 ? [selectedCellId] : prev)
    }
  }, [selectedCellId, kpiData, selectedCells])

  const toggleCell = useCallback((cid: string) => {
    setSelectedCells(prev =>
      prev.includes(cid) ? prev.filter(c => c !== cid) : [...prev, cid].slice(0, 8)
    )
  }, [])

  // All dates across selected cells
  const allDates = useMemo(() => {
    if (!kpiData) return []
    const dateSet = new Set<string>()
    for (const cid of selectedCells) {
      const cd = kpiData.kpis[cid]
      if (cd) cd.hourly.forEach(r => dateSet.add(r.date as string))
    }
    return [...dateSet].sort()
  }, [kpiData, selectedCells])

  const activeDates = useMemo(() => {
    if (selectedDates.size > 0) return [...selectedDates].sort()
    const last = allDates[allDates.length - 1]
    return last ? [last] : []
  }, [selectedDates, allDates])
  const activeCompareDates = useMemo(() => [...compareDates].sort(), [compareDates])

  const toggleDate = (d: string) => setSelectedDates(prev => { const n = new Set(prev); n.has(d) ? n.delete(d) : n.add(d); return n })
  const toggleCmpDate = (d: string) => setCompareDates(prev => { const n = new Set(prev); n.has(d) ? n.delete(d) : n.add(d); return n })
  const toggleKpi = (key: string) => setSelectedKpis(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })

  const isCompact = selectedCells.length > 1
  const gridCols = selectedCells.length <= 1 ? 1 : selectedCells.length === 2 ? 2 : selectedCells.length <= 4 ? 2 : 3

  return (
    <div className="kpi-panel">
      <div className="kpi-panel-header">
        <div>
          <span className="kpi-panel-title">KPI Dashboard</span>
          <span className="kpi-panel-subtitle">
            {selectedCells.length === 0 ? 'Selecciona celdas para comparar'
              : selectedCells.length === 1 ? selectedCells[0]
                : `${selectedCells.length} celdas seleccionadas`}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {onUploadKpi && (
            <button className="icon-button" onClick={onUploadKpi} title="Cargar kpi_data.json">↑ JSON</button>
          )}
          <button className="icon-button" onClick={onClose}>✕</button>
        </div>
      </div>

      {/* Cell selector with search + band filter */}
      <div className="kpi-multi-cell-selector">
        <div className="kpi-mcs-row">
          <input
            className="kpi-mcs-search"
            type="text"
            placeholder="Buscar celda..."
            value={searchCell}
            onChange={e => setSearchCell(e.target.value)}
          />
          {availableBands.length > 1 && (
            <select className="kpi-mcs-band" value={bandFilter} onChange={e => setBandFilter(e.target.value)}>
              <option value="all">Todas las bandas</option>
              {availableBands.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          )}
        </div>
        <div className="kpi-mcs-chips">
          {filteredCells.slice(0, 40).map(cid => (
            <button
              key={cid}
              className={`kpi-mcs-chip ${selectedCells.includes(cid) ? 'active' : ''}`}
              onClick={() => toggleCell(cid)}
              style={selectedCells.includes(cid) ? { borderColor: CELL_COLORS[selectedCells.indexOf(cid) % CELL_COLORS.length] } : undefined}
            >
              {cid}
            </button>
          ))}
          {filteredCells.length > 40 && (
            <span style={{ fontSize: '0.65rem', color: '#475569' }}>+{filteredCells.length - 40} más</span>
          )}
          {filteredCells.length === 0 && (
            <span style={{ fontSize: '0.7rem', color: '#475569' }}>Sin celdas con datos KPI</span>
          )}
        </div>
        {selectedCells.length > 0 && (
          <button className="kpi-mcs-clear" onClick={() => setSelectedCells([])}>
            Limpiar selección
          </button>
        )}
      </div>

      {/* Date selectors */}
      {allDates.length > 0 && selectedCells.length > 0 && (
        <div className="kpi-date-multi">
          <div className="kpi-date-group">
            <span className="kpi-date-group-label">Período</span>
            <div className="kpi-date-chips">
              {allDates.map(d => (
                <button key={d} className={`kpi-date-chip ${activeDates.includes(d) ? 'active' : ''}`}
                  onClick={() => toggleDate(d)}>{d}</button>
              ))}
            </div>
          </div>
          <div className="kpi-date-group">
            <span className="kpi-date-group-label" style={{ color: '#818cf8' }}>vs Comparar</span>
            <div className="kpi-date-chips">
              {allDates.filter(d => !activeDates.includes(d)).map(d => (
                <button key={d} className={`kpi-date-chip cmp ${activeCompareDates.includes(d) ? 'active' : ''}`}
                  onClick={() => toggleCmpDate(d)}>{d}</button>
              ))}
              {allDates.filter(d => !activeDates.includes(d)).length === 0 && (
                <span style={{ fontSize: '0.65rem', color: '#475569' }}>Todos seleccionados arriba</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* KPI selector */}
      {selectedCells.length > 0 && (
        <div className="kpi-selector">
          {meta.map((m, i) => (
            <button key={m.key} className={`kpi-chip ${selectedKpis.has(m.key) ? 'active' : ''}`}
              style={{ '--chip-color': KPI_COLORS[i % KPI_COLORS.length] } as React.CSSProperties}
              onClick={() => toggleKpi(m.key)}>
              {m.label}
            </button>
          ))}
        </div>
      )}

      {/* No cells selected */}
      {selectedCells.length === 0 && (
        <div className="kpi-empty">
          Selecciona una o más celdas de la lista de arriba para ver KPIs y comparar.
        </div>
      )}

      {/* Cell grid */}
      {selectedCells.length > 0 && kpiData && (
        <div className="kpi-cell-grid" style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)` }}>
          {selectedCells.map((cid, idx) => {
            const cd = kpiData.kpis[cid]
            if (!cd) return null
            return (
              <CellCard
                key={cid}
                cellId={cid}
                cellData={cd}
                meta={meta}
                dates={activeDates}
                compareDatesArr={activeCompareDates}
                selectedKpis={selectedKpis}
                color={CELL_COLORS[idx % CELL_COLORS.length]}
                interferenceSamples={interferenceSamples}
                prbHistogram={cid === selectedCellId ? cellPrbHistogram : null}
                isCompact={isCompact}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
