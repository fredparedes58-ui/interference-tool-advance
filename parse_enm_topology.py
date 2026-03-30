"""
parse_enm_topology.py
=====================
Convierte archivos de topología física Ericsson ENM al formato JSON que
consume topology-explorer.

Soporta dos formatos de entrada:
  - TXT  (UTF-16 LE, separador TAB)  — export clásico ENM
  - CSV  (UTF-8 / UTF-8-BOM, separador ;) — export Sedra / nuevo ENM

Opciones de PRB Histogram (para el clasificador de interferencia):
  --kpi-file  CSV con KPIs por celda → sintetiza patrón PRB probable
              Columnas: cell_id;rssi_avg_dbm;ul_sinr_p50_db;pusch_bler_avg;pucch_bler_avg
  --prb-file  CSV con datos reales de PRB (SeeWave / OMI export)
              Columnas: cell_id;prb_index;h00;h01;...;h23  (una fila por PRB × celda)
              O bien:   cell_id;hour;prb_00;prb_01;...;prb_N (una fila por hora × celda)

El script detecta el formato automáticamente por extensión del archivo.

Uso:
    python parse_enm_topology.py                                    # auto: TXT si existe, luego CSV
    python parse_enm_topology.py --input archivo.csv                # CSV explícito
    python parse_enm_topology.py --input archivo.txt                # TXT explícito
    python parse_enm_topology.py --province Madrid                  # solo Madrid
    python parse_enm_topology.py --province Sevilla --province Madrid
    python parse_enm_topology.py --zone RCEN                        # zona RCEN
    python parse_enm_topology.py --vendor ERICSSON                  # solo Ericsson
    python parse_enm_topology.py --carrier ORANGE                   # solo celdas de ORANGE
    python parse_enm_topology.py --max-sites 2000                   # máximo 2000 sitios
    python parse_enm_topology.py --kpi-file kpis.csv                # añadir histogramas PRB sintéticos
    python parse_enm_topology.py --prb-file prb_export.csv          # histogramas PRB reales (SeeWave)
    python parse_enm_topology.py --list-provinces                   # listar provincias
    python parse_enm_topology.py --list-zones                       # listar zonas
    python parse_enm_topology.py --list-carriers                    # listar carriers

Salida: topology-explorer/public/topology.json
"""

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

BASE_DIR   = Path(r"C:\Users\pparedes\OneDrive - Kenmei Technologies\Escritorio\Interference tool")
INPUT_TXT  = BASE_DIR / "Topologia fisca" / "inputs_physical_data_4G_.txt"
INPUT_CSV  = BASE_DIR / "Topologia fisca" / "inputs_physical_data_4G_2026w03_4G_2026w03_Sedra.csv"
OUTPUT_FILE = BASE_DIR / "topology-explorer" / "public" / "topology.json"

def _default_input() -> Path:
    """Elige el archivo de entrada por defecto: CSV si existe, si no TXT."""
    if INPUT_CSV.exists():
        return INPUT_CSV
    return INPUT_TXT

# ---------------------------------------------------------------------------
# Band name → numeric band mapping (Spain / EU)
# ---------------------------------------------------------------------------

BAND_MAP: dict[str, int] = {
    "LTE 700":       28,   # B28 – 700 MHz (APT)
    "IOT LTE 700":   28,
    "LTE 800":       20,   # B20 – 800 MHz (EU Digital Dividend)
    "IOT LTE 800":   20,
    "LTE 900":        8,   # B8  – 900 MHz
    "IOT LTE 900":    8,
    "LTE 1800":       3,   # B3  – 1800 MHz
    "IOT LTE 1800":   3,
    "LTE 2100":       1,   # B1  – 2100 MHz
    "IOT LTE 2100":   1,
    "LTE 2600":       7,   # B7  – 2600 MHz
    "IOT LTE 2600":   7,
    "LTE 3500":      78,   # B78 – 3500 MHz (NR n78)
}

BW_MAP: dict[int, float] = {
    20: 10.0,   # B20 typically 10 MHz in Spain
    28: 10.0,
     3: 20.0,   # B3 often 20 MHz
     8: 10.0,
     1: 15.0,   # B1 typically 15 MHz
     7: 20.0,   # B7 often 20 MHz
    78: 100.0,
}

