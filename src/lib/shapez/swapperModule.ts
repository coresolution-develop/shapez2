/**
 * A module for the machine that trades halves between two shapes.
 *
 * Twenty-four lanes in and twenty-four out — a stacker's intake with a cutter's
 * outlet. That sounds like the hardest of the three and it is the easiest, for
 * one reason: a swapper's two lanes each keep their own column straight through
 * it. Nothing has to be spread, paired up by floor, or brought back together.
 * The machine is a pair of parallel belts that happen to trade halves in the
 * middle.
 *
 * What does need care is that both lanes want the same row on the same floor,
 * on the way in and again on the way out, and two combs cannot share a row. So
 * they are given a floor each and joined by a lift in the one tile before the
 * machine, which is also the tile the machine draws from:
 *
 *   feed combs           floors 2, 1   one lane each, out of each other's way
 *   lift down / carry on floor 2 to 1  the two lanes meet on the machine's floor
 *   swappers             floor 1
 *   lift down / carry on floor 1 to 0  and part company again
 *   gather combs         floors 0, 1
 *
 * The lane that comes down the intake edge leaves by the outlet edge, and the
 * lane that comes in from the side leaves by the side. Keeping each to its own
 * edge is a choice — nothing measured says which pairs with which — but it is
 * the one a player can guess without being told.
 */
import { encodeIslandBlueprint, type BuildingPlacement } from './blueprint'
import {
  CATCHER,
  LAUNCHER,
  MODULE_FIRST_LANE,
  MODULE_FLOORS,
  MODULE_INTAKE_ROW,
  MODULE_LANES,
  MODULE_LANES_PER_FLOOR,
  OPERATION_BUILDING,
  comb,
  platformFor,
  type Platform,
  type Side,
} from './module'
import { Occupancy, routeAll, type Bounds, type Endpoint, type Facing, type Net } from './route'

/** Swappers to a lane, to keep a belt full at 30 shapes a minute. */
const PER_LANE = 4
/** Columns a swapper takes: it is two tiles wide, one lane to each. */
const MACHINE_WIDTH = 2
const BANK_COLUMNS = PER_LANE * MACHINE_WIDTH

const DOWNSTREAM: Facing = 3
/** The second dozen arrive from the right and the second dozen leave left. */
const INWARD: Facing = 2
const OUTWARD: Facing = 2

/** Floors, from the one the machines stand on outwards. */
const MACHINE_FLOOR = 1
const STRAIGHT_FEED_FLOOR = MACHINE_FLOOR + 1
const STRAIGHT_OUT_FLOOR = MACHINE_FLOOR - 1

/** Rows a block needs: feed, the join, machines, the parting, gathering. */
const BLOCK_ROWS = 5
/**
 * Rows between blocks, and worth more than it looks.
 *
 * Three works and takes ten seconds to find; five works and takes two. Room
 * between the blocks is room the streams can change columns in, and giving them
 * that is far cheaper than making the router negotiate for it.
 */
const BLOCK_GAP = 5
/** Rows kept clear of machines where the side lanes come and go. */
const SIDE_CLEARANCE = 4

const PLATFORM_WIDE = 2
const PLATFORM_LONG = 3
/** Banks standing side by side on one row. */
const BANKS_PER_ROW = 3

export interface SwapperModule {
  ok: true
  placements: BuildingPlacement[]
  platform: string
  lanes: number
  perLane: number
  machines: number
  rounds: number
  notes: string[]
  warnings: string[]
}

export interface SwapperFailure {
  ok: false
  reason: string
}

export type SwapperModuleResult = SwapperModule | SwapperFailure

interface Block {
  feedRow: number
  joinRow: number
  machineRow: number
  partRow: number
  gatherRow: number
  /** Columns the swappers are anchored in, left to right. */
  anchors: number[]
  side: Side
}

function planBlocks(bounds: Bounds, gap: number, perRow: number): Block[] | null {
  const sideBottom = MODULE_FIRST_LANE - SIDE_CLEARANCE
  const sideTop = MODULE_FIRST_LANE + MODULE_LANES_PER_FLOOR - 1 + SIDE_CLEARANCE

  // a column is left free down each edge for the side lanes to run in
  const first = bounds.minX + 1
  const room = bounds.maxX - first
  const stride = Math.floor(room / perRow)
  if (stride < BANK_COLUMNS + 1) return null

  const blocks: Block[] = []
  let feedRow = MODULE_INTAKE_ROW - 1 - gap
  while (blocks.length < MODULE_LANES) {
    if (feedRow - BLOCK_ROWS < bounds.minY) return null
    if (feedRow >= sideBottom && feedRow - (BLOCK_ROWS - 1) <= sideTop) {
      feedRow = sideBottom - 1
      continue
    }
    for (let bank = 0; bank < perRow && blocks.length < MODULE_LANES; bank++) {
      const start = first + bank * stride
      // a swapper covers its own tile and the one to its left, so the anchors
      // sit on the odd columns and one lane runs down each parity
      const anchors = Array.from({ length: PER_LANE }, (_, i) => start + i * MACHINE_WIDTH + 1)
      blocks.push({
        feedRow,
        joinRow: feedRow - 1,
        machineRow: feedRow - 2,
        partRow: feedRow - 3,
        gatherRow: feedRow - 4,
        anchors,
        side: -1,
      })
    }
    feedRow -= BLOCK_ROWS + gap
  }
  return blocks
}

