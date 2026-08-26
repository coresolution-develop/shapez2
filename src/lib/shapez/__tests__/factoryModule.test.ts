import { describe, expect, it } from 'vitest'

import { layoutFactoryModule } from '../factoryModule'
import { factoryPlan } from '../factoryPlan'
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
  it('lays out every plan whose machines take their two inputs apart', () => {
    /**
     * The boundary is nameable, which is the point.
     *
     * A cutter keeping both halves used to be out of reach: its two results
     * leave one row apart in the same column, and two combs cannot both have an
     * unbroken run up it. The third floor settles that — a lift at the mouth
     * carries the second result upstairs, where it has a column to itself.
     *
     * The same trick has not been done on the feeding side, so the one thing
     * left is a machine whose two *inputs* are in one column: a swapper. This
     * asserts exactly that rather than a percentage, because a plan failing for
     * any other reason should read as a broken test.
     */
    for (const one of built) {
      if (one.module.ok) continue
      const sameColumn = factoryPlan(one.root, {
        lanes: 1,
        tier: 100,
        stackerVariant: 'straight',
        tilesOf: (type) => tilesOf(type, 0).length,
      }).steps.some((step) => {
        const ports = portsFor(step.type)
        if (!ports || step.inputs.length < 2) return false
        const used = step.inputs.map((_, slot) => ports.inputs[Math.min(slot, ports.inputs.length - 1)])
        return new Set(used.map((port) => `${port[0]},${port[2]}`)).size < used.length
      })
      expect(sameColumn, `${one.code}: ${one.module.reason}`).toBe(true)
    }
    expect(made.length / plans.length, `${made.length}/${plans.length}`).toBeGreaterThan(0.98)
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

  it('says which machine it is turning the plan down for', () => {
    // "could not route" tells a player nothing they can act on; naming the
    // machine at least says what to build by hand instead
    for (const one of built) {
      if (one.module.ok) continue
      expect(one.module.reason, one.code).toContain('두 입구')
    }
  })
})
