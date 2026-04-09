/**
 * contracts.ts — Prompt Contract types for all Interference Explorer agents
 * VERSION: 1.0
 *
 * Each agent has:
 *   - Input type: what the agent receives
 *   - Output type: what it MUST return (JSON, never free text)
 *   - Error type: structured error feedback
 *
 * Rule: agents communicate through Orchestrator only.
 * Rule: all outputs are JSON structured. Never free text.
 * Rule: max 3 retries before escalating to human.
 */

// ── Shared primitives ─────────────────────────────────────────────────────────

export type AgentId = 'hunter' | 'scout' | 'investigator' | 'planner' | 'reporter'

export type AgentError = {
  agent: AgentId
  code: 'TOOL_FAILED' | 'PARSE_ERROR' | 'MAX_RETRIES' | 'DATA_MISSING' | 'TIMEOUT'
  message: string
  retries: number
  context?: string
}

export type AgentResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AgentError }

// ── Scout Agent Contract v1.0 ─────────────────────────────────────────────────
// Identity: Automated network-wide interference scanner
// Scope: Sweep entire topology, score all cells, summarize findings
// Temperature: 0 (deterministic narrative)
// Tool use: NONE — scanning done client-side via networkScanner.ts

export type ScoutInput = {
  /** Pre-computed hotspots from networkScanner.sweepNetwork() */
  hotspots: ScoutHotspot[]
  /** Total cells scanned (for stats) */
  totalCellsScanned: number
  /** Total cells with PRB data */
  cellsWithPrbData: number
}

export type ScoutHotspot = {
  cellId: string
  siteId: string
  siteName: string
  region: string
  band: string | null
  tech: string
  score: number                         // 0–1
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  primarySourceType: string
  quickAction: string                   // immediate CM action (from mitigations[0])
  lat: number
  lon: number
}

export type ScoutOutput = {
  /** Ranked hotspot list (same as input, for passthrough) */
  hotspots: ScoutHotspot[]
  stats: {
    totalCellsScanned: number
    cellsWithPrbData: number
    hotspotCount: number
    criticalCount: number
    highCount: number
    mediumCount: number
  }
  /** LLM-generated executive summary (2–3 sentences) */
  executiveSummary: string
  /** LLM-generated top priority recommendation */
  topRecommendation: string
  /** LLM-generated quick wins (CM actions, no field) */
  quickWins: string[]
}

// ── Investigator Agent Contract v1.0 ─────────────────────────────────────────
// Identity: Deep root-cause analysis specialist
// Scope: Single cell investigation with multi-turn tool use
// Temperature: 0 (deterministic RCA)
// Tool use: analyze_cell, get_kpi_data, find_nearby_cells,
//           calculate_fm_harmonics, get_cell_info (up to 5 calls)

export type InvestigatorInput = {
  cellId: string
  depth: 'quick' | 'full'  // quick: ≤2 tool calls; full: up to 5
}

export type EvidenceType =
  | 'PRB_PATTERN'
  | 'KPI_DEGRADATION'
  | 'GEOGRAPHIC_CORRELATION'
  | 'TEMPORAL_PATTERN'
  | 'FM_HARMONIC_MATCH'
  | 'NEIGHBOR_IMPACT'
  | 'CM_FLAG'

export type EvidenceItem = {
  type: EvidenceType
  description: string
  confidence: number          // 0–1
}

export type AlternativeHypothesis = {
  source: string              // SourceType string
  probability: number         // 0–1
  reason: string
}

export type InvestigatorActionItem = {
  priority: number            // 1 = highest
  type: 'CM' | 'FIELD' | 'REGULATORY'
  action: string
  featureId: string | null    // Ericsson feature ID or null
  urgency: 'IMMEDIATE' | 'THIS_WEEK' | 'THIS_MONTH'
  expectedImpact: string
}

export type InvestigatorOutput = {
  cellId: string
  rca: {
    primarySource: string     // SourceType
    confidence: number        // 0–1
    evidenceChain: EvidenceItem[]
    alternativeHypotheses: AlternativeHypothesis[]
  }
  actionPlan: InvestigatorActionItem[]
  estimatedResolutionDays: number
  /** Human-readable explanation (1–3 paragraphs) */
  narrative: string
  /** What additional data would improve confidence */
  dataMissing: string[]
}

// ── Planner Agent Contract v1.0 ──────────────────────────────────────────────
// Identity: CM/Field operations action planner
// Scope: Multi-cell prioritized action plan generation
// Temperature: 0 (deterministic prioritization)
// Tool use: get_top_interference_issues, get_cell_info, analyze_cell

export type PlannerConstraint = 'cm_only' | 'no_regulatory' | 'all'
export type PlannerHorizon = 'week' | 'month' | 'quarter'

export type PlannerInput = {
  cellIds?: string[]          // Specific cells, or omit for top issues
  constraint: PlannerConstraint
  horizon: PlannerHorizon
  maxActions?: number         // default 20
}

export type PlannerActionItem = {
  rank: number
  cellId: string
  siteName: string
  region: string
  issueType: string
  type: 'CM' | 'FIELD' | 'REGULATORY'
  action: string
  featureId: string | null
  urgency: 'CRITICAL' | 'HIGH' | 'MEDIUM'
  estimatedKpiGain: string
  dependencies: string[]      // other actions this depends on
  weekNum: number             // which week in the horizon
  requiresFieldVisit: boolean
}

export type PlannerOutput = {
  actions: PlannerActionItem[]
  summary: {
    totalActions: number
    cmActions: number
    fieldActions: number
    regulatoryActions: number
    estimatedOverallImpact: string
    criticalActionsThisWeek: number
  }
  executiveSummary: string
  /** Ordered week-by-week schedule */
  weeklySchedule: Array<{
    week: number
    label: string             // "Semana 1 (CM urgentes)"
    actions: number[]         // action ranks for this week
  }>
}

// ── Reporter Agent Contract v1.0 ─────────────────────────────────────────────
// Identity: Technical report writer
// Scope: Regulatory/field/executive report generation
// Temperature: 0.1 (slight creativity for narrative quality)
// Tool use: get_cell_info, get_kpi_data, analyze_cell

export type ReportType =
  | 'field_report'
  | 'regulatory_cnaf'
  | 'executive_summary'
  | 'technical_deep_dive'

export type ReportLocale = 'es_ES' | 'es_AR' | 'es_MX' | 'es_CO'

export type ReporterInput = {
  cellIds: string[]
  reportType: ReportType
  locale: ReportLocale
}

export type ReportSection = {
  title: string
  content: string
  type: 'text' | 'table' | 'action_list' | 'findings'
}

export type ReporterOutput = {
  title: string
  reportType: ReportType
  locale: ReportLocale
  sections: ReportSection[]
  generatedAt: string         // ISO timestamp
  cellCount: number
}

// ── Orchestrator result (for future multi-agent coordination) ─────────────────

export type OrchestratorResult = {
  taskId: string
  status: 'completed' | 'partial' | 'escalated'
  results: Array<{
    agent: AgentId
    output: unknown
    validated: boolean
  }>
  errors: AgentError[]
  requiresHuman: boolean
  reason?: string
}
