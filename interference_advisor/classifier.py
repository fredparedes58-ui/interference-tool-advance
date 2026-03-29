"""
PRB Source Signature Classifier
================================
Vendor-agnostic, country-agnostic engine that classifies the TYPE of external
interference source from LTE/NR PRB interference histogram data alone.

Input  : PRB histogram (N_PRB × 24-hour matrix, dBm)
         + traffic load per hour (normalized 0–1)
         + cell band + bandwidth
Output : ranked list of SourceSignatureMatch with confidence, evidence, and
         recommended first action

Knowledge base
--------------
Derived from 130+ real field investigation reports (Movistar Argentina +
Claro Argentina, 2017–2020) covering 9 interference source types across
850 MHz (B5/B17), 1900 MHz (B2/B25), 700 MHz (B28), and 2500 MHz (B41).

Design notes
------------
All features that compare interference levels use dB *differences* (not ratios)
because dBm values are negative and division produces counter-intuitive results.

Temporal features are computed on the "hot zone" — the top 20% of PRBs by
average level — to preserve sensitivity to narrowband interference (e.g. jammers
or FM harmonics that affect only a few PRBs).

Signature catalogue
-------------------
SIG-01  CABLE_TV_LEAKAGE           – cable TV TAP/amplifier RF leakage
SIG-02  FM_RADIO_HARMONIC          – FM broadcast station high-order harmonic
SIG-03  TV_DIGITAL_BROADCAST_700   – DVB-T2 TV channel overlap (700 MHz UL)
SIG-04  BDA_OSCILLATION            – illegal booster in oscillation mode
SIG-05  BDA_EXCESS_GAIN            – illegal booster excess gain (not oscillating)
SIG-06  WIRELESS_ISP_2500          – neighbourhood WISP node at 2.5 GHz
SIG-07  WIFI_CAMERA_UNLICENSED_850 – non-compliant WiFi cameras / unlicensed 850
SIG-08  JAMMER                     – commercial cellular jammer (business hours)
SIG-09  MILITARY_POLICE            – licensed military/police radio in cellular UL
SIG-10  PIM                        – passive intermodulation products
SIG-11  ATMOSPHERIC_DUCTING        – tropospheric anomalous propagation
SIG-12  UNKNOWN_PERSISTENT         – elevated interference without clear pattern
"""

from __future__ import annotations

import math
from typing import Dict, List, Tuple

import numpy as np

from .models import (
    PRBClassificationResult,
    PRBSignatureFeatures,
    PrbHistogram,
    SourceSignatureMatch,
)

THERMAL_FLOOR_DBM: float = -108.0
MIN_CONFIDENCE: float = 0.30
FALLBACK_CONFIDENCE: float = 0.40

# ---------------------------------------------------------------------------
# Metadata tables
# ---------------------------------------------------------------------------

_BAND_COMPAT: Dict[str, List[int]] = {
    "CABLE_TV_LEAKAGE":           [28, 5, 17, 20, 12, 13, 14],
    "FM_RADIO_HARMONIC":          [5, 17, 20, 12, 13, 14],
    "TV_DIGITAL_BROADCAST_700":   [28],
    "BDA_OSCILLATION":            [],
    "BDA_EXCESS_GAIN":            [],
    "WIRELESS_ISP_2500":          [41, 38, 40, 42, 43],
    "WIFI_CAMERA_UNLICENSED_850": [5, 17, 20, 12, 13, 14],
    "JAMMER":                     [],
    "MILITARY_POLICE":            [5, 17, 20, 12, 13, 14, 2, 25, 66],
    "PIM":                        [],
    "ATMOSPHERIC_DUCTING":        [],
    "UNKNOWN_PERSISTENT":         [],
}

_LABELS: Dict[str, str] = {
    "CABLE_TV_LEAKAGE":           "Cable TV Infrastructure Leakage",
    "FM_RADIO_HARMONIC":          "FM Radio Harmonic Interference",
    "TV_DIGITAL_BROADCAST_700":   "DVB-T2 TV Broadcast Overlap (700 MHz)",
    "BDA_OSCILLATION":            "BDA / Signal Booster — Oscillation Mode",
    "BDA_EXCESS_GAIN":            "BDA / Signal Booster — Excess Gain",
    "WIRELESS_ISP_2500":          "Unlicensed Wireless ISP Node (2.5 GHz)",
    "WIFI_CAMERA_UNLICENSED_850": "Non-compliant WiFi Cameras / Unlicensed 850 MHz",
    "JAMMER":                     "Commercial Cellular Jammer",
    "MILITARY_POLICE":            "Military / Police Radio (Licensed, Adjacent Band)",
    "PIM":                        "Passive Intermodulation (PIM) Products",
    "ATMOSPHERIC_DUCTING":        "Atmospheric Ducting / Troposcatter Episode",
    "UNKNOWN_PERSISTENT":         "Unknown Persistent Interference",
}

_ACTION_HINTS: Dict[str, str] = {
    "CABLE_TV_LEAKAGE":
        "Field sweep near cable TV poles/amplifiers; coordinate with cable operator for TAP inspection",
    "FM_RADIO_HARMONIC":
        "Identify FM station frequency; compute harmonic; confirm with spectrum analyser; notify regulator",
    "TV_DIGITAL_BROADCAST_700":
        "Confirm TV channel overlap; coordinate with national spectrum regulator (ENACOM/IFT/ANATEL/CMT)",
    "BDA_OSCILLATION":
        "Direction-find with handheld SA; physically locate BDA; deactivate / seize device; file regulatory complaint",
    "BDA_EXCESS_GAIN":
        "Field sweep in direction of strongest sector; identify building with BDA; contact owner",
    "WIRELESS_ISP_2500":
        "Confirm PRBs 0–15 elevated; locate WISP antenna on rooftops; contact WISP operator; regulatory escalation",
    "WIFI_CAMERA_UNLICENSED_850":
        "Compare RSSI across sectors; survey nearby buildings with security cameras; measure distance gradient",
    "JAMMER":
        "Identify building/business with 7–18 h weekday occupancy; contact directly or via police/regulator",
    "MILITARY_POLICE":
        "Document ascending spectral slope; escalate to national regulator — no HW action possible",
    "PIM":
        "Inspect connectors/jumpers/antennas; run PIM tester (2×43 dBm); correlate with DL traffic",
    "ATMOSPHERIC_DUCTING":
        "Verify night-time elevation across multiple cells; enable ducting-mitigation network features",
    "UNKNOWN_PERSISTENT":
        "Full field measurement with spectrum analyser + log-periodic directional antenna",
}

