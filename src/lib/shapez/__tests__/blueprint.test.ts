import { describe, expect, it } from 'vitest'

import {
  BlueprintError,
  decodeBlueprint,
  encodeBuildingBlueprint,
  encodeIslandBlueprint,
  findBlueprintCodes,
  summarize,
} from '../blueprint'

import fixtures from './portFixtures.json'
import vectors from './blueprintVectors.json'

const codeFor = (name: string) =>
  (fixtures as { name: string; code: string }[]).find((entry) => entry.name === name)!.code

/** The gzipped JSON a blueprint code carries, as the game would read it. */
async function payloadOf(code: string): Promise<unknown> {
  const body = code.trim().split('-').slice(2).join('-').slice(0, -1)
  const base64 = /^[A-Za-z0-9+/]*={0,2}/.exec(body)![0]
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
  const stream = new Blob([bytes as unknown as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
  return JSON.parse(await new Response(stream).text())
}

interface Vector {
  name: string
  code: string
  expected: {
    kind: string
    majorVersion: number
    version: number
    totalBuildings: number
    totalIslands: number
    countsByInternalVariant: Record<string, number>
    tiles: [number, number, number][]
  }
}

/**
 * Expectations come from the official `shapez2` python decoder.
 * Regenerate with `pnpm gen:blueprints`.
 */
describe('blueprint decoding matches the official implementation', () => {
  for (const vector of vectors as unknown as Vector[]) {
    it(vector.name, async () => {
      const blueprint = await decodeBlueprint(vector.code)
      const { expected } = vector

      expect(blueprint.kind).toBe(expected.kind)
      expect(blueprint.majorVersion).toBe(expected.majorVersion)
      expect(blueprint.version).toBe(expected.version)
      expect(blueprint.buildings.length).toBe(expected.totalBuildings)
      expect(blueprint.islands.length).toBe(expected.totalIslands)

      const counts: Record<string, number> = {}
      for (const building of blueprint.buildings) {
        counts[building.type] = (counts[building.type] ?? 0) + 1
      }
      expect(counts).toEqual(expected.countsByInternalVariant)

      const tiles = blueprint.buildings
        .flatMap((building) => building.tiles)
        .map((tile) => [tile.x, tile.y, tile.z])
        .sort(compareTiles)
      expect(tiles).toEqual([...expected.tiles].sort(compareTiles))
    })
  }

  it('rejects malformed codes with a readable reason', async () => {
    const cases: [string, string][] = [
      ['', "구분자"],
      ['SHAPEZ2-1-$', '본문이 비어'],
      ['NOPE-1-abc$', 'SHAPEZ2'],
      ['SHAPEZ2-x-abc$', '버전이 숫자'],
      ['SHAPEZ2-1-abc', '$'],
      ['SHAPEZ2-1-!!!!$', 'base64'],
      ['SHAPEZ2-1-YWJj$', 'gzip'],
    ]

    for (const [code, fragment] of cases) {
      await expect(decodeBlueprint(code), code).rejects.toThrow(BlueprintError)
      await expect(decodeBlueprint(code), code).rejects.toThrow(fragment)
    }
  })

  it('summarises a platform blueprint', async () => {
    const real = (vectors as unknown as Vector[])[0]
    const summary = summarize(await decodeBlueprint(real.code))

    expect(summary.kind).toBe('island')
    expect(summary.totalIslands).toBe(1)
    expect(summary.totalBuildings).toBe(64)
    expect(summary.unknownTypes).toEqual([])
    expect(summary.byTitle[0].count).toBeGreaterThan(0)
    // every building resolved to a human-readable name
    expect(summary.byTitle.every((entry) => !entry.title.endsWith('InternalVariant'))).toBe(true)
    expect(summary.byTitle.every((entry) => !entry.title.includes('copy-from'))).toBe(true)
    // splitters and belts share a game title, so labels must still be unique
    expect(new Set(summary.byTitle.map((entry) => entry.title)).size).toBe(summary.byTitle.length)
    expect(summary.bounds).not.toBeNull()
    expect(summary.bounds!.width).toBeGreaterThan(0)
  })

  it('pulls blueprint codes out of surrounding text', () => {
    const text = `여기 청사진: ${(vectors as unknown as Vector[])[1].code} 이렇게 씁니다.`
    expect(findBlueprintCodes(text)).toEqual([(vectors as unknown as Vector[])[1].code])
    expect(findBlueprintCodes('없음')).toEqual([])
  })

  it('reads icons from the trailing section used since major version 5', async () => {
    const platform = (vectors as unknown as Vector[]).find((vector) =>
      vector.name.startsWith('player platform'),
    )!
    const blueprint = await decodeBlueprint(platform.code)
    expect(blueprint.majorVersion).toBe(5)
    expect(blueprint.icons).toEqual([
      expect.objectContaining({ kind: 'icon', icon: 'Platforms' }),
      expect.objectContaining({ kind: 'shape', shapeCode: 'RuRuRuRu' }),
    ])
  })

  it('reads blueprint icons', async () => {
    const mixed = (vectors as unknown as Vector[]).find((vector) => vector.name === 'mixed line')!
    const blueprint = await decodeBlueprint(mixed.code)
    expect(blueprint.icons).toEqual([
      expect.objectContaining({ kind: 'shape', shapeCode: 'CuRuCuCu' }),
      expect.objectContaining({ kind: 'icon', icon: 'building' }),
    ])
  })
})

describe('blueprint encoding', () => {
  it('round-trips through our own decoder', async () => {
    const placements = [
      { type: 'CutterDefaultInternalVariant', x: 0, y: 0 },
      { type: 'RotatorOneQuadInternalVariant', x: 4, y: 0, rotation: 1 },
      { type: 'PainterDefaultInternalVariant', x: 8, y: 0, layer: 1, rotation: 3 },
      { type: 'BeltDefaultForwardInternalVariant', x: 2, y: 0 },
    ]

    const code = await encodeBuildingBlueprint(placements, {
      icons: ['shape:CuCuCuCu', null, null, null],
    })
    // defaults to the format the current game writes
    expect(code.startsWith('SHAPEZ2-5-')).toBe(true)
    expect(code.endsWith('$')).toBe(true)
    // icons live in the trailing section, whose suffix is its own length
    const tail = /(\[.*\])_(\d+)\$$/.exec(code)!
    expect(tail[1].length).toBe(Number(tail[2]))

    const decoded = await decodeBlueprint(code)
    expect(decoded.kind).toBe('building')
    expect(decoded.buildings).toHaveLength(placements.length)
    expect(decoded.icons[0]).toMatchObject({ kind: 'shape', shapeCode: 'CuCuCuCu' })

    for (const [index, placement] of placements.entries()) {
      const built = decoded.buildings[index]
      expect(built.type).toBe(placement.type)
      expect(built.pos).toEqual({
        x: placement.x ?? 0,
        y: placement.y ?? 0,
        z: placement.layer ?? 0,
      })
      expect(built.rotation).toBe(placement.rotation ?? 0)
    }
  })

  it('omits default values the way the older format does', async () => {
    const code = await encodeBuildingBlueprint([{ type: 'BeltDefaultForwardInternalVariant' }], {
      format: 'v1',
    })
    expect(code.startsWith('SHAPEZ2-1-')).toBe(true)
    const decoded = await decodeBlueprint(code)
    expect(decoded.buildings[0].pos).toEqual({ x: 0, y: 0, z: 0 })
    expect(decoded.buildings[0].rotation).toBe(0)
  })

  it('emits an empty trailing section when there are no icons', async () => {
    const code = await encodeBuildingBlueprint([{ type: 'BeltDefaultForwardInternalVariant' }])
    expect(code.endsWith('[]_2$')).toBe(true)
  })

  it('refuses to build an empty blueprint', async () => {
    await expect(encodeBuildingBlueprint([])).rejects.toThrow(BlueprintError)
  })

  /**
   * A platform blueprint is checked against the game's own bytes rather than
   * against ourselves: a module a player built is taken apart and written back
   * out, and the two payloads have to be the same JSON. Round-tripping through
   * our own decoder would happily agree with a wrapper the game rejects.
   */
  it('writes a platform blueprint the way the game writes one', async () => {
    const reference = codeFor('rotator module, 1x1 platform')
    const decoded = await decodeBlueprint(reference)

    const rewritten = await encodeIslandBlueprint(
      decoded.islands.map((island) => ({
        type: island.type,
        x: island.pos.x,
        y: island.pos.y,
        z: island.pos.z,
        rotation: island.rotation,
        buildings: island.buildings.map((building) => ({
          type: building.type,
          x: building.pos.x,
          y: building.pos.y,
          layer: building.pos.z,
          rotation: building.rotation,
        })),
      })),
    )

    expect(await payloadOf(rewritten)).toEqual(await payloadOf(reference))
  })

  it('refuses to build a platform blueprint with no platform', async () => {
    await expect(encodeIslandBlueprint([])).rejects.toThrow(BlueprintError)
  })
})

function compareTiles(a: number[], b: number[]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}
