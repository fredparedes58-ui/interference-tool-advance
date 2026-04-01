/**
 * ComparePanel.tsx
 * ──────────────────
 * Side-by-side comparison of two cells.
 * Shows KPI snapshot diff with ↑↓ arrows and colour coding.
 */

import { useMemo, useState } from 'react'
import type { Cell } from '../types'
import type { KpiDataset } from './KPIPanel'

type Props = {
  cellA: Cell
  allCells: Cell[]
  kpiData: KpiDataset | null
  onClose: () => void
}

// ── KPI snapshot rows to compare ────────────────────────────────────────────
type KpiRow = {
  label: string
  key: keyof NonNullable<Cell['kpi']>
  unit: string
  goodDirection: 'high' | 'low'
  format?: (v: number) => string
}

const SNAPSHOT_KPI_ROWS: KpiRow[] = [
  { label: 'NI avg',       key: 'rssi_avg_dbm',   unit: 'dBm',  goodDirection: 'low',  format: v => v.toFixed(1) },
  { label: 'UL SINR p50',  key: 'ul_sinr_p50_db', unit: 'dB',   goodDirection: 'high', format: v => v.toFixed(1) },
  { label: 'PUSCH BLER',   key: 'pusch_bler_avg',  unit: '%',    goodDirection: 'low',  format: v => (v * 100).toFixed(1) },
  { label: 'PUCCH BLER',   key: 'pucch_bler_avg',  unit: '%',    goodDirection: 'low',  format: v => (v * 100).toFixed(1) },
  { label: 'UL Throughput',key: 'ul_thp_mbps',     unit: 'Mbps', goodDirection: 'high', format: v => v.toFixed(1) },
  { label: 'DL Throughput',key: 'dl_thp_mbps',     unit: 'Mbps', goodDirection: 'high', format: v => v.toFixed(1) },
  { label: 'PRB util UL',  key: 'prb_util_ul',     unit: '%',    goodDirection: 'low',  format: v => (v * 100).toFixed(1) },
  { label: 'PRB util DL',  key: 'prb_util_dl',     unit: '%',    goodDirection: 'low',  format: v => (v * 100).toFixed(1) },
]

// ── KPI dataset daily rows ───────────────────────────────────────────────────
const HOURLY_KPI_ROWS: Array<{ label: string; key: string; unit: string; goodDirection: 'high' | 'low' }> = [
  { label: 'Disponibilidad',  key: 'cell_avail',    unit: '%',   goodDirection: 'high' },
  { label: 'ERAB Access',     key: 'erab_access',   unit: '%',   goodDirection: 'high' },
  { label: 'PRB DL util',     key: 'prb_dl',        unit: '%',   goodDirection: 'low'  },
  { label: 'DL Throughput',   key: 'dl_tput_mbps',  unit: 'Mbps',goodDirection: 'high' },
]

// ── Helpers ──────────────────────────────────────────────────────────────────
function deltaClass(a: number, b: number, goodDir: 'high' | 'low') {
  if (Math.abs(a - b) < 0.001) return 'compare-delta-eq'
  const aBetter = goodDir === 'high' ? a > b : a < b
  return aBetter ? 'compare-delta-up' : 'compare-delta-down'
}

function deltaArrow(a: number, b: number, goodDir: 'high' | 'low') {
  if (Math.abs(a - b) < 0.001) return '='
  const aBetter = goodDir === 'high' ? a > b : a < b
  return aBetter ? '↑' : '↓'
}