_SEVERITY: Dict[str, str] = {
    "CABLE_TV_LEAKAGE":           "MEDIUM",
    "FM_RADIO_HARMONIC":          "LOW",
    "TV_DIGITAL_BROADCAST_700":   "HIGH",
    "BDA_OSCILLATION":            "CRITICAL",
    "BDA_EXCESS_GAIN":            "HIGH",
    "WIRELESS_ISP_2500":          "MEDIUM",
    "WIFI_CAMERA_UNLICENSED_850": "MEDIUM",
    "JAMMER":                     "HIGH",
    "MILITARY_POLICE":            "HIGH",
    "PIM":                        "HIGH",
    "ATMOSPHERIC_DUCTING":        "LOW",
    "UNKNOWN_PERSISTENT":         "MEDIUM",
}

_REQUIRES_FIELD: set = {
    "CABLE_TV_LEAKAGE", "FM_RADIO_HARMONIC", "TV_DIGITAL_BROADCAST_700",
    "BDA_OSCILLATION", "BDA_EXCESS_GAIN", "WIRELESS_ISP_2500",
    "WIFI_CAMERA_UNLICENSED_850", "JAMMER", "UNKNOWN_PERSISTENT",
}

# ---------------------------------------------------------------------------
# Ericsson mitigation catalog (FAJ 121 XXXX)
# Each entry: {id, title, feature_id?, type, description, urgency, requires_field}
# type: CM | FIELD | REGULATORY
# ---------------------------------------------------------------------------

