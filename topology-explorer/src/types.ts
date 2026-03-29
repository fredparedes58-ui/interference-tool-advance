export type Tech = 'LTE' | 'NR' | 'WCDMA' | 'GSM' | string

export type Site = {
  id: string
  name: string
  lat: number
  lon: number
  region?: string
  city?: string
}

export type Cell = {
  id: string
  siteId: string
  tech: string
  band?: string
  bandNum?: number          // numeric band (28, 5, 4, 2, 41…)
  bwMhz?: number            // channel bandwidth MHz
  vendor?: string
  hBeamwidth?: number
  earfcn?: number
  pci?: number
  azimuth?: number
  tilt?: number
  /** PRB interference histogram [N_PRB][24] in dBm — used for source classification */
  prbHistogram?: number[][]
  /** Previous week PRB histogram [N_PRB][24] in dBm — for week-over-week comparison */
  prbHistogramPrev?: number[][]
  /** Hourly traffic profile [24] normalised 0–1 */
  trafficPerHour?: number[]
  /** KPI snapshot */
  kpi?: CellKPI
  /** CM (feature configuration flags) */
  cm?: CellCM
}

export type CellKPI = {
  rssi_avg_dbm?: number
  ul_sinr_p50_db?: number
  pusch_bler_avg?: number
  pucch_bler_avg?: number
  harq_dtx_rate?: number
  ul_thp_mbps?: number
  dl_thp_mbps?: number
  prb_util_ul?: number
  prb_util_dl?: number
}

export type CellCM = {
  ul_itfm_enabled?: boolean
  pim_detection_enabled?: boolean
  pim_avoidance_enabled?: boolean
  duct_reduction_enabled?: boolean
  irc_enabled?: boolean
  pucch_overdimensioning?: number
  ul_scheduling_ctrl_ooc?: boolean
  limited_ul_iflb?: boolean
}

export type InterferenceSample = {
  cellId: string
  hour: string
  ni_db?: number
  pusch_bler?: number
  pucch_bler?: number
  score?: number
}

export type Link = {
  id: string
  fromSiteId: string
  toSiteId: string
  kind?: string
}

// ---------------------------------------------------------------------------
// Interference source classification & mitigation types
// ---------------------------------------------------------------------------

export type SourceType =
  | 'CABLE_TV_LEAKAGE'
  | 'FM_RADIO_HARMONIC'
  | 'TV_DIGITAL_BROADCAST_700'
  | 'BDA_OSCILLATION'
  | 'BDA_EXCESS_GAIN'
  | 'WIRELESS_ISP_2500'
  | 'WIFI_CAMERA_UNLICENSED_850'
  | 'JAMMER'
  | 'MILITARY_POLICE'
  | 'PIM'
  | 'ATMOSPHERIC_DUCTING'
  | 'UNKNOWN_PERSISTENT'

export type SourceMatch = {
  sourceType: SourceType
  label: string
  confidence: number     // 0–1
  evidence: string[]
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  actionHint: string
  bandConsistent: boolean
}

export type PRBFeatures = {
  peakDbm: number
  floorElevationDb: number
  prbUniformity: number
  edgePrbExcessDb: number
  lowPrbExcessDb: number
  peakClusterWidthPct: number
  slopeDbPerPrb: number
  temporalCv: number
  businessHourExcessDb: number
  trafficCorrelation: number
  nightMinusDayDb: number
}

export type MitigationActionType = 'CM' | 'FIELD' | 'REGULATORY'

export type NeighborImpact = {
  /** Cells within impact radius that may be affected by this action */
  affectedCellIds: string[]
  /** Estimated throughput/capacity change on those cells (+ = gain, - = loss) */
  capacityDeltaPct: number
  /** Human-readable description of the impact */
  description: string
}

export type MitigationAction = {
  id: string
  title: string
  type: MitigationActionType
  featureId?: string              // Ericsson feature ID e.g. "FAJ 121 5436"
  description: string
  prerequisites?: string[]
  conflicts?: string[]
  expectedKpiImpact: string[]    // e.g. ["UL SINR +2–4 dB", "UL Throughput +15%"]
  neighborImpactRadiusKm: number  // radius to search for impacted neighbors
  neighborImpact?: NeighborImpact // computed at runtime
  urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  requiresFieldVisit: boolean
}

export type CellAnalysis = {
  cellId: string
  primarySource: SourceType
  matches: SourceMatch[]
  features: PRBFeatures
  mitigations: MitigationAction[]
  /** Neighbors within 1 km (for impact analysis) */
  nearbyNeighborIds: string[]
  /** Estimated source location (lat, lon) — for source heatmap center */
  estimatedSourceLat?: number
  estimatedSourceLon?: number
  /** Search radius for source heatmap (km) */
  sourceSearchRadiusKm: number
}

export type Topology = {
  version?: string
  sites: Site[]
  cells?: Cell[]
  links?: Link[]
  interferenceSamples?: InterferenceSample[]
}

export type NormalizedTopology = {
  version: string
  sites: Site[]
  cells: Cell[]
  links: Link[]
  interferenceSamples: InterferenceSample[]
}
