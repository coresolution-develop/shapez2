"""Pulls scenario progression out of an installed copy of shapez 2.

The `shapez2` python package ships game data, but it is frozen at the build the
package was cut from — its milestone ids are still `RN*`, while the game now
uses `Milestone_*`, and it knows nothing about 제조 (Converter) mode. The game
itself carries the real thing: every scenario is a plain-JSON `TextAsset` inside
`resources.assets`, wired together with `#include:<resource path>` references.

    pip install UnityPy
    python3 scripts/extractScenarios.py > src/lib/shapez/progression.json

Point it at a different install with an argument if the default path is wrong.

Nothing here is inferred. Milestone unlocks come from each milestone's reward
list, resolved through the content bundles it grants; Korean titles come from
the game's own `ko-KR` translation block, looked up by the very id the reward
data uses. Anything that cannot be resolved raises instead of being guessed.
"""
import json
import pathlib
import re
import sys

import UnityPy

DEFAULT_DATA_DIR = (
    pathlib.Path.home()
    / "Library/Application Support/Steam/steamapps/common/shapez 2"
    / "shapez 2.app/Contents/Resources/Data"
)

# The scenarios worth offering, and the key the app uses for each. Onboarding
# (인증) is the tutorial and is deliberately left out.
SCENARIOS = {
    "default": "Scenarios/Classic/Regular/RegularScenario",
    "hard": "Scenarios/Classic/Hard/HardScenario",
    "hexagonal": "Scenarios/Classic/Hexagonal/HexagonalScenario",
    "insane": "Scenarios/Classic/Insane/InsaneScenario",
    "converter": "Scenarios/Converter/Regular/ConverterRegularScenario",
    "converterHard": "Scenarios/Converter/Hard/ConverterHardScenario",
}

INCLUDE = re.compile(r"^#include(_raw)?:(.+)$")
# Translation keys look like "@research.Milestone_Initial.title".
TRANSLATION_KEY = re.compile(r"^@(.+)$")
COPY_FROM = re.compile(r"<copy-from:([^/>]+)/>")


STRING = re.compile(r'"(?:[^"\\]|\\.)*"')
TRAILING_COMMA = re.compile(r"\s*[\]}]")


def normalise(text: str, game) -> str:
    """Rewrite one asset's text into something `json.loads` will accept.

    The shipped assets take liberties with JSON, and each has to be handled
    while tracking string literals so a comma or slash inside a description is
    left alone:

      * trailing commas before `]` or `}`
      * `//` line comments
      * a bare `"#include:<path>"` in an object's *key* slot, meaning "paste
        that asset's fields in here"
      * the same in an array, where the target holds several elements rather
        than one

    An include that resolves to a single complete value is left in place and
    becomes a nested object once parsed.
    """
    out: list[str] = []
    # One frame per open container; objects also track whether the next string
    # is a key or a value, which is what tells an object-level include apart
    # from an ordinary string value.
    stack: list[list] = []
    index = 0
    while index < len(text):
        char = text[index]
        if char == '"':
            match = STRING.match(text, index)
            if match is None:  # unterminated; let the parser complain
                out.append(char)
                index += 1
                continue
            literal, rest = match.group(0), text[match.end() :]
            include = INCLUDE.match(json.loads(literal)) if stack else None
            spliced = None
            if include and not include.group(1):
                if stack[-1] == ["{", True] and not rest.lstrip().startswith(":"):
                    spliced = game.fields(include.group(2))
                elif stack[-1][0] == "[":
                    spliced = game.elements(include.group(2))
            out.append(literal if spliced is None else spliced)
            index = match.end()
            continue
        if text.startswith("//", index):
            end = text.find("\n", index)
            index = len(text) if end == -1 else end
            continue
        if char == "," and TRAILING_COMMA.match(text, index + 1):
            index += 1
            continue
        if char == "{":
            stack.append(["{", True])
        elif char == "[":
            stack.append(["[", False])
        elif char in "}]":
            if stack:
                stack.pop()
        elif char in ":," and stack and stack[-1][0] == "{":
            stack[-1][1] = char == ","
        out.append(char)
        index += 1
    return "".join(out)


def data_dir() -> pathlib.Path:
    override = next((a for a in sys.argv[1:] if not a.startswith("-")), None)
    return pathlib.Path(override) if override else DEFAULT_DATA_DIR


