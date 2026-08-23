/**
 * Lays a whole plan out as one pasteable module.
 *
 * The stacker turns out to be a two-floor building whose shape inputs sit one
 * directly above the other (see `portData.ts`), and that single fact makes a
 * module fall out without any belt bending at all: to feed a stacker you run
 * one straight line on the floor below and another straight line on the floor
 * above, ending in the same column. Stack those recursively and a whole tree of
 * merges becomes a stack of parallel lines.
 *
 * Everything here is placed from measured ports. Machines whose geometry has
 * not been measured are refused, as is anything that would need a belt to turn
 * a corner — that is the next piece of routing, not a thing to guess at.
 */
import {
  encodeBuildingBlueprint,
  encodeIslandBlueprint,
  type BuildingPlacement,
} from './blueprint'
import { OPERATIONS, type OperationId } from './operations'
import type { BuildNode } from './plan'
import { portsFor } from './portData'
import { toWorld } from './ports'
import buildings from './buildings.json'

const FOOTPRINTS = (buildings as { buildingVariants: Record<string, { tiles: number[][] }> })
  .buildingVariants

/** Tiles a building covers, in its own frame. Painters and cutters are 1x2. */
function footprint(type: string): number[][] {
  return FOOTPRINTS[type]?.tiles ?? [[0, 0, 0]]
}

/** Internal variant ids for the carriers the module places. */
export const BUILDING_IDS = {
  belt: 'BeltDefaultForwardInternalVariant',
  extractor: 'ExtractorDefaultInternalVariant',
} as const

/** Which building performs each operation, where the geometry is measured. */
export const OPERATION_BUILDING: Record<OperationId, string> = {
  cut: 'CutterDefaultInternalVariant',
  hcut: 'CutterHalfInternalVariant',
  r90cw: 'RotatorOneQuadInternalVariant',
  r90ccw: 'RotatorOneQuadCCWInternalVariant',
  r180: 'RotatorHalfInternalVariant',
  swap: 'HalvesSwapperDefaultInternalVariant',
  stack: 'StackerStraightInternalVariant',
  paint: 'PainterDefaultInternalVariant',
  pin: 'PinPusherDefaultInternalVariant',
  crystal: 'CrystalGeneratorDefaultInternalVariant',
}

/** The game stacks machines three floors high, and the third needs unlocking. */
export const MAX_BUILDING_FLOORS = 3

export interface ModuleInput {
  /** Which resource an extractor has to supply here. */
  part: string
  /** Where the belt enters, in module coordinates. */
  at: { x: number; y: number; z: number }
}

export interface ModuleSuccess {
  ok: true
  code: string
  placements: BuildingPlacement[]
  /** Belt heads the player feeds, left to right. */
  inputs: ModuleInput[]
  /** Where the finished shape leaves. */
  output: { x: number; y: number; z: number }
  size: { width: number; height: number; floors: number }
  notes: string[]
}

export interface ModuleFailure {
  ok: false
  reason: string
  blockedBy?: OperationId
}

export type ModuleResult = ModuleSuccess | ModuleFailure

interface Cursor {
  placements: BuildingPlacement[]
  inputs: ModuleInput[]
  notes: Set<string>
  /** Rightmost column used so far, on any row or floor. */
  used: number
  /** Next free row for a line the player feeds. */
  nextRow: number
}

function isMerge(node: BuildNode): boolean {
  return node.op !== null && node.inputs.length > 1
}

/**
 * The run of one-in-one-out steps ending at `node`.
 *
 * Stops at an extractor or at a merge, and says which. Walking all the way back
 * and giving up on the first merge was the earlier mistake: it threw away
 * perfectly placeable lines just because something upstream had two inputs.
 */
function linearRun(node: BuildNode): { chain: BuildNode[]; from: BuildNode | null } {
  const chain: BuildNode[] = []
  let current: BuildNode = node
  while (true) {
    chain.unshift(current)
    if (current.op === null) return { chain, from: null }
    const next = current.inputs[0]
    if (isMerge(next)) return { chain, from: next }
    current = next
  }
}

function buildingFor(op: OperationId): string {
  return OPERATION_BUILDING[op]
}

/**
 * Belt pieces, by what they have to do. Rotation 0 means "takes from -X".
 *
 * A belt only accepts from the one face behind it, so joining two lines means
 * steering one into the other's row rather than merging them sideways.
 */
const BELT = {
  /** Straight along +X. */
  along: { type: BUILDING_IDS.belt, rotation: 0 },
  /** Straight along +Y, used to climb rows. */
  across: { type: BUILDING_IDS.belt, rotation: 1 },
  /** Takes from -X, turns to +Y. */
  toRows: { type: 'BeltDefaultLeftInternalVariantMirrored', rotation: 0 },
  /** Takes from -Y, turns to +X. */
  toLine: { type: 'BeltDefaultLeftInternalVariant', rotation: 1 },
} as const

/** The row every stacker sits on; feeds arrive from the rows below it. */
const SPINE_ROW = 0

/**
 * Rows are two apart, not one: a painter, cutter or crystal generator is two
 * tiles deep and spills into the row in front of it. Packing lines one apart
 * put a painter's second tile straight through its neighbour's belt.
 */
const ROW_PITCH = 2

function put(cursor: Cursor, type: string, x: number, y: number, z: number, rotation = 0): void {
  cursor.placements.push({ type, x, y, layer: z, rotation })
  cursor.used = Math.max(cursor.used, x)
}

