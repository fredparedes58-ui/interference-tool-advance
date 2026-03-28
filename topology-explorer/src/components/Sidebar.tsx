import { useRef } from 'react'
import type { ChangeEvent } from 'react'
import type { Site, Tech } from '../types'

type PresetName = 'Suave' | 'Medio' | 'Intenso' | 'Custom'

type SidebarProps = {
  stats: { sites: number; cells: number; links: number }
  techFilters: Record<string, boolean>
  onToggleTech: (tech: Tech) => void
  bandFilters: Record<string, boolean>
  availableBands: string[]
  onSelectBands: (bands: string[]) => void
  vendorFilters: Record<string, boolean>
  availableVendors: string[]
  onSelectVendors: (vendors: string[]) => void
  regionFilters: Record<string, boolean>
  availableRegions: string[]
  onSelectRegions: (regions: string[]) => void
  search: string
  onSearch: (value: string) => void
  showInterference: boolean
  onToggleInterference: (value: boolean) => void
  availableHours: string[]
  selectedHour: string | null
  onSelectHour: (value: string | null) => void
  gridStepDeg: number
  onGridStepChange: (value: number) => void
  baseWeight: number
  onBaseWeightChange: (value: number) => void
  presetName: string
  onPresetSelect: (value: PresetName) => void
  onResetInterference: () => void
  onSaveTopology: () => void
  onSaveSite: () => void
  onApplyRecommendedCorrection: () => void
  canSaveSite: boolean
  panelCollapsed: boolean
  onTogglePanel: () => void
  mapStyles: { id: string; label: string }[]
  mapStyleId: string
  onSelectMapStyle: (id: string) => void
  onApplyFilters: () => void
  onResetFilters: () => void
  appliedOnce: boolean
  cellRenderWarning: boolean
  maxCellRender: number
  onUpload: (file: File) => void
  uploadError: string | null
  onExport: () => void
  onZoomSelected?: () => void
  hasSelection?: boolean
  sites?: Site[]
  cellsBySite?: Record<string, number>
  onSelectSite?: (id: string) => void
  selectedSiteId?: string | null
  showLinks?: boolean
  onToggleLinks?: (value: boolean) => void
}

