import { useCallback } from 'react'
import { analyzeCell, calcFmHarmonicsInBand, haversineKm } from '../classify'
import type { NormalizedTopology, InterferenceIssue, SiteForAnalysis } from '../types'
import type { KpiDataset } from '../components/KPIPanel'

// ── Tool input types (match api/chat.ts HUNTER_TOOLS schemas) ────────────────

type AnalyzeCellInput     = { cellId: string }
type GetKpiDataInput      = { cellId: string; date?: string; kpiKeys?: string[] }
type CalcFmHarmonicsInput = { fmFreqMhz: number; bandNum: number }
type FindNearbyCellsInput = { cellId: string; radiusKm: number }
type GetTopIssuesInput    = { limit?: number; minScore?: number }
type GetCellInfoInput     = { cellId: string }

// ── Tool call shape coming from the API ──────────────────────────────────────

export type ToolCall = {
  id: string
  name: string
  input: unknown
}

// ── Hook deps ─────────────────────────────────────────────────────────────────

export type ToolExecutorDeps = {
  topology: NormalizedTopology
  kpiData: KpiDataset | null
  interferenceIssues: InterferenceIssue[]
  allSitesForAnalysis: SiteForAnalysis[]
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useToolExecutor(deps: ToolExecutorDeps) {
  const executeToolCall = useCallback(
    async (toolCall: ToolCall): Promise<string> => {
      const { name, input } = toolCall
      try {
        switch (name) {

          // ── T1: analyze_cell ───────────────────────────────────────────────
          case 'analyze_cell': {
            const { cellId } = input as AnalyzeCellInput
            const cell = deps.topology.cells.find(c => c.id === cellId)
            if (!cell) return JSON.stringify({ error: `Celda ${cellId} no encontrada en la topología cargada.` })
            if (!cell.prbHistogram || !cell.bandNum) return JSON.stringify({ error: `Celda ${cellId} no tiene datos PRB. Asegúrate de cargar una topología con prbHistogram.` })
            const site = deps.topology.sites.find(s => s.id === cell.siteId)
            if (!site) return JSON.stringify({ error: `Site ${cell.siteId} no encontrado.` })
            const analysis = analyzeCell({
              cellId: cell.id,
              bandNum: cell.bandNum,
              bwMhz: cell.bwMhz ?? 10,
              siteLat: site.lat,
              siteLon: site.lon,
              prbHistogram: cell.prbHistogram,
              trafficPerHour: cell.trafficPerHour ?? Array(24).fill(0.5),
              kpi: cell.kpi,
              allSites: deps.allSitesForAnalysis,
            })
            return JSON.stringify(analysis)
          }

          // ── T2: get_kpi_data ───────────────────────────────────────────────
          case 'get_kpi_data': {
            const { cellId, date, kpiKeys } = input as GetKpiDataInput
            if (!deps.kpiData) return JSON.stringify({ error: 'No hay KPI data cargada. Usa el botón KPI para subir un archivo kpi_data.json.' })
            const cellData = deps.kpiData.kpis[cellId]
            if (!cellData) return JSON.stringify({ error: `Sin datos KPI para la celda ${cellId}.` })
            const dates = [...new Set(cellData.hourly.map(r => r.date as string))].sort()
            const targetDate = date ?? dates[dates.length - 1]
            const rows = cellData.hourly.filter(r => r.date === targetDate)
            const hourly = kpiKeys
              ? rows.map(r => {
                  const out: Record<string, unknown> = { hora: r.hora, date: r.date }
                  kpiKeys.forEach(k => { out[k] = r[k] })
                  return out
                })
              : rows
            return JSON.stringify({
              cellId,
              date: targetDate,
              availableDates: dates,
              hourly,
              meta: deps.kpiData.kpi_meta.map(m => ({
                key: m.key, label: m.label, unit: m.unit,
                good_direction: m.good_direction,
                warn_below: m.warn_below, crit_below: m.crit_below,
                warn_above: m.warn_above, crit_above: m.crit_above,
              })),
            })
          }

          // ── T3: calculate_fm_harmonics ─────────────────────────────────────
          case 'calculate_fm_harmonics': {
            const { fmFreqMhz, bandNum } = input as CalcFmHarmonicsInput
            if (fmFreqMhz < 87 || fmFreqMhz > 108) return JSON.stringify({ error: `Frecuencia FM ${fmFreqMhz} MHz fuera del rango estándar (87–108 MHz).` })
            const harmonics = calcFmHarmonicsInBand(fmFreqMhz, bandNum)
            return JSON.stringify({
              fmFreqMhz,
              bandNum,
              harmonicsInBand: harmonics,
              totalFound: harmonics.length,
              note: harmonics.length === 0
                ? `Ningún armónico de ${fmFreqMhz} MHz (órdenes 2–12) cae en la UL de B${bandNum}.`
                : `${harmonics.length} armónico(s) detectados en la UL de B${bandNum}.`,
            })
          }

          // ── T4: find_nearby_cells ──────────────────────────────────────────
          case 'find_nearby_cells': {
            const { cellId, radiusKm } = input as FindNearbyCellsInput
            const refCell = deps.topology.cells.find(c => c.id === cellId)
            if (!refCell) return JSON.stringify({ error: `Celda ${cellId} no encontrada.` })
            const refSite = deps.topology.sites.find(s => s.id === refCell.siteId)
            if (!refSite) return JSON.stringify({ error: `Site de la celda ${cellId} no encontrado.` })
            const safeRadius = Math.min(radiusKm, 50)
            const nearby = deps.topology.cells
              .filter(c => c.id !== cellId)
              .map(c => {
                const site = deps.topology.sites.find(s => s.id === c.siteId)
                if (!site) return null
                const dist = haversineKm(refSite.lat, refSite.lon, site.lat, site.lon)
                if (dist > safeRadius) return null
                return {
                  cellId: c.id,
                  siteId: c.siteId,
                  siteName: site.name,
                  region: site.region ?? null,
                  distanceKm: +dist.toFixed(3),
                  tech: c.tech,
                  band: c.band ?? null,
                  vendor: c.vendor ?? null,
                  hasPrbData: !!c.prbHistogram,
                }
              })
              .filter((x): x is NonNullable<typeof x> => x !== null)
              .sort((a, b) => a.distanceKm - b.distanceKm)
            return JSON.stringify({
              reference: cellId,
              referenceLocation: { lat: refSite.lat, lon: refSite.lon },
              radiusKm: safeRadius,
              count: nearby.length,
              cells: nearby,
            })
          }

          // ── T5: get_top_interference_issues ───────────────────────────────
          case 'get_top_interference_issues': {
            const { limit = 10, minScore = 0 } = input as GetTopIssuesInput
            const safeLimit = Math.min(limit, 50)
            const filtered = deps.interferenceIssues
              .filter(i => i.score >= minScore)
              .slice(0, safeLimit)
            return JSON.stringify({
              totalIssues: deps.interferenceIssues.length,
              returned: filtered.length,
              filters: { minScore, limit: safeLimit },
              issues: filtered,
            })
          }

          // ── T6: get_cell_info ──────────────────────────────────────────────
          case 'get_cell_info': {
            const { cellId } = input as GetCellInfoInput
            const cell = deps.topology.cells.find(c => c.id === cellId)
            if (!cell) return JSON.stringify({ error: `Celda ${cellId} no encontrada en la topología cargada.` })
            const site = deps.topology.sites.find(s => s.id === cell.siteId)
            return JSON.stringify({
              cellId: cell.id,
              siteId: cell.siteId,
              siteName: site?.name ?? null,
              region: site?.region ?? null,
              city: site?.city ?? null,
              lat: site?.lat ?? null,
              lon: site?.lon ?? null,
              tech: cell.tech,
              band: cell.band ?? null,
              bandNum: cell.bandNum ?? null,
              bwMhz: cell.bwMhz ?? null,
              vendor: cell.vendor ?? null,
              azimuth: cell.azimuth ?? null,
              tilt: cell.tilt ?? null,
              pci: cell.pci ?? null,
              earfcn: cell.earfcn ?? null,
              hasPrbHistogram: !!cell.prbHistogram,
              kpi: cell.kpi ?? null,
              cm: cell.cm ?? null,
            })
          }

          default:
            return JSON.stringify({ error: `Tool desconocido: ${name}` })
        }
      } catch (err) {
        return JSON.stringify({ error: `Error ejecutando ${name}: ${err instanceof Error ? err.message : String(err)}` })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deps.topology, deps.kpiData, deps.interferenceIssues, deps.allSitesForAnalysis],
  )

  return { executeToolCall }
}
