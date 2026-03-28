# Topology Explorer (RAN)

Frontend en React + TypeScript para visualizar topologia fisica de RAN con mapa, filtros, tabla y panel de detalle. Todo corre local en el navegador.

## Instalacion

```bash
npm install
```

## Desarrollo

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Estructura principal

```
src/
  types.ts
  sampleTopology.ts
  topoNormalize.ts
  geojson.ts
  components/
    MapView.tsx
    Sidebar.tsx
    SiteDrawer.tsx
    StatCard.tsx
  App.tsx
```

## Contrato JSON de topologia

```json
{
  "version": "1.0",
  "sites": [
    { "id": "S001", "name": "SITE A", "lat": 4.6, "lon": -74.08, "region": "Bogota", "city": "Bogota" }
  ],
  "cells": [
    { "id": "C001", "siteId": "S001", "tech": "LTE", "band": "B3", "earfcn": 1800, "pci": 10, "azimuth": 0, "tilt": 2 }
  ],
  "links": [
    { "id": "L001", "fromSiteId": "S001", "toSiteId": "S002", "kind": "MW" }
  ],
  "interferenceSamples": [
    { "cellId": "C001", "hour": "13", "ni_db": -96, "pusch_bler": 0.18 }
  ]
}
```

Reglas basicas de validacion:
- `sites` es obligatorio.
- En `sites`: `id`, `lat`, `lon` obligatorios.
- En `cells`: `id`, `siteId` obligatorios (si `cells` existe).
- En `links`: `id`, `fromSiteId`, `toSiteId` obligatorios (si `links` existe).

## Estilo offline (MapLibre)

Por defecto se usa el estilo remoto de MapLibre. Si no carga, la app cae a `public/style.json`, que es un estilo minimo local (sin tiles).

Para usar un estilo offline real con tiles locales:
1. Agrega tus tiles a una carpeta local (por ejemplo `public/tiles/`).
2. Actualiza `public/style.json` para apuntar a esas tiles.
3. Opcional: fija el estilo directamente en `src/components/MapView.tsx` (`FALLBACK_STYLE`).

## Notas
- Todo corre en el navegador, sin backend.
- Filtros y estado de busqueda se guardan en `localStorage`.
- El boton "Export filtered" descarga el JSON filtrado actual.
