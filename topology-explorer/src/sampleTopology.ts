import type { Topology } from './types'

// ---------------------------------------------------------------------------
// PRB histogram generators for sample data (50 PRBs × 24 hours)
// ---------------------------------------------------------------------------
const N = 50
const THERMAL = -108.0

/** Flat wideband — Cable TV / BDA oscillation signatures */
function flatHistogram(level: number): number[][] {
  return Array.from({ length: N }, () => Array(24).fill(level))
}

/** Business-hours narrowband — Jammer signature */
function jammerHistogram(onLevel: number, centerPrb = 25, widthPrb = 7): number[][] {
  return Array.from({ length: N }, (_, prb) =>
    Array.from({ length: 24 }, (__, h) =>
      Math.abs(prb - centerPrb) <= widthPrb / 2 && h >= 7 && h < 19
        ? onLevel
        : THERMAL
    )
  )
}

/** Traffic-correlated mid-band — PIM signature */
function pimHistogram(traffic: number[], startPrb = 18, endPrb = 38, amplitude = 12): number[][] {
  return Array.from({ length: N }, (_, prb) =>
    Array.from({ length: 24 }, (__, h) =>
      prb >= startPrb && prb < endPrb
        ? THERMAL + amplitude * traffic[h]
        : THERMAL
    )
  )
}

/** Bottom PRBs static — TV Digital 700 / WISP static */
function bottomPrbHistogram(nLow: number, lowLevel: number): number[][] {
  return Array.from({ length: N }, (_, prb) =>
    Array(24).fill(prb < nLow ? lowLevel : THERMAL)
  )
}

/** Night-heavy wideband — Atmospheric ducting */
function ductingHistogram(nightLevel: number, dayLevel: number): number[][] {
  return Array.from({ length: N }, () =>
    Array.from({ length: 24 }, (_, h) =>
      h >= 21 || h < 6 ? nightLevel : dayLevel
    )
  )
}

/** Ascending slope — Military/police */
function slopedHistogram(baseLow: number, slopeDbPrb: number): number[][] {
  return Array.from({ length: N }, (_, prb) =>
    Array(24).fill(baseLow + prb * slopeDbPrb)
  )
}

/**
 * FM Radio Harmonic — partial-band elevation at LOW PRBs, continuous 24/7 (VALX1509Y2A pattern).
 *
 * Field evidence (Movistar AR + SeeWave spectrum captures) shows the FM harmonic
 * desensitises ~60% of PRBs even though the RF spike is ≤1.5 MHz wide. The front-end
 * blocking effect spreads the interference across adjacent PRBs.
 *
 * Example: 8th harmonic of 103.3 MHz FM = 826.4 MHz → falls at the LOW end of
 * B5 UL (824–849 MHz), elevating PRBs 0–30 to ~-70 dBm while PRBs 31–49 stay at thermal.
 *
 * @param nAffected  Number of PRBs elevated (typically 28–35 for a 10 MHz channel, ~60%)
 * @param level      Interference level in dBm at the affected PRBs (e.g. -70.0)
 */
function fmHarmonicHistogram(nAffected = 31, level = -70.0): number[][] {
  return Array.from({ length: N }, (_, prb) =>
    Array(24).fill(prb < nAffected ? level : THERMAL)
  )
}

/**
 * FM Harmonic bilateral-edge pattern (BALX0407M1A pattern).
 *
 * Occurs when harmonics from two different FM stations hit both ends of the LTE UL band,
 * or when the harmonic falls near the channel edge and front-end IM products appear
 * symmetrically. Both edge blocks are elevated, centre PRBs are cleaner.
 *
 * @param edgePrbs  Width of each edge block in PRBs (e.g. 9 → PRBs 0–8 and 41–49)
 * @param level     Interference level at edges in dBm (e.g. -70.0)
 */
function fmHarmonicEdgeHistogram(edgePrbs = 9, level = -70.0): number[][] {
  return Array.from({ length: N }, (_, prb) =>
    Array(24).fill(prb < edgePrbs || prb >= N - edgePrbs ? level : THERMAL)
  )
}

/** Wideband moderate, slightly higher business hours — BDA Excess Gain */
function bdaExcessGainHistogram(baseLevel: number): number[][] {
  return Array.from({ length: N }, () =>
    Array.from({ length: 24 }, (_, h) =>
      h >= 8 && h < 20 ? baseLevel + 3.5 : baseLevel   // +3.5 dB during occupancy
    )
  )
}

/** Bottom PRBs elevated during business hours — WISP 2500 MHz */
function wispHistogram(nLow: number, level: number): number[][] {
  return Array.from({ length: N }, (_, prb) =>
    Array.from({ length: 24 }, (__, h) =>
      prb < nLow && h >= 8 && h < 22 ? level : THERMAL
    )
  )
}

/** Broad wideband, slight daytime variation, moderate level — WiFi Camera 850 */
function wifiCameraHistogram(level: number): number[][] {
  return Array.from({ length: N }, (_, prb) =>
    Array.from({ length: 24 }, (__, h) => {
      const broadness = 1 - Math.abs(prb - N / 2) / (N * 0.9)   // highest in center, tapers at edges
      const timeVar = h >= 6 && h < 23 ? 1.0 : 0.55             // slightly lower at night
      return level + 8 * broadness * timeVar - 8                  // range ~level-8 to level
    })
  )
}

/** Flat wideband severe, continuous — BDA Oscillation (already resolved in prev week) */
function bdaOscillationHistogram(level: number): number[][] {
  return Array.from({ length: N }, () => Array(24).fill(level))
}

/** Elevated but inconsistent pattern — Unknown Persistent */
function unknownPersistentHistogram(baseLevel: number): number[][] {
  // Pseudo-random but deterministic pattern to simulate unexplained interference
  return Array.from({ length: N }, (_, prb) =>
    Array.from({ length: 24 }, (__, h) => {
      const seed = (prb * 31 + h * 7) % 17
      return baseLevel + seed * 0.4   // irregular ±3 dB variation
    })
  )
}

