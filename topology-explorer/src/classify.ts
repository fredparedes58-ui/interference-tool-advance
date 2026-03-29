/**
 * classify.ts
 * -----------
 * Client-side PRB interference source classifier.
 * TypeScript port of interference_advisor/classifier.py.
 *
 * Inputs  : PRB histogram [N_PRB][24] (dBm), cell traffic [24] (0-1),
 *           band number, bandwidth (MHz)
 * Outputs : ranked SourceMatch[] + computed PRBFeatures
 *
 * Knowledge base: 130+ field investigation reports (Movistar/Claro Argentina).
 */

import type {
  CellAnalysis,
  CellKPI,
  MitigationAction,
  PRBFeatures,
  SourceMatch,
  SourceType,
} from './types'

const THERMAL_FLOOR = -108.0
const MIN_CONFIDENCE = 0.30
const FALLBACK_CONFIDENCE = 0.40

// ---------------------------------------------------------------------------
// Band compatibility (empty = any band)
// ---------------------------------------------------------------------------
const BAND_COMPAT: Record<SourceType, number[]> = {
  CABLE_TV_LEAKAGE:           [28, 5, 17, 20, 12, 13, 14],
  FM_RADIO_HARMONIC:          [5, 17, 20, 12, 13, 14],
  TV_DIGITAL_BROADCAST_700:   [28],
  BDA_OSCILLATION:            [],
  BDA_EXCESS_GAIN:            [],
  WIRELESS_ISP_2500:          [41, 38, 40, 42, 43],
  WIFI_CAMERA_UNLICENSED_850: [5, 17, 20, 12, 13, 14],
  JAMMER:                     [],
  MILITARY_POLICE:            [5, 17, 20, 12, 13, 14, 2, 25, 66],
  PIM:                        [],
  ATMOSPHERIC_DUCTING:        [],
  UNKNOWN_PERSISTENT:         [],
}

const LABELS: Record<SourceType, string> = {
  CABLE_TV_LEAKAGE:           'Cable TV Infrastructure Leakage',
  FM_RADIO_HARMONIC:          'FM Radio Harmonic Interference',
  TV_DIGITAL_BROADCAST_700:   'DVB-T2 TV Broadcast Overlap (700 MHz)',
  BDA_OSCILLATION:            'BDA / Signal Booster — Oscillation Mode',
  BDA_EXCESS_GAIN:            'BDA / Signal Booster — Excess Gain',
  WIRELESS_ISP_2500:          'Unlicensed Wireless ISP Node (2.5 GHz)',
  WIFI_CAMERA_UNLICENSED_850: 'Non-compliant WiFi Cameras / Unlicensed 850 MHz',
  JAMMER:                     'Commercial Cellular Jammer',
  MILITARY_POLICE:            'Military / Police Radio (Licensed)',
  PIM:                        'Passive Intermodulation (PIM) Products',
  ATMOSPHERIC_DUCTING:        'Atmospheric Ducting / Troposcatter',
  UNKNOWN_PERSISTENT:         'Unknown Persistent Interference',
}

const ACTION_HINTS: Record<SourceType, string> = {
  CABLE_TV_LEAKAGE:           'Field sweep near cable TV poles; coordinate with cable operator',
  FM_RADIO_HARMONIC:          'Identify FM station; compute harmonic; notify regulator',
  TV_DIGITAL_BROADCAST_700:   'Confirm TV channel overlap; coordinate with spectrum regulator',
  BDA_OSCILLATION:            'Direction-find source; locate BDA; deactivate; file complaint',
  BDA_EXCESS_GAIN:            'Field sweep in sector direction; identify building with BDA',
  WIRELESS_ISP_2500:          'Confirm PRBs 0–15 elevated; locate WISP antenna; regulatory action',
  WIFI_CAMERA_UNLICENSED_850: 'Compare sector RSSI; survey nearby buildings with cameras',
  JAMMER:                     'Identify business with 7–18h pattern; contact directly or via police',
  MILITARY_POLICE:            'Document ascending slope; escalate to national regulator only',
  PIM:                        'Inspect connectors/jumpers; run PIM tester; check DL traffic correlation',
  ATMOSPHERIC_DUCTING:        'Verify night pattern across multiple cells; enable duct-mitigation features',
  UNKNOWN_PERSISTENT:         'Full field measurement with spectrum analyser + directional antenna',
}

const SEVERITY_MAP: Record<SourceType, SourceMatch['severity']> = {
  CABLE_TV_LEAKAGE:           'MEDIUM',
  FM_RADIO_HARMONIC:          'LOW',
  TV_DIGITAL_BROADCAST_700:   'HIGH',
  BDA_OSCILLATION:            'CRITICAL',
  BDA_EXCESS_GAIN:            'HIGH',
  WIRELESS_ISP_2500:          'MEDIUM',
  WIFI_CAMERA_UNLICENSED_850: 'MEDIUM',
  JAMMER:                     'HIGH',
  MILITARY_POLICE:            'HIGH',
  PIM:                        'HIGH',
  ATMOSPHERIC_DUCTING:        'LOW',
  UNKNOWN_PERSISTENT:         'MEDIUM',
}

// Source search radius in km per source type
export const SOURCE_SEARCH_RADIUS_KM: Record<SourceType, number> = {
  CABLE_TV_LEAKAGE:           0.8,
  FM_RADIO_HARMONIC:          5.0,
  TV_DIGITAL_BROADCAST_700:  10.0,
  BDA_OSCILLATION:            0.4,
  BDA_EXCESS_GAIN:            0.5,
  WIRELESS_ISP_2500:          0.3,
  WIFI_CAMERA_UNLICENSED_850: 0.5,
  JAMMER:                     0.6,
  MILITARY_POLICE:            5.0,
  PIM:                        0.05, // on-site
  ATMOSPHERIC_DUCTING:       50.0,
  UNKNOWN_PERSISTENT:         1.0,
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))

const sigmoid = (x: number, center: number, steepness = 6) =>
  1 / (1 + Math.exp(-steepness * (x - center)))

const invSig = (x: number, center: number, steepness = 6) =>
  1 - sigmoid(x, center, steepness)

const inRange = (x: number, lo: number, hi: number, margin = 0.3) => {
  const width = hi - lo
  const decay = width * margin || 1
  if (x >= lo && x <= hi) return 1
  if (x < lo) return clamp(1 - (lo - x) / decay)
  return clamp(1 - (x - hi) / decay)
}

const weightedMean = (criteria: [number, number][]) => {
  const totalW = criteria.reduce((s, [, w]) => s + w, 0)
  if (totalW === 0) return 0
  return criteria.reduce((s, [sc, w]) => s + sc * w, 0) / totalW
}

