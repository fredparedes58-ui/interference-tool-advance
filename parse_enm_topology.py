"""
parse_enm_topology.py
=====================
Convierte el archivo de topología física Ericsson ENM (UTF-16 TSV) al formato
JSON que consume topology-explorer.

Uso:
    python parse_enm_topology.py                          # todo el país (lento)
    python parse_enm_topology.py --province Madrid        # solo Madrid
    python parse_enm_topology.py --province Sevilla --province Madrid
    python parse_enm_topology.py --zone RCEN              # zona RCEN
    python parse_enm_topology.py --vendor ERICSSON        # solo Ericsson
    python parse_enm_topology.py --max-sites 2000         # máximo 2000 sitios
    python parse_enm_topology.py --list-provinces         # listar provincias disponibles
    python parse_enm_topology.py --list-zones             # listar zonas disponibles

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

INPUT_FILE = Path(r"C:\Users\pparedes\OneDrive - Kenmei Technologies\Escritorio\Interference tool\Topologia fisca\inputs_physical_data_4G_.txt")
OUTPUT_FILE = Path(r"C:\Users\pparedes\OneDrive - Kenmei Technologies\Escritorio\Interference tool\topology-explorer\public\topology.json")

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
# Main converter
# ---------------------------------------------------------------------------

def list_values(col_idx: int) -> None:
    values: dict[str, int] = defaultdict(int)
    with open(INPUT_FILE, encoding="utf-16") as f:
        next(f)  # skip header
        for line in f:
            parts = line.strip().split("\t")
            if len(parts) > col_idx:
                values[parts[col_idx]] += 1
    for val, count in sorted(values.items(), key=lambda x: -x[1]):
        print(f"  {val or '(vacío)':40s} {count:>8,}")


def convert(
    provinces: list[str],
    zones: list[str],
    vendors: list[str],
    max_sites: int | None,
    output: Path,
) -> None:
    provinces_upper = [p.upper() for p in provinces]
    zones_upper = [z.upper() for z in zones]
    vendors_upper = [v.upper() for v in vendors]

    sites_data: dict[str, dict] = {}       # site_name → {lat, lon, region, city}
    cells_data: list[dict] = []

    total_read = 0
    total_skipped = 0

    with open(INPUT_FILE, encoding="utf-16") as f:
        next(f)  # skip header
        for line in f:
            parts = line.strip().split("\t")
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

            cells_data.append({
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
            })
            total_read += 1

    sites_list = list(sites_data.values())

    topology = {
        "version": "1.0",
        "source": "Ericsson ENM — inputs_physical_data_4G",
        "sites": sites_list,
        "cells": cells_data,
        "links": [],
        "interferenceSamples": [],
    }

    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w", encoding="utf-8") as f:
        json.dump(topology, f, ensure_ascii=False, separators=(",", ":"))

    size_mb = output.stat().st_size / 1_048_576
    print(f"OK  Guardado: {output}")
    print(f"    Sitios:   {len(sites_list):,}")
    print(f"    Celdas:   {len(cells_data):,}")
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
        description="Converter Ericsson ENM → topology-explorer JSON"
    )
    parser.add_argument("--province", action="append", default=[],
                        metavar="NOMBRE", help="Filtrar por provincia (repet. para varias)")
    parser.add_argument("--zone", action="append", default=[],
                        metavar="ZONA", help="Filtrar por zona (RSUR, RCEN, RNOR, REST…)")
    parser.add_argument("--vendor", action="append", default=[],
                        metavar="VENDOR", help="Filtrar por vendor (ERICSSON, HUAWEI, ZTE)")
    parser.add_argument("--max-sites", type=int, default=None,
                        metavar="N", help="Máximo número de sitios a incluir")
    parser.add_argument("--output", type=Path, default=OUTPUT_FILE,
                        metavar="PATH", help="Archivo de salida (default: topology-explorer/public/topology.json)")
    parser.add_argument("--list-provinces", action="store_true",
                        help="Listar provincias disponibles y cantidad de celdas")
    parser.add_argument("--list-zones", action="store_true",
                        help="Listar zonas disponibles")
    parser.add_argument("--list-vendors", action="store_true",
                        help="Listar vendors disponibles")

    args = parser.parse_args()

    if args.list_provinces:
        print("Provincias en el archivo (col 11):")
        list_values(11)
        return

    if args.list_zones:
        print("Zonas en el archivo (col 14):")
        list_values(14)
        return

    if args.list_vendors:
        print("Vendors en el archivo (col 8):")
        list_values(8)
        return

    convert(
        provinces=args.province,
        zones=args.zone,
        vendors=args.vendor,
        max_sites=args.max_sites,
        output=args.output,
    )


if __name__ == "__main__":
    main()
