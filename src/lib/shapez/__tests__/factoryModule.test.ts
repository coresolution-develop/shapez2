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
  it('lays out a useful share of the plans', () => {
    // deliberately a floor and not a target: this is the number to push up, and
    // it should read as a regression if it ever falls
    expect(made.length / plans.length, `${made.length}/${plans.length}`).toBeGreaterThan(0.28)
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

  it('turns down what it cannot do by name', () => {
    // the two it cannot do are known and named; anything else failing silently
    // as "could not route" is the number to bring down
    const reasons = built.filter((one) => !one.module.ok).map((one) => (one.module.ok ? '' : one.module.reason))
    for (const reason of reasons) expect(reason.length, reason).toBeGreaterThan(0)
    const named = reasons.filter((reason) => reason.includes('두 결과') || reason.includes('두 입구'))
    expect(named.length, '출구·입구가 둘인 단계는 이름을 대고 거절해야 합니다').toBeGreaterThan(100)
  })
})