// ---------------------------------------------------------------------------
// Feature extraction
// ---------------------------------------------------------------------------
export function extractFeatures(
  prb: number[][],
  traffic: number[],
  _band: number,
  _bwMhz: number,
): PRBFeatures {
  const N = prb.length
  const H = 24

  // Per-PRB averages
  const prbAvg = prb.map(row => row.reduce((s, v) => s + v, 0) / H)
  const allMean = prbAvg.reduce((s, v) => s + v, 0) / N

  const peakDbm = Math.max(...prb.flat())
  const sorted = [...prbAvg].sort((a, b) => a - b)
  const medianDbm = sorted[Math.floor(N / 2)]
  const floorElevationDb = medianDbm - THERMAL_FLOOR

  // PRB uniformity
  const prbRange = Math.max(...prbAvg) - Math.min(...prbAvg)
  const prbStd = Math.sqrt(prbAvg.reduce((s, v) => s + (v - allMean) ** 2, 0) / N)
  const prbUniformity = clamp(prbRange > 0 ? 1 - prbStd / prbRange : 1)

  // Edge excess
  const nEdge = Math.max(1, Math.floor(N * 0.15))
  const edgeIdxs = [...Array(nEdge).keys(), ...Array.from({ length: nEdge }, (_, i) => N - nEdge + i)]
  const centerIdxs = Array.from({ length: N - 2 * nEdge }, (_, i) => nEdge + i)
  const edgeMean = edgeIdxs.reduce((s, i) => s + prbAvg[i], 0) / edgeIdxs.length
  const centerMean = centerIdxs.length
    ? centerIdxs.reduce((s, i) => s + prbAvg[i], 0) / centerIdxs.length
    : edgeMean
  const edgePrbExcessDb = edgeMean - centerMean

  // Low PRB excess
  const nLow = Math.max(1, Math.floor(N * 0.25))
  const lowMean = prbAvg.slice(0, nLow).reduce((s, v) => s + v, 0) / nLow
  const lowPrbExcessDb = lowMean - allMean

  // Peak cluster width
  const peakVal = Math.max(...prbAvg)
  const nPeak = prbAvg.filter(v => v >= peakVal - 3).length
  const peakClusterWidthPct = (nPeak / N) * 100

  // Spectral slope (linear regression)
  const xs = Array.from({ length: N }, (_, i) => i)
  const xm = (N - 1) / 2
  const ym = allMean
  const slopeNum = xs.reduce((s, x, i) => s + (x - xm) * (prbAvg[i] - ym), 0)
  const slopeDen = xs.reduce((s, x) => s + (x - xm) ** 2, 0)
  const slopeDbPerPrb = slopeDen > 0 ? slopeNum / slopeDen : 0

  // Hot zone: top 20% PRBs by average
  const topK = Math.max(1, Math.floor(N * 0.20))
  const topIdxs = [...prbAvg.map((v, i) => [v, i] as [number, number])]
    .sort((a, b) => b[0] - a[0])
    .slice(0, topK)
    .map(([, i]) => i)
  const hotHour = Array.from({ length: H }, (_, h) =>
    topIdxs.reduce((s, pi) => s + prb[pi][h], 0) / topIdxs.length
  )
  const hotMean = hotHour.reduce((s, v) => s + v, 0) / H
  const hotStd = Math.sqrt(hotHour.reduce((s, v) => s + (v - hotMean) ** 2, 0) / H)
  const temporalCv = Math.abs(hotMean) > 1e-6 ? hotStd / Math.abs(hotMean) : 0

  const bizIdx = Array.from({ length: 12 }, (_, i) => i + 7)
  const offIdx = [...Array(7).keys(), ...Array.from({ length: 5 }, (_, i) => i + 19)]
  const bizAvg = bizIdx.reduce((s, h) => s + hotHour[h], 0) / bizIdx.length
  const offAvg = offIdx.reduce((s, h) => s + hotHour[h], 0) / offIdx.length
  const businessHourExcessDb = bizAvg - offAvg

  // Traffic correlation (Pearson)
  const tMean = traffic.reduce((s, v) => s + v, 0) / H
  const tStd = Math.sqrt(traffic.reduce((s, v) => s + (v - tMean) ** 2, 0) / H)
  let trafficCorrelation = 0
  if (tStd > 1e-6 && hotStd > 1e-6) {
    const cov = Array.from({ length: H }, (_, h) =>
      (hotHour[h] - hotMean) * (traffic[h] - tMean)
    ).reduce((s, v) => s + v, 0) / H
    trafficCorrelation = clamp(cov / (tStd * hotStd), -1, 1)
  }

  // Night vs day (dB)
  const nightIdx = Array.from({ length: 7 }, (_, i) => i)
  const dayIdx = Array.from({ length: 10 }, (_, i) => i + 9)
  const nightAvg = nightIdx.reduce((s, h) => s + hotHour[h], 0) / nightIdx.length
  const dayAvg = dayIdx.reduce((s, h) => s + hotHour[h], 0) / dayIdx.length
  const nightMinusDayDb = nightAvg - dayAvg

  return {
    peakDbm,
    floorElevationDb,
    prbUniformity,
    edgePrbExcessDb,
    lowPrbExcessDb,
    peakClusterWidthPct,
    slopeDbPerPrb,
    temporalCv,
    businessHourExcessDb,
    trafficCorrelation,
    nightMinusDayDb,
  }
}

// ---------------------------------------------------------------------------
// Scorers (mirrors Python classifier.py)
// ---------------------------------------------------------------------------
type Scorer = (f: PRBFeatures) => [number, string[]]

const scoreCableTv: Scorer = f => {
  const ev: string[] = []
  const c: [number, number][] = []
  let s = sigmoid(f.prbUniformity, 0.78)
  c.push([s, 3]); if (s > 0.6) ev.push(`prb_uniformity=${f.prbUniformity.toFixed(2)} (wideband flat)`)
  s = inRange(f.floorElevationDb, 7, 22)
  c.push([s, 2]); if (s > 0.6) ev.push(`floor +${f.floorElevationDb.toFixed(1)} dB above thermal`)
  s = inRange(f.peakDbm, -104, -83)
  c.push([s, 1.5]); if (s > 0.6) ev.push(`peak=${f.peakDbm.toFixed(1)} dBm (cable TV range)`)
  s = invSig(f.temporalCv, 0.12)
  c.push([s, 3]); if (s > 0.6) ev.push(`temporal_cv=${f.temporalCv.toFixed(2)} (continuous 24/7)`)
  s = invSig(Math.abs(f.trafficCorrelation), 0.30)
  c.push([s, 2]); if (s > 0.6) ev.push(`traffic_corr=${f.trafficCorrelation.toFixed(2)} (independent)`)
  s = invSig(Math.abs(f.slopeDbPerPrb), 0.04)
  c.push([s, 1.5]); if (s > 0.6) ev.push(`slope=${f.slopeDbPerPrb.toFixed(3)} dB/PRB (flat)`)
  const penalty = f.lowPrbExcessDb > 3 ? clamp(1 - f.lowPrbExcessDb / 12) : 1
  c.push([penalty, 1])
  return [weightedMean(c), ev]
}

const scoreFmHarmonic: Scorer = f => {
  const ev: string[] = []
  const c: [number, number][] = []
  let s = invSig(f.peakClusterWidthPct, 5.5)
  c.push([s, 5]); if (s > 0.5) ev.push(`peak_width=${f.peakClusterWidthPct.toFixed(1)}% (very narrow)`)
  s = sigmoid(f.prbUniformity, 0.65)
  c.push([s, 2])
  s = invSig(f.temporalCv, 0.12)
  c.push([s, 2.5]); if (s > 0.5) ev.push(`temporal_cv=${f.temporalCv.toFixed(2)} (continuous)`)
  s = invSig(Math.abs(f.trafficCorrelation), 0.30)
  c.push([s, 1.5])
  return [weightedMean(c), ev]
}

