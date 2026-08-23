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

const FOOTPRINT_CACHE = new Map<string, [number, number, number][]>()

/** Tiles a piece covers when placed, in world offsets from its own tile. */
export function tilesOf(type: string, rotation: number): [number, number, number][] {
  const key = `${type}@${rotation}`
  const known = FOOTPRINT_CACHE.get(key)
  if (known) return known
  const tiles = (FOOTPRINTS[type]?.tiles ?? [[0, 0, 0]]).map(
    (tile) => toWorld(tile as [number, number, number], rotation) as [number, number, number],
  )
  FOOTPRINT_CACHE.set(key, tiles)
  return tiles
}

/** The nine moves, worked out once per facing rather than on every step. */
const MOVES: Move[][] = [0, 1, 2, 3].map((facing) => movesFrom(facing as Facing))

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
  /** One byte a tile. Asked about several times per step of every search, so a
   * flat grid rather than a map of "x,y,z" strings — that lookup was most of
   * the time the router spent. */
  private readonly grid: Uint8Array
  private readonly names = new Map<number, string>()
  readonly width: number
  readonly height: number

  constructor(readonly bounds: Bounds) {
    this.width = bounds.maxX - bounds.minX + 1
    this.height = bounds.maxY - bounds.minY + 1
    this.grid = new Uint8Array(this.width * this.height * bounds.floors)
  }

  static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`
  }

  /** Where a tile sits in the flat grid, or -1 if it is off the platform. */
  cell(x: number, y: number, z: number): number {
    const { minX, minY, floors } = this.bounds
    const cx = x - minX
    const cy = y - minY
    if (cx < 0 || cx >= this.width || cy < 0 || cy >= this.height || z < 0 || z >= floors) return -1
    return (z * this.height + cy) * this.width + cx
  }

  inside(x: number, y: number, z: number): boolean {
    return this.cell(x, y, z) >= 0
  }

  free(x: number, y: number, z: number): boolean {
    const cell = this.cell(x, y, z)
    return cell >= 0 && this.grid[cell] === 0
  }

  freeCell(cell: number): boolean {
    return cell >= 0 && this.grid[cell] === 0
  }

  at(x: number, y: number, z: number): string | undefined {
    const cell = this.cell(x, y, z)
    return cell >= 0 ? this.names.get(cell) : undefined
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
    for (const cell of cells) {
      const at = this.cell(cell.x, cell.y, cell.z)
      this.grid[at] = 1
      this.names.set(at, placement.type)
    }
    return null
  }
}


/** A frontier that stays in order without re-sorting the whole thing. */
class Frontier {
  private nodes = new Int32Array(1024)
  private scores = new Float64Array(1024)
  private count = 0

  get size(): number {
    return this.count
  }

  clear(): void {
    this.count = 0
  }

  push(node: number, score: number): void {
    if (this.count === this.nodes.length) {
      const nodes = new Int32Array(this.count * 2)
      const scores = new Float64Array(this.count * 2)
      nodes.set(this.nodes)
      scores.set(this.scores)
      this.nodes = nodes
      this.scores = scores
    }
    let child = this.count++
    this.nodes[child] = node
    this.scores[child] = score
    while (child > 0) {
      const parent = (child - 1) >> 1
      if (this.scores[parent] <= this.scores[child]) break
      this.swap(parent, child)
      child = parent
    }
  }

  pop(): number {
    const top = this.nodes[0]
    this.count -= 1
    if (this.count > 0) {
      this.nodes[0] = this.nodes[this.count]
      this.scores[0] = this.scores[this.count]
      let parent = 0
      for (;;) {
        const left = parent * 2 + 1
        const right = left + 1
        let smallest = parent
        if (left < this.count && this.scores[left] < this.scores[smallest]) smallest = left
        if (right < this.count && this.scores[right] < this.scores[smallest]) smallest = right
        if (smallest === parent) break
        this.swap(parent, smallest)
        parent = smallest
      }
    }
    return top
  }

  private swap(a: number, b: number): void {
    const node = this.nodes[a]
    this.nodes[a] = this.nodes[b]
    this.nodes[b] = node
    const score = this.scores[a]
    this.scores[a] = this.scores[b]
    this.scores[b] = score
  }
}

/** What a tile costs to pass through, beyond the one tile of distance. */
export type Penalty = (cell: number) => number

const FREE: Penalty = () => 0

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
/**
 * A* over the grid, with nodes numbered rather than named.
 *
 * The search is run a couple of thousand times to lay one module, so the inner
 * loop is written for that: a node is `cell * 4 + facing`, every table is a flat
 * typed array, and nothing builds a string. The same search written against
 * maps of "x,y,z,facing" spent most of its time hashing.
 */
function search(
  occupancy: Occupancy,
  from: Endpoint,
  to: Endpoint,
  penalty: Penalty,
  limit: number,
  /** Tiles another stream has first claim on — its own ends, which it needs. */
  spoken: Uint8Array | null,
  scratch: Scratch,
): BuildingPlacement[] | null {
  const { bounds, width, height } = occupancy
  const startCell = occupancy.cell(from.x, from.y, from.z)
  const goalCell = occupancy.cell(to.x, to.y, to.z)
  if (startCell < 0 || goalCell < 0) return null

  const startNode = startCell * 4 + from.facing
  const goalNode = goalCell * 4 + to.facing

  const { cost, steps, cameNode, cameMove, stamp } = scratch
  const era = ++scratch.era

  const heuristic = (cell: number) => {
    const cx = (cell % width) + bounds.minX
    const cy = (Math.floor(cell / width) % height) + bounds.minY
    const cz = Math.floor(cell / (width * height))
    return Math.abs(cx - to.x) + Math.abs(cy - to.y) + Math.abs(cz - to.z) * 2
  }

  const open = scratch.open
  open.clear()
  cost[startNode] = 0
  steps[startNode] = 0
  cameNode[startNode] = -1
  stamp[startNode] = era
  open.push(startNode, heuristic(startCell))

  const settled = scratch.settled
  while (open.size > 0) {
    const node = open.pop()
    if (settled[node] === era) continue
    settled[node] = era

    if (node === goalNode) {
      const placements: BuildingPlacement[] = []
      let cursor = node
      while (cameNode[cursor] >= 0) {
        const previous = cameNode[cursor]
        const move = MOVES[previous & 3][cameMove[cursor]]
        const cell = previous >> 2
        placements.push({
          type: move.type,
          x: (cell % width) + bounds.minX,
          y: (Math.floor(cell / width) % height) + bounds.minY,
          layer: Math.floor(cell / (width * height)),
          rotation: move.rotation,
        })
        cursor = previous
      }
      placements.reverse()
      return placements
    }

    if (steps[node] > limit) continue
    const spent = cost[node]
    const cell = node >> 2
    const facing = node & 3
    const x = (cell % width) + bounds.minX
    const y = (Math.floor(cell / width) % height) + bounds.minY
    const z = Math.floor(cell / (width * height))

    const moves = MOVES[facing]
    for (let m = 0; m < moves.length; m++) {
      const move = moves[m]

      // the piece has to fit where it stands, lifts being two floors tall
      let toll = 1
      let blocked = false
      for (const [ox, oy, oz] of tilesOf(move.type, move.rotation)) {
        const covered = occupancy.cell(x + ox, y + oy, z + oz)
        if (!occupancy.freeCell(covered) || (spoken !== null && spoken[covered] === 1)) {
          blocked = true
          break
        }
        toll += penalty(covered)
      }
      if (blocked) continue

      const [dx, dy] = STEP[move.leaves]
      const nextCell = occupancy.cell(x + dx, y + dy, z + move.climb)
      if (nextCell < 0) continue
      const next = nextCell * 4 + move.leaves
      // the goal tile is claimed by whatever is waiting there, so it is the one
      // tile the path is allowed to end on without being free
      if (next !== goalNode) {
        if (!occupancy.freeCell(nextCell)) continue
        if (spoken !== null && spoken[nextCell] === 1) continue
      }

      const price = spent + toll
      if (stamp[next] === era && price >= cost[next]) continue
      stamp[next] = era
      cost[next] = price
      steps[next] = steps[node] + 1
      cameNode[next] = node
      cameMove[next] = m
      open.push(next, price + heuristic(nextCell))
    }
  }

  return null
}

/** Working tables, kept between searches so they are allocated once. */
interface Scratch {
  cost: Float64Array
  steps: Int32Array
  cameNode: Int32Array
  cameMove: Uint8Array
  stamp: Int32Array
  settled: Int32Array
  open: Frontier
  era: number
}

function scratchFor(occupancy: Occupancy): Scratch {
  const nodes = occupancy.width * occupancy.height * occupancy.bounds.floors * 4
  return {
    cost: new Float64Array(nodes),
    steps: new Int32Array(nodes),
    cameNode: new Int32Array(nodes),
    cameMove: new Uint8Array(nodes),
    stamp: new Int32Array(nodes),
    settled: new Int32Array(nodes),
    open: new Frontier(),
    era: 0,
  }
}

export function routeBelt(
  occupancy: Occupancy,
  from: Endpoint,
  to: Endpoint,
  options: { maxTiles?: number } = {},
): RoutedPath | null {
  const found = search(occupancy, from, to, FREE, options.maxTiles ?? 400, null, scratchFor(occupancy))
  if (!found) return null
  for (const placement of found) {
    const clash = occupancy.claim(placement)
    if (clash) return null
  }
  return { placements: found, length: found.length }
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
  const rounds = options.rounds ?? 400
  const limit = options.maxTiles ?? 600
  // how dearly a tile that keeps being fought over is remembered, against how
  // dearly sharing one right now is charged. Leaning on the second turns the
  // whole scheme back into routing one stream at a time; leaning on the first
  // is what makes streams give ground. Fitted on the stacker module, which is
  // the only thing here big enough to need any of this.
  const memory = options.memory ?? 4
  const crowd = options.crowd ?? 5

  // a stream's first tile carries its first belt, so no other stream may use
  // it. With the intakes packed four to a floor these tiles are exactly the
  // ones everyone else wants, and leaving them negotiable is what kept a
  // dozen of them contested however long the rounds ran.
  const ends = nets.map((net) => [
    occupancy.cell(net.from.x, net.from.y, net.from.z),
    occupancy.cell(net.to.x, net.to.y, net.to.z),
  ])
  const spokenFor = new Uint8Array(occupancy.width * occupancy.height * occupancy.bounds.floors)
  for (const cell of ends.flat()) if (cell >= 0) spokenFor[cell] = 1

  const tiles = occupancy.width * occupancy.height * occupancy.bounds.floors
  const usage = new Int32Array(tiles)
  const history = new Int32Array(tiles)
  const scratch = scratchFor(occupancy)
  const paths: (BuildingPlacement[] | null)[] = nets.map(() => null)

  const tilesUsed = (placements: BuildingPlacement[]) => {
    const cells: number[] = []
    for (const placement of placements) {
      for (const [dx, dy, dz] of tilesOf(placement.type, placement.rotation ?? 0)) {
        cells.push(
          occupancy.cell(
            (placement.x ?? 0) + dx,
            (placement.y ?? 0) + dy,
            (placement.layer ?? 0) + dz,
          ),
        )
      }
    }
    return cells
  }

  const shift = (placements: BuildingPlacement[], by: number) => {
    for (const cell of tilesUsed(placements)) if (cell >= 0) usage[cell] += by
  }

  for (let round = 1; round <= rounds; round++) {
    // contested ground starts out barely dearer than empty ground and ends up
    // far dearer, so early rounds look for the short way and later ones give in
    const penalty: Penalty = (cell) => history[cell] * memory + usage[cell] * crowd

    const stuck: string[] = []
    for (const [index, net] of nets.entries()) {
      const laid = paths[index]
      // a path nobody is fighting over is left where it is: tearing up all of
      // them every round is most of the work and none of the progress
      if (laid && !tilesUsed(laid).some((cell) => cell >= 0 && usage[cell] > 1)) continue
      if (laid) shift(laid, -1)
      // its own ends are its to use; every other net's are not
      for (const cell of ends[index]) if (cell >= 0) spokenFor[cell] = 0
      const found = search(occupancy, net.from, net.to, penalty, limit, spokenFor, scratch)
      for (const cell of ends[index]) if (cell >= 0) spokenFor[cell] = 1
      if (!found) {
        paths[index] = null
        stuck.push(net.label)
        continue
      }
      paths[index] = found
      shift(found, 1)
    }
    if (stuck.length > 0) return { stuck }

    const contested: number[] = []
    for (let cell = 0; cell < usage.length; cell++) if (usage[cell] > 1) contested.push(cell)
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
    for (const cell of contested) history[cell] += usage[cell] - 1
  }

  let contested = 0
  for (let cell = 0; cell < usage.length; cell++) if (usage[cell] > 1) contested += 1
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
