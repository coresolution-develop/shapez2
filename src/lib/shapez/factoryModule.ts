/**
 * One belt's worth of a whole plan, with as many machines as that takes.
 *
 * The shape module puts one machine at each step, which makes twenty shapes a
 * minute. A belt carries a hundred and twenty. So a step whose machine runs at
 * thirty needs four of them, and the four have to be fed off one belt and
 * collected back onto one — which is the whole of what this adds.
 *
 * It is one lane on purpose. A twelve-lane factory is twelve of these standing
 * side by side and *nothing crosses between them*: every lane carries its own
 * belt from raw material to finished shape. That keeps the problem the size of
 * a lane rather than the size of a factory, which is what makes the belts
 * findable at all — pooling the machines would put a factory's whole traffic
 * through one router.
 *
 * Feeding is splitting and collecting is merging, always that way round: every
 * machine in the game runs slower than a belt carries, so a step always has
 * more machines than belts feeding it. The two combs are the same shape — a
 * merger is the mirror of a splitter, one tile with a way in from behind and
 * one from the side — so both are built by the same code run in opposite
 * directions, and which way to turn each piece is read off the measurement.
 *
 * ## What it cannot do yet
 *
 * A machine whose plan uses *both* of its outputs — a cutter keeping both
 * halves — needs two combs, and both of its output ports are in the same column
 * one row apart. Each comb needs an unbroken run up that column, through the
 * rows the other comb's mouths are on, so the two cannot both have it. Turning
 * the machines sideways only transposes the problem: the ports become adjacent
 * columns of one row and the combs collide along the row instead. It wants a
 * different idea, not a different axis, so those plans are turned down by name
 * rather than laid out wrong. That is a third of them.
 */
import { encodeBuildingBlueprint, type BuildingPlacement } from './blueprint'
import { factoryPlan, type FactoryPlan, type FactoryStep } from './factoryPlan'
import { OPERATIONS } from './operations'
import { portsFor } from './portData'
import { crossing, portAt, type Crossing } from './portGeometry'
import type { BuildNode } from './plan'
import {
  Occupancy,
  routeAll,
  tilesOf,
  type Bounds,
  type Endpoint,
  type Facing,
  type Net,
} from './route'
import type { SpeedTier, StackerVariant } from './throughput'

/** Shapes travel left to right, which puts the plan in reading order. */
const FLOW: Facing = 0
/** A feed comb climbs beside its machines; a collecting comb comes back down. */
const UP: Facing = 1
const DOWN: Facing = 3
const FLOORS = 3
const MARGIN = 2

const SPLITTER = 'Splitter1To2LInternalVariant'
const MERGER = 'Merger2To1LInternalVariant'
const BELT = 'BeltDefaultForwardInternalVariant'
const TURN = 'BeltDefaultLeftInternalVariant'
const TURN_MIRRORED = 'BeltDefaultLeftInternalVariantMirrored'
const TRASH = 'TrashDefaultInternalVariant'

const clockwise = (facing: Facing): Facing => (((facing + 3) % 4) as Facing)

export interface FactoryModuleSuccess {
  ok: true
  placements: BuildingPlacement[]
  plan: FactoryPlan
  inputs: { part: string; at: { x: number; y: number; z: number } }[]
  output: { x: number; y: number; z: number }
  size: { width: number; height: number; floors: number }
  machines: number
  notes: string[]
}

export interface FactoryModuleFailure {
  ok: false
  reason: string
}

export type FactoryModuleResult = FactoryModuleSuccess | FactoryModuleFailure

interface Block {
  step: FactoryStep
  stand: { x: number; y: number }[]
  /**
   * Where each feed has to be delivered, one per mouth.
   *
   * Keyed by which mouth and not by which shape: a stacker laying a shape on
   * itself is fed the same thing twice, and keying by shape had the second
   * feed overwrite the first so both nets aimed at one mouth and fought over
   * the tile in front of it.
   */
  intake: Map<number, Endpoint>
  /** Where each result can be drawn from — one endpoint per consumer. */
  supply: Map<string, Endpoint[]>
}