const BUSINESS_TRAFFIC = [
  0.1, 0.1, 0.1, 0.1, 0.1, 0.2,
  0.4, 0.7, 0.9, 1.0, 1.0, 1.0,
  1.0, 0.9, 0.9, 0.8, 0.7, 0.5,
  0.3, 0.2, 0.2, 0.1, 0.1, 0.1,
]
const FLAT_TRAFFIC = Array(24).fill(0.5)
const NIGHT_TRAFFIC = [
  0.6, 0.8, 0.9, 0.9, 0.8, 0.6,
  0.4, 0.3, 0.2, 0.2, 0.2, 0.2,
  0.2, 0.2, 0.2, 0.3, 0.4, 0.5,
  0.6, 0.6, 0.7, 0.7, 0.7, 0.6,
]

const sampleTopology: Topology = {
  version: '1.0',
  sites: [
    {
      id: 'S001',
      name: 'SITE A - MADRID CENTRO',
      lat: 40.4168,
      lon: -3.7038,
      region: 'Madrid',
      city: 'Madrid',
    },
    {
      id: 'S002',
      name: 'SITE B - BARCELONA NORTE',
      lat: 41.3851,
      lon: 2.1734,
      region: 'Cataluña',
      city: 'Barcelona',
    },
    {
      id: 'S003',
      name: 'SITE C - VALENCIA SUR',
      lat: 39.4699,
      lon: -0.3763,
      region: 'Valencia',
      city: 'Valencia',
    },
    {
      id: 'S004',
      name: 'SITE D - SEVILLA ESTE',
      lat: 37.3891,
      lon: -5.9845,
      region: 'Andalucía',
      city: 'Sevilla',
    },
    {
      id: 'S005',
      name: 'SITE E - ZARAGOZA CENTRO',
      lat: 41.6488,
      lon: -0.8891,
      region: 'Aragón',
      city: 'Zaragoza',
    },
    {
      id: 'S006',
      name: 'SITE F - MÁLAGA OESTE',
      lat: 36.7213,
      lon: -4.4214,
      region: 'Andalucía',
      city: 'Málaga',
    },
    {
      id: 'S007',
      name: 'SITE G - MURCIA NORTE',
      lat: 37.9922,
      lon: -1.1307,
      region: 'Murcia',
      city: 'Murcia',
    },
    {
      id: 'S008',
      name: 'SITE H - PALMA CENTRO',
      lat: 39.5696,
      lon: 2.6502,
      region: 'Baleares',
      city: 'Palma',
    },
    {
      id: 'S009',
      name: 'SITE I - LAS PALMAS SUR',
      lat: 28.1235,
      lon: -15.4363,
      region: 'Canarias',
      city: 'Las Palmas',
    },
    {
      id: 'S010',
      name: 'SITE J - BILBAO ESTE',
      lat: 43.2630,
      lon: -2.9350,
      region: 'País Vasco',
      city: 'Bilbao',
    },
    // --- Nuevos sitios con firmas de interferencia completas ---
    {
      id: 'S011',
      name: 'SITE K - GRANADA RADIO',
      lat: 37.1773,
      lon: -3.5986,
      region: 'Andalucía',
      city: 'Granada',
    },
    {
      id: 'S012',
      name: 'SITE L - ALICANTE COSTA',
      lat: 38.3452,
      lon: -0.4815,
      region: 'Valencia',
      city: 'Alicante',
    },
    {
      id: 'S013',
      name: 'SITE M - SANTANDER INDUSTRIAL',
      lat: 43.4623,
      lon: -3.8099,
      region: 'Cantabria',
      city: 'Santander',
    },
    {
      id: 'S014',
      name: 'SITE N - CÓRDOBA POLÍGONO',
      lat: 37.8882,
      lon: -4.7794,
      region: 'Andalucía',
      city: 'Córdoba',
    },
    {
      id: 'S015',
      name: 'SITE O - VIGO PORTUARIO',
      lat: 42.2328,
      lon: -8.7226,
      region: 'Galicia',
      city: 'Vigo',
    },
    {
      id: 'S016',
      name: 'SITE P - HUELVA COSTA',
      lat: 37.2614,
      lon: -6.9447,
      region: 'Andalucía',
      city: 'Huelva',
    },
  ],
  cells: [
    // S001 - Bogota Centro
    {
      id: 'C001',
      siteId: 'S001',
      tech: 'LTE',
      band: 'B3',
      bandNum: 3,
      bwMhz: 10,
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      earfcn: 1800,
      pci: 10,
      azimuth: 0,
      tilt: 2,
      prbHistogram: flatHistogram(-95.0),
      trafficPerHour: FLAT_TRAFFIC,
      kpi: { rssi_avg_dbm: -95, ul_sinr_p50_db: -2.5, pusch_bler_avg: 0.12, ul_thp_mbps: 4.2, prb_util_ul: 0.45 },
    },
    {
      id: 'C002',
      siteId: 'S001',
      tech: 'NR',
      band: 'n78',
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      pci: 101,
      azimuth: 120,
      tilt: 3,
    },
    {
      id: 'C003',
      siteId: 'S001',
      tech: 'LTE',
      band: 'B7',
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      earfcn: 2600,
      pci: 22,
      azimuth: 240,
      tilt: 1,
    },
    // S002 - Medellin Norte
    {
      id: 'C004',
      siteId: 'S002',
      tech: 'LTE',
      band: 'B7',
      bandNum: 7,
      bwMhz: 10,
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      earfcn: 2600,
      pci: 34,
      azimuth: 0,
      tilt: 2,
      prbHistogram: jammerHistogram(-74.0, 25, 7),
      // Semana anterior: jammer igual de fuerte, sin mejora aún
      prbHistogramPrev: jammerHistogram(-73.5, 25, 7),
      trafficPerHour: FLAT_TRAFFIC,
      kpi: { rssi_avg_dbm: -88, ul_sinr_p50_db: -4.1, pusch_bler_avg: 0.22, pucch_bler_avg: 0.18, ul_thp_mbps: 2.1, prb_util_ul: 0.52 },
    },
    {
      id: 'C005',
      siteId: 'S002',
      tech: 'WCDMA',
      band: 'B1',
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      pci: 322,
      azimuth: 120,
      tilt: 1,
    },
    {
      id: 'C006',
      siteId: 'S002',
      tech: 'NR',
      band: 'n78',
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      pci: 87,
      azimuth: 240,
      tilt: 2,
    },
    // S003 - Cali Sur
    {
      id: 'C007',
      siteId: 'S003',
      tech: 'GSM',
      band: 'G900',
      vendor: 'ERICSSON',
      hBeamwidth: 90,
      pci: 12,
      azimuth: 0,
      tilt: 1,
    },
    {
      id: 'C008',
      siteId: 'S003',
      tech: 'LTE',
      band: 'B28',
      bandNum: 28,
      bwMhz: 10,
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      earfcn: 700,
      pci: 44,
      azimuth: 120,
      tilt: 2,
      prbHistogram: bottomPrbHistogram(10, -91.0),
      trafficPerHour: FLAT_TRAFFIC,
      kpi: { rssi_avg_dbm: -92, ul_sinr_p50_db: -3.2, pusch_bler_avg: 0.15, ul_thp_mbps: 3.1, prb_util_ul: 0.48 },
    },
    {
      id: 'C009',
      siteId: 'S003',
      tech: 'NR',
      band: 'n78',
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      pci: 156,
      azimuth: 240,
      tilt: 3,
    },
    // S004 - Barranquilla Este
    {
      id: 'C010',
      siteId: 'S004',
      tech: 'NR',
      band: 'n78',
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      pci: 87,
      azimuth: 0,
      tilt: 2,
    },
    {
      id: 'C011',
      siteId: 'S004',
      tech: 'LTE',
      band: 'B3',
      bandNum: 3,
      bwMhz: 20,
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      earfcn: 1800,
      pci: 18,
      azimuth: 120,
      tilt: 2,
      prbHistogram: pimHistogram(BUSINESS_TRAFFIC, 18, 38, 12),
      // Semana anterior: PIM más severo (antes de aplicar PIM Avoidance FAJ 121 5448)
      prbHistogramPrev: pimHistogram(BUSINESS_TRAFFIC, 18, 38, 18),
      trafficPerHour: BUSINESS_TRAFFIC,
      kpi: { rssi_avg_dbm: -97, ul_sinr_p50_db: -1.8, pusch_bler_avg: 0.10, ul_thp_mbps: 5.8, prb_util_ul: 0.60 },
    },
    // S005 - Bogota Norte
    {
      id: 'C012',
      siteId: 'S005',
      tech: 'LTE',
      band: 'B3',
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      earfcn: 1800,
      pci: 56,
      azimuth: 60,
      tilt: 2,
    },
    {
      id: 'C013',
      siteId: 'S005',
      tech: 'WCDMA',
      band: 'B1',
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      pci: 355,
      azimuth: 180,
      tilt: 1,
    },
    // S006 - Manizales Centro
    {
      id: 'C014',
      siteId: 'S006',
      tech: 'WCDMA',
      band: 'B1',
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      pci: 288,
      azimuth: 0,
      tilt: 1,
    },
    {
      id: 'C015',
      siteId: 'S006',
      tech: 'LTE',
      band: 'B7',
      bandNum: 7,
      bwMhz: 10,
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      earfcn: 2600,
      pci: 78,
      azimuth: 120,
      tilt: 2,
      prbHistogram: ductingHistogram(-84.0, -105.0),
      trafficPerHour: FLAT_TRAFFIC,
      kpi: { rssi_avg_dbm: -90, ul_sinr_p50_db: -2.0, pusch_bler_avg: 0.08, ul_thp_mbps: 6.5 },
    },
    // S007 - Cartagena Sur
    {
      id: 'C016',
      siteId: 'S007',
      tech: 'GSM',
      band: 'G900',
      vendor: 'ERICSSON',
      hBeamwidth: 90,
      pci: 25,
      azimuth: 0,
      tilt: 1,
    },
    {
      id: 'C017',
      siteId: 'S007',
      tech: 'LTE',
      band: 'B28',
      bandNum: 28,
      bwMhz: 10,
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      earfcn: 700,
      pci: 92,
      azimuth: 120,
      tilt: 2,
      prbHistogram: flatHistogram(-72.0),
      trafficPerHour: FLAT_TRAFFIC,
      kpi: { rssi_avg_dbm: -72, ul_sinr_p50_db: -8.5, pusch_bler_avg: 0.42, pucch_bler_avg: 0.38, ul_thp_mbps: 0.4, prb_util_ul: 0.25 },
    },
    // S008 - Pereira Oeste
    {
      id: 'C018',
      siteId: 'S008',
      tech: 'LTE',
      band: 'B3',
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      earfcn: 1800,
      pci: 134,
      azimuth: 0,
      tilt: 2,
    },
    {
      id: 'C019',
      siteId: 'S008',
      tech: 'NR',
      band: 'n78',
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      pci: 203,
      azimuth: 120,
      tilt: 3,
    },
    // S009 - Cucuta Norte
    {
      id: 'C020',
      siteId: 'S009',
      tech: 'WCDMA',
      band: 'B1',
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      pci: 411,
      azimuth: 0,
      tilt: 1,
    },
    {
      id: 'C021',
      siteId: 'S009',
      tech: 'LTE',
      band: 'B7',
      bandNum: 7,
      bwMhz: 10,
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      earfcn: 2600,
      pci: 167,
      azimuth: 120,
      tilt: 2,
      prbHistogram: slopedHistogram(-108.0, 0.20),
      trafficPerHour: FLAT_TRAFFIC,
      kpi: { rssi_avg_dbm: -98, ul_sinr_p50_db: -1.5, pusch_bler_avg: 0.09, ul_thp_mbps: 5.2 },
    },
    // S010 - Bilbao Este
    {
      id: 'C022',
      siteId: 'S010',
      tech: 'LTE',
      band: 'B3',
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      earfcn: 1800,
      pci: 189,
      azimuth: 0,
      tilt: 2,
    },
    {
      id: 'C023',
      siteId: 'S010',
      tech: 'NR',
      band: 'n78',
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      pci: 245,
      azimuth: 120,
      tilt: 3,
    },

    // =========================================================================
    // S011 - GRANADA RADIO — FM HARMONIC (B5/B17, 850 MHz)
    // Estación FM 105.3 MHz, armónico 8vo: 842.4 MHz → PRB 8 de B5
    // Mitigación: UL Spectrum Analyzer (FAJ 121 4271) + FSS (FAJ 121 4966)
    // Delta: PREV sin FSS (harmónico al -76 dBm) → CURRENT con FSS (-76 dBm mismo
    //        pero KPI mejorado; se ve en prev el impacto mayor en PRBs adyacentes)
    // =========================================================================
    {
      id: 'C024',
      siteId: 'S011',
      tech: 'LTE',
      band: 'B5',
      bandNum: 5,
      bwMhz: 10,
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      earfcn: 850,
      pci: 77,
      azimuth: 45,
      tilt: 3,
      // CURRENT: 8th harmonic 103.3 MHz × 8 = 826.4 MHz → LOW end of B5 UL (824–849 MHz)
      // ~31/50 PRBs elevated at -70 dBm (VALX1509Y2A pattern). FAJ 4271 confirmed PRB position.
      prbHistogram: fmHarmonicHistogram(31, -70.0),
      // PREV: before FAJ 4271 spectrum scan, wider affected zone and more severe (35 PRBs at -67 dBm)
      prbHistogramPrev: fmHarmonicHistogram(35, -67.0),
      trafficPerHour: FLAT_TRAFFIC,
      kpi: { rssi_avg_dbm: -88, ul_sinr_p50_db: -2.4, pusch_bler_avg: 0.14, ul_thp_mbps: 4.3, prb_util_ul: 0.55 },
    },
    {
      id: 'C025',
      siteId: 'S011',
      tech: 'LTE',
      band: 'B5',
      bandNum: 5,
      bwMhz: 10,
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      earfcn: 850,
      pci: 78,
      azimuth: 165,
      tilt: 2,
      // Same site, different azimuth — FM harmonic less visible (18/50 PRBs affected at -84 dBm)
      // Bilateral edge pattern (BALX0407M1A): two FM harmonics hitting both ends of the band
      prbHistogram: fmHarmonicEdgeHistogram(9, -72.0),
      trafficPerHour: FLAT_TRAFFIC,
      kpi: { rssi_avg_dbm: -99, ul_sinr_p50_db: -0.3, pusch_bler_avg: 0.05, ul_thp_mbps: 7.8, prb_util_ul: 0.40 },
    },
    {
      id: 'C026',
      siteId: 'S011',
      tech: 'LTE',
      band: 'B5',
      bandNum: 5,
      bwMhz: 10,
      vendor: 'HUAWEI',
      hBeamwidth: 65,
      earfcn: 850,
      pci: 79,
      azimuth: 285,
      tilt: 2,
    },

    // =========================================================================
    // S012 - ALICANTE COSTA — CABLE TV LEAKAGE (B28, 700 MHz)
    // Red de cable TV antigua en área costera, TAPs oxidados
    // Mitigación: IRC AAS (FAJ 121 4919) + UL-ITFM (FAJ 121 0484)
    // Delta: PREV sin IRC → CURRENT con IRC activo (-5 dB mejora)
    // =========================================================================
    {
      id: 'C027',
      siteId: 'S012',
      tech: 'LTE',
      band: 'B28',
      bandNum: 28,
      bwMhz: 10,
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      earfcn: 700,
      pci: 55,
      azimuth: 10,
      tilt: 3,
      prbHistogram: flatHistogram(-93.0),
      // PREV: sin IRC, interferencia cable TV 5 dB más severa
      prbHistogramPrev: flatHistogram(-88.0),
      trafficPerHour: FLAT_TRAFFIC,
      kpi: { rssi_avg_dbm: -93, ul_sinr_p50_db: -2.1, pusch_bler_avg: 0.11, ul_thp_mbps: 4.8, prb_util_ul: 0.44 },
    },
    {
      id: 'C028',
      siteId: 'S012',
      tech: 'LTE',
      band: 'B28',
      bandNum: 28,
      bwMhz: 10,
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      earfcn: 700,
      pci: 56,
      azimuth: 130,
      tilt: 2,
      // Sector con menor exposición al cable TV
      prbHistogram: flatHistogram(-101.0),
      trafficPerHour: FLAT_TRAFFIC,
      kpi: { rssi_avg_dbm: -101, ul_sinr_p50_db: 1.2, pusch_bler_avg: 0.02, ul_thp_mbps: 12.3, prb_util_ul: 0.29 },
    },
    {
      id: 'C029',
      siteId: 'S012',
      tech: 'LTE',
      band: 'B28',
      bandNum: 28,
      bwMhz: 10,
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      earfcn: 700,
      pci: 57,
      azimuth: 250,
      tilt: 4,
      prbHistogram: flatHistogram(-96.0),
      trafficPerHour: FLAT_TRAFFIC,
      kpi: { rssi_avg_dbm: -96, ul_sinr_p50_db: -1.5, pusch_bler_avg: 0.07, ul_thp_mbps: 6.9, prb_util_ul: 0.41 },
    },

    // =========================================================================
    // S013 - SANTANDER INDUSTRIAL — WISP 2500 MHz (B41)
    // Nodo WISP en azotea edificio industrial, TX en 2500–2515 MHz
    // Mitigación: PUCCH Overdimensioning (FAJ 121 2204) + FSS (FAJ 121 4966) + Flex BW (FAJ 121 4756)
    // Delta: PREV sin ninguna mitigación → CURRENT con PUCCH OD + FSS activos
    // =========================================================================
    {
      id: 'C030',
      siteId: 'S013',
      tech: 'LTE',
      band: 'B41',
      bandNum: 41,
      bwMhz: 20,
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      earfcn: 2500,
      pci: 112,
      azimuth: 20,
      tilt: 2,
      prbHistogram: wispHistogram(12, -86.0),
      // PREV: WISP sin ninguna mitigación — bottom PRBs +6 dB más severos
      prbHistogramPrev: wispHistogram(12, -80.0),
      trafficPerHour: BUSINESS_TRAFFIC,
      kpi: { rssi_avg_dbm: -89, ul_sinr_p50_db: -2.8, pusch_bler_avg: 0.19, pucch_bler_avg: 0.22, ul_thp_mbps: 3.4, prb_util_ul: 0.56 },
    },
    {
      id: 'C031',
      siteId: 'S013',
      tech: 'LTE',
      band: 'B41',
      bandNum: 41,
      bwMhz: 20,
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      earfcn: 2500,
      pci: 113,
      azimuth: 140,
      tilt: 3,
    },
    {
      id: 'C032',
      siteId: 'S013',
      tech: 'LTE',
      band: 'B41',
      bandNum: 41,
      bwMhz: 20,
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      earfcn: 2500,
      pci: 114,
      azimuth: 260,
      tilt: 2,
      // Sector con WISP moderado (no frente directo)
      prbHistogram: wispHistogram(8, -91.0),
      trafficPerHour: BUSINESS_TRAFFIC,
      kpi: { rssi_avg_dbm: -92, ul_sinr_p50_db: -1.1, pusch_bler_avg: 0.08, ul_thp_mbps: 7.2, prb_util_ul: 0.49 },
    },

    // =========================================================================
    // S014 - CÓRDOBA POLÍGONO — BDA EXCESS GAIN (B3) + BDA OSCILLATION (B5)
    // BDA en edificio industrial: un sector en B3 con excess gain, otro en B5 oscilando
    // Mitigación BDA EG: Field hunt + UL-ITFM (FAJ 121 0484)
    // Mitigación BDA OSC: Regulatoria + UL-ITFM como temporal
    // Delta OSC: PREV oscilando -74 dBm → CURRENT regulatoria aplicada (mejoró a -105 dBm)
    // =========================================================================
    {
      id: 'C033',
      siteId: 'S014',
      tech: 'LTE',
      band: 'B3',
      bandNum: 3,
      bwMhz: 15,
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      earfcn: 1800,
      pci: 143,
      azimuth: 80,
      tilt: 2,
      prbHistogram: bdaExcessGainHistogram(-89.0),
      // PREV: BDA excess gain sin acción de campo, nivel base idéntico
      prbHistogramPrev: bdaExcessGainHistogram(-87.0),
      trafficPerHour: BUSINESS_TRAFFIC,
      kpi: { rssi_avg_dbm: -89, ul_sinr_p50_db: -3.5, pusch_bler_avg: 0.18, ul_thp_mbps: 2.9, prb_util_ul: 0.51 },
    },
    {
      id: 'C034',
      siteId: 'S014',
      tech: 'LTE',
      band: 'B5',
      bandNum: 5,
      bwMhz: 10,
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      earfcn: 850,
      pci: 144,
      azimuth: 200,
      tilt: 3,
      // BDA Oscillation RESUELTO: acción regulatoria aplicada, celda recuperada
      prbHistogram: flatHistogram(-105.0),
      // PREV: oscilación activa, interferencia crítica
      prbHistogramPrev: bdaOscillationHistogram(-74.0),
      trafficPerHour: FLAT_TRAFFIC,
      kpi: { rssi_avg_dbm: -105, ul_sinr_p50_db: 3.2, pusch_bler_avg: 0.01, ul_thp_mbps: 15.8, prb_util_ul: 0.22 },
    },
    {
      id: 'C035',
      siteId: 'S014',
      tech: 'LTE',
      band: 'B3',
      bandNum: 3,
      bwMhz: 15,
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      earfcn: 1800,
      pci: 145,
      azimuth: 320,
      tilt: 2,
    },

    // =========================================================================
    // S015 - VIGO PORTUARIO — WIFI CAMERA 850 (B5, direccional)
    // Cámaras IP ilegales en instalaciones portuarias transmitiendo en 840 MHz
    // Direccional: sector AZ=30 afectado, sectores 150 y 270 casi limpios
    // Mitigación: IRC AAS (FAJ 121 4919) + UL Spectrum Analyzer (FAJ 121 4271)
    // Delta: PREV sin IRC → CURRENT con IRC (-4 dB mejora en sector afectado)
    // =========================================================================
    {
      id: 'C036',
      siteId: 'S015',
      tech: 'LTE',
      band: 'B5',
      bandNum: 5,
      bwMhz: 10,
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      earfcn: 850,
      pci: 167,
      azimuth: 30,
      tilt: 3,
      // Sector apuntando hacia el puerto — nivel WiFi Camera más alto
      prbHistogram: wifiCameraHistogram(-86.0),
      // PREV: sin IRC AAS, interferencia 4 dB peor
      prbHistogramPrev: wifiCameraHistogram(-82.0),
      trafficPerHour: BUSINESS_TRAFFIC,
      kpi: { rssi_avg_dbm: -86, ul_sinr_p50_db: -2.4, pusch_bler_avg: 0.14, ul_thp_mbps: 3.9, prb_util_ul: 0.48 },
    },
    {
      id: 'C037',
      siteId: 'S015',
      tech: 'LTE',
      band: 'B5',
      bandNum: 5,
      bwMhz: 10,
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      earfcn: 850,
      pci: 168,
      azimuth: 150,
      tilt: 2,
      // Sector opuesto — nivel mucho más bajo, casi limpio
      prbHistogram: wifiCameraHistogram(-98.0),
      trafficPerHour: BUSINESS_TRAFFIC,
      kpi: { rssi_avg_dbm: -98, ul_sinr_p50_db: 1.8, pusch_bler_avg: 0.02, ul_thp_mbps: 13.1, prb_util_ul: 0.33 },
    },
    {
      id: 'C038',
      siteId: 'S015',
      tech: 'LTE',
      band: 'B5',
      bandNum: 5,
      bwMhz: 10,
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      earfcn: 850,
      pci: 169,
      azimuth: 270,
      tilt: 2,
    },

    // =========================================================================
    // S016 - HUELVA COSTA — UNKNOWN PERSISTENT (B3) + ATMOSPHERIC DUCTING (B28)
    // Zona costera: B3 con interferencia sin firma clara; B28 con ducting nocturno
    // Mitigación Unknown: Full field sweep + FAJ 121 4271 para diagnóstico
    // Mitigación Ducting: FAJ 121 1752 Atmospheric Duct Interference Reduction
    // Delta Ducting: PREV sin FAJ 1752 (noches críticas -82 dBm) → CURRENT con feature (-90 dBm)
    // =========================================================================
    {
      id: 'C039',
      siteId: 'S016',
      tech: 'LTE',
      band: 'B3',
      bandNum: 3,
      bwMhz: 20,
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      earfcn: 1800,
      pci: 201,
      azimuth: 15,
      tilt: 2,
      prbHistogram: unknownPersistentHistogram(-100.0),
      // PREV: patrón idéntico, interferencia sin identificar (sin mejora aún)
      prbHistogramPrev: unknownPersistentHistogram(-99.0),
      trafficPerHour: FLAT_TRAFFIC,
      kpi: { rssi_avg_dbm: -100, ul_sinr_p50_db: -1.2, pusch_bler_avg: 0.07, ul_thp_mbps: 6.2, prb_util_ul: 0.40 },
    },
    {
      id: 'C040',
      siteId: 'S016',
      tech: 'LTE',
      band: 'B28',
      bandNum: 28,
      bwMhz: 10,
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      earfcn: 700,
      pci: 202,
      azimuth: 135,
      tilt: 3,
      // Ducting costal: episodios nocturnos severos (costa atlántica, inversión térmica)
      prbHistogram: ductingHistogram(-90.0, -106.0),
      // PREV: sin FAJ 121 1752 — ducting nocturno más severo
      prbHistogramPrev: ductingHistogram(-82.0, -106.0),
      trafficPerHour: NIGHT_TRAFFIC,
      kpi: { rssi_avg_dbm: -96, ul_sinr_p50_db: -1.8, pusch_bler_avg: 0.09, ul_thp_mbps: 5.5, prb_util_ul: 0.43 },
    },
    {
      id: 'C041',
      siteId: 'S016',
      tech: 'LTE',
      band: 'B3',
      bandNum: 3,
      bwMhz: 20,
      vendor: 'ERICSSON',
      hBeamwidth: 65,
      earfcn: 1800,
      pci: 203,
      azimuth: 255,
      tilt: 2,
    },
  ],
  links: [
    {
      id: 'L001',
      fromSiteId: 'S001',
      toSiteId: 'S002',
      kind: 'FO',
    },
    {
      id: 'L002',
      fromSiteId: 'S002',
      toSiteId: 'S003',
      kind: 'FO',
    },
    {
      id: 'L003',
      fromSiteId: 'S003',
      toSiteId: 'S007',
      kind: 'MW',
    },
    {
      id: 'L004',
      fromSiteId: 'S001',
      toSiteId: 'S005',
      kind: 'FO',
    },
    {
      id: 'L005',
      fromSiteId: 'S005',
      toSiteId: 'S002',
      kind: 'FO',
    },
    {
      id: 'L006',
      fromSiteId: 'S004',
      toSiteId: 'S006',
      kind: 'FO',
    },
    {
      id: 'L007',
      fromSiteId: 'S006',
      toSiteId: 'S003',
      kind: 'MW',
    },
    {
      id: 'L008',
      fromSiteId: 'S008',
      toSiteId: 'S003',
      kind: 'MW',
    },
    {
      id: 'L009',
      fromSiteId: 'S010',
      toSiteId: 'S005',
      kind: 'FO',
    },
    {
      id: 'L010',
      fromSiteId: 'S007',
      toSiteId: 'S004',
      kind: 'MW',
    },
    {
      id: 'L011',
      fromSiteId: 'S001',
      toSiteId: 'S010',
      kind: 'FO',
    },
  ],
  interferenceSamples: [
    // Samples for C001 (LTE B3, S001)
    { cellId: 'C001', hour: '0', ni_db: -95.2, pusch_bler: 0.02, pucch_bler: 0.01, score: 85 },
    { cellId: 'C001', hour: '6', ni_db: -92.8, pusch_bler: 0.05, pucch_bler: 0.03, score: 78 },
    { cellId: 'C001', hour: '12', ni_db: -88.5, pusch_bler: 0.12, pucch_bler: 0.08, score: 65 },
    { cellId: 'C001', hour: '18', ni_db: -90.1, pusch_bler: 0.08, pucch_bler: 0.05, score: 72 },
    // Samples for C002 (NR n78, S001)
    { cellId: 'C002', hour: '0', ni_db: -98.7, pusch_bler: 0.01, pucch_bler: 0.005, score: 92 },
    { cellId: 'C002', hour: '6', ni_db: -96.3, pusch_bler: 0.03, pucch_bler: 0.02, score: 88 },
    { cellId: 'C002', hour: '12', ni_db: -94.8, pusch_bler: 0.06, pucch_bler: 0.04, score: 82 },
    { cellId: 'C002', hour: '18', ni_db: -97.2, pusch_bler: 0.02, pucch_bler: 0.01, score: 90 },
    // Samples for C003 (LTE B7, S001)
    { cellId: 'C003', hour: '0', ni_db: -93.4, pusch_bler: 0.04, pucch_bler: 0.02, score: 80 },
    { cellId: 'C003', hour: '6', ni_db: -91.7, pusch_bler: 0.07, pucch_bler: 0.04, score: 74 },
    { cellId: 'C003', hour: '12', ni_db: -87.2, pusch_bler: 0.15, pucch_bler: 0.10, score: 58 },
    { cellId: 'C003', hour: '18', ni_db: -89.8, pusch_bler: 0.09, pucch_bler: 0.06, score: 68 },
    // Samples for C004 (LTE B7, S002)
    { cellId: 'C004', hour: '0', ni_db: -94.1, pusch_bler: 0.03, pucch_bler: 0.02, score: 83 },
    { cellId: 'C004', hour: '6', ni_db: -91.9, pusch_bler: 0.06, pucch_bler: 0.04, score: 76 },
    { cellId: 'C004', hour: '12', ni_db: -86.7, pusch_bler: 0.18, pucch_bler: 0.12, score: 52 },
    { cellId: 'C004', hour: '18', ni_db: -88.3, pusch_bler: 0.11, pucch_bler: 0.07, score: 64 },
    // Samples for C005 (WCDMA B1, S002)
    { cellId: 'C005', hour: '0', ni_db: -96.8, pusch_bler: 0.02, pucch_bler: 0.01, score: 89 },
    { cellId: 'C005', hour: '6', ni_db: -94.5, pusch_bler: 0.04, pucch_bler: 0.02, score: 84 },
    { cellId: 'C005', hour: '12', ni_db: -92.1, pusch_bler: 0.08, pucch_bler: 0.05, score: 74 },
    { cellId: 'C005', hour: '18', ni_db: -95.3, pusch_bler: 0.03, pucch_bler: 0.02, score: 87 },
    // Samples for C006 (NR n78, S002)
    { cellId: 'C006', hour: '0', ni_db: -97.9, pusch_bler: 0.01, pucch_bler: 0.005, score: 91 },
    { cellId: 'C006', hour: '6', ni_db: -95.6, pusch_bler: 0.03, pucch_bler: 0.02, score: 86 },
    { cellId: 'C006', hour: '12', ni_db: -93.2, pusch_bler: 0.07, pucch_bler: 0.04, score: 78 },
    { cellId: 'C006', hour: '18', ni_db: -96.4, pusch_bler: 0.02, pucch_bler: 0.01, score: 89 },
    // Samples for C007 (GSM G900, S003)
    { cellId: 'C007', hour: '0', ni_db: -89.3, pusch_bler: 0.08, pucch_bler: 0.05, score: 69 },
    { cellId: 'C007', hour: '6', ni_db: -87.6, pusch_bler: 0.12, pucch_bler: 0.08, score: 62 },
    { cellId: 'C007', hour: '12', ni_db: -83.4, pusch_bler: 0.22, pucch_bler: 0.15, score: 45 },
    { cellId: 'C007', hour: '18', ni_db: -85.7, pusch_bler: 0.15, pucch_bler: 0.10, score: 55 },
    // Samples for C008 (LTE B28, S003)
    { cellId: 'C008', hour: '0', ni_db: -92.7, pusch_bler: 0.04, pucch_bler: 0.02, score: 81 },
    { cellId: 'C008', hour: '6', ni_db: -90.4, pusch_bler: 0.07, pucch_bler: 0.04, score: 75 },
    { cellId: 'C008', hour: '12', ni_db: -85.9, pusch_bler: 0.16, pucch_bler: 0.11, score: 54 },
    { cellId: 'C008', hour: '18', ni_db: -87.8, pusch_bler: 0.10, pucch_bler: 0.06, score: 66 },
    // Samples for C009 (NR n78, S003)
    { cellId: 'C009', hour: '0', ni_db: -98.1, pusch_bler: 0.01, pucch_bler: 0.005, score: 92 },
    { cellId: 'C009', hour: '6', ni_db: -96.8, pusch_bler: 0.02, pucch_bler: 0.01, score: 89 },
    { cellId: 'C009', hour: '12', ni_db: -94.3, pusch_bler: 0.05, pucch_bler: 0.03, score: 84 },
    { cellId: 'C009', hour: '18', ni_db: -97.5, pusch_bler: 0.01, pucch_bler: 0.005, score: 91 },
    // Samples for C010 (NR n78, S004)
    { cellId: 'C010', hour: '0', ni_db: -97.4, pusch_bler: 0.02, pucch_bler: 0.01, score: 90 },
    { cellId: 'C010', hour: '6', ni_db: -95.1, pusch_bler: 0.04, pucch_bler: 0.02, score: 85 },
    { cellId: 'C010', hour: '12', ni_db: -92.7, pusch_bler: 0.08, pucch_bler: 0.05, score: 76 },
    { cellId: 'C010', hour: '18', ni_db: -96.2, pusch_bler: 0.03, pucch_bler: 0.02, score: 88 },
    // Samples for C011 (LTE B3, S004)
    { cellId: 'C011', hour: '0', ni_db: -93.8, pusch_bler: 0.03, pucch_bler: 0.02, score: 82 },
    { cellId: 'C011', hour: '6', ni_db: -91.5, pusch_bler: 0.06, pucch_bler: 0.04, score: 77 },
    { cellId: 'C011', hour: '12', ni_db: -87.3, pusch_bler: 0.14, pucch_bler: 0.09, score: 59 },
    { cellId: 'C011', hour: '18', ni_db: -89.6, pusch_bler: 0.08, pucch_bler: 0.05, score: 71 },
    // Samples for C012 (LTE B3, S005)
    { cellId: 'C012', hour: '0', ni_db: -94.5, pusch_bler: 0.03, pucch_bler: 0.02, score: 84 },
    { cellId: 'C012', hour: '6', ni_db: -92.2, pusch_bler: 0.05, pucch_bler: 0.03, score: 79 },
    { cellId: 'C012', hour: '12', ni_db: -88.9, pusch_bler: 0.11, pucch_bler: 0.07, score: 67 },
    { cellId: 'C012', hour: '18', ni_db: -90.7, pusch_bler: 0.07, pucch_bler: 0.04, score: 74 },
    // Samples for C013 (WCDMA B1, S005)
    { cellId: 'C013', hour: '0', ni_db: -96.1, pusch_bler: 0.02, pucch_bler: 0.01, score: 88 },
    { cellId: 'C013', hour: '6', ni_db: -93.8, pusch_bler: 0.04, pucch_bler: 0.02, score: 83 },
    { cellId: 'C013', hour: '12', ni_db: -91.4, pusch_bler: 0.07, pucch_bler: 0.04, score: 77 },
    { cellId: 'C013', hour: '18', ni_db: -94.9, pusch_bler: 0.03, pucch_bler: 0.02, score: 86 },
    // Samples for C014 (WCDMA B1, S006)
    { cellId: 'C014', hour: '0', ni_db: -95.7, pusch_bler: 0.02, pucch_bler: 0.01, score: 87 },
    { cellId: 'C014', hour: '6', ni_db: -93.4, pusch_bler: 0.04, pucch_bler: 0.02, score: 82 },
    { cellId: 'C014', hour: '12', ni_db: -90.8, pusch_bler: 0.08, pucch_bler: 0.05, score: 73 },
    { cellId: 'C014', hour: '18', ni_db: -94.2, pusch_bler: 0.03, pucch_bler: 0.02, score: 85 },
    // Samples for C015 (LTE B7, S006)
    { cellId: 'C015', hour: '0', ni_db: -92.9, pusch_bler: 0.04, pucch_bler: 0.02, score: 80 },
    { cellId: 'C015', hour: '6', ni_db: -90.6, pusch_bler: 0.07, pucch_bler: 0.04, score: 75 },
    { cellId: 'C015', hour: '12', ni_db: -86.1, pusch_bler: 0.17, pucch_bler: 0.11, score: 53 },
    { cellId: 'C015', hour: '18', ni_db: -88.4, pusch_bler: 0.10, pucch_bler: 0.06, score: 66 },
    // Samples for C016 (GSM G900, S007)
    { cellId: 'C016', hour: '0', ni_db: -88.7, pusch_bler: 0.09, pucch_bler: 0.06, score: 67 },
    { cellId: 'C016', hour: '6', ni_db: -86.9, pusch_bler: 0.13, pucch_bler: 0.09, score: 60 },
    { cellId: 'C016', hour: '12', ni_db: -82.5, pusch_bler: 0.24, pucch_bler: 0.16, score: 42 },
    { cellId: 'C016', hour: '18', ni_db: -84.8, pusch_bler: 0.16, pucch_bler: 0.11, score: 53 },
    // Samples for C017 (LTE B28, S007)
    { cellId: 'C017', hour: '0', ni_db: -91.8, pusch_bler: 0.05, pucch_bler: 0.03, score: 79 },
    { cellId: 'C017', hour: '6', ni_db: -89.5, pusch_bler: 0.08, pucch_bler: 0.05, score: 73 },
    { cellId: 'C017', hour: '12', ni_db: -85.2, pusch_bler: 0.15, pucch_bler: 0.10, score: 56 },
    { cellId: 'C017', hour: '18', ni_db: -87.1, pusch_bler: 0.09, pucch_bler: 0.06, score: 68 },
    // Samples for C018 (LTE B3, S008)
    { cellId: 'C018', hour: '0', ni_db: -93.2, pusch_bler: 0.04, pucch_bler: 0.02, score: 81 },
    { cellId: 'C018', hour: '6', ni_db: -90.9, pusch_bler: 0.06, pucch_bler: 0.04, score: 76 },
    { cellId: 'C018', hour: '12', ni_db: -86.6, pusch_bler: 0.14, pucch_bler: 0.09, score: 58 },
    { cellId: 'C018', hour: '18', ni_db: -88.8, pusch_bler: 0.08, pucch_bler: 0.05, score: 70 },
    // Samples for C019 (NR n78, S008)
    { cellId: 'C019', hour: '0', ni_db: -97.6, pusch_bler: 0.01, pucch_bler: 0.005, score: 91 },
    { cellId: 'C019', hour: '6', ni_db: -95.3, pusch_bler: 0.03, pucch_bler: 0.02, score: 87 },
    { cellId: 'C019', hour: '12', ni_db: -93.7, pusch_bler: 0.06, pucch_bler: 0.04, score: 81 },
    { cellId: 'C019', hour: '18', ni_db: -96.8, pusch_bler: 0.02, pucch_bler: 0.01, score: 90 },
    // Samples for C020 (WCDMA B1, S009)
    { cellId: 'C020', hour: '0', ni_db: -95.4, pusch_bler: 0.02, pucch_bler: 0.01, score: 86 },
    { cellId: 'C020', hour: '6', ni_db: -93.1, pusch_bler: 0.04, pucch_bler: 0.02, score: 81 },
    { cellId: 'C020', hour: '12', ni_db: -90.5, pusch_bler: 0.08, pucch_bler: 0.05, score: 72 },
    { cellId: 'C020', hour: '18', ni_db: -93.9, pusch_bler: 0.03, pucch_bler: 0.02, score: 84 },
    // Samples for C021 (LTE B7, S009)
    { cellId: 'C021', hour: '0', ni_db: -92.3, pusch_bler: 0.04, pucch_bler: 0.02, score: 79 },
    { cellId: 'C021', hour: '6', ni_db: -89.7, pusch_bler: 0.07, pucch_bler: 0.04, score: 73 },
    { cellId: 'C021', hour: '12', ni_db: -85.4, pusch_bler: 0.16, pucch_bler: 0.11, score: 55 },
    { cellId: 'C021', hour: '18', ni_db: -87.6, pusch_bler: 0.09, pucch_bler: 0.06, score: 67 },
    // Samples for C022 (LTE B3, S010)
    { cellId: 'C022', hour: '0', ni_db: -94.8, pusch_bler: 0.03, pucch_bler: 0.02, score: 85 },
    { cellId: 'C022', hour: '6', ni_db: -92.5, pusch_bler: 0.05, pucch_bler: 0.03, score: 80 },
    { cellId: 'C022', hour: '12', ni_db: -89.1, pusch_bler: 0.10, pucch_bler: 0.07, score: 69 },
    { cellId: 'C022', hour: '18', ni_db: -91.3, pusch_bler: 0.06, pucch_bler: 0.04, score: 76 },
    // Samples for C023 (NR n78, S010)
    { cellId: 'C023', hour: '0', ni_db: -98.4, pusch_bler: 0.01, pucch_bler: 0.005, score: 93 },
    { cellId: 'C023', hour: '6', ni_db: -96.1, pusch_bler: 0.02, pucch_bler: 0.01, score: 89 },
    { cellId: 'C023', hour: '12', ni_db: -94.6, pusch_bler: 0.05, pucch_bler: 0.03, score: 83 },
    { cellId: 'C023', hour: '18', ni_db: -97.8, pusch_bler: 0.01, pucch_bler: 0.005, score: 92 },
  ],
}

export default sampleTopology