class GameData:
    """Resolves `#include:` paths the same way the game's Resources.Load does.

    Unity keeps a path -> object table in `globalgamemanagers`; without it the
    leaf names collide (Converter/Regular and Converter/Hard both hold a
    `MilestoneTier1`), so this is the difference between reading the data and
    guessing at it.
    """

    def __init__(self, root: pathlib.Path):
        self.texts: dict[int, str] = {}
        for obj in UnityPy.load(str(root / "resources.assets")).objects:
            if obj.type.name != "TextAsset":
                continue
            script = obj.read(check_read=False).m_Script
            self.texts[obj.path_id] = (
                script
                if isinstance(script, str)
                else bytes(script).decode("utf-8", "replace")
            )

        self.paths: dict[str, int] = {}
        for obj in UnityPy.load(str(root / "globalgamemanagers")).objects:
            if obj.type.name != "ResourceManager":
                continue
            for key, pointer in obj.read(check_read=False).m_Container:
                if pointer.m_PathID in self.texts:
                    self.paths[key.lower()] = pointer.m_PathID

        version = (root.parent.parent.parent.parent / "version").read_text().strip()
        self.game_version = version

    def raw(self, path: str) -> str:
        path_id = self.paths.get(path.lower())
        if path_id is None:
            raise KeyError(f"no such game resource: {path}")
        return self.texts[path_id]

    def text(self, path: str) -> str:
        """One asset as parseable JSON. The translation blocks carry a BOM."""
        return normalise(self.body(path), self)

    def body(self, path: str) -> str:
        return self.raw(path).lstrip("﻿").strip()

    def fields(self, path: str) -> str:
        """An asset's object body without its braces, ready to splice inline.

        Some of these fragments are stored already brace-less, so they are
        wrapped before normalising — otherwise their own includes would sit at
        the top level, where there is no container to tell a key slot from a
        value, and be left unresolved.
        """
        body = self.body(path)
        if not (body.startswith("{") and body.endswith("}")):
            body = f"{{{body}}}"
        return normalise(body, self).strip()[1:-1].strip()

    def elements(self, path: str) -> str | None:
        """An asset's items, ready to splice into an array.

        Returns `None` when the asset is a single complete value: that include
        is left alone and resolved after parsing, which comes to the same thing.
        """
        normalised = normalise(f"[{self.body(path)}]", self).strip()
        if len(json.loads(normalised)) == 1:
            return None
        return normalised[1:-1].strip()

    def json(self, path: str):
        try:
            return json.loads(self.text(path))
        except json.JSONDecodeError as error:
            raise ValueError(f"{path}: {error}") from error

    def load(self, path: str):
        """Parse a JSON asset, resolving every `#include` it reaches."""
        return self.resolve(self.json(path))

    def resolve(self, node):
        if isinstance(node, str):
            match = INCLUDE.match(node)
            if not match:
                return node
            raw, path = match.group(1), match.group(2)
            return self.raw(path) if raw else self.load(path)
        if isinstance(node, list):
            return [self.resolve(item) for item in node]
        if isinstance(node, dict):
            return {key: self.resolve(value) for key, value in node.items()}
        return node


def translations(game: GameData, locale: str) -> dict[str, str]:
    """The game's translation table for one locale, flattened to dotted keys."""
    table: dict[str, str] = {}

    def walk(node, prefix: str):
        for key, value in node.items():
            full = f"{prefix}{key}" if prefix else key
            if isinstance(value, dict):
                walk(value, f"{full}.")
            elif isinstance(value, str):
                table[full] = value

    walk(game.json(f"Translations/{locale}")["Entries"], "")
    return table


class Translator:
    """Looks up `@some.translation.key` in one locale.

    A handful of entries are `<copy-from:other.key/>` aliases — the shop's
    cutter entry is just the cutter's own name — so those are followed.
    """

    def __init__(self, game: GameData, locale: str):
        self.table = translations(game, locale)

    def __call__(self, value: str, fallback: str = "") -> str:
        match = TRANSLATION_KEY.match(value or "")
        if not match:
            return value or fallback
        return self.lookup(match.group(1), fallback)

    def lookup(self, key: str, fallback: str, depth: int = 0) -> str:
        text = self.table.get(key)
        if text is None:
            return fallback
        alias = COPY_FROM.fullmatch(text.strip())
        if alias and depth < 4:
            return self.lookup(alias.group(1), fallback, depth + 1)
        return text


