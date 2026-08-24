/**
 * One shape in, its four quarters out.
 *
 * A cutter only ever halves along one axis, so quartering takes three passes:
 * cut, turn each half a quarter so the other seam faces the blade, cut again.
 * The simulator says so plainly — `CuRuSuWu` becomes `CuRu----` and `----SuWu`,
 * and turning the first gives `--CuRu--`, which cuts into `--Cu----` and
 * `----Ru--`.
 *
 * That arithmetic is what makes this module unlike the others. Every cut
 * doubles the lanes, so twelve in is forty-eight out, and a module has four
 * edges of which one is the intake. For a while that looked impossible. It is
 * not: an edge holds one twelve-lane group *per chunk it spans*, so a platform
 * three chunks wide has three places to put a group along its bottom edge. Four
 * groups fit on a 3x3 with room over.
 *
 *   intake  ─ 12 lanes, top edge
 *   cut     ─ 24 lanes
 *   turn    ─ 24 lanes
 *   cut     ─ 48 lanes  →  three groups along the bottom, one down the left
 *
 * The four groups are the four quarters, in the order the cuts made them: which
 * half a quarter came from, then which side of the second cut it left by.
 *
 * UNFINISHED, and the reason is arithmetic rather than routing. Twelve lanes
 * need 144 cutters and 48 rotators, and a cutter is two columns wide, so the
 * three stages want 46 rows of machines out of the 54 a 3x3 platform has —
 * every other module here spends a third of its rows on machines and the rest
 * on getting belts past them. Every machine places; the belts then have two
 * rows to weave in and cannot. There is no larger platform in the game.
 *
 * Which means the honest answer to "quarter this" is the three modules that do
 * exist: cutter, then rotator, then cutter. That is the same work on three
 * platforms instead of one, at full twelve-lane scale, and the module plan
 * already lays it out. Left here because the cutter module was also "does not
 * fit" until an assumption turned out to be wrong, and a better packing may yet
 * turn up.
 */
