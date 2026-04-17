/**
 * PlannerPanel.tsx — Planner Agent results UI
 * Shows: constraint/horizon selector, tool activity, weekly schedule, action cards
 */

import { useState } from 'react'
import type { PlannerOutput, PlannerActionItem, PlannerConstraint, PlannerHorizon } from '../agents/contracts'
import type { PlannerStatus } from '../hooks/usePlanner'

type Props = {
  status: PlannerStatus
  toolStatus: string | null
  output: PlannerOutput | null
  error: string | null
  onGenerate: (constraint: PlannerConstraint, horizon: PlannerHorizon) => void
  onClose: () => void
}

const URGENCY_COLOR: Record<PlannerActionItem['urgency'], string> = {
  CRITICAL: '#ef4444',
  HIGH: '#f97316',
  MEDIUM: '#eab308',
}

const TYPE_ICON: Record<PlannerActionItem['type'], string> = {
  CM: 'settings',
  FIELD: 'engineering',
  REGULATORY: 'gavel',
}

const TYPE_LABEL: Record<PlannerActionItem['type'], string> = {
  CM: 'CM',
  FIELD: 'Campo',
  REGULATORY: 'Regulatorio',
}

const CONSTRAINT_OPTIONS: { value: PlannerConstraint; label: string }[] = [
  { value: 'all', label: 'Todas las acciones' },
  { value: 'cm_only', label: 'Solo CM (sin visitas)' },
  { value: 'no_regulatory', label: 'Sin trámites regulatorios' },
]

const HORIZON_OPTIONS: { value: PlannerHorizon; label: string }[] = [
  { value: 'week', label: '1 semana' },
  { value: 'month', label: '1 mes' },
  { value: 'quarter', label: '1 trimestre' },
]

