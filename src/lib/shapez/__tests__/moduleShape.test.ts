import { describe, expect, it } from 'vitest'

import { decodeBlueprint } from '../blueprint'
import buildings from '../buildings.json'
import {
  BELT_PORT_THROW,
  CHUNK_MARGIN,
  CHUNK_TILES,
  MODULE_INTAKE_ROW,
  MODULE_SIDE_INTAKE_COLUMN,
  STACKER_INTAKE,
  MODULE_FIRST_LANE,
  MODULE_LANES,
  MODULE_LANES_PER_FLOOR,
  OPERATION_BUILDING,
  generateLaneModule,
  layoutLaneModule,
  moduleSizing,
  USABLE_COLUMNS,
} from '../module'
import { portsFor } from '../portData'
import { forwardDirection, toWorld } from '../ports'
import { BELT_BASE_RATE, OPERATION_SPECS, ratedThroughput } from '../throughput'

import fixtures from './portFixtures.json'

const codeFor = (name: string) =>
  (fixtures as { name: string; code: string }[]).find((entry) => entry.name === name)!.code

const FOOTPRINTS = (buildings as { buildingVariants: Record<string, { tiles: number[][] }> })
  .buildingVariants

/** Where a building's tiles land once it is turned, in world offsets. */
const buildingTiles = (type: string, rotation: number) =>
  (FOOTPRINTS[type]?.tiles ?? [[0, 0, 0]]).map((t) => toWorld(t as [number, number, number], rotation))

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

  /** Operations a one-chunk module can hold: one belt in, one belt out. */
  const SINGLE_FILE = ['r90cw', 'r90ccw', 'r180', 'hcut', 'pin', 'paint'] as const

  const ours = (op: keyof typeof OPERATION_SPECS) => {
    const layout = layoutLaneModule(op, perLane(op))
    if (!layout.ok) throw new Error(`${op}: ${layout.reason}`)
    return layout
  }

  /**
   * The whole point of fanning out: the player built this module by hand, and a
   * generated one has to be the same module — not merely a plausible one. Every
   * belt, splitter, merger, rotation and floor is compared, and so is the
   * platform they all stand on.
   */
  it('reproduces the rotator module a player built, tile for tile', async () => {
    const reference = await decodeBlueprint(codeFor('rotator module, 1x1 platform'))
    const { code } = await generateLaneModule('r90cw', perLane('r90cw'))
    const generated = await decodeBlueprint(code!)

    // a module lays down its own ground: without this the player has to build a
    // foundation by hand before the blueprint has anywhere to go
    expect(generated.kind).toBe('island')
    expect(generated.islands.map((i) => `${i.type} @${tile(i.pos.x, i.pos.y, i.pos.z)} r${i.rotation}`))
      .toEqual(reference.islands.map((i) => `${i.type} @${tile(i.pos.x, i.pos.y, i.pos.z)} r${i.rotation}`))

    const layout = (blueprint: typeof reference) =>
      blueprint.buildings
        .map((b) => `${tile(b.pos.x, b.pos.y, b.pos.z)} ${b.type} r${b.rotation}`)
        .sort()

    expect(layout(generated)).toEqual(layout(reference))
  })

  it('puts enough machines in to keep every lane full', () => {
    for (const op of SINGLE_FILE) {
      const layout = ours(op)
      expect(layout.machines, op).toBe(MODULE_LANES * perLane(op))
      // a ladder uses the mirrored twin on one side, so count the family
      const family = OPERATION_BUILDING[op].replace(/InternalVariant$/, '')
      expect(layout.placements.filter((p) => p.type.startsWith(family)), op).toHaveLength(
        layout.machines,
      )
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

  /**
   * Machines too wide to stand in a row are turned sideways and stacked down
   * the module instead. A painter is two tiles across the flow and one along
   * it, so a whole floor's worth stops needing thirty-two columns and starts
   * needing twelve.
   */
  describe('a machine too wide to stand in a row', () => {
    it('lays the lanes out as ladders instead of combs', () => {
      const painter = ours('paint')
      expect(painter.shape).toBe('ladder')
      expect(ours('r90cw').shape).toBe('comb')

      // three columns to a lane — raw trunk, machine, results trunk
      expect(painter.span.to - painter.span.from + 1).toBe(MODULE_LANES_PER_FLOOR * 3)
      expect(painter.machines).toBe(MODULE_LANES * perLane('paint'))
    })

    it('stands every machine in a column of its own', () => {
      // the trunks sit against the machine on both sides, so a machine wider
      // than one tile along the flow would have nowhere to draw from
      const painter = ours('paint')
      const machines = painter.placements.filter((p) => p.type.startsWith('Painter'))
      const columns = new Set(machines.map((p) => p.x))
      expect(columns.size).toBe(MODULE_LANES_PER_FLOOR)
      expect(machines).toHaveLength(painter.machines)
    })

    it('leaves a row between machines for the paint to reach them', () => {
      // packed tight, a painter's only free faces are its neighbours' tiles and
      // the player cannot pipe anything in — the module would never run
      const painter = ours('paint')
      const occupied = new Set(
        painter.placements.flatMap((p) =>
          buildingTiles(p.type, p.rotation ?? 0).map(([dx, dy]) => tile((p.x ?? 0) + dx, (p.y ?? 0) + dy, p.layer ?? 0)),
        ),
      )

      for (const machine of painter.placements.filter((p) => p.type.startsWith('Painter'))) {
        const tiles = buildingTiles(machine.type, machine.rotation ?? 0)
        const rows = tiles.map(([, dy]) => (machine.y ?? 0) + dy)
        const above = Math.max(...rows) + 1
        const below = Math.min(...rows) - 1
        const reachable = [above, below].filter(
          (y) => !occupied.has(tile(machine.x ?? 0, y, machine.layer ?? 0)),
        )
        expect(reachable.length, `painter at ${machine.x},${machine.y} has no free face`)
          .toBeGreaterThan(0)
      }
    })

    it('says so, rather than quietly building something different', () => {
      // both of these change what the player has to do with the blueprint, so
      // they are warnings the screen shows, not prose buried in a description
      const painter = ours('paint').warnings.join(' ')
      expect(painter).toContain('눕혀')
      expect(painter).toContain('물감')
      expect(ours('r90cw').warnings).toEqual([])
    })
  })

  it('refuses machines a single-file lane cannot hold', () => {
    // the stacker takes two shapes, the cutter puts two out, and the crystal
    // generator is two floors tall — all three need routing this does not do
    for (const op of ['stack', 'cut', 'crystal'] as const) {
      expect(layoutLaneModule(op, 2).ok, op).toBe(false)
    }
  })
})

/**
 * Two things a stacker module needs settled before it can be laid out, both
 * read back off the module a player built rather than assumed.
 */
describe('what a two-shape module needs', () => {
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`

  it('throws a shape exactly as far as the next module is away', async () => {
    // the distance follows from the margins — a launcher two tiles inside one
    // chunk reaches a catcher two tiles inside the next — and the reference
    // modules then use that same distance for the hops inside themselves
    expect(BELT_PORT_THROW).toBe(5)

    for (const name of ['stacker module, 1x2 platform', 'crystal generator module, 1x2 platform']) {
      const blueprint = await decodeBlueprint(codeFor(name))
      const senders = blueprint.buildings.filter((b) => b.type.startsWith('BeltPortSender'))
      const catchers = new Map(
        blueprint.buildings
          .filter((b) => b.type.startsWith('BeltPortReceiver'))
          .map((b) => [key(b.pos.x, b.pos.y, b.pos.z), b]),
      )

      const gaps = new Map<number, number>()
      for (const sender of senders) {
        const [dx, dy] = forwardDirection(sender.rotation)
        for (let step = 1; step <= 25; step++) {
          const hit = catchers.get(
            key(sender.pos.x + dx * step, sender.pos.y + dy * step, sender.pos.z),
          )
          if (hit && hit.rotation === sender.rotation) {
            gaps.set(step, (gaps.get(step) ?? 0) + 1)
            break
          }
        }
      }

      const paired = [...gaps.values()].reduce((sum, count) => sum + count, 0)
      const throws = gaps.get(BELT_PORT_THROW) ?? 0
      expect(throws / paired, `${name}: hops at ${BELT_PORT_THROW} tiles`).toBeGreaterThan(0.75)

      // the twelve that find nothing ahead are the module's own outputs, which
      // throw to the next module and so land outside this blueprint
      expect(senders.length - paired, `${name}: outward launchers`).toBe(MODULE_LANES)
    }
  })

  it('takes the under-shape down the intake edge and the over-shape down the side', async () => {
    const blueprint = await decodeBlueprint(codeFor('stacker module, 1x2 platform'))
    const at = new Map<string, (typeof blueprint.buildings)[number]>()
    for (const b of blueprint.buildings) for (const t of b.tiles) at.set(key(t.x, t.y, t.z), b)

    // everything that delivers into a given tile, launchers included
    const feeders = new Map<string, (typeof blueprint.buildings)[number][]>()
    const add = (cell: string, from: (typeof blueprint.buildings)[number]) =>
      feeders.set(cell, [...(feeders.get(cell) ?? []), from])

    for (const b of blueprint.buildings) {
      if (b.type.startsWith('BeltPortSender')) {
        const [dx, dy] = forwardDirection(b.rotation)
        const cell = key(b.pos.x + dx * BELT_PORT_THROW, b.pos.y + dy * BELT_PORT_THROW, b.pos.z)
        if (at.get(cell)?.type.startsWith('BeltPortReceiver')) add(cell, b)
        continue
      }
      for (const port of portsFor(b.type)?.outputs ?? []) {
        const [ox, oy, oz] = toWorld(port, b.rotation)
        add(key(b.pos.x + ox, b.pos.y + oy, b.pos.z + oz), b)
      }
    }

    /** Walks upstream from a stacker's feed tile until it reaches an edge. */
    const sourceOf = (start: string): 'intake' | 'side' | null => {
      const seen = new Set<string>()
      const queue = [start]
      while (queue.length > 0) {
        const cell = queue.shift()!
        if (seen.has(cell)) continue
        seen.add(cell)
        const here = at.get(cell)
        if (here?.type.startsWith('BeltPortReceiver')) {
          if (here.pos.y === MODULE_INTAKE_ROW) return 'intake'
          if (here.pos.x === MODULE_SIDE_INTAKE_COLUMN) return 'side'
        }
        for (const from of feeders.get(cell) ?? []) {
          queue.push(key(from.pos.x, from.pos.y, from.pos.z))
        }
      }
      return null
    }

    const found = { bottomShape: new Set<string>(), topShape: new Set<string>() }
    for (const stacker of blueprint.buildings.filter((b) => b.type.startsWith('Stacker'))) {
      // the two shape inputs sit one above the other, one floor apart
      const under = sourceOf(key(stacker.pos.x, stacker.pos.y + 1, stacker.pos.z))
      const over = sourceOf(key(stacker.pos.x, stacker.pos.y + 1, stacker.pos.z + 1))
      if (under) found.bottomShape.add(under)
      if (over) found.topShape.add(over)
    }

    expect([...found.bottomShape]).toEqual([STACKER_INTAKE.bottomShape])
    expect([...found.topShape]).toEqual([STACKER_INTAKE.topShape])
  })
})
