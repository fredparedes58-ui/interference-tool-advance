import { useCallback, useEffect, useMemo, useState } from 'react'
import MapView from './components/MapView'
import Sidebar from './components/Sidebar'
import SiteDrawer from './components/SiteDrawer'
import CellAnalysisPanel from './components/CellAnalysisPanel'
import StatCard from './components/StatCard'
import sampleTopology from './sampleTopology'
import { normalizeTopology } from './topoNormalize'
import { analyzeCell } from './classify'
import { buildSourceHeatmap } from './interference'
import type { NormalizedTopology, Site, Tech } from './types'
import type { InterferenceSample } from './types'

console.log('App component loading...')

const TECH_OPTIONS: Tech[] = ['LTE', 'NR', 'WCDMA', 'GSM']
const STORAGE_KEY = 'topology-explorer-state'
const DEFAULT_GRID_STEP = 0.08
const DEFAULT_BASE_WEIGHT = 0.06
const PRESETS = {
  Suave: { gridStepDeg: 0.1, baseWeight: 0.04 },
  Medio: { gridStepDeg: 0.08, baseWeight: 0.06 },
  Intenso: { gridStepDeg: 0.06, baseWeight: 0.1 },
} as const
const MAP_STYLES = [
  {
    id: 'dark',
    label: 'Dark (Carto)',
    url: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    backdrop: 'none',
  },
  {
    id: 'light',
    label: 'Light (Carto)',
    url: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    backdrop: 'none',
  },
  { id: 'blueprint', label: 'Blueprint (Offline)', url: '/style.json', backdrop: 'blueprint' },
] as const
type PresetName = keyof typeof PRESETS | 'Custom'

type StoredState = {
  search: string
  showLinks: boolean
  techFilters: Record<string, boolean>
  bandFilters: Record<string, boolean>
  vendorFilters: Record<string, boolean>
  regionFilters: Record<string, boolean>
  appliedSearch: string
  appliedTechFilters: Record<string, boolean>
  appliedBandFilters: Record<string, boolean>
  appliedVendorFilters: Record<string, boolean>
  appliedRegionFilters: Record<string, boolean>
  appliedOnce: boolean
  showInterference: boolean
  selectedHour: string | null
  gridStepDeg: number
  baseWeight: number
  presetName: PresetName
  topologyKey: string
  settingsByTopology: Record<
    string,
    { gridStepDeg: number; baseWeight: number; presetName: PresetName }
  >
  settingsBySite: Record<
    string,
    { gridStepDeg: number; baseWeight: number; presetName: PresetName }
  >
  panelCollapsed: boolean
  mapStyleId: string
}

const emptyTopology: NormalizedTopology = {
  version: '1.0',
  sites: [],
  cells: [],
  links: [],
  interferenceSamples: [],
}

const normalizeSample = () => {
  const normalized = normalizeTopology(sampleTopology)
  if (!normalized.ok) {
    return emptyTopology
  }
  return normalized.data
}