MITIGATIONS: Dict[str, List[Dict]] = {
    "CABLE_TV_LEAKAGE": [
        {
            "id": "cable_field_hunt",
            "title": "Field Interference Hunt — Cable TV TAPs",
            "type": "FIELD",
            "description": "Spectrum sweep near cable TV poles, amplifiers, and junction boxes.",
            "urgency": "HIGH",
            "requires_field": True,
        },
        {
            "id": "ul_itfm",
            "title": "Enable UL-ITFM (FAJ 121 0484)",
            "feature_id": "FAJ 121 0484",
            "type": "CM",
            "description": "Uplink-Triggered Inter-Frequency Mobility moves UEs with degraded UL to a cleaner frequency.",
            "urgency": "MEDIUM",
            "requires_field": False,
        },
        {
            "id": "irc_aas",
            "title": "Enable IRC for AAS FDD (FAJ 121 4919)",
            "feature_id": "FAJ 121 4919",
            "type": "CM",
            "description": "IRC for AAS FDD rejects spatially correlated wideband interference; UL SINR +2–6 dB.",
            "urgency": "MEDIUM",
            "requires_field": False,
        },
        {
            "id": "ul_spectrum_analyzer",
            "title": "Activate UL Spectrum Analyzer (FAJ 121 4271)",
            "feature_id": "FAJ 121 4271",
            "type": "CM",
            "description": "PRB-level interference measurement to confirm flat cable TV signature across all PRBs.",
            "urgency": "HIGH",
            "requires_field": False,
        },
        {
            "id": "ul_interference_reporting",
            "title": "Enable UL Interference Reporting (FAJ 121 4157)",
            "feature_id": "FAJ 121 4157",
            "type": "CM",
            "description": "Per-PRB interference monitoring for ongoing surveillance after field resolution.",
            "urgency": "LOW",
            "requires_field": False,
        },
    ],

    "BDA_OSCILLATION": [
        {
            "id": "bda_regulatory",
            "title": "Regulatory Complaint — Illegal BDA",
            "type": "REGULATORY",
            "description": "File complaint with ENACOM/IFT/ANATEL. BDA oscillation is critical — requires enforcement.",
            "urgency": "CRITICAL",
            "requires_field": True,
        },
        {
            "id": "bda_field_hunt",
            "title": "Emergency Field Hunt — BDA Device",
            "type": "FIELD",
            "description": "Direction-find with handheld SA; triangulate source building; contact owner to power off.",
            "urgency": "CRITICAL",
            "requires_field": True,
        },
        {
            "id": "ul_itfm_bda",
            "title": "Enable UL-ITFM (FAJ 121 0484) — Temporary Relief",
            "feature_id": "FAJ 121 0484",
            "type": "CM",
            "description": "Move affected UEs to cleaner frequency while field resolution is underway.",
            "urgency": "HIGH",
            "requires_field": False,
        },
    ],

    "BDA_EXCESS_GAIN": [
        {
            "id": "bda_eg_field",
            "title": "Field Hunt — Excess Gain BDA",
            "type": "FIELD",
            "description": "Sweep sector; identify building with BDA; contact owner to adjust gain or remove.",
            "urgency": "HIGH",
            "requires_field": True,
        },
        {
            "id": "ul_itfm_eg",
            "title": "Enable UL-ITFM (FAJ 121 0484)",
            "feature_id": "FAJ 121 0484",
            "type": "CM",
            "description": "Trigger inter-frequency mobility for UEs experiencing worst UL quality.",
            "urgency": "MEDIUM",
            "requires_field": False,
        },
    ],

    "JAMMER": [
        {
            "id": "jammer_police",
            "title": "Police / Regulator Intervention",
            "type": "REGULATORY",
            "description": "Contact police and national regulator. Identify business active 7–18 h in sector direction.",
            "urgency": "HIGH",
            "requires_field": True,
        },
        {
            "id": "jammer_ulsc",
            "title": "UL Scheduling Control for OoC UEs (FAJ 121 3826)",
            "feature_id": "FAJ 121 3826",
            "type": "CM",
            "description": "Restrict UL resources for out-of-coverage UEs wasting capacity under jammer influence.",
            "urgency": "MEDIUM",
            "requires_field": False,
        },
        {
            "id": "jammer_voltmob",
            "title": "UL-Triggered VoLTE Mobility (FAJ 121 3742)",
            "feature_id": "FAJ 121 3742",
            "type": "CM",
            "description": "Move VoLTE/QCI-1 calls away from interfered cell during jammer active hours (7–18 h).",
            "urgency": "HIGH",
            "requires_field": False,
        },
        {
            "id": "jammer_spifho",
            "title": "Service/Priority-Triggered IF Handover (FAJ 121 3087)",
            "feature_id": "FAJ 121 3087",
            "type": "CM",
            "description": "Triggers inter-frequency HO based on QCI/service type; moves VoLTE UEs to cleaner band.",
            "urgency": "MEDIUM",
            "requires_field": False,
        },
        {
            "id": "jammer_ul_traffic_mob",
            "title": "UL-Traffic-Triggered Mobility (FAJ 121 5044)",
            "feature_id": "FAJ 121 5044",
            "type": "CM",
            "description": "Moves UL-heavy UEs to a less-interfered cell when UL throughput falls below threshold.",
            "urgency": "MEDIUM",
            "requires_field": False,
        },
        {
            "id": "jammer_service_mob",
            "title": "Service Triggered Mobility (FAJ 121 1747)",
            "feature_id": "FAJ 121 1747",
            "type": "CM",
            "description": "QoS/QCI-based mobility thresholds; moves UEs when UL SINR/BLER drops below defined levels.",
            "urgency": "MEDIUM",
            "requires_field": False,
        },
        {
            "id": "jammer_limited_ula_iflb",
            "title": "Limited-Uplink-Aware IFLB (FAJ 121 4406)",
            "feature_id": "FAJ 121 4406",
            "type": "CM",
            "description": "Prevents load balancing from routing new UEs to the jammer-affected cell.",
            "urgency": "MEDIUM",
            "requires_field": False,
        },
    ],

    "PIM": [
        {
            "id": "pim_detection",
            "title": "Enable PIM Detection (FAJ 121 5436)",
            "feature_id": "FAJ 121 5436",
            "type": "CM",
            "description": "Automated PIM detection runs 24 h cycles and reports IM frequency, class, and aggressor carrier.",
            "urgency": "HIGH",
            "requires_field": False,
        },
        {
            "id": "pim_avoidance",
            "title": "Enable PIM Avoidance (FAJ 121 5448)",
            "feature_id": "FAJ 121 5448",
            "type": "CM",
            "description": "Mutes specific DL PRBs on aggressor cell to avoid IM products in victim cell UL.",
            "urgency": "HIGH",
            "requires_field": False,
        },
        {
            "id": "pim_diff_ul_power",
            "title": "Differential UL Power Control (FAJ 121 4680)",
            "feature_id": "FAJ 121 4680",
            "type": "CM",
            "description": "Reduces DL TX power from close-in UEs; lowers PIM product level by –2–6 dBm.",
            "urgency": "MEDIUM",
            "requires_field": False,
        },
        {
            "id": "pim_flex_ul",
            "title": "Flexible Uplink Processing (FAJ 121 5155)",
            "feature_id": "FAJ 121 5155",
            "type": "CM",
            "description": "Configures PUCCH structure and PPP scheduling for cells with recurring IM-induced PUCCH degradation.",
            "urgency": "LOW",
            "requires_field": False,
        },
        {
            "id": "pim_coverage_mob",
            "title": "Coverage-Triggered Mobility at Setup (FAJ 121 5144)",
            "feature_id": "FAJ 121 5144",
            "type": "CM",
            "description": "Moves voice calls at setup away from PIM-affected cell when UL coverage is below threshold.",
            "urgency": "MEDIUM",
            "requires_field": False,
        },
        {
            "id": "pim_field",
            "title": "Physical PIM Inspection",
            "type": "FIELD",
            "description": "Inspect RF connectors, jumpers, feeder cables, antennas. Use PIM Master (2×43 dBm).",
            "urgency": "HIGH",
            "requires_field": True,
        },
    ],

    "WIRELESS_ISP_2500": [
        {
            "id": "wisp_field",
            "title": "Field Hunt — Unlicensed WISP Node",
            "type": "FIELD",
            "description": "Confirm PRBs 0–15 elevated. Survey rooftops in sector for WISP antenna.",
            "urgency": "MEDIUM",
            "requires_field": True,
        },
        {
            "id": "wisp_pucch_od",
            "title": "PUCCH Overdimensioning (FAJ 121 2204)",
            "feature_id": "FAJ 121 2204",
            "type": "CM",
            "description": "Moves PUCCH away from low PRBs where WISP interference concentrates.",
            "urgency": "MEDIUM",
            "requires_field": False,
        },
        {
            "id": "wisp_fss",
            "title": "Evolved UL Frequency-Selective Scheduling (FAJ 121 4966)",
            "feature_id": "FAJ 121 4966",
            "type": "CM",
            "description": "Schedules UEs away from bottom PRBs (0–15) affected by WISP 2500–2515 MHz interference.",
            "urgency": "LOW",
            "requires_field": False,
        },
        {
            "id": "wisp_dyn_ul_alloc",
            "title": "Dynamic UL Resource Allocation (FAJ 121 4619)",
            "feature_id": "FAJ 121 4619",
            "type": "CM",
            "description": "Allocates UL resources dynamically; high-priority UEs get clean PRBs above PRB 15.",
            "urgency": "LOW",
            "requires_field": False,
        },
        {
            "id": "wisp_flex_bw",
            "title": "Flexible Channel Bandwidth (FAJ 121 4756)",
            "feature_id": "FAJ 121 4756",
            "type": "CM",
            "description": "Blocks low-end B41 PRBs from scheduling, permanently removing the WISP-interfered region.",
            "urgency": "MEDIUM",
            "requires_field": False,
        },
        {
            "id": "wisp_limited_ula_iflb",
            "title": "Limited-Uplink-Aware IFLB (FAJ 121 4406)",
            "feature_id": "FAJ 121 4406",
            "type": "CM",
            "description": "Prevents load balancing from routing new UEs to this WISP-impacted B41 cell.",
            "urgency": "MEDIUM",
            "requires_field": False,
        },
    ],

    "TV_DIGITAL_BROADCAST_700": [
        {
            "id": "tv700_regulator",
            "title": "Coordinate with Spectrum Regulator",
            "type": "REGULATORY",
            "description": "DVB-T2 TV channels overlap LTE 700 UL. Coordinate national regulator for digital transition.",
            "urgency": "HIGH",
            "requires_field": False,
        },
        {
            "id": "tv700_fss",
            "title": "Evolved UL Frequency-Selective Scheduling (FAJ 121 4966)",
            "feature_id": "FAJ 121 4966",
            "type": "CM",
            "description": "Avoids PRBs overlapping TV channels (Canal 52/54: first 10–20 PRBs in B28).",
            "urgency": "MEDIUM",
            "requires_field": False,
        },
        {
            "id": "tv700_flex_bw",
            "title": "Flexible Channel Bandwidth (FAJ 121 4756)",
            "feature_id": "FAJ 121 4756",
            "type": "CM",
            "description": "Blocks low-end B28 PRBs overlapping TV channels from UE scheduling.",
            "urgency": "MEDIUM",
            "requires_field": False,
        },
        {
            "id": "tv700_pucch",
            "title": "PUCCH Overdimensioning (FAJ 121 2204)",
            "feature_id": "FAJ 121 2204",
            "type": "CM",
            "description": "Shifts PUCCH away from TV-overlapping PRBs at the bottom of B28.",
            "urgency": "MEDIUM",
            "requires_field": False,
        },
    ],

    "FM_RADIO_HARMONIC": [
        {
            "id": "fm_regulator",
            "title": "Notify Regulator — FM Station Harmonic",
            "type": "REGULATORY",
            "description": "Identify FM station; compute harmonic (FM freq × N); notify regulator for emission filter.",
            "urgency": "MEDIUM",
            "requires_field": True,
        },
        {
            "id": "fm_ul_spectrum",
            "title": "Activate UL Spectrum Analyzer (FAJ 121 4271)",
            "feature_id": "FAJ 121 4271",
            "type": "CM",
            "description": "Confirms exact PRB position of FM harmonic spike for regulatory evidence and PRB avoidance.",
            "urgency": "HIGH",
            "requires_field": False,
        },
        {
            "id": "fm_fss",
            "title": "Evolved UL Frequency-Selective Scheduling (FAJ 121 4966)",
            "feature_id": "FAJ 121 4966",
            "type": "CM",
            "description": "Avoids the 1–3 specific PRBs impacted by the FM harmonic spike.",
            "urgency": "LOW",
            "requires_field": False,
        },
    ],

    "MILITARY_POLICE": [
        {
            "id": "military_regulatory",
            "title": "Regulatory Escalation — Licensed Military/Police",
            "type": "REGULATORY",
            "description": "Document spectral ascending slope; escalate to regulator. No HW action possible.",
            "urgency": "MEDIUM",
            "requires_field": True,
        },
        {
            "id": "military_ul_spectrum",
            "title": "Activate UL Spectrum Analyzer (FAJ 121 4271)",
            "feature_id": "FAJ 121 4271",
            "type": "CM",
            "description": "Collects PRB histogram to document ascending slope pattern for regulatory file.",
            "urgency": "HIGH",
            "requires_field": False,
        },
        {
            "id": "military_mob_poor_cov",
            "title": "Mobility Control at Poor Coverage (FAJ 121 3013)",
            "feature_id": "FAJ 121 3013",
            "type": "CM",
            "description": "Triggers coverage-based HO for edge UEs in PRBs most affected by military adjacent-band interference.",
            "urgency": "MEDIUM",
            "requires_field": False,
        },
    ],

    "ATMOSPHERIC_DUCTING": [
        {
            "id": "duct_reduction",
            "title": "Enable Atmospheric Duct Interference Reduction (FAJ 121 1752)",
            "feature_id": "FAJ 121 1752",
            "type": "CM",
            "description": "Detects ducting via cell correlation; applies CRS muting and UL interference compensation.",
            "urgency": "LOW",
            "requires_field": False,
        },
        {
            "id": "duct_tdd_guard",
            "title": "Increase TDD Guard Period (TDD only)",
            "type": "CM",
            "description": "Increases guard period to reduce interference from distant cells via tropospheric ducting.",
            "urgency": "LOW",
            "requires_field": False,
        },
    ],

    "WIFI_CAMERA_UNLICENSED_850": [
        {
            "id": "wifi_field",
            "title": "Field Hunt — Unlicensed Device (850 MHz)",
            "type": "FIELD",
            "description": "Compare RSSI across sectors; survey nearby buildings with security cameras.",
            "urgency": "MEDIUM",
            "requires_field": True,
        },
        {
            "id": "wifi_irc",
            "title": "Enable IRC for AAS FDD (FAJ 121 4919)",
            "feature_id": "FAJ 121 4919",
            "type": "CM",
            "description": "IRC exploits angular separation between cell and directional unlicensed device; UL SINR +2–5 dB.",
            "urgency": "MEDIUM",
            "requires_field": False,
        },
        {
            "id": "wifi_ul_spectrum",
            "title": "Activate UL Spectrum Analyzer (FAJ 121 4271)",
            "feature_id": "FAJ 121 4271",
            "type": "CM",
            "description": "Compares PRB histogram per sector to confirm directional pattern of unlicensed 850 MHz device.",
            "urgency": "HIGH",
            "requires_field": False,
        },
    ],

    "UNKNOWN_PERSISTENT": [
        {
            "id": "unknown_field",
            "title": "Full Field Interference Hunt",
            "type": "FIELD",
            "description": "Full spectrum sweep (570–3800 MHz) with PCTEL SeeGull + log-periodic antenna.",
            "urgency": "MEDIUM",
            "requires_field": True,
        },
        {
            "id": "unknown_ul_spectrum",
            "title": "Activate UL Spectrum Analyzer (FAJ 121 4271)",
            "feature_id": "FAJ 121 4271",
            "type": "CM",
            "description": "PRB-level baseline measurement before field investigation to guide hunt direction.",
            "urgency": "HIGH",
            "requires_field": False,
        },
    ],
}

