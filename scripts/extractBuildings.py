"""Extracts building and island metadata needed to decode blueprints, from the
game files bundled with the `shapez2` python package.

    pip install shapez2==2.1.1
    python3 scripts/extractBuildings.py > src/lib/shapez/buildings.json
"""
import json
import pathlib
import re
import sys

COPY_FROM = re.compile(r"<copy-from:([^/>]+)/>")


def resolve(translations: dict[str, str], key: str, fallback: str, depth: int = 0) -> str:
    """Translation values may point at another key via `<copy-from:key/>`."""
    value = translations.get(key)
    if value is None:
        return fallback
    match = COPY_FROM.fullmatch(value.strip())
    if match and depth < 5:
        return resolve(translations, match.group(1), fallback, depth + 1)
    return value


def game_files_dir() -> pathlib.Path:
    override = next((a for a in sys.argv[1:] if not a.startswith("-")), None)
    if override:
        return pathlib.Path(override)
    import shapez2  # noqa: PLC0415

    return pathlib.Path(shapez2.__file__).parent / "gameFiles"


def main() -> None:
    root = game_files_dir()
    translations = json.loads((root / "translations-en-US.json").read_text())["Translations"]
    buildings = json.loads((root / "buildings.json").read_text())
    islands = json.loads((root / "islands.json").read_text())

    variants = {}
    for building in buildings["Buildings"]:
        variant_id = building["Id"]
        title = resolve(translations, f"building-variant.{variant_id}.title", variant_id)
        for internal in building["InternalVariants"]:
            variants[internal["Id"]] = {
                "variant": variant_id,
                "title": title,
                "tiles": [[t.get("X", 0), t.get("Y", 0), t.get("Z", 0)] for t in internal["Tiles"]],
            }

    island_defs = {}
    for island in islands["Islands"]:
        island_id = island["Id"]
        island_defs[island_id] = {
            "title": resolve(translations, f"island-layout.{island_id}.title", island_id),
            "tiles": [[t.get("X", 0), t.get("Y", 0), t.get("Z", 0)] for t in island["Tiles"]],
        }

    json.dump(
        {"buildingVariants": variants, "islands": island_defs},
        sys.stdout,
        separators=(",", ":"),
        ensure_ascii=False,
    )


if __name__ == "__main__":
    main()
