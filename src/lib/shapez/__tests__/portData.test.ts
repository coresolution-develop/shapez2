import { describe, expect, it } from 'vitest'

import { decodeBlueprint } from '../blueprint'
import { CONFIRMED_PORTS, UNKNOWN_PORTS, isRoutable, needsManualPiping, portsFor } from '../portData'
import { derivePorts } from '../ports'
import type { Offset } from '../ports'

import vectors from './blueprintVectors.json'
import rigs from './portFixtures.json'

const PLATFORM = (vectors as { name: string; code: string }[]).find((vector) =>
  vector.name.startsWith('player platform'),
)!

/** Blueprints a `fixture` entry may cite, by name. */
const FIXTURES: Record<string, string> = {
  ...Object.fromEntries((rigs as { name: string; code: string }[]).map((rig) => [rig.name, rig.code])),
}

const asKeys = (offsets: Offset[]) => offsets.map(([x, y, z]) => `${x},${y},${z}`).sort()

describe('confirmed port data', () => {
  /**
   * Fixture-sourced entries must still fall out of the bundled blueprint. This
   * is what stops the table drifting into hand-written guesses.
   */
  it('re-derives every fixture-sourced entry from the blueprint that backs it', async () => {
    const cache = new Map<string, Awaited<ReturnType<typeof derivePorts>>>()
    const portsIn = async (code: string) => {
      const hit = cache.get(code)
      if (hit) return hit
      const derived = derivePorts((await decodeBlueprint(code)).buildings)
      cache.set(code, derived)
      return derived
    }

    const fromFixture = Object.entries(CONFIRMED_PORTS).filter(
      ([, ports]) => ports.source === 'fixture',
    )
    expect(fromFixture.length).toBeGreaterThan(5)

    for (const [type, expected] of fromFixture) {
      const code = expected.fixture ? FIXTURES[expected.fixture] : PLATFORM.code
      expect(code, `${type} cites an unknown fixture: ${expected.fixture}`).toBeDefined()
      const derived = await portsIn(code)
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
      // a purpose-built rig proves a port with one instance; anything measured
      // in the wild needs to have shown up more than once to count
      const floor = ports.fixture ? 1 : 2
      expect(ports.samples, `${type} samples`).toBeGreaterThanOrEqual(floor)
      expect(['fixture', 'player-report'], `${type} source`).toContain(ports.source)
      expect(ports.inputs.length + ports.outputs.length, `${type} has no ports`).toBeGreaterThan(0)
    }
  })

  it('gives a machine as many belt ports as its operation needs', () => {
    // the stacker takes two shapes: one per floor, both on -X. Counting only
    // the plan view collapsed them into one port and made it look partial.
    const stacker = portsFor('StackerStraightInternalVariant')!
    expect(asKeys(stacker.inputs)).toEqual(['-1,0,0', '-1,0,1'])
    expect(asKeys(stacker.outputs)).toEqual(['1,0,0'])
    expect(stacker.partialBelts).toBeUndefined()
    expect(isRoutable('StackerStraightInternalVariant')).toBe(true)

    // the cutter is the mirror case: one shape in, two halves out
    const cutter = portsFor('CutterDefaultInternalVariant')!
    expect(cutter.inputs).toHaveLength(1)
    expect(cutter.outputs).toHaveLength(2)
    expect(isRoutable('CutterDefaultInternalVariant')).toBe(true)
  })

  it('still refuses anything left marked partial', () => {
    for (const [type, ports] of Object.entries(CONFIRMED_PORTS)) {
      if (!ports.partialBelts) continue
      expect(isRoutable(type), type).toBe(false)
    }
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
    expect(asKeys(crystal.inputs)).toEqual(['-1,0,0'])
    expect(asKeys(crystal.outputs)).toEqual(['1,0,0'])
    expect(crystal.fluidUnknown).toBe(true)
    expect(needsManualPiping('CrystalGeneratorDefaultInternalVariant')).toBe(true)
    expect(needsManualPiping('CutterDefaultInternalVariant')).toBe(false)
    // a missing pipe location must not block belt routing
    expect(isRoutable('CrystalGeneratorDefaultInternalVariant')).toBe(true)
  })
})