# ---------------------------------------------------------------------------
# Feature extraction
# ---------------------------------------------------------------------------

def extract_prb_features(
    prb_histogram: PrbHistogram,
    traffic_per_hour: List[float],
    cell_band: int,
    cell_bw_mhz: float,
) -> PRBSignatureFeatures:
    """
    Extract signature features from a PRB interference histogram.

    Parameters
    ----------
    prb_histogram
        2-D list of shape [N_PRB][24].  Each value is the interference
        level in dBm for that PRB during that hour-of-day bucket.
    traffic_per_hour
        24-element list with normalised traffic load (0–1) or raw UE count.
    cell_band
        LTE/NR band number (integer), e.g. 28 for 700 MHz FDD.
    cell_bw_mhz
        Channel bandwidth in MHz (5 / 10 / 15 / 20 / 100).
    """
    h = np.array(prb_histogram, dtype=float)   # [N_PRB, 24]
    if h.ndim != 2 or h.shape[1] != 24:
        raise ValueError(
            f"prb_histogram must be shape [N_PRB][24], got {h.shape}"
        )
    n_prb = h.shape[0]
    prb_avg = h.mean(axis=1)   # [N_PRB] — average level per PRB across hours
    all_mean = float(prb_avg.mean())

    # ---- Severity ----
    peak_dbm = float(h.max())
    floor_elevation_db = float(np.median(prb_avg)) - THERMAL_FLOOR_DBM

    # ---- PRB uniformity (1.0 = perfectly flat / wideband) ----
    prb_range = float(prb_avg.max() - prb_avg.min())
    prb_uniformity = float(
        1.0 - prb_avg.std() / prb_range if prb_range > 0 else 1.0
    )
    prb_uniformity = max(0.0, min(1.0, prb_uniformity))

    # ---- Edge PRB excess (dB): mean(edge 15%) – mean(center 70%) ----
    n_edge = max(1, int(n_prb * 0.15))
    edge_idx = list(range(n_edge)) + list(range(n_prb - n_edge, n_prb))
    center_idx = list(range(n_edge, n_prb - n_edge)) if n_prb > 2 * n_edge else list(range(n_prb))
    edge_prb_excess_db = float(
        prb_avg[edge_idx].mean() - prb_avg[center_idx].mean()
    )

    # ---- Low PRB excess (dB): mean(bottom 25%) – mean(all) ----
    n_low = max(1, int(n_prb * 0.25))
    low_prb_excess_db = float(prb_avg[:n_low].mean() - all_mean)

    # ---- Peak cluster width (% of PRBs within 3 dB of peak) ----
    peak_prb_val = float(prb_avg.max())
    n_peak_cluster = int(np.sum(prb_avg >= peak_prb_val - 3.0))
    peak_cluster_width_pct = (n_peak_cluster / n_prb) * 100.0

    # ---- Spectral slope (dB/PRB): positive = ascending ----
    prb_indices = np.arange(n_prb, dtype=float)
    slope_db_per_prb = float(np.polyfit(prb_indices, prb_avg, 1)[0])

    # ---- Bimodal edge excess (dB): mean(both 15% edges) – mean(center) ----
    both_edge_mean = float(prb_avg[edge_idx].mean())
    bimodal_edge_excess_db = both_edge_mean - float(prb_avg[center_idx].mean())

    # ---- Hot-zone hourly series: top 20% PRBs by average level ----
    # Using the hottest PRBs for temporal analysis gives sensitivity to
    # narrowband sources (jammers, FM harmonics) that barely move hour_avg.
    top_k = max(1, int(n_prb * 0.20))
    top_prb_idx = np.argsort(prb_avg)[-top_k:]
    hot_hour_avg = h[top_prb_idx].mean(axis=0)   # [24]

    # ---- Temporal CV (coefficient of variation, hot zone) ----
    hot_mean = float(hot_hour_avg.mean())
    hot_std = float(hot_hour_avg.std())
    temporal_cv = hot_std / abs(hot_mean) if abs(hot_mean) > 1e-6 else 0.0

    # ---- Business-hour excess (dB): mean(7–18h) – mean(off-hours), hot zone ----
    biz_idx = list(range(7, 19))
    off_idx = list(range(0, 7)) + list(range(19, 24))
    business_hour_excess_db = float(
        hot_hour_avg[biz_idx].mean() - hot_hour_avg[off_idx].mean()
    )

    # ---- Traffic correlation (Pearson r, hot zone vs traffic) ----
    traffic = np.array(traffic_per_hour, dtype=float)
    if traffic.std() > 1e-6 and hot_hour_avg.std() > 1e-6:
        r = float(np.corrcoef(hot_hour_avg, traffic)[0, 1])
        traffic_correlation = max(-1.0, min(1.0, r))
    else:
        traffic_correlation = 0.0

    # ---- Night minus day (dB): mean(0–6h) – mean(9–18h), hot zone ----
    night_idx = list(range(0, 7))
    day_idx = list(range(9, 19))
    night_minus_day_db = float(
        hot_hour_avg[night_idx].mean() - hot_hour_avg[day_idx].mean()
    )

    return PRBSignatureFeatures(
        peak_dbm=peak_dbm,
        floor_elevation_db=floor_elevation_db,
        prb_uniformity=prb_uniformity,
        edge_prb_excess_db=edge_prb_excess_db,
        low_prb_excess_db=low_prb_excess_db,
        peak_cluster_width_pct=peak_cluster_width_pct,
        slope_db_per_prb=slope_db_per_prb,
        bimodal_edge_excess_db=bimodal_edge_excess_db,
        temporal_cv=temporal_cv,
        business_hour_excess_db=business_hour_excess_db,
        traffic_correlation=traffic_correlation,
        night_minus_day_db=night_minus_day_db,
        n_prb=n_prb,
        cell_band=cell_band,
        cell_bw_mhz=cell_bw_mhz,
    )


