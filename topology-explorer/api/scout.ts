/**
 * api/scout.ts — Scout Agent API
 *
 * PROMPT CONTRACT v1.0 — Scout Agent
 * Identity: Automated network analyzer. Receives pre-computed hotspot data
 *           from networkScanner.sweepNetwork() and generates a structured
 *           JSON executive summary. NO tool use — scanning is deterministic.
 *
 * Input:  { hotspots: ScoutHotspot[], totalCellsScanned, cellsWithPrbData }
 * Output: ScoutOutput JSON (no streaming, no free text)
 *
 * Restrictions:
 *   - Output ONLY valid JSON matching ScoutOutput schema
 *   - No hallucination of cell IDs or feature IDs not in the input
 *   - max_tokens: 600 (summary + recommendation + 3 quick wins)
 *   - temperature: 0 (deterministic)
 */

import Anthropic from '@anthropic-ai/sdk'
import type { ScoutInput, ScoutOutput } from '../src/agents/contracts'

export const config = { runtime: 'edge' }

const SCOUT_SYSTEM = `Eres Scout, el analizador automático de red de Interference Explorer.

## IDENTIDAD
role: Automated RF Network Sweep Analyst
scope: Analizar datos de interferencia pre-computados y generar resumen ejecutivo estructurado.

## RESTRICCIONES DURAS
- Output EXCLUSIVAMENTE en JSON válido según el schema exacto indicado
- Sin texto fuera del JSON
- Sin inventar cellIds, siteNames o feature IDs que no estén en los datos
- Sin markdown, sin bloques de código

## OUTPUT FORMAT (seguir EXACTAMENTE)
{
  "executiveSummary": "string (2-3 oraciones, nivel ejecutivo)",
  "topRecommendation": "string (1 acción concreta, la más urgente)",
  "quickWins": ["string", "string", "string"]
}

quickWins: máximo 3 acciones CM inmediatas (sin visita a campo) derivadas de los hotspots.
Citar cellIds reales del input. Mencionar feature IDs Ericsson solo si son conocidos (FAJ 121 XXXX).`

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
    const body = (await req.json()) as ScoutInput

    const { hotspots, totalCellsScanned, cellsWithPrbData } = body

    if (!hotspots || hotspots.length === 0) {
      const emptyOutput: ScoutOutput = {
        hotspots: [],
        stats: {
          totalCellsScanned,
          cellsWithPrbData,
          hotspotCount: 0,
          criticalCount: 0,
          highCount: 0,
          mediumCount: 0,
        },
        executiveSummary: 'No se detectaron hotspots de interferencia con el umbral actual.',
        topRecommendation: 'Reducir el umbral de detección o cargar datos PRB adicionales.',
        quickWins: [],
      }
      return new Response(JSON.stringify(emptyOutput), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    // Build stats
    const stats: ScoutOutput['stats'] = {
      totalCellsScanned,
      cellsWithPrbData,
      hotspotCount: hotspots.length,
      criticalCount: hotspots.filter(h => h.severity === 'CRITICAL').length,
      highCount: hotspots.filter(h => h.severity === 'HIGH').length,
      mediumCount: hotspots.filter(h => h.severity === 'MEDIUM').length,
    }

    // Build context for LLM (top 15 hotspots only to fit token budget)
    const topHotspots = hotspots.slice(0, 15)
    const hotspotSummary = topHotspots.map(h =>
      `- ${h.cellId} (${h.siteName}, ${h.region}) | ${h.tech} ${h.band ?? ''} | Score: ${(h.score * 100).toFixed(0)}% | Fuente: ${h.primarySourceType} | Severity: ${h.severity} | Acción rápida: ${h.quickAction}`
    ).join('\n')

    const userMessage = `Red escaneada: ${totalCellsScanned} celdas totales, ${cellsWithPrbData} con datos PRB.
Hotspots detectados: ${hotspots.length} (${stats.criticalCount} CRÍTICOS, ${stats.highCount} ALTOS, ${stats.mediumCount} MEDIOS).

Top hotspots por severidad:
${hotspotSummary}

Genera el JSON de resumen ejecutivo.`

    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: SCOUT_SYSTEM,
      messages: [{ role: 'user', content: userMessage }],
    })

    const rawText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')

    let parsed: { executiveSummary: string; topRecommendation: string; quickWins: string[] }
    try {
      // Strip markdown code blocks if present
      const clean = rawText.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
      parsed = JSON.parse(clean)
    } catch {
      // Fallback if JSON parse fails
      parsed = {
        executiveSummary: `Se detectaron ${hotspots.length} hotspots de interferencia. ${stats.criticalCount} celdas críticas requieren atención inmediata.`,
        topRecommendation: `Priorizar la celda ${hotspots[0].cellId} (Score ${(hotspots[0].score * 100).toFixed(0)}%): ${hotspots[0].quickAction}`,
        quickWins: hotspots.slice(0, 3).map(h => `${h.cellId}: ${h.quickAction}`),
      }
    }

    const output: ScoutOutput = {
      hotspots,
      stats,
      executiveSummary: parsed.executiveSummary,
      topRecommendation: parsed.topRecommendation,
      quickWins: parsed.quickWins ?? [],
    }

    return new Response(JSON.stringify(output), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error desconocido'
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
}
