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
import { encodeBuildingBlueprint, type BuildingPlacement } from './blueprint'
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

/** A platform chunk is 20 tiles across, and the outer two are unusable. */
export const CHUNK_TILES = 20
export const CHUNK_MARGIN = 2
export const USABLE_COLUMNS = CHUNK_TILES - CHUNK_MARGIN * 2

export interface ModuleSizing {
  op: OperationId
  /** Machines needed per lane to keep it saturated. */
  perLane: number
  machines: number
  /** Columns the machine row needs, one per machine on a floor. */
  columns: number
  /** How many platform chunks wide that is. */
  chunks: number
}

/**
 * How big a module for `op` has to be, at the default speed upgrade.
 *
 * `beltRate` and `machineRate` are both in shapes per minute, so this scales
 * with the speed tier the same way the throughput panel does.
 */
export function moduleSizing(op: OperationId, beltRate: number, machineRate: number): ModuleSizing {
  const perLane = Math.ceil(beltRate / machineRate)
  const columns = MODULE_LANES_PER_FLOOR * perLane
  return {
    op,
    perLane,
    machines: perLane * MODULE_LANES,
    columns,
    chunks: Math.ceil(columns / USABLE_COLUMNS),
  }
}
