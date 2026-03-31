import type {
  Cell,
  CellCM,
  CellKPI,
  InterferenceSample,
  Link,
  NormalizedTopology,
  Site,
  Topology,
} from './types'

type Result =
  | { ok: true; data: NormalizedTopology }
  | { ok: false; error: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const validateSites = (sites: unknown): Site[] | null => {
  if (!Array.isArray(sites)) return null
  const validated: Site[] = []
  for (const raw of sites) {
    if (!isRecord(raw)) return null
    if (!isString(raw.id) || !isString(raw.name)) return null
    if (!isNumber(raw.lat) || !isNumber(raw.lon)) return null
    validated.push({
      id: raw.id.trim(),
      name: raw.name.trim(),
      lat: raw.lat,
      lon: raw.lon,
      region: isString(raw.region) ? raw.region.trim() : undefined,
      city: isString(raw.city) ? raw.city.trim() : undefined,
    })
  }
  return validated
}

const validateCells = (cells: unknown): Cell[] | null => {
  if (cells === undefined) return []
  if (!Array.isArray(cells)) return null
  const validated: Cell[] = []
  for (const raw of cells) {
    if (!isRecord(raw)) return null
    if (!isString(raw.id) || !isString(raw.siteId) || !isString(raw.tech))
      return null
    validated.push({
      id: raw.id.trim(),
      siteId: raw.siteId.trim(),
      tech: raw.tech.trim(),
      band: isString(raw.band) ? raw.band.trim() : undefined,
      bandNum: isNumber(raw.bandNum) ? raw.bandNum : undefined,
      bwMhz: isNumber(raw.bwMhz) ? raw.bwMhz : undefined,
      vendor: isString(raw.vendor) ? raw.vendor.trim() : undefined,
      hBeamwidth: isNumber(raw.hBeamwidth) ? raw.hBeamwidth : undefined,
      earfcn: isNumber(raw.earfcn) ? raw.earfcn : undefined,
      pci: isNumber(raw.pci) ? raw.pci : undefined,
      azimuth: isNumber(raw.azimuth) ? raw.azimuth : undefined,
      tilt: isNumber(raw.tilt) ? raw.tilt : undefined,
      prbHistogram: Array.isArray(raw.prbHistogram) ? raw.prbHistogram as number[][] : undefined,
      kpi: isRecord(raw.kpi) ? raw.kpi as CellKPI : undefined,
      cm: isRecord(raw.cm) ? raw.cm as CellCM : undefined,
    })
  }
  return validated
}

const validateLinks = (links: unknown): Link[] | null => {
  if (links === undefined) return []
  if (!Array.isArray(links)) return null
  const validated: Link[] = []
  for (const raw of links) {
    if (!isRecord(raw)) return null
    if (
      !isString(raw.id) ||
      !isString(raw.fromSiteId) ||
      !isString(raw.toSiteId)
    )
      return null
    validated.push({
      id: raw.id.trim(),
      fromSiteId: raw.fromSiteId.trim(),
      toSiteId: raw.toSiteId.trim(),
      kind: isString(raw.kind) ? raw.kind.trim() : undefined,
    })
  }
  return validated
}

const validateInterferenceSamples = (
  samples: unknown
): InterferenceSample[] | null => {
  if (samples === undefined) return []
  if (!Array.isArray(samples)) return null
  const validated: InterferenceSample[] = []
  for (const raw of samples) {
    if (!isRecord(raw)) return null
    if (!isString(raw.cellId) || !isString(raw.hour)) return null
    validated.push({
      cellId: raw.cellId.trim(),
      hour: raw.hour.trim(),
      ni_db: isNumber(raw.ni_db) ? raw.ni_db : undefined,
      pusch_bler: isNumber(raw.pusch_bler) ? raw.pusch_bler : undefined,
      pucch_bler: isNumber(raw.pucch_bler) ? raw.pucch_bler : undefined,
      score: isNumber(raw.score) ? raw.score : undefined,
    })
  }
  return validated
}

export const normalizeTopology = (input: unknown): Result => {
  if (!isRecord(input)) {
    return { ok: false, error: 'El JSON debe ser un objeto.' }
  }
  const topo = input as Topology
  const sites = validateSites(topo.sites)
  if (!sites || sites.length === 0) {
    return {
      ok: false,
      error: 'El campo "sites" es obligatorio y debe contener sitios validos.',
    }
  }
  const cells = validateCells(topo.cells)
  if (!cells) {
    return {
      ok: false,
      error: 'El campo "cells" debe ser un arreglo valido si existe.',
    }
  }
  const links = validateLinks(topo.links)
  if (!links) {
    return {
      ok: false,
      error: 'El campo "links" debe ser un arreglo valido si existe.',
    }
  }
  const interferenceSamples = validateInterferenceSamples(topo.interferenceSamples)
  if (!interferenceSamples) {
    return {
      ok: false,
      error: 'El campo "interferenceSamples" debe ser un arreglo valido si existe.',
    }
  }
  return {
    ok: true,
    data: {
      version: isString(topo.version) ? topo.version.trim() : '1.0',
      sites,
      cells,
      links,
      interferenceSamples,
    },
  }
}