/** Places one straight line on its own row, left to right. */
function placeLine(
  chain: BuildNode[],
  y: number,
  z: number,
  startX: number,
  cursor: Cursor,
  /** False when an upstream machine already delivers into this row. */
  needsFeeding: boolean,
): ModuleFailure | { ok: true; at: number } {
  const machines = chain.filter((node) => node.op !== null)

  for (const node of machines) {
    const ports = portsFor(buildingFor(node.op!))
    if (!ports || ports.partialBelts) {
      return {
        ok: false,
        reason: `${OPERATIONS[node.op!].labelKo}의 입출력 위치를 아직 측정하지 못했습니다`,
        blockedBy: node.op!,
      }
    }
    if (ports.outputs.length > 1) {
      return {
        ok: false,
        reason: `${OPERATIONS[node.op!].labelKo}는 출력이 2개라 분기 배선이 필요합니다 — 아직 지원하지 않습니다`,
        blockedBy: node.op!,
      }
    }
    if (ports.fluidUnknown) {
      cursor.notes.add('색칠기·결정체 생성기는 파이프로 물감을 직접 연결해야 합니다.')
    }
  }

  let x = startX
  if (needsFeeding) {
    cursor.inputs.push({ part: chain[0].sourcePart ?? '', at: { x, y, z } })
    put(cursor, BELT.along.type, x, y, z)
    x += 1
  }

  for (const node of machines) {
    put(cursor, buildingFor(node.op!), x, y, z)
    x += 1
    put(cursor, BELT.along.type, x, y, z)
    x += 1
  }

  return { ok: true, at: x - 1 }
}

/**
 * Steers a line's output to `(toX, SPINE_ROW)` on the same floor.
 *
 * Straight along its own row, one turn up into the column, straight across the
 * rows in between, then one turn back onto the spine. `toX` is always past
 * everything already placed, so the column it climbs is free by construction.
 */
function steer(
  from: { at: number; row: number },
  toX: number,
  z: number,
  cursor: Cursor,
): void {
  if (from.row === SPINE_ROW) {
    for (let x = from.at + 1; x <= toX; x++) put(cursor, BELT.along.type, x, from.row, z)
    return
  }

  for (let x = from.at + 1; x < toX; x++) put(cursor, BELT.along.type, x, from.row, z)
  put(cursor, BELT.toRows.type, toX, from.row, z, BELT.toRows.rotation)
  for (let y = from.row + 1; y < SPINE_ROW; y++) {
    put(cursor, BELT.across.type, toX, y, z, BELT.across.rotation)
  }
  put(cursor, BELT.toLine.type, toX, SPINE_ROW, z, BELT.toLine.rotation)
}

/**
 * Places whatever produces `node`'s shape, and says where it comes out.
 */
function place(
  node: BuildNode,
  row: number,
  z: number,
  cursor: Cursor,
): ModuleFailure | { ok: true; at: number; row: number; floor: number } {
  if (!isMerge(node)) {
    const { chain, from } = linearRun(node)

    if (from) {
      // this line continues straight out of a stacker, on its row and floor
      const upstream = place(from, row, z, cursor)
      if (!upstream.ok) return upstream
      const placed = placeLine(chain, upstream.row, upstream.floor, upstream.at + 1, cursor, false)
      return placed.ok === true
        ? { ok: true, at: placed.at, row: upstream.row, floor: upstream.floor }
        : placed
    }

    // a line the player feeds gets its own row so its entrance stays reachable
    const own = cursor.nextRow
    cursor.nextRow -= ROW_PITCH
    const placed = placeLine(chain, own, z, 0, cursor, true)
    return placed.ok === true ? { ok: true, at: placed.at, row: own, floor: z } : placed
  }

  if (node.op !== 'stack') {
    return {
      ok: false,
      reason: `${OPERATIONS[node.op!].labelKo}는 도형 2개를 나란히 다뤄서 아직 모듈로 배치할 수 없습니다`,
      blockedBy: node.op ?? undefined,
    }
  }

  if (z + 1 >= MAX_BUILDING_FLOORS) {
    return {
      ok: false,
      reason: `결합이 ${MAX_BUILDING_FLOORS}층보다 깊게 겹쳐서 기계 층이 모자랍니다`,
      blockedBy: 'stack',
    }
  }

  const [bottom, top] = node.inputs
  const lower = place(bottom, row, z, cursor)
  if (!lower.ok) return lower
  const upper = place(top, row, z + 1, cursor)
  if (!upper.ok) return upper

  // put the stacker two columns past everything, so the column it is fed from
  // is free on both floors and on every row the feeds have to climb
  const at = cursor.used + 2
  steer(lower, at - 1, z, cursor)
  steer(upper, at - 1, z + 1, cursor)

  put(cursor, OPERATION_BUILDING.stack, at, SPINE_ROW, z)
  return { ok: true, at, row: SPINE_ROW, floor: z }
}

/**
 * Every belt and machine must draw from either empty space or a real output.
 *
 * This is the check that was missing, and the game says so out loud: a belt
 * whose back is against a face that emits nothing is flagged in game and the
 * line never runs. It happens here when a line is started just past a stacker,
 * because a stacker's upper tile is an *input*, not an output — so the belt
 * behind it looks connected on the grid and is not.
 */
