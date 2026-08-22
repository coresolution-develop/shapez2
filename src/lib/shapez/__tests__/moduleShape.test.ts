import { describe, expect, it } from 'vitest'

import { decodeBlueprint } from '../blueprint'
import {
  CHUNK_MARGIN,
  CHUNK_TILES,
  MODULE_FIRST_LANE,
  MODULE_LANES,
  OPERATION_BUILDING,
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

/**
 * How a module grows once one platform chunk is not enough.
 *
 * The guess was that it widens — more machine columns side by side. Both
 * two-chunk modules a player built say otherwise: they stay four lanes wide and
 * get *longer*, so the extra room lies along the flow, not across it. The
 * crystal generator one runs left to right and the stacker one top to bottom,
 * which is the same module turned ninety degrees, so the check is written in
 * terms of "along the flow" rather than x and y.
 */
describe('a module on two platform chunks', () => {
  const axes = (buildings: { pos: { x: number; y: number } }[]) => {
    const xs = buildings.map((b) => b.pos.x)
    const ys = buildings.map((b) => b.pos.y)
    const width = { from: Math.min(...xs), to: Math.max(...xs) }
    const height = { from: Math.min(...ys), to: Math.max(...ys) }
    const size = (a: { from: number; to: number }) => a.to - a.from + 1
    return size(width) > size(height)
      ? { along: width, across: height }
      : { along: height, across: width }
  }

  const TWO_CHUNK = ['crystal generator module, 1x2 platform', 'stacker module, 1x2 platform']

  it('gets longer along the flow and stays one chunk across', async () => {
    for (const name of TWO_CHUNK) {
      const blueprint = await decodeBlueprint(codeFor(name))
      const { along, across } = axes(blueprint.buildings)

      // two chunks end to end: forty tiles, of which the outer two each side
      // are margin, so the module runs the full 36
      expect(along.to - along.from + 1, `${name} along`).toBe(2 * CHUNK_TILES - 2 * CHUNK_MARGIN)
      // and still no wider than the usable part of a single chunk
      expect(across.to - across.from + 1, `${name} across`).toBeLessThanOrEqual(USABLE_COLUMNS)
    }
  })

  it('still takes twelve lanes in the middle four columns', async () => {
    const blueprint = await decodeBlueprint(codeFor('crystal generator module, 1x2 platform'))
    const edge = (prefix: string) => blueprint.buildings.filter((b) => b.type.startsWith(prefix))

    // internal launcher/catcher pairs are used to hop across the module, so the
    // twelve that matter are the ones on the outer edge
    const along = axes(blueprint.buildings).along
    const inbound = edge('BeltPortReceiver').filter((b) => b.pos.x === along.from)
    const outbound = edge('BeltPortSender').filter((b) => b.pos.x === along.to)
    expect(inbound).toHaveLength(MODULE_LANES)
    expect(outbound).toHaveLength(MODULE_LANES)

    for (const floor of [0, 1, 2]) {
      expect(inbound.filter((b) => b.pos.z === floor), `floor ${floor}`).toHaveLength(
        MODULE_LANES / 3,
      )
    }
    const lanes = [...new Set(inbound.map((b) => b.pos.y))].sort((a, b) => a - b)
    expect(lanes).toEqual([MODULE_FIRST_LANE, MODULE_FIRST_LANE + 1, MODULE_FIRST_LANE + 2, MODULE_FIRST_LANE + 3])
  })

  it('sizes its machines the same way a one-chunk module does', async () => {
    // a third module, a third time the arithmetic holds: the crystal generator
    // runs at 20/min, so a 120/min lane wants six of them
    const blueprint = await decodeBlueprint(codeFor('crystal generator module, 1x2 platform'))
    const generators = blueprint.buildings.filter((b) => b.type.startsWith('CrystalGenerator'))
    const perLane = Math.ceil(BELT_BASE_RATE / ratedThroughput(OPERATION_SPECS.crystal, 100))
    expect(perLane).toBe(6)
    expect(generators).toHaveLength(MODULE_LANES * perLane)
  })

  it('cannot put a two-floor machine on all three floors', async () => {
    // the crystal generator spans two building floors, so one on floor 0 fills
    // floor 1 as well — the module carries none at all on the top floor
    const blueprint = await decodeBlueprint(codeFor('crystal generator module, 1x2 platform'))
    const generators = blueprint.buildings.filter((b) => b.type.startsWith('CrystalGenerator'))
    const floors = [0, 1, 2].map((z) => generators.filter((b) => b.pos.z === z).length)
    expect(floors).toEqual([48, 24, 0])
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

  it('says which operations fit in a single row of machines', () => {
    // the rotator row is 8 columns wide, inside the 16 usable ones; the stacker
    // needs 24, so its machines cannot all stand side by side
    expect(sizing('r90cw').columns).toBe(8)
    expect(sizing('r90cw').machineRows).toBe(1)
    expect(sizing('stack').columns).toBe(24)
    expect(sizing('stack').machineRows).toBe(2)
    expect(USABLE_COLUMNS).toBe(16)
  })

  it('counts a 1x2 machine as two columns, because that is what it occupies', () => {
    // the painter's second tile lies across the flow, not along it, so sixteen
    // painters cannot share sixteen columns however they are arranged
    expect(sizing('r90cw').pitch).toBe(1)
    expect(sizing('paint').pitch).toBe(2)
    expect(sizing('paint').perLane).toBe(4)
    expect(sizing('paint').columns).toBe(32)
    expect(sizing('paint').machineRows).toBe(2)
  })
})

/**
 * Generating a module in the format the platforms expect. Correctness first:
 * the lanes have to be where a neighbouring module launches into, and every
 * belt has to actually reach the next thing.
 */
describe('generating a lane module', () => {
  const tile = (x: number, y: number, z: number) => `${x},${y},${z}`
  const perLane = (op: keyof typeof OPERATION_SPECS) =>
    Math.ceil(BELT_BASE_RATE / ratedThroughput(OPERATION_SPECS[op], 100))

  /** Operations a one-chunk module can hold: one belt in, one out, one tile. */
  const SINGLE_FILE = ['r90cw', 'r90ccw', 'r180', 'hcut', 'pin'] as const

  const ours = (op: keyof typeof OPERATION_SPECS) => {
    const layout = layoutLaneModule(op, perLane(op))
    if (!layout.ok) throw new Error(`${op}: ${layout.reason}`)
    return layout
  }

  /**
   * The whole point of fanning out: the player built this module by hand, and a
   * generated one has to be the same module — not merely a plausible one. Every
   * belt, splitter, merger, rotation and floor is compared.
   */
  it('reproduces the rotator module a player built, tile for tile', async () => {
    const reference = await decodeBlueprint(codeFor('rotator module, 1x1 platform'))
    const mine = ours('r90cw')

    const theirs = reference.buildings
      .map((b) => `${tile(b.pos.x, b.pos.y, b.pos.z)} ${b.type} r${b.rotation}`)
      .sort()
    const generated = mine.placements
      .map((p) => `${tile(p.x ?? 0, p.y ?? 0, p.layer ?? 0)} ${p.type} r${p.rotation ?? 0}`)
      .sort()

    expect(generated).toEqual(theirs)
  })

  it('puts enough machines in to keep every lane full', () => {
    for (const op of SINGLE_FILE) {
      const layout = ours(op)
      expect(layout.machines, op).toBe(MODULE_LANES * perLane(op))
      expect(
        layout.placements.filter((p) => p.type === OPERATION_BUILDING[op]),
        op,
      ).toHaveLength(layout.machines)
      // the machine block is centred on the four lane columns
      expect(layout.span.from + layout.span.to, op).toBe(MODULE_FIRST_LANE * 2 + 3)
    }
  })

  it('stays inside the platform chunk, margin and all', () => {
    for (const op of SINGLE_FILE) {
      const layout = ours(op)
      for (const placement of layout.placements) {
        expect(placement.x, `${op} x`).toBeGreaterThanOrEqual(CHUNK_MARGIN)
        expect(placement.x, `${op} x`).toBeLessThanOrEqual(CHUNK_TILES - CHUNK_MARGIN - 1)
        expect(placement.y, `${op} y`).toBeGreaterThanOrEqual(CHUNK_MARGIN)
        expect(placement.y, `${op} y`).toBeLessThanOrEqual(CHUNK_TILES - CHUNK_MARGIN - 1)
      }
    }
  })

  it('wires every lane from the catcher through to the launcher', async () => {
    for (const op of SINGLE_FILE) {
      const { code } = await generateLaneModule(op, perLane(op))
      const blueprint = await decodeBlueprint(code!)

      const occupants = new Map<string, (typeof blueprint.buildings)[number]>()
      for (const b of blueprint.buildings) {
        for (const t of b.tiles) {
          const cell = tile(t.x, t.y, t.z)
          expect(occupants.has(cell), `${op}: two buildings on ${cell}`).toBe(false)
          occupants.set(cell, b)
        }
      }

      for (const b of blueprint.buildings) {
        const ports = portsFor(b.type)!
        // nothing may draw from a face that emits nothing — the check that
        // separates a blueprint that looks wired from one that runs
        for (const input of ports.inputs) {
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
        }

        // and nothing may deliver into a face that accepts nothing, which is
        // how a fan-out silently loses a third of its shapes
        for (const output of ports.outputs) {
          const [dx, dy, dz] = toWorld(output, b.rotation)
          const ahead = occupants.get(tile(b.pos.x + dx, b.pos.y + dy, b.pos.z + dz))
          if (!ahead) continue
          const accepts = portsFor(ahead.type)!.inputs.some((input) => {
            const [ix, iy, iz] = toWorld(input, ahead.rotation)
            return (
              ahead.pos.x + ix === b.pos.x &&
              ahead.pos.y + iy === b.pos.y &&
              ahead.pos.z + iz === b.pos.z + dz
            )
          })
          expect(
            accepts,
            `${op}: ${b.type} pushes into ${ahead.type} which accepts nothing there`,
          ).toBe(true)
        }
      }
    }
  })

  it('carries a full belt end to end, with nothing overloaded on the way', () => {
    // a chain of 1-to-2 splitters only works if the belt leaving each one can
    // carry what the machines further along still need
    for (const op of SINGLE_FILE) {
      const rate = ratedThroughput(OPERATION_SPECS[op], 100)
      const n = perLane(op)
      expect(n * rate, `${op} keeps a lane full`).toBeGreaterThanOrEqual(BELT_BASE_RATE)
      expect((n - 1) * rate, `${op} never overloads a belt`).toBeLessThan(BELT_BASE_RATE)
    }
  })

  it('refuses a module whose machines will not stand in one row', () => {
    // sixteen painters to a floor need thirty-two columns, so they have to be
    // split into rows down the module, which this does not do yet
    const painter = layoutLaneModule('paint', perLane('paint'))
    expect(painter.ok).toBe(false)
    if (!painter.ok) expect(painter.reason).toContain('기계 줄')
  })

  it('refuses machines a single-file lane cannot hold', () => {
    // the stacker takes two shapes, the cutter puts two out, and the crystal
    // generator is two floors tall — all three need routing this does not do
    for (const op of ['stack', 'cut', 'crystal'] as const) {
      expect(layoutLaneModule(op, 2).ok, op).toBe(false)
    }
  })
})
