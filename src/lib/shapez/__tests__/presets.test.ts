import { describe, expect, it } from 'vitest'

import { parseShapeCode, toShapeCode } from '../shapeCode'
import { solveShape } from '../solver'
import { HEX_CONFIG, QUAD_CONFIG, operationConfig, type ScenarioId } from '../types'

import presets from '../presets.json'

interface Preset {
  scenario: string
  category: string
  label: string
  code: string
}

/** Coverage floors — raise these when the solver improves, never lower silently. */
const MINIMUM_SOLVE_RATE: Record<string, number> = {
  default: 0.95,
  hard: 0.92,
  insane: 0.74,
  hexagonal: 0.96,
}

describe('real in-game shapes', () => {
  const byScenario = new Map<string, Preset[]>()
  for (const preset of presets as Preset[]) {
    const list = byScenario.get(preset.scenario) ?? []
    list.push(preset)
    byScenario.set(preset.scenario, list)
  }

  for (const [scenario, entries] of byScenario) {
    const shapesConfig = scenario === 'hexagonal' ? HEX_CONFIG : QUAD_CONFIG
    const scenarioId: ScenarioId = scenario === 'insane' ? 'insane' : 'normal'
    const config = operationConfig(shapesConfig, scenarioId)

    it(`parses every ${scenario} shape`, () => {
      for (const preset of entries) {
        const parsed = parseShapeCode(preset.code, shapesConfig)
        expect(parsed.ok, `${preset.code}: ${parsed.ok ? '' : parsed.error}`).toBe(true)
        if (parsed.ok) expect(toShapeCode(parsed.shape)).toBe(preset.code)
      }
    })

    it(`solves at least ${MINIMUM_SOLVE_RATE[scenario] * 100}% of ${scenario} shapes`, () => {
      let solved = 0
      for (const preset of entries) {
        const parsed = parseShapeCode(preset.code, shapesConfig)
        if (!parsed.ok) continue
        const result = solveShape(parsed.shape, config)
        if (!result.ok) continue
        solved++
        // a returned plan must actually build the requested shape
        expect(result.root.code, `plan for ${preset.code}`).toBe(preset.code)
      }
      expect(solved / entries.length).toBeGreaterThanOrEqual(MINIMUM_SOLVE_RATE[scenario])
    })
  }

  it('solves every milestone shape of the default scenario', () => {
    const milestones = (presets as Preset[]).filter(
      (preset) => preset.scenario === 'default' && preset.category === 'milestone',
    )
    expect(milestones.length).toBeGreaterThan(40)

    for (const preset of milestones) {
      const parsed = parseShapeCode(preset.code, QUAD_CONFIG)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      const result = solveShape(parsed.shape, operationConfig(QUAD_CONFIG, 'normal'))
      expect(result.ok, `${preset.label} ${preset.code}`).toBe(true)
    }
  })
})