const scoreTvDigital700: Scorer = f => {
  const ev: string[] = []
  const c: [number, number][] = []
  let s = sigmoid(f.lowPrbExcessDb, 4, 0.5)
  c.push([s, 5]); if (s > 0.4) ev.push(`low_prb_excess=${f.lowPrbExcessDb.toFixed(1)} dB (TV overlap)`)
  s = inRange(f.peakClusterWidthPct, 12, 42)
  c.push([s, 2.5]); if (s > 0.5) ev.push(`peak_width=${f.peakClusterWidthPct.toFixed(1)}% (block)`)
  s = sigmoid(f.edgePrbExcessDb, 2.5)
  c.push([s, 2]); if (s > 0.5) ev.push(`edge_excess=${f.edgePrbExcessDb.toFixed(1)} dB`)
  s = invSig(f.temporalCv, 0.15)
  c.push([s, 2]); if (s > 0.5) ev.push(`temporal_cv=${f.temporalCv.toFixed(2)} (broadcast)`)
  s = invSig(f.prbUniformity, 0.82)
  c.push([s, 1.5])
  return [weightedMean(c), ev]
}

const scoreBdaOscillation: Scorer = f => {
  const ev: string[] = []
  const c: [number, number][] = []
  let s = sigmoid(f.peakDbm, -82)
  c.push([s, 5]); if (s > 0.5) ev.push(`peak=${f.peakDbm.toFixed(1)} dBm (SEVERE — oscillation)`)
  s = sigmoid(f.floorElevationDb, 22)
  c.push([s, 3]); if (s > 0.5) ev.push(`floor +${f.floorElevationDb.toFixed(1)} dB`)
  s = sigmoid(f.prbUniformity, 0.72)
  c.push([s, 3]); if (s > 0.5) ev.push(`uniformity=${f.prbUniformity.toFixed(2)} (wideband)`)
  s = invSig(f.temporalCv, 0.14)
  c.push([s, 3]); if (s > 0.5) ev.push(`temporal_cv=${f.temporalCv.toFixed(2)} (stable 24/7)`)
  s = invSig(Math.abs(f.trafficCorrelation), 0.25)
  c.push([s, 1.5])
  s = invSig(Math.abs(f.lowPrbExcessDb), 4)
  c.push([s, 1])
  return [weightedMean(c), ev]
}

const scoreBdaExcessGain: Scorer = f => {
  const ev: string[] = []
  const c: [number, number][] = []
  let s = inRange(f.peakDbm, -97, -78)
  c.push([s, 3]); if (s > 0.5) ev.push(`peak=${f.peakDbm.toFixed(1)} dBm (excess-gain BDA)`)
  s = sigmoid(f.prbUniformity, 0.67)
  c.push([s, 3]); if (s > 0.5) ev.push(`uniformity=${f.prbUniformity.toFixed(2)} (wideband)`)
  s = sigmoid(f.temporalCv, 0.05, 30)
  c.push([s, 4]); if (s > 0.5) ev.push(`temporal_cv=${f.temporalCv.toFixed(2)} (occupancy variation)`)
  s = inRange(Math.abs(f.businessHourExcessDb), 0.5, 18)
  c.push([s, 2]); if (s > 0.5) ev.push(`biz_excess=${f.businessHourExcessDb.toFixed(1)} dB`)
  s = invSig(Math.abs(f.trafficCorrelation), 0.35)
  c.push([s, 1.5])
  s = invSig(f.lowPrbExcessDb, 5)
  c.push([s, 2])
  s = invSig(Math.abs(f.slopeDbPerPrb), 0.06)
  c.push([s, 1])
  return [weightedMean(c), ev]
}

const scoreWispNode: Scorer = f => {
  const ev: string[] = []
  const c: [number, number][] = []
  let s = sigmoid(f.lowPrbExcessDb, 4, 0.5)
  c.push([s, 6]); if (s > 0.4) ev.push(`low_prb_excess=${f.lowPrbExcessDb.toFixed(1)} dB (WISP 2.5GHz)`)
  s = invSig(f.prbUniformity, 0.82)
  c.push([s, 2]); if (s > 0.5) ev.push(`uniformity=${f.prbUniformity.toFixed(2)} (partial band)`)
  s = inRange(f.temporalCv, 0.04, 0.60)
  c.push([s, 1.5]); if (s > 0.5) ev.push(`temporal_cv=${f.temporalCv.toFixed(2)} (usage variation)`)
  s = inRange(f.businessHourExcessDb, 0.5, 25)
  c.push([s, 2]); if (s > 0.5) ev.push(`biz_excess=${f.businessHourExcessDb.toFixed(1)} dB (daytime ISP)`)
  return [weightedMean(c), ev]
}

const scoreWifiCamera: Scorer = f => {
  const ev: string[] = []
  const c: [number, number][] = []
  let s = inRange(f.prbUniformity, 0.55, 0.82)
  c.push([s, 2.5])
  s = inRange(f.peakDbm, -98, -77)
  c.push([s, 2]); if (s > 0.5) ev.push(`peak=${f.peakDbm.toFixed(1)} dBm (nearby unlicensed)`)
  s = inRange(f.temporalCv, 0.04, 0.40)
  c.push([s, 1.5])
  s = invSig(Math.abs(f.trafficCorrelation), 0.30)
  c.push([s, 1.5])
  const slopePenalty = invSig(Math.abs(f.slopeDbPerPrb), 0.055, 40)
  c.push([slopePenalty, 3])
  const lowPenalty = invSig(f.lowPrbExcessDb, 6)
  c.push([lowPenalty, 2.5])
  const narrowPenalty = sigmoid(f.peakClusterWidthPct, 4.5)
  c.push([narrowPenalty, 2])
  return [weightedMean(c), ev]
}

const scoreJammer: Scorer = f => {
  const ev: string[] = []
  const c: [number, number][] = []
  let s = sigmoid(f.businessHourExcessDb, 10, 0.3)
  c.push([s, 6]); if (s > 0.4) ev.push(`biz_excess=${f.businessHourExcessDb.toFixed(1)} dB (7–18h pattern)`)
  s = sigmoid(f.temporalCv, 0.08)
  c.push([s, 3.5]); if (s > 0.5) ev.push(`temporal_cv=${f.temporalCv.toFixed(2)} (sharp on/off)`)
  s = invSig(f.peakClusterWidthPct, 25)
  c.push([s, 1.5]); if (s > 0.5) ev.push(`peak_width=${f.peakClusterWidthPct.toFixed(1)}% (narrowband)`)
  s = invSig(Math.abs(f.trafficCorrelation), 0.35)
  c.push([s, 2])
  return [weightedMean(c), ev]
}

