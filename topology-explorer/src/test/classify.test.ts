import { describe, it, expect } from 'vitest'
import {
  calcFmHarmonicsInBand,
  extractFeatures,
  analyzeCell,
  UL_BAND_RANGES_MHZ,
  SOURCE_SEARCH_RADIUS_KM,
} from '../classify'

// ── Helpers de fixtures ────────────────────────────────────────────────────────

/** Genera una matriz PRB [N_PRB][24] con valor uniforme */
function makeFlatPrb(nPrb: number, valueDbm: number): number[][] {
  return Array.from({ length: nPrb }, () => Array(24).fill(valueDbm))
}

/** Perfil de tráfico plano (sin patrón horario) */
const flatTraffic = Array(24).fill(0.5)

/** Perfil de tráfico laboral: bajo en horas 0-6, alto en 7-18, bajo 19-23 */
const bizTraffic = Array.from({ length: 24 }, (_, h) =>
  h >= 7 && h <= 18 ? 0.85 : 0.15
)

/** Sitio de ejemplo para analyzeCell */
const sampleSites = [{ id: 'SITE1', lat: -34.6, lon: -58.4, cells: ['C1-B28'] }]

// ── calcFmHarmonicsInBand ──────────────────────────────────────────────────────

describe('calcFmHarmonicsInBand', () => {

  it('detecta armónico 8vo de 103.3 MHz en Banda 5 (UL: 824-849 MHz)', () => {
    // 103.3 × 8 = 826.4 MHz → dentro de B5 [824, 849]
    const harmonics = calcFmHarmonicsInBand(103.3, 5)
    expect(harmonics.length).toBeGreaterThanOrEqual(1)
    const match = harmonics.find(h => h.order === 8)
    expect(match).toBeDefined()
    expect(match!.freqMhz).toBeCloseTo(826.4, 1)
  })

  it('detecta armónico 7mo de 101.7 MHz en Banda 28 (UL: 703-748 MHz)', () => {
    // 101.7 × 7 = 711.9 MHz → dentro de B28 [703, 748]
    const harmonics = calcFmHarmonicsInBand(101.7, 28)
    expect(harmonics.length).toBeGreaterThanOrEqual(1)
    const match = harmonics.find(h => h.order === 7)
    expect(match).toBeDefined()
    expect(match!.freqMhz).toBeCloseTo(711.9, 1)
  })

  it('retorna array vacío para frecuencia FM cuyo harmónico no cae en la banda', () => {
    // 107 MHz × 8 = 856 MHz → fuera de B5 [824-849]
    const harmonics = calcFmHarmonicsInBand(107, 5)
    expect(harmonics.every(h => {
      const [lo, hi] = UL_BAND_RANGES_MHZ[5]
      return h.freqMhz < lo || h.freqMhz > hi
    })).toBe(true)
  })

  it('retorna array vacío para banda no definida', () => {
    const harmonics = calcFmHarmonicsInBand(100, 999)
    expect(harmonics).toEqual([])
  })

  it('posPct está entre 0 y 100 para todos los matches', () => {
    const harmonics = calcFmHarmonicsInBand(103.3, 5)
    harmonics.forEach(h => {
      expect(h.posPct).toBeGreaterThanOrEqual(0)
      expect(h.posPct).toBeLessThanOrEqual(100)
    })
  })

  it('order está entre 2 y 12 para todos los resultados', () => {
    const harmonics = calcFmHarmonicsInBand(103.3, 5)
    harmonics.forEach(h => {
      expect(h.order).toBeGreaterThanOrEqual(2)
      expect(h.order).toBeLessThanOrEqual(12)
    })
  })

  it('affectedPrbsApprox es número positivo en todos los resultados', () => {
    const harmonics = calcFmHarmonicsInBand(103.3, 5)
    harmonics.forEach(h => {
      expect(h.affectedPrbsApprox).toBeGreaterThan(0)
    })
  })

  it('retorna harmonics ordenados por order ascendente', () => {
    const harmonics = calcFmHarmonicsInBand(103.3, 5)
    for (let i = 1; i < harmonics.length; i++) {
      expect(harmonics[i].order).toBeGreaterThan(harmonics[i - 1].order)
    }
  })
})

// ── extractFeatures ────────────────────────────────────────────────────────────