function unreachableFeeds(placements: BuildingPlacement[]): string[] {
  const at = new Map<string, BuildingPlacement>()
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`

  const spread = (placement: BuildingPlacement) =>
    portsFor(placement.type)!.inputs.map((port) => toWorld(port, placement.rotation ?? 0))

  for (const placement of placements) {
    for (const tile of footprint(placement.type)) {
      const [dx, dy, dz] = toWorld(tile as [number, number, number], placement.rotation ?? 0)
      const cell = key((placement.x ?? 0) + dx, (placement.y ?? 0) + dy, (placement.layer ?? 0) + dz)
      if (at.has(cell)) return [`두 건물이 같은 칸(${cell})을 차지합니다`]
      at.set(cell, placement)
    }
  }

  const problems: string[] = []
  for (const placement of placements) {
    for (const port of spread(placement)) {
      const x = (placement.x ?? 0) + port[0]
      const y = (placement.y ?? 0) + port[1]
      const z = (placement.layer ?? 0) + port[2]
      const behind = at.get(key(x, y, z))
      if (!behind) continue // open to the outside: the player feeds it

      const emits = portsFor(behind.type)!.outputs
        .map((output) => toWorld(output, behind.rotation ?? 0))
        .some(
          (output) =>
            (behind.x ?? 0) + output[0] === (placement.x ?? 0) &&
            (behind.y ?? 0) + output[1] === (placement.y ?? 0) &&
            (behind.layer ?? 0) + output[2] === z,
        )
      if (!emits) {
        problems.push(`${placement.type}@(${placement.x},${placement.y},${placement.layer ?? 0})`)
      }
    }
  }
  return problems
}

/**
 * Lays the plan out as one module: parallel lines on stacked floors, feeding
 * stackers, with the finished shape leaving on the ground floor.
 */
export function layoutModule(root: BuildNode): ModuleResult {
  const cursor: Cursor = {
    placements: [],
    inputs: [],
    notes: new Set(),
    used: -1,
    nextRow: SPINE_ROW,
  }
  const placed = place(root, SPINE_ROW, 0, cursor)
  if (!placed.ok) return placed

  // one belt after the last machine so the module has something to hook onto
  const outX = placed.at + 1
  put(cursor, BELT.along.type, outX, placed.row, placed.floor)

  const blocked = unreachableFeeds(cursor.placements)
  if (blocked.length > 0) {
    return {
      ok: false,
      reason: `배치가 어긋났습니다: ${blocked[0]}`,
    }
  }

  const floors = Math.max(...cursor.placements.map((p) => (p.layer ?? 0) + 1))
  const rows = cursor.placements.map((p) => p.y ?? 0)
  cursor.inputs.sort((a, b) => a.at.z - b.at.z || b.at.y - a.at.y)

  const notes = [
    '추출기는 포함하지 않았습니다. 자원 패치 위에 따로 놓고 각 줄 맨 앞 벨트에 연결하세요.',
    ...cursor.notes,
  ]
  if (floors > 2) {
    notes.push(`기계 층을 ${floors}개 씁니다 — 상점에서 「3번째 기계 층」을 사야 합니다.`)
  }

  return {
    ok: true,
    code: '',
    placements: cursor.placements,
    inputs: cursor.inputs,
    output: { x: outX, y: placed.row, z: placed.floor },
    size: {
      width: outX + 1,
      height: Math.max(...rows) - Math.min(...rows) + 1,
      floors,
    },
    notes,
  }
}

export async function generateModule(root: BuildNode, icon?: string): Promise<ModuleResult> {
  const layout = layoutModule(root)
  if (!layout.ok) return layout

  const code = await encodeBuildingBlueprint(
    layout.placements,
    icon ? [`shape:${icon}`, null, null, null] : [null, null, null, null],
  )
  return { ...layout, code }
}

/**
 * Sizing for a single-operation module: twelve lanes in, twelve out.
 *
 * This is the arithmetic the two reference modules follow (see
 * `moduleShape.test.ts`): enough machines to keep every lane full, and each
 * machine wants its own column, so whether a module fits on one platform chunk
 * is decided before a single belt is placed.
 */
export const MODULE_LANES_PER_FLOOR = 4
export const MODULE_FLOORS = 3
export const MODULE_LANES = MODULE_LANES_PER_FLOOR * MODULE_FLOORS

/** The platforms a module is laid on, as measured from the reference modules. */
export const PLATFORM_1X1 = 'Foundation_1x1'
export const PLATFORM_1X2 = 'Foundation_1x2'

/** A platform chunk is 20 tiles across, and the outer two are unusable. */
export const CHUNK_TILES = 20
export const CHUNK_MARGIN = 2
export const USABLE_COLUMNS = CHUNK_TILES - CHUNK_MARGIN * 2

export interface ModuleSizing {
  op: OperationId
  /** Machines needed per lane to keep it saturated. */
  perLane: number
  machines: number
  /** Columns one machine takes across the flow. Painters and cutters are two. */
  pitch: number
  /** Columns a floor's machines need if they all stand in one row. */
  columns: number
  /** Machine rows that takes, once a row is capped at a chunk's usable width. */
  machineRows: number
}

/**
 * How big a module for `op` has to be, at the default speed upgrade.
 *
 * `beltRate` and `machineRate` are both in shapes per minute, so this scales
 * with the speed tier the same way the throughput panel does.
 *
 * A machine's width is read from its footprint rather than assumed to be one
 * tile: the painter, cutter and crystal generator are 1x2, and their long side
 * lies *across* the flow, so a row of them needs two columns each.
 *
 * Note what `machineRows` is not: a platform size. A module never gets wider
 * than one chunk — both two-chunk modules a player built stay four lanes across
 * and grow *along* the flow instead (see `moduleShape.test.ts`), so machines
 * that will not fit in one row fold into further rows down the module.
 */
export function moduleSizing(op: OperationId, beltRate: number, machineRate: number): ModuleSizing {
  const perLane = Math.ceil(beltRate / machineRate)
  const pitch = machineSpan(OPERATION_BUILDING[op])?.pitch ?? 1
  const columns = MODULE_LANES_PER_FLOOR * perLane * pitch
  return {
    op,
    perLane,
    machines: perLane * MODULE_LANES,
    pitch,
    columns,
    machineRows: Math.ceil(columns / USABLE_COLUMNS),
  }
}

/** Where a module's belts meet the platform edge, in chunk tiles. */
export const MODULE_INTAKE_ROW = CHUNK_TILES - CHUNK_MARGIN - 1
export const MODULE_OUTLET_ROW = CHUNK_MARGIN
/** Lanes sit in the middle four columns, as both reference modules do. */
export const MODULE_FIRST_LANE = 8

/**
 * How far a belt launcher throws to reach a catcher, in tiles.
 *
 * Not a number anyone had to tell us: it follows from the margins. A launcher
 * stands `CHUNK_MARGIN` inside one chunk's edge and the catcher it feeds stands
 * `CHUNK_MARGIN` inside the next chunk's, with the boundary between them — so
 * modules laid end to end are exactly this far apart. The reference modules
 * then use the same distance for the hops *inside* themselves, which is what
 * makes it safe to use for routing rather than only at the edges.
 */
export const BELT_PORT_THROW = CHUNK_TILES - MODULE_INTAKE_ROW + MODULE_OUTLET_ROW

/**
 * A stacker module takes twenty-four lanes in, not twelve.
 *
 * The machine needs two shapes at once, so a module for it has a second intake:
 * twelve lanes down the usual edge and twelve more along the side, with the
 * twelve results leaving the far edge as always. Which is which is not a
 * coin toss — tracing every stacker in the reference module back to the edge it
 * draws from puts the two apart cleanly, and the test re-derives it.
 */
export const STACKER_INTAKE = {
  /** The shape that ends up underneath arrives at the usual intake edge. */
  bottomShape: 'intake',
  /** The shape laid on top arrives along the side. */
  topShape: 'side',
} as const

/** The column a stacker module's second intake runs down. */
export const MODULE_SIDE_INTAKE_COLUMN = CHUNK_TILES - CHUNK_MARGIN - 1

/** Everything flows one way down the platform, so everything faces -Y. */
const DOWNSTREAM = 3

/**
 * Belt and flow-control pieces named by what they do to a lane, not by the id
 * the game gives them. Every rotation here follows from the measured ports in
 * `portData.ts` — `toWorld(port, rotation)` is what decides them, and the
 * reference rotator module uses exactly these twelve.
 */
export const PIECE = {
  /** Straight, running -Y with the flow. */
  down: { type: BUILDING_IDS.belt, rotation: DOWNSTREAM },
  /** Straight, running -X. */
  alongLeft: { type: BUILDING_IDS.belt, rotation: 2 },
  /** Straight, running +X. */
  alongRight: { type: BUILDING_IDS.belt, rotation: 0 },

  /** Takes from above, leaves to -X. */
  downToLeft: { type: 'BeltDefaultLeftInternalVariant', rotation: 3 },
  /** Takes from above, leaves to +X. */
  downToRight: { type: 'BeltDefaultLeftInternalVariantMirrored', rotation: 3 },
  /** Takes from +X, leaves downwards. */
  leftToDown: { type: 'BeltDefaultLeftInternalVariantMirrored', rotation: 2 },
  /** Takes from -X, leaves downwards. */
  rightToDown: { type: 'BeltDefaultLeftInternalVariant', rotation: 0 },

  /** Head of a leftward comb: from above, out downwards and to -X. */
  splitHeadLeft: { type: 'Splitter1To2LInternalVariant', rotation: 3 },
  /** Head of a rightward comb: from above, out downwards and to +X. */
  splitHeadRight: { type: 'Splitter1To2LInternalVariantMirrored', rotation: 3 },
  /** Mid-comb going left: from +X, out downwards and on to -X. */
  splitOnLeft: { type: 'Splitter1To2LInternalVariantMirrored', rotation: 2 },
  /** Mid-comb going right: from -X, out downwards and on to +X. */
  splitOnRight: { type: 'Splitter1To2LInternalVariant', rotation: 0 },

  /** Mid-comb gathering rightwards: from above and -X, out to +X. */
  mergeOnRight: { type: 'Merger2To1LInternalVariantMirrored', rotation: 0 },
  /** Mid-comb gathering leftwards: from above and +X, out to -X. */
  mergeOnLeft: { type: 'Merger2To1LInternalVariant', rotation: 2 },
  /** End of a rightward gather: from above and -X, out downwards. */
  mergeEndRight: { type: 'Merger2To1LInternalVariant', rotation: 3 },
  /** End of a leftward gather: from above and +X, out downwards. */
  mergeEndLeft: { type: 'Merger2To1LInternalVariantMirrored', rotation: 3 },
} as const

export type Piece = { type: string; rotation: number }
export interface Tile {
  x: number
  y: number
  piece: Piece
}

/** Which way a lane spreads out from its own column. */
export type Side = -1 | 1

/**
 * How a machine sits in a lane module: how wide it is across the flow, and
 * where its fed tile is inside that width.
 *
 * Ports face along local X and the module runs machines at rotation 3, so a
 * building's local +Y — its long side, for the 1x2 machines — ends up across
 * the flow. Anything that leans out of its own row or spans two floors cannot
 * be packed into a machine row at all, and says so rather than being squeezed.
 */
function machineBox(
  type: string,
  rotation: number,
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  const world = footprint(type).map((tile) => toWorld(tile as [number, number, number], rotation))
  if (world.some(([, , dz]) => dz !== 0)) return null

  const dxs = world.map(([dx]) => dx)
  const dys = world.map(([, dy]) => dy)
  return {
    minX: Math.min(...dxs),
    maxX: Math.max(...dxs),
    minY: Math.min(...dys),
    maxY: Math.max(...dys),
  }
}

/** The same, for a machine standing in a comb: one row deep, `pitch` wide. */
function machineSpan(type: string): { pitch: number; anchorOffset: number } | null {
  const box = machineBox(type, DOWNSTREAM)
  if (!box || box.minY !== 0 || box.maxY !== 0) return null
  return { pitch: box.maxX - box.minX + 1, anchorOffset: -box.minX }
}

/**
 * A single-file run from `fromCol` down to `toCol`, turning once on `row`.
 *
 * The flow arrives in `fromCol` at `top` and has to leave `toCol` still heading
 * down at `bottom`. When the two columns are the same there is no turn at all
 * and `row` is ignored, which is what the two middle lanes of the reference
 * module do.
 */
function elbow(fromCol: number, toCol: number, row: number, top: number, bottom: number): Tile[] {
  const tiles: Tile[] = []
  if (fromCol === toCol) {
    for (let y = top; y >= bottom; y--) tiles.push({ x: fromCol, y, piece: PIECE.down })
    return tiles
  }

  const step: Side = toCol < fromCol ? -1 : 1
  for (let y = top; y > row; y--) tiles.push({ x: fromCol, y, piece: PIECE.down })
  tiles.push({ x: fromCol, y: row, piece: step < 0 ? PIECE.downToLeft : PIECE.downToRight })
  for (let x = fromCol + step; x !== toCol; x += step) {
    tiles.push({ x, y: row, piece: step < 0 ? PIECE.alongLeft : PIECE.alongRight })
  }
  tiles.push({ x: toCol, y: row, piece: step < 0 ? PIECE.leftToDown : PIECE.rightToDown })
  for (let y = row - 1; y >= bottom; y--) tiles.push({ x: toCol, y, piece: PIECE.down })
  return tiles
}

/** Lanes may need a row each to cross without colliding, but rarely do. */
const MAX_CROSSING_ROWS = MODULE_LANES_PER_FLOOR

/**
 * Fits every lane's elbow into as few rows as it takes.
 *
 * One row is enough whenever the sideways runs happen not to overlap — which is
 * the ordinary case, and is why the generated rotator module comes out tile for
 * tile like the one a player built. When two runs do want the same tile, one of
 * them drops to the row below and crosses underneath. Rather than reason about
 * which, every assignment is laid out and the first one without a collision
 * wins; with four lanes that is a few hundred grids at worst.
 */
function crossings(
  jobs: { from: number; to: number }[],
  top: number,
): { tiles: Tile[][]; rows: number } | null {
  for (let rows = 1; rows <= MAX_CROSSING_ROWS; rows++) {
    const bottom = top - rows + 1
    for (let choice = 0; choice < rows ** jobs.length; choice++) {
      const laid = jobs.map((job, lane) =>
        elbow(job.from, job.to, top - (Math.floor(choice / rows ** lane) % rows), top, bottom),
      )

      const taken = new Set<string>()
      const clear = laid.flat().every((tile) => {
        const cell = `${tile.x},${tile.y}`
        if (taken.has(cell)) return false
        taken.add(cell)
        return true
      })
      if (clear) return { tiles: laid, rows }
    }
  }
  return null
}

/**
 * One lane's machines, spread across their columns and gathered back up.
 *
 * `anchors` are the fed columns, left to right; `side` says which way the comb
 * runs from the lane's entry column. Splitting with a chain of 1-to-2s rather
 * than a tree costs nothing: the belt leaving each splitter only carries what
 * the machines further along still need, and `perLane` is chosen so that is
 * `(perLane - 1) x machineRate`, always under a belt's own rate.
 */
export function comb(anchors: number[], side: Side, row: number, gather: boolean): Tile[] {
  const order = side < 0 ? [...anchors].reverse() : anchors
  if (order.length === 1) return [{ x: order[0], y: row, piece: PIECE.down }]

  const tiles: Tile[] = []
  const [head, ...rest] = order
  const end = rest[rest.length - 1]

  for (const [index, column] of order.entries()) {
    const piece = gather
      ? column === head
        ? side < 0
          ? PIECE.mergeEndRight
          : PIECE.mergeEndLeft
        : column === end
          ? side < 0
            ? PIECE.downToRight
            : PIECE.downToLeft
          : side < 0
            ? PIECE.mergeOnRight
            : PIECE.mergeOnLeft
      : column === head
        ? side < 0
          ? PIECE.splitHeadLeft
          : PIECE.splitHeadRight
        : column === end
          ? side < 0
            ? PIECE.leftToDown
            : PIECE.rightToDown
          : side < 0
            ? PIECE.splitOnLeft
            : PIECE.splitOnRight
    tiles.push({ x: column, y: row, piece })

    // machines wider than one tile leave gaps between fed columns
    const next = order[index + 1]
    if (next === undefined) continue
    const step: Side = next < column ? -1 : 1
    const filler = gather === (step < 0) ? PIECE.alongRight : PIECE.alongLeft
    for (let x = column + step; x !== next; x += step) tiles.push({ x, y: row, piece: filler })
  }
  return tiles
}

export interface LaneModule {
  ok: true
  op: OperationId
  placements: BuildingPlacement[]
  /** The platform the module lays down, as both reference modules do. */
  platform: string
  lanes: number
  /** Machines per lane — enough of them to keep a lane saturated. */
  perLane: number
  machines: number
  /** Columns the machines occupy, leftmost and rightmost. */
  span: { from: number; to: number }
  /** How the machines are arranged. */
  shape: LaneShape
  notes: string[]
  /** What this particular module needs the player to know before pasting it. */
  warnings: string[]
}

export type LaneModuleResult = LaneModule | ModuleFailure

/** How a lane's machines are arranged. See each builder for what that means. */
export type LaneShape = 'comb' | 'ladder'

interface Built {
  placements: BuildingPlacement[]
  span: { from: number; to: number }
  shape: LaneShape
}

export const CATCHER = { type: 'BeltPortReceiverInternalVariant', rotation: DOWNSTREAM }
export const LAUNCHER = { type: 'BeltPortSenderInternalVariant', rotation: DOWNSTREAM }

/** Lays every floor of a module out the same way, as both reference modules do. */
function onEveryFloor(perFloor: (put: (piece: Piece, x: number, y: number) => void) => void) {
  const placements: BuildingPlacement[] = []
  for (let floor = 0; floor < MODULE_FLOORS; floor++) {
    perFloor((piece, x, y) =>
      placements.push({ type: piece.type, x, y, layer: floor, rotation: piece.rotation }),
    )
  }
  return placements
}

/**
 * Machines side by side in one row, fed by a comb of splitters.
 *
 * This is the module a player built, reproduced: catchers, a row of steering,
 * the splitter comb, the machines, the merger comb, a row of gathering, then a
 * straight run to the launchers. It only works while a floor's machines fit
 * across one chunk, which is what `machineRows` measures.
 */
function buildComb(
  op: OperationId,
  perLane: number,
  geometry: { pitch: number; anchorOffset: number },
): Built | ModuleFailure {
  const type = OPERATION_BUILDING[op]
  const label = OPERATIONS[op].labelKo
  const columns = MODULE_LANES_PER_FLOOR * perLane * geometry.pitch
  const blockStart = MODULE_FIRST_LANE + (MODULE_LANES_PER_FLOOR - columns) / 2

  // each lane owns a contiguous block of machines and enters it from the side
  // nearest its own column, so the sideways runs never have to cross the module
  const lanes = Array.from({ length: MODULE_LANES_PER_FLOOR }, (_, lane) => {
    const side: Side = lane < MODULE_LANES_PER_FLOOR / 2 ? -1 : 1
    const anchors = Array.from(
      { length: perLane },
      (_, index) => blockStart + (lane * perLane + index) * geometry.pitch + geometry.anchorOffset,
    )
    return {
      column: MODULE_FIRST_LANE + lane,
      anchors,
      side,
      entry: side < 0 ? anchors[anchors.length - 1] : anchors[0],
    }
  })

  const steer = crossings(
    lanes.map((lane) => ({ from: lane.column, to: lane.entry })),
    MODULE_INTAKE_ROW - 1,
  )
  if (!steer) return { ok: false, reason: `${label} 레인들이 서로 교차해서 배선을 찾지 못했습니다` }

  const splitRow = MODULE_INTAKE_ROW - 1 - steer.rows
  const machineRow = splitRow - 1
  const mergeRow = machineRow - 1

  const gather = crossings(
    lanes.map((lane) => ({ from: lane.entry, to: lane.column })),
    mergeRow - 1,
  )
  if (!gather) return { ok: false, reason: `${label} 레인들이 서로 교차해서 배선을 찾지 못했습니다` }

  const runRow = mergeRow - 1 - gather.rows
  if (runRow < MODULE_OUTLET_ROW) {
    return {
      ok: false,
      reason: `${label} 모듈이 플랫폼 한 칸보다 깊어집니다 — 세로로 ${MODULE_INTAKE_ROW - runRow + 1}칸이 필요합니다`,
      blockedBy: op,
    }
  }

  const placements = onEveryFloor((put) => {
    for (const [index, lane] of lanes.entries()) {
      put(CATCHER, lane.column, MODULE_INTAKE_ROW)
      for (const tile of steer.tiles[index]) put(tile.piece, tile.x, tile.y)
      for (const tile of comb(lane.anchors, lane.side, splitRow, false)) {
        put(tile.piece, tile.x, tile.y)
      }
      for (const anchor of lane.anchors) put({ type, rotation: DOWNSTREAM }, anchor, machineRow)
      for (const tile of comb(lane.anchors, lane.side, mergeRow, true)) {
        put(tile.piece, tile.x, tile.y)
      }
      for (const tile of gather.tiles[index]) put(tile.piece, tile.x, tile.y)
      for (let y = runRow; y > MODULE_OUTLET_ROW; y--) put(PIECE.down, lane.column, y)
      put(LAUNCHER, lane.column, MODULE_OUTLET_ROW)
    }
  })

  return { placements, span: { from: blockStart, to: blockStart + columns - 1 }, shape: 'comb' }
}

/** Raw trunk, machine, results trunk — the three columns a ladder lane needs. */
const LADDER_BAND = 3

/** The mirrored twin of a machine, where the game has one and it is measured. */
function mirroredOf(type: string): string {
  const twin = `${type}Mirrored`
  return FOOTPRINTS[twin] && portsFor(twin) ? twin : type
}

/** Which building faces which way on each side of the module. */
function ladderMachine(base: string, side: Side): { type: string; rotation: number } {
  return side < 0 ? { type: mirroredOf(base), rotation: 2 } : { type: base, rotation: 0 }
}

/**
 * A ladder: one machine per rung, standing sideways beside the lane.
 *
 * Turning the machines through ninety degrees is what makes a painter module
 * fit at all. Across the flow a painter is two tiles wide and sixteen of them
 * cannot share a chunk's sixteen columns; along the flow it is one tile wide,
 * and the module has rows to spare. So the lane runs down a trunk of its own,
 * a splitter drops one share into a machine at each rung, and the results come
 * back down a second trunk on the machine's far side:
 *
 *   raw ─┬─ machine ─→ done          three columns per lane, twelve in all
 *        ↓             ↓
 *   raw ─┬─ machine ─→ done
 *        ↓             ↓
 *
 * Neither trunk can overflow. The raw one carries at most a full belt, and the
 * results one ends up carrying `perLane x machineRate`, which is what a belt
 * holds by the definition of `perLane`.
 */
function buildLadder(op: OperationId, perLane: number, needsPipe: boolean): Built | ModuleFailure {
  const base = OPERATION_BUILDING[op]
  const label = OPERATIONS[op].labelKo

  // one column wide is the whole point; anything fatter has no room for the
  // trunks to sit against, and its ports would land inside its own footprint
  let minY = 0
  let maxY = 0
  for (const side of [-1, 1] as Side[]) {
    const machine = ladderMachine(base, side)
    const box = machineBox(machine.type, machine.rotation)
    if (!box) {
      return {
        ok: false,
        reason: `${label}는 기계 층 2개를 차지해서 3층짜리 모듈에 층마다 넣을 수 없습니다`,
        blockedBy: op,
      }
    }
    if (box.minX !== 0 || box.maxX !== 0) {
      return {
        ok: false,
        reason: `${label}는 흐름을 따라서도 ${box.maxX - box.minX + 1}칸이라 레인 옆에 세울 수 없습니다`,
        blockedBy: op,
      }
    }
    minY = Math.min(minY, box.minY)
    maxY = Math.max(maxY, box.maxY)
  }

  const columns = MODULE_LANES_PER_FLOOR * LADDER_BAND
  const blockStart = MODULE_FIRST_LANE + (MODULE_LANES_PER_FLOOR - columns) / 2
  if (columns > USABLE_COLUMNS) {
    return {
      ok: false,
      reason: `${label} 레인 하나에 ${LADDER_BAND}칸씩 ${columns}칸이 필요한데 쓸 수 있는 건 ${USABLE_COLUMNS}칸입니다`,
      blockedBy: op,
    }
  }

  // machines face outward, so each lane's trunks sit between its own machines
  // and the module's edge and no branch ever crosses another lane
  const lanes = Array.from({ length: MODULE_LANES_PER_FLOOR }, (_, lane) => {
    const side: Side = lane < MODULE_LANES_PER_FLOOR / 2 ? -1 : 1
    const band = blockStart + lane * LADDER_BAND
    return {
      column: MODULE_FIRST_LANE + lane,
      side,
      machine: band + 1,
      raw: side < 0 ? band + 2 : band,
      done: side < 0 ? band : band + 2,
    }
  })

  const steer = crossings(
    lanes.map((lane) => ({ from: lane.column, to: lane.raw })),
    MODULE_INTAKE_ROW - 1,
  )
  if (!steer) return { ok: false, reason: `${label} 레인들이 서로 교차해서 배선을 찾지 못했습니다` }

  // a rung is as tall as the machine, plus a spare row when paint has to reach
  // it: pack them tight and there is no face left for the player to pipe into
  const height = maxY - minY + 1
  const rungPitch = height + (needsPipe ? 1 : 0)
  const firstRung = MODULE_INTAKE_ROW - 1 - steer.rows - maxY
  const rungs = Array.from({ length: perLane }, (_, index) => firstRung - index * rungPitch)
  const lastRung = rungs[rungs.length - 1]

  const gather = crossings(
    lanes.map((lane) => ({ from: lane.done, to: lane.column })),
    lastRung + minY - 1,
  )
  if (!gather) return { ok: false, reason: `${label} 레인들이 서로 교차해서 배선을 찾지 못했습니다` }

  const runRow = lastRung + minY - 1 - gather.rows
  if (runRow < MODULE_OUTLET_ROW) {
    return {
      ok: false,
      reason: `${label} ${perLane}대를 세로로 늘어놓으면 플랫폼 한 칸보다 깊어집니다 — 세로로 ${MODULE_INTAKE_ROW - runRow + 1}칸이 필요합니다`,
      blockedBy: op,
    }
  }

  const rungRows = new Set(rungs)
  const placements = onEveryFloor((put) => {
    for (const [index, lane] of lanes.entries()) {
      const machine = ladderMachine(base, lane.side)
      put(CATCHER, lane.column, MODULE_INTAKE_ROW)
      for (const tile of steer.tiles[index]) put(tile.piece, tile.x, tile.y)

      // the raw trunk runs from the steering down to the last rung, shedding
      // one share on the way; the last rung takes everything that is left
      for (let y = firstRung + maxY; y >= lastRung; y--) {
        if (!rungRows.has(y)) {
          put(PIECE.down, lane.raw, y)
          continue
        }
        const last = y === lastRung
        put(
          lane.side < 0
            ? last
              ? PIECE.downToLeft
              : PIECE.splitHeadLeft
            : last
              ? PIECE.downToRight
              : PIECE.splitHeadRight,
          lane.raw,
          y,
        )
      }

      for (const row of rungs) put(machine, lane.machine, row)

      // and the results trunk collects them on the way back down
      for (let y = firstRung; y >= lastRung + minY; y--) {
        if (!rungRows.has(y)) {
          put(PIECE.down, lane.done, y)
          continue
        }
        const first = y === firstRung
        put(
          lane.side < 0
            ? first
              ? PIECE.leftToDown
              : PIECE.mergeEndLeft
            : first
              ? PIECE.rightToDown
              : PIECE.mergeEndRight,
          lane.done,
          y,
        )
      }

      for (const tile of gather.tiles[index]) put(tile.piece, tile.x, tile.y)
      for (let y = runRow; y > MODULE_OUTLET_ROW; y--) put(PIECE.down, lane.column, y)
      put(LAUNCHER, lane.column, MODULE_OUTLET_ROW)
    }
  })

  return { placements, span: { from: blockStart, to: blockStart + columns - 1 }, shape: 'ladder' }
}

/**
 * One operation, twelve lanes, in at the top edge and out at the bottom.
 *
 * Two arrangements, tried in that order. A comb stands the machines side by
 * side in one row and is what a player's rotator module does, so it is the one
 * to reproduce where it fits. When a floor's machines are too wide for a chunk
 * the lane becomes a ladder instead and grows along the flow, which is how both
 * two-chunk reference modules gain room.
 */
export function layoutLaneModule(op: OperationId, perLane: number): LaneModuleResult {
  const type = OPERATION_BUILDING[op]
  const ports = portsFor(type)
  const label = OPERATIONS[op].labelKo

  if (!ports || ports.partialBelts) {
    return { ok: false, reason: `${label}의 입출력 위치를 아직 측정하지 못했습니다`, blockedBy: op }
  }
  if (op === 'stack') {
    // the shape of this one is settled — see STACKER_INTAKE — but laying it out
    // is a different job from a single-file lane and is not written yet
    return {
      ok: false,
      reason: `${label} 모듈은 벨트가 ${MODULE_LANES * 2}줄 들어가서 한 줄짜리 레인과 구조가 다릅니다 — 「작업 모듈」 탭에서 만들 수 있습니다`,
      blockedBy: op,
    }
  }
  if (ports.inputs.length !== 1 || ports.outputs.length !== 1) {
    return {
      ok: false,
      reason:
        op === 'cut'
          ? `${label} 모듈은 벨트가 ${MODULE_LANES}줄 들어와 ${MODULE_LANES * 2}줄로 나갑니다 — 배선은 맞는데 게임에서 가장 긴 플랫폼(4칸)보다 길어져서 아직 못 냅니다`
          : `${label}는 벨트가 ${ports.inputs.length}줄 들어가고 ${ports.outputs.length}줄 나와서 한 줄짜리 레인에 넣을 수 없습니다`,
      blockedBy: op,
    }
  }

  const geometry = machineSpan(type)
  const fitsOneRow =
    geometry !== null && MODULE_LANES_PER_FLOOR * perLane * geometry.pitch <= USABLE_COLUMNS

  const built =
    fitsOneRow && geometry !== null
      ? buildComb(op, perLane, geometry)
      : buildLadder(op, perLane, ports.fluidUnknown === true)
  if ('ok' in built) return built

  const machines = perLane * MODULE_LANES
  const warnings: string[] = []
  if (built.shape === 'ladder') {
    warnings.push(`${label}가 넓어서 레인 옆으로 눕혀 세로로 늘어놓았습니다.`)
  }
  if (ports.fluidUnknown) {
    warnings.push('물감은 직접 연결하세요 — 기계 사이를 한 칸씩 띄워 뒀습니다.')
  }

  return {
    ok: true,
    op,
    placements: built.placements,
    platform: PLATFORM_1X1,
    lanes: MODULE_LANES,
    perLane,
    machines,
    span: built.span,
    shape: built.shape,
    notes: [
      `벨트 ${MODULE_LANES}줄이 위쪽 가장자리로 들어와 아래쪽으로 나갑니다 (층마다 ${MODULE_LANES_PER_FLOOR}줄).`,
      `레인마다 ${label} ${perLane}대씩 ${machines}대가 들어갑니다 — 벨트가 가득 찬 채로 나갑니다.`,
      ...warnings,
    ],
    warnings,
  }
}

/**
 * A module is the platform as well as what stands on it.
 *
 * Emitting only the buildings looked right on screen and was useless in the
 * game: there was nothing under them, so the player had to lay a foundation by
 * hand and paste onto it. Both reference modules are platform blueprints, and
 * so is this.
 */
export async function generateLaneModule(
  op: OperationId,
  perLane: number,
  icon?: string,
): Promise<{ layout: LaneModuleResult; code: string | null }> {
  const layout = layoutLaneModule(op, perLane)
  if (!layout.ok) return { layout, code: null }

  const code = await encodeIslandBlueprint(
    [{ type: layout.platform, buildings: layout.placements }],
    icon ? [`shape:${icon}`, null, null, null] : [null, null, null, null],
  )
  return { layout, code }
}
