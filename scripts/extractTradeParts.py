"""Traces the trade-shape part outlines out of an installed copy of shapez 2.

`X` (the gems) and `Y` (the vortex shape) have no simulation rules — no machine
makes them — but they still have to be recognisable on screen. Their geometry is
not something to invent: the game ships the meshes, so the silhouette is read
off those.

    pip install UnityPy pillow
    python3 scripts/extractTradeParts.py > src/components/tradePartShapes.json

Point it at a different install with an argument if the default path is wrong.

How it works: project the quarter mesh straight down, rasterise it, then sweep a
ray from the shape's centre through the quarter and record how far the fill
reaches at each angle. That profile is the outline. `CircleQuad` and
`ChevronQuad` are traced alongside as a control — a quarter disc has to come out
flat, and the windmill has to dip in the middle — so a bad trace is visible in
the numbers rather than only in the drawing.
"""
import json
import math
import pathlib
import sys

import UnityPy
from PIL import Image, ImageDraw

DEFAULT_DATA_DIR = (
    pathlib.Path.home()
    / "Library/Application Support/Steam/steamapps/common/shapez 2"
    / "shapez 2.app/Contents/Resources/Data"
)

# Quarter meshes are named `<Part>Quad`; the two that break the pattern are the
# two part codes the simulator has no rules for. `XShape` is the gem — the codes
# are literally `Xr`, `Xb` and so on. `StarShape` is left over once every other
# quad part is accounted for (Circle, Rect, Star, Chevron, Pin, Crystal), so it
# is the vortex shape `Y`.
MESHES = {"X": "XShape_Viewer", "Y": "StarShape_Viewer"}

# Traced too, purely so a broken trace shows up: these two are already drawn by
# hand in the renderer and their profiles are known shapes.
CONTROLS = {"C": "CircleQuad_Viewer", "W": "ChevronQuad_Viewer"}

RASTER = 1024
SPAN = 0.5
STEPS = 181  # half-degree sweep across the quarter


def data_dir() -> pathlib.Path:
    override = next((a for a in sys.argv[1:] if not a.startswith("-")), None)
    return pathlib.Path(override) if override else DEFAULT_DATA_DIR


def meshes(root: pathlib.Path, wanted: set[str]) -> dict[str, str]:
    """Wavefront OBJ text for each named mesh."""
    found: dict[str, str] = {}
    for obj in UnityPy.load(str(root / "resources.assets")).objects:
        if obj.type.name != "Mesh":
            continue
        data = obj.read(check_read=False)
        if data.m_Name in wanted:
            found[data.m_Name] = data.export()
    missing = wanted - found.keys()
    if missing:
        raise KeyError(f"meshes not in this install: {sorted(missing)}")
    return found


def rasterise(obj_text: str):
    """The mesh seen from above, as a filled mask."""
    vertices: list[tuple[float, float, float]] = []
    image = Image.new("1", (RASTER, RASTER), 0)
    draw = ImageDraw.Draw(image)

    def to_pixel(vertex):
        x, _, z = vertex
        return ((x + SPAN) / (2 * SPAN) * RASTER, (SPAN - z) / (2 * SPAN) * RASTER)

    for line in obj_text.splitlines():
        if line.startswith("v "):
            _, x, y, z = line.split()[:4]
            vertices.append((float(x), float(y), float(z)))
        elif line.startswith("f "):
            corners = [int(part.split("/")[0]) - 1 for part in line.split()[1:]]
            for i in range(1, len(corners) - 1):
                draw.polygon(
                    [to_pixel(vertices[c]) for c in (corners[0], corners[i], corners[i + 1])],
                    fill=1,
                )
    return image.load()


def profile(obj_text: str) -> list[float]:
    """How far the quarter reaches at each angle, normalised to its widest."""
    pixels = rasterise(obj_text)
    centre = RASTER / 2
    reach: list[float] = []

    for step in range(STEPS):
        # the quarter sits up and to the left of the origin in mesh space
        angle = math.radians(90 + 90 * step / (STEPS - 1))
        dx, dy = math.cos(angle), -math.sin(angle)
        hit = 0
        for radius in range(int(centre) - 1, 0, -1):
            x, y = int(centre + dx * radius), int(centre + dy * radius)
            if pixels[x, y]:
                hit = radius
                break
        reach.append(hit / centre)

    widest = max(reach)
    if widest == 0:
        raise ValueError("mesh projected to nothing")
    return [value / widest for value in reach]


def polygon(reach: list[float]) -> list[list[float]]:
    """The profile as points, thinned to the ones that carry the shape."""
    points = []
    for step, radius in enumerate(reach):
        angle = math.radians(90 * step / (len(reach) - 1))
        points.append((radius * math.cos(angle), radius * math.sin(angle)))
    return [[round(x, 4), round(y, 4)] for x, y in simplify(points, 0.004)]


def simplify(points, tolerance):
    """Ramer–Douglas–Peucker, so a straight edge costs two points, not sixty."""
    if len(points) < 3:
        return points

    def distance(point, start, end):
        if start == end:
            return math.dist(point, start)
        dx, dy = end[0] - start[0], end[1] - start[1]
        t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)
        t = max(0.0, min(1.0, t))
        return math.dist(point, (start[0] + t * dx, start[1] + t * dy))

    worst, index = 0.0, 0
    for i in range(1, len(points) - 1):
        gap = distance(points[i], points[0], points[-1])
        if gap > worst:
            worst, index = gap, i

    if worst <= tolerance:
        return [points[0], points[-1]]
    return simplify(points[: index + 1], tolerance)[:-1] + simplify(points[index:], tolerance)


def main() -> None:
    root = data_dir()
    wanted = set(MESHES.values()) | set(CONTROLS.values())
    obj = meshes(root, wanted)

    control_checks = {}
    for code, name in CONTROLS.items():
        reach = profile(obj[name])
        control_checks[code] = {"min": round(min(reach), 3), "max": round(max(reach), 3)}

    # A quarter disc must stay near its widest all the way round; the windmill
    # has a bite out of the middle. If either stops being true, the trace broke.
    if control_checks["C"]["min"] < 0.95:
        raise ValueError(f"circle traced as non-round: {control_checks['C']}")
    if control_checks["W"]["min"] > 0.85:
        raise ValueError(f"windmill traced without its bite: {control_checks['W']}")

    out = {
        "source": "shapez 2 quarter meshes, projected from above",
        "controls": control_checks,
        "parts": {code: polygon(profile(obj[name])) for code, name in MESHES.items()},
        "meshes": MESHES,
    }
    json.dump(out, sys.stdout, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
