import { describe, expect, it } from 'vitest'

import { decodeBlueprint } from '../blueprint'
import { OPERATION_BUILDING, layoutModule } from '../module'
import { OPERATIONS, OPERATION_IDS, type OperationId } from '../operations'
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
    expect(after / plans.length, `${after}/${plans.length}`).toBeGreaterThan(0.97)
  })

  it('lays out every plan that has a machine in it', () => {
    /**
     * The stronger claim, and the one worth stating: the only shapes this
     * cannot do are the ones with nothing to do. A quad circle comes straight
     * off an extractor, so there is no plan to lay out and saying so is the
     * right answer rather than a failure.
     *
     * Written as an exact count and not a percentage. Everything that used to
     * fail here failed for a nameable reason — two inputs aimed at one port,
     * two outputs claiming one tile, a splitter chain with no way in — and any
     * one of them coming back should read as a broken test, not as a number
     * that slipped a little.
     */
    const stuck = built.filter((entry) => !entry.module.ok)
    for (const entry of stuck) {
      expect(entry.module.ok ? '' : entry.module.reason, entry.code).toContain('채굴기')
      expect(entry.root.op, entry.code).toBeNull()
    }
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

  it('tells the player to pipe every machine that drinks paint', () => {
    /**
     * Measuring a pipe face used to switch this warning off.
     *
     * The note hung off `fluidUnknown`, so working out where a crystal
     * generator takes its paint stopped those blueprints from mentioning paint
     * at all — and a machine wants a pipe whether or not we know which face it
     * takes it on.
     *
     * Checked per machine, not per blueprint. Nearly every plan with a crystal
     * generator has a painter in it too, so "some note mentions paint" passes
     * with the bug still in — the first version of this test did exactly that.
     * Each drinker has to be named.
     */
    let checked = 0
    for (const entry of made) {
      const laid = entry.module
      if (!laid.ok) continue
      const drinkers = new Set(
        laid.placements
          .map((p) => ({ op: OPERATION_IDS.find((o) => OPERATION_BUILDING[o] === p.type), ports: portsFor(p.type) }))
          .filter((one) => one.op && one.ports && (one.ports.fluidUnknown || (one.ports.fluid?.length ?? 0) > 0))
          .map((one) => one.op as OperationId),
      )
      for (const op of drinkers) {
        checked++
        const named = laid.notes.some(
          (note) => note.startsWith(OPERATIONS[op].labelKo) && note.includes('물감 파이프'),
        )
        expect(named, `${entry.code}: ${OPERATIONS[op].labelKo} 경고 없음 — ${laid.notes.join(' / ')}`).toBe(true)
      }
    }
    expect(checked, '물감 먹는 기계가 든 계획이 있어야 합니다').toBeGreaterThan(0)
  })

  it('names the machine whose two outputs it cannot tell apart', () => {
    /**
     * Same trap: a plan with a swapper in it almost always has a cutter too, so
     * a warning that always said "cutter" passed a test that only asked whether
     * the warning was about a machine present. Every two-output machine has to
     * be named, and nothing else may be.
     */
    let checked = 0
    for (const entry of made) {
      const laid = entry.module
      if (!laid.ok) continue
      const present = new Set(
        laid.placements
          .map((p) => OPERATION_IDS.find((o) => OPERATION_BUILDING[o] === p.type))
          .filter((op): op is OperationId => op !== undefined),
      )
      const twoWays = [...present].filter((op) => (portsFor(OPERATION_BUILDING[op])?.outputs.length ?? 0) > 1)
      for (const op of twoWays) {
        checked++
        const named = laid.notes.some(
          (note) => note.startsWith(OPERATIONS[op].labelKo) && note.includes('두 결과가 어느 출구로'),
        )
        expect(named, `${entry.code}: ${OPERATIONS[op].labelKo} 경고 없음 — ${laid.notes.join(' / ')}`).toBe(true)
      }
      // and no warning about a machine that is not in this blueprint
      for (const note of laid.notes) {
        if (!note.includes('두 결과가 어느 출구로')) continue
        const named = OPERATION_IDS.find((op) => note.startsWith(OPERATIONS[op].labelKo))
        expect(named !== undefined && present.has(named), `${entry.code}: ${note}`).toBe(true)
      }
    }
    expect(checked, '출구가 둘인 기계가 든 계획이 있어야 합니다').toBeGreaterThan(0)
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
