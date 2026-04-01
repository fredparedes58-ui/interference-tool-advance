import type { KpiMeta } from '../components/KPIPanel'

/**
 * Map a KPI value to a hex color string based on its thresholds.
 * Returns green for good, yellow for warning, red for critical, grey for null.
 */
export function kpiValueToColor(value: number | null | undefined, meta: KpiMeta): string {
  if (value == null) return '#475569' // slate-600 — no data
  if (meta.good_direction === 'high') {
    if (meta.crit_below != null && value < meta.crit_below) return '#ef4444'
    if (meta.warn_below != null && value < meta.warn_below) return '#eab308'
    return '#22c55e'
  }
  if (meta.good_direction === 'low') {
    if (meta.crit_above != null && value > meta.crit_above) return '#ef4444'
    if (meta.warn_above != null && value > meta.warn_above) return '#eab308'
    return '#22c55e'
  }
  return '#818cf8' // neutral KPIs get indigo
}

/**
 * Build a Map<cellId, color> from kpiData for a given KPI key and date.
 * Uses the daily average of each cell's hourly rows.
 */
export function buildKpiColorMap(
  kpis: Record<string, { hourly: Record<string, number | string | null>[] }>,
  kpiKey: string,
  meta: KpiMeta,
  date: string | null,
): Map<string, string> {
  const result = new Map<string, string>()
  for (const [cellId, cellData] of Object.entries(kpis)) {
    const rows = date
      ? cellData.hourly.filter(r => r.date === date)
      : cellData.hourly
    const vals = rows.map(r => r[kpiKey]).filter(v => v != null && typeof v === 'number') as number[]
    if (vals.length === 0) continue
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length
    result.set(cellId, kpiValueToColor(avg, meta))
  }
  return result
}
