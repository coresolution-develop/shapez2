/**
 * Finding a belt path from one tile to another, around whatever is in the way.
 *
 * Every layout so far could be written down directly: a comb is a row, a ladder
 * is a column, and nothing had to find its way past anything. A stacker module
 * cannot be written down like that. It needs two shapes delivered to the same
 * tile on neighbouring floors, twenty-four lanes arriving on two different
 * edges, and only sixteen columns to do it in — the streams have to weave.
 *
 * So this is a search rather than a construction. It walks the grid one tile at
 * a time, and every step it can take corresponds to exactly one piece the game
 * has and this repository has measured: a belt straight on, a belt turning
 * either way, and the six lifts that turn and change floor. Nothing is invented
 * — if a step cannot be built out of a measured piece, the search cannot take
 * it, so a path that comes back is a path that can be placed.
 */
import type { BuildingPlacement } from './blueprint'
import { portsFor } from './portData'
import { toWorld } from './ports'
import buildings from './buildings.json'

const FOOTPRINTS = (buildings as { buildingVariants: Record<string, { tiles: number[][] }> })
  .buildingVariants

/** Quarter turns clockwise, as the game counts them. */
export type Facing = 0 | 1 | 2 | 3

const STEP: Record<Facing, [number, number]> = {
  0: [1, 0],
  1: [0, 1],
  2: [-1, 0],
  3: [0, -1],
}

const clockwise = (facing: Facing): Facing => (((facing + 3) % 4) as Facing)
const anticlockwise = (facing: Facing): Facing => (((facing + 1) % 4) as Facing)

/**
 * One tile of a path: the piece to place there and where the shape goes next.
 *
 * `turn` is the facing the shape leaves with, which is not always the facing it
 * arrived with — that is what makes a corner a corner.
 */
interface Move {
  type: string
  /** Rotation the piece is placed at. */
  rotation: Facing
  /** Facing the shape leaves with. */
  leaves: Facing
  /** Floors the shape climbs (or drops) on the way out. */
  climb: -1 | 0 | 1
}

/**
 * Every step a shape can take out of a tile it has just entered.
 *
 * The rotation of each piece is the facing the shape *arrived* with, because
 * every one of these takes its input from directly behind — which is what the
 * measured ports in `portData.ts` say. The turning pieces then differ only in
 * which way they let it out.
 */
function movesFrom(facing: Facing): Move[] {
  return [
    { type: 'BeltDefaultForwardInternalVariant', rotation: facing, leaves: facing, climb: 0 },
    {
      type: 'BeltDefaultLeftInternalVariant',
      rotation: facing,
      leaves: clockwise(facing),
      climb: 0,
    },
    {
      type: 'BeltDefaultLeftInternalVariantMirrored',
      rotation: facing,
      leaves: anticlockwise(facing),
      climb: 0,
    },
    { type: 'Lift1UpForwardInternalVariant', rotation: facing, leaves: facing, climb: 1 },
    { type: 'Lift1DownForwardInternalVariant', rotation: facing, leaves: facing, climb: -1 },
    {
      type: 'Lift1UpLeftInternalVariant',
      rotation: facing,
      leaves: clockwise(facing),
      climb: 1,
    },
    {
      type: 'Lift1UpLeftInternalVariantMirrored',
      rotation: facing,
      leaves: anticlockwise(facing),
      climb: 1,
    },
    {
      type: 'Lift1DownLeftInternalVariant',
      rotation: facing,
      leaves: clockwise(facing),
      climb: -1,
    },
    {
      type: 'Lift1DownLeftInternalVariantMirrored',
      rotation: facing,
      leaves: anticlockwise(facing),
      climb: -1,
    },
  ]
}

/** Tiles a piece covers when placed, in world offsets from its own tile. */
export function tilesOf(type: string, rotation: number): [number, number, number][] {
  return (FOOTPRINTS[type]?.tiles ?? [[0, 0, 0]]).map(
    (tile) => toWorld(tile as [number, number, number], rotation) as [number, number, number],
  )
}

export interface Cell {
  x: number
  y: number
  z: number
}

export interface Endpoint extends Cell {
  /** Which way the shape is travelling here. */
  facing: Facing
}

export interface Bounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
  floors: number
}

/**
 * The tiles a layout has already spoken for.
 *
 * A router is only as good as its map, so this is the one place that decides
 * whether a tile is free, and everything — machines, hand-placed pieces, routed
 * paths — goes through it.
 */
export class Occupancy {
  private readonly taken = new Map<string, string>()

  constructor(readonly bounds: Bounds) {}