# ---------------------------------------------------------------------------
# Scoring math helpers
# ---------------------------------------------------------------------------

def _clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


def _sigmoid(x: float, center: float, steepness: float = 6.0) -> float:
    """Smooth 0→1 step as x rises past center."""
    return 1.0 / (1.0 + math.exp(-steepness * (x - center)))


def _inv_sig(x: float, center: float, steepness: float = 6.0) -> float:
    return 1.0 - _sigmoid(x, center, steepness)


def _in_range(x: float, lo: float, hi: float, margin: float = 0.3) -> float:
    """1.0 if x in [lo, hi], decays toward 0 outside by margin×(hi-lo)."""
    width = hi - lo
    decay = width * margin if width > 0 else 1.0
    if lo <= x <= hi:
        return 1.0
    if x < lo:
        return _clamp(1.0 - (lo - x) / decay)
    return _clamp(1.0 - (x - hi) / decay)


def _weighted_mean(criteria: List[Tuple[float, float]]) -> float:
    total_w = sum(w for _, w in criteria)
    if total_w == 0:
        return 0.0
    return sum(s * w for s, w in criteria) / total_w


# ---------------------------------------------------------------------------
# Per-signature scoring functions
# Each returns (score 0–1, evidence list)
# ---------------------------------------------------------------------------

def _score_cable_tv(f: PRBSignatureFeatures) -> Tuple[float, List[str]]:
    ev: List[str] = []
    c: List[Tuple[float, float]] = []

    s = _sigmoid(f.prb_uniformity, 0.78)
    c.append((s, 3.0))
    if s > 0.6:
        ev.append(f"prb_uniformity={f.prb_uniformity:.2f} (wideband flat)")

    s = _in_range(f.floor_elevation_db, 7.0, 22.0)
    c.append((s, 2.0))
    if s > 0.6:
        ev.append(f"floor_elevation={f.floor_elevation_db:.1f} dB above thermal")

    s = _in_range(f.peak_dbm, -104.0, -83.0)
    c.append((s, 1.5))
    if s > 0.6:
        ev.append(f"peak_dbm={f.peak_dbm:.1f} dBm (typical cable TV level)")

    s = _inv_sig(f.temporal_cv, 0.12)
    c.append((s, 3.0))
    if s > 0.6:
        ev.append(f"temporal_cv={f.temporal_cv:.2f} (continuous 24/7)")

    s = _inv_sig(abs(f.traffic_correlation), 0.30)
    c.append((s, 2.0))
    if s > 0.6:
        ev.append(f"traffic_correlation={f.traffic_correlation:.2f} (traffic-independent)")

    s = _inv_sig(abs(f.slope_db_per_prb), 0.04)
    c.append((s, 1.5))
    if s > 0.6:
        ev.append(f"slope={f.slope_db_per_prb:.3f} dB/PRB (flat spectrum)")

    # Penalty: if bottom PRBs are preferentially elevated → not uniform cable TV
    penalty = _clamp(1.0 - f.low_prb_excess_db / 12.0) if f.low_prb_excess_db > 3 else 1.0
    c.append((penalty, 1.0))

    return _weighted_mean(c), ev


