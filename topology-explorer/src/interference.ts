import type { Cell, InterferenceSample, Site } from './types'

// ---------------------------------------------------------------------------
// Source location probability heatmap
// ---------------------------------------------------------------------------

/**
 * Build a GeoJSON heatmap centred on (lat, lon) within searchRadiusKm.
 * Weights decay from 1 at the centre to 0 at the radius using Gaussian falloff,
 * representing the probability density of the interference source location.
 */
export function buildSourceHeatmap(
  lat: number,
  lon: number,
  searchRadiusKm: number,
  confidence: number,
): FeatureCollection {
  if (searchRadiusKm <= 0) return { type: 'FeatureCollection', features: [] }

  // Approx degrees per km
  const degPerKmLat = 1 / 110.57
  const degPerKmLon = 1 / (111.32 * Math.cos(lat * (Math.PI / 180)))

  const radiusDegLat = searchRadiusKm * degPerKmLat
  const radiusDegLon = searchRadiusKm * degPerKmLon

  // Grid step: finer for small radii (BDA = 0.4 km), coarser for large (ducting = 50 km)
  const gridPoints = 28
  const stepLat = (2 * radiusDegLat) / gridPoints
  const stepLon = (2 * radiusDegLon) / gridPoints

  const features: PointFeature[] = []
  const sigma = 0.4 // fraction of radius at 1σ

  for (let i = 0; i <= gridPoints; i++) {
    for (let j = 0; j <= gridPoints; j++) {
      const pLat = lat - radiusDegLat + i * stepLat
      const pLon = lon - radiusDegLon + j * stepLon

      // Normalised distance from centre [0, 1]
      const dLat = (pLat - lat) / radiusDegLat
      const dLon = (pLon - lon) / radiusDegLon
      const r2 = dLat * dLat + dLon * dLon
      if (r2 > 1) continue // outside radius

      const weight = confidence * Math.exp(-r2 / (2 * sigma * sigma))
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [pLon, pLat] },
        properties: { weight },
      })
    }
  }

  return { type: 'FeatureCollection', features }
}

type PointFeature = {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: { weight: number }
}

type FeatureCollection = {
  type: 'FeatureCollection'
  features: PointFeature[]
}

const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value))

const scoreFromSample = (sample: InterferenceSample) => {
  if (sample.score !== undefined) return clamp(sample.score)
  const values: number[] = []
  if (sample.pusch_bler !== undefined) values.push(clamp(sample.pusch_bler))
  if (sample.pucch_bler !== undefined) values.push(clamp(sample.pucch_bler))
  if (sample.ni_db !== undefined) {
    const normalized = (sample.ni_db - -120) / 40
    values.push(clamp(normalized))
  }
  if (values.length === 0) return 0.2
  return values.reduce((acc, value) => acc + value, 0) / values.length
}

const estimateSourceByTrilateration = (
  measurements: { lat: number; lon: number; weight: number }[]
) => {
  if (measurements.length < 3) return null

  const ref = measurements[0]
  const maxDistKm = 30
  const toXY = (lat: number, lon: number) => {
    const rad = Math.PI / 180
    const x = lon * 111.32 * Math.cos(lat * rad)
    const y = lat * 110.57
    return { x, y }
  }

  const refXY = toXY(ref.lat, ref.lon)
  const refD = maxDistKm * (1 - ref.weight)

  let a11 = 0
  let a12 = 0
  let a22 = 0
  let b1 = 0
  let b2 = 0

  for (let i = 1; i < measurements.length; i += 1) {
    const m = measurements[i]
    const mXY = toXY(m.lat, m.lon)
    const di = maxDistKm * (1 - m.weight)
    const a = 2 * (mXY.x - refXY.x)
    const b = 2 * (mXY.y - refXY.y)
    const c =
      refD * refD -
      di * di -
      refXY.x * refXY.x +
      mXY.x * mXY.x -
      refXY.y * refXY.y +
      mXY.y * mXY.y
    a11 += a * a
    a12 += a * b
    a22 += b * b
    b1 += a * c
    b2 += b * c
  }

  const det = a11 * a22 - a12 * a12
  if (Math.abs(det) < 1e-6) return null
  const x = (b1 * a22 - b2 * a12) / det
  const y = (a11 * b2 - a12 * b1) / det

  const lat = y / 110.57
  const lon = x / (111.32 * Math.cos(lat * (Math.PI / 180)))
  return { lat, lon }
}

export type InterferenceGridOptions = {
  gridStepDeg: number
  baseWeight: number
}

export const buildInterferenceGrid = (
  samples: InterferenceSample[],
  sites: Site[],
  cells: Cell[],
  selectedHour: string | null,
  options: InterferenceGridOptions
): FeatureCollection => {
  if (sites.length === 0) {
    return { type: 'FeatureCollection', features: [] }
  }

  const cellToSite = new Map<string, Site>()
  const siteById = new Map<string, Site>()
  sites.forEach((site) => siteById.set(site.id, site))
  cells.forEach((cell) => {
    const site = siteById.get(cell.siteId)
    if (site) cellToSite.set(cell.id, site)
  })

  const filtered = samples.filter((sample) =>
    selectedHour ? sample.hour === selectedHour : true
  )

  const measurements = filtered
    .map((sample) => {
      const site = cellToSite.get(sample.cellId)
      if (!site) return null
      return {
        lat: site.lat,
        lon: site.lon,
        weight: scoreFromSample(sample),
      }
    })
    .filter((item): item is { lat: number; lon: number; weight: number } =>
      Boolean(item)
    )

  const estimated = estimateSourceByTrilateration(measurements)
  if (estimated) {
    measurements.push({ ...estimated, weight: 1 })
  }

  let minLat = sites[0].lat
  let maxLat = sites[0].lat
  let minLon = sites[0].lon
  let maxLon = sites[0].lon
  sites.forEach((site) => {
    minLat = Math.min(minLat, site.lat)
    maxLat = Math.max(maxLat, site.lat)
    minLon = Math.min(minLon, site.lon)
    maxLon = Math.max(maxLon, site.lon)
  })

  const padding = 0.2
  minLat -= padding
  maxLat += padding
  minLon -= padding
  maxLon += padding

  const step = options.gridStepDeg
  const base = options.baseWeight
  const power = 2
  const epsilon = 1e-6
  const features: PointFeature[] = []

  for (let lat = minLat; lat <= maxLat; lat += step) {
    for (let lon = minLon; lon <= maxLon; lon += step) {
      let numerator = 0
      let denominator = 0
      measurements.forEach((m) => {
        const dLat = lat - m.lat
        const dLon = lon - m.lon
        const dist = Math.sqrt(dLat * dLat + dLon * dLon) + epsilon
        const weight = 1 / Math.pow(dist, power)
        numerator += m.weight * weight
        denominator += weight
      })
      const value =
        measurements.length === 0
          ? base
          : clamp(base + numerator / Math.max(denominator, epsilon))

      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: { weight: value },
      })
    }
  }

  return { type: 'FeatureCollection', features }
}