  static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`
  }

  inside(x: number, y: number, z: number): boolean {
    const { minX, maxX, minY, maxY, floors } = this.bounds
    return x >= minX && x <= maxX && y >= minY && y <= maxY && z >= 0 && z < floors
  }

  free(x: number, y: number, z: number): boolean {
    return this.inside(x, y, z) && !this.taken.has(Occupancy.key(x, y, z))
  }

  at(x: number, y: number, z: number): string | undefined {
    return this.taken.get(Occupancy.key(x, y, z))
  }

  /** Claims every tile a piece covers, or reports which one was already gone. */
  claim(placement: BuildingPlacement): string | null {
    const cells = tilesOf(placement.type, placement.rotation ?? 0).map(([dx, dy, dz]) => ({
      x: (placement.x ?? 0) + dx,
      y: (placement.y ?? 0) + dy,
      z: (placement.layer ?? 0) + dz,
    }))
    for (const cell of cells) {
      if (!this.free(cell.x, cell.y, cell.z)) {
        return `${placement.type}@(${cell.x},${cell.y},${cell.z})`
      }
    }
    for (const cell of cells) this.taken.set(Occupancy.key(cell.x, cell.y, cell.z), placement.type)
    return null
  }
}

interface Node {
  x: number
  y: number
  z: number
  facing: Facing
}

const nodeKey = (node: Node) => `${node.x},${node.y},${node.z},${node.facing}`

/** A frontier that stays in order without re-sorting the whole thing. */
class Frontier {
  private readonly items: { node: Node; score: number }[] = []

  get size(): number {
    return this.items.length
  }

  push(node: Node, score: number): void {
    this.items.push({ node, score })
    let child = this.items.length - 1
    while (child > 0) {
      const parent = (child - 1) >> 1
      if (this.items[parent].score <= this.items[child].score) break
      ;[this.items[parent], this.items[child]] = [this.items[child], this.items[parent]]
      child = parent
    }
  }

  pop(): Node | undefined {
    const top = this.items[0]
    const last = this.items.pop()
    if (last !== undefined && this.items.length > 0) {
      this.items[0] = last
      let parent = 0
      for (;;) {
        const left = parent * 2 + 1
        const right = left + 1
        let smallest = parent
        if (left < this.items.length && this.items[left].score < this.items[smallest].score) {
          smallest = left
        }
        if (right < this.items.length && this.items[right].score < this.items[smallest].score) {
          smallest = right
        }
        if (smallest === parent) break
        ;[this.items[parent], this.items[smallest]] = [this.items[smallest], this.items[parent]]
        parent = smallest
      }
    }
    return top?.node
  }
}

/** What a tile costs to pass through beyond the one tile of distance. */
export type Penalty = (x: number, y: number, z: number) => number

const FREE: Penalty = () => 0

/**
 * Whether a piece placed here would fit, counting the floors a lift eats.
 *
 * A lift is two floors tall even though it moves a shape one, which is exactly
 * the sort of thing that looks fine on a plan and overlaps in the game.
 */
function fits(occupancy: Occupancy, move: Move, node: Node, spoken: Set<string>): boolean {
  return tilesOf(move.type, move.rotation).every(
    ([dx, dy, dz]) =>
      occupancy.free(node.x + dx, node.y + dy, node.z + dz) &&
      !spoken.has(Occupancy.key(node.x + dx, node.y + dy, node.z + dz)),
  )
}

export interface RoutedPath {
  placements: BuildingPlacement[]
  /** How many tiles the shape travels, end to end. */
  length: number
}

/**
 * Lays a belt from `from` to `to`, or says it could not.
 *
 * `from` is the tile the shape first enters and `to` the tile it must arrive
 * at, both with the facing it has to have there — a stacker will only take a
 * shape that arrives pointing at it, so the ending facing is part of the goal
 * rather than something to be fixed up afterwards.
 *
 * The path claims its tiles as it is built, so routing one stream after another
 * naturally routes around the ones already laid.
 */
function search(
  occupancy: Occupancy,
  from: Endpoint,
  to: Endpoint,
  penalty: Penalty,
  limit: number,
  /** Tiles another stream has first claim on — its own ends, which it needs. */
  spoken: Set<string> = new Set(),
): { placements: BuildingPlacement[]; price: number } | null {
  const start: Node = { x: from.x, y: from.y, z: from.z, facing: from.facing }
  const goalKey = nodeKey({ x: to.x, y: to.y, z: to.z, facing: to.facing })

  const heuristic = (node: Node) =>
    Math.abs(node.x - to.x) + Math.abs(node.y - to.y) + Math.abs(node.z - to.z) * 2

  const cameFrom = new Map<string, { node: Node; move: Move }>()
  const cost = new Map<string, number>([[nodeKey(start), 0]])
  // the length cap counts tiles, not price: once contested ground is dear the
  // two are nothing like each other, and capping on price cuts off the search
  // exactly when it most needs to go the long way round
  const steps = new Map<string, number>([[nodeKey(start), 0]])
  const open = new Frontier()
  open.push(start, heuristic(start))
  const settled = new Set<string>()

  while (open.size > 0) {
    const node = open.pop()!
    const here = nodeKey(node)
    if (settled.has(here)) continue
    settled.add(here)

    if (here === goalKey) {
      const placements: BuildingPlacement[] = []
      let cursor = node
      let step = cameFrom.get(here)
      while (step) {
        placements.push({
          type: step.move.type,
          x: step.node.x,
          y: step.node.y,
          layer: step.node.z,
          rotation: step.move.rotation,
        })
        cursor = step.node
        step = cameFrom.get(nodeKey(cursor))
      }
      placements.reverse()
      return { placements, price: cost.get(here)! }
    }

    const spent = cost.get(here)!
    if ((steps.get(here) ?? 0) > limit) continue

    for (const move of movesFrom(node.facing)) {
      if (!fits(occupancy, move, node, spoken)) continue
      const [dx, dy] = STEP[move.leaves]
      const next: Node = {
        x: node.x + dx,
        y: node.y + dy,
        z: node.z + move.climb,
        facing: move.leaves,
      }
      if (!occupancy.inside(next.x, next.y, next.z)) continue
      // the goal tile is claimed by whatever is waiting there, so it is the one
      // tile the path is allowed to end on without being free
      const arriving = nodeKey(next) === goalKey
      if (!arriving && !occupancy.free(next.x, next.y, next.z)) continue
      if (!arriving && spoken.has(Occupancy.key(next.x, next.y, next.z))) continue

      // a lift is two tiles, and both of them cost whatever they cost
      let toll = 1
      for (const [ox, oy, oz] of tilesOf(move.type, move.rotation)) {
        toll += penalty(node.x + ox, node.y + oy, node.z + oz)
      }

      const key = nodeKey(next)
      const price = spent + toll
      if (price >= (cost.get(key) ?? Infinity)) continue
      cost.set(key, price)
      steps.set(key, (steps.get(here) ?? 0) + 1)
      cameFrom.set(key, { node, move })
      open.push(next, price + heuristic(next))
    }
  }

  return null
}

export function routeBelt(
  occupancy: Occupancy,
  from: Endpoint,
  to: Endpoint,
  options: { maxTiles?: number } = {},
): RoutedPath | null {
  const found = search(occupancy, from, to, FREE, options.maxTiles ?? 400)
  if (!found) return null
  for (const placement of found.placements) {
    const clash = occupancy.claim(placement)
    if (clash) return null
  }
  return { placements: found.placements, length: found.placements.length }
}

export interface Net {
  from: Endpoint
  to: Endpoint
  /** Named so a failure can say which stream it was. */
  label: string
}

export interface RoutedAll {
  paths: BuildingPlacement[][]
  /** How many times every path had to be torn up and laid again. */
  rounds: number
}

/**
 * Lays every stream at once, tearing up the ones that get in each other's way.
 *
 * Routing streams one after another is what fails on a crowded module, and it
 * fails in a way no ordering fixes: whichever goes first takes the tiles the
 * later ones needed, and it has no way of knowing. So instead every stream is
 * allowed to route through tiles another has already taken, and then the tiles
 * that ended up wanted by more than one get more expensive and *every* stream
 * is ripped up and laid again. Contested ground keeps getting dearer until the
 * streams that have somewhere else to go take it, which is the standard way
 * this is done for wiring chips and works for the same reason here.
 *
 * Hard obstacles — machines, combs, the edge ports — are never negotiable; only
 * the empty tiles are.
 */
export function routeAll(
  occupancy: Occupancy,
  nets: Net[],
  options: { rounds?: number; maxTiles?: number; memory?: number; crowd?: number } = {},
): RoutedAll | { stuck: string[] } {
  const rounds = options.rounds ?? 60
  const limit = options.maxTiles ?? 600
  const memory = options.memory ?? 8
  const crowd = options.crowd ?? 3

  // a stream's first tile carries its first belt, so no other stream may use
  // it. With the intakes packed four to a floor these tiles are exactly the
  // ones everyone else wants, and leaving them negotiable is what kept a
  // dozen of them contested however long the rounds ran.
  const ends = nets.map((net) => [
    Occupancy.key(net.from.x, net.from.y, net.from.z),
    Occupancy.key(net.to.x, net.to.y, net.to.z),
  ])
  const everyEnd = new Set(ends.flat())

  const usage = new Map<string, number>()
  const history = new Map<string, number>()
  const paths: (BuildingPlacement[] | null)[] = nets.map(() => null)

  const tilesUsed = (placements: BuildingPlacement[]) =>
    placements.flatMap((placement) =>
      tilesOf(placement.type, placement.rotation ?? 0).map(([dx, dy, dz]) =>
        Occupancy.key((placement.x ?? 0) + dx, (placement.y ?? 0) + dy, (placement.layer ?? 0) + dz),
      ),
    )

  const shift = (placements: BuildingPlacement[], by: number) => {
    for (const cell of tilesUsed(placements)) {
      usage.set(cell, (usage.get(cell) ?? 0) + by)
    }
  }

  for (let round = 1; round <= rounds; round++) {
    // contested ground starts out barely dearer than empty ground and ends up
    // far dearer, so early rounds look for the short way and later ones give in
    const penalty: Penalty = (x, y, z) => {
      const cell = Occupancy.key(x, y, z)
      return (history.get(cell) ?? 0) * memory + (usage.get(cell) ?? 0) * crowd
    }

    const stuck: string[] = []
    for (const [index, net] of nets.entries()) {
      const laid = paths[index]
      if (laid) shift(laid, -1)
      const mine = new Set(ends[index])
      const spoken = new Set([...everyEnd].filter((cell) => !mine.has(cell)))
      const found = search(occupancy, net.from, net.to, penalty, limit, spoken)
      if (!found) {
        paths[index] = null
        stuck.push(net.label)
        continue
      }
      paths[index] = found.placements
      shift(found.placements, 1)
    }
    if (stuck.length > 0) return { stuck }

    const contested = [...usage.entries()].filter(([, count]) => count > 1)
    if (contested.length === 0) {
      const settled = paths as BuildingPlacement[][]
      for (const path of settled) {
        for (const placement of path) {
          const clash = occupancy.claim(placement)
          if (clash) return { stuck: [`배선이 겹칩니다: ${clash}`] }
        }
      }
      return { paths: settled, rounds: round }
    }
    for (const [cell, count] of contested) history.set(cell, (history.get(cell) ?? 0) + count - 1)
  }

  const contested = [...usage.entries()].filter(([, count]) => count > 1).length
  return { stuck: [`${rounds}번 다시 깔았지만 ${contested}칸이 겹친 채 남았습니다`] }
}

/** Whether every belt port in a set of placements meets a real one opposite. */
export function wiringProblems(placements: BuildingPlacement[]): string[] {
  const at = new Map<string, BuildingPlacement>()
  for (const placement of placements) {
    for (const [dx, dy, dz] of tilesOf(placement.type, placement.rotation ?? 0)) {
      at.set(
        Occupancy.key((placement.x ?? 0) + dx, (placement.y ?? 0) + dy, (placement.layer ?? 0) + dz),
        placement,
      )
    }
  }

  const problems: string[] = []
  const where = (p: BuildingPlacement) => `${p.type}@(${p.x},${p.y},${p.layer ?? 0})`

  for (const placement of placements) {
    const ports = portsFor(placement.type)
    if (!ports) {
      problems.push(`${where(placement)} 의 포트를 모릅니다`)
      continue
    }
    for (const port of ports.inputs) {
      const [dx, dy, dz] = toWorld(port, placement.rotation ?? 0)
      const x = (placement.x ?? 0) + dx
      const y = (placement.y ?? 0) + dy
      const z = (placement.layer ?? 0) + dz
      const behind = at.get(Occupancy.key(x, y, z))
      if (!behind || behind === placement) continue
      const emits = (portsFor(behind.type)?.outputs ?? []).some((output) => {
        const [ox, oy, oz] = toWorld(output, behind.rotation ?? 0)
        return (
          (behind.x ?? 0) + ox === (placement.x ?? 0) &&
          (behind.y ?? 0) + oy === (placement.y ?? 0) &&
          (behind.layer ?? 0) + oz === z
        )
      })
      if (!emits) problems.push(`${where(placement)} 뒤의 ${behind.type}가 아무것도 내보내지 않습니다`)
    }

    // and the other way round: a belt pushing into a face that takes nothing
    // loses everything on it, which looks identical on the grid
    for (const port of ports.outputs) {
      const [dx, dy, dz] = toWorld(port, placement.rotation ?? 0)
      const x = (placement.x ?? 0) + dx
      const y = (placement.y ?? 0) + dy
      const z = (placement.layer ?? 0) + dz
      const ahead = at.get(Occupancy.key(x, y, z))
      if (!ahead || ahead === placement) continue
      const accepts = (portsFor(ahead.type)?.inputs ?? []).some((input) => {
        const [ix, iy, iz] = toWorld(input, ahead.rotation ?? 0)
        return (
          (ahead.x ?? 0) + ix === (placement.x ?? 0) &&
          (ahead.y ?? 0) + iy === (placement.y ?? 0) &&
          (ahead.layer ?? 0) + iz === z
        )
      })
      if (!accepts) problems.push(`${where(placement)} 앞의 ${ahead.type}가 받지 않습니다`)
    }
  }
  return problems
}