function App() {
  const [topology, setTopology] = useState<NormalizedTopology>(normalizeSample)
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [showLinks, setShowLinks] = useState(true)
  const [zoomSignal, setZoomSignal] = useState(0)
  const [showInterference, setShowInterference] = useState(true)
  const [selectedHour, setSelectedHour] = useState<string | null>(null)
  const [gridStepDeg, setGridStepDeg] = useState(DEFAULT_GRID_STEP)
  const [baseWeight, setBaseWeight] = useState(DEFAULT_BASE_WEIGHT)
  const [presetName, setPresetName] = useState<PresetName>('Medio')
  const [vendorFilters, setVendorFilters] = useState<Record<string, boolean>>({})
  const [regionFilters, setRegionFilters] = useState<Record<string, boolean>>({})
  const [appliedTechFilters, setAppliedTechFilters] = useState<Record<string, boolean>>(
    {}
  )
  const [appliedBandFilters, setAppliedBandFilters] = useState<Record<string, boolean>>(
    {}
  )
  const [appliedVendorFilters, setAppliedVendorFilters] = useState<
    Record<string, boolean>
  >({})
  const [appliedRegionFilters, setAppliedRegionFilters] = useState<
    Record<string, boolean>
  >({})
  const [appliedOnce, setAppliedOnce] = useState(false)
  const [topologyKey, setTopologyKey] = useState('sample')
  const [settingsByTopology, setSettingsByTopology] = useState<
    Record<string, { gridStepDeg: number; baseWeight: number; presetName: PresetName }>
  >({})
  const [settingsBySite, setSettingsBySite] = useState<
    Record<string, { gridStepDeg: number; baseWeight: number; presetName: PresetName }>
  >({})
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [mapStyleId, setMapStyleId] = useState<string>('blueprint')
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null)
  const [techFilters, setTechFilters] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    TECH_OPTIONS.forEach((tech) => {
      initial[tech] = true
    })
    return initial
  })
  const [bandFilters, setBandFilters] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const storedRaw = localStorage.getItem(STORAGE_KEY)
    if (!storedRaw) return
    try {
      const stored = JSON.parse(storedRaw) as StoredState
      if (stored && typeof stored === 'object') {
        if (typeof stored.search === 'string') setSearch(stored.search)
        if (typeof stored.appliedSearch === 'string')
          setAppliedSearch(stored.appliedSearch)
        if (typeof stored.showLinks === 'boolean') setShowLinks(stored.showLinks)
        if (stored.techFilters && typeof stored.techFilters === 'object') {
          setTechFilters((prev) => ({ ...prev, ...stored.techFilters }))
        }
        if (stored.bandFilters && typeof stored.bandFilters === 'object') {
          setBandFilters((prev) => ({ ...prev, ...stored.bandFilters }))
        }
        if (stored.vendorFilters && typeof stored.vendorFilters === 'object') {
          setVendorFilters((prev) => ({ ...prev, ...stored.vendorFilters }))
        }
        if (stored.regionFilters && typeof stored.regionFilters === 'object') {
          setRegionFilters((prev) => ({ ...prev, ...stored.regionFilters }))
        }
        if (
          stored.appliedTechFilters &&
          typeof stored.appliedTechFilters === 'object'
        ) {
          setAppliedTechFilters(stored.appliedTechFilters)
        }
        if (
          stored.appliedBandFilters &&
          typeof stored.appliedBandFilters === 'object'
        ) {
          setAppliedBandFilters(stored.appliedBandFilters)
        }
        if (
          stored.appliedVendorFilters &&
          typeof stored.appliedVendorFilters === 'object'
        ) {
          setAppliedVendorFilters(stored.appliedVendorFilters)
        }
        if (
          stored.appliedRegionFilters &&
          typeof stored.appliedRegionFilters === 'object'
        ) {
          setAppliedRegionFilters(stored.appliedRegionFilters)
        }
        if (typeof stored.appliedOnce === 'boolean') {
          setAppliedOnce(stored.appliedOnce)
        }
        if (typeof stored.showInterference === 'boolean') {
          setShowInterference(stored.showInterference)
        }
        if (typeof stored.selectedHour === 'string' || stored.selectedHour === null) {
          setSelectedHour(stored.selectedHour)
        }
        if (typeof stored.gridStepDeg === 'number') {
          setGridStepDeg(stored.gridStepDeg)
        }
        if (typeof stored.baseWeight === 'number') {
          setBaseWeight(stored.baseWeight)
        }
        if (typeof stored.presetName === 'string') {
          setPresetName(stored.presetName as PresetName)
        }
        if (typeof stored.topologyKey === 'string') {
          setTopologyKey(stored.topologyKey)
        }
        if (stored.settingsByTopology && typeof stored.settingsByTopology === 'object') {
          setSettingsByTopology(stored.settingsByTopology)
        }
        if (stored.settingsBySite && typeof stored.settingsBySite === 'object') {
          setSettingsBySite(stored.settingsBySite)
        }
        if (typeof stored.panelCollapsed === 'boolean') {
          setPanelCollapsed(stored.panelCollapsed)
        }
        if (typeof stored.mapStyleId === 'string') {
          setMapStyleId(stored.mapStyleId)
        }
      }
    } catch {
      // ignore invalid storage
    }
  }, [])

  console.log('App component initialized, topology:', topology)

  useEffect(() => {
    const loadTopologyFile = async () => {
      try {
        const response = await fetch('/topology.json')
        if (!response.ok) return
        const data = (await response.json()) as unknown
        const normalized = normalizeTopology(data)
        if (normalized.ok) {
          setTopology(normalized.data)
          setTopologyKey('topology.json')
        }
      } catch {
        // ignore if not available
      }
    }
    loadTopologyFile()
  }, [])

  useEffect(() => {
    const state: StoredState = {
      search,
      appliedSearch,
      showLinks,
      techFilters,
      bandFilters,
      vendorFilters,
      regionFilters,
      appliedTechFilters,
      appliedBandFilters,
      appliedVendorFilters,
      appliedRegionFilters,
      appliedOnce,
      showInterference,
      selectedHour,
      gridStepDeg,
      baseWeight,
      presetName,
      topologyKey,
      settingsByTopology,
      settingsBySite,
      panelCollapsed,
      mapStyleId,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [
    search,
    appliedSearch,
    showLinks,
    techFilters,
    bandFilters,
    vendorFilters,
    regionFilters,
    appliedTechFilters,
    appliedBandFilters,
    appliedVendorFilters,
    appliedRegionFilters,
    appliedOnce,
    showInterference,
    selectedHour,
    gridStepDeg,
    baseWeight,
    presetName,
    topologyKey,
    settingsByTopology,
    settingsBySite,
    panelCollapsed,
    mapStyleId,
  ])

  const enabledAppliedTechs = useMemo(
    () => TECH_OPTIONS.filter((tech) => appliedTechFilters[tech]),
    [appliedTechFilters]
  )
  const allAppliedTechsEnabled =
    enabledAppliedTechs.length === TECH_OPTIONS.length

  const uniqueCells = useMemo(() => {
    const seen = new Set<string>()
    const out: typeof topology.cells = []
    topology.cells.forEach((cell) => {
      const key = `${cell.id}|${cell.siteId}`
      if (seen.has(key)) return
      seen.add(key)
      out.push(cell)
    })
    return out
  }, [topology.cells])

  const availableBands = useMemo(() => {
    const bands = new Set<string>()
    uniqueCells.forEach((cell) => {
      if (cell.band) bands.add(cell.band)
    })
    return Array.from(bands).sort()
  }, [uniqueCells])

  const availableVendors = useMemo(() => {
    const vendors = new Set<string>()
    uniqueCells.forEach((cell) => {
      if (cell.vendor) vendors.add(cell.vendor)
    })
    return Array.from(vendors).sort()
  }, [uniqueCells])

  const availableRegions = useMemo(() => {
    const regions = new Set<string>()
    topology.sites.forEach((site) => {
      if (site.region) regions.add(site.region)
    })
    return Array.from(regions).sort()
  }, [topology.sites])

  const siteById = useMemo(() => {
    const map = new Map<string, Site>()
    topology.sites.forEach((site) => map.set(site.id, site))
    return map
  }, [topology.sites])

  useEffect(() => {
    if (availableBands.length === 0) return
    setBandFilters((prev) => {
      const next = { ...prev }
      availableBands.forEach((band) => {
        if (next[band] === undefined) next[band] = false
      })
      return next
    })
  }, [availableBands])

  useEffect(() => {
    if (availableVendors.length === 0) return
    setVendorFilters((prev) => {
      const next = { ...prev }
      availableVendors.forEach((vendor) => {
        if (next[vendor] === undefined) next[vendor] = true
      })
      return next
    })
  }, [availableVendors])

  useEffect(() => {
    if (availableRegions.length === 0) return
    setRegionFilters((prev) => {
      const next = { ...prev }
      availableRegions.forEach((region) => {
        if (next[region] === undefined) next[region] = false
      })
      return next
    })
  }, [availableRegions])

  const enabledBands = useMemo(
    () => availableBands.filter((band) => bandFilters[band]),
    [availableBands, bandFilters]
  )
  const allBandsEnabled =
    availableBands.length > 0 && enabledBands.length === availableBands.length

  const enabledRegions = useMemo(
    () => availableRegions.filter((region) => regionFilters[region]),
    [availableRegions, regionFilters]
  )
  const hasRegionSelection = enabledRegions.length > 0
  const hasBandSelection = enabledBands.length > 0
  const appliedEnabledBands = useMemo(
    () => availableBands.filter((band) => appliedBandFilters[band]),
    [availableBands, appliedBandFilters]
  )
  const appliedEnabledVendors = useMemo(
    () => availableVendors.filter((vendor) => appliedVendorFilters[vendor]),
    [availableVendors, appliedVendorFilters]
  )
  const appliedEnabledRegions = useMemo(
    () => availableRegions.filter((region) => appliedRegionFilters[region]),
    [availableRegions, appliedRegionFilters]
  )
  const hasDataGate =
    appliedOnce &&
    (appliedEnabledBands.length > 0 ||
      appliedEnabledRegions.length > 0 ||
      appliedSearch.trim() !== '')

  const filteredCells = useMemo(() => {
    if (!hasBandSelection && !hasRegionSelection) return []
    if (!hasDataGate) return []
    return uniqueCells.filter((cell) => {
      const techOk =
        allAppliedTechsEnabled || enabledAppliedTechs.includes(cell.tech)
      const bandOk =
        availableBands.length === 0 ||
        appliedEnabledBands.length === availableBands.length ||
        (cell.band ? appliedEnabledBands.includes(cell.band) : false)
      const vendorOk =
        availableVendors.length === 0 ||
        appliedEnabledVendors.length === availableVendors.length ||
        (cell.vendor ? appliedEnabledVendors.includes(cell.vendor) : false)
      const site = siteById.get(cell.siteId)
      const regionOk =
        appliedEnabledRegions.length === 0 ||
        (site?.region ? appliedEnabledRegions.includes(site.region) : false)
      return techOk && bandOk && vendorOk && regionOk
    })
  }, [
    uniqueCells,
    enabledAppliedTechs,
    allAppliedTechsEnabled,
    availableBands.length,
    appliedEnabledBands,
    availableVendors.length,
    appliedEnabledVendors,
    appliedEnabledRegions,
    siteById,
    hasBandSelection,
    hasRegionSelection,
    hasDataGate,
  ])

  const cellsBySite = useMemo(() => {
    const counts: Record<string, number> = {}
    filteredCells.forEach((cell) => {
      counts[cell.siteId] = (counts[cell.siteId] || 0) + 1
    })
    return counts
  }, [filteredCells])

  const filteredSites = useMemo(() => {
    if (!hasDataGate) return []
    return topology.sites.filter((site) => {
      const matchesSearch = appliedSearch
        ? [site.id, site.name, site.region ?? '', site.city ?? '']
            .join(' ')
            .toLowerCase()
            .includes(appliedSearch.trim().toLowerCase())
        : true
      if (!matchesSearch) return false
      if (appliedEnabledRegions.length > 0 && site.region) {
        if (!appliedEnabledRegions.includes(site.region)) return false
      } else if (appliedEnabledRegions.length > 0 && !site.region) {
        return false
      }
      if (allAppliedTechsEnabled || uniqueCells.length === 0) return true
      return (cellsBySite[site.id] || 0) > 0
    })
  }, [
    topology.sites,
    cellsBySite,
    appliedSearch,
    allAppliedTechsEnabled,
    uniqueCells.length,
    appliedEnabledRegions,
    hasDataGate,
  ])

  const filteredSiteIds = useMemo(
    () => new Set(filteredSites.map((site) => site.id)),
    [filteredSites]
  )

  const filteredLinks = useMemo(() => {
    return topology.links.filter(
      (link) =>
        filteredSiteIds.has(link.fromSiteId) &&
        filteredSiteIds.has(link.toSiteId)
    )
  }, [topology.links, filteredSiteIds])

  const interferenceSamples = useMemo<InterferenceSample[]>(
    () => topology.interferenceSamples,
    [topology.interferenceSamples]
  )

  const availableHours = useMemo(() => {
    const hours = new Set<string>()
    interferenceSamples.forEach((sample) => hours.add(sample.hour))
    return Array.from(hours).sort()
  }, [interferenceSamples])

  useEffect(() => {
    if (availableHours.length === 0) return
    if (selectedHour && availableHours.includes(selectedHour)) return
    setSelectedHour(availableHours[0])
  }, [availableHours, selectedHour])

  const selectedSite = useMemo(
    () => filteredSites.find((site) => site.id === selectedSiteId) || null,
    [filteredSites, selectedSiteId]
  )

  const selectedCells = useMemo(() => {
    if (!selectedSiteId) return []
    return filteredCells.filter((cell) => cell.siteId === selectedSiteId)
  }, [filteredCells, selectedSiteId])

  const displayCells = useMemo(() => {
    if (selectedSiteId) return selectedCells
    return filteredCells
  }, [filteredCells, selectedCells, selectedSiteId])

  const cellRenderWarning = false

  const onToggleTech = (tech: Tech) => {
    setTechFilters((prev) => ({ ...prev, [tech]: !prev[tech] }))
    setSelectedSiteId(null)
  }

  const onSelectBands = (bands: string[]) => {
    setBandFilters(() => {
      const next: Record<string, boolean> = {}
      availableBands.forEach((band) => {
        next[band] = bands.includes(band)
      })
      return next
    })
    setSelectedSiteId(null)
  }

  const onSelectVendors = (vendors: string[]) => {
    setVendorFilters(() => {
      const next: Record<string, boolean> = {}
      availableVendors.forEach((vendor) => {
        next[vendor] = vendors.includes(vendor)
      })
      return next
    })
    setSelectedSiteId(null)
  }

  const onSelectRegions = (regions: string[]) => {
    setRegionFilters(() => {
      const next: Record<string, boolean> = {}
      availableRegions.forEach((region) => {
        next[region] = regions.includes(region)
      })
      return next
    })
    setSelectedSiteId(null)
  }

  const handleApplyFilters = () => {
    setAppliedSearch(search)
    setAppliedTechFilters(techFilters)
    setAppliedBandFilters(bandFilters)
    setAppliedVendorFilters(vendorFilters)
    setAppliedRegionFilters(regionFilters)
    setAppliedOnce(true)
  }

  const handleResetFilters = () => {
    const techDefaults: Record<string, boolean> = {}
    TECH_OPTIONS.forEach((tech) => {
      techDefaults[tech] = true
    })
    const bandDefaults: Record<string, boolean> = {}
    availableBands.forEach((band) => {
      bandDefaults[band] = false
    })
    const vendorDefaults: Record<string, boolean> = {}
    availableVendors.forEach((vendor) => {
      vendorDefaults[vendor] = false
    })
    const regionDefaults: Record<string, boolean> = {}
    availableRegions.forEach((region) => {
      regionDefaults[region] = false
    })

    setTechFilters(techDefaults)
    setBandFilters(bandDefaults)
    setVendorFilters(vendorDefaults)
    setRegionFilters(regionDefaults)
    setSearch('')

    setAppliedTechFilters(techDefaults)
    setAppliedBandFilters(bandDefaults)
    setAppliedVendorFilters(vendorDefaults)
    setAppliedRegionFilters(regionDefaults)
    setAppliedSearch('')
    setAppliedOnce(false)
  }

  const handleSelectSite = useCallback((siteId: string) => {
    setSelectedSiteId(siteId)
  }, [])

  const handleSelectCell = useCallback((cellId: string) => {
    setSelectedCellId(cellId)
  }, [])

  const handleUpload = async (file: File) => {
    setUploadError(null)
    const text = await file.text()
    try {
      const parsed = JSON.parse(text) as unknown
      const normalized = normalizeTopology(parsed)
      if (!normalized.ok) {
        setUploadError(normalized.error)
        return
      }
      setTopology(normalized.data)
      setSelectedSiteId(null)
      setSearch('')
      setTopologyKey(file.name)
    } catch (err) {
      setUploadError('El archivo no es un JSON valido.')
    }
  }

  const handleExport = () => {
    const exportPayload = {
      version: topology.version,
      sites: filteredSites,
      cells: filteredCells,
      links: filteredLinks,
    }
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `topology-filtered-${new Date()
      .toISOString()
      .slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const handleExportIssues = () => {
    const csvContent = [
      ['Cell ID', 'Site ID', 'Site Name', 'Region', 'Issue Type', 'Score', 'Details', 'Suggestion'],
      ...interferenceIssues.map(issue => [
        issue.cellId,
        issue.siteId,
        issue.siteName,
        issue.region,
        issue.issueType,
        issue.score.toString(),
        issue.details,
        issue.suggestion
      ])
    ].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `interference-issues-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const stats = {
    sites: filteredSites.length,
    cells: filteredCells.length,
    links: filteredLinks.length,
  }

  const filteredInterferenceSamples = useMemo(() => {
    if (!selectedHour) return interferenceSamples
    return interferenceSamples.filter((sample) => sample.hour === selectedHour)
  }, [interferenceSamples, selectedHour])

  const interferenceValues = filteredInterferenceSamples.filter(
    (sample) => sample.ni_db != null
  )

  const avg = (numbers: number[]) =>
    numbers.length ? Number((numbers.reduce((a, b) => a + b, 0) / numbers.length).toFixed(2)) : 0

  const cellToSite = useMemo(() => {
    const map = new Map<string, Site>()
    topology.sites.forEach((site) => map.set(site.id, site))
    topology.cells.forEach((cell) => {
      const site = map.get(cell.siteId)
      if (site) map.set(cell.id, site)
    })
    return map
  }, [topology.sites, topology.cells])

  type InterferenceIssue = {
    cellId: string
    siteId: string
    siteName: string
    region: string
    issueType: string
    score: number
    details: string
    suggestion: string
  }

  const interferenceIssues = useMemo<InterferenceIssue[]>(() => {
    const byCell = new Map<string, { ni: number[]; pusch: number[]; pucch: number[]; score: number[] }>()

    filteredInterferenceSamples.forEach((sample) => {
      const bucket = byCell.get(sample.cellId) ?? { ni: [], pusch: [], pucch: [], score: [] }
      if (sample.ni_db != null) bucket.ni.push(sample.ni_db)
      if (sample.pusch_bler != null) bucket.pusch.push(sample.pusch_bler)
      if (sample.pucch_bler != null) bucket.pucch.push(sample.pucch_bler)
      if (sample.score != null) bucket.score.push(sample.score)
      byCell.set(sample.cellId, bucket)
    })

    const issues: InterferenceIssue[] = []

    byCell.forEach((metrics, cellId) => {
      const site = cellToSite.get(cellId)
      const siteId = site?.id ?? 'unknown'
      const siteName = site?.name ?? 'unknown'
      const region = site?.region ?? 'Unknown'
      const avgNi = avg(metrics.ni)
      const avgPusch = avg(metrics.pusch)
      const avgPucch = avg(metrics.pucch)
      const avgScore = avg(metrics.score)

      let issueType = 'Moderate'
      let details = 'Interferencia leve'
      let suggestion = 'Mantener monitoreo y validar en el siguiente turno.'

      if (avgScore >= 0.7 || avgNi >= -90 || avgPusch >= 0.2 || avgPucch >= 0.15) {
        issueType = 'Severe Interference'
        details = `NI ${avgNi.toFixed(1)} dB / PUSCH ${avgPusch.toFixed(2)} / PUCCH ${avgPucch.toFixed(2)} / Score ${avgScore.toFixed(2)}`
        suggestion = 'Revisar orientación de antena, ajuste de potencia y aplicar prefijos de banda. Use presets Intenso y recargar malla si es necesario.'
      } else if (avgPusch >= 0.1 || avgPucch >= 0.08) {
        issueType = 'BLER Elevated'
        details = `PUSCH ${avgPusch.toFixed(2)} / PUCCH ${avgPucch.toFixed(2)}`
        suggestion = 'Ajustar parámetros de planificación de recursos y validar con filtro de banda/región.'
      } else if (avgNi >= -100) {
        issueType = 'High Noise'
        details = `NI ${avgNi.toFixed(1)} dB`
        suggestion = 'Revisar interferencias de señal, celdas vecinas y/o crosstalk; usar control de interferencia en mapa.'
      }

      issues.push({
        cellId,
        siteId,
        siteName,
        region,
        issueType,
        score: avgScore,
        details,
        suggestion,
      })
    })

    return issues.sort((a, b) => b.score - a.score)
  }, [filteredInterferenceSamples, cellToSite])

  const recommendedPreset = useMemo(() => {
    if (interferenceIssues.some((issue) => issue.issueType === 'Severe Interference')) {
      return 'Intenso'
    }
    if (
      interferenceIssues.some((issue) => issue.issueType === 'BLER Elevated') ||
      interferenceIssues.some((issue) => issue.issueType === 'High Noise')
    ) {
      return 'Medio'
    }
    return 'Suave'
  }, [interferenceIssues])

  const applyRecommendedCorrection = () => {
    applyPreset(recommendedPreset)
    // Ajustar baseWeight adicionalmente basado en hotspots
    const severeCount = interferenceIssues.filter(issue => issue.issueType === 'Severe Interference').length
    const blerCount = interferenceIssues.filter(issue => issue.issueType === 'BLER Elevated').length
    const noiseCount = interferenceIssues.filter(issue => issue.issueType === 'High Noise').length
    const totalHotspots = severeCount + blerCount + noiseCount
    if (totalHotspots > 5) {
      setBaseWeight(prev => Math.min(prev + 0.05, 0.3)) // Incrementar baseWeight si muchos hotspots
    } else if (severeCount > 0) {
      setBaseWeight(prev => Math.min(prev + 0.03, 0.3))
    }
  }

  const hotspotAreas = useMemo(
    () =>
      interferenceIssues
        .filter((issue) => issue.issueType !== 'Moderate')
        .slice(0, 12)
        .map((issue) => {
          const site = topology.sites.find((s) => s.id === issue.siteId)
          if (!site) return null
          return {
            lat: site.lat,
            lon: site.lon,
            issueType: issue.issueType,
            score: issue.score,
            details: issue.details,
          }
        })
        .filter((i): i is { lat: number; lon: number; issueType: string; score: number; details: string } => Boolean(i)),
    [interferenceIssues, topology.sites]
  )

  // Cell analysis: run classifier when a cell with PRB data is clicked
  const selectedCell = useMemo(
    () => topology.cells.find(c => c.id === selectedCellId) ?? null,
    [topology.cells, selectedCellId]
  )

  const allSitesForAnalysis = useMemo(() =>
    topology.sites.map(s => ({
      id: s.id,
      lat: s.lat,
      lon: s.lon,
      cells: topology.cells.filter(c => c.siteId === s.id).map(c => c.id),
    })),
    [topology.sites, topology.cells]
  )

  const cellAnalysis = useMemo(() => {
    if (!selectedCell?.prbHistogram || !selectedCell.bandNum) return null
    const site = topology.sites.find(s => s.id === selectedCell.siteId)
    if (!site) return null
    return analyzeCell({
      cellId: selectedCell.id,
      bandNum: selectedCell.bandNum,
      bwMhz: selectedCell.bwMhz ?? 10,
      siteLat: site.lat,
      siteLon: site.lon,
      prbHistogram: selectedCell.prbHistogram,
      trafficPerHour: selectedCell.trafficPerHour ?? Array(24).fill(0.5),
      kpi: selectedCell.kpi,
      allSites: allSitesForAnalysis,
    })
  }, [selectedCell, topology.sites, allSitesForAnalysis])

  const sourceHeatmapGeoJSON = useMemo(() => {
    if (!cellAnalysis || !selectedCell) return null
    const site = topology.sites.find(s => s.id === selectedCell.siteId)
    if (!site) return null
    return buildSourceHeatmap(
      site.lat,
      site.lon,
      cellAnalysis.sourceSearchRadiusKm,
      cellAnalysis.matches[0]?.confidence ?? 0.5,
    )
  }, [cellAnalysis, selectedCell, topology.sites])

  const kpis = {
    sites: stats.sites,
    cells: stats.cells,
    links: stats.links,
    // performance
    avgCellsPerSite: stats.sites > 0 ? Number((stats.cells / stats.sites).toFixed(1)) : 0,
    linksPerSite: stats.sites > 0 ? Number((stats.links / stats.sites).toFixed(2)) : 0,
    // interference
    interferenceSamples: filteredInterferenceSamples.length,
    avgNiDb: avg(interferenceValues.map((sample) => sample.ni_db ?? 0)),
    avgPuschBler: avg(
      filteredInterferenceSamples
        .filter((sample) => sample.pusch_bler != null)
        .map((sample) => sample.pusch_bler ?? 0)
    ),
    avgPucchBler: avg(
      filteredInterferenceSamples
        .filter((sample) => sample.pucch_bler != null)
        .map((sample) => sample.pucch_bler ?? 0)
    ),
    avgScore: avg(
      filteredInterferenceSamples
        .filter((sample) => sample.score != null)
        .map((sample) => sample.score ?? 0)
    ),
  }

  const onZoomSelected = () => {
    if (!selectedSiteId) return
    setZoomSignal((prev) => prev + 1)
  }

  useEffect(() => {
    const siteKey = selectedSiteId ? settingsBySite[selectedSiteId] : null
    const topoKey = settingsByTopology[topologyKey] || null
    const active = siteKey ?? topoKey
    if (!active) return
    setGridStepDeg(active.gridStepDeg)
    setBaseWeight(active.baseWeight)
    setPresetName(active.presetName)
  }, [selectedSiteId, settingsBySite, settingsByTopology, topologyKey])

  useEffect(() => {
    const match = Object.entries(PRESETS).find(
      ([, values]) =>
        values.gridStepDeg === gridStepDeg && values.baseWeight === baseWeight
    )
    const next = match ? (match[0] as PresetName) : 'Custom'
    if (presetName !== next) {
      setPresetName(next)
    }
  }, [gridStepDeg, baseWeight, presetName])

  const applyPreset = (name: PresetName) => {
    if (name === 'Custom') return
    const preset = PRESETS[name]
    setGridStepDeg(preset.gridStepDeg)
    setBaseWeight(preset.baseWeight)
    setPresetName(name)
  }

  const handleReset = () => {
    setGridStepDeg(DEFAULT_GRID_STEP)
    setBaseWeight(DEFAULT_BASE_WEIGHT)
    setPresetName('Medio')
  }

  const handleSaveTopology = () => {
    setSettingsByTopology((prev) => ({
      ...prev,
      [topologyKey]: { gridStepDeg, baseWeight, presetName },
    }))
  }

  const handleSaveSite = () => {
    if (!selectedSiteId) return
    setSettingsBySite((prev) => ({
      ...prev,
      [selectedSiteId]: { gridStepDeg, baseWeight, presetName },
    }))
  }

  const currentMapStyle = useMemo(() => {
    return MAP_STYLES.find((style) => style.id === mapStyleId) ?? MAP_STYLES[0]
  }, [mapStyleId])

  console.log('App component rendering...')

  return (
    <div className="app-shell futuristic">
      <div className="map-stage">
        <MapView
          sites={filteredSites}
          links={showLinks ? filteredLinks : []}
          bands={availableBands}
          selectedSiteId={selectedSiteId}
          onSelectSite={handleSelectSite}
          onSelectCell={handleSelectCell}
          showLinks={showLinks}
          zoomToSelectedSignal={zoomSignal}
          cells={displayCells}
          sizeByBand={allBandsEnabled}
          interferenceSamples={interferenceSamples}
          selectedHour={selectedHour}
          showInterference={showInterference}
          gridStepDeg={gridStepDeg}
          baseWeight={baseWeight}
          styleUrl={currentMapStyle.url}
          backdrop={currentMapStyle.backdrop}
          hotspotAreas={hotspotAreas}
          sourceHeatmapGeoJSON={sourceHeatmapGeoJSON}
        />
      </div>

      <header className="top-bar">
        <div>
          <p className="eyebrow">Topology Explorer</p>
          <h1>RAN Physical</h1>
        </div>
        <button className="icon-button" onClick={handleExport}>
          Export
        </button>
      </header>

      {panelCollapsed ? (
        <button className="panel-fab" onClick={() => setPanelCollapsed(false)}>
          <span className="material-icons-round">tune</span>
          Filtros
        </button>
      ) : null}

      <section className="kpi-widgets">
        <h2>KPI Widgets</h2>
        <div className="stat-grid">
          <StatCard label="Sites" value={kpis.sites} />
          <StatCard label="Cells" value={kpis.cells} />
          <StatCard label="Links" value={kpis.links} />
          <div className="stat-card">
            <span className="stat-label">Avg Cells / Site</span>
            <strong className="stat-value">{kpis.avgCellsPerSite}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">Links / Site</span>
            <strong className="stat-value">{kpis.linksPerSite}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">Intf Samples</span>
            <strong className="stat-value">{kpis.interferenceSamples}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">Avg NI (dB)</span>
            <strong className="stat-value">{kpis.avgNiDb}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">Avg PUSCH BLER (%)</span>
            <strong className="stat-value">{kpis.avgPuschBler}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">Avg PUCCH BLER (%)</span>
            <strong className="stat-value">{kpis.avgPucchBler}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">Avg Score</span>
            <strong className="stat-value">{kpis.avgScore}</strong>
          </div>
        </div>

        <div className="panel" style={{ marginTop: '0.8rem' }}>
          <h2>Interference Areas / Celdas</h2>
          {interferenceIssues.length === 0 ? (
            <p className="muted">No hay casos de interferencia detectada en el rango de filtro actual.</p>
          ) : (
            <>
              <div className="button-row compact" style={{ marginBottom: '0.8rem' }}>
                <button className="ghost" onClick={applyRecommendedCorrection}>
                  Aceptar y aplicar a todos los hotspots
                </button>
                <button className="ghost" onClick={handleExportIssues}>
                  Exportar CSV
                </button>
              </div>
              <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(1, minmax(0, 1fr))' }}>
                {interferenceIssues.slice(0, 6).map((issue) => (
                  <div key={`${issue.cellId}-${issue.siteId}`} className="stat-card">
                    <span className="stat-label">{issue.issueType} - {issue.cellId}</span>
                    <strong className="stat-value">{issue.siteName} ({issue.region})</strong>
                    <p style={{ margin: '0.3rem 0', fontSize: '0.72rem', color: '#94a3b8' }}>{issue.details}</p>
                    <p style={{ margin: 0, color: '#c7d2fe', fontSize: '0.7rem' }}><strong>Solución:</strong> {issue.suggestion}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      <div className="stats-stack">
        <div className="stat-orb">
          <div className="stat-ring">
            <span>{stats.sites}</span>
          </div>
          <span>Sites</span>
        </div>
        <div className="stat-orb secondary">
          <div className="stat-ring">
            <span>{stats.cells}</span>
          </div>
          <span>Cells</span>
        </div>
        <div className="stat-orb">
          <div className="stat-ring">
            <span>{stats.links}</span>
          </div>
          <span>Links</span>
        </div>
      </div>

      <Sidebar
        stats={stats}
        techFilters={techFilters}
        onToggleTech={onToggleTech}
        bandFilters={bandFilters}
        availableBands={availableBands}
        onSelectBands={onSelectBands}
        vendorFilters={vendorFilters}
        availableVendors={availableVendors}
        onSelectVendors={onSelectVendors}
        regionFilters={regionFilters}
        availableRegions={availableRegions}
        onSelectRegions={onSelectRegions}
        search={search}
        onSearch={setSearch}
        onApplyFilters={handleApplyFilters}
        onResetFilters={handleResetFilters}
        cellRenderWarning={cellRenderWarning}
        maxCellRender={filteredCells.length}
        appliedOnce={appliedOnce}
        sites={filteredSites}
        cellsBySite={cellsBySite}
        onSelectSite={handleSelectSite}
        selectedSiteId={selectedSiteId}
        showLinks={showLinks}
        onToggleLinks={setShowLinks}
        showInterference={showInterference}
        onToggleInterference={setShowInterference}
        availableHours={availableHours}
        selectedHour={selectedHour}
        onSelectHour={setSelectedHour}
        gridStepDeg={gridStepDeg}
        onGridStepChange={setGridStepDeg}
        baseWeight={baseWeight}
        onBaseWeightChange={setBaseWeight}
        presetName={presetName}
        onPresetSelect={applyPreset}
        onResetInterference={handleReset}
        onSaveTopology={handleSaveTopology}
        onSaveSite={handleSaveSite}
        onApplyRecommendedCorrection={applyRecommendedCorrection}
        canSaveSite={Boolean(selectedSiteId)}
        panelCollapsed={panelCollapsed}
        onTogglePanel={() => setPanelCollapsed((prev) => !prev)}
        mapStyles={MAP_STYLES.map((style) => ({
          id: style.id,
          label: style.label,
        }))}
        mapStyleId={mapStyleId}
        onSelectMapStyle={setMapStyleId}
        onUpload={handleUpload}
        uploadError={uploadError}
        onExport={handleExport}
        onZoomSelected={onZoomSelected}
        hasSelection={Boolean(selectedSite)}
      />

      <SiteDrawer
        site={selectedSite}
        cells={selectedCells}
        onClose={() => setSelectedSiteId(null)}
      />

      {selectedCell && cellAnalysis && (
        <CellAnalysisPanel
          cell={selectedCell}
          analysis={cellAnalysis}
          allCells={topology.cells}
          onClose={() => setSelectedCellId(null)}
        />
      )}

      <nav className="bottom-nav">
        <button className="nav-item active" onClick={() => console.log('Map clicked')}>
          <span className="material-icons-round nav-icon">map</span>
          <span>Map</span>
        </button>
        <button className="nav-item" onClick={() => console.log('Topology clicked')}>
          <span className="material-icons-round nav-icon">hub</span>
          <span>Topology</span>
        </button>
        <button className="nav-item main-action" onClick={() => console.log('Add clicked')}>
          <span className="material-icons-round nav-icon">add</span>
        </button>
        <button className="nav-item" onClick={() => console.log('Stats clicked')}>
          <span className="material-icons-round nav-icon">analytics</span>
          <span>Stats</span>
        </button>
        <button className="nav-item" onClick={() => console.log('Alerts clicked')}>
          <span className="material-icons-round nav-icon">notifications</span>
          <span>Alerts</span>
        </button>
      </nav>
    </div>
  )
}

export default App
