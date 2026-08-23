import { describe, expect, it } from 'vitest'

import { Occupancy, routeBelt, tilesOf, wiringProblems } from '../route'
import type { Bounds } from '../route'

const ROOM: Bounds = { minX: 0, maxX: 19, minY: 0, maxY: 19, floors: 3 }

const room = () => new Occupancy(ROOM)

/**
 * The router only ever places pieces this repository has measured, so the test
 * it has to pass is the same one every generated blueprint has to pass: read
 * the path back and check each piece really draws from the one behind it.
 */
describe('routing a belt', () => {
  it('runs straight when nothing is in the way', () => {
    const path = routeBelt(room(), { x: 2, y: 10, z: 0, facing: 0 }, { x: 8, y: 10, z: 0, facing: 0 })
    expect(path).not.toBeNull()
    expect(path!.length).toBe(6)
    expect(new Set(path!.placements.map((p) => p.type))).toEqual(
      new Set(['BeltDefaultForwardInternalVariant']),
    )
    expect(wiringProblems(path!.placements)).toEqual([])
  })

  it('turns a corner, and every piece still draws from the one behind', () => {
    const path = routeBelt(room(), { x: 2, y: 2, z: 0, facing: 0 }, { x: 9, y: 9, z: 0, facing: 1 })
    expect(path).not.toBeNull()
    expect(wiringProblems(path!.placements)).toEqual([])
    // no free lunch: a corner costs the same as going straight, so the path is
    // as long as the distance and no longer
    expect(path!.length).toBe(7 + 7)
  })

  it('goes round something in the way', () => {
    const occupancy = room()
    for (let y = 0; y <= 12; y++) {
      occupancy.claim({ type: 'BeltDefaultForwardInternalVariant', x: 5, y, layer: 0 })
    }
    const path = routeBelt(occupancy, { x: 2, y: 14, z: 0, facing: 0 }, { x: 9, y: 14, z: 0, facing: 0 })
    expect(path).not.toBeNull()
    expect(wiringProblems(path!.placements)).toEqual([])
    expect(path!.placements.every((p) => p.x !== 5 || (p.y ?? 0) > 12)).toBe(true)
  })

  it('climbs a floor with a lift, which is two floors tall', () => {
    const path = routeBelt(room(), { x: 2, y: 5, z: 0, facing: 0 }, { x: 8, y: 5, z: 1, facing: 0 })
    expect(path).not.toBeNull()
    expect(wiringProblems(path!.placements)).toEqual([])

    const lift = path!.placements.find((p) => p.type.startsWith('Lift'))
    expect(lift, 'a floor change needs a lift').toBeDefined()
    expect(tilesOf(lift!.type, lift!.rotation ?? 0)).toHaveLength(2)
  })

  it('refuses rather than inventing a way through', () => {
    const occupancy = room()
    for (let y = 0; y <= 19; y++) {
      for (let z = 0; z < 3; z++) {
        occupancy.claim({ type: 'BeltDefaultForwardInternalVariant', x: 5, y, layer: z })
      }
    }
    expect(
      routeBelt(occupancy, { x: 2, y: 10, z: 0, facing: 0 }, { x: 9, y: 10, z: 0, facing: 0 }),
    ).toBeNull()
  })

  it('keeps out of tiles an earlier path already took', () => {
    const occupancy = room()
    const first = routeBelt(occupancy, { x: 2, y: 10, z: 0, facing: 0 }, { x: 12, y: 10, z: 0, facing: 0 })
    const second = routeBelt(occupancy, { x: 2, y: 11, z: 0, facing: 0 }, { x: 12, y: 11, z: 0, facing: 0 })
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()

    const cells = [...first!.placements, ...second!.placements].map(
      (p) => `${p.x},${p.y},${p.layer ?? 0}`,
    )
    expect(new Set(cells).size, 'two paths sharing a tile').toBe(cells.length)
  })
})
