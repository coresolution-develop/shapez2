/**
 * Where belts and pipes attach to a building.
 *
 * The game files don't ship port data, so this is *derived* from real working
 * blueprints rather than guessed. A belt states its own direction (local +X),
 * so a belt pointing at a machine is an input and a belt leaving one is an
 * output. Once a building's ports are known, its neighbours can be labelled
 * too, so the analysis chains outward from belts through mergers, splitters and
 * lifts until it reaches machines that no plain belt ever touches directly.
 *
 * The convention that falls out of the data, in a building's own local frame:
 *   -X is upstream (inputs), +X is downstream (outputs).
 */
import type { BuildingEntry } from './blueprint'

/**
 * A port's position in the building's own frame: sideways, forward and *up*.
 *
 * The third component is the building floor. It is not decoration: the stacker
 * is one tile in plan but spans two floors, and its two shape inputs sit at the
 * same (x, y) on different floors. Without z they collapse into one port and
 * the machine looks like it only takes one shape.
 */
export type Offset = readonly [number, number, number]

/** Belts carry shapes, pipes carry paint — a machine can have both. */
export type PortMedium = 'shape' | 'fluid'

export interface Port {
  offset: Offset
  medium: PortMedium
  /** How many instances backed this port. */
  count: number
}

export interface PortModel {
  /** Belt inputs. */
  inputs: Port[]
  /** Belt outputs. */
  outputs: Port[]
  /** Pipe connections. Fluid is bidirectional, so these have no direction. */
  fluid: Port[]
  /** How many instances of this building were seen. */
  instances: number
}

/** Direction a belt (or any building) pushes items, in world space. */
export function forwardDirection(rotation: number): Offset {
  let x = 1
  let y = 0
  for (let i = 0; i < ((rotation % 4) + 4) % 4; i++) {
    ;[x, y] = [-y, x]
  }
  return [x + 0, y + 0, 0] // normalise -0
}

/** Rotates a world-space offset back into a building's local frame. */
export function toLocal(dx: number, dy: number, dz: number, rotation: number): Offset {
  let x = dx
  let y = dy
  for (let i = 0; i < ((rotation % 4) + 4) % 4; i++) {
    ;[x, y] = [y, -x]
  }
  return [x + 0, y + 0, dz] // normalise -0
}

/** Rotates a local offset out into world space. */
export function toWorld(offset: Offset, rotation: number): Offset {
  let [x, y] = offset
  for (let i = 0; i < ((rotation % 4) + 4) % 4; i++) {
    ;[x, y] = [-y, x]
  }
  return [x + 0, y + 0, offset[2]]
}

const FLUID_FAMILY = /^(Pipe|FluidPort|Pump)/
const SHAPE_FAMILY = /^(Belt|Lift|Merger|Splitter|Trash)/

export function mediumOf(type: string): PortMedium | null {
  if (FLUID_FAMILY.test(type)) return 'fluid'
  if (SHAPE_FAMILY.test(type)) return 'shape'
  return null
}

/**
 * The one fact we take as given: a plain belt receives at its local -X and
 * delivers at its local +X. Everything else is inferred from there. This is
 * itself checked against real blueprints — belt port senders only ever have
 * belts arriving, receivers only ever have belts leaving.
 *
 * Pipes are deliberately *not* seeded. Fluid flows both ways through them, so a
 * pipe's rotation says nothing about direction; treating them like belts made
 * fluid senders come out as sources and mixers as pure outputs.
 */
const SEED: Record<string, { inputs: Offset[]; outputs: Offset[] }> = {
  BeltDefaultForwardInternalVariant: { inputs: [[-1, 0, 0]], outputs: [[1, 0, 0]] },
}

const key = (offset: Offset) => `${offset[0]},${offset[1]},${offset[2]}`
const parseKey = (value: string): Offset => {
  const [x, y, z] = value.split(',').map(Number)
  return [x, y, z]
}
const tileKey = (x: number, y: number, z: number) => `${x},${y},${z}`

const NEIGHBOURS = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
] as const

interface Tally {
  instances: number
  inputs: Map<string, { medium: PortMedium; count: number }>
  outputs: Map<string, { medium: PortMedium; count: number }>
}

/**
 * A side must be occupied on *every* instance to count as a port. 0.9 was tried
 * and produced false positives: the cutter has an incidental neighbour on 37 of
 * 40 instances, while its three real ports are on 40 of 40.
 */
const OCCUPANCY = 1

/**
 * Works out each building type's ports from a decoded blueprint.
 *
 * Two independent signals are combined:
 *  - belt flow, which is definitive but sparse, since machines are often wired
 *    straight into lifts and mergers rather than plain belts;
 *  - side occupancy, because a side that is filled on nearly every instance is
 *    structural, while an incidental neighbour is not.
 *
 * Chaining inference through lifts was tried and abandoned: lifts move between
 * layers, so their apparent geometry on a single layer is misleading and the
 * errors propagate into every machine they touch.
 */
