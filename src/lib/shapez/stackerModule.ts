/**
 * A module for the one machine that takes two shapes.
 *
 * Everything else in this repository could be written down: a comb is a row, a
 * ladder is a column, and no belt had to find its way past anything. A stacker
 * module cannot be written down like that, and the reason is arithmetic. Twelve
 * lanes come out, so twenty-four go in — twelve down the intake edge carrying
 * the shape that ends up underneath, twelve along the side carrying the one
 * laid on top (both measured; see `STACKER_INTAKE`). Seventy-two machines have
 * to be fed from those twenty-four streams inside sixteen columns, which is not
 * enough room to give every stream a lane of its own. The streams have to weave,
 * so the belts between the fixed parts are found by `routeBelt` rather than
 * placed by hand.
 *
 * The fixed parts are these:
 *
 *   - Every stacker sits on floor 1, so it fills floors 1 and 2 and leaves
 *     floor 0 clear from end to end. That is the routing deck, and it is the
 *     same choice the player's own module makes.
 *   - Machines go in banks either side of the lane band, six to an output lane,
 *     two lanes to a block, six blocks down the module.
 *   - A stacker's two shapes arrive at the same tile one floor apart, so the
 *     two feeding combs are the same comb on floors 1 and 2, and the results
 *     merge on floor 1 underneath.
 *
 * UNFINISHED, and it says so rather than emitting something that will not run.
 * Every machine and comb places without a clash, and about half the streams get
 * routed, but the rest do not and lengthening the platform does not help — so
 * it is not a matter of room. The twelve intake lanes arrive packed into four
 * columns across three floors, and the first paths to leave that pack take the
 * tiles the later ones needed to get out of it; the same happens again where a
 * stream has to cross the middle band to reach a machine bank. Routing each
 * stream once and for all cannot see that coming. The fix is for the router to
 * rip up paths that box others in and lay them again, which is a piece of work
 * in its own right and is not started.
 */
import type { BuildingPlacement } from './blueprint'
import {
  CATCHER,
  CHUNK_MARGIN,
  CHUNK_TILES,
  LAUNCHER,
  MODULE_FIRST_LANE,
  MODULE_FLOORS,
  MODULE_INTAKE_ROW,
  MODULE_LANES,
  MODULE_LANES_PER_FLOOR,
  MODULE_OUTLET_ROW,
  MODULE_SIDE_INTAKE_COLUMN,
  OPERATION_BUILDING,
  PLATFORM_1X2,
  comb,
  type Side,
} from './module'
import { Occupancy, routeBelt, type Bounds, type Endpoint, type Facing } from './route'

/** Machines per lane, and lanes per block, both fixed by the reference module. */
const PER_LANE = 6
const LANES_PER_BLOCK = 2
const BLOCKS = MODULE_LANES / LANES_PER_BLOCK

/** Everything flows one way down the platform. */
const DOWNSTREAM: Facing = 3
/** The side intake comes in across the flow. */
const INWARD: Facing = 2

/**
 * The floor every stacker stands on.
 *
 * It spans two, so this also says which floors are busy — 1 and 2 — and which
 * is free for belts to cross the module on.
 */
const MACHINE_FLOOR = 1

/** Which floor each of the two shapes has to arrive on. */
const BOTTOM_SHAPE_FLOOR = MACHINE_FLOOR
const TOP_SHAPE_FLOOR = MACHINE_FLOOR + 1

/** Rows a block needs: the feeding combs, the machines, the merging comb. */
const BLOCK_ROWS = 3
/** Rows left between blocks for streams to cross the module. */
const BLOCK_GAP = 2

export interface StackerModule {
  ok: true
  placements: BuildingPlacement[]
  platform: string
  lanes: number
  perLane: number
  machines: number
  notes: string[]
  warnings: string[]
}

export interface StackerFailure {
  ok: false
  reason: string
}

export type StackerModuleResult = StackerModule | StackerFailure

/** A platform longer along the flow — never wider. See README. */
function platformBounds(chunks: number): Bounds {
  return {
    minX: CHUNK_MARGIN,
    maxX: CHUNK_TILES - CHUNK_MARGIN - 1,
    minY: MODULE_OUTLET_ROW - CHUNK_TILES * (chunks - 1),
    maxY: MODULE_INTAKE_ROW,
    floors: MODULE_FLOORS,
  }
}

interface Block {
  /** Row the feeding combs sit on. */
  feedRow: number
  machineRow: number
  mergeRow: number
}

interface Lane {
  block: Block
  /** Columns the six machines stand in, left to right. */
  anchors: number[]
  /** Which way the comb runs out from the lane's entry column. */
  side: Side
  /** Column the combs are fed at and the results leave from. */
  entry: number
}