const scoreMilitary: Scorer = f => {
  const ev: string[] = []
  const c: [number, number][] = []
  let s = sigmoid(Math.abs(f.slopeDbPerPrb), 0.045, 60)
  c.push([s, 6]); if (s > 0.4) ev.push(`slope=${f.slopeDbPerPrb.toFixed(3)} dB/PRB (slanted spectrum)`)
  c.push([f.slopeDbPerPrb > 0 ? 0.85 : 0.40, 2])
  if (f.slopeDbPerPrb > 0) ev.push('positive slope (ascending toward high PRBs)')
  s = invSig(f.prbUniformity, 0.78)
  c.push([s, 1.5])
  s = invSig(f.lowPrbExcessDb, 5)
  c.push([s, 1.5])
  return [weightedMean(c), ev]
}

const scorePim: Scorer = f => {
  const ev: string[] = []
  const c: [number, number][] = []
  let s = sigmoid(f.trafficCorrelation, 0.48)
  c.push([s, 6]); if (s > 0.4) ev.push(`traffic_corr=${f.trafficCorrelation.toFixed(2)} (DL traffic drives IM)`)
  s = sigmoid(-f.nightMinusDayDb, 2, 0.6)
  c.push([s, 4]); if (s > 0.5) ev.push(`night_vs_day=${f.nightMinusDayDb.toFixed(1)} dB (lower at night)`)
  s = inRange(f.peakClusterWidthPct, 3, 45)
  c.push([s, 1.5])
  const edgePenalty = invSig(f.lowPrbExcessDb, 5.5, 0.7)
  c.push([edgePenalty, 3]); if (edgePenalty < 0.4) ev.push('edge concentration → not IM product')
  return [weightedMean(c), ev]
}

const scoreDucting: Scorer = f => {
  const ev: string[] = []
  const c: [number, number][] = []
  let s = sigmoid(f.nightMinusDayDb, 2.5, 0.5)
  c.push([s, 5]); if (s > 0.4) ev.push(`night_vs_day=${f.nightMinusDayDb.toFixed(1)} dB (higher at night)`)
  s = sigmoid(f.temporalCv, 0.30)
  c.push([s, 2.5]); if (s > 0.5) ev.push(`temporal_cv=${f.temporalCv.toFixed(2)} (episodic)`)
  s = sigmoid(f.prbUniformity, 0.65)
  c.push([s, 2]); if (s > 0.5) ev.push(`uniformity=${f.prbUniformity.toFixed(2)} (wideband)`)
  s = invSig(Math.abs(f.trafficCorrelation), 0.28)
  c.push([s, 1.5])
  return [weightedMean(c), ev]
}

const SCORERS: Record<SourceType, Scorer> = {
  CABLE_TV_LEAKAGE:           scoreCableTv,
  FM_RADIO_HARMONIC:          scoreFmHarmonic,
  TV_DIGITAL_BROADCAST_700:   scoreTvDigital700,
  BDA_OSCILLATION:            scoreBdaOscillation,
  BDA_EXCESS_GAIN:            scoreBdaExcessGain,
  WIRELESS_ISP_2500:          scoreWispNode,
  WIFI_CAMERA_UNLICENSED_850: scoreWifiCamera,
  JAMMER:                     scoreJammer,
  MILITARY_POLICE:            scoreMilitary,
  PIM:                        scorePim,
  ATMOSPHERIC_DUCTING:        scoreDucting,
  UNKNOWN_PERSISTENT:         () => [0, []],
}

// ---------------------------------------------------------------------------
// Mitigation action catalogue (Ericsson features + field actions)
// ---------------------------------------------------------------------------

