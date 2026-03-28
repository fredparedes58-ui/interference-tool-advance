import json
from pathlib import Path

from interference_advisor.engine import evaluate
from interference_advisor.models import CellSnapshot, NiPrbProfile
from interference_advisor.rules import RulesConfig

RULES = RulesConfig.load(str(Path(__file__).resolve().parents[1] / "rules.yaml"))


def find_category(output, category: str):
    return next((rec for rec in output.recommendations if rec.category == category), None)


def test_pim_confirmed():
    snapshot = CellSnapshot(
        cell_id="C1",
        pim_class="PIM_DISTRIBUIDO",
        pim_reliability=0.7,
    )
    output = evaluate(snapshot, RULES)
    rec = find_category(output, "PIM_CONFIRMED")
    assert rec is not None


def test_ul_sinr_with_4rx():
    snapshot = CellSnapshot(
        cell_id="C2",
        ul_sinr_db_p50=-6.0,
        has_4rx=True,
    )
    output = evaluate(snapshot, RULES)
    rec = find_category(output, "UL_INTERFERENCE_LIMITED_CAPACITY")
    assert rec is not None


def test_volte_conflict_spifho():
    snapshot = CellSnapshot(
        cell_id="C3",
        qci1_kpi_degraded=True,
        qci1_active_users=3,
        spifho_configured=True,
        servOrPrioTriggeredIFHo="QCI",
    )
    output = evaluate(snapshot, RULES)
    rec = find_category(output, "VOICE_QCI1_AT_RISK")
    assert rec is not None
    assert any("SPIFHO" in conflict for action in rec.actions for conflict in action.conflicts)


def test_pucch_edge_overdimensioning():
    snapshot = CellSnapshot(
        cell_id="C4",
        pucch_bler_avg=0.2,
        ampr_restriction_suspected=True,
        ni_prb_profile=NiPrbProfile(edge_peaks_flag=True),
    )
    output = evaluate(snapshot, RULES)
    rec = find_category(output, "PUCCH_EDGE_OR_CONTROL_LIMITATION")
    assert rec is not None


def test_iflb_vs_ivlb_conflict():
    snapshot = CellSnapshot(
        cell_id="C5",
        carrier_a_util=0.9,
        carrier_b_util=0.5,
        ifo_enabled=True,
        ivlb_enabled=True,
    )
    output = evaluate(snapshot, RULES)
    rec = find_category(output, "LOAD_IMBALANCE_INTERFREQ")
    assert rec is not None
    assert any("IVLB" in conflict for action in rec.actions for conflict in action.conflicts)


def test_combined_cell_duct_conflict():
    snapshot = CellSnapshot(
        cell_id="C6",
        duplex="TDD",
        duct_pattern_flag=True,
        is_combined_cell=True,
    )
    output = evaluate(snapshot, RULES)
    rec = find_category(output, "ATMOSPHERIC_DUCT_INTERFERENCE")
    assert rec is not None
    assert any("Combined cell" in conflict for action in rec.actions for conflict in action.conflicts)


def test_spifho_policy_violation():
    snapshot = CellSnapshot(
        cell_id="C7",
        voice_allowed_on_serving_freq=False,
        qci1_active_users=2,
    )
    output = evaluate(snapshot, RULES)
    rec = find_category(output, "SERVICE_OR_PRIORITY_POLICY_VIOLATION")
    assert rec is not None
    assert any(change.param == "servOrPrioIFHoSetupBearer" for action in rec.actions for change in action.config_changes)