# ---------------------------------------------------------------------------
# Coordinate parser: "-5.994.682" → -5.994682
# Format: Spanish/ENM uses periods as thousand separators, all digits → divide by 1e6
# ---------------------------------------------------------------------------

def parse_coord(s: str) -> float | None:
    if not s:
        return None
    clean = s.replace(".", "").replace(",", "").replace(" ", "")
    if not clean.lstrip("-").isdigit():
        return None
    val = int(clean)
    # Detect if value is already in degree range (no scaling needed)
    # Raw values like -5994682 → divide by 1_000_000
    if abs(val) > 180:
        return val / 1_000_000
    return float(val)


# ---------------------------------------------------------------------------
# Beamwidth parser: "65+/-5", "65 /-6", "65", "58 /-6 | 58 /-7" → 65.0
# ---------------------------------------------------------------------------

def parse_beamwidth(s: str) -> float:
    if not s:
        return 65.0
    m = re.search(r"(\d+\.?\d*)", s)
    if m:
        return float(m.group(1))
    return 65.0


# ---------------------------------------------------------------------------
# PRB histogram helpers
# ---------------------------------------------------------------------------

THERMAL_FLOOR = -108.0

# Número de PRBs por ancho de banda
N_PRB_BY_BW: dict[float, int] = {5.0: 25, 10.0: 50, 15.0: 75, 20.0: 100, 100.0: 264}


def _n_prb(bw_mhz: float) -> int:
    return N_PRB_BY_BW.get(bw_mhz, 50)


def _flat_histogram(n_prb: int, level_dbm: float) -> list[list[float]]:
    """Histograma plano: todos los PRBs al mismo nivel, 24 horas."""
    row = [round(level_dbm, 1)] * 24
    return [row[:] for _ in range(n_prb)]


def synthesize_prb_histogram(
    band_num: int,
    bw_mhz: float,
    rssi_dbm: float,
    sinr_db: float,
    pusch_bler: float,
    pucch_bler: float,
) -> list[list[float]]:
    """
    Genera un histograma PRB sintético a partir de KPIs de celda.

    Reglas de síntesis (basadas en firmas de campo):
    - sinr < -5 o pusch_bler > 0.20  → interferencia severa wideband (plano alto)
    - B5/B17 + sinr < -2              → probable FM harmonic → PRBs bajos elevados
    - B28 + sinr < -2                 → probable Cable TV / TV digital → flat o borde bajo
    - B41 + sinr < -3                 → probable WISP 2500 → bottom PRBs elevados
    - pucch_bler > 0.15               → jammer (patrón temporal, usamos flat + subida en h7-18)
    - sinr limpio (>= 0)              → piso térmico
    """
    n = _n_prb(bw_mhz)
    THERMAL = THERMAL_FLOOR

    # Estimar nivel de interferencia en el pico
    # Aproximación: nivel_intf ≈ rssi - sinr (dB)
    intf_level = max(THERMAL + 5, min(rssi_dbm - max(sinr_db, -20), -67.0))

    # Caso limpio
    if sinr_db >= 0 and pusch_bler < 0.05:
        return _flat_histogram(n, THERMAL + 2)

    # Jammer: subida fuerte en horas de negocio (7-18h), resto en piso
    if pucch_bler > 0.15 and pusch_bler > 0.15:
        hist = []
        for _ in range(n):
            row = []
            for h in range(24):
                if 7 <= h <= 18:
                    row.append(round(intf_level, 1))
                else:
                    row.append(round(THERMAL + 3, 1))
            hist.append(row)
        return hist

    # FM Harmonic (B5): concentración en PRBs bajos
    if band_num in (5, 17) and sinr_db < -2:
        affected = max(3, int(n * 0.60))  # ~60% de PRBs bajos
        hist = []
        for p in range(n):
            level = intf_level if p < affected else THERMAL + 2
            hist.append([round(level, 1)] * 24)
        return hist

    # TV Digital / Cable TV B28: bloque bajo + algo en bordes
    if band_num == 28 and sinr_db < -2:
        edge = max(5, int(n * 0.20))
        hist = []
        for p in range(n):
            level = intf_level if p < edge else THERMAL + 3
            hist.append([round(level, 1)] * 24)
        return hist

    # WISP B41: bottom PRBs
    if band_num == 41 and sinr_db < -3:
        bottom = max(8, int(n * 0.15))
        hist = []
        for p in range(n):
            level = (intf_level + 2) if p < bottom else THERMAL + 3
            hist.append([round(level, 1)] * 24)
        return hist

    # PIM: correlación con tráfico (usamos patrón de subida en horas pico)
    if pusch_bler > 0.10 and sinr_db > -4:
        mid_start = int(n * 0.30)
        mid_end = int(n * 0.60)
        hist = []
        for p in range(n):
            row = []
            for h in range(24):
                in_mid = mid_start <= p < mid_end
                in_peak = 9 <= h <= 19
                level = intf_level if (in_mid and in_peak) else THERMAL + 4
                row.append(round(level, 1))
            hist.append(row)
        return hist

    # Default: wideband plano (Cable TV / BDA genérico)
    return _flat_histogram(n, intf_level)


