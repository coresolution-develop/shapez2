"""Pulls the game's own Korean names out of an installed copy of shapez 2.

The names players see in game are the only ones worth showing, and they are
not in the data files the `shapez2` python package ships — only en-US is. They
are, however, embedded as plain JSON inside the Unity asset bundle, one block
per language.

    python3 scripts/extractKoreanNames.py > src/lib/shapez/namesKo.json

Point it at a different install with an argument if the default path is wrong.
"""
import json
import pathlib
import re
import sys

DEFAULT_ASSETS = (
    pathlib.Path.home()
    / "Library/Application Support/Steam/steamapps/common/shapez 2"
    / "shapez 2.app/Contents/Resources/Data/resources.assets"
)

HANGUL = re.compile("[가-힣]")

# Only the namespaces the app actually displays.
#
# Milestone titles (`research.RN*.title`) are deliberately absent: those live in
# the scenario bundles, which are compressed, so they stay in English.
WANTED = (
    ("building-variant.", ".title"),
    ("island-layout.", ".title"),
    ("color.", ""),
    ("side-goal.", ""),
)

COPY_FROM = re.compile(r"<copy-from:([^/>]+)/>")


def assets_path() -> pathlib.Path:
    override = next((a for a in sys.argv[1:] if not a.startswith("-")), None)
    return pathlib.Path(override) if override else DEFAULT_ASSETS


def korean_pairs(raw: bytes) -> dict[str, str]:
    """Every `"key": "value"` whose value contains Hangul.

    Scanning the whole file rather than trying to carve out the Korean block
    keeps this robust: other languages simply never match the Hangul test.
    """
    pattern = re.compile(rb'"([\w\-.]+)"\s*:\s*"((?:[^"\\]|\\.)*)"')
    found: dict[str, str] = {}

    for match in pattern.finditer(raw):
        key = match.group(1).decode("ascii", "ignore")
        if not any(
            key.startswith(prefix) and key.endswith(suffix) for prefix, suffix in WANTED
        ):
            continue
        try:
            value = match.group(2).decode("utf-8")
        except UnicodeDecodeError:
            continue
        if not HANGUL.search(value) and not COPY_FROM.fullmatch(value.strip()):
            continue
        found[key] = value

    return found


def resolve(pairs: dict[str, str], key: str, depth: int = 0) -> str | None:
    """Values may point at another key via `<copy-from:key/>`."""
    value = pairs.get(key)
    if value is None:
        return None
    match = COPY_FROM.fullmatch(value.strip())
    if match and depth < 5:
        return resolve(pairs, match.group(1), depth + 1)
    return value


def main() -> None:
    path = assets_path()
    if not path.exists():
        raise SystemExit(f"게임 애셋을 찾지 못했습니다: {path}")

    pairs = korean_pairs(path.read_bytes())
    resolved = {}
    for key in pairs:
        value = resolve(pairs, key)
        if value and HANGUL.search(value):
            resolved[key] = value

    buildings = {
        key.split(".")[1]: value
        for key, value in resolved.items()
        if key.startswith("building-variant.")
    }
    islands = {
        key.split(".")[1]: value
        for key, value in resolved.items()
        if key.startswith("island-layout.")
    }
    colors = {
        key.split(".", 1)[1]: value
        for key, value in resolved.items()
        if key.startswith("color.") and len(key.split(".", 1)[1]) == 1
    }
    side_goals = {
        key[len("side-goal.") :]: value
        for key, value in resolved.items()
        if key.startswith("side-goal.")
    }

    json.dump(
        {
            "buildingVariants": buildings,
            "islands": islands,
            "colors": colors,
            "sideGoals": side_goals,
        },
        sys.stdout,
        separators=(",", ":"),
        ensure_ascii=False,
    )


if __name__ == "__main__":
    main()
