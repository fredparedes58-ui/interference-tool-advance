/**
 * CellAnalysisPanel.tsx
 * ----------------------
 * Slide-in panel shown when a cell is clicked on the map.
 * Shows:
 *   - PRB histogram heatmap (PRB index × hour, color = dBm level)
 *   - Source classification confidence bars
 *   - Mitigation action cards with Ericsson feature IDs
 *   - Neighbor impact pool per mitigation
 */

import { useMemo, useState } from 'react'
import type { Cell, CellAnalysis, MitigationAction, SourceMatch } from '../types'

type Props = {
  cell: Cell
  analysis: CellAnalysis
  allCells: Cell[]
  onClose: () => void
}

// ---- colour helpers ---------------------------------------------------------

const SEVERITY_COLOUR: Record<string, string> = {
  LOW: '#22c55e',
  MEDIUM: '#f59e0b',
  HIGH: '#ef4444',
  CRITICAL: '#dc2626',
}

const SOURCE_TYPE_ICON: Record<string, string> = {
  CABLE_TV_LEAKAGE: '📡',
  FM_RADIO_HARMONIC: '📻',
  TV_DIGITAL_BROADCAST_700: '📺',
  BDA_OSCILLATION: '🔊',
  BDA_EXCESS_GAIN: '🔈',
  WIRELESS_ISP_2500: '🛜',
  WIFI_CAMERA_UNLICENSED_850: '📷',
  JAMMER: '🚫',
  MILITARY_POLICE: '🎖️',
  PIM: '🔩',
  ATMOSPHERIC_DUCTING: '🌫️',
  UNKNOWN_PERSISTENT: '❓',
}

const TYPE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  CM: { bg: '#1d4ed8', text: '#bfdbfe', label: 'CM' },
  FIELD: { bg: '#b45309', text: '#fde68a', label: 'FIELD' },
  REGULATORY: { bg: '#6d28d9', text: '#e9d5ff', label: 'REGULATORY' },
}

const URGENCY_BORDER: Record<string, string> = {
  LOW: '#22c55e',
  MEDIUM: '#f59e0b',
  HIGH: '#ef4444',
  CRITICAL: '#dc2626',
}

// Map dBm → heatmap colour (thermal=blue, elevated=yellow/red)
function dbmToColour(dbm: number): string {
  const thermal = -108
  const ceiling = -72
  const t = Math.max(0, Math.min(1, (dbm - thermal) / (ceiling - thermal)))
  if (t < 0.25) {
    const r = Math.round(15 + t * 4 * (30 - 15))
    return `rgb(${r},${Math.round(30 + t * 4 * 80)},${Math.round(60 + t * 4 * 140)})`
  }
  if (t < 0.5) {
    const tt = (t - 0.25) * 4
    return `rgb(${Math.round(30 + tt * 200)},${Math.round(110 + tt * 100)},${Math.round(200 - tt * 170)})`
  }
  if (t < 0.75) {
    const tt = (t - 0.5) * 4
    return `rgb(${Math.round(230 + tt * 25)},${Math.round(210 - tt * 150)},${Math.round(30 - tt * 20)})`
  }
  const tt = (t - 0.75) * 4
  return `rgb(${Math.round(255 - tt * 30)},${Math.round(60 - tt * 55)},${Math.round(10)})`
}

// ---- Delta colour (week-over-week comparison) ------------------------------
// Blue = improved (less interference), Red = worse, White = unchanged

function deltaToColour(delta: number): string {
  if (Math.abs(delta) < 0.5) return 'rgb(30,41,59)'  // near-zero: dark neutral
  const clamped = Math.max(-12, Math.min(12, delta))
  if (clamped < 0) {
    // Improved: delta negative → blue
    const t = Math.min(1, -clamped / 12)
    return `rgb(${Math.round(20 - t * 10)},${Math.round(40 + t * 130)},${Math.round(80 + t * 175)})`
  }
  // Worsened: delta positive → red/orange
  const t = Math.min(1, clamped / 12)
  return `rgb(${Math.round(100 + t * 155)},${Math.round(60 - t * 55)},${Math.round(20 - t * 15)})`
}