def load_kpi_file(kpi_path: Path) -> dict[str, dict]:
    """
    Lee CSV de KPIs por celda.
    Columnas esperadas (separador ;):
      cell_id;rssi_avg_dbm;ul_sinr_p50_db;pusch_bler_avg;pucch_bler_avg

    Devuelve: { cell_id: {rssi, sinr, pusch, pucch} }
    """
    result: dict[str, dict] = {}
    if not kpi_path.exists():
        print(f"AVISO: --kpi-file no encontrado: {kpi_path}")
        return result

    with open(kpi_path, encoding="utf-8-sig", errors="replace") as f:
        header_line = next(f, "").strip().lower()
        # Detectar separador
        sep = ";" if ";" in header_line else ","
        headers = [h.strip() for h in header_line.split(sep)]

        def col(name: str) -> int:
            for i, h in enumerate(headers):
                if name in h:
                    return i
            return -1

        idx_id    = col("cell")
        idx_rssi  = col("rssi")
        idx_sinr  = col("sinr")
        idx_pusch = col("pusch")
        idx_pucch = col("pucch")

        if idx_id < 0:
            print("AVISO: --kpi-file no tiene columna 'cell_id'. Cabecera:", header_line)
            return result

        for line in f:
            parts = line.strip().split(sep)
            if len(parts) <= idx_id:
                continue
            cell_id = parts[idx_id].strip()
            if not cell_id:
                continue

            def _float(idx: int, default: float) -> float:
                try:
                    return float(parts[idx].replace(",", ".")) if idx >= 0 and idx < len(parts) else default
                except ValueError:
                    return default

            result[cell_id] = {
                "rssi":  _float(idx_rssi,  -95.0),
                "sinr":  _float(idx_sinr,  -2.0),
                "pusch": _float(idx_pusch,  0.10),
                "pucch": _float(idx_pucch,  0.05),
            }

    print(f"    KPI file: {len(result):,} celdas con datos de interferencia")
    return result


