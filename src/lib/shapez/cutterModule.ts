/**
 * A module for the machine that gives two shapes back.
 *
 * The stacker module's mirror image: twelve lanes in, twenty-four out. Where
 * the second dozen leaves is not a matter of taste — it follows from how far a
 * launcher throws. A launcher two tiles inside this platform's left edge
 * reaches a catcher two tiles inside the right edge of the platform beside it,
 * which is exactly `BELT_PORT_THROW` and exactly where a stacker module's
 * second intake sits. So the halves that do not leave the far edge leave the
 * left one, and a cutter set beside a stacker feeds it without an adaptor.
 *
 * The awkward part is that a cutter's two outputs come out of its two tiles,
 * side by side, and two streams cannot both run down one column. They are
 * separated by floor instead: one half carries straight on, the other drops a
 * floor through a lift in the same move, and each is then gathered by a comb of
 * its own with a whole floor between them.
 *
 *   feed comb            floor 1     splits a lane four ways
 *   cutters              floor 1     each one two tiles wide
 *   carry on / drop      floor 1     belt for one half, lift for the other
 *   gather combs         floors 1, 0 one for each half, out of each other's way
 *
 * That leaves floor 2 clear from end to end, which is what the streams crossing
 * the module use — the same trick the stacker module plays with floor 0.
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

/** Cutters to a lane, to keep a belt full at 30 shapes a minute. */
const PER_LANE = 4
/** Columns a cutter takes across the flow. It is two tiles wide in plan. */
const MACHINE_WIDTH = 2
const BANK_COLUMNS = PER_LANE * MACHINE_WIDTH

const DOWNSTREAM: Facing = 3
/** The second dozen outputs leave across the flow, to the left. */
const OUTWARD: Facing = 2

/** Machines and one half's gathering live here; the other half drops below. */
const MACHINE_FLOOR = 1
const SECOND_HALF_FLOOR = MACHINE_FLOOR - 1

/** Rows a block needs: feed, machines, the drop, then gathering. */
const BLOCK_ROWS = 4
const BLOCK_GAP = 3
/** Rows kept clear of machines where the side outputs leave. */
const SIDE_CLEARANCE = 4
/**
 * How big a platform this wants: two chunks across the flow and three down it.
 *
 * A straight foundation was tried first and never fitted — twelve rows of four
 * do not go into one, however they are shuffled. The game has wider ones, and
 * on those there is room to spare. The lanes stay exactly where a one-chunk
 * module puts them, so a wider module still chains onto narrow ones.
 */
const PLATFORM_WIDE = 2
const PLATFORM_LONG = 3
/** Banks of cutters standing side by side on one row. */
const BANKS_PER_ROW = 3

