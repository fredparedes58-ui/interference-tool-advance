/**
 * api/plan.ts — Planner Agent API
 *
 * PROMPT CONTRACT v1.0 — Planner Agent
 * Identity: CM/Field operations action planner.
 *           Analyzes top interference issues and generates a
 *           prioritized, week-by-week structured action plan.
 *
 * Input:  { constraint, horizon, messages? }
 * Output:
 *   - { type: 'tool_calls', toolCalls, assistantContent } (tool use phase)
 *   - { type: 'plan', data: PlannerOutput } (final output)
 *
 * Restrictions:
 *   - temperature: 0 (deterministic prioritization)
 *   - max_tokens: 1600
 *   - Only 3 PLANNER_TOOLS available: get_top_interference_issues, get_cell_info, analyze_cell
 */

import Anthropic from '@anthropic-ai/sdk'
import { PLANNER_TOOLS } from './_tools'
import type { PlannerInput, PlannerOutput } from '../src/agents/contracts'

export const config = { runtime: 'edge' }

const PLANNER_SYSTEM = `Eres Planner, el planificador de acciones de interferencia de Interference Explorer.

## IDENTIDAD
role: CM/Field Operations Planner — Ingeniero de optimización de red
scope: Generar plan de acción priorizado. NO conversas. Produces un plan JSON estructurado.

## PROCESO
1. Llama get_top_interference_issues (limit: 20) → obtén lista priorizada
2. Para los top 5 más críticos → llama get_cell_info para detalles de configuración
3. Si alguno tiene score > 0.8 → llama analyze_cell para mitigaciones específicas
4. Sintetiza en plan semana a semana → genera el JSON final

## LÓGICA DE PRIORIZACIÓN
- CRÍTICO (score ≥ 0.85): acción CM en Semana 1
- ALTO (score ≥ 0.65): acción CM en Semana 1-2, field en Semana 2-3
- MEDIO (score ≥ 0.40): acción CM en Semana 2-4
- Si constraint = 'cm_only': excluir acciones FIELD y REGULATORY del plan
- ROI > urgencia: priorizar acciones CM que no requieren campo sobre visitas

## RESTRICCIONES DURAS
- Output final EXCLUSIVAMENTE en JSON válido
- Sin texto fuera del JSON
- weekNum empieza en 1, máximo según horizon (week=1, month=4, quarter=13)
- No inventar cellIds ni feature IDs no presentes en los datos de las herramientas
- dependencies: citar ranks de acciones que deben completarse primero

## OUTPUT FORMAT (cuando hayas terminado de usar herramientas)
{
  "actions": [
    {
      "rank": 1,
      "cellId": "string",
      "siteName": "string",
      "region": "string",
      "issueType": "string",
      "type": "CM|FIELD|REGULATORY",
      "action": "string",
      "featureId": "string|null",
      "urgency": "CRITICAL|HIGH|MEDIUM",
      "estimatedKpiGain": "string",
      "dependencies": [],
      "weekNum": 1,
      "requiresFieldVisit": false
    }
  ],
  "summary": {
    "totalActions": 0,
    "cmActions": 0,
    "fieldActions": 0,
    "regulatoryActions": 0,
    "estimatedOverallImpact": "string",
    "criticalActionsThisWeek": 0
  },
  "executiveSummary": "string (2-3 oraciones)",
  "weeklySchedule": [
    { "week": 1, "label": "string", "actions": [1, 2, 3] }
  ]
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
      constraint: PlannerInput['constraint']
      horizon: PlannerInput['horizon']
      messages?: Anthropic.MessageParam[]
    }

    const { constraint, horizon, messages } = body

    const history: Anthropic.MessageParam[] = messages ?? [
      {
        role: 'user',
        content: `Genera un plan de acción para las celdas con mayor interferencia en la red. Restricción: ${constraint}. Horizonte: ${horizon}. Usa las herramientas para obtener los datos y genera el JSON del plan.`,
      },
    ]

    const client = new Anthropic({ apiKey })

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1600,
      system: PLANNER_SYSTEM,
      messages: history,
      tools: PLANNER_TOOLS,
    })

    // ── Tool use ───────────────────────────────────────────────────────────────
    if (response.stop_reason === 'tool_use') {
      const toolCalls = response.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        .map(b => ({ id: b.id, name: b.name, input: b.input }))

      return new Response(
        JSON.stringify({ type: 'tool_calls', toolCalls, assistantContent: response.content }),
        { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      )
    }

    // ── End turn → parse plan JSON ─────────────────────────────────────────────
    const rawText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')

    let planData: PlannerOutput
    try {
      const clean = rawText.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
      planData = JSON.parse(clean)
    } catch {
      planData = {
        actions: [],
        summary: {
          totalActions: 0,
          cmActions: 0,
          fieldActions: 0,
          regulatoryActions: 0,
          estimatedOverallImpact: 'No se pudo generar el plan — datos insuficientes',
          criticalActionsThisWeek: 0,
        },
        executiveSummary: 'El plan no pudo generarse. Asegúrate de cargar una topología con datos de interferencia.',
        weeklySchedule: [],
      }
    }

    return new Response(
      JSON.stringify({ type: 'plan', data: planData }),
      { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error desconocido'
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
}