def load_prb_file(prb_path: Path) -> dict[str, list[list[float]]]:
    """
    Lee CSV de PRB histograma real (SeeWave / OMI export).

    Formato 1 — PRB-mayor (una fila por PRB × celda):
      cell_id;prb_index;h00;h01;h02;...;h23

    Formato 2 — hora-mayor (una fila por hora × celda):
      cell_id;hour;prb_00;prb_01;...;prb_N

    Detecta el formato por la segunda columna del header.
    Devuelve: { cell_id: [[h0..h23], [h0..h23], ...] }  (N_PRB × 24)
    """
    result: dict[str, list[list[float]]] = {}
    if not prb_path.exists():
        print(f"AVISO: --prb-file no encontrado: {prb_path}")
        return result

    with open(prb_path, encoding="utf-8-sig", errors="replace") as f:
        header_line = next(f, "").strip().lower()
        sep = ";" if ";" in header_line else ","
        headers = [h.strip() for h in header_line.split(sep)]

        # Detectar formato
        fmt_prb_major = len(headers) >= 3 and "prb" in headers[1]  # Formato 1
        fmt_hour_major = len(headers) >= 3 and "hour" in headers[1]  # Formato 2

        if not fmt_prb_major and not fmt_hour_major:
            print(f"AVISO: --prb-file formato no reconocido. Cabecera: {header_line[:80]}")
            return result

        raw: dict[str, dict] = {}  # cell_id → {prb_idx/hour → [values]}

        for line in f:
            parts = line.strip().split(sep)
            if len(parts) < 3:
                continue
            cell_id = parts[0].strip()
            if not cell_id:
                continue
            try:
                idx = int(parts[1].strip())
            except ValueError:
                continue
            values = []
            for v in parts[2:]:
                try:
                    values.append(float(v.replace(",", ".")))
                except ValueError:
                    values.append(THERMAL_FLOOR)
            if cell_id not in raw:
                raw[cell_id] = {}
            raw[cell_id][idx] = values

        # Construir matriz N_PRB × 24
        for cell_id, rows in raw.items():
            if fmt_prb_major:
                # rows: { prb_index: [h0..h23] }
                max_prb = max(rows.keys()) + 1
                hist = []
                for p in range(max_prb):
                    row = rows.get(p, [THERMAL_FLOOR] * 24)
                    hist.append([round(v, 1) for v in row[:24]])
                result[cell_id] = hist
            else:
                # rows: { hour: [prb_0..prb_N] }
                n_prb = max(len(v) for v in rows.values()) if rows else 50
                hist = [[THERMAL_FLOOR] * 24 for _ in range(n_prb)]
                for h, prb_row in rows.items():
                    for p, val in enumerate(prb_row[:n_prb]):
                        hist[p][h % 24] = round(val, 1)
                result[cell_id] = hist

    print(f"    PRB file: {len(result):,} celdas con histograma real")
    return result


# ---------------------------------------------------------------------------
# Main converter
# ---------------------------------------------------------------------------

def _open_input(path: Path):
    """Abre el archivo de entrada con el encoding/delimitador correcto según extensión."""
    if path.suffix.lower() == ".csv":
        return open(path, encoding="utf-8-sig", errors="replace"), ";"
    else:  # .txt  → UTF-16 LE, tabulador
        return open(path, encoding="utf-16"), "\t"


def list_values(col_idx: int, input_path: Path) -> None:
    values: dict[str, int] = defaultdict(int)
    f, sep = _open_input(input_path)
    with f:
        next(f)  # skip header
        for line in f:
            parts = line.strip().split(sep)
            if len(parts) > col_idx:
                values[parts[col_idx]] += 1
    for val, count in sorted(values.items(), key=lambda x: -x[1]):
        print(f"  {val or '(vacío)':40s} {count:>8,}")


