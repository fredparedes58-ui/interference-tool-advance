/**
 * networkScanner.ts — Deterministic Network Sweep Service
 *
 * Pure function: no LLM, no side effects, 100% reproducible.
 * Scans all cells with PRB data and scores them for interference.
 *
 * DETERMINISTIC SERVICE CONTRACT v1.0
 * Input:  topology (NormalizedTopology) + kpiData + threshold
 * Output: ScoutHotspot[] sorted by score descending
 * Errors: structured AgentError JSON (never throws)
 */

import { analyzeCell } from '../classify'
import type { NormalizedTopology } from '../types'
import type { KpiDataset } from '../components/KPIPanel'
import type { ScoutHotspot } from '../agents/contracts'

// ── Severity thresholds ───────────────────────────────────────────────────────

function scoreToSeverity(score: number): ScoutHotspot['severity'] {
  if (score >= 0.85) return 'CRITICAL'
  if (score >= 0.65) return 'HIGH'
  if (score >= 0.40) return 'MEDIUM'
  return 'LOW'
}

// ── Main deterministic sweep function ─────────────────────────────────────────

export type SweepResult = {
  ok: true
  hotspots: ScoutHotspot[]
  totalCellsScanned: number
  cellsWithPrbData: number
  durationMs: number
} | {
  ok: false
  error: string
  durationMs: number
}

export function sweepNetwork(
  topology: NormalizedTopology,
  _kpiData: KpiDataset | null,
  threshold = 0.3,
  maxResults = 50
): SweepResult {
  const t0 = performance.now()

  try {
    const allSites = topology.sites.map(s => ({
      id: s.id,
      lat: s.lat,
      lon: s.lon,
      cells: topology.cells.filter(c => c.siteId === s.id).map(c => c.id),
    }))

    const cellsWithPrb = topology.cells.filter(c => c.prbHistogram && c.bandNum)
    const hotspots: ScoutHotspot[] = []

    for (const cell of cellsWithPrb) {
      const site = topology.sites.find(s => s.id === cell.siteId)
      if (!site) continue

      let analysis
      try {
        analysis = analyzeCell({
          cellId: cell.id,
          bandNum: cell.bandNum!,
          bwMhz: cell.bwMhz ?? 10,
          siteLat: site.lat,
          siteLon: site.lon,
          prbHistogram: cell.prbHistogram!,
          trafficPerHour: cell.trafficPerHour ?? Array(24).fill(0.5),
          kpi: cell.kpi,
          allSites,
        })
      } catch {
        continue  // skip cells that fail classification
      }

      const primaryMatch = analysis.matches[0]
      if (!primaryMatch) continue

      const score = primaryMatch.confidence
      if (score < threshold) continue

      // Quick action = first CM mitigation, or first mitigation if none
      const cmAction = analysis.mitigations.find(m => m.type === 'CM')
      const quickAction = cmAction
        ? cmAction.title
        : (analysis.mitigations[0]?.title ?? 'Revisar configuración')

      hotspots.push({
        cellId: cell.id,
        siteId: cell.siteId,
        siteName: site.name,
        region: site.region ?? '',
        band: cell.band ?? null,
        tech: cell.tech,
        score,
        severity: scoreToSeverity(score),
        primarySourceType: analysis.primarySource,
        quickAction,
        lat: site.lat,
        lon: site.lon,
      })
    }

    hotspots.sort((a, b) => b.score - a.score)

    return {
      ok: true,
      hotspots: hotspots.slice(0, maxResults),
      totalCellsScanned: topology.cells.length,
      cellsWithPrbData: cellsWithPrb.length,
      durationMs: performance.now() - t0,
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error desconocido en sweep',
      durationMs: performance.now() - t0,
    }
  }
}
