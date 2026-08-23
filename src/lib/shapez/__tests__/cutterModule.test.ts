import { describe, expect, it } from 'vitest'

import {
  CHUNK_MARGIN,
  CHUNK_TILES,
  MODULE_FIRST_LANE,
  MODULE_INTAKE_ROW,
  MODULE_LANES,
  MODULE_LANES_PER_FLOOR,
  OPERATION_BUILDING,
} from '../module'
import { LONGEST_PLATFORM_CHUNKS, layoutCutterModule } from '../cutterModule'
import { wiringProblems } from '../route'
import { BELT_BASE_RATE, OPERATION_SPECS, ratedThroughput } from '../throughput'

/**
 * The cutter module is right and does not fit, which are two different things.
 *
 * Given a platform one chunk longer than the game has, every belt joins up and
 * every port meets a real one — so the arrangement is sound. On the longest
 * straight foundation there actually is, the streams cannot be untangled. The
 * tests say both, because "it does not work" and "it does not fit" would send
 * whoever picks this up next in quite different directions.
 */
describe('the cutter module', () => {
  // one chunk past what the game offers, to show the layout itself is sound
  const roomy = layoutCutterModule(LONGEST_PLATFORM_CHUNKS + 1, 2)

  it('wires up completely when there is room for it', () => {
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

  it('stays inside one chunk across, however long it gets', () => {
    if (!roomy.ok) return
    for (const placement of roomy.placements) {
      expect(placement.x).toBeGreaterThanOrEqual(CHUNK_MARGIN)
      expect(placement.x).toBeLessThanOrEqual(CHUNK_TILES - CHUNK_MARGIN - 1)
      expect(placement.y).toBeLessThanOrEqual(MODULE_INTAKE_ROW)
    }
  })

  it('does not fit on the longest platform the game has, and says so', () => {
    // `Foundation_1x4` is as long as a straight foundation goes. Change this
    // test when the module gets small enough — do not change it to hide that
    // it does not.
    const cramped = layoutCutterModule()
    expect(cramped.ok).toBe(false)
    if (!cramped.ok) expect(cramped.reason).toMatch(/들어가지 않습니다|잇지 못했습니다/)
  })
})
