import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { cellsToSectorsGeoJSON, linksToGeoJSON, sitesToGeoJSON } from '../geojson'
import { buildInterferenceGrid } from '../interference'
import type { Cell, InterferenceSample, Link, Site } from '../types'
import type { Expression } from 'maplibre-gl'

type SourceHeatmapGeoJSON = {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    geometry: { type: 'Point'; coordinates: [number, number] }
    properties: { weight: number }
  }>
} | null

type MapViewProps = {
  sites: Site[]
  links: Link[]
  cells: Cell[]
  bands: string[]
  selectedSiteId: string | null
  showLinks: boolean
  sizeByBand: boolean
  interferenceSamples: InterferenceSample[]
  selectedHour: string | null
  showInterference: boolean
  hotspotAreas: {
    lat: number
    lon: number
    siteId: string
    issueType: string
    score: number
    details: string
  }[]
  gridStepDeg: number
  baseWeight: number
  styleUrl: string
  backdrop: string
  onSelectSite: (siteId: string) => void
  onSelectCell?: (cellId: string) => void
  onSelectHotspot?: (siteId: string) => void
  zoomToSelectedSignal: number
  sourceHeatmapGeoJSON?: SourceHeatmapGeoJSON
}

const REMOTE_STYLE = 'https://demotiles.maplibre.org/style.json'
const FALLBACK_STYLE = '/style.json'

const zoomScale = (zoom: number) => {
  if (zoom <= 8) return 0.18
  if (zoom >= 15) return 0.9
  // linear entre 8 y 15
  return 0.18 + ((zoom - 8) / (15 - 8)) * (0.9 - 0.18)
}

const clamp = (val: number, min: number, max: number) =>
  Math.max(min, Math.min(max, val))

const hash01 = (str: string) => {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0
  }
  return ((h >>> 0) % 1000) / 1000
}

