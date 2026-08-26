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
 * ## The third floor
 *
 * Two machines have ports one row apart in the same column: a cutter keeping
 * both halves, and a swapper taking two shapes. A comb needs an unbroken run up
 * its column, through the rows the other comb's mouths are on, so the two
 * cannot both have it — and turning the machines sideways only transposes the
 * problem, since the ports become adjacent columns of one row.
 *
 * The floor above settles both. Nothing meets a mouth directly: a carrier
 * stands there and the comb a column clear of it. For the first stream the
 * carrier is a plain belt; for the second it is a lift, up on the way out and
 * down on the way in, which puts that comb on its own floor with a column to
 * itself. It costs one tile per machine and buys every plan there is.
 *
 * ## Room
 *
 * A lane comes out around 49 by 12 for a median plan, and 93% of them fit on a
 * three-chunk platform, which is the biggest the game has.
 *
 * Three things got it there. The width is folded rather than left to grow — a
 * column per step ran a deep plan to 277 tiles, and no platform is that wide.
 * Three steps share a column, one to a floor, where the machines used to stand
 * on the ground floor alone. And a step only takes a second floor when it
 * actually needs one: a stacker takes its two shapes on separate floors already
 * and was being given a lift it had no use for.
 *
 * The column pitch had to go up from five to seven to pay for the stacking —
 * with three steps in a column the belts between them need room to pass, and at
 * five a quarter of the plans cannot be wired at all. That is the trade, and it
 * still halves the area.
 *
 * ## Lanes
 *
 * The structure takes a lane count — the machines split into a group per lane,
 * each group with its own feed comb and its own collecting comb, so a lane
 * carries one belt from the raw material to the finished shape and never meets
 * its neighbours. Lanes share the comb and carrier columns, which is the whole
 * point: twelve lanes is not twelve of these side by side.
 *
 * It is set to one, because that is the only count that lays out. Two manages
 * about four fifths of the plans and three collapses to a quarter, and giving
 * them more room barely moves either — the same signal that has meant a
 * structural collision every time it has come up here. Not chased yet.
 *
 * The arithmetic says the goal is reachable but not at this density. Twelve
 * lanes of a median plan is about five thousand tiles of buildings, and a
 * three-chunk platform holds ten thousand eight hundred — so it needs roughly
 * half the space filled, where this fills a quarter. The single-operation
 * modules manage three fifths, so the room is there in principle; it wants a
 * tighter arrangement rather than a bigger board.
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
const MARGIN = 3

