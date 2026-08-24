/**
 * A whole plan on one platform, with the belts searched for rather than placed.
 *
 * The first version of this wrote the belts down: every line of one-in-one-out
 * machines got its own row, and the rows were joined at the end by a fixed
 * pattern of corners. That worked for 63% of the shapes the solver can make,
 * and the other 37% failed for one reason above all others — a cutter has two
 * outputs going to two different places, and a written-down pattern has nowhere
 * to put the second one.
 *
 * The router that was built for the lane modules does not care. So the machines
 * are placed by depth, a splitter is dropped in wherever one shape is wanted in
 * two places, and every belt between them is found rather than composed. What
 * that buys, measured over the game's own shapes, is in `shapeModule.test.ts`.
 *
 * Three things had to be got right before any of that was worth having, and
 * two of them produced blueprints that looked perfect:
 *
 *   - The router lays no piece on the tile it is aiming for, because everywhere
 *     else it is used that tile already holds the comb it delivers into. Aiming
 *     at a machine's port — an empty tile — left every machine in the plan fed
 *     by a gap. It now aims at the machine's own tile, so the last belt lands on
 *     the port. A test counts the bare ports rather than trusting this.
 *   - A tap is only an endpoint until the router reaches it, so a splitter or a
 *     trash placed afterwards could take the tile a belt was going to start on.
 *     A cutter fanning out both halves does this to itself. Endpoints are held.
 *   - Which way a shape crosses a port is read off the port, not assumed to be
 *     +X. The stacker's second input is a floor up and needs it.
 *
 * One thing here is still a guess and says so: which of a cutter's two outputs
 * carries which half has never been measured, so a shape whose plan uses both
 * halves may come out with them the wrong way round. The module warns, and
 * measuring it in game would settle it for good.
 */
import { encodeBuildingBlueprint, type BuildingPlacement } from './blueprint'
import { OPERATION_BUILDING } from './module'
import { OPERATIONS, type OperationId } from './operations'
import { walk, type BuildNode } from './plan'
import { portsFor } from './portData'
import { toWorld } from './ports'
import { Occupancy, routeAll, tilesOf, type Bounds, type Endpoint, type Facing, type Net } from './route'

/** Shapes travel left to right, which puts the plan in reading order. */
const FLOW: Facing = 0
const FLOORS = 3

/** Columns between one depth of the plan and the next. */
const COLUMN_PITCH = 7
/** Rows between machines standing in the same column. */
const ROW_PITCH = 5
const MARGIN = 2

/** A shape wanted in more than this many places is not worth a splitter tree. */
const MAX_FANOUT = 4

export interface ShapeModuleInput {
  part: string
  at: { x: number; y: number; z: number }
}

export interface ShapeModuleSuccess {
  ok: true
  placements: BuildingPlacement[]
  inputs: ShapeModuleInput[]
  output: { x: number; y: number; z: number }
  size: { width: number; height: number; floors: number }
  machines: number
  notes: string[]
}

export interface ShapeModuleFailure {
  ok: false
  reason: string
  blockedBy?: OperationId
}

export type ShapeModuleResult = ShapeModuleSuccess | ShapeModuleFailure

/** One physical machine, and the plan nodes it produces. */
interface Machine {
  key: string
  op: OperationId
  type: string
  /** Plan nodes this machine makes, keyed by which of its outputs they are. */
  outputs: Map<number, BuildNode>
  inputs: BuildNode[]
  depth: number
  x: number
  y: number
}

/** Which machine makes a given plan node, and out of which port. */
interface Source {
  machine: Machine
  port: number
}

const machineKey = (node: BuildNode) =>
  `${node.op}|${node.color ?? ''}|${node.inputs.map((input) => input.id).join(',')}`

/**
 * Every machine the plan needs, once each.
 *
 * A cutter feeding two different steps is one machine, not two — the plan says
 * so by giving both steps the same inputs and a different `outputIndex`, and
 * building it twice would double the ore for nothing.
 */
