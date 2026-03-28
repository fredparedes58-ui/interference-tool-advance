# Interference Recommendation Engine

Motor de recomendaciones basado en reglas (decision tree + scoring) para diagnostico de interferencia UL/DL y plan de mitigacion.

## Instalacion

```bash
pip install -e .
```

## CLI

Ejecutar recomendaciones para multiples snapshots:

```bash
interf-advisor run --input metrics.json --out out.json --rules rules.yaml
```

Explicar un caso por celda y dia:

```bash
interf-advisor explain --cell CELL_001 --day 2026-01-15 --input metrics.json --rules rules.yaml
```

## Entrada JSON

Puede ser una lista de snapshots o un objeto con `snapshots`:

```json
[
  {
    "snapshot_day": "2026-01-15",
    "cell_id": "CELL_001",
    "site_id": "SITE_01",
    "tech": "LTE",
    "duplex": "FDD",
    "ul_sinr_db_p50": -6.2,
    "pusch_bler": 0.22,
    "has_4rx": true,
    "pim_class": "PIM_DISTRIBUIDO",
    "pim_reliability": 0.7,
    "pucch_bler_avg": 0.18,
    "ampr_restriction_suspected": true,
    "qci1_active_users": 5,
    "qci1_kpi_degraded": true
  }
]
```

### Spectrograma (opcional)

```json
{
  "cell_id": "CELL_001",
  "spectrogram": {
    "time_bins": ["00","01","02"],
    "rop_bins_dbm": [-120, -118, -116, -114],
    "power_dbm": [
      [-110, -112, -111, -113],
      [-100, -102, -101, -103],
      [-120, -119, -118, -117]
    ]
  }
}
```

El motor calcula `spectral_evidence` con:
- `affected_fraction` (porcion del espectro afectada)
- `affected_hours` (horas con alta ocupacion)
- `affected_rop_bins_dbm`

## Reglas (rules.yaml)

- `thresholds`: umbrales de disparo.
- `rule_switches`: habilita/deshabilita categorias.
- `weights`: pesos para scoring.
- `base_confidence`: confianza base para hard/soft.

Ajusta `rules.yaml` segun tus criterios de operador.

## Salida

La salida es una lista priorizada de recomendaciones con acciones, parametros sugeridos, prerequisitos, conflictos y verificacion:

```json
{
  "cell_id": "CELL_001",
  "snapshot_day": "2026-01-15",
  "recommendations": [
    {
      "category": "PIM_CONFIRMED",
      "confidence": 0.9,
      "severity": "high",
      "actions": [
        {
          "title": "Enable PIM Detection",
          "feature_id": "FAJ 121 5436",
          "config_changes": [{"mo": "EUtranCell*", "param": "pimDetectionEnabled", "value": true}],
          "verify_with": ["ul_sinr_db_p10", "pusch_bler"],
          "rollback": {"what_to_revert": "Disable PIM Detection if no improvement."},
          "reason_codes": ["PIM_DISTRIBUIDO"]
        }
      ],
      "explanations": ["pim_class: PIM_DISTRIBUIDO", "pim_reliability: 0.7"]
    }
  ],
  "explanations": ["pim_class: PIM_DISTRIBUIDO", "pim_reliability: 0.7"],
  "do_not_do": []
}
```

## Features soportadas

- PIM Detection / Avoidance
- PIM suspected (validation workflow)
- Atmospheric Duct Interference Reduction
- IRC / 4x4 IRC / IRC AAS FDD
- PUCCH Overdimensioning, Dynamic PUCCH, Flexible Uplink Processing
- Uplink-Triggered IF Mobility
- SPIFHO (Service or Priority Triggered IF HO)
- Decoupled PDCCH LA
- UL RLC Retx Threshold
- IFLB
- Interference Sensing (NR)
- Intelligent Power Emission Control
- Instant Uplink Access