import { encodeIslandBlueprint, type BuildingPlacement } from './blueprint'
import {
  CATCHER,
  CHUNK_TILES,
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

const DOWNSTREAM: Facing = 3
/** Back out the way the shapes came in — the intake edge has spare places. */
const BACKWARD: Facing = 1

/** Cutters and rotators to a lane, to keep a belt full at their own rates. */
const CUTTERS_PER_LANE = 4
const ROTATORS_PER_LANE = 2

/** Machines stand here; the halves that drop go one floor below. */
const MACHINE_FLOOR = 1
const DROPPED_FLOOR = MACHINE_FLOOR - 1

const CUT_BANK = CUTTERS_PER_LANE * 2
const TURN_BANK = ROTATORS_PER_LANE

/** Rows a block of each kind needs. */
const CUT_ROWS = 4
const TURN_ROWS = 3
const BLOCK_GAP = 2
/** Rows between one stage and the next, for the streams to sort themselves out. */
const STAGE_GAP = 3

const PLATFORM_WIDE = 3
const PLATFORM_LONG = 3

export interface QuadModule {
  ok: true
  placements: BuildingPlacement[]
  platform: string
  lanesIn: number
  lanesOut: number
  machines: number
  rounds: number
  notes: string[]
  warnings: string[]
}

export interface QuadFailure {
  ok: false
  reason: string
}

export type QuadModuleResult = QuadModule | QuadFailure

/** A run of lanes flowing between two stages. */
type Stream = Endpoint

interface Cursor {
  row: number
}

/**
 * Somewhere to put a twelve-lane group along an edge.
 *
 * An edge is as many chunks long as the platform is, and each chunk has one
 * place a group can sit — the same four columns every module uses, offset by
 * the chunk. That is what lets a module have more than three outputs.
 */
function groupAlong(chunk: number): number[] {
  return Array.from(
    { length: MODULE_LANES_PER_FLOOR },
    (_, lane) => chunk * CHUNK_TILES + MODULE_FIRST_LANE + lane,
  )
}

export function layoutQuadModule(
  wide = PLATFORM_WIDE,
  long = PLATFORM_LONG,
  gap = BLOCK_GAP,
  stageGap = STAGE_GAP,
  tune: { memory?: number; crowd?: number; rounds?: number } = {},
): QuadModuleResult {
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

  // ── the edges ────────────────────────────────────────────────────────────
  const intake: Stream[] = []
  for (let floor = 0; floor < MODULE_FLOORS; floor++) {
    for (const lane of groupAlong(0)) {
      const clash = place({ ...CATCHER, x: lane, y: MODULE_INTAKE_ROW, layer: floor }, '입구')
      if (clash) return { ok: false, reason: clash }
      intake.push({ x: lane, y: MODULE_INTAKE_ROW - 1, z: floor, facing: DOWNSTREAM })
    }
  }

  // three groups along the bottom and one down the left: four quarters, four
  // places to put them
  const quarters: Stream[][] = []
  for (const chunk of [0, 1, 2]) {
    const group: Stream[] = []
    for (let floor = 0; floor < MODULE_FLOORS; floor++) {
      for (const lane of groupAlong(chunk)) {
        const clash = place({ ...LAUNCHER, x: lane, y: bounds.minY, layer: floor }, '출구')
        if (clash) return { ok: false, reason: clash }
        group.push({ x: lane, y: bounds.minY, z: floor, facing: DOWNSTREAM })
      }
    }
    quarters.push(group)
  }
  // the fourth group leaves back along the intake edge, which has two more
  // places on it — the intake only uses the first chunk. Sending it down the
  // side instead costs a band of rows kept clear of machines right where the
  // stages want to be, and there are none to spare
  {
    const group: Stream[] = []
    for (let floor = 0; floor < MODULE_FLOORS; floor++) {
      for (const lane of groupAlong(1)) {
        const clash = place(
          { type: LAUNCHER.type, x: lane, y: bounds.maxY, layer: floor, rotation: BACKWARD },
          '되돌아가는 출구',
        )
        if (clash) return { ok: false, reason: clash }
        group.push({ x: lane, y: bounds.maxY, z: floor, facing: BACKWARD })
      }
    }
    quarters.push(group)
  }

  // ── the stages ───────────────────────────────────────────────────────────
  const first = bounds.minX + 1
  const cursor: Cursor = { row: MODULE_INTAKE_ROW - 1 - stageGap }
  const nets: Net[] = []
  let machines = 0

  const banksAcross = (bank: number) => Math.floor((bounds.maxX - first + 1) / (bank + 1))

  // nothing leaves down the sides any more, so no band of rows has to be kept
  // clear and the stages can run straight down the platform
  const clearOfSide = (): boolean => false

  /**
   * A stage of cutters: each lane spread over four, both halves gathered.
   *
   * The two halves leave a cutter side by side and cannot share a column, so
   * one carries on and the other drops a floor where it stands — the same trick
   * the plain cutter module uses.
   */
  const cutStage = (lanes: Stream[], label: string): { kept: Stream[]; dropped: Stream[] } | string => {
    const perRow = banksAcross(CUT_BANK)
    if (perRow < 1) return `${label}: 뱅크가 안 들어갑니다`
    const stride = Math.floor((bounds.maxX - first + 1) / perRow)

    const kept: Stream[] = []
    const dropped: Stream[] = []
    let done = 0

    while (done < lanes.length) {
      if (clearOfSide()) continue
      if (cursor.row - CUT_ROWS < bounds.minY) return `${label}: 플랫폼이 모자랍니다`

      const feedRow = cursor.row
      const machineRow = feedRow - 1
      const dropRow = feedRow - 2
      const gatherRow = feedRow - 3

      for (let bank = 0; bank < perRow && done < lanes.length; bank++, done++) {
        const start = first + bank * stride
        const anchors = Array.from({ length: CUTTERS_PER_LANE }, (_, i) => start + i * 2 + 1)
        const paired = anchors.map((anchor) => anchor - 1)
        const side: Side = -1

        for (const tile of comb(anchors, side, feedRow, false)) {
          const clash = place({ ...tile.piece, x: tile.x, y: tile.y, layer: MACHINE_FLOOR }, label)
          if (clash) return clash
        }
        for (const anchor of anchors) {
          machines += 1
          const clash =
            place(
              {
                type: OPERATION_BUILDING.cut,
                x: anchor,
                y: machineRow,
                layer: MACHINE_FLOOR,
                rotation: DOWNSTREAM,
              },
              label,
            ) ??
            place(
              {
                type: 'BeltDefaultForwardInternalVariant',
                x: anchor,
                y: dropRow,
                layer: MACHINE_FLOOR,
                rotation: DOWNSTREAM,
              },
              label,
            ) ??
            place(
              {
                type: 'Lift1DownForwardInternalVariant',
                x: anchor - 1,
                y: dropRow,
                layer: MACHINE_FLOOR,
                rotation: DOWNSTREAM,
              },
              label,
            )
          if (clash) return clash
        }
        for (const tile of comb(anchors, side, gatherRow, true)) {
          const clash = place({ ...tile.piece, x: tile.x, y: tile.y, layer: MACHINE_FLOOR }, label)
          if (clash) return clash
        }
        for (const tile of comb(paired, side, gatherRow, true)) {
          const clash = place({ ...tile.piece, x: tile.x, y: tile.y, layer: DROPPED_FLOOR }, label)
          if (clash) return clash
        }

        const entry = anchors[anchors.length - 1]
        const pairedEntry = paired[paired.length - 1]
        nets.push({
          from: lanes[done],
          to: { x: entry, y: feedRow, z: MACHINE_FLOOR, facing: DOWNSTREAM },
          label: `${label} ${done + 1}번 공급`,
        })
        kept.push({ x: entry, y: gatherRow - 1, z: MACHINE_FLOOR, facing: DOWNSTREAM })
        dropped.push({ x: pairedEntry, y: gatherRow - 1, z: DROPPED_FLOOR, facing: DOWNSTREAM })
      }
      cursor.row -= CUT_ROWS + gap
    }
    cursor.row -= stageGap
    return { kept, dropped }
  }

  /** A stage of rotators: one lane to a bank, nothing to separate. */
  const turnStage = (lanes: Stream[], label: string): Stream[] | string => {
    const perRow = banksAcross(TURN_BANK)
    if (perRow < 1) return `${label}: 뱅크가 안 들어갑니다`
    const stride = Math.floor((bounds.maxX - first + 1) / perRow)

    const out: Stream[] = []
    let done = 0
    while (done < lanes.length) {
      if (clearOfSide()) continue
      if (cursor.row - TURN_ROWS < bounds.minY) return `${label}: 플랫폼이 모자랍니다`

      const feedRow = cursor.row
      const machineRow = feedRow - 1
      const gatherRow = feedRow - 2

      for (let bank = 0; bank < perRow && done < lanes.length; bank++, done++) {
        const start = first + bank * stride
        const anchors = Array.from({ length: ROTATORS_PER_LANE }, (_, i) => start + i)
        const side: Side = -1

        for (const tile of comb(anchors, side, feedRow, false)) {
          const clash = place({ ...tile.piece, x: tile.x, y: tile.y, layer: MACHINE_FLOOR }, label)
          if (clash) return clash
        }
        for (const anchor of anchors) {
          machines += 1
          const clash = place(
            {
              type: OPERATION_BUILDING.r90cw,
              x: anchor,
              y: machineRow,
              layer: MACHINE_FLOOR,
              rotation: DOWNSTREAM,
            },
            label,
          )
          if (clash) return clash
        }
        for (const tile of comb(anchors, side, gatherRow, true)) {
          const clash = place({ ...tile.piece, x: tile.x, y: tile.y, layer: MACHINE_FLOOR }, label)
          if (clash) return clash
        }

        const entry = anchors[anchors.length - 1]
        nets.push({
          from: lanes[done],
          to: { x: entry, y: feedRow, z: MACHINE_FLOOR, facing: DOWNSTREAM },
          label: `${label} ${done + 1}번 공급`,
        })
        out.push({ x: entry, y: gatherRow - 1, z: MACHINE_FLOOR, facing: DOWNSTREAM })
      }
      cursor.row -= TURN_ROWS + gap
    }
    cursor.row -= stageGap
    return out
  }

  const halved = cutStage(intake, '1차 절단')
  if (typeof halved === 'string') return { ok: false, reason: halved }

  const turned = turnStage([...halved.kept, ...halved.dropped], '회전')
  if (typeof turned === 'string') return { ok: false, reason: turned }

  const quartered = cutStage(turned, '2차 절단')
  if (typeof quartered === 'string') return { ok: false, reason: quartered }

  // the four quarters, in the order the cuts made them
  const groups = [
    quartered.kept.slice(0, MODULE_LANES),
    quartered.dropped.slice(0, MODULE_LANES),
    quartered.kept.slice(MODULE_LANES),
    quartered.dropped.slice(MODULE_LANES),
  ]
  for (const [index, group] of groups.entries()) {
    for (const [lane, from] of group.entries()) {
      nets.push({ from, to: quarters[index][lane], label: `${index + 1}번째 조각 ${lane + 1}줄` })
    }
  }

  const wiring = routeAll(occupancy, nets, { rounds: 400, ...tune })
  if ('stuck' in wiring) return { ok: false, reason: `${wiring.stuck.join(', ')}를 잇지 못했습니다` }
  placements.push(...wiring.paths.flat())

  return {
    ok: true,
    placements,
    platform: platform.type,
    lanesIn: MODULE_LANES,
    lanesOut: MODULE_LANES * 4,
    machines,
    rounds: wiring.rounds,
    notes: [
      `벨트 ${MODULE_LANES}줄이 들어와 ${MODULE_LANES * 4}줄로 나갑니다 — 조각 네 종류에 ${MODULE_LANES}줄씩.`,
      `절단기 ${CUTTERS_PER_LANE * MODULE_LANES * 3}대와 회전기 ${ROTATORS_PER_LANE * MODULE_LANES * 2}대가 들어갑니다.`,
    ],
    warnings: [
      '조각 네 종류가 아래쪽 가장자리 세 자리와 왼쪽 가장자리 한 자리로 나뉘어 나옵니다.',
      '어느 자리가 어느 조각인지는 게임에서 한 번 확인해 보세요 — 절단기 두 출구의 구분은 아직 재지 못했습니다.',
      `${wide}x${long} 플랫폼입니다.`,
    ],
  }
}

export async function generateQuadModule(
  icon?: string,
): Promise<{ layout: QuadModuleResult; code: string | null }> {
  const layout = layoutQuadModule()
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
