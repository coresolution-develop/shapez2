import { describe, expect, it } from 'vitest'

import { MODULE_LANES } from '../module'
import { layoutStackerModule } from '../stackerModule'

/**
 * The stacker module is half built, and this pins down which half.
 *
 * Writing a test that expects a failure looks odd until you consider the
 * alternative: the layout could just as easily hand back a blueprint with six
 * streams quietly going nowhere, and nothing here would notice. So what is
 * checked is that it refuses, that it says which stream defeated it, and that
 * the parts which *are* settled — every machine and every comb — really do fit
 * where the plan puts them.
 */
describe('the stacker module, so far', () => {
  it('refuses, and names the stream it could not wire', () => {
    const result = layoutStackerModule()
    expect(result.ok, '배치가 완성되면 이 테스트를 바꿔야 합니다').toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/잇지 못했습니다/)
      expect(result.reason).toMatch(/도형/)
    }
  })

  it('gets every machine and comb placed without a clash', () => {
    // a clash would be reported as its own kind of failure, so reaching the
    // routing stage at all is the thing being checked here
    const result = layoutStackerModule()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).not.toMatch(/겹칩니다/)
    }
  })

  it('is sized the way the module a player built is sized', () => {
    // the arithmetic is settled even though the layout is not: twelve lanes
    // out, twenty-four in, six machines to a lane
    expect(MODULE_LANES).toBe(12)
    const perLane = 6
    expect(MODULE_LANES * perLane).toBe(72)
  })
})
