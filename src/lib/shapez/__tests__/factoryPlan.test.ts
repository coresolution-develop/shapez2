import { describe, expect, it } from 'vitest'

import { FACTORY_LANES, factoryPlan } from '../factoryPlan'
import { OPERATION_BUILDING } from '../module'
import presets from '../presets.json'
import { tilesOf } from '../route'
import { parseShapeCode } from '../shapeCode'
import { solveShape } from '../solver'
import { OPERATION_SPECS, beltThroughput, ratedThroughput } from '../throughput'
import { QUAD_CONFIG, operationConfig } from '../types'

const plans = (presets as { code: string; scenario: string }[])
  .filter((preset) => preset.scenario === 'default')
  .flatMap((preset) => {
    const parsed = parseShapeCode(preset.code, QUAD_CONFIG)
    if (!parsed.ok) return []
    const plan = solveShape(parsed.shape, operationConfig(QUAD_CONFIG, 'normal'))
    return plan.ok && plan.root.op !== null ? [{ code: preset.code, root: plan.root }] : []
  })

const sized = plans.map((plan) => ({
  ...plan,
  factory: factoryPlan(plan.root, {
    tier: 100,
    stackerVariant: 'straight',
    tilesOf: (type) => tilesOf(type, 0).length,
  }),
}))

/**
 * The counting a twelve-belt whole-plan factory rests on.
 *
 * None of this places anything. It is here because the layout has to agree with
 * it, and because the numbers are the sort that look right and are not — a step
 * fed the same shape twice wants two of it per run, and a shape wanted in two
 * places is made once and divided.
 */
describe('the factory plan', () => {
  it('gives every step enough machines to keep up', () => {
    for (const { code, factory } of sized) {
      for (const step of factory.steps) {
        const each = ratedThroughput(OPERATION_SPECS[step.op], 100)
        // the machines have to cover how often the step runs, which for a
        // two-output machine is less than what it delivers — one run of a
        // cutter yields both halves
        const covered = step.machines * each
        expect(
          covered,
          `${code} ${step.op}: ${step.machines}대 × ${each} < ${step.opRate}`,
        ).toBeGreaterThanOrEqual(step.opRate - 1e-6)
      }
    }
  })

  it('adds every consumer up to what its source was told to make', () => {
    // the property that breaks first if this and the throughput model drift
    for (const { code, factory } of sized) {
      const drawn = new Map<string, number>()
      for (const step of factory.steps) {
        for (const feed of step.inputs) {
          if (!feed.from) continue
          drawn.set(feed.from.node.id, (drawn.get(feed.from.node.id) ?? 0) + feed.rate)
        }
      }
      for (const step of factory.steps) {
        const taken = drawn.get(step.node.id)
        if (taken === undefined) continue // the last step: nobody downstream
        expect(taken, `${code} ${step.op}`).toBeCloseTo(step.rate, 6)
      }
    }
  })

  it('carries the finished shape on exactly the lanes asked for', () => {
    for (const { code, factory } of sized) {
      const last = factory.steps[factory.steps.length - 1]
      const finished = last.outputs.get(last.node.outputIndex)!
      expect(factory.lanes).toBe(FACTORY_LANES)
      expect(finished.rate, code).toBeCloseTo(FACTORY_LANES * beltThroughput(100), 6)
      expect(finished.belts, code).toBe(FACTORY_LANES)
    }
  })

  it('puts enough belts under every flow to carry it', () => {
    const belt = beltThroughput(100)
    for (const { code, factory } of sized) {
      for (const step of factory.steps) {
        expect(step.beltsOut * belt, `${code} ${step.op} 출력 합계`).toBeGreaterThanOrEqual(
          step.rate - 1e-6,
        )
        for (const out of step.outputs.values()) {
          // each result leaves on its own belts: a cutter's two halves are two
          // streams, not one stream of twice as much
          expect(out.belts * belt, `${code} ${step.op} 출구`).toBeGreaterThanOrEqual(out.rate - 1e-6)
        }
        for (const feed of step.inputs) {
          expect(feed.belts * belt, `${code} ${step.op} 입력`).toBeGreaterThanOrEqual(feed.rate - 1e-6)
        }
      }
      for (const one of factory.raw) {
        expect(one.belts * belt, `${code} ${one.part}`).toBeGreaterThanOrEqual(one.rate - 1e-6)
      }
    }
  })

  it('is small enough to stand on a platform', () => {
    // 16×16 usable on three floors, per chunk; the largest platform is 3×3
    const perChunk = 16 * 16 * 3
    const sizes = sized.map((one) => one.factory.machineTiles).sort((a, b) => a - b)
    const median = sizes[Math.floor(sizes.length / 2)]
    expect(median / perChunk, `중앙값 ${median}타일`).toBeLessThan(3)
    expect(sizes[sizes.length - 1] / perChunk, `최대 ${sizes[sizes.length - 1]}타일`).toBeLessThan(9)
  })

  it('names every raw material the player has to bring', () => {
    for (const { code, factory } of sized) {
      const fed = factory.steps.flatMap((step) => step.inputs.filter((f) => !f.from))
      expect(new Set(fed.map((f) => f.part)).size, code).toBe(factory.raw.length)
      for (const one of factory.raw) expect(one.part, code).toBeTruthy()
    }
  })

  it('knows what each step is built out of', () => {
    for (const { code, factory } of sized) {
      for (const step of factory.steps) {
        expect(step.type, code).toBe(OPERATION_BUILDING[step.op])
      }
    }
  })
})