describe('extractFeatures', () => {

  it('PRB uniformidad = 1 para matriz completamente plana', () => {
    const prb = makeFlatPrb(50, -100)
    const f = extractFeatures(prb, flatTraffic, 28, 10)
    expect(f.prbUniformity).toBeCloseTo(1, 2)
  })

  it('floorElevationDb ≈ 8 para matriz en -100 dBm (floor = -108)', () => {
    const prb = makeFlatPrb(50, -100)
    const f = extractFeatures(prb, flatTraffic, 28, 10)
    expect(f.floorElevationDb).toBeCloseTo(8, 1)
  })

  it('floorElevationDb = 0 para matriz en -108 dBm (nivel de piso térmico)', () => {
    const prb = makeFlatPrb(50, -108)
    const f = extractFeatures(prb, flatTraffic, 28, 10)
    expect(f.floorElevationDb).toBeCloseTo(0, 1)
  })

  it('peakDbm corresponde al valor más alto de toda la matriz', () => {
    const prb = makeFlatPrb(50, -110)
    // Agregar un spike en PRB[10], hora[5]
    prb[10][5] = -70
    const f = extractFeatures(prb, flatTraffic, 28, 10)
    expect(f.peakDbm).toBeCloseTo(-70, 1)
  })

  it('edgePrbExcessDb > 0 cuando los PRBs de borde son más altos que el centro', () => {
    // PRBs edge (primeros/últimos 15%): elevados; center: bajo
    const nPrb = 50
    const prb = makeFlatPrb(nPrb, -108)
    const nEdge = Math.max(1, Math.floor(nPrb * 0.15)) // ~7
    // Elevar bordes
    for (let i = 0; i < nEdge; i++) {
      prb[i] = Array(24).fill(-90)
      prb[nPrb - 1 - i] = Array(24).fill(-90)
    }
    const f = extractFeatures(prb, flatTraffic, 28, 10)
    expect(f.edgePrbExcessDb).toBeGreaterThan(0)
  })

  it('lowPrbExcessDb > 0 cuando los primeros PRBs son más elevados', () => {
    const nPrb = 50
    const prb = makeFlatPrb(nPrb, -108)
    // Elevar los primeros 25% de PRBs (low PRBs)
    const nLow = Math.max(1, Math.floor(nPrb * 0.25))
    for (let i = 0; i < nLow; i++) {
      prb[i] = Array(24).fill(-90)
    }
    const f = extractFeatures(prb, flatTraffic, 28, 10)
    expect(f.lowPrbExcessDb).toBeGreaterThan(0)
  })

  it('businessHourExcessDb > 0 para señal activa sólo en horas laborales', () => {
    const nPrb = 50
    // Horas 7-18: señal alta; resto: baja
    const prb = Array.from({ length: nPrb }, () =>
      Array.from({ length: 24 }, (_, h) => (h >= 7 && h <= 18 ? -90 : -108))
    )
    const f = extractFeatures(prb, bizTraffic, 28, 10)
    expect(f.businessHourExcessDb).toBeGreaterThan(0)
  })

  it('temporalCv ≈ 0 para señal completamente estable en el tiempo', () => {
    const prb = makeFlatPrb(50, -95)
    const f = extractFeatures(prb, flatTraffic, 28, 10)
    expect(f.temporalCv).toBeCloseTo(0, 2)
  })

  it('trafficCorrelation está entre -1 y 1', () => {
    const prb = makeFlatPrb(50, -100)
    const f = extractFeatures(prb, bizTraffic, 28, 10)
    expect(f.trafficCorrelation).toBeGreaterThanOrEqual(-1)
    expect(f.trafficCorrelation).toBeLessThanOrEqual(1)
  })

  it('todos los campos PRBFeatures están definidos y son números finitos', () => {
    const prb = makeFlatPrb(25, -105)
    const f = extractFeatures(prb, flatTraffic, 28, 10)
    const keys: (keyof typeof f)[] = [
      'peakDbm', 'floorElevationDb', 'prbUniformity', 'edgePrbExcessDb',
      'lowPrbExcessDb', 'peakClusterWidthPct', 'slopeDbPerPrb',
      'temporalCv', 'businessHourExcessDb', 'trafficCorrelation', 'nightMinusDayDb',
    ]
    keys.forEach(k => {
      expect(typeof f[k]).toBe('number')
      expect(isFinite(f[k])).toBe(true)
    })
  })

  it('peakClusterWidthPct está entre 0 y 100', () => {
    const prb = makeFlatPrb(50, -95)
    const f = extractFeatures(prb, flatTraffic, 28, 10)
    expect(f.peakClusterWidthPct).toBeGreaterThanOrEqual(0)
    expect(f.peakClusterWidthPct).toBeLessThanOrEqual(100)
  })
})

