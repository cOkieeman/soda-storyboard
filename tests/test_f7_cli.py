from __future__ import annotations

import json
from pathlib import Path

import pytest
from test_production_pipeline import project as project  # noqa: PLC0414 -- shared synthetic fixture

from soda_storyboard.cli import main
from soda_storyboard.production import api


@pytest.mark.parametrize(
    ("command", "method"),
    [
        (["redraw", "pudding", "p1", "--mode", "swap", "--character", "older"], "redraw_panel"),
        (["inpaint", "pudding", "p1", "--character", "older"], "inpaint_panel"),
        (["cutout", "pudding", "hero"], "cutout"),
    ],
)
def test_postprocess_cli_preserves_explicit_large_seed(
    project: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    command: list[str],
    method: str,
) -> None:
    captured = {}

    def fake(*_args: object, **kwargs: object) -> dict:
        captured.update(kwargs)
        return {"seed": kwargs["seed"]}

    monkeypatch.setattr(api, method, fake)
    seed = 2501975893253178119
    assert main([*command, "--project", str(project), "--seed", str(seed), "--json"]) == 0
    assert captured["seed"] == seed
    assert json.loads(capsys.readouterr().out)["seed"] == seed


def test_generate_cli_repeated_seeds_override_count_estimate(
    project: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    captured = {}

    def fake(*_args: object, **kwargs: object) -> dict:
        captured.update(kwargs)
        return {"seeds": kwargs["seed"]}

    monkeypatch.setattr(api, "generate_page", fake)
    seeds = [8006353298896422912, 1206439238825408912]
    command = ["gen", "page", "pudding", "--project", str(project), "--seeds", "4", "--json"]
    for seed in seeds:
        command.extend(["--seed", str(seed)])
    assert main(command) == 0
    output = capsys.readouterr()
    assert captured["seed"] == seeds
    assert json.loads(output.out)["seeds"] == seeds
    assert "2 张" in output.err