function collectMachines(root: BuildNode): { machines: Machine[]; sourceOf: Map<string, Source> } {
  const machines = new Map<string, Machine>()
  const sourceOf = new Map<string, Source>()

  walk(root, (node) => {
    if (node.op === null) return
    const key = machineKey(node)
    const machine = machines.get(key) ?? {
      key,
      op: node.op,
      type: OPERATION_BUILDING[node.op],
      outputs: new Map<number, BuildNode>(),
      inputs: node.inputs,
      depth: 0,
      x: 0,
      y: 0,
    }
    machine.outputs.set(node.outputIndex, node)
    machines.set(key, machine)
    sourceOf.set(node.id, { machine, port: node.outputIndex })
  })

  const ordered = [...machines.values()]
  // depth is the longest way back to an extractor, which is what puts a
  // machine to the right of everything it draws from
  const depthOf = (machine: Machine, seen = new Set<string>()): number => {
    if (seen.has(machine.key)) return 0
    seen.add(machine.key)
    return (
      1 +
      Math.max(
        0,
        ...machine.inputs.map((input) => {
          const from = sourceOf.get(input.id)
          return from ? depthOf(from.machine, seen) : 0
        }),
      )
    )
  }
  for (const machine of ordered) machine.depth = depthOf(machine)
  ordered.sort((a, b) => a.depth - b.depth)
  return { machines: ordered, sourceOf }
}

/** Where a building's port lands, in world tiles. */
function portAt(
  placement: { x: number; y: number; z: number; type: string; rotation: number },
  port: readonly [number, number, number],
): { x: number; y: number; z: number } {
  const [dx, dy, dz] = toWorld(port, placement.rotation)
  return { x: placement.x + dx, y: placement.y + dy, z: placement.z + dz }
}

/**
 * Which way a shape crosses a port, and which of the building's own tiles it
 * crosses into.
 *
 * A port sits on an empty tile touching the building, so it names a face: an
 * input at (-1,0,0) is the −X face, and a shape reaches it travelling +X. That
 * one step is the whole of it, and taking it from the measurement rather than
 * assuming +X is what lets a port on any other face work — the stacker's second
 * input, a floor up, is the one that already needs it.
 */
function crossing(port: readonly [number, number, number], rotation: number) {
  const [dx, dy, dz] = toWorld(port, rotation)
  const step = (n: number) => (n > 0 ? -1 : n < 0 ? 1 : 0)
  return {
    /** Travelling this way carries a shape from the port into the building. */
    inward: (dx !== 0 ? (dx > 0 ? 2 : 0) : dy > 0 ? 3 : 1) as Facing,
    /** And this way carries it out. */
    outward: (dx !== 0 ? (dx > 0 ? 0 : 2) : dy > 0 ? 1 : 3) as Facing,
    /** The building's own tile behind the port, which is where a feed heads. */
    behind: { x: dx + step(dx), y: dy + step(dy), z: dz },
  }
}