def _score_fm_harmonic(f: PRBSignatureFeatures) -> Tuple[float, List[str]]:
    ev: List[str] = []
    c: List[Tuple[float, float]] = []

    # Very narrow peak (< 5% of PRBs)
    s = _inv_sig(f.peak_cluster_width_pct, 5.5)
    c.append((s, 5.0))
    if s > 0.5:
        ev.append(f"peak_cluster_width={f.peak_cluster_width_pct:.1f}% (very narrowband)")

    # Highly concentrated (most PRBs at floor)
    s = _sigmoid(f.prb_uniformity, 0.65)   # high uniformity = floor PRBs all same
    c.append((s, 2.0))

    # Continuous (broadcast station always on)
    s = _inv_sig(f.temporal_cv, 0.12)
    c.append((s, 2.5))
    if s > 0.5:
        ev.append(f"temporal_cv={f.temporal_cv:.2f} (continuous broadcast)")

    # No traffic correlation
    s = _inv_sig(abs(f.traffic_correlation), 0.30)
    c.append((s, 1.5))

    # Not sloped (harmonic is at a fixed frequency)
    s = _inv_sig(abs(f.slope_db_per_prb), 0.04)
    c.append((s, 1.0))

    return _weighted_mean(c), ev


def _score_tv_digital_700(f: PRBSignatureFeatures) -> Tuple[float, List[str]]:
    ev: List[str] = []
    c: List[Tuple[float, float]] = []

    # Bottom PRBs elevated above average (key discriminator — dB difference)
    s = _sigmoid(f.low_prb_excess_db, 4.0, steepness=0.5)
    c.append((s, 5.0))
    if s > 0.4:
        ev.append(f"low_prb_excess={f.low_prb_excess_db:.1f} dB (bottom PRBs elevated — TV overlap)")

    # Block width (not pinpoint-narrow, not full wideband)
    s = _in_range(f.peak_cluster_width_pct, 12.0, 42.0)
    c.append((s, 2.5))
    if s > 0.5:
        ev.append(f"peak_cluster_width={f.peak_cluster_width_pct:.1f}% (partial-band block)")

    # Low-edge excess
    s = _sigmoid(f.edge_prb_excess_db, 2.5)
    c.append((s, 2.0))
    if s > 0.5:
        ev.append(f"edge_prb_excess={f.edge_prb_excess_db:.1f} dB (band-edge concentration)")

    # Continuous broadcast
    s = _inv_sig(f.temporal_cv, 0.15)
    c.append((s, 2.0))
    if s > 0.5:
        ev.append(f"temporal_cv={f.temporal_cv:.2f} (continuous)")

    # Not full wideband (TV occupies only part of LTE band)
    s = _inv_sig(f.prb_uniformity, 0.82)
    c.append((s, 1.5))

    return _weighted_mean(c), ev


def _score_bda_oscillation(f: PRBSignatureFeatures) -> Tuple[float, List[str]]:
    ev: List[str] = []
    c: List[Tuple[float, float]] = []

    # Severe level (> −82 dBm distinguishes from cable TV)
    s = _sigmoid(f.peak_dbm, -82.0)
    c.append((s, 5.0))
    if s > 0.5:
        ev.append(f"peak_dbm={f.peak_dbm:.1f} dBm (SEVERE — BDA oscillation)")

    # Very high floor elevation
    s = _sigmoid(f.floor_elevation_db, 22.0)
    c.append((s, 3.0))
    if s > 0.5:
        ev.append(f"floor_elevation={f.floor_elevation_db:.1f} dB above thermal")

    # Full wideband
    s = _sigmoid(f.prb_uniformity, 0.72)
    c.append((s, 3.0))
    if s > 0.5:
        ev.append(f"prb_uniformity={f.prb_uniformity:.2f} (wideband)")

    # Stable 24/7 (oscillation doesn't stop)
    s = _inv_sig(f.temporal_cv, 0.14)
    c.append((s, 3.0))
    if s > 0.5:
        ev.append(f"temporal_cv={f.temporal_cv:.2f} (stable oscillation)")

    # Not traffic correlated
    s = _inv_sig(abs(f.traffic_correlation), 0.25)
    c.append((s, 1.5))

    # Not edge-concentrated (uniform, not partial band)
    s = _inv_sig(abs(f.low_prb_excess_db), 4.0)
    c.append((s, 1.0))

    return _weighted_mean(c), ev


def _score_bda_excess_gain(f: PRBSignatureFeatures) -> Tuple[float, List[str]]:
    ev: List[str] = []
    c: List[Tuple[float, float]] = []

    # Moderate-high level (below oscillation severity)
    s = _in_range(f.peak_dbm, -97.0, -78.0)
    c.append((s, 3.0))
    if s > 0.5:
        ev.append(f"peak_dbm={f.peak_dbm:.1f} dBm (excess-gain BDA range)")

    # Broadly elevated (wideband)
    s = _sigmoid(f.prb_uniformity, 0.67)
    c.append((s, 3.0))
    if s > 0.5:
        ev.append(f"prb_uniformity={f.prb_uniformity:.2f} (wideband)")

    # MUST have some temporal variation (building occupancy):
    # completely flat (cv=0) = cable TV, not BDA excess gain
    s = _sigmoid(f.temporal_cv, 0.05, steepness=30.0)
    c.append((s, 4.0))
    if s > 0.5:
        ev.append(f"temporal_cv={f.temporal_cv:.2f} (occupancy-driven variation)")

    # Mild business-hour pattern (|excess| between 0.5 and 18 dB)
    s = _in_range(abs(f.business_hour_excess_db), 0.5, 18.0)
    c.append((s, 2.0))
    if s > 0.5:
        ev.append(f"business_hour_excess={f.business_hour_excess_db:.1f} dB (occupancy pattern)")

    # Low traffic correlation
    s = _inv_sig(abs(f.traffic_correlation), 0.35)
    c.append((s, 1.5))

    # Not bottom-concentrated (BDA floods all PRBs uniformly)
    s = _inv_sig(f.low_prb_excess_db, 5.0)
    c.append((s, 2.0))
    if s < 0.4:
        ev.append(f"low_prb_excess={f.low_prb_excess_db:.1f} dB penalises BDA (not uniform)")

    # Not strongly sloped
    s = _inv_sig(abs(f.slope_db_per_prb), 0.06)
    c.append((s, 1.0))

    return _weighted_mean(c), ev