def convert(
    provinces: list[str],
    zones: list[str],
    vendors: list[str],
    carriers: list[str],
    max_sites: int | None,
    output: Path,
    input_path: Path,
    kpi_data: dict[str, dict] | None = None,
    prb_data: dict[str, list[list[float]]] | None = None,
) -> None:
    provinces_upper = [p.upper() for p in provinces]
    zones_upper = [z.upper() for z in zones]
    vendors_upper = [v.upper() for v in vendors]
    carriers_upper = [c.upper() for c in carriers]

    sites_data: dict[str, dict] = {}       # site_name → {lat, lon, region, city}
    cells_data: list[dict] = []

    total_read = 0
    total_skipped = 0

    is_csv = input_path.suffix.lower() == ".csv"
    f, sep = _open_input(input_path)
    # CSV col 15 = carrier; TXT has no carrier column (col 15 = carrier in CSV only)
    # Column mapping is the same for both formats (same ENM export schema)
    with f:
        next(f)  # skip header
        for line in f:
            parts = line.strip().split(sep)
            if len(parts) < 16:
                continue

            site_name     = parts[0].strip()
            cell_name     = parts[1].strip()
            enodeb_id     = parts[3].strip()
            lon_raw       = parts[5].strip()
            lat_raw       = parts[6].strip()
            azimuth_raw   = parts[7].strip()
            vendor        = parts[8].strip()
            city          = parts[9].strip()
            province      = parts[11].strip()
            technology    = parts[12].strip()
            band_name     = parts[13].strip()
            zone          = parts[14].strip()
            # carrier only present in CSV (col 15); TXT: col 15 = carrier too (same schema)
            carrier       = parts[15].strip() if len(parts) > 15 else ""
            bw_raw        = parts[17].strip() if len(parts) > 17 else ""
            tilt_e        = parts[21].strip() if len(parts) > 21 else ""
            tilt_m        = parts[22].strip() if len(parts) > 22 else ""

            # Filters
            if provinces_upper and province.upper() not in provinces_upper:
                total_skipped += 1
                continue
            if zones_upper and zone.upper() not in zones_upper:
                total_skipped += 1
                continue
            if vendors_upper and vendor.upper() not in vendors_upper:
                total_skipped += 1
                continue
            if carriers_upper and carrier.upper() not in carriers_upper:
                total_skipped += 1
                continue
            if technology.upper() != "LTE":
                total_skipped += 1
                continue

            lat = parse_coord(lat_raw)
            lon = parse_coord(lon_raw)
            if lat is None or lon is None:
                total_skipped += 1
                continue

            # Site dedup
            if site_name not in sites_data:
                if max_sites and len(sites_data) >= max_sites:
                    total_skipped += 1
                    continue
                sites_data[site_name] = {
                    "id": site_name,
                    "name": enodeb_id or site_name,
                    "lat": lat,
                    "lon": lon,
                    "region": province,
                    "city": city,
                }
            elif site_name in sites_data and max_sites and len(sites_data) >= max_sites:
                # Accept cells for already-added sites, skip new sites beyond limit
                pass

            # Only add cell if its site is in the set
            if site_name not in sites_data:
                continue

            azimuth = int(azimuth_raw) if azimuth_raw.isdigit() else 0
            h_bw = parse_beamwidth(bw_raw)
            band_num = BAND_MAP.get(band_name, 0)
            bw_mhz = BW_MAP.get(band_num, 10.0)

            tilt = 0
            if tilt_e and tilt_e.lstrip("-").isdigit():
                tilt = int(tilt_e)
            elif tilt_m and tilt_m.lstrip("-").isdigit():
                tilt = int(tilt_m)

            cell_entry: dict = {
                "id": cell_name,
                "siteId": site_name,
                "tech": "LTE",
                "band": band_name,
                "bandNum": band_num,
                "bwMhz": bw_mhz,
                "vendor": vendor or "UNKNOWN",
                "azimuth": azimuth,
                "hBeamwidth": h_bw,
                "tilt": tilt,
            }
            if carrier:
                cell_entry["carrier"] = carrier

            # PRB histogram: real data > synthetic from KPIs > none
            if prb_data and cell_name in prb_data:
                cell_entry["prbHistogram"] = prb_data[cell_name]
            elif kpi_data and cell_name in kpi_data:
                kpi = kpi_data[cell_name]
                cell_entry["prbHistogram"] = synthesize_prb_histogram(
                    band_num=band_num,
                    bw_mhz=bw_mhz,
                    rssi_dbm=kpi["rssi"],
                    sinr_db=kpi["sinr"],
                    pusch_bler=kpi["pusch"],
                    pucch_bler=kpi["pucch"],
                )
                cell_entry["kpi"] = {
                    "rssi_avg_dbm": kpi["rssi"],
                    "ul_sinr_p50_db": kpi["sinr"],
                    "pusch_bler_avg": kpi["pusch"],
                    "pucch_bler_avg": kpi["pucch"],
                }

            cells_data.append(cell_entry)
            total_read += 1

    sites_list = list(sites_data.values())

    topology = {
        "version": "1.0",
        "source": f"Ericsson ENM — {input_path.name}",
        "sites": sites_list,
        "cells": cells_data,
        "links": [],
        "interferenceSamples": [],
    }

    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w", encoding="utf-8") as f:
        json.dump(topology, f, ensure_ascii=False, separators=(",", ":"))

    size_mb = output.stat().st_size / 1_048_576
    prb_count = sum(1 for c in cells_data if "prbHistogram" in c)
    print(f"OK  Guardado: {output}")
    print(f"    Sitios:   {len(sites_list):,}")
    print(f"    Celdas:   {len(cells_data):,}")
    print(f"    Con PRB:  {prb_count:,}  (clasificador de interferencia habilitado)")
    print(f"    Omitidas: {total_skipped:,}")
    print(f"    Tamano:   {size_mb:.1f} MB")

    if size_mb > 50:
        print("\nATENCION: El archivo supera 50 MB. GitHub no lo aceptara.")
        print("   Usa --max-sites 3000 o filtra por provincia/zona.")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Converter Ericsson ENM → topology-explorer JSON (soporta TXT y CSV)"
    )
    parser.add_argument("--input", type=Path, default=None,
                        metavar="PATH", help="Archivo de entrada (.txt UTF-16 o .csv UTF-8). Por defecto usa el CSV si existe, si no el TXT.")
    parser.add_argument("--province", action="append", default=[],
                        metavar="NOMBRE", help="Filtrar por provincia (repet. para varias)")
    parser.add_argument("--zone", action="append", default=[],
                        metavar="ZONA", help="Filtrar por zona (RSUR, RCEN, RNOR, REST…)")
    parser.add_argument("--vendor", action="append", default=[],
                        metavar="VENDOR", help="Filtrar por vendor (ERICSSON, HUAWEI, ZTE)")
    parser.add_argument("--carrier", action="append", default=[],
                        metavar="CARRIER", help="Filtrar por carrier/operador (ORANGE, MOVISTAR…)")
    parser.add_argument("--max-sites", type=int, default=None,
                        metavar="N", help="Máximo número de sitios a incluir")
    parser.add_argument("--kpi-file", type=Path, default=None,
                        metavar="PATH",
                        help="CSV con KPIs por celda (cell_id;rssi_avg_dbm;ul_sinr_p50_db;pusch_bler_avg;pucch_bler_avg). "
                             "Genera histograma PRB sintético para el clasificador de interferencia.")
    parser.add_argument("--prb-file", type=Path, default=None,
                        metavar="PATH",
                        help="CSV con datos reales de PRB histogram (SeeWave / OMI export). "
                             "Formato fila-PRB: cell_id;prb_index;h00;h01;...;h23  "
                             "O formato fila-hora: cell_id;hour;prb_00;prb_01;...;prb_N")
    parser.add_argument("--output", type=Path, default=OUTPUT_FILE,
                        metavar="PATH", help="Archivo de salida (default: topology-explorer/public/topology.json)")
    parser.add_argument("--list-provinces", action="store_true",
                        help="Listar provincias disponibles y cantidad de celdas")
    parser.add_argument("--list-zones", action="store_true",
                        help="Listar zonas disponibles")
    parser.add_argument("--list-vendors", action="store_true",
                        help="Listar vendors disponibles")
    parser.add_argument("--list-carriers", action="store_true",
                        help="Listar carriers/operadores disponibles")

    args = parser.parse_args()

    input_path: Path = args.input if args.input else _default_input()

    if not input_path.exists():
        print(f"ERROR: No se encontro el archivo de entrada: {input_path}")
        sys.exit(1)

    fmt = "CSV (UTF-8, ;)" if input_path.suffix.lower() == ".csv" else "TXT (UTF-16, TAB)"
    print(f"Archivo: {input_path.name}  [{fmt}]")

    if args.list_provinces:
        print("Provincias en el archivo (col 11):")
        list_values(11, input_path)
        return

    if args.list_zones:
        print("Zonas en el archivo (col 14):")
        list_values(14, input_path)
        return

    if args.list_vendors:
        print("Vendors en el archivo (col 8):")
        list_values(8, input_path)
        return

    if args.list_carriers:
        print("Carriers en el archivo (col 15):")
        list_values(15, input_path)
        return

    kpi_data = load_kpi_file(args.kpi_file) if args.kpi_file else None
    prb_data = load_prb_file(args.prb_file) if args.prb_file else None

    convert(
        provinces=args.province,
        zones=args.zone,
        vendors=args.vendor,
        carriers=args.carrier,
        max_sites=args.max_sites,
        output=args.output,
        input_path=input_path,
        kpi_data=kpi_data,
        prb_data=prb_data,
    )


if __name__ == "__main__":
    main()
