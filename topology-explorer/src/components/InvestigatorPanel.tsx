/**
 * InvestigatorPanel.tsx — Investigator Agent results UI
 * Shows: tool activity, RCA report, evidence chain, action plan
 */

import type { InvestigatorOutput } from '../agents/contracts'
import type { InvestigatorStatus } from '../hooks/useInvestigator'

type Props = {
  cellId: string
  status: InvestigatorStatus
  toolStatus: string | null
  toolCallCount: number
  output: InvestigatorOutput | null
  error: string | null
  onInvestigate: () => void
  onClose: () => void
}

const CONFIDENCE_COLOR = (c: number) => {
  if (c >= 0.8) return '#22c55e'
  if (c >= 0.6) return '#eab308'
  if (c >= 0.4) return '#f97316'
  return '#ef4444'
}

const URGENCY_LABEL: Record<string, { label: string; color: string }> = {
  IMMEDIATE: { label: 'Inmediato', color: '#ef4444' },
  THIS_WEEK: { label: 'Esta semana', color: '#f97316' },
  THIS_MONTH: { label: 'Este mes', color: '#eab308' },
}

const TYPE_ICON: Record<string, string> = {
  CM: 'settings',
  FIELD: 'engineering',
  REGULATORY: 'gavel',
}

const EVIDENCE_ICON: Record<string, string> = {
  PRB_PATTERN: 'bar_chart',
  KPI_DEGRADATION: 'trending_down',
  GEOGRAPHIC_CORRELATION: 'location_on',
  TEMPORAL_PATTERN: 'schedule',
  FM_HARMONIC_MATCH: 'radio',
  NEIGHBOR_IMPACT: 'hub',
  CM_FLAG: 'settings',
}

