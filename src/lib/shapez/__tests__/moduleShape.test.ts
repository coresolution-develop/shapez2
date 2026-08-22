import { describe, expect, it } from 'vitest'

import { decodeBlueprint } from '../blueprint'
import {
  MODULE_LANES,
  generateLaneModule,
  layoutLaneModule,
  moduleSizing,
  USABLE_COLUMNS,
} from '../module'
import { portsFor } from '../portData'
import { toWorld } from '../ports'
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

/**
 * Generating a module in the format the platforms expect. Correctness first:
 * the lanes have to be where a neighbouring module launches into, and every
 * belt has to actually reach the next thing.
 */
describe('generating a lane module', () => {
  const tile = (x: number, y: number, z: number) => `${x},${y},${z}`

  it('puts its twelve lanes exactly where the reference module puts them', async () => {
    const reference = await decodeBlueprint(codeFor('rotator module, 1x1 platform'))
    const mine = layoutLaneModule('r90cw', 2)

    const edges = (buildings: { type: string; pos: { x: number; y: number; z: number } }[]) => ({
      in: buildings
        .filter((b) => b.type.startsWith('BeltPortReceiver'))
        .map((b) => tile(b.pos.x, b.pos.y, b.pos.z))
        .sort(),
      out: buildings
        .filter((b) => b.type.startsWith('BeltPortSender'))
        .map((b) => tile(b.pos.x, b.pos.y, b.pos.z))
        .sort(),
    })

    const theirs = edges(reference.buildings)
    const ours = edges(
      mine.placements.map((p) => ({
        type: p.type,
        pos: { x: p.x ?? 0, y: p.y ?? 0, z: p.layer ?? 0 },
      })),
    )
    expect(ours.in).toEqual(theirs.in)
    expect(ours.out).toEqual(theirs.out)
  })

  it('wires every lane from the catcher through to the launcher', async () => {
    for (const op of ['r90cw', 'r90ccw', 'r180', 'hcut', 'pin', 'paint'] as const) {
      const { code } = await generateLaneModule(op, 2)
      const blueprint = await decodeBlueprint(code)

      const occupants = new Map<string, (typeof blueprint.buildings)[number]>()
      for (const b of blueprint.buildings) {
        for (const t of b.tiles) occupants.set(tile(t.x, t.y, t.z), b)
      }

      let fed = 0
      for (const b of blueprint.buildings) {
        for (const input of portsFor(b.type)!.inputs) {
          const [dx, dy, dz] = toWorld(input, b.rotation)
          const behind = occupants.get(tile(b.pos.x + dx, b.pos.y + dy, b.pos.z + dz))
          if (!behind) continue
          const emits = portsFor(behind.type)!.outputs.some((output) => {
            const [ox, oy, oz] = toWorld(output, behind.rotation)
            return (
              behind.pos.x + ox === b.pos.x &&
              behind.pos.y + oy === b.pos.y &&
              behind.pos.z + oz === b.pos.z + dz
            )
          })
          expect(emits, `${op}: ${b.type} draws from ${behind.type} which emits nothing there`).toBe(
            true,
          )
          fed += 1
        }
      }
      // every lane is a solid run, so nearly every building is fed by the one behind
      expect(fed, op).toBeGreaterThan(blueprint.buildings.length - MODULE_LANES - 1)
    }
  })

  it('says plainly that one machine per lane is not a full module', () => {
    expect(layoutLaneModule('r90cw', 2).notes.join(' ')).toContain('처리량')
    expect(layoutLaneModule('r90cw', 1).notes.join(' ')).not.toContain('처리량')
  })
})
