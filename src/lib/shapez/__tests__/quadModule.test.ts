import { describe, expect, it } from 'vitest'

import { CHUNK_TILES, MODULE_LANES, platformFor } from '../module'
import { applyOperation } from '../operations'
import { layoutQuadModule } from '../quadModule'
import { parseShapeCode, toShapeCode } from '../shapeCode'
import { QUAD_CONFIG, operationConfig } from '../types'

/**
 * Quartering a shape, and why it does not fit on one platform.
 *
 * The recipe is checked against the simulator so the claim is not folklore, and
 * the module is checked to fail in the way it actually fails — every machine
 * placed, no room left for the belts — so that a future attempt starts from the
 * real obstacle rather than from scratch.
 */
describe('quartering a shape', () => {
  const config = operationConfig(QUAD_CONFIG, 'normal')

  it('takes a cut, a turn and another cut', () => {
    const parsed = parseShapeCode('CuRuSuWu', QUAD_CONFIG)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const halves = applyOperation('cut', [parsed.shape], config)
    expect(halves.map(toShapeCode)).toEqual(['----SuWu', 'CuRu----'])

    // a cutter always parts the same two quadrants from the other two, so the
    // halves have to be turned before the seam faces the blade again
    const quarters = halves.flatMap((half) =>
      applyOperation('cut', applyOperation('r90cw', [half], config), config),
    )
    expect(quarters.map(toShapeCode).sort()).toEqual([
      '------Su',
      '----Ru--',
      '--Cu----',
      'Wu------',
    ])
    // four quarters from one shape, so four times the lanes come out
    expect(quarters).toHaveLength(4)
  })

  it('would need four twelve-lane groups, and an edge has room for them', () => {
    // three chunks across means three places along an edge, plus the two spare
    // places on the intake edge — so where the outputs go was never the problem
    const platform = platformFor(3, 3)!
    const acrossChunks = Math.round((platform.area.maxX + 1 + 2) / CHUNK_TILES)
    expect(acrossChunks).toBe(3)
    expect(MODULE_LANES * 4).toBe(48)
  })

  it('does not fit, having placed every machine first', () => {
    // if this ever passes, the packing improved and the layout should be
    // finished rather than this test loosened
    const result = layoutQuadModule()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason, '기계는 다 놓여야 합니다').not.toMatch(/겹칩니다|모자랍니다/)
      expect(result.reason).toMatch(/잇지 못했습니다/)
    }
  })
})