const SPLITTER = 'Splitter1To2LInternalVariant'
const MERGER = 'Merger2To1LInternalVariant'
const BELT = 'BeltDefaultForwardInternalVariant'
const TURN = 'BeltDefaultLeftInternalVariant'
const TURN_MIRRORED = 'BeltDefaultLeftInternalVariantMirrored'
const TRASH = 'TrashDefaultInternalVariant'
/** Takes a shape in on its own floor and puts it down one floor up, one on. */
const LIFT_UP = 'Lift1UpForwardInternalVariant'
/** And the other way: in on its own floor, out one floor down, one tile on. */
const LIFT_DOWN = 'Lift1DownForwardInternalVariant'

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
  /** Which floor this step's machines stand on. */
  floor: number
  stand: { x: number; y: number }[]
  /**
   * The machines split into the groups each collecting comb serves.
   *
   * A result wanted in two places is collected twice, and the two combs stand
   * in the same column — so the groups have to be laid out with a row between
   * them. Without it the lower comb's way out is the upper comb's last piece,
   * and the belt that should start there has nowhere to go. This is why the
   * split is decided before anything is placed rather than after.
   */
  shares: { x: number; y: number }[][]
  /**
   * Where each feed has to be delivered, one per mouth.
   *
   * Keyed by which mouth and not by which shape: a stacker laying a shape on
   * itself is fed the same thing twice, and keying by shape had the second
   * feed overwrite the first so both nets aimed at one mouth and fought over
   * the tile in front of it.
   */
  intake: Map<number, Endpoint[]>
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
    across?: number
    stackLimit?: number
    rounds?: number
  },
): FactoryModuleResult {
  const lanes = options.lanes ?? 1
  const plan = factoryPlan(root, {
    lanes,
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
    if (step.outputs.size > FLOORS - 1) {
      return {
        ok: false,
        reason: `${OPERATIONS[step.op].labelKo}는 결과가 ${step.outputs.size}가지라 층이 모자랍니다`,
      }
    }
    if (step.inputs.length > FLOORS - 1) {
      return {
        ok: false,
        reason: `${OPERATIONS[step.op].labelKo}는 입구가 ${step.inputs.length}개라 층이 모자랍니다`,
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

  // A step needs five columns of its own — comb, carrier, machines, carrier,
  // comb — and four does not fit at all. Seven rather than five because three
  // steps now share a column, one to a floor, and the belts between them have
  // to get past each other: at five, a quarter of the plans cannot be wired.
  // Two rows between blocks rather than one: a collecting comb hands over on
  // the row below its lowest machine, and with a single row the block beneath
  // is already using it.
  const columnPitch = options.columnPitch ?? 7
  const rowGap = options.rowGap ?? 2
  /**
   * How wide the factory may grow before folding onto a new band.
   *
   * Three platform chunks less the margins, because that is the widest thing
   * the game has to stand it on. Left to run in a straight line a deep plan
   * came out 277 tiles long, which no platform can hold however thin it is.
   */
  const across = options.across ?? 56
  /** How many floors of one column may be stacked with machines. */
  const stackLimit = options.stackLimit ?? FLOORS

  /** How many places want each result, which decides how it is collected. */
  const takers = new Map<string, number>()
  for (const step of plan.steps) {
    for (const feed of step.inputs) {
      if (!feed.from) continue
      takers.set(feed.node.id, (takers.get(feed.node.id) ?? 0) + 1)
    }
  }
  // the finished shape leaves the module, which is a taker like any other
  const finishedId = plan.steps[plan.steps.length - 1].node.id
  takers.set(finishedId, (takers.get(finishedId) ?? 0) + 1)

  /**
   * How many groups a step's machines fall into.
   *
   * One per lane, because a lane carries one belt and a comb collects onto one
   * belt — that is the whole reason the factory is built a lane at a time. And
   * one more factor for a result wanted in several places, since each consumer
   * needs a comb of its own. The groups are laid out lane-major, so lane L's
   * consumers are groups L*takers .. L*takers+takers-1, which keeps a lane's
   * traffic together instead of threading it past its neighbours.
   */
  const sharesOf = (step: FactoryStep) =>
    lanes * Math.max(1, ...[...step.outputs.values()].map((out) => takers.get(out.node.id) ?? 1))

  // ── where everything stands ──────────────────────────────────────────────
  const byDepth = new Map<number, FactoryStep[]>()
  for (const step of plan.steps) {
    byDepth.set(step.depth, [...(byDepth.get(step.depth) ?? []), step])
  }

  /**
   * The steps laid down in reading order, folded when they run out of room.
   *
   * Giving every depth a column of its own is the obvious arrangement and it
   * grows without limit: a plan forty steps deep came out a hundred and sixty
   * tiles long, on a platform sixty wide. Depth still decides the *order* — a
   * step is placed after everything it draws from — but where that lands is
   * wherever there is room, wrapping to a fresh band when the row is full, so
   * the shape of the factory is set by how much space it is given rather than
   * by how long the plan happens to be.
   *
   * The router does not mind. It was already finding its own way between the
   * bands, and a step now sits nearer the ones it feeds rather than a column
   * apart from them, which if anything shortens the belts.
   */
  const blocks = new Map<string, Block>()
  const ordered = [...byDepth.keys()].sort((a, b) => a - b).flatMap((depth) => byDepth.get(depth)!)

  let column = MARGIN
  let band = MARGIN + 1
  let bandDeep = 0
  let widest = MARGIN
  let tallest = MARGIN
  /** How many floors of the current column are spoken for. */
  let stacked = 0

  for (const step of ordered) {
    const footprint = tilesOf(step.type, FLOW)
    const span = footprint.map(([, dy]) => dy)
    const height = Math.max(...span) - Math.min(...span) + 1
    const lift = -Math.min(...span)
    const wanted = Math.min(sharesOf(step), step.machines)
    const rows = step.machines * height + wanted + rowGap
    const ports = portsFor(step.type)!

    // How many floors the step wants: what the building itself stands in — a
    // stacker is two floors tall — plus one more if a port has to be lifted
    // clear of another on the same face. Most steps want one, which is what
    // lets three share a column. The machines used to sit on the ground floor
    // alone and two floors in three held nothing but the odd comb.
    const storeys = footprint.map(([, , dz]) => dz)
    const tall = Math.max(...storeys) - Math.min(...storeys) + 1
    const lifted =
      needLifting(ports.inputs.slice(0, step.inputs.length)).some(Boolean) ||
      needLifting(ports.outputs.filter((_, index) => step.outputs.has(index))).some(Boolean)
    const deep = tall + (lifted ? 1 : 0)
    if (deep > FLOORS) {
      return {
        ok: false,
        reason: `${OPERATIONS[step.op].labelKo}는 층 ${deep}개가 필요한데 ${FLOORS}층뿐입니다`,
      }
    }

    if (stacked + deep > stackLimit) {
      stacked = 0
      column += columnPitch
    }
    if (column + columnPitch > across && column > MARGIN) {
      column = MARGIN
      stacked = 0
      band += bandDeep
      bandDeep = 0
    }
    const floor = stacked
    stacked += deep

    let row = band
    const shares: { x: number; y: number }[][] = []
    let left = step.machines
    for (let share = 0; share < wanted; share++) {
      const size = Math.floor(left / (wanted - share))
      left -= size
      shares.push(
        Array.from({ length: size }, (_, index) => ({ x: column, y: row + index * height + lift })),
      )
      // a blank row between groups, so each comb's way out is its own tile
      row += size * height + 1
    }
    const stand = shares.flat()
    blocks.set(step.node.id, { step, floor, stand, shares, intake: new Map(), supply: new Map() })

    bandDeep = Math.max(bandDeep, rows)
    widest = Math.max(widest, column + columnPitch)
    tallest = Math.max(tallest, band + bandDeep)
  }

  const bounds: Bounds = {
    minX: 0,
    maxX: widest + MARGIN,
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
        { type: block.step.type, x: at.x, y: at.y, layer: block.floor, rotation: FLOW },
        OPERATIONS[block.step.op].labelKo,
      )
      if (clash) return { ok: false, reason: clash }
    }
  }

  // ── the combs that feed and collect each step ────────────────────────────
  const notes = new Set<string>()


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

    // Feeding is the same trick as collecting, run backwards. Nothing is fed
    // at the mouth itself: a carrier stands there and the comb a column clear
    // of it — a plain belt for the first mouth, and for the second a lift that
    // takes the shape from a floor above and drops it straight onto the machine
    // tile. A swapper's two mouths are one row apart in the same column, and
    // that is the only way both combs get a column to themselves.
    const liftIn = needLifting(step.inputs.map((_, slot) => ports.inputs[Math.min(slot, ports.inputs.length - 1)]))
    const liftOut = needLifting([...step.outputs.keys()].map((index) => ports.outputs[Math.min(index, ports.outputs.length - 1)]))

    for (const [slot] of step.inputs.entries()) {
      const port = ports.inputs[Math.min(slot, ports.inputs.length - 1)]
      const cross = crossing(step.type, port, FLOW)
      if (!cross) {
        return { ok: false, reason: `${OPERATIONS[step.op].labelKo}의 입력 포트가 기계에 닿지 않습니다` }
      }
      const upstairs = liftIn[slot]
      // one comb per lane: a lane arrives on one belt, and it feeds whichever
      // of this step's groups belong to that lane
      const perLane = block.shares.length / lanes
      const ends: Endpoint[] = []
      for (let lane = 0; lane < lanes; lane++) {
        const mine = block.shares.slice(lane * perLane, (lane + 1) * perLane).flat()
        const mouths = mine.map((at) =>
          portAt({ ...at, z: block.floor, type: step.type, rotation: FLOW }, port),
        )
        for (const mouth of mouths) {
          const clash = put(
            upstairs
              ? { type: LIFT_DOWN, x: mouth.x, y: mouth.y, layer: mouth.z + 1, rotation: cross.inward }
              : { type: BELT, x: mouth.x, y: mouth.y, layer: mouth.z, rotation: cross.inward },
            `${OPERATIONS[step.op].labelKo} 입구`,
          )
          if (clash) return { ok: false, reason: clash }
        }
        const built = comb({
          mouths: mouths.map((mouth) => ({
            ...mouth,
            x: mouth.x - 1,
            z: mouth.z + (upstairs ? 1 : 0),
          })),
          stand: mine,
          cross,
          way: 'feed',
          piece: SPLITTER,
          rotation: splitRotation,
          put,
          reserve,
          label: `${OPERATIONS[step.op].labelKo} 공급 빗`,
        })
        if (typeof built === 'string') return { ok: false, reason: built }
        ends.push(built)
      }
      block.intake.set(slot, ends)
    }

    for (const [ordinal, [index, out]] of [...step.outputs].entries()) {
      const port = ports.outputs[Math.min(index, ports.outputs.length - 1)]
      const cross = crossing(step.type, port, FLOW)
      if (!cross) {
        return { ok: false, reason: `${OPERATIONS[step.op].labelKo}의 출력 포트가 기계에 닿지 않습니다` }
      }

      // A result wanted in two places is collected twice rather than once and
      // then split: each group of machines gets its own comb. One comb with two
      // nets drawing on it had both of them start on the same tile, which no
      // amount of negotiating gets past.
      // Every group of machines has to end up in exactly one comb, and every
      // comb has to have a consumer waiting for it. A comb nobody asked for
      // ends on a tile no net owns, and a tile no net owns is one the router
      // will build a lift through — which is how a merger came to be feeding
      // the side of a lift that does not take from there.
      //
      // The two results of one machine need not be wanted in the same number
      // of places, though. The machines are laid out in as many groups as the
      // greediest result needs, and a result wanting fewer takes several groups
      // to a comb: its comb runs straight over the blank row between them,
      // which costs nothing because the two results are collected on different
      // floors and so never share that row.
      const wanted = (takers.get(out.node.id) ?? 1) * lanes
      if (wanted > block.shares.length) {
        return {
          ok: false,
          reason: `${OPERATIONS[step.op].labelKo} 한 대를 ${wanted}군데로 나눠야 해서 아직 배치할 수 없습니다`,
        }
      }
      const buckets: { x: number; y: number }[][] = []
      let left = block.shares.length
      let cursor = 0
      for (let bucket = 0; bucket < wanted; bucket++) {
        const take = Math.floor(left / (wanted - bucket))
        buckets.push(block.shares.slice(cursor, cursor + take).flat())
        cursor += take
        left -= take
      }
      // Nothing collects at the mouth itself. Each result is carried one tile
      // clear first, which leaves the mouth column free for the trash an unused
      // output needs — and, for the second result of a two-output machine,
      // carries it a floor up at the same time.
      //
      // That last part is what makes a cutter keeping both halves possible at
      // all. Its two outputs are one row apart in the same column, and two
      // combs cannot both have an unbroken run up it; a lift at the mouth puts
      // the second one upstairs, where it has a column to itself.
      const upstairs = liftOut[ordinal]
      const ends: Endpoint[] = []
      for (const mine of buckets) {
        const mouths = mine.map((at) =>
          portAt({ ...at, z: block.floor, type: step.type, rotation: FLOW }, port),
        )
        for (const mouth of mouths) {
          const clash = put(
            upstairs
              ? { type: LIFT_UP, x: mouth.x, y: mouth.y, layer: mouth.z, rotation: cross.outward }
              : { type: BELT, x: mouth.x, y: mouth.y, layer: mouth.z, rotation: cross.outward },
            `${OPERATIONS[step.op].labelKo} 출구`,
          )
          if (clash) return { ok: false, reason: clash }
        }
        const built = comb({
          mouths: mouths.map((mouth) => ({
            ...mouth,
            x: mouth.x + 1,
            z: mouth.z + (upstairs ? 1 : 0),
          })),
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
        const spare = portAt({ ...at, z: block.floor, type: step.type, rotation: FLOW }, port)
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
      const mouths = block.intake.get(slot)
      if (!mouths) return { ok: false, reason: '공급받을 자리를 찾지 못했습니다' }

      for (const to of mouths) {
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
  }

  const last = plan.steps[plan.steps.length - 1]
  const leaving = blocks.get(last.node.id)?.supply.get(last.node.id) ?? []
  if (leaving.length === 0) return { ok: false, reason: '완성된 도형의 출구를 찾지 못했습니다' }
  const outlets: Endpoint[] = []
  for (const finished of leaving) {
    const exit: Endpoint = { x: bounds.maxX, y: finished.y, z: finished.z, facing: FLOW }
    const blocked = put({ type: BELT, x: exit.x, y: exit.y, layer: exit.z, rotation: FLOW }, '출구')
    if (blocked) return { ok: false, reason: blocked }
    outlets.push(exit)
    nets.push({ from: finished, to: exit, label: '완성된 도형' })
  }
  const exit = outlets[0]

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

/**
 * Which of a building's ports have to be carried to another floor.
 *
 * Two ports on the same face and the same floor are one row apart, and a comb
 * needs an unbroken run up that column — so the second of them has to be lifted
 * out of the way. Ports that already differ by a floor do not: a stacker takes
 * its two shapes on separate floors and needs no lift at all, and giving it one
 * was costing a floor that the machines could have stood on.
 */
function needLifting(ports: readonly (readonly [number, number, number])[]): boolean[] {
  const seen = new Set<string>()
  return ports.map((port) => {
    const face = `${port[0]},${port[2]}`
    if (seen.has(face)) return true
    seen.add(face)
    return false
  })
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
    // one machine wants no comb: the feed aims straight at the carrier standing
    // in front of it, which is already built and so cannot be built over
    if (way === 'feed') return { ...order[0], facing: cross.inward }
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