export default function InvestigatorPanel({ cellId, status, toolStatus, toolCallCount, output, error, onInvestigate, onClose }: Props) {
  const isLoading = status === 'gathering' || status === 'analyzing'

  return (
    <div className="investigator-panel">
      <div className="investigator-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="material-icons-round" style={{ color: '#a78bfa', fontSize: 20 }}>manage_search</span>
          <div>
            <div className="investigator-title">Investigator</div>
            <div className="investigator-subtitle">{cellId} · Análisis profundo</div>
          </div>
        </div>
        <button className="investigator-close" onClick={onClose}>
          <span className="material-icons-round" style={{ fontSize: 18 }}>close</span>
        </button>
      </div>

      {/* Idle */}
      {status === 'idle' && (
        <div className="investigator-idle">
          <p className="investigator-idle-text">
            Análisis multi-fuente con inteligencia artificial. Combina PRB patterns, KPIs, vecinos y armónicos para determinar la causa raíz.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="investigator-start-btn" onClick={onInvestigate}>
              <span className="material-icons-round" style={{ fontSize: 16 }}>manage_search</span>
              Investigar en profundidad
            </button>
          </div>
        </div>
      )}

      {/* Loading with tool activity */}
      {isLoading && (
        <div className="investigator-loading">
          <div className="investigator-loading-steps">
            {toolCallCount >= 1 && <div className="inv-step inv-step--done">Config. celda ✓</div>}
            {toolCallCount >= 2 && <div className="inv-step inv-step--done">Análisis PRB ✓</div>}
            {toolCallCount >= 3 && <div className="inv-step inv-step--done">KPIs horarios ✓</div>}
            {toolCallCount >= 4 && <div className="inv-step inv-step--done">Vecinos geográficos ✓</div>}
            {toolCallCount >= 5 && <div className="inv-step inv-step--done">Armónicos FM ✓</div>}
          </div>
          {toolStatus && (
            <div className="investigator-tool-status">
              <span className="material-icons-round spinning" style={{ fontSize: 14 }}>sync</span>
              {toolStatus}
            </div>
          )}
          {!toolStatus && (
            <div className="investigator-tool-status">
              <span className="material-icons-round spinning" style={{ fontSize: 14 }}>psychology</span>
              Sintetizando diagnóstico...
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {status === 'error' && error && (
        <div className="investigator-error">
          <span className="material-icons-round">error_outline</span>
          {error}
          <button className="investigator-retry" onClick={onInvestigate}>Reintentar</button>
        </div>
      )}

      {/* Results */}
      {status === 'done' && output && (
        <div className="investigator-results">
          {/* Primary diagnosis */}
          <div className="inv-section">
            <div className="inv-section-title">Diagnóstico Principal</div>
            <div className="inv-diagnosis">
              <div className="inv-diagnosis-source">{output.rca.primarySource.replace(/_/g, ' ')}</div>
              <div className="inv-confidence-bar">
                <div
                  className="inv-confidence-fill"
                  style={{
                    width: `${output.rca.confidence * 100}%`,
                    background: CONFIDENCE_COLOR(output.rca.confidence),
                  }}
                />
              </div>
              <div style={{ fontSize: '0.75rem', color: CONFIDENCE_COLOR(output.rca.confidence) }}>
                {(output.rca.confidence * 100).toFixed(0)}% confianza
              </div>
            </div>
          </div>

          {/* Narrative */}
          {output.narrative && (
            <div className="inv-section">
              <div className="inv-section-title">Análisis</div>
              <div className="inv-narrative">{output.narrative}</div>
            </div>
          )}

          {/* Evidence chain */}
          {output.rca.evidenceChain.length > 0 && (
            <div className="inv-section">
              <div className="inv-section-title">Cadena de Evidencia</div>
              <div className="inv-evidence-list">
                {output.rca.evidenceChain.map((e, i) => (
                  <div key={i} className="inv-evidence-item">
                    <span
                      className="material-icons-round"
                      style={{ fontSize: 14, color: CONFIDENCE_COLOR(e.confidence), flexShrink: 0 }}
                    >
                      {EVIDENCE_ICON[e.type] ?? 'info'}
                    </span>
                    <div className="inv-evidence-text">
                      <div className="inv-evidence-type">{e.type.replace(/_/g, ' ')}</div>
                      <div className="inv-evidence-desc">{e.description}</div>
                    </div>
                    <div className="inv-evidence-conf">{(e.confidence * 100).toFixed(0)}%</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action plan */}
          {output.actionPlan.length > 0 && (
            <div className="inv-section">
              <div className="inv-section-title">Plan de Acción</div>
              <div className="inv-action-list">
                {output.actionPlan.map((a, i) => {
                  const urgency = URGENCY_LABEL[a.urgency] ?? { label: a.urgency, color: '#64748b' }
                  return (
                    <div key={i} className="inv-action-item">
                      <div className="inv-action-header">
                        <span
                          className="material-icons-round"
                          style={{ fontSize: 14, color: '#94a3b8', flexShrink: 0 }}
                        >
                          {TYPE_ICON[a.type] ?? 'task_alt'}
                        </span>
                        <span className="inv-action-type">{a.type}</span>
                        <span className="inv-action-urgency" style={{ color: urgency.color }}>
                          {urgency.label}
                        </span>
                        {a.featureId && (
                          <span className="inv-action-feature">{a.featureId}</span>
                        )}
                      </div>
                      <div className="inv-action-desc">{a.action}</div>
                      {a.expectedImpact && (
                        <div className="inv-action-impact">
                          <span className="material-icons-round" style={{ fontSize: 12, color: '#22c55e' }}>trending_up</span>
                          {a.expectedImpact}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Alternative hypotheses */}
          {output.rca.alternativeHypotheses.length > 0 && (
            <div className="inv-section">
              <div className="inv-section-title">Hipótesis Alternativas</div>
              {output.rca.alternativeHypotheses.map((h, i) => (
                <div key={i} className="inv-alt-hypothesis">
                  <span style={{ color: '#64748b', fontSize: '0.8rem' }}>
                    {h.source.replace(/_/g, ' ')} — {(h.probability * 100).toFixed(0)}%
                  </span>
                  <span style={{ color: '#475569', fontSize: '0.75rem' }}>{h.reason}</span>
                </div>
              ))}
            </div>
          )}

          {/* Data missing */}
          {output.dataMissing.length > 0 && (
            <div className="inv-section inv-section--dim">
              <div className="inv-section-title">Datos que mejorarían el diagnóstico</div>
              {output.dataMissing.map((d, i) => (
                <div key={i} style={{ fontSize: '0.75rem', color: '#64748b', paddingLeft: 8 }}>· {d}</div>
              ))}
            </div>
          )}

          <div style={{ fontSize: '0.7rem', color: '#475569', padding: '8px 0', textAlign: 'right' }}>
            {toolCallCount} consultas · {output.estimatedResolutionDays}d resolución estimada
          </div>

          <button className="investigator-retry" onClick={onInvestigate} style={{ marginTop: 4 }}>
            <span className="material-icons-round" style={{ fontSize: 14 }}>refresh</span>
            Re-investigar
          </button>
        </div>
      )}
    </div>
  )
}