export function layoutFactoryModule(
  root: BuildNode,
  options: {
    tier: SpeedTier
    stackerVariant: StackerVariant
    lanes?: number
    columnPitch?: number
    rowGap?: number
    rounds?: number
  },
): FactoryModuleResult {
  const plan = factoryPlan(root, {
    lanes: options.lanes ?? 1,
    tier: options.tier,
    stackerVariant: options.stackerVariant,
    tilesOf: (type) => tilesOf(type, 0).length,
  })
  if (plan.steps.length === 0) {
    return { ok: false, reason: '이 도형은 채굴기에서 바로 나옵니다 — 가공할 게 없습니다' }
  }

  for (const step of plan.steps) {
    const ports = portsFor(step.type)
    if (!ports || ports.partialBelts) {
      return {
        ok: false,
        reason: `${OPERATIONS[step.op].labelKo}의 입출력 위치를 아직 측정하지 못했습니다`,
      }
    }
    if (step.outputs.size > 1) {
      return {
        ok: false,
        reason: `${OPERATIONS[step.op].labelKo}는 두 결과를 다 쓰는데, 그 두 빗이 같은 열을 놓고 다퉈서 아직 배치할 수 없습니다`,
      }
    }
    if (step.inputs.length > 1) {
      const used = step.inputs.map((_, slot) => ports.inputs[Math.min(slot, ports.inputs.length - 1)])
      const seen = new Set(used.map((port) => `${port[0]},${port[2]}`))
      if (seen.size < used.length) {
        return {
          ok: false,
          reason: `${OPERATIONS[step.op].labelKo}는 두 입구가 같은 열에 있어서 아직 배치할 수 없습니다`,
        }
      }
    }
  }

  const splitter = portsFor(SPLITTER)
  const merger = portsFor(MERGER)
  if (!splitter || !merger) return { ok: false, reason: '분배기·병합기 포트를 모릅니다' }

  // The combs stand beside the machines rather than in front of them, so the
  // pieces are turned until the side port faces the machines. Which rotation
  // that is falls out of the measurement instead of being written down.
  const splitRotation = turnedSo((rotation) => crossing(SPLITTER, splitter.outputs[0], rotation)?.outward === FLOW)
  const mergeRotation = turnedSo((rotation) => crossing(MERGER, merger.inputs[1], rotation)?.inward === FLOW)
  if (splitRotation === null || mergeRotation === null) {
    return { ok: false, reason: '분배기·병합기를 세울 방향을 찾지 못했습니다' }
  }

  const columnPitch = options.columnPitch ?? 6
  const rowGap = options.rowGap ?? 2

  // ── where everything stands ──────────────────────────────────────────────
  const byDepth = new Map<number, FactoryStep[]>()
  for (const step of plan.steps) {
    byDepth.set(step.depth, [...(byDepth.get(step.depth) ?? []), step])
  }
  const deepest = Math.max(...plan.steps.map((step) => step.depth))

  const blocks = new Map<string, Block>()
  let tallest = MARGIN
  for (const [, steps] of byDepth) {
    let row = MARGIN + 1
    for (const step of steps) {
      const span = tilesOf(step.type, FLOW).map(([, dy]) => dy)
      const height = Math.max(...span) - Math.min(...span) + 1
      const lift = -Math.min(...span)
      const stand = Array.from({ length: step.machines }, (_, index) => ({
        x: MARGIN + step.depth * columnPitch,
        y: row + index * height + lift,
      }))
      blocks.set(step.node.id, { step, stand, intake: new Map(), supply: new Map() })
      row += step.machines * height + rowGap
    }
    tallest = Math.max(tallest, row)
  }

  const bounds: Bounds = {
    minX: 0,
    maxX: MARGIN + deepest * columnPitch + columnPitch,
    minY: 0,
    maxY: tallest + MARGIN,
    floors: FLOORS,
  }

  const occupancy = new Occupancy(bounds)
  const placements: BuildingPlacement[] = []
  const spokenFor = new Set<string>()
  const reserve = (at: { x: number; y: number; z: number }) =>
    spokenFor.add(`${at.x},${at.y},${at.z}`)

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

  for (const block of blocks.values()) {
    for (const at of block.stand) {
      const clash = put(
        { type: block.step.type, x: at.x, y: at.y, layer: 0, rotation: FLOW },
        OPERATIONS[block.step.op].labelKo,
      )
      if (clash) return { ok: false, reason: clash }
    }
  }

  // ── the combs that feed and collect each step ────────────────────────────
  const notes = new Set<string>()

  /** How many places want each result, which decides how it is collected. */
  const takers = new Map<string, number>()
  for (const step of plan.steps) {
    for (const feed of step.inputs) {
      if (!feed.from) continue
      takers.set(feed.node.id, (takers.get(feed.node.id) ?? 0) + 1)
    }
  }
  // the finished shape leaves the module, which is a taker like any other
  takers.set(plan.steps[plan.steps.length - 1].node.id, (takers.get(plan.steps[plan.steps.length - 1].node.id) ?? 0) + 1)

  for (const block of blocks.values()) {
    const { step, stand } = block
    const ports = portsFor(step.type)!
    if (ports.fluidUnknown) {
      notes.add(
        `${OPERATIONS[step.op].labelKo}에 물감 파이프를 직접 연결하세요 — 파이프를 대는 면은 아직 못 쟀습니다.`,
      )
    } else if (ports.fluid && ports.fluid.length > 0) {
      notes.add(
        `${OPERATIONS[step.op].labelKo}에 물감 파이프를 직접 연결하세요 — 벨트가 닿지 않는 쪽 칸이 파이프 자리입니다(측정값).`,
      )
    }

    for (const [slot] of step.inputs.entries()) {
      const port = ports.inputs[Math.min(slot, ports.inputs.length - 1)]
      const cross = crossing(step.type, port, FLOW)
      if (!cross) {
        return { ok: false, reason: `${OPERATIONS[step.op].labelKo}의 입력 포트가 기계에 닿지 않습니다` }
      }
      const built = comb({
        mouths: stand.map((at) => portAt({ ...at, z: 0, type: step.type, rotation: FLOW }, port)),
        stand,
        cross,
        way: 'feed',
        piece: SPLITTER,
        rotation: splitRotation,
        put,
        reserve,
        label: `${OPERATIONS[step.op].labelKo} 공급 빗`,
      })
      if (typeof built === 'string') return { ok: false, reason: built }
      block.intake.set(slot, built)
    }

    for (const [index, out] of step.outputs) {
      const port = ports.outputs[Math.min(index, ports.outputs.length - 1)]
      const cross = crossing(step.type, port, FLOW)
      if (!cross) {
        return { ok: false, reason: `${OPERATIONS[step.op].labelKo}의 출력 포트가 기계에 닿지 않습니다` }
      }

      // A result wanted in two places is collected twice rather than once and
      // then split: the machines are shared out and each share gets its own
      // comb. One comb with two nets drawing on it had both of them start on
      // the same tile, which no amount of negotiating gets past.
      const wanted = Math.max(1, takers.get(out.node.id) ?? 1)
      if (wanted > stand.length) {
        return {
          ok: false,
          reason: `${OPERATIONS[step.op].labelKo} 한 대를 ${wanted}군데로 나눠야 해서 아직 배치할 수 없습니다`,
        }
      }
      const ends: Endpoint[] = []
      let taken = 0
      for (let share = 0; share < wanted; share++) {
        const size = Math.floor((stand.length - taken) / (wanted - share))
        const mine = stand.slice(taken, taken + size)
        taken += size
        const built = comb({
          mouths: mine.map((at) => portAt({ ...at, z: 0, type: step.type, rotation: FLOW }, port)),
          stand: mine,
          cross,
          way: 'collect',
          piece: MERGER,
          rotation: mergeRotation,
          put,
          reserve,
          label: `${OPERATIONS[step.op].labelKo} 수거 빗`,
        })
        if (typeof built === 'string') return { ok: false, reason: built }
        ends.push(built)
      }
      block.supply.set(out.node.id, ends)
    }

    // anything the plan does not use has to be thrown away or the machine jams
    for (const [index, port] of ports.outputs.entries()) {
      if (step.outputs.has(index)) continue
      for (const at of stand) {
        const spare = portAt({ ...at, z: 0, type: step.type, rotation: FLOW }, port)
        const clash = put(
          { type: TRASH, x: spare.x, y: spare.y, layer: spare.z, rotation: FLOW },
          '쓰레기통',
        )
        if (clash) return { ok: false, reason: clash }
      }
      notes.add('안 쓰는 절반은 쓰레기통으로 버립니다 — 안 그러면 절단기가 멈춥니다.')
    }
  }

  // ── who feeds whom ───────────────────────────────────────────────────────
  const nets: Net[] = []
  const inputs: { part: string; at: { x: number; y: number; z: number } }[] = []
  let feedRow = MARGIN

  for (const block of blocks.values()) {
    for (const [slot, feed] of block.step.inputs.entries()) {
      const to = block.intake.get(slot)
      if (!to) return { ok: false, reason: '공급받을 자리를 찾지 못했습니다' }

      if (!feed.from) {
        const head: Endpoint = { x: bounds.minX, y: feedRow, z: 0, facing: FLOW }
        feedRow += 2
        inputs.push({ part: feed.part ?? '', at: { x: head.x, y: head.y, z: head.z } })
        nets.push({ from: head, to, label: `${feed.part} 공급` })
        continue
      }
      const taps = blocks.get(feed.from.node.id)?.supply.get(feed.node.id)
      const from = taps?.shift()
      if (!from) return { ok: false, reason: '만든 도형을 어디서 받을지 정하지 못했습니다' }
      nets.push({ from, to, label: `${OPERATIONS[block.step.op].labelKo} 공급` })
    }
  }

  const last = plan.steps[plan.steps.length - 1]
  const finished = blocks.get(last.node.id)?.supply.get(last.node.id)?.shift()
  if (!finished) return { ok: false, reason: '완성된 도형의 출구를 찾지 못했습니다' }
  const exit: Endpoint = { x: bounds.maxX, y: finished.y, z: finished.z, facing: FLOW }
  const blocked = put({ type: BELT, x: exit.x, y: exit.y, layer: exit.z, rotation: FLOW }, '출구')
  if (blocked) return { ok: false, reason: blocked }
  nets.push({ from: finished, to: exit, label: '완성된 도형' })

  const wiring = routeAll(occupancy, nets, { rounds: options.rounds ?? 10 })
  if ('stuck' in wiring) {
    return { ok: false, reason: `${wiring.stuck.slice(0, 2).join(', ')}를 잇지 못했습니다` }
  }
  placements.push(...wiring.paths.flat())

  const cells = placements.flatMap((placement) =>
    tilesOf(placement.type, placement.rotation ?? 0).map(([dx, dy]) => ({
      x: (placement.x ?? 0) + dx,
      y: (placement.y ?? 0) + dy,
    })),
  )
  return {
    ok: true,
    placements,
    plan,
    inputs,
    output: exit,
    size: {
      width: Math.max(...cells.map((one) => one.x)) + 1,
      height: Math.max(...cells.map((one) => one.y)) + 1,
      floors: Math.max(...placements.map((one) => (one.layer ?? 0) + 1)),
    },
    machines: plan.machines,
    notes: [
      '추출기는 포함하지 않았습니다. 자원 패치 위에 따로 놓고 왼쪽 벨트에 연결하세요.',
      ...notes,
    ],
  }
}

