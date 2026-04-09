/**
 * _tools.ts — Shared Anthropic Tool Registry for all agents
 * Prefixed with _ so Vercel does NOT expose this as an API route.
 *
 * PROMPT CONTRACT — Tool Registry v1.0
 * These 6 tools are the deterministic interface between Claude agents
 * and the real data loaded in the browser (topology, KPI, issues).
 * All tool execution happens CLIENT-SIDE via useToolExecutor.ts.
 */

import Anthropic from '@anthropic-ai/sdk'

// ── Tool definitions ──────────────────────────────────────────────────────────

export const ALL_TOOLS: Anthropic.Tool[] = [
  {
    name: 'analyze_cell',
    description: 'Ejecuta el clasificador de interferencia completo para una celda con PRB histogram. Retorna: fuentes clasificadas por confianza (0–1), evidencias, severidad y acciones de mitigación Ericsson con feature IDs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        cellId: { type: 'string', description: 'ID exacto de la celda (ej: GALX1A00)' },
      },
      required: ['cellId'],
    },
  },
  {
    name: 'get_kpi_data',
    description: 'Obtiene los KPIs horarios (24h) de una celda. Retorna disponibilidad, PRB utilización, throughput DL, PDCCH, ERAB accesibilidad y metadatos de umbrales.',
    input_schema: {
      type: 'object' as const,
      properties: {
        cellId: { type: 'string', description: 'ID de la celda' },
        date: { type: 'string', description: 'Fecha YYYY-MM-DD. Si se omite, usa la última disponible.' },
        kpiKeys: {
          type: 'array',
          items: { type: 'string' },
          description: 'KPIs específicos a retornar. Si se omite, retorna todos.',
        },
      },
      required: ['cellId'],
    },
  },
  {
    name: 'calculate_fm_harmonics',
    description: 'Calcula armónicos (orden 2–12) de una emisora FM que caen en la banda UL LTE especificada. Retorna frecuencia exacta, posición % en la banda y PRBs afectados.',
    input_schema: {
      type: 'object' as const,
      properties: {
        fmFreqMhz: { type: 'number', description: 'Frecuencia FM en MHz (87–108)' },
        bandNum: { type: 'number', description: 'Número de banda LTE (5, 20, 28, etc.)' },
      },
      required: ['fmFreqMhz', 'bandNum'],
    },
  },
  {
    name: 'find_nearby_cells',
    description: 'Encuentra celdas dentro de un radio geográfico respecto a la celda de referencia. Retorna distancia, tech, banda, vendor y disponibilidad de PRB data.',
    input_schema: {
      type: 'object' as const,
      properties: {
        cellId: { type: 'string', description: 'Celda de referencia' },
        radiusKm: { type: 'number', description: 'Radio en km (≤10 para BDA, ≤50 para ducting)' },
      },
      required: ['cellId', 'radiusKm'],
    },
  },
  {
    name: 'get_top_interference_issues',
    description: 'Retorna las celdas con mayor score de interferencia, ordenadas por severidad. Úsalo para resúmenes de red y priorización.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Máximo de resultados (default: 10, máx: 50)' },
        minScore: { type: 'number', description: 'Score mínimo 0–1 (default: 0)' },
      },
      required: [],
    },
  },
  {
    name: 'get_cell_info',
    description: 'Obtiene configuración completa de una celda: tech, banda, BW, vendor, azimuth, tilt, PCI, EARFCN, KPI snapshot y flags CM.',
    input_schema: {
      type: 'object' as const,
      properties: {
        cellId: { type: 'string', description: 'ID de la celda' },
      },
      required: ['cellId'],
    },
  },
]

// Subsets for agents that don't need all tools
export const INVESTIGATOR_TOOLS = ALL_TOOLS  // needs all 6
export const PLANNER_TOOLS = ALL_TOOLS.filter(t =>
  ['get_top_interference_issues', 'get_cell_info', 'analyze_cell'].includes(t.name)
)
export const SCOUT_TOOLS: Anthropic.Tool[] = []  // Scout uses no tools — data arrives pre-computed

// ── Max tool calls per agent ──────────────────────────────────────────────────
export const MAX_TOOL_CALLS = 5