const entryOf = (anchors: number[], side: Side) =>
  side < 0 ? anchors[anchors.length - 1] : anchors[0]

function edgeLanes(): { lane: number; floor: number }[] {
  const lanes: { lane: number; floor: number }[] = []
  for (let floor = 0; floor < MODULE_FLOORS; floor++) {
    for (let lane = 0; lane < MODULE_LANES_PER_FLOOR; lane++) {
      lanes.push({ lane: MODULE_FIRST_LANE + lane, floor })
    }
  }
  return lanes
}

export function layoutSwapperModule(
  wide = PLATFORM_WIDE,
  long = PLATFORM_LONG,
  gap = BLOCK_GAP,
  perRow = BANKS_PER_ROW,
  tune: { memory?: number; crowd?: number; rounds?: number } = {},
): SwapperModuleResult {
  const platform: Platform | null = platformFor(wide, long)
  if (!platform) return { ok: false, reason: `${wide}x${long} 플랫폼은 게임에 없습니다` }
  const bounds: Bounds = { ...platform.area, floors: MODULE_FLOORS }

  const occupancy = new Occupancy(bounds)
  const placements: BuildingPlacement[] = []
  const place = (placement: BuildingPlacement, what: string): string | null => {
    const clash = occupancy.claim(placement)
    if (clash) return `${what}이(가) 겹칩니다: ${clash}`
    placements.push(placement)
    return null
  }

  const straightIn: Endpoint[] = []
  const sideIn: Endpoint[] = []
  const straightOut: Endpoint[] = []
  const sideOut: Endpoint[] = []

  for (const { lane, floor } of edgeLanes()) {
    const inbound = place({ ...CATCHER, x: lane, y: MODULE_INTAKE_ROW, layer: floor }, '입구')
    if (inbound) return { ok: false, reason: inbound }
    straightIn.push({ x: lane, y: MODULE_INTAKE_ROW - 1, z: floor, facing: DOWNSTREAM })

    const fromSide = place(
      { type: CATCHER.type, x: bounds.maxX, y: lane, layer: floor, rotation: INWARD },
      '옆 입구',
    )
    if (fromSide) return { ok: false, reason: fromSide }
    sideIn.push({ x: bounds.maxX - 1, y: lane, z: floor, facing: INWARD })

    const ahead = place({ ...LAUNCHER, x: lane, y: bounds.minY, layer: floor }, '출구')
    if (ahead) return { ok: false, reason: ahead }
    straightOut.push({ x: lane, y: bounds.minY, z: floor, facing: DOWNSTREAM })

    const sideways = place(
      { type: LAUNCHER.type, x: bounds.minX, y: lane, layer: floor, rotation: OUTWARD },
      '옆 출구',
    )
    if (sideways) return { ok: false, reason: sideways }
    sideOut.push({ x: bounds.minX, y: lane, z: floor, facing: OUTWARD })
  }

  const blocks = planBlocks(bounds, gap, perRow)
  if (!blocks) {
    return {
      ok: false,
      reason: `교환기 줄 ${MODULE_LANES}개가 ${wide}x${long} 플랫폼에 들어가지 않습니다`,
    }
  }

  const swapper = OPERATION_BUILDING.swap
  const DROP = 'Lift1DownForwardInternalVariant'
  const BELT = 'BeltDefaultForwardInternalVariant'

  for (const block of blocks) {
    const paired = block.anchors.map((anchor) => anchor - 1)

    // the two lanes are fed from combs a floor apart so neither is in the
    // other's way, and meet on the machine's floor one tile before it
    for (const tile of comb(block.anchors, block.side, block.feedRow, false)) {
      const clash = place(
        { ...tile.piece, x: tile.x, y: tile.y, layer: STRAIGHT_FEED_FLOOR },
        '위층 공급 배선',
      )
      if (clash) return { ok: false, reason: clash }
    }
    for (const tile of comb(paired, block.side, block.feedRow, false)) {
      const clash = place({ ...tile.piece, x: tile.x, y: tile.y, layer: MACHINE_FLOOR }, '공급 배선')
      if (clash) return { ok: false, reason: clash }
    }

    for (const anchor of block.anchors) {
      // the lift stands on the very tile the machine draws from, so it both
      // brings the lane down a floor and hands it over in one move
      const join = place(
        { type: DROP, x: anchor, y: block.joinRow, layer: STRAIGHT_FEED_FLOOR, rotation: DOWNSTREAM },
        '내려주는 승강기',
      )
      if (join) return { ok: false, reason: join }

      const alongside = place(
        { type: BELT, x: anchor - 1, y: block.joinRow, layer: MACHINE_FLOOR, rotation: DOWNSTREAM },
        '옆줄 공급',
      )
      if (alongside) return { ok: false, reason: alongside }

      const machine = place(
        {
          type: swapper,
          x: anchor,
          y: block.machineRow,
          layer: MACHINE_FLOOR,
          rotation: DOWNSTREAM,
        },
        '교환기',
      )
      if (machine) return { ok: false, reason: machine }

      const part = place(
        { type: DROP, x: anchor, y: block.partRow, layer: MACHINE_FLOOR, rotation: DOWNSTREAM },
        '내려주는 승강기',
      )
      if (part) return { ok: false, reason: part }

      const carry = place(
        { type: BELT, x: anchor - 1, y: block.partRow, layer: MACHINE_FLOOR, rotation: DOWNSTREAM },
        '옆줄 회수',
      )
      if (carry) return { ok: false, reason: carry }
    }

    for (const tile of comb(block.anchors, block.side, block.gatherRow, true)) {
      const clash = place(
        { ...tile.piece, x: tile.x, y: tile.y, layer: STRAIGHT_OUT_FLOOR },
        '아래층 회수 배선',
      )
      if (clash) return { ok: false, reason: clash }
    }
    for (const tile of comb(paired, block.side, block.gatherRow, true)) {
      const clash = place({ ...tile.piece, x: tile.x, y: tile.y, layer: MACHINE_FLOOR }, '회수 배선')
      if (clash) return { ok: false, reason: clash }
    }
  }

  const nets: Net[] = []
  for (const [index, block] of blocks.entries()) {
    const straight = entryOf(block.anchors, block.side)
    const paired = entryOf(
      block.anchors.map((anchor) => anchor - 1),
      block.side,
    )
    nets.push({
      from: straightIn[index],
      to: { x: straight, y: block.feedRow, z: STRAIGHT_FEED_FLOOR, facing: DOWNSTREAM },
      label: `${index + 1}번 줄 곧은 입구`,
    })
    nets.push({
      from: sideIn[index],
      to: { x: paired, y: block.feedRow, z: MACHINE_FLOOR, facing: DOWNSTREAM },
      label: `${index + 1}번 줄 옆 입구`,
    })
    nets.push({
      from: { x: straight, y: block.gatherRow - 1, z: STRAIGHT_OUT_FLOOR, facing: DOWNSTREAM },
      to: straightOut[index],
      label: `${index + 1}번 줄 곧은 출구`,
    })
    nets.push({
      from: { x: paired, y: block.gatherRow - 1, z: MACHINE_FLOOR, facing: DOWNSTREAM },
      to: sideOut[index],
      label: `${index + 1}번 줄 옆 출구`,
    })
  }

  const wiring = routeAll(occupancy, nets, { rounds: 400, ...tune })
  if ('stuck' in wiring) return { ok: false, reason: `${wiring.stuck.join(', ')}를 잇지 못했습니다` }
  placements.push(...wiring.paths.flat())

  const machines = MODULE_LANES * PER_LANE
  return {
    ok: true,
    placements,
    platform: platform.type,
    lanes: MODULE_LANES,
    perLane: PER_LANE,
    machines,
    rounds: wiring.rounds,
    notes: [
      `벨트 ${MODULE_LANES * 2}줄이 들어와 ${MODULE_LANES * 2}줄로 나갑니다.`,
      `교환기 ${machines}대가 들어갑니다 — 벨트가 가득 찬 채로 나갑니다.`,
    ],
    warnings: [
      `위쪽 ${MODULE_LANES}줄과 오른쪽 ${MODULE_LANES}줄을 넣으면, 서로 절반을 바꿔서 아래쪽과 왼쪽으로 나옵니다.`,
      '위로 들어온 줄이 아래로, 옆으로 들어온 줄이 옆으로 나갑니다.',
      `${wide}x${long} 플랫폼입니다.`,
    ],
  }
}

export async function generateSwapperModule(
  icon?: string,
): Promise<{ layout: SwapperModuleResult; code: string | null }> {
  const layout = layoutSwapperModule()
  if (!layout.ok) return { layout, code: null }

  const platform = platformFor(PLATFORM_WIDE, PLATFORM_LONG)!
  const code = await encodeIslandBlueprint(
    [
      {
        type: platform.type,
        x: platform.anchor.x,
        y: platform.anchor.y,
        rotation: platform.rotation,
        buildings: layout.placements,
      },
    ],
    icon ? [`shape:${icon}`, null, null, null] : [null, null, null, null],
  )
  return { layout, code }
}
