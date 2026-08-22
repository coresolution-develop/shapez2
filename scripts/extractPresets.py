"""Extracts real in-game shape targets from the scenario files bundled with the
`shapez2` python package, so the app can offer them as presets.

    pip install shapez2==2.1.1
    python3 scripts/extractPresets.py > src/lib/shapez/presets.json
"""
import json
import pathlib
import sys

SCENARIOS = {
    "default": "default-scenario.json",
    "hard": "hard-scenario.json",
    "insane": "insane-scenario.json",
    "hexagonal": "hexagonal-scenario.json",
}


def game_files_dir() -> pathlib.Path:
    override = next((a for a in sys.argv[1:] if not a.startswith("-")), None)
    if override:
        return pathlib.Path(override)
    import shapez2  # noqa: PLC0415

    return pathlib.Path(shapez2.__file__).parent / "gameFiles"


def main() -> None:
    root = game_files_dir()
    translations = json.loads((root / "translations-en-US.json").read_text())["Translations"]
    entries = []
    seen = set()

    max_layers = 4

    def add(scenario: str, category: str, label: str, code: str) -> None:
        # `IconicLevelShapes` is one shared list reused by every scenario, so it
        # carries shapes that can't exist under this scenario's layer limit.
        if len(code.split(":")) > max_layers:
            return
        key = (scenario, code)
        if key in seen:
            return
        seen.add(key)
        entries.append({"scenario": scenario, "category": category, "label": label, "code": code})

    for scenario, filename in SCENARIOS.items():
        data = json.loads((root / filename).read_text())
        max_layers = data["ResearchConfig"]["MaxShapeLayers"]

        for index, level in enumerate(data["Progression"]["Levels"]["Levels"]):
            title = translations.get(f"research.{level['Definition']['Id']}.title", level["Definition"]["Id"])
            for line in level["Lines"]["Lines"]:
                for shape in line["Shapes"]:
                    add(scenario, "milestone", f"M{index + 1} {title}", shape["Shape"])

        for index, code in enumerate(data["PlayerLevelConfig"]["IconicLevelShapes"]["LevelShapes"]):
            add(scenario, "operator", f"Operator Lv.{index + 1}", code)

        for group in data["Progression"]["SideQuestGroups"]["SideQuestGroups"]:
            title = translations.get(group["Title"].lstrip("@"), group["Title"].lstrip("@"))
            for quest in group["SideQuests"]:
                for cost in quest["Costs"]:
                    add(scenario, "sidequest", title, cost["Shape"])

        for entry in data["ResearchConfig"]["BlueprintCurrencyShapes"]:
            add(scenario, "blueprint", "Blueprint currency", entry["Shape"])

    json.dump(entries, sys.stdout, separators=(",", ":"), ensure_ascii=False)


if __name__ == "__main__":
    main()
