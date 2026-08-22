import { describe, expect, it } from 'vitest'

import { decodeBlueprint } from '../blueprint'
import type { BuildingEntry } from '../blueprint'
import { generateModule, layoutModule } from '../module'
import { portsFor } from '../portData'
import { toWorld } from '../ports'
import { parseShapeCode } from '../shapeCode'
import { solveShape } from '../solver'
import { QUAD_CONFIG, operationConfig } from '../types'

import presets from '../presets.json'

const config = operationConfig(QUAD_CONFIG, 'normal')

function plan(code: string) {
  const parsed = parseShapeCode(code, QUAD_CONFIG)
  if (!parsed.ok) throw new Error(parsed.error)
  const result = solveShape(parsed.shape, config)
  if (!result.ok) throw new Error(result.error)
  return result.root
}

const tileKey = (x: number, y: number, z: number) => `${x},${y},${z}`

/**
 * Walks the decoded blueprint and checks the belts actually reach the machines.
 *
 * Placing buildings in the right cells is the easy half; the half that goes
 * wrong silently is the wiring, so every output port has to land on a tile
 * whose occupant accepts it as an input, and every machine input has to be fed.
 */
function wiringProblems(buildings: BuildingEntry[]): string[] {
  const occupants = new Map<string, BuildingEntry>()
  for (const building of buildings) {
    for (const tile of building.tiles) {
      occupants.set(tileKey(tile.x, tile.y, tile.z), building)
    }
  }

  const problems: string[] = []
  /** Input ports that something actually delivers into. */
  const fed = new Set<string>()

  const inputPorts = (building: BuildingEntry) =>
    (portsFor(building.type)?.inputs ?? []).map((offset) => {
      const [dx, dy, dz] = toWorld(offset, building.rotation)
      return {
        key: `${tileKey(building.pos.x, building.pos.y, building.pos.z)}<${dx},${dy},${dz}`,
        from: tileKey(building.pos.x + dx, building.pos.y + dy, building.pos.z + dz),
      }
    })

  for (const building of buildings) {
    if (!portsFor(building.type)) {
      problems.push(`${building.type} has no measured ports`)
      continue
    }

    for (const output of portsFor(building.type)!.outputs) {
      const [dx, dy, dz] = toWorld(output, building.rotation)
      const at = tileKey(building.pos.x + dx, building.pos.y + dy, building.pos.z + dz)
      const target = occupants.get(at)
      if (!target) continue // the module's outlet leads outside, which is the point

      const own = tileKey(building.pos.x, building.pos.y, building.pos.z)
      const port = inputPorts(target).find((entry) => entry.from === own)
      if (!port) {
        problems.push(`${building.type} at ${own} outputs into ${target.type}, which has no input there`)
      } else {
        fed.add(port.key)
      }
    }
  }

  // a machine with a dangling input stalls, so every input must be supplied
  for (const building of buildings) {
    if (building.type.startsWith('Belt')) continue
    for (const port of inputPorts(building)) {
      if (!fed.has(port.key)) {
        problems.push(`${building.type} at ${port.from} has an unfed input`)
      }
    }
  }

  return problems
}

describe('one-module layout', () => {
  it('lays a stacked shape out as parallel lines on two floors', () => {
    const result = layoutModule(plan('RbRbRbRb:CrCrCrCr'))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.size.floors).toBe(2)
    expect(result.inputs).toHaveLength(2)
    // one feed per floor, both entering at the same column
    expect(result.inputs.map((entry) => entry.at.z).sort()).toEqual([0, 1])
    expect(new Set(result.inputs.map((entry) => entry.at.x)).size).toBe(1)
    // the finished shape leaves on the ground floor
    expect(result.output.z).toBe(0)
  })

  it('wires every machine it places', async () => {
    for (const code of ['CrCrCrCr', 'RbRbRbRb:CrCrCrCr']) {
      const result = await generateModule(plan(code), code)
      expect(result.ok, code).toBe(true)
      if (!result.ok) continue

      const blueprint = await decodeBlueprint(result.code)
      expect(blueprint.buildings.length, code).toBe(result.placements.length)
      expect(wiringProblems(blueprint.buildings), code).toEqual([])
    }
  })

  it('refuses a plan whose second stack buries a line’s entrance', () => {
    // stacking twice puts the upper feed just past the first stacker, and a
    // stacker's upper tile is an input — so that belt has nothing behind it and
    // the player has no way to reach it either. The game flags exactly this.
    const twice = layoutModule(plan('RgRgRgRg:CwCwCwCw:SbSbSbSb'))
    expect(twice.ok).toBe(false)
    if (!twice.ok) expect(twice.reason).toMatch(/입구|벨트/)
  })

  it('never lets a belt draw from a face that emits nothing', async () => {
    // the check that was missing: a blueprint can be laid out correctly on the
    // grid and still not run, which is what the game's warning marker means
    for (const code of ['CrCrCrCr', 'RbRbRbRb:CrCrCrCr', 'CuRuCuRu:CuCuCuCu']) {
      const result = await generateModule(plan(code), code)
      if (!result.ok) continue
      const blueprint = await decodeBlueprint(result.code)
      expect(wiringProblems(blueprint.buildings), code).toEqual([])
    }
  })

  it('says what the player still has to supply', () => {
    const result = layoutModule(plan('RbRbRbRb:CrCrCrCr'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.notes.some((note) => note.includes('추출기'))).toBe(true)
    expect(result.notes.some((note) => note.includes('파이프'))).toBe(true)
    for (const input of result.inputs) expect(input.part).toBeTruthy()
  })
})

/**
 * A coverage floor, the same idea as the solver's: the share of real game
 * shapes that come out as a finished module. Raise it when the layout
 * improves, never lower it quietly.
 */
describe('module coverage', () => {
  it('builds a module for most of the game’s own shapes', () => {
    const codes = (presets as { scenario: string; code: string }[])
      .filter((preset) => preset.scenario === 'default')
      .map((preset) => preset.code)

    let solved = 0
    let modules = 0
    for (const code of codes) {
      const parsed = parseShapeCode(code, QUAD_CONFIG)
      if (!parsed.ok) continue
      const solution = solveShape(parsed.shape, config)
      if (!solution.ok) continue
      solved += 1
      if (layoutModule(solution.root).ok) modules += 1
    }

    expect(solved).toBeGreaterThan(300)
    // every module that comes out of here connects; the number was 63% while
    // broken layouts were still counted
    expect(modules / solved).toBeGreaterThan(0.3)
  })

  it('names what is still missing rather than failing vaguely', () => {
    // a mid-line cut has two halves to route, which needs belts that turn
    const codes = (presets as { scenario: string; code: string }[])
      .filter((preset) => preset.scenario === 'default')
      .map((preset) => preset.code)

    const reasons = new Set<string>()
    for (const code of codes) {
      const parsed = parseShapeCode(code, QUAD_CONFIG)
      if (!parsed.ok) continue
      const solution = solveShape(parsed.shape, config)
      if (!solution.ok) continue
      const result = layoutModule(solution.root)
      if (!result.ok) reasons.add(result.reason)
    }

    expect(reasons.size).toBeGreaterThan(0)
    for (const reason of reasons) {
      expect(reason.length, reason).toBeGreaterThan(10)
      expect(reason, reason).not.toMatch(/undefined/)
    }
  })
})
