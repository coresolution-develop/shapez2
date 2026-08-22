import { describe, expect, it } from 'vitest'

import tradePartShapes from '../../../components/tradePartShapes.json'
import { PROGRESSION, SCENARIO_KEYS } from '../progression'
import { parseShapeCode, parseShapeCodeForDisplay } from '../shapeCode'
import { COLORS, DISPLAY_QUAD_CONFIG, PAINTABLE_COLORS, QUAD_CONFIG } from '../types'
import {
  buildableInputs,
  isTradeShape,
  stationsConsuming,
  stationsProducing,
  tradeStations,
} from '../trade'

/**
 * A gem shape has no build plan, so the only useful answer is where it comes
 * from. These check that the chain the game data describes actually holds.
 */
describe('trade stations', () => {
  it('tells a gem shape apart from a buildable one', () => {
    expect(isTradeShape('XrXrXrXr')).toBe(true)
    expect(isTradeShape('YkYkYkYk')).toBe(true)
    expect(isTradeShape('--Xk--Xk')).toBe(true)
    expect(isTradeShape('RuRuRuRu:CuCuCuCu')).toBe(false)
    // 'X' as a colour char is not a part; only the part slot counts
    expect(isTradeShape('CuCuCuCu')).toBe(false)
  })

  it('names the station a gem comes from and what it wants', () => {
    const [ruby] = stationsProducing('converter', 'XrXrXrXr')
    expect(ruby.titleKo).toBe('루비 가공소')
    expect(ruby.inputs).toContain('XuXuXuXu')
    expect(ruby.inputs).toContain('RuRuRuRu:CuCuCuCu')
  })

  it('can plan the inputs a station asks for', () => {
    const [ruby] = stationsProducing('converter', 'XrXrXrXr')
    const buildable = buildableInputs(ruby)
    expect(buildable).toEqual(['RuRuRuRu:CuCuCuCu'])
    // the other input is itself traded, so it leads further down the chain
    expect(stationsProducing('converter', 'XuXuXuXu').length).toBeGreaterThan(0)
  })

  it('links a station to the one that feeds it', () => {
    // 연마소 takes the waste gem the hub spits out
    expect(stationsConsuming('converter', 'XkXk----')[0].titleKo).toBe('연마소')
    // and 루비 가공소 takes what 연마소 makes, once you have stacked it up:
    // stations swap arrangements, so the chain is by gem, not by exact code
    const polished = stationsProducing('converter', 'XuXuXuXu')
    expect(polished[0].titleKo).toBe('연마소')
    expect(stationsConsuming('converter', 'XuXuXuXu')[0].titleKo).toBe('루비 가공소')
  })

  it('falls back to a station making the same gem in another arrangement', () => {
    // no station emits XuXuXuXu outright; 연마소 emits XuXu----
    const stations = stationsProducing('converter', 'XuXuXuXu')
    expect(stations.some((station) => station.outputs.includes('XuXuXuXu'))).toBe(false)
    expect(stations[0].outputs).toContain('XuXu----')
  })

  it('has no station for a shape you simply build', () => {
    expect(stationsProducing('converter', 'CuCuCuCu')).toEqual([])
  })

  it('explains every recipe shape it cannot plan', () => {
    for (const key of SCENARIO_KEYS) {
      for (const station of tradeStations(key)) {
        expect(station.titleKo || station.title, station.id).toBeTruthy()
        for (const shape of [...station.inputs, ...station.outputs]) {
          const parsed = parseShapeCode(shape)
          if (parsed.ok || isTradeShape(shape)) continue
          // the only other thing it may refuse is black, and it has to say so
          // rather than call the code invalid
          expect(parsed.ok, `${station.id}: ${shape}`).toBe(false)
          if (!parsed.ok) expect(parsed.error, `${station.id}: ${shape}`).toContain('검은색')
        }
      }
    }
  })

  it('gives 육각 no trade stations, because the game does not', () => {
    expect(PROGRESSION.hexagonal.tradeStations).toEqual([])
    expect(tradeStations('converter')).toHaveLength(17)
  })
})

/**
 * Gems have no build rules, but they still have to be recognisable. The
 * outlines are traced off the game's meshes rather than drawn from memory, so
 * these guard the trace and the display-only parse that feeds it.
 */
describe('drawing what cannot be built', () => {
  it('draws a gem shape even though it refuses to plan it', () => {
    expect(parseShapeCode('XrXrXrXr').ok).toBe(false)

    const display = parseShapeCodeForDisplay('XrXrXrXr')
    expect(display.ok).toBe(true)
    if (display.ok) {
      expect(display.shape.layers[0]).toHaveLength(4)
      expect(display.shape.layers[0][0].type?.code).toBe('X')
      expect(display.shape.layers[0][0].color).toBe('r')
    }
  })

  it('draws black without letting a plan use it', () => {
    expect(parseShapeCode('RkSuRkSu:SuRrSuRr').ok).toBe(false)
    expect(parseShapeCodeForDisplay('RkSuRkSu:SuRrSuRr').ok).toBe(true)
    expect(COLORS).not.toContain('k')
    expect(PAINTABLE_COLORS).not.toContain('k')
  })

  it('keeps the trade parts away from the solver', () => {
    for (const code of ['X', 'Y']) {
      expect(QUAD_CONFIG.partsByCode[code], code).toBeUndefined()
      expect(QUAD_CONFIG.mineableParts, code).not.toContain(code)
      expect(DISPLAY_QUAD_CONFIG.partsByCode[code], code).toBeDefined()
    }
  })

  it('still rejects a genuinely bad code', () => {
    expect(parseShapeCodeForDisplay('ZuZuZuZu').ok).toBe(false)
    expect(parseShapeCodeForDisplay('XqXqXqXq').ok).toBe(false)
  })

  it('traced the outlines off the meshes, checked against known parts', () => {
    // the circle quarter has to come out round and the windmill has to keep its
    // bite, or the trace that produced X and Y was wrong too
    expect(tradePartShapes.controls.C.min).toBeGreaterThan(0.95)
    expect(tradePartShapes.controls.W.min).toBeLessThan(0.85)

    for (const [code, polygon] of Object.entries(tradePartShapes.parts)) {
      expect(polygon.length, code).toBeGreaterThan(3)
      for (const [along, across] of polygon) {
        expect(along, code).toBeGreaterThanOrEqual(0)
        expect(across, code).toBeGreaterThanOrEqual(0)
        expect(Math.hypot(along, across), code).toBeLessThanOrEqual(1.001)
      }
      // the outline runs from one axis round to the other
      expect(polygon[0][1], code).toBe(0)
      expect(polygon[polygon.length - 1][0], code).toBe(0)
    }
  })
})
