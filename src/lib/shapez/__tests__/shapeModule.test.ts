import { describe, expect, it } from 'vitest'

import { decodeBlueprint } from '../blueprint'
import { layoutModule } from '../module'
import presets from '../presets.json'
import { wiringProblems } from '../route'
import { generateShapeModule, layoutShapeModule } from '../shapeModule'
import { parseShapeCode } from '../shapeCode'
import { solveShape } from '../solver'
import { QUAD_CONFIG, operationConfig } from '../types'

const config = operationConfig(QUAD_CONFIG, 'normal')

const plansFor = (scenario: string) =>
  (presets as { code: string; scenario: string }[])
    .filter((preset) => preset.scenario === scenario)
    .flatMap((preset) => {
      const parsed = parseShapeCode(preset.code, QUAD_CONFIG)
      if (!parsed.ok) return []
      const plan = solveShape(parsed.shape, config)
      return plan.ok ? [{ code: preset.code, root: plan.root }] : []
    })

/**
 * A whole plan on one platform, now that the belts are searched for.
 *
 * The old layout wrote its belts down and could not place a cutter's second
 * output anywhere, which is what capped it. These numbers are the reason to
 * have swapped: they are measured over the game's own shapes, and the floor is
 * set below what is achieved so a regression shows up as a failure rather than
 * as a quietly smaller number.
 */
describe('the shape module', () => {
  const plans = plansFor('default')

  it('covers more shapes than the layout it replaces', () => {
    const covered = (lay: (root: (typeof plans)[number]['root']) => { ok: boolean }) =>
      plans.filter((plan) => lay(plan.root).ok).length

    const before = covered(layoutModule)
    const after = covered(layoutShapeModule)

    expect(before / plans.length).toBeGreaterThan(0.6)
    expect(after).toBeGreaterThan(before)
    expect(after / plans.length, `${after}/${plans.length}`).toBeGreaterThan(0.8)
  })

  it('wires every blueprint it does produce, both ways round', () => {
    // the point of the exercise: a blueprint that comes out has to run. An
    // earlier attempt at this shipped 25 that looked fine and were not
    for (const plan of plans) {
      const built = layoutShapeModule(plan.root)
      if (!built.ok) continue
      expect(wiringProblems(built.placements), plan.code).toEqual([])
    }
  })

  it('sends a machine output nobody wants to a trash', () => {
    // a cutter with one half unused jams if that half has nowhere to go, and a
    // belt laid across it looks connected on the grid
    const withCutter = plans.find((plan) => {
      const built = layoutShapeModule(plan.root)
      return built.ok && built.placements.some((p) => p.type.startsWith('Trash'))
    })
    expect(withCutter, '남는 절반을 버리는 계획이 하나는 있어야 합니다').toBeDefined()
  })

  it('says plainly when a shape needs no machines at all', () => {
    const raw = plansFor('default').find((plan) => plan.root.op === null)
    if (!raw) return
    const built = layoutShapeModule(raw.root)
    expect(built.ok).toBe(false)
    if (!built.ok) expect(built.reason).toContain('채굴기')
  })

  it('comes back out of the encoder the way it went in', async () => {
    const plan = plans.find((entry) => layoutShapeModule(entry.root).ok)!
    const made = await generateShapeModule(plan.root, plan.code)
    expect(made.code).not.toBeNull()
    if (!made.code || !made.layout.ok) return

    const blueprint = await decodeBlueprint(made.code)
    expect(blueprint.buildings).toHaveLength(made.layout.placements.length)
    const tiles = blueprint.buildings.flatMap((b) => b.tiles.map((t) => `${t.x},${t.y},${t.z}`))
    expect(new Set(tiles).size, '두 건물이 같은 칸을 차지합니다').toBe(tiles.length)
  })
})