export default function PlannerPanel({ status, toolStatus, output, error, onGenerate, onClose }: Props) {
  const [constraint, setConstraint] = useState<PlannerConstraint>('all')
  const [horizon, setHorizon] = useState<PlannerHorizon>('month')
  const [activeWeek, setActiveWeek] = useState<number | null>(null)
  const isLoading = status === 'planning'

  const visibleActions = output
    ? (activeWeek !== null
        ? output.actions.filter(a => a.weekNum === activeWeek)
        : output.actions)
    : []

  return (
    <div className="planner-panel">
      {/* Header */}
      <div className="planner-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="material-icons-round" style={{ color: '#a78bfa', fontSize: 20 }}>event_note</span>
          <div>
            <div className="planner-title">Planner — Plan de Acción</div>
            <div className="planner-subtitle">Priorización CM + Campo para la red</div>
          </div>
        </div>
        <button className="planner-close" onClick={onClose} title="Cerrar">
          <span className="material-icons-round" style={{ fontSize: 18 }}>close</span>
        </button>
      </div>

      {/* Config form */}
      {(status === 'idle' || status === 'done' || status === 'error') && (
        <div className="planner-config">
          <div className="planner-config-row">
            <label className="planner-label">Restricción</label>
            <select
              className="planner-select"
              value={constraint}
              onChange={e => setConstraint(e.target.value as PlannerConstraint)}
            >
              {CONSTRAINT_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="planner-config-row">
            <label className="planner-label">Horizonte</label>
            <select
              className="planner-select"
              value={horizon}
              onChange={e => setHorizon(e.target.value as PlannerHorizon)}
            >
              {HORIZON_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <button
            className="planner-generate-btn"
            onClick={() => { setActiveWeek(null); onGenerate(constraint, horizon) }}
            disabled={isLoading}
          >
            <span className="material-icons-round" style={{ fontSize: 16 }}>auto_awesome</span>
            {status === 'done' ? 'Re-generar plan' : 'Generar plan de acción'}
          </button>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="planner-loading">
          <div className="planner-loading-icon">
            <span className="material-icons-round spinning">event_note</span>
          </div>
          <div className="planner-loading-label">
            {toolStatus ?? 'Planificando acciones...'}
          </div>
          <div className="planner-loading-hint">El agente consulta datos de celda y prioriza acciones</div>
        </div>
      )}

      {/* Error */}
      {status === 'error' && error && (
        <div className="planner-error">
          <span className="material-icons-round">error_outline</span>
          {error}
        </div>
      )}

      {/* Results */}
      {status === 'done' && output && (
        <div className="planner-results">
          {/* Summary stats */}
          <div className="planner-stats">
            <div className="planner-stat">
              <span className="planner-stat-value">{output.summary.totalActions}</span>
              <span className="planner-stat-label">Acciones</span>
            </div>
            <div className="planner-stat">
              <span className="planner-stat-value" style={{ color: '#38bdf8' }}>{output.summary.cmActions}</span>
              <span className="planner-stat-label">CM</span>
            </div>
            <div className="planner-stat">
              <span className="planner-stat-value" style={{ color: '#fb923c' }}>{output.summary.fieldActions}</span>
              <span className="planner-stat-label">Campo</span>
            </div>
            <div className="planner-stat">
              <span className="planner-stat-value" style={{ color: '#ef4444' }}>{output.summary.criticalActionsThisWeek}</span>
              <span className="planner-stat-label">Críticas/sem</span>
            </div>
          </div>

          {/* Executive summary */}
          <div className="planner-exec-summary">
            <div className="planner-exec-icon">
              <span className="material-icons-round" style={{ fontSize: 14 }}>summarize</span>
            </div>
            <p className="planner-exec-text">{output.executiveSummary}</p>
          </div>

          {/* Impact estimate */}
          {output.summary.estimatedOverallImpact && (
            <div className="planner-impact">
              <span className="material-icons-round" style={{ fontSize: 13, color: '#22c55e', flexShrink: 0 }}>trending_up</span>
              <span>{output.summary.estimatedOverallImpact}</span>
            </div>
          )}

          {/* Weekly schedule tabs */}
          {output.weeklySchedule.length > 0 && (
            <div className="planner-weeks">
              <div className="planner-weeks-title">Cronograma semanal</div>
              <div className="planner-week-tabs">
                <button
                  className={`planner-week-tab ${activeWeek === null ? 'active' : ''}`}
                  onClick={() => setActiveWeek(null)}
                >
                  Todas
                </button>
                {output.weeklySchedule.map(w => (
                  <button
                    key={w.week}
                    className={`planner-week-tab ${activeWeek === w.week ? 'active' : ''}`}
                    onClick={() => setActiveWeek(w.week)}
                  >
                    {w.label}
                    <span className="planner-week-count">{w.actions.length}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Action cards */}
          <div className="planner-action-list">
            {visibleActions.length === 0 && (
              <p className="planner-empty">No hay acciones para este período.</p>
            )}
            {visibleActions.map(action => (
              <div key={`${action.rank}-${action.cellId}`} className="planner-action-card">
                <div className="planner-action-top">
                  <div className="planner-action-rank">#{action.rank}</div>
                  <div
                    className="planner-action-urgency"
                    style={{ color: URGENCY_COLOR[action.urgency] }}
                  >
                    {action.urgency}
                  </div>
                  <div className="planner-action-type">
                    <span className="material-icons-round" style={{ fontSize: 12 }}>{TYPE_ICON[action.type]}</span>
                    {TYPE_LABEL[action.type]}
                  </div>
                  {action.requiresFieldVisit && (
                    <div className="planner-field-badge">
                      <span className="material-icons-round" style={{ fontSize: 11 }}>directions_car</span>
                      Visita
                    </div>
                  )}
                </div>

                <div className="planner-action-cell">
                  {action.cellId}
                  <span className="planner-action-site">{action.siteName} · {action.region}</span>
                </div>

                <div className="planner-action-issue">{action.issueType}</div>
                <div className="planner-action-desc">{action.action}</div>

                {action.featureId && (
                  <div className="planner-action-feature">
                    <span className="material-icons-round" style={{ fontSize: 11, opacity: 0.6 }}>code</span>
                    {action.featureId}
                  </div>
                )}

                {action.estimatedKpiGain && (
                  <div className="planner-action-gain">
                    <span className="material-icons-round" style={{ fontSize: 11, color: '#22c55e' }}>trending_up</span>
                    {action.estimatedKpiGain}
                  </div>
                )}

                {action.dependencies.length > 0 && (
                  <div className="planner-action-deps">
                    <span className="material-icons-round" style={{ fontSize: 11, opacity: 0.5 }}>link</span>
                    Depende de: {action.dependencies.join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
