import { describe, expect, it } from 'vitest'

import { decodeBlueprint } from '../blueprint'
import { MODULE_LANES, moduleSizing, USABLE_COLUMNS } from '../module'
import { BELT_BASE_RATE, OPERATION_SPECS, ratedThroughput } from '../throughput'

import fixtures from './portFixtures.json'

const codeFor = (name: string) =>
  (fixtures as { name: string; code: string }[]).find((entry) => entry.name === name)!.code

/**
 * What a module is, measured from two a player actually built.
 *
 * Both follow the same convention: belts arrive four to a floor across three
 * floors — twelve lanes — and leave the same way, with one operation's machines
 * in parallel between them. The machine count is not a matter of taste either:
 * it is however many it takes to keep those lanes full.
 */
describe('the shape of a real module', () => {
  it('takes twelve lanes in and twelve out, four per floor', async () => {
    const blueprint = await decodeBlueprint(codeFor('rotator module, 1x1 platform'))

    const catchers = blueprint.buildings.filter((b) => b.type.startsWith('BeltPortReceiver'))
    const launchers = blueprint.buildings.filter((b) => b.type.startsWith('BeltPortSender'))
    expect(catchers).toHaveLength(12)
    expect(launchers).toHaveLength(12)

    for (const floor of [0, 1, 2]) {
      expect(catchers.filter((b) => b.pos.z === floor), `catchers on floor ${floor}`).toHaveLength(4)
      expect(launchers.filter((b) => b.pos.z === floor), `launchers on floor ${floor}`).toHaveLength(4)
    }

    // in at one edge, out at the other, so modules chain end to end
    expect(new Set(catchers.map((b) => b.pos.y)).size).toBe(1)
    expect(new Set(launchers.map((b) => b.pos.y)).size).toBe(1)
    expect(catchers[0].pos.y).toBeGreaterThan(launchers[0].pos.y)

    // the four lanes sit in adjacent columns
    const columns = [...new Set(catchers.map((b) => b.pos.x))].sort((a, b) => a - b)
    expect(columns).toHaveLength(4)
    expect(columns[3] - columns[0]).toBe(3)
  })

  it('sizes the machines to keep every lane full', async () => {
    // machines per lane = belt rate / machine rate, rounded up
    const perLane = (op: keyof typeof OPERATION_SPECS) =>
      Math.ceil(BELT_BASE_RATE / ratedThroughput(OPERATION_SPECS[op], 100))

    const rotator = await decodeBlueprint(codeFor('rotator module, 1x1 platform'))
    const rotators = rotator.buildings.filter((b) => b.type.startsWith('Rotator')).length
    expect(perLane('r90cw')).toBe(2)
    expect(rotators).toBe(12 * perLane('r90cw'))

    const stacker = await decodeBlueprint(codeFor('stacker module, 1x2 platform'))
    const stackers = stacker.buildings.filter((b) => b.type.startsWith('Stacker')).length
    expect(perLane('stack')).toBe(6)
    expect(stackers).toBe(12 * perLane('stack'))
  })

  it('leaves a margin at the platform edge', async () => {
    // a launcher on the very edge tile cannot be caught, so both modules stop
    // short of it — two tiles in, on a chunk twenty tiles across
    const blueprint = await decodeBlueprint(codeFor('rotator module, 1x1 platform'))
    const ys = blueprint.buildings.map((b) => b.pos.y)
    const xs = blueprint.buildings.map((b) => b.pos.x)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(2)
    expect(Math.max(...ys)).toBeLessThanOrEqual(17)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(2)
    expect(Math.max(...xs)).toBeLessThanOrEqual(17)
  })
})

describe('sizing a module before placing anything', () => {
  const sizing = (op: keyof typeof OPERATION_SPECS) =>
    moduleSizing(op, BELT_BASE_RATE, ratedThroughput(OPERATION_SPECS[op], 100))

  it('matches the two modules a player actually built', () => {
    expect(sizing('r90cw').machines).toBe(24)
    expect(sizing('stack').machines).toBe(72)
    expect(MODULE_LANES).toBe(12)
  })

  it('says which operations fit on a single platform chunk', () => {
    // the rotator row is 8 columns wide and the painter's 16, both inside the
    // 16 usable columns; the stacker needs 24 and spills onto a second chunk,
    // which is exactly the platform the reference stacker module sits on
    expect(sizing('r90cw').columns).toBe(8)
    expect(sizing('r90cw').chunks).toBe(1)
    expect(sizing('paint').columns).toBe(16)
    expect(sizing('paint').chunks).toBe(1)
    expect(sizing('stack').columns).toBe(24)
    expect(sizing('stack').chunks).toBe(2)
    expect(USABLE_COLUMNS).toBe(16)
  })
})