def _score_wireless_isp_2500(f: PRBSignatureFeatures) -> Tuple[float, List[str]]:
    ev: List[str] = []
    c: List[Tuple[float, float]] = []

    # Bottom PRBs clearly elevated (WISP at 2500–2515 MHz = low PRBs of B41)
    s = _sigmoid(f.low_prb_excess_db, 4.0, steepness=0.5)
    c.append((s, 6.0))
    if s > 0.4:
        ev.append(f"low_prb_excess={f.low_prb_excess_db:.1f} dB (bottom PRBs elevated — WISP 2.5 GHz)")

    # Partial band (not full wideband like BDA)
    s = _inv_sig(f.prb_uniformity, 0.82)
    c.append((s, 2.0))
    if s > 0.5:
        ev.append(f"prb_uniformity={f.prb_uniformity:.2f} (partial-band, not wideband)")

    # Daytime/usage variation
    s = _in_range(f.temporal_cv, 0.04, 0.60)
    c.append((s, 1.5))
    if s > 0.5:
        ev.append(f"temporal_cv={f.temporal_cv:.2f} (usage-driven variation)")

    # Business-hour elevation (ISP usage peaks during day)
    s = _in_range(f.business_hour_excess_db, 0.5, 25.0)
    c.append((s, 2.0))
    if s > 0.5:
        ev.append(f"business_hour_excess={f.business_hour_excess_db:.1f} dB (daytime ISP activity)")

    return _weighted_mean(c), ev


def _score_wifi_camera(f: PRBSignatureFeatures) -> Tuple[float, List[str]]:
    ev: List[str] = []
    c: List[Tuple[float, float]] = []

    # Moderate-broad (not perfectly flat, not pinpoint narrow)
    s = _in_range(f.prb_uniformity, 0.55, 0.82)
    c.append((s, 2.5))
    if s > 0.5:
        ev.append(f"prb_uniformity={f.prb_uniformity:.2f} (broad unlicensed device)")

    # Moderate level
    s = _in_range(f.peak_dbm, -98.0, -77.0)
    c.append((s, 2.0))
    if s > 0.5:
        ev.append(f"peak_dbm={f.peak_dbm:.1f} dBm (nearby unlicensed device)")

    # Some temporal variation (camera schedule or motion events)
    s = _in_range(f.temporal_cv, 0.04, 0.40)
    c.append((s, 1.5))

    # Not traffic correlated
    s = _inv_sig(abs(f.traffic_correlation), 0.30)
    c.append((s, 1.5))

    # EXCLUSION 1: strong spectral slope → military/police, not cameras
    slope_penalty = _inv_sig(abs(f.slope_db_per_prb), 0.055, steepness=40.0)
    c.append((slope_penalty, 3.0))
    if slope_penalty < 0.4:
        ev.append(f"slope={f.slope_db_per_prb:.3f} dB/PRB penalises WiFi camera (sloped = military pattern)")

    # EXCLUSION 2: strongly bottom-concentrated → TV digital, not cameras
    low_penalty = _inv_sig(f.low_prb_excess_db, 6.0)
    c.append((low_penalty, 2.5))
    if low_penalty < 0.4:
        ev.append(f"low_prb_excess={f.low_prb_excess_db:.1f} dB penalises WiFi camera (TV digital pattern)")

    # EXCLUSION 3: very narrow peak → FM harmonic, not cameras
    narrow_penalty = _sigmoid(f.peak_cluster_width_pct, 4.5)
    c.append((narrow_penalty, 2.0))
    if narrow_penalty < 0.4:
        ev.append(f"peak_cluster_width={f.peak_cluster_width_pct:.1f}% penalises WiFi camera (too narrow)")

    return _weighted_mean(c), ev


def _score_jammer(f: PRBSignatureFeatures) -> Tuple[float, List[str]]:
    ev: List[str] = []
    c: List[Tuple[float, float]] = []

    # STRONG business-hour excess (PRIMARY discriminator using hot zone dB diff)
    s = _sigmoid(f.business_hour_excess_db, 10.0, steepness=0.3)
    c.append((s, 6.0))
    if s > 0.4:
        ev.append(f"business_hour_excess={f.business_hour_excess_db:.1f} dB (STRONG 7–18 h on-off pattern)")

    # High temporal variation (sharp daily transitions)
    s = _sigmoid(f.temporal_cv, 0.08)
    c.append((s, 3.5))
    if s > 0.5:
        ev.append(f"temporal_cv={f.temporal_cv:.2f} (sharp daily on/off — jammer pattern)")

    # Often narrowband
    s = _inv_sig(f.peak_cluster_width_pct, 25.0)
    c.append((s, 1.5))
    if s > 0.5:
        ev.append(f"peak_cluster_width={f.peak_cluster_width_pct:.1f}% (narrowband jammer freq)")

    # Not traffic correlated (jammer is independent)
    s = _inv_sig(abs(f.traffic_correlation), 0.35)
    c.append((s, 2.0))

    return _weighted_mean(c), ev


def _score_military_police(f: PRBSignatureFeatures) -> Tuple[float, List[str]]:
    ev: List[str] = []
    c: List[Tuple[float, float]] = []

    # STRONG ascending spectral slope (PRIMARY discriminator)
    s = _sigmoid(abs(f.slope_db_per_prb), 0.045, steepness=60.0)
    c.append((s, 6.0))
    if s > 0.4:
        ev.append(f"slope={f.slope_db_per_prb:.3f} dB/PRB (slanted spectrum — military/police)")

    # Positive slope (ascending: LF normal, HF elevated)
    direction_score = 0.85 if f.slope_db_per_prb > 0 else 0.40
    c.append((direction_score, 2.0))
    if f.slope_db_per_prb > 0:
        ev.append("positive slope (interference increases toward high PRBs)")

    # Non-uniform (sloped ≠ flat)
    s = _inv_sig(f.prb_uniformity, 0.78)
    c.append((s, 1.5))
    if s > 0.5:
        ev.append(f"prb_uniformity={f.prb_uniformity:.2f} (non-uniform distribution)")

    # Not bottom-concentrated
    s = _inv_sig(f.low_prb_excess_db, 5.0)
    c.append((s, 1.5))

    return _weighted_mean(c), ev