const MapView = ({
  sites,
  links,
  cells,
  bands,
  selectedSiteId,
  showLinks,
  sizeByBand,
  interferenceSamples,
  selectedHour,
  showInterference,
  hotspotAreas,
  gridStepDeg,
  baseWeight,
  styleUrl,
  backdrop,
  onSelectSite,
  onSelectCell,
  onSelectHotspot,
  zoomToSelectedSignal,
  sourceHeatmapGeoJSON,
}: MapViewProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  void sizeByBand
  const [styleUrlState, setStyleUrlState] = useState(styleUrl || REMOTE_STYLE)
  const [styleFallbackUsed, setStyleFallbackUsed] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(6.2)
  const [densityFactor, setDensityFactor] = useState(1)

  const siteById = useMemo(() => {
    const map = new Map<string, Site>()
    sites.forEach((site) => map.set(site.id, site))
    return map
  }, [sites])

  const sitesGeojson = useMemo(() => sitesToGeoJSON(sites, {}), [sites])

  const linksGeojson = useMemo(
    () => linksToGeoJSON(links, siteById),
    [links, siteById]
  )

  const bandPalette = useMemo(() => {
    const palette = [
      '#38bdf8',
      '#a855f7',
      '#f97316',
      '#22c55e',
      '#eab308',
      '#ec4899',
      '#0ea5e9',
      '#f43f5e',
      '#8b5cf6',
      '#10b981',
    ]
    const map = new Map<string, string>()
    bands.forEach((band, idx) => {
      map.set(band, palette[idx % palette.length])
    })
    if (!map.has('Unknown')) map.set('Unknown', '#94a3b8')
    return map
  }, [bands])

  const bandRadius = useMemo(() => {
    const base = 260
    const step = 70
    const radius: Record<string, number> = { Unknown: base }
    const scale = zoomScale(zoomLevel) * densityFactor
    bands.forEach((band, idx) => {
      const bandSize = (base + idx * step) * scale
      radius[band] = sizeByBand ? bandSize : base * scale
    })
    return radius
  }, [bands, zoomLevel, densityFactor, sizeByBand])

  const bandFillExpression: any = useMemo(() => {
    const pairs: (string | Expression)[] = ['Unknown', bandPalette.get('Unknown') ?? '#94a3b8']
    bands.forEach((band) => {
      pairs.push(band, bandPalette.get(band) ?? '#94a3b8')
    })
    return [
      'case',
      ['==', ['get', 'siteId'], selectedSiteId ?? ''],
      '#f59e0b',
      ['match', ['get', 'band'], ...pairs, '#94a3b8'],
    ]
  }, [bands, bandPalette, selectedSiteId])

  const cellsGeojson = useMemo(
    () =>
      cellsToSectorsGeoJSON(
        cells,
        siteById,
        800,
        bandRadius,
        (cell, bandR) => {
          const jitter = 0.7 + hash01(cell.id) * 0.6 // 0.7x .. 1.3x
          return bandR * jitter
        }
      ),
    [cells, siteById, bandRadius]
  )

  const cellsCenterGeojson = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: cells.flatMap((cell) => {
      const site = siteById.get(cell.siteId)
      if (!site) return []
      return [{
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [site.lon, site.lat] as [number, number] },
        properties: { id: cell.id, band: cell.band ?? 'Unknown', siteId: cell.siteId },
      }]
    }),
  }), [cells, siteById])

  const interferenceGeojson = useMemo(
    () =>
      buildInterferenceGrid(interferenceSamples, sites, cells, selectedHour, {
        gridStepDeg,
        baseWeight,
      }),
    [interferenceSamples, sites, cells, selectedHour, gridStepDeg, baseWeight]
  )


  useEffect(() => {
    if (!containerRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrlState,
      center: [-3.7038, 40.4168],
      zoom: 6.2,
    })

    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    const fallbackTimer = window.setTimeout(() => {
      if (styleFallbackUsed) return
      setStyleFallbackUsed(true)
      setStyleUrlState(FALLBACK_STYLE)
    }, 5000)

    let fallbackTriggered = false
    const triggerFallback = () => {
      if (fallbackTriggered || styleFallbackUsed) return
      fallbackTriggered = true
      window.clearTimeout(fallbackTimer)
      setStyleFallbackUsed(true)
      setStyleUrlState(FALLBACK_STYLE)
    }

    map.on('load', () => {
      window.clearTimeout(fallbackTimer)
      map.addSource('sites', {
        type: 'geojson',
        data: sitesGeojson,
      })

      map.addSource('interference', {
        type: 'geojson',
        data: interferenceGeojson,
      })

      map.addSource('cells', {
        type: 'geojson',
        data: cellsGeojson,
      })

      map.addSource('cells-center', {
        type: 'geojson',
        data: cellsCenterGeojson,
      })

      map.addSource('links', {
        type: 'geojson',
        data: linksGeojson,
      })

      map.addSource('hotspots', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: hotspotAreas.map((item) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [item.lon, item.lat] },
            properties: {
              siteId: item.siteId,
              issueType: item.issueType,
              score: item.score,
              details: item.details,
            },
          })),
        },
      })

      map.addSource('source-heatmap', {
        type: 'geojson',
        data: sourceHeatmapGeoJSON ?? { type: 'FeatureCollection', features: [] },
      })

      map.addLayer({
        id: 'source-heatmap-layer',
        type: 'heatmap',
        source: 'source-heatmap',
        paint: {
          'heatmap-weight': ['get', 'weight'],
          'heatmap-intensity': [
            'interpolate', ['linear'], ['zoom'],
            4, 1.0,
            10, 2.5,
            14, 4.0,
          ],
          'heatmap-radius': [
            'interpolate', ['linear'], ['zoom'],
            4, 30,
            10, 50,
            14, 80,
          ],
          'heatmap-opacity': 0.80,
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0,   'rgba(255, 255, 0, 0)',
            0.2, 'rgba(255, 220, 0, 0.3)',
            0.4, 'rgba(255, 150, 0, 0.55)',
            0.6, 'rgba(255, 80, 0, 0.72)',
            0.8, 'rgba(220, 20, 20, 0.85)',
            1.0, 'rgba(180, 0, 100, 0.95)',
          ],
        },
      })

      map.addLayer({
        id: 'hotspots-circle',
        type: 'circle',
        source: 'hotspots',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'score'], 0, 5, 1, 18],
          'circle-color': [
            'match',
            ['get', 'issueType'],
            'Severe Interference',
            '#ef4444',
            'BLER Elevated',
            '#f59e0b',
            'High Noise',
            '#3b82f6',
            '#94a3b8',
          ],
          'circle-opacity': 0.85,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.2,
        },
      })

      map.addLayer({
        id: 'hotspots-heat',
        type: 'heatmap',
        source: 'hotspots',
        paint: {
          'heatmap-weight': ['get', 'score'],
          'heatmap-intensity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            4,
            0.8,
            9,
            1.4,
            12,
            2.0,
          ],
          'heatmap-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            4,
            25,
            10,
            45,
            12,
            65,
          ],
          'heatmap-opacity': 0.75,
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0,
            'rgba(34, 197, 94, 0.1)',
            0.3,
            'rgba(251, 191, 36, 0.4)',
            0.6,
            'rgba(239, 68, 68, 0.6)',
            0.9,
            'rgba(127, 29, 29, 0.9)',
            1,
            'rgba(99, 0, 0, 1)',
          ],
        },
      })

      map.addLayer({
        id: 'interference-heat',
        type: 'heatmap',
        source: 'interference',
        paint: {
          'heatmap-weight': ['get', 'weight'],
          'heatmap-intensity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            4,
            0.6,
            9,
            1.1,
            12,
            1.6,
          ],
          'heatmap-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            4,
            18,
            10,
            30,
            12,
            40,
          ],
          'heatmap-opacity': showInterference ? 0.65 : 0,
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0,
            'rgba(15, 23, 42, 0.2)',
            0.2,
            'rgba(251, 191, 36, 0.35)',
            0.4,
            'rgba(251, 146, 60, 0.55)',
            0.6,
            'rgba(239, 68, 68, 0.7)',
            0.8,
            'rgba(220, 38, 38, 0.85)',
            1,
            'rgba(127, 29, 29, 0.95)',
          ],
        },
      })

      map.addLayer({
        id: 'links-line',
        type: 'line',
        source: 'links',
        paint: {
          'line-color': '#6ee7b7',
          'line-width': 2,
          'line-opacity': 0.7,
        },
      })

      map.addLayer({
        id: 'cells-dot',
        type: 'circle',
        source: 'cells-center',
        maxzoom: 10,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2, 7, 3.5, 10, 5],
          'circle-color': bandFillExpression,
          'circle-opacity': 0.85,
          'circle-stroke-color': '#0f172a',
          'circle-stroke-width': 0.5,
        },
      })

      map.addLayer({
        id: 'cells-sector',
        type: 'fill',
        source: 'cells',
        minzoom: 10,
        paint: {
          'fill-color': bandFillExpression,
          'fill-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            8,
            0.08,
            12,
            0.14,
            15,
            0.2,
          ],
        },
      })

      map.addLayer({
        id: 'cells-sector-line',
        type: 'line',
        source: 'cells',
        minzoom: 10,
        paint: {
          'line-color': '#0f172a',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5,
            0.35,
            11,
            0.8,
            15,
            1.2,
          ],
          'line-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5,
            0.12,
            11,
            0.32,
            15,
            0.55,
          ],
        },
      })

      if (sites.length <= 5000) {
        map.addLayer({
          id: 'sites-label',
          type: 'symbol',
          source: 'sites',
          layout: {
            'text-field': ['concat', ['get', 'name'], ' - ', ['get', 'id']],
            'text-size': 12,
            'text-offset': [0, 1.2],
            'text-anchor': 'top',
            'text-optional': true,
          },
          paint: {
            'text-color': '#e2e8f0',
            'text-halo-color': '#0f172a',
            'text-halo-width': 1.2,
          },
          minzoom: 13,
        })
      }

      map.on('click', 'cells-sector', (event) => {
        const feature = event.features?.[0]
        const cellId = feature?.properties?.id   // geojson.ts uses 'id' for cell.id
        const siteId = feature?.properties?.siteId
        if (typeof cellId === 'string' && onSelectCell) {
          onSelectCell(cellId)
        } else if (typeof siteId === 'string') {
          onSelectSite(siteId)
        }
      })

      map.on('mouseenter', 'cells-sector', () => {
        map.getCanvas().style.cursor = 'pointer'
      })

      map.on('mouseleave', 'cells-sector', () => {
        map.getCanvas().style.cursor = ''
      })

      map.on('click', 'hotspots-circle', (event) => {
        const feature = event.features?.[0]
        if (!feature) return
        const siteId = feature.properties?.siteId
        if (typeof siteId === 'string') {
          map.flyTo({
            center: (feature.geometry as any).coordinates,
            zoom: Math.max(map.getZoom(), 13),
            duration: 700,
          })
          onSelectHotspot?.(siteId)
        }
      })

      map.on('mouseenter', 'hotspots-circle', () => {
        map.getCanvas().style.cursor = 'pointer'
      })

      map.on('mouseleave', 'hotspots-circle', () => {
        map.getCanvas().style.cursor = ''
      })

      map.on('mousemove', 'hotspots-circle', (event) => {
        const feature = event.features?.[0]
        if (!feature) return
        const issueType = feature.properties?.issueType
        const score = feature.properties?.score
        const details = feature.properties?.details
        if (issueType && score != null) {
          const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false })
            .setLngLat((feature.geometry as any).coordinates)
            .setHTML(`<strong>${issueType}</strong><br/>Score: ${score.toFixed(2)}<br/>${details}`)
            .addTo(map)

          map.on('mouseleave', 'hotspots-circle', () => {
            popup.remove()
          })
        }
      })

      const updateViewMetrics = () => {
        const currentZoom = map.getZoom()
        setZoomLevel(currentZoom)

        // densidad: cuántos sitios hay en viewport, para encoger cuando hay muchos
        const bounds = map.getBounds()
        const visibleSites = sites.filter(
          (s) =>
            s.lon >= bounds.getWest() &&
            s.lon <= bounds.getEast() &&
            s.lat >= bounds.getSouth() &&
            s.lat <= bounds.getNorth()
        ).length
        // fórmula simple: factor ~ sqrt(60 / N), limitado
        const factor = clamp(Math.sqrt(60 / (visibleSites + 1)), 0.2, 1)
        setDensityFactor(factor)
      }

      map.on('zoom', updateViewMetrics)
      map.on('moveend', updateViewMetrics)
      updateViewMetrics()
    })

    const loggedErrors = new Set<string>()
    map.on('error', (e) => {
      const msg = (e as any)?.error?.message ?? (e as any)?.message ?? 'unknown'
      const status = (e as any)?.status
      // Silence repeated tile 404/network errors after first occurrence
      const key = `${msg}:${status ?? ''}`
      if (!loggedErrors.has(key)) {
        loggedErrors.add(key)
        console.warn('MapView style/tile error:', msg, status ? `(HTTP ${status})` : '')
      }
      // If this is a style-load failure (not a mid-session tile error), switch to offline fallback
      if (!map.isStyleLoaded() && styleUrlState !== FALLBACK_STYLE) {
        triggerFallback()
      }
    })

    return () => {
      window.clearTimeout(fallbackTimer)
      map.remove()
      mapRef.current = null
    }
  }, [styleUrlState, onSelectSite])

  useEffect(() => {
    if (styleUrl) {
      setStyleFallbackUsed(false)
      setStyleUrlState(styleUrl)
    }
  }, [styleUrl])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const source = map.getSource('sites') as maplibregl.GeoJSONSource
    if (source) source.setData(sitesGeojson)
  }, [sitesGeojson])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const source = map.getSource('interference') as maplibregl.GeoJSONSource
    if (source) source.setData(interferenceGeojson)
  }, [interferenceGeojson])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const source = map.getSource('cells') as maplibregl.GeoJSONSource
    if (source) source.setData(cellsGeojson)
  }, [cellsGeojson])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const source = map.getSource('cells-center') as maplibregl.GeoJSONSource
    if (source) source.setData(cellsCenterGeojson)
  }, [cellsCenterGeojson])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const source = map.getSource('links') as maplibregl.GeoJSONSource
    if (source) source.setData(linksGeojson)
  }, [linksGeojson])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const source = map.getSource('hotspots') as maplibregl.GeoJSONSource
    if (source) {
      source.setData({
        type: 'FeatureCollection',
        features: hotspotAreas.map((item) => ({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [item.lon, item.lat],
          },
          properties: {
            siteId: item.siteId,
            issueType: item.issueType,
            score: item.score,
            details: item.details,
          },
        })),
      })
    }
  }, [hotspotAreas])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const source = map.getSource('source-heatmap') as maplibregl.GeoJSONSource | undefined
    if (source) {
      source.setData(sourceHeatmapGeoJSON ?? { type: 'FeatureCollection', features: [] })
    }
  }, [sourceHeatmapGeoJSON])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (map.getLayer('links-line')) {
      map.setLayoutProperty(
        'links-line',
        'visibility',
        showLinks ? 'visible' : 'none'
      )
    }
  }, [showLinks])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('interference-heat')) return
    map.setPaintProperty(
      'interference-heat',
      'heatmap-opacity',
      showInterference ? 0.65 : 0
    )
  }, [showInterference])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (map.getLayer('cells-sector')) map.setPaintProperty('cells-sector', 'fill-color', bandFillExpression)
    if (map.getLayer('cells-dot')) map.setPaintProperty('cells-dot', 'circle-color', bandFillExpression)
  }, [bandFillExpression])

  useEffect(() => {
    const map = mapRef.current
    if (!map || sites.length === 0) return
    const bounds = new maplibregl.LngLatBounds()
    sites.forEach((site) => bounds.extend([site.lon, site.lat]))
    map.fitBounds(bounds, { padding: 120, duration: 700 })
  }, [sites])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !selectedSiteId || sites.length === 0) return
    const site = sites.find((item) => item.id === selectedSiteId)
    if (!site) return
    map.flyTo({
      center: [site.lon, site.lat],
      zoom: Math.max(map.getZoom(), 11),
      duration: 600,
    })
  }, [zoomToSelectedSignal, selectedSiteId, sites])

  return (
    <div
      ref={containerRef}
      className={`map-canvas ${backdrop === 'blueprint' ? 'blueprint' : ''}`}
    />
  )
}

export default MapView
