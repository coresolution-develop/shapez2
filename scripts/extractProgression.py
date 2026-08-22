"""Extracts which buildings unlock when, per scenario, so the solver can be
limited to what a player can actually build right now.

    pip install shapez2==2.1.1
    python3 scripts/extractProgression.py > src/lib/shapez/progression.json
"""
import json
import pathlib
import re
import sys

SCENARIOS = {
    "default": "default-scenario.json",
    "hard": "hard-scenario.json",
    "insane": "insane-scenario.json",
    "hexagonal": "hexagonal-scenario.json",
}

COPY_FROM = re.compile(r"<copy-from:([^/>]+)/>")


def game_files_dir() -> pathlib.Path:
    override = next((a for a in sys.argv[1:] if not a.startswith("-")), None)
    if override:
        return pathlib.Path(override)
    import shapez2  # noqa: PLC0415

    return pathlib.Path(shapez2.__file__).parent / "gameFiles"


def resolve(translations: dict[str, str], key: str, fallback: str, depth: int = 0) -> str:
    value = translations.get(key)
    if value is None:
        return fallback
    match = COPY_FROM.fullmatch(value.strip())
    if match and depth < 5:
        return resolve(translations, match.group(1), fallback, depth + 1)
    return value


def building_rewards(rewards: list[dict]) -> list[str]:
    return [r["BuildingDefinitionGroupId"] for r in rewards if r.get("$type") == "BuildingReward"]


def main() -> None:
    root = game_files_dir()
    translations = json.loads((root / "translations-en-US.json").read_text())["Translations"]
    result = {}

    for scenario, filename in SCENARIOS.items():
        data = json.loads((root / filename).read_text())

        milestones = []
        for index, level in enumerate(data["Progression"]["Levels"]["Levels"]):
            level_id = level["Definition"]["Id"]
            milestones.append({
                "index": index + 1,
                "id": level_id,
                "title": resolve(translations, f"research.{level_id}.title", level_id),
                "unlocks": building_rewards(level["Rewards"]["Rewards"]),
            })

        side_upgrades = []
        for upgrade in data["Progression"]["SideUpgrades"]["SideUpgrades"]:
            unlocks = building_rewards(upgrade["Rewards"])
            if not unlocks:
                continue
            upgrade_id = upgrade["Id"]
            cost = next(
                (c["Amount"] for c in upgrade.get("Costs", []) if c.get("$type") == "ResearchPointsCost"),
                None,
            )
            side_upgrades.append({
                "id": upgrade_id,
                "title": resolve(translations, f"research.{upgrade_id}.title", upgrade_id),
                "unlocks": unlocks,
                "cost": cost,
                "requires": upgrade.get("RequiredUpgradeIds", []),
            })

        result[scenario] = {
            "maxShapeLayers": data["ResearchConfig"]["MaxShapeLayers"],
            "milestones": milestones,
            "sideUpgrades": side_upgrades,
        }

    json.dump(result, sys.stdout, separators=(",", ":"), ensure_ascii=False)


if __name__ == "__main__":
    main()