export function derivePorts(buildings: BuildingEntry[]): Map<string, PortModel> {
  const occupants = new Map<string, BuildingEntry>()
  for (const building of buildings) {
    for (const tile of building.tiles) {
      occupants.set(tileKey(tile.x, tile.y, tile.z), building)
    }
  }

  const tally = new Map<string, Tally>()
  const occupancy = new Map<string, Map<string, { medium: PortMedium; count: number }>>()

  const tallyFor = (type: string): Tally => {
    const existing = tally.get(type)
    if (existing) return existing
    const created: Tally = { instances: 0, inputs: new Map(), outputs: new Map() }
    tally.set(type, created)
    occupancy.set(type, new Map())
    return created
  }

  for (const building of buildings) {
    const entry = tallyFor(building.type)
    entry.instances++

    const own = new Set(building.tiles.map((tile) => tileKey(tile.x, tile.y, tile.z)))
    const seen = new Set<string>()

    for (const tile of building.tiles) {
      for (const [dx, dy] of NEIGHBOURS) {
        const neighbourKey = tileKey(tile.x + dx, tile.y + dy, tile.z)
        if (own.has(neighbourKey)) continue
        const neighbour = occupants.get(neighbourKey)
        if (!neighbour) continue

        const local = toLocal(
          tile.x + dx - building.pos.x,
          tile.y + dy - building.pos.y,
          tile.z - building.pos.z,
          building.rotation,
        )
        const offsetKey = key(local)
        if (seen.has(offsetKey)) continue // count each side once per instance
        seen.add(offsetKey)

        const bucket = occupancy.get(building.type)!
        const medium = mediumOf(neighbour.type) ?? 'shape'
        const current = bucket.get(offsetKey)
        if (current) current.count++
        else bucket.set(offsetKey, { medium, count: 1 })
      }
    }
  }

  // belts and pipes state their direction outright, so use them to label sides
  for (const carrier of buildings) {
    const seed = SEED[carrier.type]
    if (!seed) continue
    const [dx, dy] = forwardDirection(carrier.rotation)
    const z = carrier.pos.z
    const medium = mediumOf(carrier.type) ?? 'shape'

    const ahead = occupants.get(tileKey(carrier.pos.x + dx, carrier.pos.y + dy, z))
    if (ahead && ahead !== carrier) {
      const local = toLocal(
        carrier.pos.x - ahead.pos.x,
        carrier.pos.y - ahead.pos.y,
        carrier.pos.z - ahead.pos.z,
        ahead.rotation,
      )
      const entry = tallyFor(ahead.type).inputs
      const current = entry.get(key(local))
      if (current) current.count++
      else entry.set(key(local), { medium, count: 1 })
    }

    const behind = occupants.get(tileKey(carrier.pos.x - dx, carrier.pos.y - dy, z))
    if (behind && behind !== carrier) {
      const local = toLocal(
        carrier.pos.x - behind.pos.x,
        carrier.pos.y - behind.pos.y,
        carrier.pos.z - behind.pos.z,
        behind.rotation,
      )
      const entry = tallyFor(behind.type).outputs
      const current = entry.get(key(local))
      if (current) current.count++
      else entry.set(key(local), { medium, count: 1 })
    }
  }

  const result = new Map<string, PortModel>()

  for (const [type, entry] of tally) {
    if (SEED[type]) {
      const seed = SEED[type]
      const asPort = (offset: Offset): Port => ({ offset, medium: 'shape', count: entry.instances })
      result.set(type, {
        inputs: seed.inputs.map(asPort),
        outputs: seed.outputs.map(asPort),
        fluid: [],
        instances: entry.instances,
      })
      continue
    }

    const inputs = new Map<string, Port>()
    const outputs = new Map<string, Port>()

    // sides a belt was actually seen flowing through
    for (const [offsetKey, { medium, count }] of entry.inputs) {
      inputs.set(offsetKey, { offset: parseKey(offsetKey), medium, count })
    }
    for (const [offsetKey, { medium, count }] of entry.outputs) {
      if (inputs.has(offsetKey)) continue
      outputs.set(offsetKey, { offset: parseKey(offsetKey), medium, count })
    }

    // plus sides that are structurally always in use, split by the -X/+X rule
    const threshold = entry.instances === 1 ? 1 : entry.instances * OCCUPANCY
    for (const [offsetKey, { medium, count }] of occupancy.get(type) ?? []) {
      if (count < threshold) continue
      if (inputs.has(offsetKey) || outputs.has(offsetKey)) continue
      const offset = parseKey(offsetKey)
      if (offset[0] > 0) outputs.set(offsetKey, { offset, medium, count })
      else if (offset[0] < 0) inputs.set(offsetKey, { offset, medium, count })
    }

    if (inputs.size === 0 && outputs.size === 0) continue
    const byOffset = (a: Port, b: Port) =>
      a.offset[2] - b.offset[2] || a.offset[0] - b.offset[0] || a.offset[1] - b.offset[1]
    const all = [...inputs.values(), ...outputs.values()]
    const fluid = all.filter((port) => port.medium === 'fluid')
    result.set(type, {
      inputs: [...inputs.values()].filter((port) => port.medium === 'shape').sort(byOffset),
      outputs: [...outputs.values()].filter((port) => port.medium === 'shape').sort(byOffset),
      fluid: fluid.sort(byOffset),
      instances: entry.instances,
    })
  }

  return result
}

/** Shape-carrying ports only, which is what a belt router needs. */
export function shapePorts(model: PortModel): { inputs: Offset[]; outputs: Offset[] } {
  return {
    inputs: model.inputs.map((port) => port.offset),
    outputs: model.outputs.map((port) => port.offset),
  }
}