/**
 * Where every machine goes, before a single belt is placed.
 *
 * Two banks of six columns, one either side of the lane band, so the middle
 * four columns stay clear on all three floors — that band is the only way a
 * stream has of getting from the intake edge to a block further down.
 */
function planLanes(bounds: Bounds, gap: number): Lane[] {
  // the two banks fill the platform exactly, so the right one reaches the very
  // column the side intake arrives down — the blocks step around those rows
  // rather than the bank giving up a machine
  const sideBottom = MODULE_FIRST_LANE
  const sideTop = MODULE_FIRST_LANE + MODULE_LANES_PER_FLOOR - 1

  const blocks: Block[] = []
  let feedRow = MODULE_INTAKE_ROW - 1 - gap
  while (blocks.length < BLOCKS) {
    if (feedRow >= sideBottom && feedRow - (BLOCK_ROWS - 1) <= sideTop) {
      feedRow = sideBottom - 1
      continue
    }
    blocks.push({ feedRow, machineRow: feedRow - 1, mergeRow: feedRow - 2 })
    feedRow -= BLOCK_ROWS + gap
  }

  const leftAnchors = Array.from({ length: PER_LANE }, (_, i) => bounds.minX + i)
  const rightAnchors = Array.from({ length: PER_LANE }, (_, i) => bounds.maxX - PER_LANE + 1 + i)

  return blocks.flatMap((block) => [
    // the left bank is fed from its right-hand end, nearest the lane band
    { block, anchors: leftAnchors, side: -1 as Side, entry: leftAnchors[leftAnchors.length - 1] },
    { block, anchors: rightAnchors, side: 1 as Side, entry: rightAnchors[0] },
  ])
}

/** The twelve lanes down the intake edge, carrying the shape that goes under. */
function intakeStarts(): Endpoint[] {
  const starts: Endpoint[] = []
  for (let floor = 0; floor < MODULE_FLOORS; floor++) {
    for (let lane = 0; lane < MODULE_LANES_PER_FLOOR; lane++) {
      starts.push({
        x: MODULE_FIRST_LANE + lane,
        y: MODULE_INTAKE_ROW - 1,
        z: floor,
        facing: DOWNSTREAM,
      })
    }
  }
  return starts
}

/** The twelve lanes along the side, carrying the shape laid on top. */
function sideStarts(): Endpoint[] {
  const starts: Endpoint[] = []
  for (let floor = 0; floor < MODULE_FLOORS; floor++) {
    for (let lane = 0; lane < MODULE_LANES_PER_FLOOR; lane++) {
      starts.push({
        x: MODULE_SIDE_INTAKE_COLUMN - 1,
        y: MODULE_FIRST_LANE + lane,
        z: floor,
        facing: INWARD,
      })
    }
  }
  return starts
}

/** Where the finished shapes have to end up, one lane per launcher. */
function outletGoals(bounds: Bounds): Endpoint[] {
  const goals: Endpoint[] = []
  for (let floor = 0; floor < MODULE_FLOORS; floor++) {
    for (let lane = 0; lane < MODULE_LANES_PER_FLOOR; lane++) {
      goals.push({
        x: MODULE_FIRST_LANE + lane,
        y: bounds.minY,
        z: floor,
        facing: DOWNSTREAM,
      })
    }
  }
  return goals
}

/**
 * Lays out a stacker module, or says which stream it could not get through.
 *
 * Refusing is a real outcome here rather than a formality: the module is close
 * to full, and a layout that cannot be wired is worth far less than being told
 * so. Nothing partial is returned.
 */
