import { describe, expect, it } from 'vitest'

import { PROGRESSION, SCENARIO_KEYS } from '../progression'
import { parseShapeCode } from '../shapeCode'
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
