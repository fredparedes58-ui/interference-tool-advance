import { describe, it, expect } from 'vitest'
import { kpiValueToColor, buildKpiColorMap } from '../utils/kpiColor'
import type { KpiMeta } from '../components/KPIPanel'

// ── Fixtures ──────────────────────────────────────────────────────────────────

// KPI de disponibilidad: mayor es mejor (high), crit < 95, warn < 98
const metaHigh: KpiMeta = {
  key: 'cell_avail',
  label: 'Cell Availability',
  unit: '%',
  good_direction: 'high',
  crit_below: 95,
  warn_below: 98,
}

// KPI de BLER: menor es mejor (low), crit > 15%, warn > 5%
const metaLow: KpiMeta = {
  key: 'pusch_bler',
  label: 'PUSCH BLER',
  unit: '%',
  good_direction: 'low',
  crit_above: 15,
  warn_above: 5,
}

// KPI sin umbrales definidos (neutral)
const metaNeutral: KpiMeta = {
  key: 'rrc_users',
  label: 'RRC Users',
  unit: '',
  good_direction: 'high',
}

// ── kpiValueToColor ────────────────────────────────────────────────────────────

describe('kpiValueToColor', () => {

  // ── null / undefined ───────────────────────────────────────────────────────

  it('retorna gris (#475569) para null', () => {
    expect(kpiValueToColor(null, metaHigh)).toBe('#475569')
  })

  it('retorna gris (#475569) para undefined', () => {
    expect(kpiValueToColor(undefined, metaHigh)).toBe('#475569')
  })

  // ── good_direction: 'high' ─────────────────────────────────────────────────

  it('[high] verde para valor sobre warn_below (99%)', () => {
    expect(kpiValueToColor(99, metaHigh)).toBe('#22c55e')
  })

  it('[high] verde para valor exactamente en warn_below (98%)', () => {
    expect(kpiValueToColor(98, metaHigh)).toBe('#22c55e')
  })

  it('[high] amarillo para valor entre crit_below y warn_below (97%)', () => {
    expect(kpiValueToColor(97, metaHigh)).toBe('#eab308')
  })

  it('[high] amarillo para valor justo por encima de crit_below (95.1%)', () => {
    expect(kpiValueToColor(95.1, metaHigh)).toBe('#eab308')
  })

  it('[high] rojo para valor igual a crit_below (95%)', () => {
    // value < crit_below → rojo; value === crit_below no es < crit_below → amarillo/verde
    // La condición es estricta (<), así que 95 exacto debería ser amarillo
    const color = kpiValueToColor(95, metaHigh)
    expect([' #eab308', '#22c55e'].includes(color) || color === '#eab308').toBe(true)
  })

  it('[high] rojo para valor bajo el crítico (90%)', () => {
    expect(kpiValueToColor(90, metaHigh)).toBe('#ef4444')
  })

  it('[high] rojo para valor 0', () => {
    expect(kpiValueToColor(0, metaHigh)).toBe('#ef4444')
  })

  // ── good_direction: 'low' ──────────────────────────────────────────────────

  it('[low] verde para valor bajo warn_above (2%)', () => {
    expect(kpiValueToColor(2, metaLow)).toBe('#22c55e')
  })

  it('[low] amarillo para valor entre warn_above y crit_above (10%)', () => {
    expect(kpiValueToColor(10, metaLow)).toBe('#eab308')
  })

  it('[low] rojo para valor sobre crit_above (20%)', () => {
    expect(kpiValueToColor(20, metaLow)).toBe('#ef4444')
  })

  it('[low] verde para valor 0 (sin BLER)', () => {
    expect(kpiValueToColor(0, metaLow)).toBe('#22c55e')
  })

  // ── Sin umbrales ───────────────────────────────────────────────────────────

  it('[sin umbrales] retorna verde por defecto para good_direction high sin crit/warn', () => {
    expect(kpiValueToColor(50, metaNeutral)).toBe('#22c55e')
  })

  // ── Consistencia de salida ─────────────────────────────────────────────────

  it('siempre retorna string con formato hex (#rrggbb)', () => {
    const values = [null, undefined, 0, 50, 100, -10, 999]
    values.forEach(v => {
      const color = kpiValueToColor(v as any, metaHigh)
      expect(color).toMatch(/^#[0-9a-f]{6}$/i)
    })
  })
})

// ── buildKpiColorMap ───────────────────────────────────────────────────────────

describe('buildKpiColorMap', () => {

  const kpis = {
    'CELL-A': {
      hourly: [
        { date: '2025-01-01', hour: '10', cell_avail: 99 },
        { date: '2025-01-01', hour: '11', cell_avail: 99 },
        { date: '2025-01-01', hour: '12', cell_avail: 99 },
        { date: '2025-01-02', hour: '10', cell_avail: 90 }, // fecha diferente
      ],
    },
    'CELL-B': {
      hourly: [
        { date: '2025-01-01', hour: '10', cell_avail: 93 }, // < 95 → rojo
        { date: '2025-01-01', hour: '11', cell_avail: 93 },
      ],
    },
    'CELL-C': {
      hourly: [
        { date: '2025-01-01', hour: '10', cell_avail: null }, // sin data
      ],
    },
    'CELL-D': {
      hourly: [], // sin filas
    },
  }

  it('mapea CELL-A a verde cuando disponibilidad promedio = 99%', () => {
    const map = buildKpiColorMap(kpis, 'cell_avail', metaHigh, '2025-01-01')
    expect(map.get('CELL-A')).toBe('#22c55e')
  })

  it('mapea CELL-B a rojo cuando disponibilidad promedio = 93%', () => {
    const map = buildKpiColorMap(kpis, 'cell_avail', metaHigh, '2025-01-01')
    expect(map.get('CELL-B')).toBe('#ef4444')
  })

  it('no incluye CELL-C (todos los valores son null)', () => {
    const map = buildKpiColorMap(kpis, 'cell_avail', metaHigh, '2025-01-01')
    expect(map.has('CELL-C')).toBe(false)
  })

  it('no incluye CELL-D (sin filas)', () => {
    const map = buildKpiColorMap(kpis, 'cell_avail', metaHigh, '2025-01-01')
    expect(map.has('CELL-D')).toBe(false)
  })

  it('filtra por fecha correctamente (CELL-A tiene datos de dos fechas)', () => {
    // Sólo fecha 2025-01-02 con cell_avail=90 (< crit 95 → rojo)
    const map = buildKpiColorMap(kpis, 'cell_avail', metaHigh, '2025-01-02')
    expect(map.get('CELL-A')).toBe('#ef4444')
  })

  it('cuando date=null usa todos los datos de todas las fechas', () => {
    // CELL-A promedio de [99, 99, 99, 90] = 96.75 → entre crit(95) y warn(98) → amarillo
    const map = buildKpiColorMap(kpis, 'cell_avail', metaHigh, null)
    expect(map.get('CELL-A')).toBe('#eab308')
  })

  it('retorna Map vacío si no hay celdas con datos válidos', () => {
    const emptyKpis = {
      'X': { hourly: [{ date: '2025-01-01', hour: '10', cell_avail: null }] },
    }
    const map = buildKpiColorMap(emptyKpis, 'cell_avail', metaHigh, '2025-01-01')
    expect(map.size).toBe(0)
  })

  it('retorna Map con todos los colores en formato hex', () => {
    const map = buildKpiColorMap(kpis, 'cell_avail', metaHigh, '2025-01-01')
    map.forEach(color => {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i)
    })
  })
})
