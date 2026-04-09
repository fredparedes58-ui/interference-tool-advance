/**
 * useInvestigator.ts — Investigator Agent React Hook
 *
 * Manages the full multi-turn tool use loop for deep RCA:
 *  1. POST /api/investigate → if tool_calls → execute client-side → repeat
 *  2. When { type: 'report' } → return structured InvestigatorOutput
 *
 * Follows the same pattern as ChatBot.tsx multi-turn loop.
 */

import { useCallback, useState } from 'react'
import { useToolExecutor } from './useToolExecutor'
import type { NormalizedTopology, InterferenceIssue, SiteForAnalysis } from '../types'
import type { KpiDataset } from '../components/KPIPanel'
import type { InvestigatorInput, InvestigatorOutput } from '../agents/contracts'

// Anthropic API message format (without SDK import on client)
type ApiContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string }

type ApiMessage = {
  role: 'user' | 'assistant'
  content: string | ApiContentBlock[]
}

const MAX_TOOL_CALLS = 5

export type InvestigatorStatus = 'idle' | 'gathering' | 'analyzing' | 'done' | 'error'

export type InvestigatorState = {
  status: InvestigatorStatus
  toolStatus: string | null    // "Consultando: get_kpi_data, find_nearby_cells"
  toolCallCount: number
  output: InvestigatorOutput | null
  error: string | null
}

type Deps = {
  topology: NormalizedTopology
  kpiData: KpiDataset | null
  interferenceIssues: InterferenceIssue[]
  allSitesForAnalysis: SiteForAnalysis[]
}

export function useInvestigator(deps: Deps) {
  const [state, setState] = useState<InvestigatorState>({
    status: 'idle',
    toolStatus: null,
    toolCallCount: 0,
    output: null,
    error: null,
  })

  const { executeToolCall } = useToolExecutor(deps)

  const investigate = useCallback(async (cellId: string, depth: InvestigatorInput['depth'] = 'full') => {
    setState({ status: 'gathering', toolStatus: null, toolCallCount: 0, output: null, error: null })

    const apiMessages: ApiMessage[] = []
    let toolCallCount = 0

    for (;;) {
      let res: Response
      try {
        res = await fetch('/api/investigate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cellId,
            depth,
            messages: apiMessages.length > 0 ? apiMessages : undefined,
          }),
        })
      } catch {
        setState(prev => ({ ...prev, status: 'error', error: 'No se pudo conectar con el agente.', toolStatus: null }))
        return
      }

      if (!res.ok) {
        try {
          const errJson = await res.json() as { error?: string }
          setState(prev => ({ ...prev, status: 'error', error: errJson.error ?? 'Error del servidor', toolStatus: null }))
        } catch {
          setState(prev => ({ ...prev, status: 'error', error: 'Error del servidor', toolStatus: null }))
        }
        return
      }

      let json: {
        type: 'tool_calls' | 'report'
        toolCalls?: Array<{ id: string; name: string; input: unknown }>
        assistantContent?: ApiContentBlock[]
        data?: InvestigatorOutput
      }
      try {
        json = await res.json()
      } catch {
        setState(prev => ({ ...prev, status: 'error', error: 'Respuesta inválida del agente', toolStatus: null }))
        return
      }

      // ── Tool calls branch ──────────────────────────────────────────────────
      if (json.type === 'tool_calls' && json.toolCalls && json.assistantContent) {
        if (toolCallCount >= MAX_TOOL_CALLS) {
          setState(prev => ({ ...prev, status: 'error', error: 'Límite de herramientas alcanzado.', toolStatus: null }))
          return
        }

        // Add assistant tool_use blocks to history
        apiMessages.push({ role: 'assistant', content: json.assistantContent })

        const toolNames = json.toolCalls.map(tc => tc.name.replace(/_/g, ' ')).join(', ')
        setState(prev => ({
          ...prev,
          status: 'gathering',
          toolStatus: `Consultando: ${toolNames}`,
          toolCallCount: toolCallCount + 1,
        }))

        // Execute tools client-side
        const toolResults: ApiContentBlock[] = await Promise.all(
          json.toolCalls.map(async (tc) => ({
            type: 'tool_result' as const,
            tool_use_id: tc.id,
            content: await executeToolCall({ id: tc.id, name: tc.name, input: tc.input }),
          }))
        )

        apiMessages.push({ role: 'user', content: toolResults })
        toolCallCount++
        continue
      }

      // ── Final report ───────────────────────────────────────────────────────
      if (json.type === 'report' && json.data) {
        setState({
          status: 'done',
          toolStatus: null,
          toolCallCount,
          output: json.data,
          error: null,
        })
        return
      }

      setState(prev => ({ ...prev, status: 'error', error: 'Respuesta inesperada del agente', toolStatus: null }))
      return
    }
  }, [executeToolCall])

  const reset = useCallback(() => {
    setState({ status: 'idle', toolStatus: null, toolCallCount: 0, output: null, error: null })
  }, [])

  return { ...state, investigate, reset }
}
