import { describe, expect, it } from 'vitest'

import { decodeBlueprint } from '../blueprint'
import { CONFIRMED_PORTS, UNKNOWN_PORTS, isRoutable, needsManualPiping, portsFor } from '../portData'
import { derivePorts } from '../ports'
import type { Offset } from '../ports'

import vectors from './blueprintVectors.json'

const PLATFORM = (vectors as { name: string; code: string }[]).find((vector) =>
  vector.name.startsWith('player platform'),
)!

const asKeys = (offsets: Offset[]) => offsets.map(([x, y]) => `${x},${y}`).sort()

describe('confirmed port data', () => {
  /**
   * Fixture-sourced entries must still fall out of the bundled blueprint. This
   * is what stops the table drifting into hand-written guesses.
   */
  it('re-derives every fixture-sourced entry from the bundled factory', async () => {
    const blueprint = await decodeBlueprint(PLATFORM.code)
    const derived = derivePorts(blueprint.buildings)

    const fromFixture = Object.entries(CONFIRMED_PORTS).filter(
      ([, ports]) => ports.source === 'fixture',
    )
    expect(fromFixture.length).toBeGreaterThan(5)

    for (const [type, expected] of fromFixture) {
      const actual = derived.get(type)
      expect(actual, `${type} missing from the reference factory`).toBeDefined()
      expect(asKeys(actual!.inputs.map((p) => p.offset)), `${type} inputs`).toEqual(
        asKeys(expected.inputs),
      )
      expect(asKeys(actual!.outputs.map((p) => p.offset)), `${type} outputs`).toEqual(
        asKeys(expected.outputs),
      )
      expect(actual!.instances, `${type} samples`).toBe(expected.samples)
    }
  })

  it('follows the -X in, +X out convention', () => {
    for (const [type, ports] of Object.entries(CONFIRMED_PORTS)) {
      for (const [x] of ports.inputs) {
        expect(x, `${type} input on +X`).toBeLessThanOrEqual(0)
      }
      for (const [x] of ports.outputs) {
        expect(x, `${type} output on -X`).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('backs every entry with real samples and a stated source', () => {
    for (const [type, ports] of Object.entries(CONFIRMED_PORTS)) {
      expect(ports.samples, `${type} samples`).toBeGreaterThan(1)
      expect(['fixture', 'player-report'], `${type} source`).toContain(ports.source)
      expect(ports.inputs.length + ports.outputs.length, `${type} has no ports`).toBeGreaterThan(0)
    }
  })

  it('refuses to auto-route machines that are only partly measured', () => {
    // a stacker takes two shapes but only one input has been observed
    expect(portsFor('StackerStraightInternalVariant')?.partialBelts).toBe(true)
    expect(isRoutable('StackerStraightInternalVariant')).toBe(false)
    expect(isRoutable('CutterDefaultInternalVariant')).toBe(true)
  })

  it('has nothing to say about machines never seen wired up', () => {
    for (const type of UNKNOWN_PORTS) {
      expect(portsFor(type), type).toBeNull()
      expect(isRoutable(type), type).toBe(false)
    }
  })

  it('flags machines that still need paint piped in by hand', () => {
    const crystal = portsFor('CrystalGeneratorDefaultInternalVariant')!
    // the belt sides are solid, the pipe side is not — routing may proceed but
    // the plan has to say the pipe is the player's job
    expect(asKeys(crystal.inputs)).toEqual(['-1,0'])
    expect(asKeys(crystal.outputs)).toEqual(['1,0'])
    expect(crystal.fluidUnknown).toBe(true)
    expect(needsManualPiping('CrystalGeneratorDefaultInternalVariant')).toBe(true)
    expect(needsManualPiping('CutterDefaultInternalVariant')).toBe(false)
    // a missing pipe location must not block belt routing
    expect(isRoutable('CrystalGeneratorDefaultInternalVariant')).toBe(true)
  })
})
