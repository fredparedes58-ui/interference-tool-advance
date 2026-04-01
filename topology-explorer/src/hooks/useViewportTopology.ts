import { useMemo } from 'react'
import type { NormalizedTopology, Site, Cell } from '../types'

// [west, south, east, north]
export type MapBbox = [number, number, number, number]

// Pad bbox by a fraction to avoid abrupt popping at edges
const PAD = 0.15

function padBbox(bbox: MapBbox): MapBbox {
  const [w, s, e, n] = bbox
  const dLon = (e - w) * PAD
  const dLat = (n - s) * PAD
  return [w - dLon, s - dLat, e + dLon, n + dLat]
}

function siteInBbox(site: Site, bbox: MapBbox): boolean {
  const [w, s, e, n] = bbox
  return site.lon >= w && site.lon <= e && site.lat >= s && site.lat <= n
}

export function useViewportTopology(
  topology: NormalizedTopology,
  bbox: MapBbox | null,
): { sites: Site[]; cells: Cell[]; isFiltered: boolean } {
  return useMemo(() => {
    if (!bbox) {
      return { sites: topology.sites, cells: topology.cells, isFiltered: false }
    }

    const padded = padBbox(bbox)
    const visibleSiteIds = new Set<string>()

    const sites = topology.sites.filter(s => {
      if (siteInBbox(s, padded)) {
        visibleSiteIds.add(s.id)
        return true
      }
      return false
    })

    const cells = topology.cells.filter(c => visibleSiteIds.has(c.siteId))

    return { sites, cells, isFiltered: true }
  }, [topology.sites, topology.cells, bbox])
}