function avgHourly(cellId: string, kpiKey: string, kpiData: KpiDataset): number | null {
  const cellData = kpiData.kpis[cellId]
  if (!cellData) return null
  const vals = cellData.hourly
    .map(r => r[kpiKey])
    .filter((v): v is number => typeof v === 'number' && v != null)
  if (vals.length === 0) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

// ── Cell info row ────────────────────────────────────────────────────────────
function InfoRow({ label, valA, valB }: { label: string; valA: string; valB: string }) {
  return (
    <div className="compare-info-row">
      <span className="compare-info-label">{label}</span>
      <span className="compare-info-val">{valA}</span>
      <span className="compare-info-val">{valB}</span>
    </div>
  )
}

// ── KPI diff row ─────────────────────────────────────────────────────────────
function KpiDiffRow({
  label, unit,
  valA, valB,
  goodDir,
}: {
  label: string; unit: string
  valA: number | null; valB: number | null
  goodDir: 'high' | 'low'
}) {
  const fmtA = valA != null ? `${valA.toFixed(valA < 10 ? 2 : 1)} ${unit}` : '—'
  const fmtB = valB != null ? `${valB.toFixed(valB < 10 ? 2 : 1)} ${unit}` : '—'
  const cls = valA != null && valB != null ? deltaClass(valA, valB, goodDir) : 'compare-delta-eq'
  const arrow = valA != null && valB != null ? deltaArrow(valA, valB, goodDir) : ''

  return (
    <div className="compare-kpi-row">
      <span className="compare-kpi-label">{label}</span>
      <span className={`compare-kpi-val ${cls}`}>{fmtA} <span className="compare-arrow">{arrow}</span></span>
      <span className={`compare-kpi-val ${deltaClass(valB ?? 0, valA ?? 0, goodDir)}`}>{fmtB}</span>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function ComparePanel({ cellA, allCells, kpiData, onClose }: Props) {
  const [cellBId, setCellBId] = useState<string>('')

  const cellB = useMemo(
    () => allCells.find(c => c.id === cellBId) ?? null,
    [allCells, cellBId]
  )

  // Cells for selector (exclude cellA)
  const selectableCells = useMemo(
    () => allCells.filter(c => c.id !== cellA.id),
    [allCells, cellA.id]
  )

  return (
    <div className="compare-panel">
      {/* Header */}
      <div className="compare-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="material-icons-round" style={{ fontSize: 18, color: 'var(--c-accent2)' }}>compare</span>
          <span className="compare-title">Compare Cells</span>
        </div>
        <button className="cap-close-btn" onClick={onClose}>✕</button>
      </div>

      {/* Cell B selector */}
      <div className="compare-selector-bar">
        <div className="compare-col-label">
          <span className="compare-cell-badge compare-cell-badge--a">A</span>
          <span className="compare-cell-id">{cellA.id}</span>
        </div>
        <span className="material-icons-round" style={{ color: 'var(--c-accent)', fontSize: 18 }}>swap_horiz</span>
        <div className="compare-col-label">
          <span className="compare-cell-badge compare-cell-badge--b">B</span>
          <select
            className="compare-cell-select"
            value={cellBId}
            onChange={e => setCellBId(e.target.value)}
          >
            <option value="">— seleccionar celda —</option>
            {selectableCells.map(c => (
              <option key={c.id} value={c.id}>
                {c.id} ({c.tech} {c.band ?? ''})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="compare-body">
        {!cellB ? (
          <div className="compare-empty">
            <span className="material-icons-round" style={{ fontSize: 36, color: '#334155' }}>compare_arrows</span>
            <p>Selecciona una celda B para comparar</p>
          </div>
        ) : (
          <>
            {/* ── Basic info ── */}
            <div className="compare-section">
              <div className="compare-section-title">Información</div>
              <div className="compare-grid-header">
                <span />
                <span className="compare-col-a">{cellA.id}</span>
                <span className="compare-col-b">{cellB.id}</span>
              </div>
              <InfoRow label="Tech"    valA={cellA.tech}             valB={cellB.tech} />
              <InfoRow label="Banda"   valA={cellA.band ?? '—'}      valB={cellB.band ?? '—'} />
              <InfoRow label="Vendor"  valA={cellA.vendor ?? '—'}    valB={cellB.vendor ?? '—'} />
              <InfoRow label="Azimuth" valA={cellA.azimuth !== undefined ? `${cellA.azimuth}°` : '—'} valB={cellB.azimuth !== undefined ? `${cellB.azimuth}°` : '—'} />
              <InfoRow label="Tilt"    valA={cellA.tilt !== undefined ? `${cellA.tilt}°` : '—'}    valB={cellB.tilt !== undefined ? `${cellB.tilt}°` : '—'} />
              <InfoRow label="BW"      valA={cellA.bwMhz !== undefined ? `${cellA.bwMhz} MHz` : '—'} valB={cellB.bwMhz !== undefined ? `${cellB.bwMhz} MHz` : '—'} />
            </div>

            {/* ── KPI snapshot diff ── */}
            {(cellA.kpi || cellB.kpi) && (
              <div className="compare-section">
                <div className="compare-section-title">KPI Snapshot (classifier data)</div>
                <div className="compare-grid-header">
                  <span />
                  <span className="compare-col-a">{cellA.id}</span>
                  <span className="compare-col-b">{cellB.id}</span>
                </div>
                {SNAPSHOT_KPI_ROWS.map(row => {
                  const rawA = cellA.kpi?.[row.key] as number | undefined
                  const rawB = cellB.kpi?.[row.key] as number | undefined
                  if (rawA == null && rawB == null) return null
                  const fmt = row.format ?? (v => v.toFixed(2))
                  const valA = rawA != null ? parseFloat(fmt(rawA)) : null
                  const valB = rawB != null ? parseFloat(fmt(rawB)) : null
                  return (
                    <KpiDiffRow
                      key={row.key}
                      label={row.label}
                      unit={row.unit}
                      valA={valA}
                      valB={valB}
                      goodDir={row.goodDirection}
                    />
                  )
                })}
              </div>
            )}

            {/* ── Hourly KPI averages (from kpiData) ── */}
            {kpiData && (kpiData.kpis[cellA.id] || kpiData.kpis[cellB.id]) && (
              <div className="compare-section">
                <div className="compare-section-title">KPI Diario Promedio (dataset)</div>
                <div className="compare-grid-header">
                  <span />
                  <span className="compare-col-a">{cellA.id}</span>
                  <span className="compare-col-b">{cellB.id}</span>
                </div>
                {HOURLY_KPI_ROWS.map(row => {
                  const valA = avgHourly(cellA.id, row.key, kpiData)
                  const valB = avgHourly(cellB.id, row.key, kpiData)
                  if (valA == null && valB == null) return null
                  return (
                    <KpiDiffRow
                      key={row.key}
                      label={row.label}
                      unit={row.unit}
                      valA={valA}
                      valB={valB}
                      goodDir={row.goodDirection}
                    />
                  )
                })}
              </div>
            )}

            {/* ── Legend ── */}
            <div className="compare-legend">
              <span className="compare-delta-up">↑ mejor</span>
              <span className="compare-delta-down">↓ peor</span>
              <span className="compare-delta-eq">= igual</span>
              <span style={{ color: '#64748b', fontSize: '0.7rem' }}>· flechas respecto a celda A</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