const Sidebar = ({
  stats,
  techFilters,
  onToggleTech,
  bandFilters,
  availableBands,
  onSelectBands,
  vendorFilters,
  availableVendors,
  onSelectVendors,
  regionFilters,
  availableRegions,
  onSelectRegions,
  search,
  onSearch,
  showInterference,
  onToggleInterference,
  availableHours,
  selectedHour,
  onSelectHour,
  gridStepDeg,
  onGridStepChange,
  baseWeight,
  onBaseWeightChange,
  presetName,
  onPresetSelect,
  onResetInterference,
  onSaveTopology,
  onSaveSite,
  canSaveSite,
  onApplyRecommendedCorrection,
  panelCollapsed,
  onTogglePanel,
  mapStyles,
  mapStyleId,
  onSelectMapStyle,
  onApplyFilters,
  onResetFilters,
  appliedOnce,
  cellRenderWarning,
  maxCellRender,
  onUpload,
  uploadError,
  onExport,
}: SidebarProps) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleFilePick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      await onUpload(file)
      event.target.value = ''
    }
  }

  return (
    <aside className={`control-panel ${panelCollapsed ? 'collapsed' : ''}`}>
      <div className="panel-header floating">
        <div>
          <h2>Network RAN</h2>
        </div>
        <button className="ghost icon-only" onClick={onTogglePanel}>
          <span className="material-icons-round">
            {panelCollapsed ? 'unfold_more' : 'unfold_less'}
          </span>
        </button>
      </div>

      <div className="search-bar">
        <span className="material-icons-round">search</span>
        <input
          placeholder="Search site, region or CID..."
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
        <span className="material-icons-round mic">mic</span>
      </div>

      <section className="stat-row">
        <div>
          <span>Sites</span>
          <strong>{stats.sites}</strong>
        </div>
        <div>
          <span>Cells</span>
          <strong>{stats.cells}</strong>
        </div>
        <div>
          <span>Links</span>
          <strong>{stats.links}</strong>
        </div>
      </section>
      <section className="panel neon">
        <div className="panel-header">
          <h2>Live Network Filters</h2>
          <label className="toggle">
            <input
              type="checkbox"
              checked={showInterference}
              onChange={(event) => onToggleInterference(event.target.checked)}
            />
            <span>Mapa</span>
          </label>
        </div>
        {availableHours.length > 0 ? (
          <>
            <p className="subtle-label">Hora</p>
            <select
              className="select-input single"
              value={selectedHour ?? ''}
              onChange={(event) =>
                onSelectHour(event.target.value || null)
              }
            >
              {availableHours.map((hour) => (
                <option key={hour} value={hour}>
                  {hour}
                </option>
              ))}
            </select>
            <div className="slider-block">
              <div className="button-row compact">
                {(['Suave', 'Medio', 'Intenso'] as PresetName[]).map((preset) => (
                  <button
                    key={preset}
                    className={`pill ${presetName === preset ? 'active' : ''}`}
                    onClick={() => onPresetSelect(preset)}
                  >
                    {preset}
                  </button>
                ))}
                <button className="ghost" onClick={onResetInterference}>
                  Reset
                </button>
              </div>
              <label>
                Grid fino (deg): {gridStepDeg.toFixed(3)}
                <input
                  type="range"
                  min="0.03"
                  max="0.15"
                  step="0.01"
                  value={gridStepDeg}
                  onChange={(event) =>
                    onGridStepChange(Number(event.target.value))
                  }
                />
              </label>
              <label>
                Color base: {baseWeight.toFixed(2)}
                <input
                  type="range"
                  min="0.01"
                  max="0.2"
                  step="0.01"
                  value={baseWeight}
                  onChange={(event) =>
                    onBaseWeightChange(Number(event.target.value))
                  }
                />
              </label>
              <div className="button-row compact">
                <button className="ghost" onClick={onSaveTopology}>
                  Guardar por archivo
                </button>
                <button
                  className="ghost"
                  onClick={onSaveSite}
                  disabled={!canSaveSite}
                >
                  Guardar por sitio
                </button>
                <button
                  className="ghost"
                  onClick={onApplyRecommendedCorrection}
                >
                  Aplicar corrección recomendada
                </button>
              </div>
            </div>
          </>
        ) : (
          <p className="muted">No hay muestras de interferencia.</p>
        )}
      </section>

      <section className="panel">
        <h2>Map Style</h2>
        <div className="pill-row scroll-x">
          {mapStyles.map((style) => (
            <button
              key={style.id}
              className={`pill ${mapStyleId === style.id ? 'active' : ''}`}
              onClick={() => onSelectMapStyle(style.id)}
            >
              {style.label}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Network Technology</h2>
        <div className="pill-row scroll-x">
          {Object.keys(techFilters).map((tech) => (
            <button
              key={tech}
              className={`pill ${techFilters[tech] ? 'active' : ''}`}
              onClick={() => onToggleTech(tech)}
            >
              {tech}
            </button>
          ))}
        </div>
        <div className="pill-row">
          {Object.keys(techFilters)
            .filter((tech) => techFilters[tech])
            .map((tech) => (
              <button
                key={tech}
                className="pill active"
                onClick={() => onToggleTech(tech)}
              >
                {tech} <span className="pill-x">x</span>
              </button>
            ))}
        </div>
        {availableBands.length > 0 ? (
          <>
            <p className="subtle-label">Bandas</p>
            <select
              className="select-input"
              multiple
              value={availableBands.filter((band) => bandFilters[band])}
              onChange={(event) => {
                const selected = Array.from(event.target.selectedOptions).map(
                  (option) => option.value
                )
                onSelectBands(selected)
              }}
            >
              {availableBands.map((band) => (
                <option key={band} value={band}>
                  {band}
                </option>
              ))}
            </select>
            <div className="pill-row">
              {availableBands
                .filter((band) => bandFilters[band])
                .map((band) => (
                  <button
                    key={band}
                    className="pill active"
                    onClick={() => {
                      const next = availableBands.filter(
                        (selected) => selected !== band && bandFilters[selected]
                      )
                      onSelectBands(next)
                    }}
                  >
                    {band} <span className="pill-x">x</span>
                  </button>
                ))}
            </div>
            <p className="muted">Usa Ctrl o Shift para seleccionar varias.</p>
          </>
        ) : null}
        {availableRegions.length > 0 ? (
          <>
            <p className="subtle-label">Provincia</p>
            <select
              className="select-input"
              multiple
              value={availableRegions.filter((region) => regionFilters[region])}
              onChange={(event) => {
                const selected = Array.from(event.target.selectedOptions).map(
                  (option) => option.value
                )
                onSelectRegions(selected)
              }}
            >
              {availableRegions.map((region) => (
                <option key={region} value={region}>
                  {region}
                </option>
              ))}
            </select>
            <div className="pill-row">
              {availableRegions
                .filter((region) => regionFilters[region])
                .map((region) => (
                  <button
                    key={region}
                    className="pill active"
                    onClick={() => {
                      const next = availableRegions.filter(
                        (selected) =>
                          selected !== region && regionFilters[selected]
                      )
                      onSelectRegions(next)
                    }}
                  >
                    {region} <span className="pill-x">x</span>
                  </button>
                ))}
            </div>
            <p className="muted">Usa Ctrl o Shift para seleccionar varias.</p>
          </>
        ) : null}
        {availableVendors.length > 0 ? (
          <>
            <p className="subtle-label">Vendor</p>
            <select
              className="select-input"
              multiple
              value={availableVendors.filter((vendor) => vendorFilters[vendor])}
              onChange={(event) => {
                const selected = Array.from(event.target.selectedOptions).map(
                  (option) => option.value
                )
                onSelectVendors(selected)
              }}
            >
              {availableVendors.map((vendor) => (
                <option key={vendor} value={vendor}>
                  {vendor}
                </option>
              ))}
            </select>
            <div className="pill-row">
              {availableVendors
                .filter((vendor) => vendorFilters[vendor])
                .map((vendor) => (
                  <button
                    key={vendor}
                    className="pill active"
                    onClick={() => {
                      const next = availableVendors.filter(
                        (selected) =>
                          selected !== vendor && vendorFilters[selected]
                      )
                      onSelectVendors(next)
                    }}
                  >
                    {vendor} <span className="pill-x">x</span>
                  </button>
                ))}
            </div>
            <p className="muted">Usa Ctrl o Shift para seleccionar varias.</p>
          </>
        ) : null}
        <input
          className="search-input"
          placeholder="Buscar por sitio, region o ciudad"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
        <button className="primary wide" onClick={onApplyFilters}>
          {appliedOnce ? 'Actualizar filtros' : 'Apply filters'}
        </button>
        {cellRenderWarning ? (
          <p className="error">
            Demasiadas celdas para renderizar. Selecciona menos filtros o elige
            un sitio. Max: {maxCellRender}.
          </p>
        ) : null}
        <button className="ghost wide" onClick={onResetFilters}>
          <span className="material-icons-round">restart_alt</span>
          Reset filters
        </button>
      </section>

      <section className="panel">
        <h2>Import / Export</h2>
        <div className="button-row">
          <button className="primary" onClick={handleFilePick}>
            <span className="material-icons-round">upload_file</span>
            Upload JSON
          </button>
          <button className="ghost" onClick={onExport}>
            <span className="material-icons-round">file_download</span>
            Export filtered
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden-input"
          onChange={handleFileChange}
        />
        {uploadError ? <p className="error">{uploadError}</p> : null}
      </section>

      <section className="panel neon">
        <div className="panel-header">
          <h2>Recommendations</h2>
          <span className="muted">Awaiting KPIs</span>
        </div>
        <p className="muted">
          Importa KPIs/interferencia para generar recomendaciones avanzadas.
        </p>
        <div className="pill-row">
          <span className="pill">PIM</span>
          <span className="pill">IRC</span>
          <span className="pill">PUCCH</span>
          <span className="pill">SPIFHO</span>
        </div>
        <button className="ghost wide">
          <span className="material-icons-round">insights</span>
          Ver detalle
        </button>
      </section>
    </aside>
  )
}

export default Sidebar

