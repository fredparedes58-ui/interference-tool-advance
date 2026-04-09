/**
 * ScoutPanel.tsx — Scout Agent results UI
 * Shows: executive summary, stats, hotspot list with severity badges
 */

import type { ScoutOutput, ScoutHotspot } from '../agents/contracts'
import type { ScoutStatus } from '../hooks/useScout'

type Props = {
  status: ScoutStatus
  output: ScoutOutput | null
  error: string | null
  scanDurationMs: number | null
  onScan: () => void
  onClose: () => void
  onSelectCell?: (cellId: string) => void
}

const SEVERITY_COLOR: Record<ScoutHotspot['severity'], string> = {
  CRITICAL: '#ef4444',
  HIGH: '#f97316',
  MEDIUM: '#eab308',
  LOW: '#22c55e',
}

const SOURCE_LABELS: Record<string, string> = {
  FM_RADIO_HARMONIC: 'FM Harmonic',
  CABLE_TV_LEAKAGE: 'Cable TV',
  JAMMER: 'Jammer',
  PIM: 'PIM',
  BDA_OSCILLATION: 'BDA Oscil.',
  BDA_EXCESS_GAIN: 'BDA Gain',
  ATMOSPHERIC_DUCTING: 'Ducting',
  WIRELESS_ISP_2500: 'WISP 2.5G',
  WIFI_CAMERA_UNLICENSED_850: 'WiFi Cam',
  MILITARY_POLICE: 'Militar/PMR',
  UNKNOWN_PERSISTENT: 'Desconocido',
  TV_DIGITAL_BROADCAST_700: 'TDT 700',
}

export default function ScoutPanel({ status, output, error, scanDurationMs, onScan, onClose, onSelectCell }: Props) {
  const isLoading = status === 'scanning' || status === 'summarizing'

  return (
    <div className="scout-panel">
      <div className="scout-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="material-icons-round" style={{ color: '#38bdf8', fontSize: 20 }}>radar</span>
          <div>
            <div className="scout-title">Scout — Análisis de Red</div>
            <div className="scout-subtitle">Escaneo automático de interferencia</div>
          </div>
        </div>
        <button className="scout-close" onClick={onClose} title="Cerrar">
          <span className="material-icons-round" style={{ fontSize: 18 }}>close</span>
        </button>
      </div>

      {/* Scan button */}
      {status === 'idle' && (
        <div className="scout-idle">
          <p className="scout-idle-text">
            Escanea toda la red en busca de interferencia activa. El análisis es instantáneo y local — no requiere conexión.
          </p>
          <button className="scout-scan-btn" onClick={onScan}>
            <span className="material-icons-round">search</span>
            Escanear red completa
          </button>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="scout-loading">
          <div className="scout-loading-icon">
            <span className="material-icons-round spinning">radar</span>
          </div>
          <div className="scout-loading-label">
            {status === 'scanning' ? 'Escaneando celdas...' : 'Generando resumen ejecutivo...'}
          </div>
        </div>
      )}

      {/* Error */}
      {status === 'error' && error && (
        <div className="scout-error">
          <span className="material-icons-round">error_outline</span>
          {error}
          <button className="scout-retry" onClick={onScan}>Reintentar</button>
        </div>
      )}

      {/* Results */}
      {status === 'done' && output && (
        <div className="scout-results">
          {/* Stats bar */}
          <div className="scout-stats">
            <div className="scout-stat">
              <span className="scout-stat-value">{output.stats.totalCellsScanned}</span>
              <span className="scout-stat-label">Celdas</span>
            </div>
            <div className="scout-stat">
              <span className="scout-stat-value" style={{ color: '#ef4444' }}>{output.stats.criticalCount}</span>
              <span className="scout-stat-label">Críticas</span>
            </div>
            <div className="scout-stat">
              <span className="scout-stat-value" style={{ color: '#f97316' }}>{output.stats.highCount}</span>
              <span className="scout-stat-label">Altas</span>
            </div>
            <div className="scout-stat">
              <span className="scout-stat-value" style={{ color: '#eab308' }}>{output.stats.mediumCount}</span>
              <span className="scout-stat-label">Medias</span>
            </div>
            {scanDurationMs != null && (
              <div className="scout-stat">
                <span className="scout-stat-value">{scanDurationMs.toFixed(0)}ms</span>
                <span className="scout-stat-label">Scan</span>
              </div>
            )}
          </div>

          {/* Executive summary */}
          <div className="scout-summary">
            <div className="scout-summary-icon">
              <span className="material-icons-round" style={{ fontSize: 14 }}>summarize</span>
            </div>
            <p className="scout-summary-text">{output.executiveSummary}</p>
          </div>

          {/* Top recommendation */}
          {output.topRecommendation && (
            <div className="scout-recommendation">
              <span className="material-icons-round" style={{ fontSize: 14, color: '#f97316', flexShrink: 0 }}>priority_high</span>
              <span>{output.topRecommendation}</span>
            </div>
          )}

          {/* Quick wins */}
          {output.quickWins.length > 0 && (
            <div className="scout-quickwins">
              <div className="scout-quickwins-title">Acciones CM inmediatas</div>
              {output.quickWins.map((w, i) => (
                <div key={i} className="scout-quickwin-item">
                  <span className="material-icons-round" style={{ fontSize: 12, color: '#22c55e', flexShrink: 0 }}>check_circle</span>
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* Hotspot list */}
          {output.hotspots.length > 0 && (
            <div className="scout-hotspot-list">
              <div className="scout-hotspot-list-title">
                Hotspots detectados ({output.hotspots.length})
              </div>
              {output.hotspots.map(h => (
                <div
                  key={h.cellId}
                  className="scout-hotspot-row"
                  onClick={() => onSelectCell?.(h.cellId)}
                  style={{ cursor: onSelectCell ? 'pointer' : 'default' }}
                >
                  <div
                    className="scout-severity-dot"
                    style={{ background: SEVERITY_COLOR[h.severity] }}
                    title={h.severity}
                  />
                  <div className="scout-hotspot-info">
                    <div className="scout-hotspot-cell">
                      {h.cellId}
                      <span className="scout-hotspot-band">{h.tech} {h.band}</span>
                    </div>
                    <div className="scout-hotspot-site">{h.siteName} · {h.region}</div>
                  </div>
                  <div className="scout-hotspot-right">
                    <div className="scout-hotspot-source">
                      {SOURCE_LABELS[h.primarySourceType] ?? h.primarySourceType}
                    </div>
                    <div className="scout-hotspot-score">{(h.score * 100).toFixed(0)}%</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Rescan button */}
          <button className="scout-rescan-btn" onClick={onScan}>
            <span className="material-icons-round" style={{ fontSize: 14 }}>refresh</span>
            Re-escanear
          </button>
        </div>
      )}
    </div>
  )
}
