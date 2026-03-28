import type { Cell, Link, Site } from './types'

type PointFeature = {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: Record<string, unknown>
}

type LineFeature = {
  type: 'Feature'
  geometry: { type: 'LineString'; coordinates: [number, number][] }
  properties: Record<string, unknown>
}

type CellFeature = {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: Record<string, unknown>
}

type SectorFeature = {
  type: 'Feature'
  geometry: { type: 'Polygon'; coordinates: [number, number][][] }
  properties: Record<string, unknown>
}

type FeatureCollection<T> = {
  type: 'FeatureCollection'
  features: T[]
}

export const sitesToGeoJSON = (
  sites: Site[],
  cellsBySite: Record<string, number>
): FeatureCollection<PointFeature> => ({
  type: 'FeatureCollection',
  features: sites.map((site) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [site.lon, site.lat] },
    properties: {
      id: site.id,
      name: site.name,
      region: site.region,
      city: site.city,
      cellCount: cellsBySite[site.id] || 0,
    },
  })),
})

export const linksToGeoJSON = (
  links: Link[],
  siteById: Map<string, Site>
): FeatureCollection<LineFeature> => ({
  type: 'FeatureCollection',
  features: (links
    .map((link) => {
      const from = siteById.get(link.fromSiteId)
      const to = siteById.get(link.toSiteId)
      if (!from || !to) return null
      return {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [[from.lon, from.lat], [to.lon, to.lat]] as [number, number][],
        },
        properties: {
          id: link.id,
          kind: link.kind,
        },
      }
    })
    .filter(Boolean) as LineFeature[]),
})

export const cellsToGeoJSON = (
  cells: Cell[],
  siteById: Map<string, Site>
): FeatureCollection<CellFeature> => ({
  type: 'FeatureCollection',
  features: (() => {
    const bySite = new Map<string, Cell[]>()
    cells.forEach((cell) => {
      const list = bySite.get(cell.siteId) ?? []
      list.push(cell)
      bySite.set(cell.siteId, list)
    })

    const features: CellFeature[] = []
    bySite.forEach((siteCells, siteId) => {
      const site = siteById.get(siteId)
      if (!site) return
      const count = siteCells.length
      siteCells.forEach((cell, index) => {
        const angle = (Math.PI * 2 * index) / Math.max(count, 1)
        const radius = count > 1 ? 0.002 : 0
        const latOffset = radius * Math.sin(angle)
        const lonOffset =
          radius * Math.cos(angle) / Math.cos((site.lat * Math.PI) / 180)

        features.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [site.lon + lonOffset, site.lat + latOffset],
          },
          properties: {
            id: cell.id,
            siteId: cell.siteId,
            tech: cell.tech,
            band: cell.band ?? 'Unknown',
          },
        })
      })
    })
    return features
  })(),
})

const toRad = (deg: number) => (deg * Math.PI) / 180

const sectorPolygon = (
  center: [number, number],
  azimuth: number,
  beamwidth: number,
  radiusMeters: number,
  steps = 18
): [number, number][] => {
  const [lon, lat] = center
  const points: [number, number][] = [[lon, lat]]
  const start = azimuth - beamwidth / 2
  const end = azimuth + beamwidth / 2
  const step = (end - start) / steps

  for (let angle = start; angle <= end; angle += step) {
    const rad = toRad(angle)
    const dLat = (radiusMeters / 111320) * Math.cos(rad)
    const dLon = (radiusMeters / (111320 * Math.cos(toRad(lat)))) * Math.sin(rad)
    points.push([lon + dLon, lat + dLat])
  }
  points.push([lon, lat])
  return points
}

export const cellsToSectorsGeoJSON = (
  cells: Cell[],
  siteById: Map<string, Site>,
  radiusMeters: number,
  radiusByBand?: Record<string, number>,
  getRadius?: (cell: Cell, bandRadius: number) => number
): FeatureCollection<SectorFeature> => ({
  type: 'FeatureCollection',
  features: (cells
    .map((cell) => {
      const site = siteById.get(cell.siteId)
      if (!site) return null
      const azimuth = cell.azimuth ?? 0
      const beam = cell.hBeamwidth ?? 65
      const bandName = cell.band ?? 'Unknown'
      const bandRadius = radiusByBand?.[bandName] ?? radiusMeters
      const radius = getRadius ? getRadius(cell, bandRadius) : bandRadius
      const polygon = sectorPolygon([site.lon, site.lat], azimuth, beam, radius)
      return {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [polygon],
        },
        properties: {
          id: cell.id,
          siteId: cell.siteId,
          tech: cell.tech,
          band: cell.band,
          vendor: cell.vendor,
        },
      }
    })
    .filter(Boolean) as SectorFeature[]),
})