export function layoutStackerModule(chunks = 2, gap = BLOCK_GAP): StackerModuleResult {
  const bounds = platformBounds(chunks)
  const occupancy = new Occupancy(bounds)
  const placements: BuildingPlacement[] = []

  const place = (placement: BuildingPlacement): string | null => {
    const clash = occupancy.claim(placement)
    if (clash) return clash
    placements.push(placement)
    return null
  }

  // the edges first, so nothing else can take the tiles the game expects them on
  for (const start of intakeStarts()) {
    const clash = place({ ...CATCHER, x: start.x, y: MODULE_INTAKE_ROW, layer: start.z })
    if (clash) return { ok: false, reason: `가장자리가 겹칩니다: ${clash}` }
  }
  for (const start of sideStarts()) {
    const clash = place({
      type: CATCHER.type,
      x: MODULE_SIDE_INTAKE_COLUMN,
      y: start.y,
      layer: start.z,
      rotation: INWARD,
    })
    if (clash) return { ok: false, reason: `가장자리가 겹칩니다: ${clash}` }
  }
  for (const goal of outletGoals(bounds)) {
    const clash = place({ ...LAUNCHER, x: goal.x, y: bounds.minY, layer: goal.z })
    if (clash) return { ok: false, reason: `가장자리가 겹칩니다: ${clash}` }
  }

  // then the machines and the combs that feed and drain them
  const lanes = planLanes(bounds, gap)
  const stacker = OPERATION_BUILDING.stack

  for (const lane of lanes) {
    for (const floor of [BOTTOM_SHAPE_FLOOR, TOP_SHAPE_FLOOR]) {
      for (const tile of comb(lane.anchors, lane.side, lane.block.feedRow, false)) {
        const clash = place({ ...tile.piece, x: tile.x, y: tile.y, layer: floor })
        if (clash) return { ok: false, reason: `공급 배선이 겹칩니다: ${clash}` }
      }
    }

    for (const anchor of lane.anchors) {
      const clash = place({
        type: stacker,
        x: anchor,
        y: lane.block.machineRow,
        layer: MACHINE_FLOOR,
        rotation: DOWNSTREAM,
      })
      if (clash) return { ok: false, reason: `결합기가 겹칩니다: ${clash}` }
    }

    for (const tile of comb(lane.anchors, lane.side, lane.block.mergeRow, true)) {
      const clash = place({ ...tile.piece, x: tile.x, y: tile.y, layer: MACHINE_FLOOR })
      if (clash) return { ok: false, reason: `회수 배선이 겹칩니다: ${clash}` }
    }
  }

  // and finally the streams, which have to find their own way through
  const bottoms = intakeStarts()
  const tops = sideStarts()
  const outlets = outletGoals(bounds)

  const routed: BuildingPlacement[] = []

  /**
   * Joins each end to whichever free end it can actually reach.
   *
   * Pairing them off in order looks tidy and routes badly: a stream is only
   * ever interchangeable with the others on its edge, so the sensible thing is
   * to let each destination take the nearest one that a belt can be got to it
   * from, and leave the rest for the destinations further down.
   */
  const joinUp = (
    pool: Endpoint[],
    goals: Endpoint[],
    describe: (index: number) => string,
    reversed = false,
  ): string | null => {
    const free = [...pool]
    for (const [index, goal] of goals.entries()) {
      const nearest = free
        .map((end, at) => ({
          at,
          span: Math.abs(end.x - goal.x) + Math.abs(end.y - goal.y) + Math.abs(end.z - goal.z) * 3,
        }))
        .sort((a, b) => a.span - b.span)

      let joined = false
      for (const { at } of nearest) {
        const path = reversed
          ? routeBelt(occupancy, goal, free[at])
          : routeBelt(occupancy, free[at], goal)
        if (!path) continue
        routed.push(...path.placements)
        free.splice(at, 1)
        joined = true
        break
      }
      if (!joined) return describe(index)
    }
    return null
  }

  const underFeeds = lanes.map((lane) => ({
    x: lane.entry,
    y: lane.block.feedRow,
    z: BOTTOM_SHAPE_FLOOR,
    facing: DOWNSTREAM,
  }))
  const stuckUnder = joinUp(bottoms, [...underFeeds].reverse(), (i) => `${lanes.length - i}번 줄의 아래 도형`)
  if (stuckUnder) return { ok: false, reason: `${stuckUnder}을 기계까지 잇지 못했습니다` }

  const overFeeds = lanes.map((lane) => ({
    x: lane.entry,
    y: lane.block.feedRow,
    z: TOP_SHAPE_FLOOR,
    facing: DOWNSTREAM,
  }))
  const stuckOver = joinUp(tops, [...overFeeds].reverse(), (i) => `${lanes.length - i}번 줄의 위 도형`)
  if (stuckOver) return { ok: false, reason: `${stuckOver}을 기계까지 잇지 못했습니다` }

  const results = lanes.map((lane) => ({
    x: lane.entry,
    y: lane.block.mergeRow - 1,
    z: MACHINE_FLOOR,
    facing: DOWNSTREAM,
  }))
  const stuckOut = joinUp(outlets, results, (i) => `${i + 1}번 줄의 결과`, true)
  if (stuckOut) return { ok: false, reason: `${stuckOut}를 출구까지 잇지 못했습니다` }

  placements.push(...routed)

  return {
    ok: true,
    placements,
    platform: PLATFORM_1X2,
    lanes: MODULE_LANES,
    perLane: PER_LANE,
    machines: MODULE_LANES * PER_LANE,
    notes: [
      `벨트가 ${MODULE_LANES * 2}줄 들어와 ${MODULE_LANES}줄로 나옵니다.`,
      `결합기 ${MODULE_LANES * PER_LANE}대가 들어갑니다 — 벨트가 가득 찬 채로 나갑니다.`,
    ],
    warnings: [
      `위쪽 가장자리 ${MODULE_LANES}줄에 아래로 깔릴 도형을, 옆 가장자리 ${MODULE_LANES}줄에 위에 얹을 도형을 넣으세요.`,
      '플랫폼 2칸짜리입니다 — 흐름 방향으로 깁니다.',
    ],
  }
}
