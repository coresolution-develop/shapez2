import { describe, expect, it } from 'vitest'

import { decodeBlueprint } from '../blueprint'
import { layoutModule } from '../module'
import { portsFor } from '../portData'
import { toWorld } from '../ports'
import presets from '../presets.json'
import { tilesOf, wiringProblems } from '../route'
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
  // laying out every plan is the expensive part and three of these tests want
  // the same answers, so it happens once
  const built = plans.map((plan) => ({ ...plan, module: layoutShapeModule(plan.root) }))
  const made = built.filter((entry) => entry.module.ok)

  it('covers more shapes than the layout it replaces', () => {
    const before = plans.filter((plan) => layoutModule(plan.root).ok).length
    const after = made.length

    expect(before / plans.length).toBeGreaterThan(0.6)
    expect(after).toBeGreaterThan(before)
    expect(after / plans.length, `${after}/${plans.length}`).toBeGreaterThan(0.9)
  })

  it('puts a belt on every tile a machine expects to be fed from', () => {
    /**
     * The one that mattered most and showed up in nothing.
     *
     * The router lays no piece on the tile it is aiming for, because everywhere
     * else it is used that tile already holds the comb it delivers into. Here
     * the aim was the machine's port — an empty tile — so the last belt stopped
     * one short of every machine in the plan and left it fed by a gap. Every
     * blueprint this made looked right, wired clean, and would have jammed.
     *
     * A trash is the exception and only that: it takes from either side and is
     * only ever fed from one, so its far side is bare by design.
     */
    for (const entry of made) {
      const laid = entry.module
      if (!laid.ok) continue

      const filled = new Set<string>()
      for (const placement of laid.placements) {
        for (const [dx, dy, dz] of tilesOf(placement.type, placement.rotation ?? 0)) {
          filled.add(
            `${(placement.x ?? 0) + dx},${(placement.y ?? 0) + dy},${(placement.layer ?? 0) + dz}`,
          )
        }
      }

      const starved: string[] = []
      for (const placement of laid.placements) {
        const ports = portsFor(placement.type)
        if (!ports || placement.type.startsWith('Trash')) continue
        if (placement.type.startsWith('Belt') || placement.type.startsWith('Lift')) continue
        for (const port of ports.inputs) {
          const [dx, dy, dz] = toWorld(port, placement.rotation ?? 0)
          const at = `${(placement.x ?? 0) + dx},${(placement.y ?? 0) + dy},${(placement.layer ?? 0) + dz}`
          if (!filled.has(at)) starved.push(`${placement.type} wants a feed at ${at}`)
        }
      }
      expect(starved, entry.code).toEqual([])
    }
  })

  it('wires every blueprint it does produce, both ways round', () => {
    // the point of the exercise: a blueprint that comes out has to run. An
    // earlier attempt at this shipped 25 that looked fine and were not
    for (const entry of made) {
      if (!entry.module.ok) continue
      expect(wiringProblems(entry.module.placements), entry.code).toEqual([])
    }
  })

  it('sends a machine output nobody wants to a trash', () => {
    // a cutter with one half unused jams if that half has nowhere to go, and a
    // belt laid across it looks connected on the grid
    const withCutter = made.find(
      (entry) => entry.module.ok && entry.module.placements.some((p) => p.type.startsWith('Trash')),
    )
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
    const plan = made[0]
    const encoded = await generateShapeModule(plan.root, plan.code)
    expect(encoded.code).not.toBeNull()
    if (!encoded.code || !encoded.layout.ok) return

    const blueprint = await decodeBlueprint(encoded.code)
    expect(blueprint.buildings).toHaveLength(encoded.layout.placements.length)
    const tiles = blueprint.buildings.flatMap((b) => b.tiles.map((t) => `${t.x},${t.y},${t.z}`))
    expect(new Set(tiles).size, '두 건물이 같은 칸을 차지합니다').toBe(tiles.length)
  })
})