const MITIGATIONS: Partial<Record<SourceType, MitigationAction[]>> = {
  CABLE_TV_LEAKAGE: [
    {
      id: 'cable_field_hunt',
      title: 'Field Interference Hunt — Cable TV TAPs',
      type: 'FIELD',
      description: 'Perform spectrum sweep with handheld SA + log-periodic antenna near cable TV poles, amplifiers, and junction boxes in the direction of affected sector.',
      expectedKpiImpact: ['RSSI normalisation after source removal', 'UL Throughput +10–30%'],
      neighborImpactRadiusKm: 0,
      urgency: 'HIGH',
      requiresFieldVisit: true,
    },
    {
      id: 'ul_itfm',
      title: 'Enable UL-ITFM (FAJ 121 0484)',
      type: 'CM',
      featureId: 'FAJ 121 0484',
      description: 'Uplink-Triggered Inter-Frequency Mobility moves UEs with degraded UL quality to a cleaner frequency, protecting voice and data sessions from interference.',
      prerequisites: ['Target frequency must have sufficient capacity', 'IRC enabled on source cell'],
      conflicts: ['SPIFHO if same trigger threshold', 'Limited UL-Aware IFLB'],
      expectedKpiImpact: ['UL SINR +2–5 dB for moved UEs', 'HSUPA/LTE UL accessibility +5–15%'],
      neighborImpactRadiusKm: 1.0,
      urgency: 'MEDIUM',
      requiresFieldVisit: false,
    },
    {
      id: 'irc_enable',
      title: 'Enable IRC for AAS FDD (FAJ 121 4919)',
      type: 'CM',
      featureId: 'FAJ 121 4919',
      description: 'Interference Rejection Combining for AAS FDD units uses multiple receive branches to reject spatially correlated interference, improving UL SINR by 2–6 dB for external wideband sources.',
      prerequisites: ['AAS or 4RX radio unit (AIR series)'],
      expectedKpiImpact: ['UL SINR +2–6 dB', 'PUSCH BLER –20–40%'],
      neighborImpactRadiusKm: 0,
      urgency: 'MEDIUM',
      requiresFieldVisit: false,
    },
    {
      id: 'ul_spectrum_analyzer',
      title: 'Activate UL Spectrum Analyzer (FAJ 121 4271)',
      type: 'CM',
      featureId: 'FAJ 121 4271',
      description: 'Enables PRB-level interference measurement and reporting per cell. Provides the detailed histogram data needed to confirm CABLE_TV flat signature and identify affected PRBs.',
      expectedKpiImpact: ['No direct KPI change — diagnostic tool', 'Enables targeted PRB avoidance'],
      neighborImpactRadiusKm: 0,
      urgency: 'HIGH',
      requiresFieldVisit: false,
    },
    {
      id: 'ul_interference_reporting',
      title: 'Enable UL Interference Reporting (FAJ 121 4157)',
      type: 'CM',
      featureId: 'FAJ 121 4157',
      description: 'Per-PRB interference monitoring with configurable reporting period. Essential for ongoing interference surveillance after field resolution.',
      expectedKpiImpact: ['Continuous interference visibility', 'Early detection of recurrence'],
      neighborImpactRadiusKm: 0,
      urgency: 'LOW',
      requiresFieldVisit: false,
    },
  ],

  BDA_OSCILLATION: [
    {
      id: 'bda_regulatory',
      title: 'Regulatory Complaint — Illegal BDA',
      type: 'REGULATORY',
      description: 'File formal complaint with ENACOM/IFT/ANATEL or national spectrum regulator. BDA oscillation causes CRITICAL interference; requires immediate enforcement.',
      expectedKpiImpact: ['RSSI fully normalised after device removal', 'All UL KPIs restored'],
      neighborImpactRadiusKm: 0,
      urgency: 'CRITICAL',
      requiresFieldVisit: true,
    },
    {
      id: 'bda_field_hunt',
      title: 'Emergency Field Hunt — BDA Device',
      type: 'FIELD',
      description: 'Direction-find with handheld SA from affected sector; triangulate source building; contact owner to power off device immediately.',
      expectedKpiImpact: ['Immediate KPI recovery after device power-off'],
      neighborImpactRadiusKm: 0,
      urgency: 'CRITICAL',
      requiresFieldVisit: true,
    },
    {
      id: 'ul_itfm_bda',
      title: 'Enable UL-ITFM (FAJ 121 0484) — Temporary Relief',
      type: 'CM',
      featureId: 'FAJ 121 0484',
      description: 'Move affected UEs to cleaner frequency while field resolution is underway.',
      expectedKpiImpact: ['Partial UL quality restoration for moved UEs'],
      neighborImpactRadiusKm: 1.0,
      urgency: 'HIGH',
      requiresFieldVisit: false,
    },
  ],

  BDA_EXCESS_GAIN: [
    {
      id: 'bda_eg_field',
      title: 'Field Hunt — Excess Gain BDA',
      type: 'FIELD',
      description: 'Sweep sector; identify building with BDA; contact owner to adjust gain or remove device.',
      expectedKpiImpact: ['RSSI normalisation', 'UL SINR +5–15 dB'],
      neighborImpactRadiusKm: 0,
      urgency: 'HIGH',
      requiresFieldVisit: true,
    },
    {
      id: 'ul_itfm_eg',
      title: 'Enable UL-ITFM (FAJ 121 0484)',
      type: 'CM',
      featureId: 'FAJ 121 0484',
      description: 'Trigger inter-frequency mobility for UEs experiencing worst UL quality.',
      expectedKpiImpact: ['UL SINR improvement for moved UEs'],
      neighborImpactRadiusKm: 1.0,
      urgency: 'MEDIUM',
      requiresFieldVisit: false,
    },
  ],

  JAMMER: [
    {
      id: 'jammer_police',
      title: 'Police / Regulator Intervention',
      type: 'REGULATORY',
      description: 'Contact police and national regulator (ENACOM/IFT). Jammers are illegal in most jurisdictions. Identify business/building active 7–18h in sector direction.',
      expectedKpiImpact: ['Full KPI recovery after jammer removal'],
      neighborImpactRadiusKm: 0,
      urgency: 'HIGH',
      requiresFieldVisit: true,
    },
    {
      id: 'jammer_ulsc',
      title: 'UL Scheduling Control for OoC UEs (FAJ 121 3826)',
      type: 'CM',
      featureId: 'FAJ 121 3826',
      description: 'Restrict UL resource allocation for out-of-coverage UEs wasting uplink capacity while under jammer influence.',
      expectedKpiImpact: ['Reduced interference from OoC UEs', 'UL capacity partially recovered'],
      neighborImpactRadiusKm: 0.5,
      urgency: 'MEDIUM',
      requiresFieldVisit: false,
    },
    {
      id: 'jammer_voltmob',
      title: 'UL-Triggered VoLTE Mobility (FAJ 121 3742)',
      type: 'CM',
      featureId: 'FAJ 121 3742',
      description: 'Move VoLTE/QCI-1 calls away from the interfered cell during jammer active hours (7–18h pattern confirmed).',
      expectedKpiImpact: ['VoLTE drop rate reduction during jammer hours', 'QCI-1 accessibility +10–20%'],
      prerequisites: ['VoLTE active on cell', 'Target frequency available'],
      neighborImpactRadiusKm: 1.0,
      urgency: 'HIGH',
      requiresFieldVisit: false,
    },
    {
      id: 'jammer_spifho',
      title: 'Service/Priority-Triggered IF Handover (FAJ 121 3087)',
      type: 'CM',
      featureId: 'FAJ 121 3087',
      description: 'Triggers inter-frequency handover based on QCI/service type. VoLTE UEs on restricted bands can be moved to a cleaner frequency band during jammer hours.',
      prerequisites: ['Multiple frequency layers available', 'VoLTE or priority service configured'],
      conflicts: ['UL-ITFM (FAJ 121 0484) — configure different QCI triggers to avoid double mobility'],
      expectedKpiImpact: ['QCI-1 drop rate –15–30%', 'Voice session persistence improved'],
      neighborImpactRadiusKm: 1.0,
      urgency: 'MEDIUM',
      requiresFieldVisit: false,
    },
    {
      id: 'jammer_ul_traffic_mob',
      title: 'UL-Traffic-Triggered Mobility (FAJ 121 5044)',
      type: 'CM',
      featureId: 'FAJ 121 5044',
      description: 'Moves UL-heavy UEs to a less-interfered cell when UL throughput falls below threshold — effective during jammer business hours when UL sessions are blocked.',
      prerequisites: ['Target cell on different frequency with clean UL'],
      expectedKpiImpact: ['UL throughput recovery for moved UEs', 'Reduced HARQ retransmissions'],
      neighborImpactRadiusKm: 1.0,
      urgency: 'MEDIUM',
      requiresFieldVisit: false,
    },
    {
      id: 'jammer_service_mob',
      title: 'Service Triggered Mobility (FAJ 121 1747)',
      type: 'CM',
      featureId: 'FAJ 121 1747',
      description: 'QoS/QCI-based mobility thresholds; moves UEs with specific service types (e.g., QCI 1 voice) when their UL quality drops below defined SINR/BLER thresholds during jammer hours.',
      prerequisites: ['QCI-1 or priority services active', 'Neighbour relations configured'],
      expectedKpiImpact: ['VoLTE CSSR improvement', 'Priority service continuity'],
      neighborImpactRadiusKm: 1.0,
      urgency: 'MEDIUM',
      requiresFieldVisit: false,
    },
    {
      id: 'jammer_limited_ula_iflb',
      title: 'Limited-Uplink-Aware IFLB (FAJ 121 4406)',
      type: 'CM',
      featureId: 'FAJ 121 4406',
      description: 'Prevents load balancing algorithms from routing new UEs to the jammer-affected cell. IFLB considers UL interference level as a constraint when selecting target cell.',
      prerequisites: ['IFLB enabled on RAN', 'UL interference reporting active (FAJ 121 4157)'],
      expectedKpiImpact: ['Prevents new UEs from entering degraded cell', 'Reduces overall cell impact radius'],
      neighborImpactRadiusKm: 1.5,
      urgency: 'MEDIUM',
      requiresFieldVisit: false,
    },
  ],

  PIM: [
    {
      id: 'pim_detection',
      title: 'Enable PIM Detection (FAJ 121 5436)',
      type: 'CM',
      featureId: 'FAJ 121 5436',
      description: 'Ericsson automated PIM detection runs 24h measurement cycles and reports intermodulation frequency, class (distributed/traffic-based), and suspected aggressor DL carrier.',
      prerequisites: ['pimDetectionEnabled=true on ENodeBFunction'],
      conflicts: ['Combined Cell (FAJ 121 3025) — partially impaired'],
      expectedKpiImpact: ['Identifies IM3/IM5 source carrier', 'Reports every 24h'],
      neighborImpactRadiusKm: 0,
      urgency: 'HIGH',
      requiresFieldVisit: false,
    },
    {
      id: 'pim_avoidance',
      title: 'Enable PIM Avoidance (FAJ 121 5448)',
      type: 'CM',
      featureId: 'FAJ 121 5448',
      description: 'Mutes specific DL PRBs on aggressor cell to avoid generating IM products that fall in victim cell UL. Supports static (single-node) and dynamic (multi-node) modes.',
      prerequisites: ['PIM Detection must identify victim/aggressor pair', 'X2AP interface for dynamic mode'],
      conflicts: ['Combined Cell', 'NB-IoT in-band', 'Cat-M in-band'],
      expectedKpiImpact: ['Victim UL throughput +10–25%', 'PUSCH SINR +3–8 dB', 'Aggressor DL –5–10% (trade-off)'],
      neighborImpactRadiusKm: 0.5,
      urgency: 'HIGH',
      requiresFieldVisit: false,
    },
    {
      id: 'pim_diff_ul_power',
      title: 'Differential UL Power Control (FAJ 121 4680)',
      type: 'CM',
      featureId: 'FAJ 121 4680',
      description: 'Adjusts per-UE UL transmit power based on SINR targets, reducing UL power from close-in UEs that contribute to DL overload driving PIM products.',
      prerequisites: ['Power control parameters configured'],
      expectedKpiImpact: ['DL TX power reduction –1–3 dBm (aggregate)', 'PIM product level –2–6 dBm'],
      neighborImpactRadiusKm: 0,
      urgency: 'MEDIUM',
      requiresFieldVisit: false,
    },
    {
      id: 'pim_flex_ul',
      title: 'Flexible Uplink Processing (FAJ 121 5155)',
      type: 'CM',
      featureId: 'FAJ 121 5155',
      description: 'Configures PUCCH structure and Physical Uplink Processing Pipeline (PPP) scheduling for cells with recurring IM-induced PUCCH degradation.',
      prerequisites: ['PUCCH format 1a/1b or 2/2a/2b active'],
      expectedKpiImpact: ['PUCCH BLER –10–20% under PIM conditions', 'SR success rate improvement'],
      neighborImpactRadiusKm: 0,
      urgency: 'LOW',
      requiresFieldVisit: false,
    },
    {
      id: 'pim_coverage_mob',
      title: 'Coverage-Triggered Mobility at Setup (FAJ 121 5144)',
      type: 'CM',
      featureId: 'FAJ 121 5144',
      description: 'Moves voice calls at setup time away from the PIM-affected cell when UL coverage quality (SINR) is below threshold, preventing PIM-induced call failures.',
      prerequisites: ['Voice services active (VoLTE or CSFB)', 'Neighbour cell with clean UL available'],
      expectedKpiImpact: ['Voice setup success rate +5–15%', 'Avoids PIM-impacted calls at setup'],
      neighborImpactRadiusKm: 1.0,
      urgency: 'MEDIUM',
      requiresFieldVisit: false,
    },
    {
      id: 'pim_field',
      title: 'Physical PIM Inspection',
      type: 'FIELD',
      description: 'Inspect all RF connectors, jumpers (RRU→DX and DX→ANT), feeder cables, and antenna ports. Use Anritsu PIM Master (2×43 dBm, IMD3). Threshold: –150 dBc.',
      expectedKpiImpact: ['Complete PIM elimination after hardware replacement', 'UL SINR fully restored'],
      neighborImpactRadiusKm: 0,
      urgency: 'HIGH',
      requiresFieldVisit: true,
    },
  ],

  WIRELESS_ISP_2500: [
    {
      id: 'wisp_field',
      title: 'Field Hunt — Unlicensed WISP Node',
      type: 'FIELD',
      description: 'Confirm PRBs 0–15 elevated (2500–2515 MHz). Survey rooftops in sector for WISP antenna. Contact operator or file regulatory complaint.',
      expectedKpiImpact: ['UL throughput restoration on bottom PRBs after removal'],
      neighborImpactRadiusKm: 0,
      urgency: 'MEDIUM',
      requiresFieldVisit: true,
    },
    {
      id: 'wisp_pucch_od',
      title: 'PUCCH Overdimensioning (FAJ 121 2204)',
      type: 'CM',
      featureId: 'FAJ 121 2204',
      description: 'Moves PUCCH region away from the band edge (low PRBs) where WISP interference concentrates, preserving control channel quality.',
      prerequisites: ['Bandwidth ≥ 3 MHz', 'A-MPR or adjacent-band interference confirmed'],
      expectedKpiImpact: ['PUCCH BLER –20–40%', 'SR failure rate improvement', 'UL coverage preserved'],
      neighborImpactRadiusKm: 0,
      urgency: 'MEDIUM',
      requiresFieldVisit: false,
    },
    {
      id: 'wisp_fss',
      title: 'Evolved UL Frequency-Selective Scheduling (FAJ 121 4966)',
      type: 'CM',
      featureId: 'FAJ 121 4966',
      description: 'Schedules UEs away from the specific bottom PRBs (0–15) affected by WISP 2500–2515 MHz interference, improving per-UE SINR and reducing HARQ retransmissions.',
      expectedKpiImpact: ['UL SINR +2–4 dB for PUSCH', 'HARQ retransmission rate –15–25%'],
      neighborImpactRadiusKm: 0,
      urgency: 'LOW',
      requiresFieldVisit: false,
    },
    {
      id: 'wisp_dyn_ul_alloc',
      title: 'Dynamic UL Resource Allocation (FAJ 121 4619)',
      type: 'CM',
      featureId: 'FAJ 121 4619',
      description: 'Dynamically allocates UL resources to high-priority UEs on clean PRBs (above PRB 15 for B41), allowing best-effort sessions to use remaining PRBs when WISP interference permits.',
      prerequisites: ['Frequency-selective scheduling enabled'],
      expectedKpiImpact: ['Priority UE UL throughput +10–20%', 'Fairness maintained on clean PRBs'],
      neighborImpactRadiusKm: 0,
      urgency: 'LOW',
      requiresFieldVisit: false,
    },
    {
      id: 'wisp_flex_bw',
      title: 'Flexible Channel Bandwidth (FAJ 121 4756)',
      type: 'CM',
      featureId: 'FAJ 121 4756',
      description: 'Blocks edge PRBs (low end of B41 channel) from UE scheduling, effectively reducing usable bandwidth by 5–10 PRBs to avoid the WISP-interfered region. Permanent mitigation when WISP cannot be removed.',
      prerequisites: ['Cell bandwidth ≥ 15 MHz to retain adequate capacity after blocking'],
      expectedKpiImpact: ['PUSCH SINR +3–7 dB on remaining PRBs', 'Trade-off: –5–10% peak UL throughput'],
      neighborImpactRadiusKm: 0,
      urgency: 'MEDIUM',
      requiresFieldVisit: false,
    },
    {
      id: 'wisp_limited_ula_iflb',
      title: 'Limited-Uplink-Aware IFLB (FAJ 121 4406)',
      type: 'CM',
      featureId: 'FAJ 121 4406',
      description: 'Prevents load balancing from directing new UEs to this WISP-impacted B41 cell; instead routes them to a cleaner B3 or B28 cell when available.',
      prerequisites: ['Multi-band RAN with clean UL candidate cell'],
      expectedKpiImpact: ['New UE UL throughput preserved', 'Interference impact limited to existing sessions'],
      neighborImpactRadiusKm: 1.5,
      urgency: 'MEDIUM',
      requiresFieldVisit: false,
    },
  ],

  TV_DIGITAL_BROADCAST_700: [
    {
      id: 'tv700_regulator',
      title: 'Coordinate with Spectrum Regulator',
      type: 'REGULATORY',
      description: 'DVB-T2 TV channels overlap LTE 700 UL (703–748 MHz). Coordinate with national regulator for digital transition plan. No network fix available while overlap persists.',
      expectedKpiImpact: ['Long-term: full resolution after TV re-farming'],
      neighborImpactRadiusKm: 0,
      urgency: 'HIGH',
      requiresFieldVisit: false,
    },
    {
      id: 'tv700_fss',
      title: 'Evolved UL Frequency-Selective Scheduling (FAJ 121 4966)',
      type: 'CM',
      featureId: 'FAJ 121 4966',
      description: 'Avoids scheduling UEs on PRBs overlapping TV digital channels (Canal 52/54: first 10–20 PRBs in B28), reducing interference impact on PUSCH.',
      expectedKpiImpact: ['UL SINR +3–6 dB on clean PRBs', 'Reduced HARQ retransmissions'],
      neighborImpactRadiusKm: 0,
      urgency: 'MEDIUM',
      requiresFieldVisit: false,
    },
    {
      id: 'tv700_flex_bw',
      title: 'Flexible Channel Bandwidth (FAJ 121 4756)',
      type: 'CM',
      featureId: 'FAJ 121 4756',
      description: 'Blocks the low-end PRBs of the B28 channel from UE scheduling, effectively removing the TV-overlapping region from use. Semi-permanent mitigation during digital TV transition.',
      prerequisites: ['B28 cell bandwidth ≥ 10 MHz to retain adequate capacity'],
      expectedKpiImpact: ['Eliminates TV interference impact on remaining PRBs', 'Trade-off: –10–15% peak UL capacity'],
      neighborImpactRadiusKm: 0,
      urgency: 'MEDIUM',
      requiresFieldVisit: false,
    },
    {
      id: 'tv700_pucch',
      title: 'PUCCH Overdimensioning (FAJ 121 2204)',
      type: 'CM',
      featureId: 'FAJ 121 2204',
      description: 'Shifts PUCCH away from the overlapping TV channel PRBs at the bottom of the band.',
      expectedKpiImpact: ['PUCCH BLER improvement', 'SR success rate increase'],
      neighborImpactRadiusKm: 0,
      urgency: 'MEDIUM',
      requiresFieldVisit: false,
    },
  ],

  FM_RADIO_HARMONIC: [
    {
      id: 'fm_regulator',
      title: 'Notify Regulator — FM Station Harmonic',
      type: 'REGULATORY',
      description: 'Identify FM station (harmonic = FM freq × N). Notify ENACOM/IFT/ANATEL to require emission filter on FM transmitter.',
      expectedKpiImpact: ['Full resolution after FM station emission filter installation'],
      neighborImpactRadiusKm: 0,
      urgency: 'MEDIUM',
      requiresFieldVisit: true,
    },
    {
      id: 'fm_fss',
      title: 'Evolved UL Frequency-Selective Scheduling (FAJ 121 4966)',
      type: 'CM',
      featureId: 'FAJ 121 4966',
      description: 'Avoids the specific 1–3 PRBs impacted by the FM harmonic spike, preserving UL SINR on all other PRBs.',
      expectedKpiImpact: ['UL SINR improvement for PUSCH on clean PRBs', 'Narrow impact: only affected PRBs blocked'],
      neighborImpactRadiusKm: 0,
      urgency: 'LOW',
      requiresFieldVisit: false,
    },
    {
      id: 'fm_ul_spectrum',
      title: 'Activate UL Spectrum Analyzer (FAJ 121 4271)',
      type: 'CM',
      featureId: 'FAJ 121 4271',
      description: 'Confirms the exact PRB position of the FM harmonic spike and provides frequency (PRB index × channel raster) to identify the responsible FM station.',
      expectedKpiImpact: ['Diagnostic: pinpoints harmonic PRB for targeted avoidance'],
      neighborImpactRadiusKm: 0,
      urgency: 'HIGH',
      requiresFieldVisit: false,
    },
  ],

  MILITARY_POLICE: [
    {
      id: 'military_regulatory',
      title: 'Regulatory Escalation — Licensed Military/Police',
      type: 'REGULATORY',
      description: 'Document spectral evidence (ascending slope, frequency range). Escalate to national regulator. No network action possible — source is licensed.',
      expectedKpiImpact: ['Possible frequency coordination in long term'],
      neighborImpactRadiusKm: 0,
      urgency: 'MEDIUM',
      requiresFieldVisit: true,
    },
    {
      id: 'military_ul_spectrum',
      title: 'Activate UL Spectrum Analyzer (FAJ 121 4271)',
      type: 'CM',
      featureId: 'FAJ 121 4271',
      description: 'Collects PRB-level interference histogram to document the characteristic ascending slope for regulatory evidence file.',
      expectedKpiImpact: ['Diagnostic: provides spectral evidence for regulator complaint'],
      neighborImpactRadiusKm: 0,
      urgency: 'HIGH',
      requiresFieldVisit: false,
    },
    {
      id: 'military_mob_poor_cov',
      title: 'Mobility Control at Poor Coverage (FAJ 121 3013)',
      type: 'CM',
      featureId: 'FAJ 121 3013',
      description: 'Triggers coverage-based handover for UEs in the edge PRBs most affected by military/police adjacent-band interference. Moves UEs to cells less affected by the ascending-slope source.',
      prerequisites: ['Neighbour cell at different azimuth or band available'],
      expectedKpiImpact: ['Edge-UE handover success rate improvement', 'UL drops reduced in affected sector'],
      neighborImpactRadiusKm: 1.5,
      urgency: 'MEDIUM',
      requiresFieldVisit: false,
    },
  ],

  ATMOSPHERIC_DUCTING: [
    {
      id: 'duct_reduction',
      title: 'Enable Atmospheric Duct Interference Reduction (FAJ 121 1752)',
      type: 'CM',
      featureId: 'FAJ 121 1752',
      description: 'Detects ducting conditions via correlation across multiple cells; applies CRS muting and UL interference compensation. Effective for TDD-LTE and FDD with duct patterns.',
      expectedKpiImpact: ['RSSI floor –5–10 dB during duct events', 'UL throughput improved at night/early morning'],
      neighborImpactRadiusKm: 2.0,
      urgency: 'LOW',
      requiresFieldVisit: false,
    },
    {
      id: 'duct_tdd_guard',
      title: 'Increase TDD Guard Period (TDD only)',
      type: 'CM',
      description: 'For TDD cells, increase guard period to reduce interference from distant cells propagating via tropospheric ducting (200+ km).',
      prerequisites: ['TDD cell only'],
      expectedKpiImpact: ['Self-interference –3–8 dB', 'Cell edge quality improvement'],
      neighborImpactRadiusKm: 0,
      urgency: 'LOW',
      requiresFieldVisit: false,
    },
  ],

  WIFI_CAMERA_UNLICENSED_850: [
    {
      id: 'wifi_field',
      title: 'Field Hunt — Unlicensed Device (850 MHz)',
      type: 'FIELD',
      description: 'Compare RSSI across sectors to determine direction; survey nearest buildings with security cameras or industrial equipment in 820–860 MHz; measure distance gradient.',
      expectedKpiImpact: ['RSSI normalisation after device removal/replacement'],
      neighborImpactRadiusKm: 0,
      urgency: 'MEDIUM',
      requiresFieldVisit: true,
    },
    {
      id: 'wifi_irc',
      title: 'Enable IRC for AAS FDD (FAJ 121 4919)',
      type: 'CM',
      featureId: 'FAJ 121 4919',
      description: 'IRC for AAS FDD exploits the angular separation between the cellular sector and the directional WiFi camera / unlicensed 850 MHz device to reject spatially distinct interference.',
      expectedKpiImpact: ['UL SINR +2–5 dB', 'PUSCH BLER reduction'],
      prerequisites: ['AAS or 4RX radio unit (AIR series)'],
      neighborImpactRadiusKm: 0,
      urgency: 'MEDIUM',
      requiresFieldVisit: false,
    },
    {
      id: 'wifi_ul_spectrum',
      title: 'Activate UL Spectrum Analyzer (FAJ 121 4271)',
      type: 'CM',
      featureId: 'FAJ 121 4271',
      description: 'Provides PRB histogram per sector to compare interference levels across azimuths, confirming the directional pattern characteristic of WiFi cameras / unlicensed 850 MHz devices.',
      expectedKpiImpact: ['Diagnostic: confirms source direction for field hunt'],
      neighborImpactRadiusKm: 0,
      urgency: 'HIGH',
      requiresFieldVisit: false,
    },
  ],

  UNKNOWN_PERSISTENT: [
    {
      id: 'unknown_field',
      title: 'Full Field Interference Hunt',
      type: 'FIELD',
      description: 'Perform full spectrum sweep (570–3800 MHz) with PCTEL SeeGull + log-periodic antenna; record spectrogram; identify source type before applying mitigation.',
      expectedKpiImpact: ['Enables targeted resolution'],
      neighborImpactRadiusKm: 0,
      urgency: 'MEDIUM',
      requiresFieldVisit: true,
    },
  ],
}

