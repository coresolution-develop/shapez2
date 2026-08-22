import { describe, expect, it } from 'vitest'

import { parseShapeCode } from '../shapeCode'
import { orderedSteps } from '../plan'
import type { BuildNode } from '../plan'
import { solveShape } from '../solver'
import {
  BELT_BASE_RATE,
  EXTRACTOR_SPEC,
  OPERATION_SPECS,
  SPEED_TIERS,
  beltThroughput,
  computeThroughput,
  ratedThroughput,
} from '../throughput'
import { QUAD_CONFIG, operationConfig } from '../types'

import presets from '../presets.json'

const config = operationConfig(QUAD_CONFIG, 'normal')

function plan(code: string): BuildNode {
  const parsed = parseShapeCode(code, QUAD_CONFIG)
  if (!parsed.ok) throw new Error(parsed.error)
  const result = solveShape(parsed.shape, config)
  if (!result.ok) throw new Error(result.error)
  return result.root
}

describe('throughput', () => {
  it('scales linearly with the speed multiplier', () => {
    expect(beltThroughput(100)).toBe(BELT_BASE_RATE)
    expect(beltThroughput(150)).toBe(180)
    expect(beltThroughput(50)).toBe(60)
    // wiki-listed cutter tiers
    expect(SPEED_TIERS.map((tier) => ratedThroughput(OPERATION_SPECS.cut, tier))).toEqual([
      15, 22.5, 30, 37.5, 45,
    ])
    // painter family has no tier below 100%
    expect(SPEED_TIERS.map((tier) => ratedThroughput(OPERATION_SPECS.paint, tier))).toEqual([
      30, 30, 30, 37.5, 45,
    ])
  })

  it('sizes a simple two-layer plan', () => {
    const root = plan('RbRbRbRb:CrCrCrCr')
    const result = computeThroughput(root, { target: 60, tier: 100, stackerVariant: 'straight' })

    // one stacker at 20/min can't do 60/min on its own
    const stacker = result.buildings.find((entry) => entry.spec.building === 'Stacker')
    expect(stacker?.count).toBe(3)

    // both halves are painted at the target rate: 60 shapes × 10 L each
    const red = result.fluids.find((fluid) => fluid.color === 'r')
    expect(red?.litresPerMinute).toBe(600)

    // 60/min of each input shape at 30/min per extractor
    expect(result.extractors.every((entry) => entry.count === 2)).toBe(true)
  })

  it('never asks a machine to produce less than its consumers need', () => {
    const codes = (presets as { scenario: string; code: string }[])
      .filter((preset) => preset.scenario === 'default')
      .slice(0, 120)
      .map((preset) => preset.code)

    for (const code of codes) {
      const parsed = parseShapeCode(code, QUAD_CONFIG)
      if (!parsed.ok) continue
      const solved = solveShape(parsed.shape, config)
      if (!solved.ok) continue

      const result = computeThroughput(solved.root, {
        target: 90,
        tier: 100,
        stackerVariant: 'straight',
      })

      expect(result.loads.get(solved.root.id)?.rate).toBe(90)

      for (const node of orderedSteps(solved.root)) {
        const load = result.loads.get(node.id)!
        expect(load.rate).toBeGreaterThan(0)
        // the machine must run at least as fast as this output is consumed
        expect(load.opRate).toBeGreaterThanOrEqual(load.rate - 1e-9)
        // and the installed buildings must cover that rate
        expect(load.buildings * ratedThroughput(load.spec, 100)).toBeGreaterThanOrEqual(
          load.opRate - 1e-9,
        )
      }

      // every extractor's output must cover everything drawn from it
      for (const entry of result.extractors) {
        expect(entry.count * EXTRACTOR_SPEC.baseRate).toBeGreaterThanOrEqual(entry.rate - 1e-9)
      }
    }
  })

  it('treats both halves of one cutter as a single machine', () => {
    // `----crcr` is built by padding, growing crystals, then cutting the scaffold off
    const root = plan('----crcr')
    const result = computeThroughput(root, { target: 30, tier: 100, stackerVariant: 'straight' })
    const cutters = result.buildings.find((entry) => entry.spec.building === 'Cutter')
    expect(cutters?.count).toBe(1)
  })
})
