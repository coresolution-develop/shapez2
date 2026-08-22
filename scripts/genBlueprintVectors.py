"""Generates blueprint decode test vectors using the official shapez2 decoder,
so the TypeScript port can be checked against it.

    pip install shapez2==2.1.1
    python3 scripts/genBlueprintVectors.py > src/lib/shapez/__tests__/blueprintVectors.json
"""
import base64
import collections
import gzip
import json
import sys

from shapez2 import blueprints, versions

# A real platform blueprint shared by a player, plus synthetic ones covering
# building blueprints, rotations and multi-tile footprints.
REAL_BLUEPRINT = (
    "SHAPEZ2-1-H4sIABmb3WYA/6zXXWvbMBQG4P9y2KUuLH/bsItl7SCQQGhL6BhhiFrJBJ5cjmXWEPzfZydN5ma1Zx0v"
    "AUOIHp3ovJKDD7CGlDtJwGC2gvQAH8z+WUIK8zIXOgMG86dCt1/cCCMg/Qaq+ZyucmG2Bf4sgekqz08XKH+IZ5neVac"
    "3bGoGt9qgkmUDD/DQTLsQ+6Iy3+/bkUulJTYVZt26s0rlmdK7/1r5EdKQwddmpT6DO0g9dvwxty8GxZMp8EZuRZWbuT"
    "YStcjXApXQBmp2pBGdxnSa0CnnE6w7wXoTrE+3p2yDo+SEaCkyJsuELF9zJVGXTj069aeuNezSmczNq1rI7T+WGp7MU"
    "uJOovtQ8MXw+saP9y3HB93xnTV8KfCXwKyPhT3snaUvFWKBMruyUU/zRhWOCZ2PzvJsVgWae6kzideEwee2e7tP7ev"
    "j25NMCD2yyyS2G55YJu5MiM4ZjG6o+/ws7eJ2acyjMZ/Ggh42pqPB4H4eVTghxBGepV3B6JrRzlCbz58/UsuO8elTu"
    "Jcphs/MX9CjQp8KgzfQ9j7JPcKuaNvzbmvHleQTgokuU1A3WERsdEx0CTVYhxKQMxyQxfFxaXdie+cRnU90QZ8b6ms"
    "wvHXHlXQmpBJepqDckLtu/IHZNE+3SgvcryWWqn2cbZ+163pT178FEGAAQVATrnoPAAA=$"
)


def encode(payload: dict) -> str:
    body = base64.b64encode(gzip.compress(json.dumps(payload).encode())).decode()
    return f"SHAPEZ2-{versions.LATEST_MAJOR_VERSION}-{body}$"


def building_bp(entries: list[dict], icons: list[str | None] | None = None) -> str:
    return encode({
        "V": versions.LATEST_GAME_VERSION,
        "BP": {
            "$type": "Building",
            "Icon": {"Data": icons if icons is not None else [None, None, None, None]},
            "Entries": entries,
        },
    })


SYNTHETIC = {
    "single painter": building_bp([
        {"X": 0, "Y": 0, "L": 0, "R": 0, "T": "PainterDefaultInternalVariant"},
    ]),
    "rotated painter": building_bp([
        {"X": 3, "Y": 5, "L": 1, "R": 1, "T": "PainterDefaultInternalVariant"},
    ]),
    "mixed line": building_bp(
        [
            {"X": 0, "Y": 0, "L": 0, "R": 0, "T": "BeltDefaultForwardInternalVariant"},
            {"X": 0, "Y": 1, "L": 0, "R": 0, "T": "BeltDefaultForwardInternalVariant"},
            {"X": 4, "Y": 4, "L": 0, "R": 0, "T": "CutterDefaultInternalVariant"},
            {"X": 8, "Y": 8, "L": 0, "R": 2, "T": "RotatorOneQuadInternalVariant"},
            {"X": 12, "Y": 12, "L": 1, "R": 3, "T": "StackerDefaultInternalVariant"},
        ],
        ["shape:CuRuCuCu", "icon:building", None, None],
    ),
    "all rotations": building_bp([
        {"X": i * 4, "Y": 0, "L": 0, "R": i, "T": "CrystalGeneratorDefaultInternalVariant"}
        for i in range(4)
    ]),
}


def describe(code: str) -> dict:
    bp = blueprints.decodeBlueprint(code)
    inner = bp.islandBP if bp.type == blueprints.BlueprintType.island else bp.buildingBP

    if bp.type == blueprints.BlueprintType.island:
        islands = inner.entries
        building_bps = [i.buildingBP for i in islands if i.buildingBP is not None]
    else:
        islands = []
        building_bps = [inner]

    buildings = [entry for sub in building_bps for entry in sub.entries]
    counts = collections.Counter(b.type.id for b in buildings)
    tiles = [pos for sub in building_bps for pos in sub.toTileDict()]

    result = {
        "kind": "island" if bp.type == blueprints.BlueprintType.island else "building",
        "majorVersion": bp.majorVersion,
        "version": bp.version,
        "totalBuildings": len(buildings),
        "totalIslands": len(islands),
        "countsByInternalVariant": dict(sorted(counts.items())),
        "tiles": sorted([t.x, t.y, t.z] for t in tiles),
    }
    return result


def main() -> None:
    vectors = [{"name": "real platform blueprint", "code": REAL_BLUEPRINT}]
    vectors += [{"name": name, "code": code} for name, code in SYNTHETIC.items()]

    for vector in vectors:
        vector["expected"] = describe(vector["code"])

    json.dump(vectors, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
