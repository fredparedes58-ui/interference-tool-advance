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
  vendor?: string
  hBeamwidth?: number
  earfcn?: number
  pci?: number
  azimuth?: number
  tilt?: number
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