// ---- PRB Heatmap -----------------------------------------------------------

type HeatmapMode = 'current' | 'prev' | 'delta'

function PrbHeatmap({
  histogram,
  histogramPrev,
}: {
  histogram: number[][]
  histogramPrev?: number[][]
}) {
  const [mode, setMode] = useState<HeatmapMode>('current')
  const N = histogram.length
  const CELL_W = Math.max(2, Math.floor(360 / 24))
  const CELL_H = Math.max(2, Math.floor(200 / N))

  const hasPrev = histogramPrev && histogramPrev.length === N

  // Compute delta matrix (current - prev): positive = worsened
  const deltaMatrix = useMemo(() => {
    if (!hasPrev) return null
    return histogram.map((row, prb) =>
      row.map((dbm, h) => dbm - histogramPrev![prb][h])
    )
  }, [histogram, histogramPrev, hasPrev])

  const activeMatrix = mode === 'delta' && deltaMatrix
    ? deltaMatrix
    : mode === 'prev' && histogramPrev
      ? histogramPrev
      : histogram

  const getCellColour = (val: number): string => {
    if (mode === 'delta') return deltaToColour(val)
    return dbmToColour(val)
  }

  // Average delta for summary badge
  const avgDelta = useMemo(() => {
    if (!deltaMatrix) return 0
    let sum = 0; let count = 0
    for (const row of deltaMatrix) for (const v of row) { sum += v; count++ }
    return count > 0 ? sum / count : 0
  }, [deltaMatrix])

  return (
    <div className="prb-heatmap-wrap">
      {/* Mode selector */}
      {hasPrev && (
        <div className="prb-week-tabs">
          <button
            className={`prb-week-tab ${mode === 'current' ? 'prb-week-tab--active' : ''}`}
            onClick={() => setMode('current')}
          >Semana actual</button>
          <button
            className={`prb-week-tab ${mode === 'prev' ? 'prb-week-tab--active' : ''}`}
            onClick={() => setMode('prev')}
          >Semana anterior</button>
          <button
            className={`prb-week-tab ${mode === 'delta' ? 'prb-week-tab--active' : ''}`}
            onClick={() => setMode('delta')}
          >
            Delta Δ
            {mode === 'delta' && (
              <span
                className="prb-delta-badge"
                style={{ color: avgDelta > 0 ? '#ef4444' : '#38bdf8' }}
              >
                {avgDelta > 0 ? `+${avgDelta.toFixed(1)}` : avgDelta.toFixed(1)} dB
              </span>
            )}
          </button>
        </div>
      )}

      <div className="prb-heatmap-labels-top">
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} style={{ width: CELL_W }}>{h % 6 === 0 ? `${h}h` : ''}</span>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        <div className="prb-heatmap-label-left">
          <span style={{ transform: 'rotate(-90deg)', whiteSpace: 'nowrap', fontSize: 10, color: '#94a3b8' }}>
            PRB index ↑
          </span>
        </div>
        <div
          className="prb-heatmap-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(24, ${CELL_W}px)`,
            gridTemplateRows: `repeat(${N}, ${CELL_H}px)`,
            gap: 0,
          }}
        >
          {Array.from({ length: N }, (_, rowRev) => {
            const prb = N - 1 - rowRev
            return Array.from({ length: 24 }, (_, h) => {
              const val = activeMatrix[prb][h]
              const label = mode === 'delta'
                ? `PRB ${prb}, h${h}: Δ${val >= 0 ? '+' : ''}${val.toFixed(1)} dB`
                : `PRB ${prb}, h${h}: ${val.toFixed(1)} dBm`
              return (
                <div
                  key={`${prb}-${h}`}
                  style={{ background: getCellColour(val) }}
                  title={label}
                />
              )
            })
          })}
        </div>
      </div>
      <div className="prb-heatmap-legend">
        {mode === 'delta' ? (
          <>
            <div className="prb-heatmap-gradient prb-heatmap-gradient--delta" />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#64748b', marginTop: 2 }}>
              <span style={{ color: '#38bdf8' }}>−12 dB (mejoró)</span>
              <span>sin cambio</span>
              <span style={{ color: '#ef4444' }}>+12 dB (empeoró)</span>
            </div>
          </>
        ) : (
          <>
            <div className="prb-heatmap-gradient" />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#64748b', marginTop: 2 }}>
              <span>−108 dBm (thermal)</span>
              <span>−72 dBm (severe)</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ---- Source confidence bar -------------------------------------------------

function SourceBar({ match, primary }: { match: SourceMatch; primary: boolean }) {
  const pct = Math.round(match.confidence * 100)
  const colour = SEVERITY_COLOUR[match.severity] ?? '#94a3b8'
  const icon = SOURCE_TYPE_ICON[match.sourceType] ?? '🔍'
  return (
    <div className={`source-bar ${primary ? 'source-bar--primary' : ''}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontWeight: primary ? 700 : 400, fontSize: primary ? '0.92rem' : '0.83rem' }}>
          {icon} {match.label}
        </span>
        <span style={{ fontSize: '0.78rem', color: colour, fontWeight: 700 }}>
          {pct}%
        </span>
      </div>
      <div className="confidence-track">
        <div
          className="confidence-fill"
          style={{ width: `${pct}%`, background: colour }}
        />
      </div>
      {primary && match.evidence.length > 0 && (
        <ul className="evidence-list">
          {match.evidence.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
      {!match.bandConsistent && (
        <div className="band-mismatch-badge">⚠ band mismatch — lower confidence</div>
      )}
    </div>
  )
}

// ---- Mitigation card -------------------------------------------------------

function MitigationCard({
  action,
  allCells,
  expanded,
  onToggle,
}: {
  action: MitigationAction
  allCells: Cell[]
  expanded: boolean
  onToggle: () => void
}) {
  const badge = TYPE_BADGE[action.type] ?? TYPE_BADGE.FIELD
  const borderColour = URGENCY_BORDER[action.urgency] ?? '#64748b'
  const affectedCells = allCells.filter(c =>
    action.neighborImpact?.affectedCellIds.includes(c.id)
  )

  return (
    <div className="mitigation-card" style={{ borderLeftColor: borderColour }}>
      <div className="mitigation-card-header" onClick={onToggle} style={{ cursor: 'pointer' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span
            className="type-badge"
            style={{ background: badge.bg, color: badge.text }}
          >
            {badge.label}
          </span>
          {action.featureId && (
            <span className="feature-id-badge">{action.featureId}</span>
          )}
          <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{action.title}</span>
        </div>
        <span style={{ fontSize: 12, color: '#64748b', flexShrink: 0 }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {expanded && (
        <div className="mitigation-card-body">
          <p style={{ color: '#cbd5e1', fontSize: '0.84rem', marginBottom: 8 }}>
            {action.description}
          </p>

          {action.expectedKpiImpact.length > 0 && (
            <div className="impact-section">
              <div className="impact-section-title">Expected KPI Impact</div>
              <ul className="impact-list">
                {action.expectedKpiImpact.map((k, i) => (
                  <li key={i} style={{ color: '#4ade80' }}>✓ {k}</li>
                ))}
              </ul>
            </div>
          )}

          {action.prerequisites && action.prerequisites.length > 0 && (
            <div className="impact-section">
              <div className="impact-section-title" style={{ color: '#fbbf24' }}>Prerequisites</div>
              <ul className="impact-list">
                {action.prerequisites.map((p, i) => <li key={i}>• {p}</li>)}
              </ul>
            </div>
          )}

          {action.conflicts && action.conflicts.length > 0 && (
            <div className="impact-section">
              <div className="impact-section-title" style={{ color: '#f87171' }}>Conflicts</div>
              <ul className="impact-list">
                {action.conflicts.map((c, i) => <li key={i}>⚡ {c}</li>)}
              </ul>
            </div>
          )}

          {affectedCells.length > 0 && (
            <div className="impact-section">
              <div className="impact-section-title" style={{ color: '#a78bfa' }}>
                Neighbor Impact Pool ({affectedCells.length} cells within {action.neighborImpactRadiusKm} km)
              </div>
              <div className="neighbor-pool">
                {affectedCells.map(c => (
                  <span key={c.id} className="neighbor-chip">
                    {c.id} <span style={{ opacity: 0.6, fontSize: '0.75rem' }}>{c.tech} {c.band}</span>
                  </span>
                ))}
              </div>
              {action.neighborImpact && (
                <div style={{ fontSize: '0.79rem', color: '#94a3b8', marginTop: 4 }}>
                  {action.neighborImpact.description}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---- Feature summary row ---------------------------------------------------

function FeatureRow({ label, value, unit = '' }: { label: string; value: number; unit?: string }) {
  return (
    <div className="feature-row">
      <span className="feature-row-label">{label}</span>
      <span className="feature-row-value">{value.toFixed(2)}{unit}</span>
    </div>
  )
}

// ---- Main panel ------------------------------------------------------------

export default function CellAnalysisPanel({ cell, analysis, allCells, onClose }: Props) {
  const [expandedAction, setExpandedAction] = useState<string | null>(
    analysis.mitigations[0]?.id ?? null
  )
  const [showFeatures, setShowFeatures] = useState(false)

  const primaryMatch = analysis.matches[0]
  const secondaryMatches = analysis.matches.slice(1, 4)

  const hasHistogram = useMemo(
    () => Array.isArray(cell.prbHistogram) && cell.prbHistogram.length > 0,
    [cell.prbHistogram]
  )

  const severityColour = primaryMatch
    ? SEVERITY_COLOUR[primaryMatch.severity] ?? '#94a3b8'
    : '#94a3b8'

  return (
    <div className="cell-analysis-panel">
      {/* Header */}
      <div className="cap-header" style={{ borderBottomColor: severityColour }}>
        <div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="cap-cell-id">{cell.id}</span>
            <span className="cap-tech-badge">{cell.tech}</span>
            {cell.band && <span className="cap-band-badge">{cell.band}</span>}
          </div>
          {primaryMatch && (
            <div style={{ fontSize: '0.82rem', color: '#94a3b8', marginTop: 4 }}>
              Site {cell.siteId}
              {cell.azimuth !== undefined && ` · Az ${cell.azimuth}°`}
              {cell.tilt !== undefined && ` · Tilt ${cell.tilt}°`}
            </div>
          )}
        </div>
        <button className="cap-close-btn" onClick={onClose}>✕</button>
      </div>

      <div className="cap-body">
        {/* Primary source diagnosis */}
        {primaryMatch && (
          <div className="cap-section">
            <div className="cap-section-title">Primary Interference Source</div>
            <div
              className="primary-source-box"
              style={{ borderColor: severityColour }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: '1rem', fontWeight: 700 }}>
                    {SOURCE_TYPE_ICON[primaryMatch.sourceType] ?? '🔍'} {primaryMatch.label}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: 4 }}>
                    {primaryMatch.actionHint}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div
                    className="severity-badge"
                    style={{ background: severityColour + '22', color: severityColour, border: `1px solid ${severityColour}` }}
                  >
                    {primaryMatch.severity}
                  </div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: severityColour, marginTop: 4 }}>
                    {Math.round(primaryMatch.confidence * 100)}%
                  </div>
                </div>
              </div>
              {primaryMatch.evidence.length > 0 && (
                <ul className="evidence-list" style={{ marginTop: 8 }}>
                  {primaryMatch.evidence.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* PRB histogram heatmap */}
        {hasHistogram && (
          <div className="cap-section">
            <div className="cap-section-title">
              PRB Interference Histogram (24h)
              {cell.prbHistogramPrev && (
                <span style={{ fontSize: '0.72rem', color: '#64748b', marginLeft: 8 }}>
                  · comparación semana disponible
                </span>
              )}
            </div>
            <PrbHeatmap
              histogram={cell.prbHistogram!}
              histogramPrev={cell.prbHistogramPrev}
            />
          </div>
        )}

        {/* Other candidate sources */}
        {secondaryMatches.length > 0 && (
          <div className="cap-section">
            <div className="cap-section-title">Other Candidate Sources</div>
            <div className="source-bars-list">
              {secondaryMatches.map(m => (
                <SourceBar key={m.sourceType} match={m} primary={false} />
              ))}
            </div>
          </div>
        )}

        {/* Extracted features (collapsible) */}
        <div className="cap-section">
          <button
            className="cap-toggle-btn"
            onClick={() => setShowFeatures(v => !v)}
          >
            {showFeatures ? '▲' : '▼'} PRB Feature Fingerprint
          </button>
          {showFeatures && (
            <div className="features-grid">
              <FeatureRow label="Peak level" value={analysis.features.peakDbm} unit=" dBm" />
              <FeatureRow label="Floor elevation" value={analysis.features.floorElevationDb} unit=" dB" />
              <FeatureRow label="PRB uniformity" value={analysis.features.prbUniformity} />
              <FeatureRow label="Low-PRB excess" value={analysis.features.lowPrbExcessDb} unit=" dB" />
              <FeatureRow label="Edge PRB excess" value={analysis.features.edgePrbExcessDb} unit=" dB" />
              <FeatureRow label="Peak cluster" value={analysis.features.peakClusterWidthPct} unit="%" />
              <FeatureRow label="Spectral slope" value={analysis.features.slopeDbPerPrb} unit=" dB/PRB" />
              <FeatureRow label="Temporal CV" value={analysis.features.temporalCv} />
              <FeatureRow label="Business-hrs excess" value={analysis.features.businessHourExcessDb} unit=" dB" />
              <FeatureRow label="Traffic correlation" value={analysis.features.trafficCorrelation} />
              <FeatureRow label="Night−Day Δ" value={analysis.features.nightMinusDayDb} unit=" dB" />
            </div>
          )}
        </div>

        {/* Mitigation actions */}
        {analysis.mitigations.length > 0 && (
          <div className="cap-section">
            <div className="cap-section-title">Recommended Mitigations</div>
            <div className="mitigation-list">
              {analysis.mitigations.map(action => (
                <MitigationCard
                  key={action.id}
                  action={action}
                  allCells={allCells}
                  expanded={expandedAction === action.id}
                  onToggle={() =>
                    setExpandedAction(prev => prev === action.id ? null : action.id)
                  }
                />
              ))}
            </div>
          </div>
        )}

        {/* Nearby neighbors summary */}
        {analysis.nearbyNeighborIds.length > 0 && (
          <div className="cap-section">
            <div className="cap-section-title">
              Cells within 1 km ({analysis.nearbyNeighborIds.length})
            </div>
            <div className="neighbor-pool">
              {analysis.nearbyNeighborIds.map(cid => {
                const c = allCells.find(x => x.id === cid)
                return c ? (
                  <span key={cid} className="neighbor-chip">
                    {cid} <span style={{ opacity: 0.6, fontSize: '0.75rem' }}>{c.tech} {c.band}</span>
                  </span>
                ) : (
                  <span key={cid} className="neighbor-chip">{cid}</span>
                )
              })}
            </div>
          </div>
        )}

        {/* Source location search radius */}
        <div className="cap-section cap-section--dim">
          <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
            Source search radius: <strong style={{ color: '#94a3b8' }}>{analysis.sourceSearchRadiusKm} km</strong>
            {' '}· Map heatmap centered on this site
          </div>
        </div>
      </div>
    </div>
  )
}
