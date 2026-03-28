import json
from typing import Optional

import typer

from .engine import evaluate, evaluate_many
from .io import load_snapshots, save_output
from .rules import RulesConfig

app = typer.Typer(no_args_is_help=True)


@app.command()
def run(
    input: str = typer.Option(..., "--input", help="Input metrics JSON"),
    out: str = typer.Option(..., "--out", help="Output JSON"),
    rules: str = typer.Option("rules.yaml", "--rules", help="Rules YAML"),
) -> None:
    rules_config = RulesConfig.load(rules)
    snapshots = load_snapshots(input)
    results = evaluate_many(snapshots, rules_config)
    save_output(out, [item.model_dump() for item in results])


@app.command()
def explain(
    cell: str = typer.Option(..., "--cell", help="Cell ID"),
    day: str = typer.Option(..., "--day", help="YYYY-MM-DD"),
    input: str = typer.Option("metrics.json", "--input", help="Input metrics JSON"),
    rules: str = typer.Option("rules.yaml", "--rules", help="Rules YAML"),
) -> None:
    rules_config = RulesConfig.load(rules)
    snapshots = load_snapshots(input)
    match = None
    for snap in snapshots:
        if snap.cell_id == cell and (snap.snapshot_day == day):
            match = snap
            break

    if not match:
        raise typer.Exit(code=1)

    output = evaluate(match, rules_config)
    typer.echo(json.dumps(output.model_dump(), indent=2))


if __name__ == "__main__":
    app()
