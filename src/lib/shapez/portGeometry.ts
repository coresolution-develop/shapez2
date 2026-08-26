/**
 * Reading a building's ports as places on the platform rather than offsets.
 *
 * Two questions come up wherever machines are placed by hand: where does this
 * port land once the building is standing somewhere, and which way does a shape
 * cross it. Both were worked out inside the shape module first; the factory
 * layout needs the same answers, and answering them twice is how two layouts
 * come to disagree about the same building.
 */
import { toWorld } from './ports'
import { tilesOf, type Facing } from './route'

/** Where a building's port lands, in world tiles. */
export function portAt(
  placement: { x: number; y: number; z: number; type: string; rotation: number },
  port: readonly [number, number, number],
): { x: number; y: number; z: number } {
  const [dx, dy, dz] = toWorld(port, placement.rotation)
  return { x: placement.x + dx, y: placement.y + dy, z: placement.z + dz }
}

/** Which way each step goes, in the order facings are numbered. */
const STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
]

export interface Crossing {
  /** Travelling this way carries a shape from the port into the building. */
  inward: Facing
  /** And this way carries it out. */
  outward: Facing
  /** The building's own tile behind the port, which is where a feed heads. */
  behind: { x: number; y: number; z: number }
}

/**
 * Which way a shape crosses a port, and which of the building's own tiles it
 * crosses into.
 *
 * A port sits on an empty tile touching the building, so it names a face — but
 * *which* face is a question the offset alone cannot always answer. A swapper's
 * two inputs are at (-1,-1) and (-1,0), and reading a step out of each axis
 * puts both of them on the same tile, which is how two different shapes came to
 * be routed into one input port. So the tile is looked up in the building's own
 * footprint instead: exactly one of its tiles touches the port, and finding it
 * gives the face and the direction together, for any shape of building.
 */
export function crossing(
  type: string,
  port: readonly [number, number, number],
  rotation: number,
): Crossing | null {
  const [dx, dy, dz] = toWorld(port, rotation)
  const tiles = tilesOf(type, rotation)

  for (const [facing, [sx, sy]] of STEPS.entries()) {
    const touching = tiles.find(
      (tile) => tile[0] === dx + sx && tile[1] === dy + sy && tile[2] === dz,
    )
    if (!touching) continue
    return {
      inward: facing as Facing,
      outward: ((facing + 2) % 4) as Facing,
      behind: { x: touching[0], y: touching[1], z: touching[2] },
    }
  }
  return null
}

/**
 * The rotation that makes a building's port face a given way.
 *
 * A splitter throws its copy to -Y when it stands upright, which is what a
 * comb wants when machines sit side by side and no use at all when they are
 * stacked. Rather than write down "use rotation 1 for a vertical comb", the
 * four rotations are tried and the one whose port points the wanted way is
 * taken — so it stays right if a measurement is ever corrected.
 */
export function rotationFacing(
  type: string,
  port: readonly [number, number, number],
  outward: Facing,
): number | null {
  for (let rotation = 0; rotation < 4; rotation++) {
    if (crossing(type, port, rotation)?.outward === outward) return rotation
  }
  return null
}