/** The rotation that satisfies a test, or null when none does. */
function turnedSo(fits: (rotation: number) => boolean): number | null {
  for (let rotation = 0; rotation < 4; rotation++) if (fits(rotation)) return rotation
  return null
}

/**
 * A comb standing in the column beside a step's machines.
 *
 * Feeding climbs and collecting descends, so that in both cases the comb meets
 * the rest of the factory at the bottom — the end furthest from the machines it
 * serves last, which is the end a belt can reach without crossing the step.
 *
 * The far machine gets no splitter or merger. A feed comb's last machine takes
 * what is left rather than having a copy peeled off for it, and a collecting
 * comb's first machine starts the run rather than joining it. A step with one
 * machine therefore gets no comb at all and is fed straight, which is the shape
 * module's whole layout falling out as the special case.
 */
function comb(spec: {
  mouths: { x: number; y: number; z: number }[]
  stand: { x: number; y: number }[]
  cross: Crossing
  way: 'feed' | 'collect'
  piece: string
  rotation: number
  put: (placement: BuildingPlacement, what: string) => string | null
  reserve: (at: { x: number; y: number; z: number }) => void
  label: string
}): Endpoint | string {
  const { mouths, cross, way, put, reserve } = spec
  const order = [...mouths].sort((a, b) => a.y - b.y)

  if (order.length === 1) {
    if (way === 'feed') {
      // aim at the machine's own tile: the router lays no piece where it aims,
      // and a port left bare is a machine fed by a gap
      const at = spec.stand[0]
      return { x: at.x + cross.behind.x, y: at.y + cross.behind.y, z: cross.behind.z, facing: cross.inward }
    }
    reserve(order[0])
    return { ...order[0], facing: cross.outward }
  }

  const column = order[0].x
  const floor = order[0].z
  const along: Facing = way === 'feed' ? UP : DOWN
  const low = order[0].y
  const high = order[order.length - 1].y
  // the turn goes at the top in both directions: a feed comb climbs to its
  // last machine and turns in, a collecting comb starts at its first machine
  // and turns down. Putting it at the bottom instead terminates the run at the
  // very end the rest of the factory meets, and nothing gets past it
  const far = high
  const mouthRows = new Set(order.map((one) => one.y))

  for (let y = low; y <= high; y++) {
    const at = { x: column, y, layer: floor }
    let placement: BuildingPlacement
    if (!mouthRows.has(y)) {
      placement = { type: BELT, x: at.x, y: at.y, layer: at.layer, rotation: along }
    } else if (y === far) {
      // the end of the run turns out of the column into its last machine, or
      // out of its first machine into the column
      placement =
        way === 'feed'
          ? turnBelt(along, cross.inward, at)
          : turnBelt(cross.outward, along, at)
    } else {
      placement = { type: spec.piece, x: at.x, y: at.y, layer: at.layer, rotation: spec.rotation }
    }
    const clash = put(placement, spec.label)
    if (clash) return clash
  }

  // the open end, where the rest of the factory meets this step
  const open = { x: column, y: way === 'feed' ? low : low - 1, z: floor }
  if (way === 'feed') return { ...open, facing: along }
  reserve(open)
  return { ...open, facing: along }
}

/** A belt that takes a shape in one way and sends it out another. */
function turnBelt(
  from: Facing,
  to: Facing,
  at: { x: number; y: number; layer: number },
): BuildingPlacement {
  const type = clockwise(from) === to ? TURN : TURN_MIRRORED
  return { type, x: at.x, y: at.y, layer: at.layer, rotation: from }
}

export async function generateFactoryModule(
  root: BuildNode,
  options: { tier: SpeedTier; stackerVariant: StackerVariant; icon?: string },
): Promise<{ layout: FactoryModuleResult; code: string | null }> {
  const layout = layoutFactoryModule(root, options)
  if (!layout.ok) return { layout, code: null }
  const code = await encodeBuildingBlueprint(
    layout.placements,
    options.icon ? [`shape:${options.icon}`, null, null, null] : [null, null, null, null],
  )
  return { layout, code }
}

