"""
Tests for interference_advisor.classifier

Each test constructs a synthetic PRB histogram that matches a specific
interference source signature, then verifies the classifier returns the
expected primary source type with meaningful confidence.

Histogram shape: [N_PRB][24]  — 100 PRBs × 24 hours, values in dBm.
Thermal floor baseline: −108 dBm.
"""

from __future__ import annotations

import pytest

from interference_advisor.classifier import classify_cell, extract_prb_features

N_PRB = 100
HOURS = list(range(24))
THERMAL = -108.0


# ---------------------------------------------------------------------------
# Synthetic histogram helpers
# ---------------------------------------------------------------------------

def _flat_histogram(level_dbm: float) -> list:
    """All PRBs at the same level for all 24 hours."""
    return [[level_dbm] * 24 for _ in range(N_PRB)]


def _business_hours_histogram(
    on_level: float, off_level: float, width_pct: float = 0.15
) -> list:
    """Narrowband (width_pct of PRBs centred in band) — on_level 7–18 h, off_level elsewhere."""
    n_affected = max(1, int(N_PRB * width_pct))
    center = N_PRB // 2
    affected = set(range(center - n_affected // 2, center + n_affected // 2 + 1))
    hist = []
    for prb in range(N_PRB):
        row = [on_level if (prb in affected and 7 <= h < 19) else off_level for h in HOURS]
        hist.append(row)
    return hist


def _traffic_correlated_histogram(
    traffic: list,
    base_level: float,
    amplitude: float,
    peak_prb_start: int,
    peak_prb_end: int,
) -> list:
    """PRBs in [peak_prb_start, peak_prb_end) vary linearly with traffic."""
    hist = []
    for prb in range(N_PRB):
        if peak_prb_start <= prb < peak_prb_end:
            row = [base_level + amplitude * traffic[h] for h in HOURS]
        else:
            row = [base_level] * 24
        hist.append(row)
    return hist


def _low_prb_elevated_static(
    low_level: float, rest_level: float, low_fraction: float = 0.20
) -> list:
    """Bottom low_fraction of PRBs elevated; rest at rest_level. Static (no time variation)."""
    n_low = max(1, int(N_PRB * low_fraction))
    return [
        [low_level if prb < n_low else rest_level] * 24
        for prb in range(N_PRB)
    ]


def _low_prb_elevated_dynamic(
    traffic: list,
    low_peak: float, low_off: float,
    rest_level: float,
    low_fraction: float = 0.18,
) -> list:
    """Bottom low_fraction varies with traffic (daytime ISP node pattern); rest static."""
    n_low = max(1, int(N_PRB * low_fraction))
    hist = []
    for prb in range(N_PRB):
        if prb < n_low:
            row = [low_off + (low_peak - low_off) * traffic[h] for h in HOURS]
        else:
            row = [rest_level] * 24
        hist.append(row)
    return hist


def _sloped_histogram(base_level: float, slope_db_per_prb: float) -> list:
    """Interference increases linearly across PRBs (ascending slope), constant in time."""
    return [
        [base_level + prb * slope_db_per_prb] * 24
        for prb in range(N_PRB)
    ]


def _narrow_peak_histogram(
    peak_level: float, floor_level: float, peak_prb: int, width: int = 1
) -> list:
    """Single narrow peak (width PRBs on each side of peak_prb), floor elsewhere."""
    return [
        [peak_level if abs(prb - peak_prb) <= width else floor_level] * 24
        for prb in range(N_PRB)
    ]


# ---------------------------------------------------------------------------
# Traffic profiles
# ---------------------------------------------------------------------------

def _flat_traffic() -> list:
    return [0.5] * 24


def _business_traffic() -> list:
    return [
        0.1, 0.1, 0.1, 0.1, 0.1, 0.2,
        0.4, 0.7, 0.9, 1.0, 1.0, 1.0,
        1.0, 0.9, 0.9, 0.8, 0.7, 0.5,
        0.3, 0.2, 0.2, 0.1, 0.1, 0.1,
    ]


def _night_heavy_traffic() -> list:
    """Low during day, higher at night (simulates atmospheric ducting hours)."""
    return [
        0.8, 0.9, 1.0, 1.0, 0.9, 0.7,
        0.4, 0.2, 0.2, 0.2, 0.2, 0.2,
        0.2, 0.2, 0.2, 0.2, 0.3, 0.4,
        0.5, 0.6, 0.7, 0.7, 0.8, 0.8,
    ]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_cable_tv_signature():
    """
    Cable TV leakage: flat wideband floor at −95 dBm, 24/7, Band 28.
    Expected: CABLE_TV_LEAKAGE, confidence > 0.65.
    """
    result = classify_cell(
        cell_id="MKS001A",
        prb_histogram=_flat_histogram(-95.0),
        traffic_per_hour=_flat_traffic(),
        cell_band=28,
        cell_bw_mhz=10.0,
    )
    assert result.primary_source == "CABLE_TV_LEAKAGE", (
        f"Expected CABLE_TV_LEAKAGE, got {result.primary_source}. "
        f"Matches: {[(m.source_type, m.confidence) for m in result.matches]}"
    )
    assert result.matches[0].confidence > 0.65


def test_jammer_signature():
    """
    Jammer: narrowband (15% of PRBs centred), on at −74 dBm during 7–18 h,
    off otherwise. Traffic is flat (jammer is independent of cell load).
    Expected: JAMMER, confidence > 0.65.
    """
    result = classify_cell(
        cell_id="C1139",
        prb_histogram=_business_hours_histogram(on_level=-74.0, off_level=THERMAL, width_pct=0.15),
        traffic_per_hour=_flat_traffic(),   # flat — jammer ignores network traffic
        cell_band=2,
        cell_bw_mhz=10.0,
    )
    assert result.primary_source == "JAMMER", (
        f"Expected JAMMER, got {result.primary_source}. "
        f"Matches: {[(m.source_type, m.confidence) for m in result.matches]}"
    )
    assert result.matches[0].confidence > 0.65


def test_pim_signature():
    """
    PIM: PRBs 30–50 vary strongly with DL traffic (amplitude 12 dB).
    Expected: PIM, confidence > 0.65.
    """
    traffic = _business_traffic()
    result = classify_cell(
        cell_id="LKS206B",
        prb_histogram=_traffic_correlated_histogram(
            traffic=traffic,
            base_level=THERMAL,
            amplitude=12.0,
            peak_prb_start=30,
            peak_prb_end=50,
        ),
        traffic_per_hour=traffic,
        cell_band=4,
        cell_bw_mhz=20.0,
    )
    assert result.primary_source == "PIM", (
        f"Expected PIM, got {result.primary_source}. "
        f"Matches: {[(m.source_type, m.confidence) for m in result.matches]}"
    )
    assert result.matches[0].confidence > 0.65


def test_bda_oscillation_signature():
    """
    BDA oscillation: severe wideband at −72 dBm, 24/7, Band 5.
    Expected: BDA_OSCILLATION, confidence > 0.80, severity = CRITICAL.
    """
    result = classify_cell(
        cell_id="WCS208A",
        prb_histogram=_flat_histogram(-72.0),
        traffic_per_hour=_flat_traffic(),
        cell_band=5,
        cell_bw_mhz=10.0,
    )
    assert result.primary_source == "BDA_OSCILLATION", (
        f"Expected BDA_OSCILLATION, got {result.primary_source}. "
        f"Matches: {[(m.source_type, m.confidence) for m in result.matches]}"
    )
    assert result.matches[0].confidence > 0.80
    assert result.matches[0].severity == "CRITICAL"


def test_wisp_signature():
    """
    Wireless ISP node (2.5 GHz): bottom 18% of PRBs vary with ISP daytime usage
    (peak −84 dBm at busy hours, −106 dBm overnight); rest at −106 dBm. Band 41.
    The CELL's own traffic is flat — the ISP load is an independent external source.
    Expected: WIRELESS_ISP_2500, confidence > 0.55.
    """
    isp_usage = _business_traffic()   # ISP usage peaks during business hours
    result = classify_cell(
        cell_id="OBO042A",
        prb_histogram=_low_prb_elevated_dynamic(
            traffic=isp_usage,
            low_peak=-84.0,
            low_off=-106.0,
            rest_level=-106.0,
            low_fraction=0.18,
        ),
        traffic_per_hour=_flat_traffic(),  # cell's own traffic is independent
        cell_band=41,
        cell_bw_mhz=20.0,
    )
    assert result.primary_source == "WIRELESS_ISP_2500", (
        f"Expected WIRELESS_ISP_2500, got {result.primary_source}. "
        f"Matches: {[(m.source_type, m.confidence) for m in result.matches]}"
    )
    assert result.matches[0].confidence > 0.55


def test_military_police_signature():
    """
    Military/police: interference increases from −108 to −88 dBm across PRBs
    (slope = 0.20 dB/PRB). Band 5.
    Expected: MILITARY_POLICE, confidence > 0.60.
    """
    result = classify_cell(
        cell_id="WCN182X",
        prb_histogram=_sloped_histogram(base_level=-108.0, slope_db_per_prb=0.20),
        traffic_per_hour=_flat_traffic(),
        cell_band=5,
        cell_bw_mhz=10.0,
    )
    assert result.primary_source == "MILITARY_POLICE", (
        f"Expected MILITARY_POLICE, got {result.primary_source}. "
        f"Matches: {[(m.source_type, m.confidence) for m in result.matches]}"
    )
    assert result.matches[0].confidence > 0.60


def test_fm_harmonic_signature():
    """
    FM harmonic: single 3-PRB-wide peak at PRB 45, floor at thermal. Band 5.
    Expected: FM_RADIO_HARMONIC, confidence > 0.60.
    """
    result = classify_cell(
        cell_id="WKS428A",
        prb_histogram=_narrow_peak_histogram(
            peak_level=-93.0, floor_level=THERMAL, peak_prb=45, width=1
        ),
        traffic_per_hour=_flat_traffic(),
        cell_band=5,
        cell_bw_mhz=10.0,
    )
    assert result.primary_source == "FM_RADIO_HARMONIC", (
        f"Expected FM_RADIO_HARMONIC, got {result.primary_source}. "
        f"Matches: {[(m.source_type, m.confidence) for m in result.matches]}"
    )
    assert result.matches[0].confidence > 0.60


def test_tv_digital_700_signature():
    """
    DVB-T2 700 MHz: first 20 PRBs elevated to −91 dBm, rest at thermal, 24/7. Band 28.
    Expected: TV_DIGITAL_BROADCAST_700, confidence > 0.60.
    """
    result = classify_cell(
        cell_id="MKS024B",
        prb_histogram=_low_prb_elevated_static(
            low_level=-91.0, rest_level=THERMAL, low_fraction=0.20
        ),
        traffic_per_hour=_flat_traffic(),
        cell_band=28,
        cell_bw_mhz=10.0,
    )
    assert result.primary_source == "TV_DIGITAL_BROADCAST_700", (
        f"Expected TV_DIGITAL_BROADCAST_700, got {result.primary_source}. "
        f"Matches: {[(m.source_type, m.confidence) for m in result.matches]}"
    )
    assert result.matches[0].confidence > 0.60


def test_band_consistency_flag():
    """
    WIRELESS_ISP_2500 pattern on Band 28 should have band_consistent=False.
    """
    traffic = _business_traffic()
    result = classify_cell(
        cell_id="MKS999A",
        prb_histogram=_low_prb_elevated_dynamic(
            traffic=traffic, low_peak=-84.0, low_off=-106.0,
            rest_level=-106.0, low_fraction=0.18,
        ),
        traffic_per_hour=traffic,
        cell_band=28,
        cell_bw_mhz=10.0,
    )
    wisp = next((m for m in result.matches if m.source_type == "WIRELESS_ISP_2500"), None)
    if wisp is not None:
        assert wisp.band_consistent is False


def test_feature_extraction_shape():
    """
    Smoke test: extract_prb_features returns valid field values for a 50-PRB histogram.
    """
    hist = [[THERMAL - 5.0] * 24 for _ in range(50)]
    f = extract_prb_features(
        prb_histogram=hist,
        traffic_per_hour=[0.5] * 24,
        cell_band=28,
        cell_bw_mhz=5.0,
    )
    assert f.n_prb == 50
    assert f.cell_band == 28
    assert 0.0 <= f.prb_uniformity <= 1.0
    assert f.temporal_cv >= 0.0
    assert f.floor_elevation_db == pytest.approx(-5.0, abs=0.1)
