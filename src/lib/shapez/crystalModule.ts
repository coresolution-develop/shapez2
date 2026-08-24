/**
 * A module for the last machine that did not have one.
 *
 * The crystal generator is awkward in two ways at once, which is why it held
 * out longest. It is 1x2 in plan like a painter, and it is also two floors
 * tall — the tile above it is part of the machine. Every layout in this
 * repository that works per floor therefore refused it: a generator standing on
 * the top floor would need a fourth one to exist.
 *
 * Both problems go away at the same time if the machines are turned sideways
 * and stood in ladders, the way a painter module is built. Turned that way a
 * generator is one column wide, two rows deep, and eats one tile of the floor
 * above its own — so putting every ladder on the ground floor leaves the top
 * floor clear from end to end and the middle floor clear everywhere except the
 * machine columns. The module a player built agrees on the principle: all of
 * its generators are on the bottom two floors and none on the top.
 *
 *   raw trunk ─┬─ generator ─→ results trunk     three columns to a lane
 *              ↓        ↑
 *              ├─ generator ─→
 *              ↓   (a spare row between them, for the paint)
 *              └─ generator ─→
 *
 * Twelve of those side by side would fill the width exactly, so they are laid
 * in bands instead — a few ladders across, a few bands down the module — which
 * leaves columns over for the streams that have to get past them.
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
  PIECE,
  platformFor,
  type Platform,
} from './module'
import { Occupancy, routeAll, type Bounds, type Endpoint, type Facing, type Net } from './route'

/** Generators to a lane, to keep a belt full at 20 shapes a minute. */
const PER_LANE = 6

const DOWNSTREAM: Facing = 3
/** The machines face across the flow, which is what makes them one wide. */
const SIDEWAYS: Facing = 0

/** Ladders stand on the ground floor, so nothing needs a fourth one. */
const MACHINE_FLOOR = 0

/** Columns a ladder takes: the raw trunk, the machines, the results trunk. */
const LADDER_COLUMNS = 3
/**
 * Rows between one generator and the next.
 *
 * Two of them are the machine — it is two rows deep turned this way — and the
 * third is a spare face for the paint. Packed tight, a generator's only free
 * neighbours are other generators and there is nowhere to pipe into.
 */
const RUNG_PITCH = 3

/** Rows above the first rung and below the last, for the streams to arrive in. */
const BAND_MARGIN = 2

const PLATFORM_WIDE = 2
/**
 * Four chunks long, not three.
 *
 * A ladder is seventeen rows deep and twelve of them do not go three bands into
 * three chunks. Squeezing six ladders into a band instead fills the width and
 * then no stream can get past them — the same wall the cutter ran into.
 */
const PLATFORM_LONG = 4
/** Ladders side by side in one band, and how far apart they stand. */
const LADDERS_PER_BAND = 4
const LADDER_STRIDE = 8