export function layoutShapeModule(
  root: BuildNode,
  columnPitch = COLUMN_PITCH,
  rowPitch = ROW_PITCH,
  tune: { memory?: number; crowd?: number; rounds?: number } = {},
): ShapeModuleResult {
  const { machines, sourceOf } = collectMachines(root)
  if (machines.length === 0) {
    return { ok: false, reason: '이 도형은 채굴기에서 바로 나옵니다 — 가공할 게 없습니다' }
  }

  for (const machine of machines) {
    const ports = portsFor(machine.type)
    if (!ports || ports.partialBelts) {
      return {
        ok: false,
        reason: `${OPERATIONS[machine.op].labelKo}의 입출력 위치를 아직 측정하지 못했습니다`,
        blockedBy: machine.op,
      }
    }
  }

  // ── where everything stands ──────────────────────────────────────────────
  const byDepth = new Map<number, Machine[]>()
  for (const machine of machines) {
    byDepth.set(machine.depth, [...(byDepth.get(machine.depth) ?? []), machine])
  }
  const deepest = Math.max(...machines.map((m) => m.depth))
  const widest = Math.max(...[...byDepth.values()].map((list) => list.length))

  for (const [depth, list] of byDepth) {
    for (const [index, machine] of list.entries()) {
      machine.x = MARGIN + depth * columnPitch
      machine.y = MARGIN + index * rowPitch
    }
  }

  const bounds: Bounds = {
    minX: 0,
    maxX: MARGIN + deepest * columnPitch + columnPitch,
    minY: 0,
    maxY:
      MARGIN +
      Math.max(
        widest * rowPitch,
        2 *
          machines.reduce(
            (sum, machine) => sum + machine.inputs.filter((input) => input.op === null).length,
            0,
          ),
      ) +
      MARGIN,
    floors: FLOORS,
  }

  const occupancy = new Occupancy(bounds)
  const placements: BuildingPlacement[] = []

  /**
   * Tiles a belt is going to start on, held against everything placed after.
   *
   * A tap is only an endpoint until the router reaches it, so nothing stops a
   * later splitter or trash from being put there — and then the belt has
   * nowhere to begin and the whole plan fails for want of one tile. A cutter
   * with both halves fanned out does exactly this to itself: the second half's
   * splitter wants the tile the first half's splitter sends its copy to.
   */
  const spokenFor = new Set<string>()
  const vacant = (x: number, y: number, z: number) =>
    occupancy.free(x, y, z) && !spokenFor.has(`${x},${y},${z}`)
  const reserve = (end: { x: number; y: number; z: number }) =>
    spokenFor.add(`${end.x},${end.y},${end.z}`)

  const put = (placement: BuildingPlacement, what: string): string | null => {
    for (const [dx, dy, dz] of tilesOf(placement.type, placement.rotation ?? 0)) {
      const key = `${(placement.x ?? 0) + dx},${(placement.y ?? 0) + dy},${(placement.layer ?? 0) + dz}`
      if (spokenFor.has(key)) return `${what}이(가) 벨트 자리와 겹칩니다: ${key}`
    }
    const clash = occupancy.claim(placement)
    if (clash) return `${what}이(가) 겹칩니다: ${clash}`
    placements.push(placement)
    return null
  }

  for (const machine of machines) {
    const clash = put(
      { type: machine.type, x: machine.x, y: machine.y, layer: 0, rotation: FLOW },
      OPERATIONS[machine.op].labelKo,
    )
    if (clash) return { ok: false, reason: clash }
  }

  // ── who feeds whom ───────────────────────────────────────────────────────
  const wanted = new Map<string, number>()
  for (const machine of machines) {
    for (const input of machine.inputs) {
      if (input.op === null) continue
      wanted.set(input.id, (wanted.get(input.id) ?? 0) + 1)
    }
  }

  const nets: Net[] = []
  const inputs: ShapeModuleInput[] = []
  let feedRow = MARGIN
  const notes = new Set<string>()

  /** Every place a node's shape can be drawn from, one per consumer. */
  const taps = new Map<string, Endpoint[]>()

  for (const machine of machines) {
    const ports = portsFor(machine.type)!
    if (ports.fluidUnknown) notes.add('색칠기·결정체 생성기는 파이프로 물감을 직접 연결해야 합니다.')

    // a machine whose second output goes nowhere jams, and a belt laid across
    // it looks connected and is not — which is exactly how the first version of
    // this quietly produced 25 broken blueprints
    for (const [index, port] of ports.outputs.entries()) {
      if (machine.outputs.has(index)) continue
      const spare = portAt(
        { x: machine.x, y: machine.y, z: 0, type: machine.type, rotation: FLOW },
        port,
      )
      const clash = put(
        { type: 'TrashDefaultInternalVariant', x: spare.x, y: spare.y, layer: spare.z, rotation: FLOW },
        '쓰레기통',
      )
      if (clash) return { ok: false, reason: clash }
      notes.add('안 쓰는 절반은 쓰레기통으로 버립니다 — 안 그러면 절단기가 멈춥니다.')
    }

    for (const [port, node] of machine.outputs) {
      const leaving = ports.outputs[Math.min(port, ports.outputs.length - 1)]
      const stand = { x: machine.x, y: machine.y, z: 0, type: machine.type, rotation: FLOW }
      const at = portAt(stand, leaving)
      const away = crossing(leaving, FLOW).outward
      const needed = wanted.get(node.id) ?? 0
      if (needed <= 1) {
        reserve(at)
        taps.set(node.id, [{ ...at, facing: away }])
        continue
      }
      if (needed > MAX_FANOUT) {
        return {
          ok: false,
          reason: `한 도형을 ${needed}군데로 나눠야 해서 아직 배치할 수 없습니다`,
          blockedBy: machine.op,
        }
      }

      // A shape wanted in two places gets splitters, ideally standing on the
      // tile the machine delivers into so it is fed with no belt between. That
      // is not always allowed: the splitter's second way out is the tile beside
      // it, and on a cutter whose other half is being thrown away that tile is
      // the trash. So the chain starts at the first run of columns where every
      // splitter has somewhere to send both halves, and the machine reaches it
      // by belt like anything else.
      const SPLITTER = 'Splitter1To2LInternalVariant'
      const splitter = portsFor(SPLITTER)!
      const side = crossing(splitter.outputs[0], FLOW)
      const ahead = crossing(splitter.outputs[1], FLOW)
      /** Room for the whole chain: every splitter, and both ways out of each. */
      const room = (x: number) => {
        for (let k = 0; k < needed - 1; k++) {
          const stands = { x: x + k, y: at.y, z: at.z, type: SPLITTER, rotation: FLOW }
          const out = portAt(stands, splitter.outputs[0])
          if (!vacant(stands.x, stands.y, stands.z)) return false
          if (!vacant(out.x, out.y, out.z)) return false
        }
        return vacant(x + needed - 1, at.y, at.z)
      }

      let start = at.x
      while (start < at.x + columnPitch && !room(start)) start++
      if (!room(start)) {
        return {
          ok: false,
          reason: `${OPERATIONS[machine.op].labelKo} 뒤에 분배기를 놓을 자리가 없습니다`,
          blockedBy: machine.op,
        }
      }

      const ends: Endpoint[] = []
      let head = { x: start, y: at.y, z: at.z }
      for (let made = 0; made < needed - 1; made++) {
        const clash = put(
          { type: SPLITTER, x: head.x, y: head.y, layer: head.z, rotation: FLOW },
          '분배기',
        )
        if (clash) return { ok: false, reason: clash }
        const out = portAt({ ...head, type: SPLITTER, rotation: FLOW }, splitter.outputs[0])
        ends.push({ ...out, facing: side.outward })
        head = { x: head.x + 1, y: head.y, z: head.z }
      }
      ends.push({ ...head, facing: ahead.outward })
      for (const end of ends) reserve(end)
      if (start > at.x) {
        // the machine now has to reach its own splitter
        nets.push({
          from: { ...at, facing: away },
          to: { x: start, y: at.y, z: at.z, facing: FLOW },
          label: `${OPERATIONS[machine.op].labelKo} 나눔`,
        })
      }
      taps.set(node.id, ends)
    }
  }

  for (const machine of machines) {
    const ports = portsFor(machine.type)!
    for (const [slot, input] of machine.inputs.entries()) {
      const port = ports.inputs[Math.min(slot, ports.inputs.length - 1)]
      const cross = crossing(port, FLOW)
      // aimed at the machine's own tile, not at the port in front of it. The
      // router lays no piece on the tile it is aiming for — everywhere else
      // that tile already holds the comb it delivers into — so aiming at the
      // port left the port bare and the last belt one tile short of the
      // machine, which is a blueprint that looks joined up and is not
      const arrive: Endpoint = {
        x: machine.x + cross.behind.x,
        y: machine.y + cross.behind.y,
        z: cross.behind.z,
        facing: cross.inward,
      }

      if (input.op === null) {
        // the player feeds this one, so it needs a head of its own at the left
        // edge — sharing a row with another feed leaves the second nowhere to
        // start, which is what stopped a good thirty of these
        const head: Endpoint = { x: bounds.minX, y: feedRow, z: 0, facing: FLOW }
        feedRow += 2
        inputs.push({ part: input.sourcePart ?? '', at: { x: head.x, y: head.y, z: head.z } })
        nets.push({ from: head, to: arrive, label: `${input.sourcePart} 공급` })
        continue
      }

      const from = taps.get(input.id)?.shift()
      if (!from) return { ok: false, reason: '도형을 어디서 받을지 정하지 못했습니다' }
      nets.push({ from, to: arrive, label: `${OPERATIONS[machine.op].labelKo} 공급` })
    }
  }

  // ── the finished shape leaves on the right ───────────────────────────────
  const last = sourceOf.get(root.id)
  if (!last) return { ok: false, reason: '마지막 단계를 찾지 못했습니다' }
  const finishedAt = taps.get(root.id)?.shift()
  if (!finishedAt) return { ok: false, reason: '완성된 도형의 출구를 찾지 못했습니다' }
  // the way out gets a belt of its own for the same reason a machine's input
  // does: the router aims at a tile and does not build on it
  const exit: Endpoint = { x: bounds.maxX, y: finishedAt.y, z: finishedAt.z, facing: FLOW }
  const blockedExit = put(
    { type: 'BeltDefaultForwardInternalVariant', x: exit.x, y: exit.y, layer: exit.z, rotation: FLOW },
    '출구',
  )
  if (blockedExit) return { ok: false, reason: blockedExit }
  nets.push({ from: finishedAt, to: exit, label: '완성된 도형' })

  // Two hundred rather than the four hundred the other modules negotiate over,
  // because it was measured and more does not help: of the plans that still
  // fail, not one is rescued by four hundred rounds, by twelve hundred, or by
  // any weighting of the two costs. That is what says they are not crowded but
  // genuinely stuck — two streams wanting one tile with nowhere else to go —
  // and rounds nobody is rescued by are only rounds spent failing slowly.
  const wiring = routeAll(occupancy, nets, { rounds: 200, ...tune })
  if ('stuck' in wiring) {
    return { ok: false, reason: `${wiring.stuck.slice(0, 2).join(', ')}를 잇지 못했습니다` }
  }
  placements.push(...wiring.paths.flat())

  const usesCutter = machines.some((machine) => machine.outputs.size > 1)
  const list = [
    '추출기는 포함하지 않았습니다. 자원 패치 위에 따로 놓고 왼쪽 벨트에 연결하세요.',
    ...notes,
  ]
  if (usesCutter) {
    list.push(
      '절단기의 두 절반이 어느 쪽으로 나가는지는 아직 재지 못했습니다 — 결과가 다르면 두 출구를 바꿔 보세요.',
    )
  }

  const cells = placements.flatMap((placement) =>
    tilesOf(placement.type, placement.rotation ?? 0).map(([dx, dy]) => ({
      x: (placement.x ?? 0) + dx,
      y: (placement.y ?? 0) + dy,
    })),
  )
  return {
    ok: true,
    placements,
    inputs,
    output: exit,
    size: {
      width: Math.max(...cells.map((c) => c.x)) + 1,
      height: Math.max(...cells.map((c) => c.y)) + 1,
      floors: Math.max(...placements.map((p) => (p.layer ?? 0) + 1)),
    },
    machines: machines.length,
    notes: list,
  }
}

export async function generateShapeModule(
  root: BuildNode,
  icon?: string,
): Promise<{ layout: ShapeModuleResult; code: string | null }> {
  const layout = layoutShapeModule(root)
  if (!layout.ok) return { layout, code: null }

  const code = await encodeBuildingBlueprint(
    layout.placements,
    icon ? [`shape:${icon}`, null, null, null] : [null, null, null, null],
  )
  return { layout, code }
}