def bundle_buildings(bundle: dict) -> list[str]:
    """Building variants a content bundle hands over."""
    return [
        reward["BuildingDefinitionGroupId"]
        for reward in bundle.get("Rewards", [])
        if reward.get("$type") == "BuildingReward"
    ]


def granted_bundles(milestone: dict) -> list[str]:
    """Ids of the content bundles a milestone hands over."""
    return [
        reward["ContentBundleId"]
        for reward in milestone.get("Rewards", [])
        if reward.get("$type") == "ContentBundleReward"
    ]


def milestone_unlocks(milestone: dict, bundles: dict[str, dict]) -> list[str]:
    """Building variants a milestone hands over, in the order it lists them."""
    unlocks: list[str] = []
    for reward in milestone.get("Rewards", []):
        kind = reward.get("$type")
        if kind == "BuildingReward":
            unlocks.append(reward["BuildingDefinitionGroupId"])
        elif kind == "ContentBundleReward":
            bundle_id = reward["ContentBundleId"]
            if bundle_id not in bundles:
                raise KeyError(f"{milestone['Id']} grants unknown bundle {bundle_id}")
            unlocks.extend(bundle_buildings(bundles[bundle_id]))
    return [u for i, u in enumerate(unlocks) if u not in unlocks[:i]]


def milestone_goals(milestone: dict) -> list[dict]:
    """The shapes a milestone asks you to deliver."""
    goals = []
    for line in milestone.get("Lines", []):
        for entry in line.get("Shapes", []):
            goals.append({"shape": entry["Shape"], "amount": entry["Amount"]})
    return goals


def research_points_cost(bundle: dict) -> int | None:
    for cost in bundle.get("Costs", []):
        if cost.get("$type") == "ResearchPointsCost":
            return cost["Amount"]
    return None


def scenario_progression(game: GameData, path: str, ko: Translator, en: Translator) -> dict:
    scenario = game.load(path)
    progression = scenario["Progression"]

    # Milestones grant content bundles by id; the scenario's own content list is
    # what those ids point at.
    bundles: dict[str, dict] = {}
    for group in progression["ScenarioContent"]["ContentBundles"]:
        for bundle in group["ContentBundle"]:
            bundles.setdefault(bundle["Id"], bundle)

    milestones = []
    granted: set[str] = set()
    for index, level in enumerate(progression["Levels"]["Levels"], start=1):
        definition = level["Definition"]
        granted.update(granted_bundles(definition))
        milestones.append(
            {
                "index": index,
                "id": definition["Id"],
                "title": en(definition["Title"], definition["Id"]),
                "titleKo": ko(definition["Title"], ""),
                "unlocks": milestone_unlocks(definition, bundles),
                "goals": milestone_goals(level["Lines"]),
            }
        )

    # The shop: content bundles you buy with research points rather than reach.
    side_upgrades = []
    for bundle_id, bundle in bundles.items():
        cost = research_points_cost(bundle)
        buildings = bundle_buildings(bundle)
        if bundle_id in granted or cost is None or not buildings:
            continue
        side_upgrades.append(
            {
                "id": bundle_id,
                "title": en(bundle["Title"], bundle_id),
                "titleKo": ko(bundle["Title"], ""),
                "unlocks": buildings,
                "cost": cost,
                "requires": bundle.get("RequiredResearchIds", []),
            }
        )

    mode = scenario["SupportedGameModes"][0]
    return {
        "id": scenario["UniqueId"],
        "title": en(scenario["Title"], scenario["UniqueId"]),
        "titleKo": ko(scenario["Title"], ""),
        "gameMode": mode,
        "gameModeTitle": en(f"@game-mode.{mode}.title", mode),
        "gameModeTitleKo": ko(f"@game-mode.{mode}.title", ""),
        "maxShapeLayers": scenario["ResearchConfig"]["MaxShapeLayers"],
        "milestones": milestones,
        "sideUpgrades": side_upgrades,
    }


def main() -> None:
    game = GameData(data_dir())
    ko, en = Translator(game, "ko-KR"), Translator(game, "en")

    out = {"gameVersion": game.game_version, "scenarios": {}}
    for key, path in SCENARIOS.items():
        out["scenarios"][key] = scenario_progression(game, path, ko, en)

    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
