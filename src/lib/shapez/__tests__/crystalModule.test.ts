import { describe, expect, it } from 'vitest'

import { decodeBlueprint } from '../blueprint'
import {
  MODULE_FIRST_LANE,
  MODULE_FLOORS,
  MODULE_INTAKE_ROW,
  MODULE_LANES,
  MODULE_LANES_PER_FLOOR,
  OPERATION_BUILDING,
  platformFor,
} from '../module'
import { generateCrystalModule, layoutCrystalModule } from '../crystalModule'
import { tilesOf, wiringProblems } from '../route'
import { BELT_BASE_RATE, OPERATION_SPECS, ratedThroughput } from '../throughput'

/**
 * The crystal generator held out longest, being both 1x2 in plan and two
 * floors tall. Turned sideways into a ladder it stops being either problem —
 * one column wide, and eating only the floor directly above its own, which is
 * why every ladder can stand on the ground and leave the top floor clear.
 */
describe('the crystal generator module', () => {
  const built = layoutCrystalModule()

  it('wires up completely, both ways round', () => {
    expect(built.ok, built.ok ? '' : built.reason).toBe(true)
    if (!built.ok) return
    expect(wiringProblems(built.placements)).toEqual([])
  })

  it('holds enough generators to keep every lane full', () => {
    if (!built.ok) return
    const perLane = Math.ceil(BELT_BASE_RATE / ratedThroughput(OPERATION_SPECS.crystal, 100))
    expect(perLane).toBe(6)
    expect(built.machines).toBe(MODULE_LANES * perLane)
    expect(built.placements.filter((p) => p.type === OPERATION_BUILDING.crystal)).toHaveLength(
      built.machines,
    )
  })

  it('never asks for a floor above the top one', () => {
    if (!built.ok) return
    // a generator standing on the top floor would need a fourth to exist, which
    // is what stopped every earlier layout taking it
    for (const placement of built.placements) {
      for (const [, , dz] of tilesOf(placement.type, placement.rotation ?? 0)) {
        expect((placement.layer ?? 0) + dz).toBeLessThan(MODULE_FLOORS)
        expect((placement.layer ?? 0) + dz).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('leaves a face free on every generator for the paint', () => {
    if (!built.ok) return
    const filled = new Set(
      built.placements.flatMap((p) =>
        tilesOf(p.type, p.rotation ?? 0).map(
          ([dx, dy, dz]) => `${(p.x ?? 0) + dx},${(p.y ?? 0) + dy},${(p.layer ?? 0) + dz}`,
        ),
      ),
    )
    for (const machine of built.placements.filter((p) => p.type === OPERATION_BUILDING.crystal)) {
      const rows = tilesOf(machine.type, machine.rotation ?? 0)
        .filter(([, , dz]) => dz === 0)
        .map(([, dy]) => (machine.y ?? 0) + dy)
      const open = [Math.max(...rows) + 1, Math.min(...rows) - 1].filter(
        (y) => !filled.has(`${machine.x},${y},${machine.layer ?? 0}`),
      )
      expect(open.length, `(${machine.x},${machine.y})에 파이프 넣을 면이 없습니다`).toBeGreaterThan(
        0,
      )
    }
  })

  it('keeps the twelve lanes where every other module puts them', () => {
    if (!built.ok) return
    const platform = platformFor(2, 4)!
    const catchers = built.placements.filter((p) => p.type.startsWith('BeltPortReceiver'))
    const launchers = built.placements.filter((p) => p.type.startsWith('BeltPortSender'))
    expect(catchers).toHaveLength(MODULE_LANES)
    expect(launchers).toHaveLength(MODULE_LANES)
    expect(catchers.every((p) => p.y === MODULE_INTAKE_ROW)).toBe(true)
    expect(launchers.every((p) => p.y === platform.area.minY)).toBe(true)

    const lanes = [...Array(MODULE_LANES_PER_FLOOR).keys()].map((i) => MODULE_FIRST_LANE + i)
    expect([...new Set(catchers.map((p) => p.x))].sort((a, b) => a! - b!)).toEqual(lanes)
  })

  it('comes back out of the encoder the way it went in', async () => {
    const made = await generateCrystalModule()
    expect(made.code).not.toBeNull()
    if (!made.code || !made.layout.ok) return

    const blueprint = await decodeBlueprint(made.code)
    expect(blueprint.kind).toBe('island')
    expect(blueprint.buildings).toHaveLength(made.layout.placements.length)
    const tiles = blueprint.buildings.flatMap((b) => b.tiles.map((t) => `${t.x},${t.y},${t.z}`))
    expect(new Set(tiles).size, '두 건물이 같은 칸을 차지합니다').toBe(tiles.length)
  })
})
