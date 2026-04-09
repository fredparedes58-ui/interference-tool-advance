/**
 * useScout.ts — Scout Agent React Hook
 *
 * Orchestrates the full Scout flow:
 *  1. sweepNetwork() — deterministic, client-side (no API)
 *  2. POST /api/scout — LLM executive summary
 *  3. Returns ScoutOutput for rendering
 */

import { useCallback, useState } from 'react'
import { sweepNetwork } from '../services/networkScanner'
import type { NormalizedTopology } from '../types'
import type { KpiDataset } from '../components/KPIPanel'
import type { ScoutOutput } from '../agents/contracts'

export type ScoutStatus = 'idle' | 'scanning' | 'summarizing' | 'done' | 'error'

export type ScoutState = {
  status: ScoutStatus
  output: ScoutOutput | null
  error: string | null
  /** Duration of deterministic scan in ms */
  scanDurationMs: number | null
}

export function useScout(topology: NormalizedTopology, kpiData: KpiDataset | null) {
  const [state, setState] = useState<ScoutState>({
    status: 'idle',
    output: null,
    error: null,
    scanDurationMs: null,
  })

  const runScan = useCallback(async (threshold = 0.3) => {
    setState({ status: 'scanning', output: null, error: null, scanDurationMs: null })

    // ── Step 1: Deterministic scan (client-side, instant) ─────────────────────
    const scanResult = sweepNetwork(topology, kpiData, threshold)

    if (!scanResult.ok) {
      setState({
        status: 'error',
        output: null,
        error: `Error en el scan: ${scanResult.error}`,
        scanDurationMs: scanResult.durationMs,
      })
      return
    }

    setState(prev => ({
      ...prev,
      status: 'summarizing',
      scanDurationMs: scanResult.durationMs,
    }))

    // ── Step 2: LLM executive summary ─────────────────────────────────────────
    try {
      const res = await fetch('/api/scout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hotspots: scanResult.hotspots,
          totalCellsScanned: scanResult.totalCellsScanned,
          cellsWithPrbData: scanResult.cellsWithPrbData,
        }),
      })

      if (!res.ok) {
        throw new Error(`API error: ${res.status}`)
      }

      const output = await res.json() as ScoutOutput

      setState({
        status: 'done',
        output,
        error: null,
        scanDurationMs: scanResult.durationMs,
      })
    } catch (err) {
      // If LLM summary fails, return deterministic results with simple summary
      const fallbackOutput: ScoutOutput = {
        hotspots: scanResult.hotspots,
        stats: {
          totalCellsScanned: scanResult.totalCellsScanned,
          cellsWithPrbData: scanResult.cellsWithPrbData,
          hotspotCount: scanResult.hotspots.length,
          criticalCount: scanResult.hotspots.filter(h => h.severity === 'CRITICAL').length,
          highCount: scanResult.hotspots.filter(h => h.severity === 'HIGH').length,
          mediumCount: scanResult.hotspots.filter(h => h.severity === 'MEDIUM').length,
        },
        executiveSummary: `Se detectaron ${scanResult.hotspots.length} hotspots en ${scanResult.totalCellsScanned} celdas escaneadas.`,
        topRecommendation: scanResult.hotspots[0]
          ? `Atender celda ${scanResult.hotspots[0].cellId}: ${scanResult.hotspots[0].quickAction}`
          : 'Sin hotspots detectados con el umbral actual.',
        quickWins: scanResult.hotspots.slice(0, 3).map(h => `${h.cellId}: ${h.quickAction}`),
      }

      setState({
        status: 'done',
        output: fallbackOutput,
        error: null,
        scanDurationMs: scanResult.durationMs,
      })

      console.warn('Scout LLM summary failed, using fallback:', err)
    }
  }, [topology, kpiData])

  const reset = useCallback(() => {
    setState({ status: 'idle', output: null, error: null, scanDurationMs: null })
  }, [])

  return { ...state, runScan, reset }
}
