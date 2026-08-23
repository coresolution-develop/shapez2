import { describe, expect, it } from 'vitest'

import { decodeBlueprint } from '../blueprint'
import {
  MODULE_FIRST_LANE,
  MODULE_INTAKE_ROW,
  MODULE_LANES,
  MODULE_LANES_PER_FLOOR,
  OPERATION_BUILDING,
  platformFor,
} from '../module'
import { wiringProblems } from '../route'
import { generateSwapperModule, layoutSwapperModule } from '../swapperModule'
import { BELT_BASE_RATE, OPERATION_SPECS, ratedThroughput } from '../throughput'

/**
 * The swapper module: a stacker's intake with a cutter's outlet, and easier
 * than either because a swapper's two lanes keep their own columns straight
 * through it. Nothing is spread and nothing is brought back together — the two
 * lanes only have to be kept out of each other's way, which is what the floors
 * are for.
 */
describe('the swapper module', () => {
  const built = layoutSwapperModule()

  it('wires up completely, both ways round', () => {
    expect(built.ok, built.ok ? '' : built.reason).toBe(true)
    if (!built.ok) return
    expect(wiringProblems(built.placements)).toEqual([])
  })

  it('holds enough swappers to keep every lane full', () => {
    if (!built.ok) return
    const perLane = Math.ceil(BELT_BASE_RATE / ratedThroughput(OPERATION_SPECS.swap, 100))
    expect(perLane).toBe(4)
    expect(built.machines).toBe(MODULE_LANES * perLane)
    expect(built.placements.filter((p) => p.type === OPERATION_BUILDING.swap)).toHaveLength(
      built.machines,
    )
  })

  it('takes twenty-four lanes in and gives twenty-four back', () => {
    if (!built.ok) return
    const platform = platformFor(2, 3)!
    const catchers = built.placements.filter((p) => p.type.startsWith('BeltPortReceiver'))
    const launchers = built.placements.filter((p) => p.type.startsWith('BeltPortSender'))
    expect(catchers).toHaveLength(MODULE_LANES * 2)
    expect(launchers).toHaveLength(MODULE_LANES * 2)

    const lanes = [...Array(MODULE_LANES_PER_FLOOR).keys()].map((i) => MODULE_FIRST_LANE + i)
    // in at the intake edge and from the right, out at the far edge and left —
    // the same places a stacker takes its second dozen and a cutter sends one
    expect(catchers.filter((p) => p.y === MODULE_INTAKE_ROW)).toHaveLength(MODULE_LANES)
    expect(catchers.filter((p) => p.x === platform.area.maxX)).toHaveLength(MODULE_LANES)
    expect(launchers.filter((p) => p.y === platform.area.minY)).toHaveLength(MODULE_LANES)
    expect(launchers.filter((p) => p.x === platform.area.minX)).toHaveLength(MODULE_LANES)

    const sideways = launchers.filter((p) => p.x === platform.area.minX)
    expect([...new Set(sideways.map((p) => p.y))].sort((a, b) => a! - b!)).toEqual(lanes)
  })

  it('keeps the two lanes on separate floors until the machine', () => {
    if (!built.ok) return
    // both lanes want the same row on the way in and again on the way out, and
    // two combs cannot share one — so each gets a floor and a lift joins them
    const lifts = built.placements.filter((p) => p.type.startsWith('Lift1Down'))
    expect(lifts.length).toBeGreaterThanOrEqual(built.machines * 2)
  })

  it('comes back out of the encoder the way it went in', async () => {
    const made = await generateSwapperModule()
    expect(made.code).not.toBeNull()
    if (!made.code || !made.layout.ok) return

    const blueprint = await decodeBlueprint(made.code)
    expect(blueprint.kind).toBe('island')
    expect(blueprint.buildings).toHaveLength(made.layout.placements.length)
    const tiles = blueprint.buildings.flatMap((b) => b.tiles.map((t) => `${t.x},${t.y},${t.z}`))
    expect(new Set(tiles).size, '두 건물이 같은 칸을 차지합니다').toBe(tiles.length)
  })
})
