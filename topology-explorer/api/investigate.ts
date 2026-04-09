/**
 * api/investigate.ts — Investigator Agent API
 *
 * PROMPT CONTRACT v1.0 — Investigator Agent
 * Identity: Deep root-cause analysis specialist for RF interference.
 *           Uses Claude Tool Use to gather multi-source evidence,
 *           then synthesizes into a structured JSON RCA report.
 *
 * Input:  { cellId, depth, messages? } (messages for multi-turn tool loop)
 * Output:
 *   - { type: 'tool_calls', toolCalls, assistantContent } when Claude needs tools
 *   - { type: 'report', data: InvestigatorOutput } when analysis is complete
 *
 * Restrictions:
 *   - Final output ONLY valid JSON matching InvestigatorOutput schema
 *   - temperature: 0 (deterministic RCA)
 *   - max_tokens: 1400
 *   - Max tool calls: 5 (enforced in client via MAX_TOOL_CALLS)
 */

import Anthropic from '@anthropic-ai/sdk'
import { INVESTIGATOR_TOOLS } from './_tools'
import type { InvestigatorInput, InvestigatorOutput } from '../src/agents/contracts'

export const config = { runtime: 'edge' }

const INVESTIGATOR_SYSTEM = `Eres Investigator, el especialista en análisis de causa raíz de interferencia RF de Interference Explorer.

## IDENTIDAD
role: Deep RCA Specialist — Ingeniero RF senior de 15+ años
scope: Análisis profundo de una celda específica. NO conversas. Produces un reporte estructurado.

## PROCESO DE INVESTIGACIÓN
1. Llama get_cell_info → obtén configuración completa
2. Llama analyze_cell → obtén clasificación PRB + mitigaciones
3. Si hay KPI data disponible → llama get_kpi_data para degradación horaria
4. Llama find_nearby_cells (radio 2km) → confirma/descarta patrón geográfico
5. Si fuente podría ser FM_RADIO_HARMONIC → llama calculate_fm_harmonics
6. Sintetiza toda la evidencia → genera el JSON final

## RESTRICCIONES DURAS
- Output final EXCLUSIVAMENTE en JSON válido según el schema exacto
- Sin texto fuera del JSON en la respuesta final
- Sin inventar feature IDs de Ericsson no reconocidos
- confidence debe estar calibrado (0.5 = incertidumbre, 0.9 = evidencia sólida)
- dataMissing debe listar qué datos adicionales mejorarían el diagnóstico

## OUTPUT FORMAT (cuando hayas terminado de usar herramientas)
{
  "cellId": "string",
  "rca": {
    "primarySource": "string (SourceType)",
    "confidence": 0.0,
    "evidenceChain": [
      { "type": "PRB_PATTERN|KPI_DEGRADATION|GEOGRAPHIC_CORRELATION|TEMPORAL_PATTERN|FM_HARMONIC_MATCH|NEIGHBOR_IMPACT|CM_FLAG", "description": "string", "confidence": 0.0 }
    ],
    "alternativeHypotheses": [
      { "source": "string", "probability": 0.0, "reason": "string" }
    ]
  },
  "actionPlan": [
    { "priority": 1, "type": "CM|FIELD|REGULATORY", "action": "string", "featureId": "string|null", "urgency": "IMMEDIATE|THIS_WEEK|THIS_MONTH", "expectedImpact": "string" }
  ],
  "estimatedResolutionDays": 0,
  "narrative": "string (1-3 párrafos en español)",
  "dataMissing": ["string"]
}`

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY no configurada.' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = (await req.json()) as {
      cellId: string
      depth: InvestigatorInput['depth']
      messages?: Anthropic.MessageParam[]
    }

    const { cellId, depth, messages } = body

    // Build message history
    const history: Anthropic.MessageParam[] = messages ?? [
      {
        role: 'user',
        content: `Investiga en profundidad la celda ${cellId}. Usa las herramientas disponibles para recopilar evidencia completa y sintetiza en un reporte JSON estructurado. Depth: ${depth}.`,
      },
    ]

    const client = new Anthropic({ apiKey })

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1400,
      system: INVESTIGATOR_SYSTEM,
      messages: history,
      tools: INVESTIGATOR_TOOLS,
    })

    // ── Tool use → return JSON for client to execute ───────────────────────────
    if (response.stop_reason === 'tool_use') {
      const toolCalls = response.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        .map(b => ({ id: b.id, name: b.name, input: b.input }))

      return new Response(
        JSON.stringify({ type: 'tool_calls', toolCalls, assistantContent: response.content }),
        { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      )
    }

    // ── End turn → parse JSON report ──────────────────────────────────────────
    const rawText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')

    let reportData: InvestigatorOutput
    try {
      const clean = rawText.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
      reportData = JSON.parse(clean)
    } catch {
      // Structured fallback if JSON parse fails
      reportData = {
        cellId,
        rca: {
          primarySource: 'UNKNOWN_PERSISTENT',
          confidence: 0.3,
          evidenceChain: [{ type: 'PRB_PATTERN', description: 'Análisis incompleto — datos PRB insuficientes', confidence: 0.3 }],
          alternativeHypotheses: [],
        },
        actionPlan: [{ priority: 1, type: 'FIELD', action: 'Scan espectral en campo para caracterizar la interferencia', featureId: null, urgency: 'THIS_WEEK', expectedImpact: 'Identificación definitiva de la fuente' }],
        estimatedResolutionDays: 14,
        narrative: 'El análisis no pudo completarse con los datos disponibles. Se recomienda scan espectral en campo.',
        dataMissing: ['prbHistogram completo', 'KPI horarios', 'scan espectral de campo'],
      }
    }

    return new Response(
      JSON.stringify({ type: 'report', data: reportData }),
      { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error desconocido'
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
}
