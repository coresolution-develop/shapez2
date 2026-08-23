import { describe, expect, it } from 'vitest'

import {
  CHUNK_MARGIN,
  MODULE_FIRST_LANE,
  MODULE_INTAKE_ROW,
  MODULE_LANES,
  MODULE_LANES_PER_FLOOR,
  OPERATION_BUILDING,
  platformFor,
} from '../module'
import { layoutCutterModule } from '../cutterModule'
import { wiringProblems } from '../route'
import { BELT_BASE_RATE, OPERATION_SPECS, ratedThroughput } from '../throughput'

/**
 * A cutter module, on a platform wide enough to hold one.
 *
 * It spent a while not fitting, and the reason was an assumption rather than a
 * shortage: both modules a player had built were one chunk wide, and this
 * repository read that as what modules are. The game has wider foundations, and
 * on one of those the same arrangement goes in with room to spare.
 */
describe('the cutter module', () => {
  const roomy = layoutCutterModule()

  it('wires up completely, both ways round', () => {
    expect(roomy.ok, roomy.ok ? '' : roomy.reason).toBe(true)
    if (!roomy.ok) return
    expect(wiringProblems(roomy.placements)).toEqual([])
  })

  it('holds enough cutters to keep every lane full', () => {
    if (!roomy.ok) return
    const perLane = Math.ceil(BELT_BASE_RATE / ratedThroughput(OPERATION_SPECS.cut, 100))
    expect(perLane).toBe(4)
    expect(roomy.machines).toBe(MODULE_LANES * perLane)
    expect(roomy.placements.filter((p) => p.type === OPERATION_BUILDING.cut)).toHaveLength(
      roomy.machines,
    )
  })

  it('takes twelve lanes in and gives twenty-four back', () => {
    if (!roomy.ok) return
    const catchers = roomy.placements.filter((p) => p.type.startsWith('BeltPortReceiver'))
    const launchers = roomy.placements.filter((p) => p.type.startsWith('BeltPortSender'))
    expect(catchers).toHaveLength(MODULE_LANES)
    expect(launchers).toHaveLength(MODULE_LANES * 2)

    // one dozen leave the far edge and one dozen the side, and the side ones
    // sit where a stacker module's second intake expects to catch them
    const sideways = launchers.filter((p) => p.x === CHUNK_MARGIN)
    expect(sideways).toHaveLength(MODULE_LANES)
    const rows = [...new Set(sideways.map((p) => p.y))].sort((a, b) => a! - b!)
    expect(rows).toEqual(
      [...Array(MODULE_LANES_PER_FLOOR).keys()].map((i) => MODULE_FIRST_LANE + i),
    )
  })

  it('keeps the two halves apart by putting a floor between them', () => {
    if (!roomy.ok) return
    // both halves leave a cutter side by side, and two streams cannot share a
    // column — so one drops a floor where it stands
    const lifts = roomy.placements.filter((p) => p.type.startsWith('Lift1Down'))
    expect(lifts.length).toBeGreaterThanOrEqual(roomy.machines)
  })

  it('stays on its platform, margins and all', () => {
    if (!roomy.ok) return
    const platform = platformFor(2, 3)!
    for (const placement of roomy.placements) {
      expect(placement.x).toBeGreaterThanOrEqual(platform.area.minX)
      expect(placement.x).toBeLessThanOrEqual(platform.area.maxX)
      expect(placement.y).toBeGreaterThanOrEqual(platform.area.minY)
      expect(placement.y).toBeLessThanOrEqual(platform.area.maxY)
    }
    // the lanes are where a one-chunk module puts them, so the two still chain
    expect(platform.area.maxY).toBe(MODULE_INTAKE_ROW)
  })

  it('will not go on a platform too small for it, and says which', () => {
    const cramped = layoutCutterModule(2, 2)
    expect(cramped.ok).toBe(false)
    if (!cramped.ok) expect(cramped.reason).toMatch(/들어가지 않습니다/)
  })
})
