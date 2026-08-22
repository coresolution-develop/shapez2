"""Generates operation test vectors from the official shapez2 shape logic, so
our TypeScript port can be checked against the implementation the game uses.

    pip install shapez2==2.1.1
    python3 scripts/genVectors.py > src/lib/shapez/__tests__/opVectors.json
"""
import json
import random
import sys

from shapez2 import ingameData, shapeOperations
from shapez2.gameObjects import Shape

MAX_LAYERS = 4

CONFIGS = {
    "quad": ingameData.QUAD_SHAPES_CONFIG,
    "hex": ingameData.HEX_SHAPES_CONFIG,
}


def random_code(rng: random.Random, config) -> str:
    n = config.numPartsPerLayer
    layers = []
    for _ in range(rng.randint(1, MAX_LAYERS)):
        parts = []
        for _ in range(n):
            roll = rng.random()
            if roll < 0.25:
                parts.append("--")
            elif roll < 0.35:
                parts.append("P-")
            elif roll < 0.5:
                parts.append("c" + rng.choice("urgbcmyw"))
            else:
                shape = rng.choice([p.code for p in config.parts if p.code not in ("P", "c")])
                parts.append(shape + rng.choice("urgbcmyw"))
        layers.append("".join(parts))
    return ":".join(layers)


def main() -> None:
    rng = random.Random(20260821)
    vectors = []

    for config_id, config in CONFIGS.items():
        op_config = shapeOperations.ShapeOperationConfig(MAX_LAYERS, config)

        def load(code: str) -> Shape:
            return Shape.fromShapeCode(code, config)

        for _ in range(250):
            a_code = random_code(rng, config)
            b_code = random_code(rng, config)
            color = ingameData.DEFAULT_COLOR_SCHEME.colorsByCode[rng.choice("urgbcmyw")]

            cases = [
                ("cut", [a_code], None, shapeOperations.cut(load(a_code), config=op_config)),
                ("hcut", [a_code], None, shapeOperations.halfCut(load(a_code), config=op_config)),
                ("r90cw", [a_code], None, shapeOperations.rotate90CW(load(a_code), config=op_config)),
                ("r90ccw", [a_code], None, shapeOperations.rotate90CCW(load(a_code), config=op_config)),
                ("r180", [a_code], None, shapeOperations.rotate180(load(a_code), config=op_config)),
                ("swap", [a_code, b_code], None,
                 shapeOperations.swapHalves(load(a_code), load(b_code), config=op_config)),
                ("stack", [a_code, b_code], None,
                 shapeOperations.stack(load(a_code), load(b_code), config=op_config)),
                ("paint", [a_code], color.code,
                 shapeOperations.topPaint(load(a_code), color, config=op_config)),
                ("pin", [a_code], None, shapeOperations.pushPin(load(a_code), config=op_config)),
                ("crystal", [a_code], color.code,
                 shapeOperations.genCrystal(load(a_code), color, config=op_config)),
            ]

            for op, inputs, color_code, outputs in cases:
                vectors.append({
                    "config": config_id,
                    "op": op,
                    "inputs": inputs,
                    "color": color_code,
                    "outputs": [s.toShapeCode() for s in outputs],
                })

    json.dump(vectors, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