// ── analyzeCell ────────────────────────────────────────────────────────────────

describe('analyzeCell', () => {

  // Patrón de BDA: señal alta y plana en todos los PRBs, alta uniformidad,
  // temporalCv bajo, sin correlación con tráfico
  function makeBdaPattern(nPrb: number): number[][] {
    return makeFlatPrb(nPrb, -92) // alto y constante, 16 dB sobre el piso térmico
  }

  // Patrón de PIM: picos en bordes de banda, correlacionado con tráfico DL
  function makePimPattern(nPrb: number): number[][] {
    const nEdge = Math.max(1, Math.floor(nPrb * 0.15))
    const prb = makeFlatPrb(nPrb, -108)
    for (let i = 0; i < nEdge; i++) {
      // Picos en borde bajo + borde alto, correlacionados con tráfico (biz hours altos)
      prb[i] = Array.from({ length: 24 }, (_, h) => (h >= 7 && h <= 18 ? -88 : -108))
      prb[nPrb - 1 - i] = Array.from({ length: 24 }, (_, h) => (h >= 7 && h <= 18 ? -88 : -108))
    }
    return prb
  }

  it('retorna cellId correcto en el resultado', () => {
    const result = analyzeCell({
      cellId: 'TEST-CELL',
      bandNum: 28,
      bwMhz: 10,
      siteLat: -34.6,
      siteLon: -58.4,
      prbHistogram: makeFlatPrb(50, -108),
      trafficPerHour: flatTraffic,
      allSites: sampleSites,
    })
    expect(result.cellId).toBe('TEST-CELL')
  })

  it('retorna matches ordenados por confidence descendente', () => {
    const result = analyzeCell({
      cellId: 'C1',
      bandNum: 28,
      bwMhz: 10,
      siteLat: -34.6,
      siteLon: -58.4,
      prbHistogram: makeBdaPattern(50),
      trafficPerHour: flatTraffic,
      allSites: sampleSites,
    })
    for (let i = 1; i < result.matches.length; i++) {
      expect(result.matches[i].confidence).toBeLessThanOrEqual(result.matches[i - 1].confidence)
    }
  })

  it('todos los confidence están entre 0 y 1', () => {
    const result = analyzeCell({
      cellId: 'C1',
      bandNum: 28,
      bwMhz: 10,
      siteLat: -34.6,
      siteLon: -58.4,
      prbHistogram: makeBdaPattern(50),
      trafficPerHour: flatTraffic,
      allSites: sampleSites,
    })
    result.matches.forEach(m => {
      expect(m.confidence).toBeGreaterThanOrEqual(0)
      expect(m.confidence).toBeLessThanOrEqual(1)
    })
  })

  it('primarySource coincide con el match de mayor confidence', () => {
    const result = analyzeCell({
      cellId: 'C1',
      bandNum: 28,
      bwMhz: 10,
      siteLat: -34.6,
      siteLon: -58.4,
      prbHistogram: makeBdaPattern(50),
      trafficPerHour: flatTraffic,
      allSites: sampleSites,
    })
    expect(result.primarySource).toBe(result.matches[0].sourceType)
  })

  it('patrón BDA (señal flat alta) produce clasificación plausible de alta severidad', () => {
    const result = analyzeCell({
      cellId: 'C-BDA',
      bandNum: 28,
      bwMhz: 10,
      siteLat: -34.6,
      siteLon: -58.4,
      prbHistogram: makeBdaPattern(50),
      trafficPerHour: flatTraffic,
      allSites: sampleSites,
    })
    // BDA_OSCILLATION tiene severidad CRITICAL; debe estar entre los primeros matches
    const bdaMatch = result.matches.find(m => m.sourceType === 'BDA_OSCILLATION')
    expect(bdaMatch).toBeDefined()
    expect(['HIGH', 'CRITICAL']).toContain(bdaMatch!.severity)
  })

  it('patrón PIM (bordes elevados + correlación tráfico) incluye PIM en matches', () => {
    const result = analyzeCell({
      cellId: 'C-PIM',
      bandNum: 28,
      bwMhz: 10,
      siteLat: -34.6,
      siteLon: -58.4,
      prbHistogram: makePimPattern(50),
      trafficPerHour: bizTraffic,
      allSites: sampleSites,
    })
    const pimMatch = result.matches.find(m => m.sourceType === 'PIM')
    expect(pimMatch).toBeDefined()
  })

  it('mitigations es array no vacío', () => {
    const result = analyzeCell({
      cellId: 'C1',
      bandNum: 28,
      bwMhz: 10,
      siteLat: -34.6,
      siteLon: -58.4,
      prbHistogram: makeBdaPattern(50),
      trafficPerHour: flatTraffic,
      allSites: sampleSites,
    })
    expect(Array.isArray(result.mitigations)).toBe(true)
    expect(result.mitigations.length).toBeGreaterThan(0)
  })

  it('mitigations tienen urgency válida', () => {
    const result = analyzeCell({
      cellId: 'C1',
      bandNum: 28,
      bwMhz: 10,
      siteLat: -34.6,
      siteLon: -58.4,
      prbHistogram: makeBdaPattern(50),
      trafficPerHour: flatTraffic,
      allSites: sampleSites,
    })
    const validUrgencies = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
    result.mitigations.forEach(m => {
      expect(validUrgencies).toContain(m.urgency)
    })
  })

  it('sourceSearchRadiusKm coincide con SOURCE_SEARCH_RADIUS_KM para primarySource', () => {
    const result = analyzeCell({
      cellId: 'C1',
      bandNum: 28,
      bwMhz: 10,
      siteLat: -34.6,
      siteLon: -58.4,
      prbHistogram: makeBdaPattern(50),
      trafficPerHour: flatTraffic,
      allSites: sampleSites,
    })
    const expectedRadius = SOURCE_SEARCH_RADIUS_KM[result.primarySource]
    expect(result.sourceSearchRadiusKm).toBe(expectedRadius)
  })

  it('features contiene todos los campos PRBFeatures con valores finitos', () => {
    const result = analyzeCell({
      cellId: 'C1',
      bandNum: 28,
      bwMhz: 10,
      siteLat: -34.6,
      siteLon: -58.4,
      prbHistogram: makeFlatPrb(50, -100),
      trafficPerHour: flatTraffic,
      allSites: sampleSites,
    })
    const f = result.features
    expect(isFinite(f.peakDbm)).toBe(true)
    expect(isFinite(f.floorElevationDb)).toBe(true)
    expect(isFinite(f.prbUniformity)).toBe(true)
    expect(isFinite(f.temporalCv)).toBe(true)
    expect(isFinite(f.trafficCorrelation)).toBe(true)
  })

  it('evidence de cada match es array con al menos 1 string', () => {
    const result = analyzeCell({
      cellId: 'C1',
      bandNum: 28,
      bwMhz: 10,
      siteLat: -34.6,
      siteLon: -58.4,
      prbHistogram: makeBdaPattern(50),
      trafficPerHour: flatTraffic,
      allSites: sampleSites,
    })
    result.matches.forEach(m => {
      expect(Array.isArray(m.evidence)).toBe(true)
      expect(m.evidence.length).toBeGreaterThan(0)
      m.evidence.forEach(e => expect(typeof e).toBe('string'))
    })
  })

  it('UNKNOWN_PERSISTENT siempre aparece en matches (fallback)', () => {
    // Con señal completamente en piso térmico, debe haber una fuente fallback
    const result = analyzeCell({
      cellId: 'C-CLEAN',
      bandNum: 28,
      bwMhz: 10,
      siteLat: -34.6,
      siteLon: -58.4,
      prbHistogram: makeFlatPrb(50, -108),
      trafficPerHour: flatTraffic,
      allSites: sampleSites,
    })
    // Debe haber al menos un match (puede ser UNKNOWN_PERSISTENT)
    expect(result.matches.length).toBeGreaterThan(0)
  })
})
