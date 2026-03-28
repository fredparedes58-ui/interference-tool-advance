import type { Cell, Site } from '../types'

type SiteDrawerProps = {
  site: Site | null
  cells: Cell[]
  onClose: () => void
}

const SiteDrawer = ({ site, cells, onClose }: SiteDrawerProps) => {
  if (!site) {
    return <div className="drawer empty">Selecciona un sitio</div>
  }

  const countsByTech = cells.reduce<Record<string, number>>((acc, cell) => {
    acc[cell.tech] = (acc[cell.tech] || 0) + 1
    return acc
  }, {})

  return (
    <div className="drawer sheet">
      <div className="sheet-handle" />
      <div className="drawer-header">
        <div>
          <h3>{site.name}</h3>
          <p className="muted">
            {site.region ?? '-'} · {site.city ?? '-'}
          </p>
          <p className="muted">{site.id}</p>
        </div>
        <button className="ghost" onClick={onClose}>
          Cerrar
        </button>
      </div>
      <div className="sheet-metrics">
        <div>
          <span className="label">Cells Active</span>
          <span>{cells.length}</span>
        </div>
        <div>
          <span className="label">Interference</span>
          <span>Low</span>
        </div>
        <div>
          <span className="label">Techs</span>
          <span>{Object.keys(countsByTech).join(' · ') || '-'}</span>
        </div>
        <div>
          <span className="label">Lat / Lon</span>
          <span>
            {site.lat.toFixed(3)} / {site.lon.toFixed(3)}
          </span>
        </div>
      </div>
      <button className="primary wide">Open dashboard</button>
    </div>
  )
}

export default SiteDrawer