export interface CrystalModule {
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

export interface CrystalFailure {
  ok: false
  reason: string
}

export type CrystalModuleResult = CrystalModule | CrystalFailure

interface Ladder {
  raw: number
  machine: number
  done: number
  /** Rows the generators are fed at, top to bottom. */
  rungs: number[]
}

function planLadders(bounds: Bounds, perBand: number, stride: number): Ladder[] | null {
  if (stride < LADDER_COLUMNS + 1) return null
  const first = bounds.minX + 1
  if (first + (perBand - 1) * stride + LADDER_COLUMNS - 1 > bounds.maxX) return null

  const depth = (PER_LANE - 1) * RUNG_PITCH + 2
  const ladders: Ladder[] = []
  let top = MODULE_INTAKE_ROW - 1 - BAND_MARGIN

  while (ladders.length < MODULE_LANES) {
    if (top - depth < bounds.minY + BAND_MARGIN) return null
    for (let bay = 0; bay < perBand && ladders.length < MODULE_LANES; bay++) {
      const raw = first + bay * stride
      ladders.push({
        raw,
        machine: raw + 1,
        done: raw + 2,
        rungs: Array.from({ length: PER_LANE }, (_, k) => top - k * RUNG_PITCH),
      })
    }
    top -= depth + BAND_MARGIN
  }
  return ladders
}

function edgeLanes(): { lane: number; floor: number }[] {
  const lanes: { lane: number; floor: number }[] = []
  for (let floor = 0; floor < MODULE_FLOORS; floor++) {
    for (let lane = 0; lane < MODULE_LANES_PER_FLOOR; lane++) {
      lanes.push({ lane: MODULE_FIRST_LANE + lane, floor })
    }
  }
  return lanes
}

export function layoutCrystalModule(
  wide = PLATFORM_WIDE,
  long = PLATFORM_LONG,
  perBand = LADDERS_PER_BAND,
  stride = LADDER_STRIDE,
  tune: { memory?: number; crowd?: number; rounds?: number } = {},
): CrystalModuleResult {
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

  const intakes: Endpoint[] = []
  const outlets: Endpoint[] = []
  for (const { lane, floor } of edgeLanes()) {
    const inbound = place({ ...CATCHER, x: lane, y: MODULE_INTAKE_ROW, layer: floor }, '입구')
    if (inbound) return { ok: false, reason: inbound }
    intakes.push({ x: lane, y: MODULE_INTAKE_ROW - 1, z: floor, facing: DOWNSTREAM })

    const ahead = place({ ...LAUNCHER, x: lane, y: bounds.minY, layer: floor }, '출구')
    if (ahead) return { ok: false, reason: ahead }
    outlets.push({ x: lane, y: bounds.minY, z: floor, facing: DOWNSTREAM })
  }

  const ladders = planLadders(bounds, perBand, stride)
  if (!ladders) {
    return {
      ok: false,
      reason: `결정체 생성기 줄 ${MODULE_LANES}개가 ${wide}x${long} 플랫폼에 들어가지 않습니다`,
    }
  }

  const generator = OPERATION_BUILDING.crystal
  for (const ladder of ladders) {
    const first = ladder.rungs[0]
    const last = ladder.rungs[ladder.rungs.length - 1]

    for (const rung of ladder.rungs) {
      // the raw trunk sheds one share into each generator on its way down, and
      // the last rung takes everything that is left
      const shed = place(
        {
          ...(rung === last ? PIECE.downToRight : PIECE.splitHeadRight),
          x: ladder.raw,
          y: rung,
          layer: MACHINE_FLOOR,
        },
        '공급 배선',
      )
      if (shed) return { ok: false, reason: shed }

      const machine = place(
        { type: generator, x: ladder.machine, y: rung, layer: MACHINE_FLOOR, rotation: SIDEWAYS },
        '결정체 생성기',
      )
      if (machine) return { ok: false, reason: machine }

      const collect = place(
        {
          ...(rung === first ? PIECE.rightToDown : PIECE.mergeEndRight),
          x: ladder.done,
          y: rung,
          layer: MACHINE_FLOOR,
        },
        '회수 배선',
      )
      if (collect) return { ok: false, reason: collect }
    }

    // plain belt between the rungs, on both trunks
    const rungRows = new Set(ladder.rungs)
    for (let y = first; y >= last; y--) {
      if (rungRows.has(y)) continue
      for (const column of [ladder.raw, ladder.done]) {
        const belt = place({ ...PIECE.down, x: column, y, layer: MACHINE_FLOOR }, '기둥')
        if (belt) return { ok: false, reason: belt }
      }
    }
  }

  const nets: Net[] = ladders.flatMap((ladder, index): Net[] => [
    {
      from: intakes[index],
      to: { x: ladder.raw, y: ladder.rungs[0], z: MACHINE_FLOOR, facing: DOWNSTREAM },
      label: `${index + 1}번 줄 공급`,
    },
    {
      from: {
        x: ladder.done,
        y: ladder.rungs[ladder.rungs.length - 1] - 1,
        z: MACHINE_FLOOR,
        facing: DOWNSTREAM,
      },
      to: outlets[index],
      label: `${index + 1}번 줄 회수`,
    },
  ])

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
      `벨트 ${MODULE_LANES}줄이 들어와 ${MODULE_LANES}줄로 나갑니다.`,
      `결정체 생성기 ${machines}대가 들어갑니다 — 벨트가 가득 찬 채로 나갑니다.`,
    ],
    warnings: [
      '결정체 생성기가 넓고 층도 2개를 차지해서, 눕혀서 세로로 늘어놓았습니다.',
      '물감은 직접 연결하세요 — 생성기마다 왼쪽 위 칸이 파이프 자리입니다(측정값). 기계 사이를 한 칸씩 띄워 뒀습니다.',
      `${wide}x${long} 플랫폼입니다.`,
    ],
  }
}

export async function generateCrystalModule(
  icon?: string,
): Promise<{ layout: CrystalModuleResult; code: string | null }> {
  const layout = layoutCrystalModule()
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