def _score_pim(f: PRBSignatureFeatures) -> Tuple[float, List[str]]:
    ev: List[str] = []
    c: List[Tuple[float, float]] = []

    # STRONG positive traffic correlation (PRIMARY discriminator — unique to PIM)
    s = _sigmoid(f.traffic_correlation, 0.48)
    c.append((s, 6.0))
    if s > 0.4:
        ev.append(f"traffic_correlation={f.traffic_correlation:.2f} (DL traffic drives IM products)")

    # Lower at night (low traffic → low TX power → weak IM)
    s = _sigmoid(-f.night_minus_day_db, 2.0, steepness=0.6)
    c.append((s, 4.0))
    if s > 0.5:
        ev.append(f"night_minus_day={f.night_minus_day_db:.1f} dB (lower at night — traffic-driven)")

    # Semi-narrowband
    s = _in_range(f.peak_cluster_width_pct, 3.0, 45.0)
    c.append((s, 1.5))
    if s > 0.5:
        ev.append(f"peak_cluster_width={f.peak_cluster_width_pct:.1f}% (semi-narrowband IM product)")

    # PENALTY: PIM IM products are at calculated IM frequencies — NOT specifically at
    # the lowest PRBs (band edge). High low_prb_excess_db indicates an external
    # edge-band source (TV Digital, WISP), not PIM.
    edge_penalty = _inv_sig(f.low_prb_excess_db, 5.5, steepness=0.7)
    c.append((edge_penalty, 3.0))
    if edge_penalty < 0.4:
        ev.append(f"low_prb_excess={f.low_prb_excess_db:.1f} dB penalises PIM (band-edge concentration → not IM product)")

    return _weighted_mean(c), ev


def _score_atmospheric_ducting(f: PRBSignatureFeatures) -> Tuple[float, List[str]]:
    ev: List[str] = []
    c: List[Tuple[float, float]] = []

    # Higher at night (temperature inversion peaks before dawn)
    s = _sigmoid(f.night_minus_day_db, 2.5, steepness=0.5)
    c.append((s, 5.0))
    if s > 0.4:
        ev.append(f"night_minus_day={f.night_minus_day_db:.1f} dB (higher at night — ducting episode)")

    # High temporal variability (episodic, not steady)
    s = _sigmoid(f.temporal_cv, 0.30)
    c.append((s, 2.5))
    if s > 0.5:
        ev.append(f"temporal_cv={f.temporal_cv:.2f} (episodic atmospheric variation)")

    # Wideband (propagates full signal of distant cell)
    s = _sigmoid(f.prb_uniformity, 0.65)
    c.append((s, 2.0))
    if s > 0.5:
        ev.append(f"prb_uniformity={f.prb_uniformity:.2f} (wideband — distant cell signal)")

    # Not traffic correlated
    s = _inv_sig(abs(f.traffic_correlation), 0.28)
    c.append((s, 1.5))

    return _weighted_mean(c), ev


# ---------------------------------------------------------------------------
# Signature registry
# ---------------------------------------------------------------------------

_SCORERS = {
    "CABLE_TV_LEAKAGE":           _score_cable_tv,
    "FM_RADIO_HARMONIC":          _score_fm_harmonic,
    "TV_DIGITAL_BROADCAST_700":   _score_tv_digital_700,
    "BDA_OSCILLATION":            _score_bda_oscillation,
    "BDA_EXCESS_GAIN":            _score_bda_excess_gain,
    "WIRELESS_ISP_2500":          _score_wireless_isp_2500,
    "WIFI_CAMERA_UNLICENSED_850": _score_wifi_camera,
    "JAMMER":                     _score_jammer,
    "MILITARY_POLICE":            _score_military_police,
    "PIM":                        _score_pim,
    "ATMOSPHERIC_DUCTING":        _score_atmospheric_ducting,
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def classify_source(
    features: PRBSignatureFeatures,
) -> List[SourceSignatureMatch]:
    """
    Score all signatures against extracted features, return ranked matches.

    Only matches with confidence >= MIN_CONFIDENCE are included.
    UNKNOWN_PERSISTENT is added as fallback when nothing confident matches
    but the floor is meaningfully elevated.
    """
    matches: List[SourceSignatureMatch] = []

    for source_type, scorer in _SCORERS.items():
        score, evidence = scorer(features)
        if score < MIN_CONFIDENCE:
            continue

        band_compat = _BAND_COMPAT[source_type]
        band_ok = (not band_compat) or (features.cell_band in band_compat)
        if not band_ok:
            score *= 0.55

        if score < MIN_CONFIDENCE:
            continue

        matches.append(
            SourceSignatureMatch(
                source_type=source_type,
                label=_LABELS[source_type],
                confidence=round(_clamp(score), 3),
                evidence=evidence,
                severity=_SEVERITY[source_type],
                action_hint=_ACTION_HINTS[source_type],
                band_consistent=band_ok,
            )
        )

    matches.sort(key=lambda m: m.confidence, reverse=True)

    # Fallback: UNKNOWN_PERSISTENT
    top_conf = matches[0].confidence if matches else 0.0
    if top_conf < FALLBACK_CONFIDENCE and features.floor_elevation_db > 5.0:
        matches.append(
            SourceSignatureMatch(
                source_type="UNKNOWN_PERSISTENT",
                label=_LABELS["UNKNOWN_PERSISTENT"],
                confidence=round(
                    _clamp(0.30 + min(features.floor_elevation_db / 40.0, 0.30)), 3
                ),
                evidence=[
                    f"floor_elevation={features.floor_elevation_db:.1f} dB above thermal",
                    "no specific signature matched — field investigation required",
                ],
                severity=_SEVERITY["UNKNOWN_PERSISTENT"],
                action_hint=_ACTION_HINTS["UNKNOWN_PERSISTENT"],
                band_consistent=True,
            )
        )

    return matches


def classify_cell(
    cell_id: str,
    prb_histogram: PrbHistogram,
    traffic_per_hour: List[float],
    cell_band: int,
    cell_bw_mhz: float,
) -> PRBClassificationResult:
    """
    Full pipeline: extract features then classify interference source type.

    Parameters
    ----------
    cell_id
        Identifier for logging and output (any string).
    prb_histogram
        2-D list [N_PRB][24] with per-PRB interference in dBm.
    traffic_per_hour
        24-element list with normalised traffic load (0–1).
    cell_band
        LTE/NR band number (integer).
    cell_bw_mhz
        Channel bandwidth in MHz.
    """
    features = extract_prb_features(
        prb_histogram=prb_histogram,
        traffic_per_hour=traffic_per_hour,
        cell_band=cell_band,
        cell_bw_mhz=cell_bw_mhz,
    )
    matches = classify_source(features)

    primary = matches[0].source_type if matches else "UNKNOWN_PERSISTENT"
    needs_field = primary in _REQUIRES_FIELD or (
        matches[0].confidence < 0.60 if matches else True
    )

    return PRBClassificationResult(
        cell_id=cell_id,
        band=cell_band,
        bw_mhz=cell_bw_mhz,
        features=features,
        matches=matches,
        primary_source=primary,
        requires_field=needs_field,
    )