export interface CutterModule {
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

export interface CutterFailure {
  ok: false
  reason: string
}

export type CutterModuleResult = CutterModule | CutterFailure

interface Block {
  feedRow: number
  machineRow: number
  /** Where one half carries on and the other drops a floor. */
  dropRow: number
  gatherRow: number
  /** Columns the cutters are anchored in, left to right. */
  anchors: number[]
  side: Side
}

/**
 * Where every cutter stands, before a belt is placed.
 *
 * A bank is eight columns. On a one-chunk platform there are sixteen, so only
 * one bank fits on a row with anything left to cross it with — which is why
 * twelve rows of them never went in. Widen the platform and several banks sit
 * side by side on the same row, with a corridor between each pair, and the
 * whole thing gets short enough to fit.
 */
function planBlocks(bounds: Bounds, gap: number, perRow: number): Block[] | null {
  const sideBottom = MODULE_FIRST_LANE - SIDE_CLEARANCE
  const sideTop = MODULE_FIRST_LANE + MODULE_LANES_PER_FLOOR - 1 + SIDE_CLEARANCE

  // a column is left free down the left edge — every side output has to reach
  // it, and a bank sitting on it walls them off
  const first = bounds.minX + 1
  const room = bounds.maxX - first + 1
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
      // a cutter covers its own tile and the one to its left, so the anchors sit
      // on the odd columns of the bank and the halves come out on both parities
      const anchors = Array.from({ length: PER_LANE }, (_, i) => start + i * MACHINE_WIDTH + 1)
      blocks.push({
        feedRow,
        machineRow: feedRow - 1,
        dropRow: feedRow - 2,
        gatherRow: feedRow - 3,
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

/**
 * Lays out a cutter module, or says which stream defeated it.
 */
export function layoutCutterModule(
  wide = PLATFORM_WIDE,
  long = PLATFORM_LONG,
  gap = BLOCK_GAP,
  perRow = BANKS_PER_ROW,
  tune: { memory?: number; crowd?: number; rounds?: number } = {},
): CutterModuleResult {
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

  // the edges first: twelve in at the top, twelve out at the bottom and twelve
  // more out of the left side
  const intakes: Endpoint[] = []
  const straightOut: Endpoint[] = []
  const sideOut: Endpoint[] = []

  for (const { lane, floor } of edgeLanes()) {
    const inbound = place(
      { ...CATCHER, x: lane, y: MODULE_INTAKE_ROW, layer: floor },
      '입구',
    )
    if (inbound) return { ok: false, reason: inbound }
    intakes.push({ x: lane, y: MODULE_INTAKE_ROW - 1, z: floor, facing: DOWNSTREAM })

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
      reason: `절단기 줄 ${MODULE_LANES}개가 ${wide}x${long} 플랫폼에 들어가지 않습니다 — 줄마다 ${BLOCK_ROWS}칸씩 필요합니다`,
    }
  }
  const cutter = OPERATION_BUILDING.cut

  for (const block of blocks) {
    for (const tile of comb(block.anchors, block.side, block.feedRow, false)) {
      const clash = place({ ...tile.piece, x: tile.x, y: tile.y, layer: MACHINE_FLOOR }, '공급 배선')
      if (clash) return { ok: false, reason: clash }
    }

    for (const anchor of block.anchors) {
      const clash = place(
        { type: cutter, x: anchor, y: block.machineRow, layer: MACHINE_FLOOR, rotation: DOWNSTREAM },
        '절단기',
      )
      if (clash) return { ok: false, reason: clash }

      // one half carries straight on; the other drops a floor where it stands,
      // which is the only way two streams leaving side by side stop colliding
      const carry = place(
        {
          type: 'BeltDefaultForwardInternalVariant',
          x: anchor,
          y: block.dropRow,
          layer: MACHINE_FLOOR,
          rotation: DOWNSTREAM,
        },
        '앞쪽 절반',
      )
      if (carry) return { ok: false, reason: carry }

      const drop = place(
        {
          type: 'Lift1DownForwardInternalVariant',
          x: anchor - 1,
          y: block.dropRow,
          layer: MACHINE_FLOOR,
          rotation: DOWNSTREAM,
        },
        '옆쪽 절반',
      )
      if (drop) return { ok: false, reason: drop }
    }

    for (const tile of comb(block.anchors, block.side, block.gatherRow, true)) {
      const clash = place({ ...tile.piece, x: tile.x, y: tile.y, layer: MACHINE_FLOOR }, '회수 배선')
      if (clash) return { ok: false, reason: clash }
    }
    const dropped = block.anchors.map((anchor) => anchor - 1)
    for (const tile of comb(dropped, block.side, block.gatherRow, true)) {
      const clash = place(
        { ...tile.piece, x: tile.x, y: tile.y, layer: SECOND_HALF_FLOOR },
        '아래층 회수 배선',
      )
      if (clash) return { ok: false, reason: clash }
    }
  }

  const nets: Net[] = []
  for (const [index, block] of blocks.entries()) {
    nets.push({
      from: intakes[index],
      to: { x: entryOf(block.anchors, block.side), y: block.feedRow, z: MACHINE_FLOOR, facing: DOWNSTREAM },
      label: `${index + 1}번 줄 공급`,
    })
  }
  for (const [index, block] of blocks.entries()) {
    nets.push({
      from: {
        x: entryOf(block.anchors, block.side),
        y: block.gatherRow - 1,
        z: MACHINE_FLOOR,
        facing: DOWNSTREAM,
      },
      to: straightOut[index],
      label: `${index + 1}번 줄 앞쪽 절반`,
    })
    nets.push({
      from: {
        x: entryOf(
          block.anchors.map((anchor) => anchor - 1),
          block.side,
        ),
        y: block.gatherRow - 1,
        z: SECOND_HALF_FLOOR,
        facing: DOWNSTREAM,
      },
      to: sideOut[index],
      label: `${index + 1}번 줄 옆쪽 절반`,
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
      `벨트 ${MODULE_LANES}줄이 들어와 ${MODULE_LANES * 2}줄로 나옵니다.`,
      `절단기 ${machines}대가 들어갑니다 — 벨트가 가득 찬 채로 나갑니다.`,
    ],
    warnings: [
      `잘린 두 절반이 서로 다른 쪽으로 나갑니다 — ${MODULE_LANES}줄은 아래 가장자리로, ${MODULE_LANES}줄은 왼쪽 가장자리로.`,
      '어느 쪽이 어느 절반인지는 게임에서 한 번 확인해 보세요 — 절단기의 두 출구 중 어느 것이 어느 조각인지는 아직 재지 못했습니다.',
      `${wide}x${long} 플랫폼입니다.`,
    ],
  }
}

export async function generateCutterModule(
  icon?: string,
): Promise<{ layout: CutterModuleResult; code: string | null }> {
  const layout = layoutCutterModule()
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
