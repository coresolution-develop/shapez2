import { describe, expect, it } from 'vitest'

import { walk } from '../plan'
import { OPERATION_BUILDINGS, PROGRESSION, allUnlocks, unlocksFor } from '../progression'
import { parseShapeCode } from '../shapeCode'
import { solveShape } from '../solver'
import { QUAD_CONFIG, operationConfig } from '../types'

import presets from '../presets.json'

const config = operationConfig(QUAD_CONFIG, 'normal')

function progressAt(milestone: number, sideUpgrades: string[] = []) {
  return unlocksFor({ scenario: 'default', milestone, sideUpgrades })
}

describe('progression', () => {
  it('unlocks buildings in the order the game does', () => {
    expect(progressAt(1).operations).toEqual(new Set(['hcut', 'r90cw']))
    expect(progressAt(2).operations.has('stack')).toBe(true)
    expect(progressAt(4).operations.has('paint')).toBe(false)
    expect(progressAt(5).operations.has('paint')).toBe(true)
    expect(progressAt(6).operations.has('pin')).toBe(false)
    expect(progressAt(7).operations.has('pin')).toBe(true)
    expect(progressAt(12).operations.has('crystal')).toBe(true)

    // side upgrades are bought separately, never handed out by a milestone
    expect(progressAt(12).operations.has('cut')).toBe(false)
    expect(progressAt(12).operations.has('swap')).toBe(false)
    expect(progressAt(1, ['RNFullCutter']).operations.has('cut')).toBe(true)
  })

  it('gates secondary colours behind the mixer', () => {
    expect(progressAt(5).colors).toEqual(new Set(['r', 'g', 'b']))
    expect(progressAt(8).colors).toEqual(new Set(['r', 'g', 'b', 'c', 'm', 'y', 'w']))
  })

  it('never uses a building the player has not unlocked', () => {
    const codes = (presets as { scenario: string; code: string }[])
      .filter((preset) => preset.scenario === 'default')
      .slice(0, 200)
      .map((preset) => preset.code)

    for (const milestone of [1, 2, 5, 7, 12]) {
      const unlocks = progressAt(milestone)
      for (const code of codes) {
        const parsed = parseShapeCode(code, QUAD_CONFIG)
        if (!parsed.ok) continue
        const result = solveShape(parsed.shape, config, { unlocks, scenario: 'default' })
        if (!result.ok) continue

        walk(result.root, (node) => {
          if (node.op === null) return
          expect(unlocks.operations.has(node.op), `M${milestone} ${code} used ${node.op}`).toBe(true)
          if (node.op === 'paint' && node.color) {
            expect(unlocks.colors.has(node.color), `M${milestone} ${code} painted ${node.color}`).toBe(
              true,
            )
          }
        })
      }
    }
  })

  it('explains which building is missing instead of just failing', () => {
    const parsed = parseShapeCode('CrCrCrCr', QUAD_CONFIG)
    if (!parsed.ok) throw new Error(parsed.error)

    const early = solveShape(parsed.shape, config, {
      unlocks: progressAt(4),
      scenario: 'default',
    })
    expect(early.ok).toBe(false)
    if (!early.ok) {
      expect(early.error).toContain('해금')
      expect(early.hint).toContain('색칠기')
      expect(early.hint).toContain('마일스톤 5')
    }

    const later = solveShape(parsed.shape, config, {
      unlocks: progressAt(5),
      scenario: 'default',
    })
    expect(later.ok).toBe(true)
  })

  it('names the mixer for secondary colours', () => {
    const parsed = parseShapeCode('CyCyCyCy', QUAD_CONFIG)
    if (!parsed.ok) throw new Error(parsed.error)

    const result = solveShape(parsed.shape, config, {
      unlocks: progressAt(5),
      scenario: 'default',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.hint).toContain('색상 혼합기')
  })

  it('solves fewer shapes early on than with everything unlocked', () => {
    const codes = (presets as { scenario: string; code: string }[])
      .filter((preset) => preset.scenario === 'default')
      .map((preset) => preset.code)

    const solvedAt = (unlocks: ReturnType<typeof allUnlocks>) =>
      codes.filter((code) => {
        const parsed = parseShapeCode(code, QUAD_CONFIG)
        if (!parsed.ok) return false
        return solveShape(parsed.shape, config, { unlocks, scenario: 'default' }).ok
      }).length

    const early = solvedAt(progressAt(2))
    const full = solvedAt(allUnlocks())
    expect(early).toBeGreaterThan(0)
    expect(early).toBeLessThan(full)
  })

  it('covers every scenario and maps operations to real buildings', () => {
    for (const [name, scenario] of Object.entries(PROGRESSION)) {
      expect(scenario.milestones.length, name).toBeGreaterThan(0)
      expect(scenario.maxShapeLayers, name).toBeGreaterThanOrEqual(4)
    }

    const known = new Set<string>()
    for (const scenario of Object.values(PROGRESSION)) {
      for (const milestone of scenario.milestones) milestone.unlocks.forEach((v) => known.add(v))
      for (const upgrade of scenario.sideUpgrades) upgrade.unlocks.forEach((v) => known.add(v))
    }
    for (const building of Object.values(OPERATION_BUILDINGS)) {
      expect(known.has(building.variant), building.variant).toBe(true)
    }
  })
})
