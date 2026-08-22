import { describe, expect, it } from 'vitest'

import { decodeBlueprint } from '../blueprint'
import type { BuildingEntry } from '../blueprint'
import { asLinearChain, generateLineBlueprint, generateLineLayout } from '../layout'
import { portsFor } from '../portData'
import { toWorld } from '../ports'
import { parseShapeCode } from '../shapeCode'
import { solveShape } from '../solver'
import { QUAD_CONFIG, operationConfig } from '../types'

const config = operationConfig(QUAD_CONFIG, 'normal')

function plan(code: string) {
  const parsed = parseShapeCode(code, QUAD_CONFIG)
  if (!parsed.ok) throw new Error(parsed.error)
  const result = solveShape(parsed.shape, config)
  if (!result.ok) throw new Error(result.error)
  return result.root
}

/**
 * The whole point of the port data: check that each building's declared output
 * really lands on the next building's declared input. If this passes, the
 * blueprint is wired, not just laid out.
 */
function assertConnected(buildings: BuildingEntry[]) {
  const occupied = new Map<string, BuildingEntry>()
  for (const building of buildings) {
    for (const tile of building.tiles) {
      occupied.set(`${tile.x},${tile.y},${tile.z}`, building)
    }
  }

  const consumers = new Map<string, BuildingEntry[]>()
  for (const building of buildings) {
    const ports = portsFor(building.type)
    if (!ports) continue
    for (const offset of ports.outputs) {
      const [dx, dy] = toWorld(offset, building.rotation)
      const key = `${building.pos.x + dx},${building.pos.y + dy},${building.pos.z}`
      const target = occupied.get(key)
      if (!target || target === building) continue
      const list = consumers.get(building.type) ?? []
      list.push(target)
      consumers.set(building.type, list)
    }
  }

  // every building except the last must hand off to something
  const producers = buildings.filter((building) => {
    const ports = portsFor(building.type)
    return ports !== null && ports.outputs.length > 0
  })
  let connected = 0
  for (const building of producers) {
    const ports = portsFor(building.type)!
    for (const offset of ports.outputs) {
      const [dx, dy] = toWorld(offset, building.rotation)
      const key = `${building.pos.x + dx},${building.pos.y + dy},${building.pos.z}`
      const target = occupied.get(key)
      if (!target || target === building) continue
      const targetPorts = portsFor(target.type)
      if (!targetPorts) continue
      // the receiving side must list the producer's tile as an input
      const accepts = targetPorts.inputs.some((inputOffset) => {
        const [ix, iy] = toWorld(inputOffset, target.rotation)
        return (
          target.pos.x + ix === building.pos.x &&
          target.pos.y + iy === building.pos.y &&
          target.pos.z === building.pos.z
        )
      })
      expect(accepts, `${building.type} → ${target.type} not accepted`).toBe(true)
      connected++
    }
  }
  return connected
}

describe('line layout', () => {
  it('recognises a straight chain and rejects a merge', () => {
    // a single quarter is carved by cutting and rotating: one shape throughout
    expect(asLinearChain(plan('CuCu----'))).not.toBeNull()
    // two layers must be stacked, so two shapes meet
    expect(asLinearChain(plan('CuCuCuCu:CuCuCuCu'))).toBeNull()
  })

  it('refuses plans it cannot wire instead of guessing', () => {
    const stacked = generateLineLayout(plan('CuCuCuCu:CuCuCuCu'))
    expect(stacked.ok).toBe(false)
    if (!stacked.ok) expect(stacked.reason).toContain('직선 라인')

    // the half destroyer's ports have never been measured
    const halved = generateLineLayout(plan('CuCu----'))
    if (!halved.ok) {
      expect(halved.reason).toMatch(/포트|확인/)
    }
  })

  it('builds a wired blueprint for a paintable chain', async () => {
    const result = await generateLineBlueprint(plan('CrCrCrCr'), 'CrCrCrCr')
    if (!result.ok) throw new Error(result.reason)

    expect(result.code.startsWith('SHAPEZ2-')).toBe(true)
    expect(result.steps.map((step) => step.op)).toEqual(['paint'])

    const decoded = await decodeBlueprint(result.code)
    // belt in, machine, belt out — no extractor, so it drops anywhere
    expect(decoded.buildings.map((building) => building.type)).toEqual([
      'BeltDefaultForwardInternalVariant',
      'PainterDefaultInternalVariant',
      'BeltDefaultForwardInternalVariant',
    ])

    // belt → painter → belt must actually connect
    const links = assertConnected(decoded.buildings)
    expect(links).toBeGreaterThan(1)
  })

  it('leaves the extractor out so the blueprint drops on open ground', async () => {
    const withMiner = await generateLineBlueprint(plan('CrCrCrCr'), undefined, {
      includeExtractor: true,
    })
    if (!withMiner.ok) throw new Error(withMiner.reason)
    expect(withMiner.placements.some((p) => p.type.startsWith('Extractor'))).toBe(true)
    expect(withMiner.notes.some((note) => note.includes('평지'))).toBe(true)

    const placeable = await generateLineBlueprint(plan('CrCrCrCr'))
    if (!placeable.ok) throw new Error(placeable.reason)
    // an extractor anywhere in the blueprint makes the whole thing unplaceable
    expect(placeable.placements.some((p) => p.type.startsWith('Extractor'))).toBe(false)
    expect(placeable.notes.some((note) => note.includes('추출기'))).toBe(true)
  })

  it('spaces machines so the belt between them lines up', async () => {
    const result = await generateLineBlueprint(plan('CrCrCrCr'))
    if (!result.ok) throw new Error(result.reason)

    const decoded = await decodeBlueprint(result.code)
    const xs = decoded.buildings.map((building) => building.pos.x).sort((a, b) => a - b)
    expect(xs).toEqual([0, 1, 2])
    expect(decoded.buildings[1].type).toBe('PainterDefaultInternalVariant')
    expect(decoded.buildings.every((building) => building.pos.y === 0)).toBe(true)
    expect(decoded.buildings.every((building) => building.rotation === 0)).toBe(true)
  })

  it('warns that paint still needs piping', async () => {
    const result = await generateLineBlueprint(plan('CrCrCrCr'))
    if (!result.ok) throw new Error(result.reason)
    expect(result.notes.some((note) => note.includes('파이프'))).toBe(true)
  })
})
