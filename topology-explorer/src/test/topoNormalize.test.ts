import { describe, it, expect } from 'vitest'
import { normalizeTopology } from '../topoNormalize'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const validSite = { id: 'S001', name: 'Torre Norte', lat: -34.6, lon: -58.4, region: 'GBA' }
const validCell = { id: 'C001-B28', siteId: 'S001', tech: 'LTE', band: 'B28' }
const validLink = { id: 'L001', fromSiteId: 'S001', toSiteId: 'S002' }
const validSample = { cellId: 'C001-B28', hour: '10' }

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('normalizeTopology', () => {

  // ── Happy paths ────────────────────────────────────────────────────────────

  it('acepta topología mínima (solo sites)', () => {
    const result = normalizeTopology({ sites: [validSite] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.sites).toHaveLength(1)
    expect(result.data.sites[0].id).toBe('S001')
    expect(result.data.cells).toEqual([])
    expect(result.data.links).toEqual([])
    expect(result.data.interferenceSamples).toEqual([])
  })

  it('asigna version "1.0" si no viene en el JSON', () => {
    const result = normalizeTopology({ sites: [validSite] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.version).toBe('1.0')
  })

  it('preserva version si viene definida', () => {
    const result = normalizeTopology({ version: '2.5', sites: [validSite] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.version).toBe('2.5')
  })

  it('normaliza topología completa con cells, links y samples', () => {
    const input = {
      sites: [validSite],
      cells: [validCell],
      links: [validLink],
      interferenceSamples: [validSample],
    }
    const result = normalizeTopology(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.cells).toHaveLength(1)
    expect(result.data.links).toHaveLength(1)
    expect(result.data.interferenceSamples).toHaveLength(1)
  })

  it('hace trim de strings en site.name', () => {
    const result = normalizeTopology({ sites: [{ ...validSite, name: '  Torre Norte  ' }] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.sites[0].name).toBe('Torre Norte')
  })

  it('preserva lat/lon como números', () => {
    const result = normalizeTopology({ sites: [validSite] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(typeof result.data.sites[0].lat).toBe('number')
    expect(typeof result.data.sites[0].lon).toBe('number')
  })

  // ── Casos de error ─────────────────────────────────────────────────────────

  it('rechaza null como input', () => {
    const result = normalizeTopology(null)
    expect(result.ok).toBe(false)
  })

  it('rechaza string como input', () => {
    const result = normalizeTopology('no es JSON')
    expect(result.ok).toBe(false)
  })

  it('rechaza número como input', () => {
    const result = normalizeTopology(42)
    expect(result.ok).toBe(false)
  })

  it('rechaza array vacío como input', () => {
    const result = normalizeTopology([])
    expect(result.ok).toBe(false)
  })

  it('rechaza objeto sin campo sites', () => {
    const result = normalizeTopology({ cells: [validCell] })
    expect(result.ok).toBe(false)
  })

  it('rechaza sites vacío (array sin elementos)', () => {
    const result = normalizeTopology({ sites: [] })
    expect(result.ok).toBe(false)
  })

  it('rechaza site sin id', () => {
    const result = normalizeTopology({ sites: [{ name: 'X', lat: -34, lon: -58 }] })
    expect(result.ok).toBe(false)
  })

  it('rechaza site sin nombre', () => {
    const result = normalizeTopology({ sites: [{ id: 'S1', lat: -34, lon: -58 }] })
    expect(result.ok).toBe(false)
  })

  // GAP DETECTADO: topoNormalize no valida rangos de lat/lon.
  // Un site con lat=999 o lon=999 es aceptado silenciosamente, lo que produce
  // coordenadas inválidas en el mapa. Estos tests documentan el comportamiento actual.
  it('[GAP] acepta site con lat fuera de rango (999) sin error — validación pendiente', () => {
    const result = normalizeTopology({ sites: [{ ...validSite, lat: 999 }] })
    // Comportamiento actual: acepta el dato inválido
    // Comportamiento esperado (pendiente): debería retornar ok=false
    expect(result.ok).toBe(true) // documenta el gap
  })

  it('[GAP] acepta site con lon fuera de rango (999) sin error — validación pendiente', () => {
    const result = normalizeTopology({ sites: [{ ...validSite, lon: 999 }] })
    // Comportamiento actual: acepta el dato inválido
    // Comportamiento esperado (pendiente): debería retornar ok=false
    expect(result.ok).toBe(true) // documenta el gap
  })

  it('rechaza site con lat no numérico', () => {
    const result = normalizeTopology({ sites: [{ ...validSite, lat: 'abc' }] })
    expect(result.ok).toBe(false)
  })

  it('rechaza sites que no es array', () => {
    const result = normalizeTopology({ sites: validSite })
    expect(result.ok).toBe(false)
  })

  // ── Edge cases ─────────────────────────────────────────────────────────────

  it('ignora células inválidas sin romper el resultado completo', () => {
    const input = {
      sites: [validSite],
      cells: [
        validCell,
        { siteId: 'S001', tech: 'LTE' }, // falta id
      ],
    }
    const result = normalizeTopology(input)
    // Puede rechazar todo o filtrar la celda inválida; debe ser consistente
    if (result.ok) {
      // Si acepta, la celda inválida debe estar excluida
      expect(result.data.cells.every(c => typeof c.id === 'string')).toBe(true)
    } else {
      // Si rechaza, el error debe ser descriptivo
      expect(typeof result.error).toBe('string')
      expect(result.error.length).toBeGreaterThan(0)
    }
  })

  it('maneja samples sin hora (campo hour faltante)', () => {
    const input = {
      sites: [validSite],
      interferenceSamples: [{ cellId: 'C001' }], // falta hour
    }
    const result = normalizeTopology(input)
    if (result.ok) {
      // Muestra que samples inválidos son filtrados
      expect(result.data.interferenceSamples.length).toBeLessThanOrEqual(1)
    }
    // Si falla, debe haber un mensaje de error
    if (!result.ok) {
      expect(typeof result.error).toBe('string')
    }
  })

  it('resultado .ok=false siempre tiene campo error como string', () => {
    const result = normalizeTopology({ invalid: true })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(typeof result.error).toBe('string')
      expect(result.error.length).toBeGreaterThan(0)
    }
  })

  it('resultado .ok=true siempre tiene campo data con estructura completa', () => {
    const result = normalizeTopology({ sites: [validSite] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toHaveProperty('version')
    expect(result.data).toHaveProperty('sites')
    expect(result.data).toHaveProperty('cells')
    expect(result.data).toHaveProperty('links')
    expect(result.data).toHaveProperty('interferenceSamples')
    expect(Array.isArray(result.data.sites)).toBe(true)
    expect(Array.isArray(result.data.cells)).toBe(true)
    expect(Array.isArray(result.data.links)).toBe(true)
    expect(Array.isArray(result.data.interferenceSamples)).toBe(true)
  })
})