// ---------------------------------------------------------------------------
// Main classify function
// ---------------------------------------------------------------------------

/** Haversine distance in km */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371
  const dLat = (lat2 - lat1) * (Math.PI / 180)
  const dLon = (lon2 - lon1) * (Math.PI / 180)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export type AnalysisContext = {
  cellId: string
  bandNum: number
  bwMhz: number
  siteLat: number
  siteLon: number
  prbHistogram: number[][]
  trafficPerHour: number[]
  kpi?: CellKPI
  /** All other sites for neighbor impact analysis */
  allSites: Array<{ id: string; lat: number; lon: number; cells: string[] }>
}

export function analyzeCell(ctx: AnalysisContext): CellAnalysis {
  const { cellId, bandNum, bwMhz, siteLat, siteLon, prbHistogram, trafficPerHour } = ctx

  const features = extractFeatures(prbHistogram, trafficPerHour, bandNum, bwMhz)

  // Run scorers
  const rawMatches: SourceMatch[] = []
  for (const [st, scorer] of Object.entries(SCORERS) as [SourceType, Scorer][]) {
    if (st === 'UNKNOWN_PERSISTENT') continue
    const [score, evidence] = scorer(features)
    if (score < MIN_CONFIDENCE) continue
    const compat = BAND_COMPAT[st]
    const bandOk = compat.length === 0 || compat.includes(bandNum)
    const finalScore = bandOk ? score : score * 0.55
    if (finalScore < MIN_CONFIDENCE) continue
    rawMatches.push({
      sourceType: st,
      label: LABELS[st],
      confidence: Math.round(clamp(finalScore) * 1000) / 1000,
      evidence,
      severity: SEVERITY_MAP[st],
      actionHint: ACTION_HINTS[st],
      bandConsistent: bandOk,
    })
  }
  rawMatches.sort((a, b) => b.confidence - a.confidence)

  // Fallback
  const topConf = rawMatches[0]?.confidence ?? 0
  if (topConf < FALLBACK_CONFIDENCE && features.floorElevationDb > 5) {
    rawMatches.push({
      sourceType: 'UNKNOWN_PERSISTENT',
      label: LABELS['UNKNOWN_PERSISTENT'],
      confidence: clamp(0.30 + Math.min(features.floorElevationDb / 40, 0.30)),
      evidence: [
        `floor +${features.floorElevationDb.toFixed(1)} dB above thermal`,
        'no specific signature matched — field investigation required',
      ],
      severity: 'MEDIUM',
      actionHint: ACTION_HINTS['UNKNOWN_PERSISTENT'],
      bandConsistent: true,
    })
  }

  const primarySource: SourceType = rawMatches[0]?.sourceType ?? 'UNKNOWN_PERSISTENT'

  // Find neighbors within 1 km
  const nearbyNeighborIds: string[] = []
  for (const s of ctx.allSites) {
    const d = haversineKm(siteLat, siteLon, s.lat, s.lon)
    if (d <= 1.0 && s.cells.some(cid => cid !== cellId)) {
      nearbyNeighborIds.push(...s.cells.filter(cid => cid !== cellId))
    }
  }

  // Build mitigations with neighbor impact
  const baseMitigations = MITIGATIONS[primarySource] ?? MITIGATIONS['UNKNOWN_PERSISTENT']!
  const mitigations: MitigationAction[] = baseMitigations.map(m => {
    if (m.neighborImpactRadiusKm <= 0) return m
    const affectedCellIds: string[] = []
    for (const s of ctx.allSites) {
      const d = haversineKm(siteLat, siteLon, s.lat, s.lon)
      if (d <= m.neighborImpactRadiusKm) {
        affectedCellIds.push(...s.cells.filter(cid => cid !== cellId))
      }
    }
    return {
      ...m,
      neighborImpact: {
        affectedCellIds,
        capacityDeltaPct: m.type === 'CM' ? -5 : 0,
        description:
          affectedCellIds.length > 0
            ? `${affectedCellIds.length} cell(s) within ${m.neighborImpactRadiusKm} km may receive additional load`
            : 'No neighbors within impact radius',
      },
    }
  })

  const searchRadius = SOURCE_SEARCH_RADIUS_KM[primarySource]

  return {
    cellId,
    primarySource,
    matches: rawMatches,
    features,
    mitigations,
    nearbyNeighborIds,
    estimatedSourceLat: siteLat,
    estimatedSourceLon: siteLon,
    sourceSearchRadiusKm: searchRadius,
  }
}
