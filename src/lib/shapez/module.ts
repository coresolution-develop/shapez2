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
  /** Next free column on each floor. */
  free: Record<number, number>
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
 * Places one straight line on floor `z`, starting wherever that floor is free.
 *
 * Returns the column its shape comes out at. Laying out left to right with a
 * per-floor cursor is what keeps a nested stacker from being overrun: a stacker
 * claims its column on two floors at once, so both cursors move past it and the
 * next line up cannot be placed on top of it.
 */
function placeLine(
  chain: BuildNode[],
  y: number,
  z: number,
  cursor: Cursor,
  /** False when an upstream machine already delivers into this floor. */
  needsFeeding: boolean,
): ModuleFailure | { ok: true; at: number } {
  const machines = chain.filter((node) => node.op !== null)

  for (const node of machines) {
    const building = buildingFor(node.op!)
    const ports = portsFor(building)
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

  let x = cursor.free[z] ?? 0

  if (needsFeeding) {
    cursor.inputs.push({ part: chain[0].sourcePart ?? '', at: { x, y, z } })
    cursor.placements.push({ type: BUILDING_IDS.belt, x, y, layer: z })
    x += 1
  }

  for (const node of machines) {
    cursor.placements.push({ type: buildingFor(node.op!), x, y, layer: z })
    x += 1
    cursor.placements.push({ type: BUILDING_IDS.belt, x, y, layer: z })
    x += 1
  }

  cursor.free[z] = x
  return { ok: true, at: x - 1 }
}

/** Fills floor `z` with belt from wherever it is free up to `upto`. */
function runBeltTo(upto: number, y: number, z: number, cursor: Cursor): void {
  for (let x = cursor.free[z] ?? 0; x <= upto; x++) {
    cursor.placements.push({ type: BUILDING_IDS.belt, x, y, layer: z })
  }
  cursor.free[z] = Math.max(cursor.free[z] ?? 0, upto + 1)
}

/**
 * Places whatever produces `node`'s shape, and says which column and floor it
 * comes out at.
 */
function place(
  node: BuildNode,
  y: number,
  z: number,
  cursor: Cursor,
): ModuleFailure | { ok: true; at: number; floor: number } {
  if (!isMerge(node)) {
    const { chain, from } = linearRun(node)

    // a line may continue straight out of a merge, on that merge's own floor
    let floor = z
    if (from) {
      const upstream = place(from, y, z, cursor)
      if (!upstream.ok) return upstream
      floor = upstream.floor
    }

    const placed = placeLine(chain, y, floor, cursor, from === null)
    return placed.ok === true ? { ok: true, at: placed.at, floor } : placed
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
  const lower = place(bottom, y, z, cursor)
  if (!lower.ok) return lower
  const upper = place(top, y, z + 1, cursor)
  if (!upper.ok) return upper

  // the stacker takes one column on both floors, so both feeds belt across to
  // the column just before it
  const at = Math.max(cursor.free[z] ?? 0, cursor.free[z + 1] ?? 0)
  runBeltTo(at - 1, y, z, cursor)
  runBeltTo(at - 1, y, z + 1, cursor)

  cursor.placements.push({ type: OPERATION_BUILDING.stack, x: at, y, layer: z })
  cursor.free[z] = at + 1
  cursor.free[z + 1] = at + 1
  return { ok: true, at, floor: z }
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

  // everything here sits at rotation 0; a building covers its own floor plus any
  // floor one of its ports reaches, which is how the stacker claims two
  for (const placement of placements) {
    const ports = portsFor(placement.type)!
    const base = placement.layer ?? 0
    const floors = new Set([base, ...ports.inputs.map((port) => base + port[2])])
    for (const floor of floors) at.set(key(placement.x ?? 0, placement.y ?? 0, floor), placement)
  }

  const problems: string[] = []
  for (const placement of placements) {
    const ports = portsFor(placement.type)!
    for (const input of ports.inputs) {
      const x = (placement.x ?? 0) + input[0]
      const y = (placement.y ?? 0) + input[1]
      const z = (placement.layer ?? 0) + input[2]
      const behind = at.get(key(x, y, z))
      if (!behind) continue // open to the outside: the player feeds it

      const emits = portsFor(behind.type)!.outputs.some(
        (output) =>
          (behind.x ?? 0) + output[0] === (placement.x ?? 0) &&
          (behind.y ?? 0) + output[1] === (placement.y ?? 0) &&
          (behind.layer ?? 0) + output[2] === (placement.layer ?? 0) + input[2],
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
  const cursor: Cursor = { placements: [], inputs: [], notes: new Set(), free: {} }
  const placed = place(root, 0, 0, cursor)
  if (!placed.ok) return placed

  // one belt after the last machine so the module has something to hook onto
  const outX = placed.at + 1
  cursor.placements.push({ type: BUILDING_IDS.belt, x: outX, y: 0, layer: placed.floor })

  const blocked = unreachableFeeds(cursor.placements)
  if (blocked.length > 0) {
    return {
      ok: false,
      reason:
        '결합이 여러 겹이라 어떤 줄의 입구가 다른 기계 뒤에 막힙니다 — 벨트를 꺾어 돌아가야 하는데 아직 지원하지 않습니다',
    }
  }

  // a line the player feeds has to be reachable from outside the module
  const buried = cursor.inputs.filter((input) => input.at.x !== 0)
  if (buried.length > 0) {
    return {
      ok: false,
      reason: '어떤 줄의 입구가 모듈 안쪽에 갇혀서 벨트를 넣을 수 없습니다 — 벨트 꺾기가 필요합니다',
    }
  }

  const floors = Math.max(...cursor.placements.map((p) => (p.layer ?? 0) + 1))
  cursor.inputs.sort((a, b) => a.at.z - b.at.z || a.at.x - b.at.x)

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
    output: { x: outX, y: 0, z: placed.floor },
    size: { width: outX + 1, height: 1, floors },
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
