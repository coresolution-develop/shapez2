import { describe, expect, it } from 'vitest'

import { decodeBlueprint } from '../blueprint'
import {
  CHUNK_MARGIN,
  CHUNK_TILES,
  MODULE_FIRST_LANE,
  MODULE_FLOORS,
  MODULE_INTAKE_ROW,
  MODULE_LANES,
  MODULE_LANES_PER_FLOOR,
  MODULE_SIDE_INTAKE_COLUMN,
  OPERATION_BUILDING,
} from '../module'
import { wiringProblems } from '../route'
import { generateStackerModule, layoutStackerModule } from '../stackerModule'
import { BELT_BASE_RATE, OPERATION_SPECS, ratedThroughput } from '../throughput'

/**
 * The one module whose belts were not written down but searched for.
 *
 * That makes the checks here matter more than usual rather than less: a router
 * will happily hand back something that reaches the right tile by a route that
 * loses every shape on it, and nothing about the shape of the code would show
 * it. So the blueprint is decoded again and read port by port, in both
 * directions — nothing may draw from a face that emits nothing, and nothing may
 * push into a face that accepts nothing.
 */
describe('the stacker module', () => {
  const built = layoutStackerModule()

  it('lays out at all', () => {
    expect(built.ok, built.ok ? '' : built.reason).toBe(true)
  })

  it('holds enough machines to keep every lane full', () => {
    if (!built.ok) return
    const perLane = Math.ceil(BELT_BASE_RATE / ratedThroughput(OPERATION_SPECS.stack, 100))
    expect(perLane).toBe(6)
    expect(built.machines).toBe(MODULE_LANES * perLane)

    const stackers = built.placements.filter((p) => p.type === OPERATION_BUILDING.stack)
    expect(stackers).toHaveLength(built.machines)
  })

  it('stands every machine on the same floor pair, as the reference does', () => {
    if (!built.ok) return
    // a stacker fills two floors, so putting them all on one floor is what
    // leaves a whole floor clear underneath for belts to cross the module on
    const floors = new Set(
      built.placements.filter((p) => p.type === OPERATION_BUILDING.stack).map((p) => p.layer),
    )
    expect([...floors]).toEqual([1])
  })

  it('takes twenty-four lanes in and gives twelve back', () => {
    if (!built.ok) return
    const catchers = built.placements.filter((p) => p.type.startsWith('BeltPortReceiver'))
    const launchers = built.placements.filter((p) => p.type.startsWith('BeltPortSender'))

    expect(catchers).toHaveLength(MODULE_LANES * 2)
    expect(launchers).toHaveLength(MODULE_LANES)

    const lanes = [...Array(MODULE_LANES_PER_FLOOR).keys()].map((i) => MODULE_FIRST_LANE + i)
    const intake = catchers.filter((p) => p.y === MODULE_INTAKE_ROW)
    const side = catchers.filter((p) => p.x === MODULE_SIDE_INTAKE_COLUMN)
    expect(intake).toHaveLength(MODULE_LANES)
    expect(side).toHaveLength(MODULE_LANES)
    expect([...new Set(intake.map((p) => p.x))].sort((a, b) => a! - b!)).toEqual(lanes)
    expect([...new Set(side.map((p) => p.y))].sort((a, b) => a! - b!)).toEqual(lanes)

    for (const floor of [0, 1, 2]) {
      expect(intake.filter((p) => p.layer === floor), `intake floor ${floor}`).toHaveLength(
        MODULE_LANES_PER_FLOOR,
      )
      expect(side.filter((p) => p.layer === floor), `side floor ${floor}`).toHaveLength(
        MODULE_LANES_PER_FLOOR,
      )
    }
  })

  it('stays on its platform, margins and all', () => {
    if (!built.ok) return
    for (const placement of built.placements) {
      expect(placement.x).toBeGreaterThanOrEqual(CHUNK_MARGIN)
      expect(placement.x).toBeLessThanOrEqual(CHUNK_TILES - CHUNK_MARGIN - 1)
      expect(placement.y).toBeLessThanOrEqual(MODULE_INTAKE_ROW)
      expect(placement.layer).toBeLessThan(MODULE_FLOORS)
    }
    // no wider than one chunk, however long it gets — see the README
    const xs = built.placements.map((p) => p.x ?? 0)
    expect(Math.max(...xs) - Math.min(...xs) + 1).toBeLessThanOrEqual(
      CHUNK_TILES - 2 * CHUNK_MARGIN,
    )
  })

  it('wires every port, both ways round', () => {
    if (!built.ok) return
    expect(wiringProblems(built.placements)).toEqual([])
  })

  it('comes back out of the encoder the way it went in', async () => {
    const made = await generateStackerModule()
    expect(made.code).not.toBeNull()
    if (!made.code || !made.layout.ok) return

    const blueprint = await decodeBlueprint(made.code)
    expect(blueprint.kind).toBe('island')
    expect(blueprint.islands).toHaveLength(1)
    expect(blueprint.buildings).toHaveLength(made.layout.placements.length)
    // the decoder expands every footprint, so this is the real overlap check
    const tiles = blueprint.buildings.flatMap((b) => b.tiles.map((t) => `${t.x},${t.y},${t.z}`))
    expect(new Set(tiles).size, '두 건물이 같은 칸을 차지합니다').toBe(tiles.length)
  })
})
