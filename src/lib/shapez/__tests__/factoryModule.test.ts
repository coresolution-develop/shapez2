import { describe, expect, it } from 'vitest'

import { layoutFactoryModule } from '../factoryModule'
import { portsFor } from '../portData'
import { toWorld } from '../ports'
import presets from '../presets.json'
import { tilesOf, wiringProblems } from '../route'
import { parseShapeCode } from '../shapeCode'
import { solveShape } from '../solver'
import { QUAD_CONFIG, operationConfig } from '../types'

const plans = (presets as { code: string; scenario: string }[])
  .filter((preset) => preset.scenario === 'default')
  .flatMap((preset) => {
    const parsed = parseShapeCode(preset.code, QUAD_CONFIG)
    if (!parsed.ok) return []
    const plan = solveShape(parsed.shape, operationConfig(QUAD_CONFIG, 'normal'))
    return plan.ok && plan.root.op !== null ? [{ code: preset.code, root: plan.root }] : []
  })

const built = plans.map((plan) => ({
  ...plan,
  module: layoutFactoryModule(plan.root, { tier: 100, stackerVariant: 'straight' }),
}))
const made = built.filter((one) => one.module.ok)

/**
 * One lane of a whole plan, at as many machines as a belt's worth takes.
 *
 * Half finished, and the tests say which half. It lays out under a third of the
 * plans — the rest are turned down by name — but what it does lay out has to be
 * right, because a blueprint that looks fine and jams is the failure this
 * project keeps having and the only one worth guarding against up front.
 */
describe('the factory module', () => {
  it('lays out every plan that has a machine in it', () => {
    /**
     * All of them, which is the claim worth making and worth breaking on.
     *
     * Two machines here have ports one row apart in the same column — a cutter
     * keeping both halves, a swapper taking two shapes — and a comb needs an
     * unbroken run up that column, so the two combs cannot both have it. The
     * third floor is what settles both: a lift at the mouth carries the second
     * stream up or down a floor, where it has a column to itself.
     *
     * Written as an exact count and not a percentage, because everything that
     * ever failed here failed for a nameable reason. Any of them coming back
     * should read as a broken test rather than a number that slipped.
     */
    expect(made.length, `${made.length}/${plans.length}`).toBe(plans.length)
  })

  it('wires every blueprint it does produce', () => {
    for (const one of made) {
      if (!one.module.ok) continue
      expect(wiringProblems(one.module.placements), one.code).toEqual([])
    }
  })

  it('puts a belt on every tile a machine expects to be fed from', () => {
    for (const one of made) {
      if (!one.module.ok) continue
      const filled = new Set<string>()
      for (const placement of one.module.placements) {
        for (const [dx, dy, dz] of tilesOf(placement.type, placement.rotation ?? 0)) {
          filled.add(
            `${(placement.x ?? 0) + dx},${(placement.y ?? 0) + dy},${(placement.layer ?? 0) + dz}`,
          )
        }
      }
      const starved: string[] = []
      for (const placement of one.module.placements) {
        const ports = portsFor(placement.type)
        if (!ports || /^(Belt|Lift|Trash)/.test(placement.type)) continue
        for (const port of ports.inputs) {
          const [dx, dy, dz] = toWorld(port, placement.rotation ?? 0)
          const at = `${(placement.x ?? 0) + dx},${(placement.y ?? 0) + dy},${(placement.layer ?? 0) + dz}`
          if (!filled.has(at)) starved.push(`${placement.type} wants ${at}`)
        }
      }
      expect(starved, one.code).toEqual([])
    }
  })

  it('holds enough machines at every step to keep a belt full', () => {
    for (const one of made) {
      if (!one.module.ok) continue
      const counted = new Map<string, number>()
      for (const placement of one.module.placements) {
        counted.set(placement.type, (counted.get(placement.type) ?? 0) + 1)
      }
      for (const step of one.module.plan.steps) {
        expect(counted.get(step.type) ?? 0, `${one.code} ${step.op}`).toBeGreaterThanOrEqual(
          step.machines,
        )
      }
    }
  })

  it('stands its machines on all three floors', () => {
    /**
     * The machines used to sit on the ground floor alone, which meant two
     * floors in three held nothing but the odd comb — and a lane twice the size
     * it needed to be. Three steps share a column now, one to a floor, so this
     * checks the floors are actually being used rather than that the numbers
     * happened to come out smaller.
     */
    const spread = made.filter((one) => {
      if (!one.module.ok) return false
      const floors = new Set(
        one.module.placements
          .filter((placement) => !/^(Belt|Lift)/.test(placement.type))
          .map((placement) => placement.layer ?? 0),
      )
      return floors.size >= 3
    })
    expect(spread.length / made.length, `${spread.length}/${made.length}`).toBeGreaterThan(0.5)
  })

  it('fits most lanes on a platform the game actually has', () => {
    // three chunks square is the biggest there is; the number to push up
    const fits = made.filter((one) => one.module.ok && one.module.size.width <= 60 && one.module.size.height <= 60)
    expect(fits.length / made.length, `${fits.length}/${made.length}`).toBeGreaterThan(0.9)
  })

  it('stays inside the widest platform the game has', () => {
    /**
     * Folded on purpose. Given a column per step a deep plan ran to 277 tiles
     * long, and no platform is that wide however thin it is — three chunks is
     * sixty. The width is now set by how much room it is given rather than by
     * how long the plan happens to be, so this checks the fold actually holds.
     */
    for (const one of made) {
      if (!one.module.ok) continue
      expect(one.module.size.width, one.code).toBeLessThanOrEqual(60)
    }
  })

  it('carries a machine second stream on a floor of its own', () => {
    // the lifts are the whole reason a cutter keeping both halves works, so
    // this checks they are actually there rather than that the layout happened
    // to squeeze past
    const withTwo = made.find(
      (one) =>
        one.module.ok &&
        one.module.plan.steps.some((step) => step.outputs.size > 1),
    )
    expect(withTwo, '두 결과를 다 쓰는 계획이 하나는 있어야 합니다').toBeDefined()
    if (!withTwo || !withTwo.module.ok) return
    const lifts = withTwo.module.placements.filter((one) => one.type.startsWith('Lift1Up'))
    expect(lifts.length, withTwo.code).toBeGreaterThan(0)
    const upstairs = withTwo.module.placements.filter((one) => (one.layer ?? 0) > 0)
    expect(upstairs.length, `${withTwo.code}: 위층을 안 씁니다`).toBeGreaterThan(0)
  })
})
