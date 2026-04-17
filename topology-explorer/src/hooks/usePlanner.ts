/**
 * usePlanner.ts — Planner Agent React Hook
 *
 * Manages the multi-turn tool use loop for action plan generation:
 *  1. POST /api/plan → if tool_calls → execute client-side → repeat
 *  2. When { type: 'plan' } → return structured PlannerOutput
 */

import { useCallback, useState } from 'react'
import { useToolExecutor } from './useToolExecutor'
import type { NormalizedTopology, InterferenceIssue, SiteForAnalysis } from '../types'
import type { KpiDataset } from '../components/KPIPanel'
import type { PlannerInput, PlannerOutput } from '../agents/contracts'

type ApiContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string }

type ApiMessage = {
  role: 'user' | 'assistant'
  content: string | ApiContentBlock[]
}

const MAX_TOOL_CALLS = 5

export type PlannerStatus = 'idle' | 'planning' | 'done' | 'error'

export type PlannerState = {
  status: PlannerStatus
  toolStatus: string | null
  output: PlannerOutput | null
  error: string | null
}

type Deps = {
  topology: NormalizedTopology
  kpiData: KpiDataset | null
  interferenceIssues: InterferenceIssue[]
  allSitesForAnalysis: SiteForAnalysis[]
}

export function usePlanner(deps: Deps) {
  const [state, setState] = useState<PlannerState>({
    status: 'idle',
    toolStatus: null,
    output: null,
    error: null,
  })

  const { executeToolCall } = useToolExecutor(deps)

  const generatePlan = useCallback(async (
    constraint: PlannerInput['constraint'] = 'all',
    horizon: PlannerInput['horizon'] = 'month'
  ) => {
    setState({ status: 'planning', toolStatus: null, output: null, error: null })

    const apiMessages: ApiMessage[] = []
    let toolCallCount = 0

    for (;;) {
      let res: Response
      try {
        res = await fetch('/api/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            constraint,
            horizon,
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
        type: 'tool_calls' | 'plan'
        toolCalls?: Array<{ id: string; name: string; input: unknown }>
        assistantContent?: ApiContentBlock[]
        data?: PlannerOutput
      }
      try {
        json = await res.json()
      } catch {
        setState(prev => ({ ...prev, status: 'error', error: 'Respuesta inválida del agente', toolStatus: null }))
        return
      }

      if (json.type === 'tool_calls' && json.toolCalls && json.assistantContent) {
        if (toolCallCount >= MAX_TOOL_CALLS) {
          setState(prev => ({ ...prev, status: 'error', error: 'Límite de herramientas alcanzado.', toolStatus: null }))
          return
        }

        apiMessages.push({ role: 'assistant', content: json.assistantContent })

        const toolNames = json.toolCalls.map(tc => tc.name.replace(/_/g, ' ')).join(', ')
        setState(prev => ({ ...prev, toolStatus: `Consultando: ${toolNames}` }))

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

      if (json.type === 'plan' && json.data) {
        setState({ status: 'done', toolStatus: null, output: json.data, error: null })
        return
      }

      setState(prev => ({ ...prev, status: 'error', error: 'Respuesta inesperada del agente', toolStatus: null }))
      return
    }
  }, [executeToolCall])

  const reset = useCallback(() => {
    setState({ status: 'idle', toolStatus: null, output: null, error: null })
  }, [])

  return { ...state, generatePlan, reset }
}
