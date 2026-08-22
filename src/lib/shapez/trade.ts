/**
 * Trade stations — where shapes come from when no machine can make them.
 *
 * 제조 (Converter) mode is built around swapping: you feed a station the shapes
 * it asks for and it hands back a gem shape, which the next tier's station
 * wants as *its* input. So "you can't build this" is only half an answer; the
 * useful half is which station produces it and what it wants in return.
 *
 * Recipes come straight out of the scenario data (see
 * `scripts/extractScenarios.py`), so they stay right through game updates.
 */
import { PROGRESSION, type ScenarioKey } from './progression'
import { TRADE_PARTS, parseShapeCode } from './shapeCode'

export interface TradeStation {
  id: string
  title: string
  titleKo: string
  descriptionKo: string
  chunkCost: number | null
  inputs: string[]
  outputs: string[]
  conversionsPerRocket: number | null
  convertersPerFullBelt: number | null
  requiredUpgradeIds: string[]
}

/** True for a shape that only a trade station can hand you. */
export function isTradeShape(code: string): boolean {
  return code.split(':').some((layer) => {
    for (let i = 0; i < layer.length; i += 2) {
      if (TRADE_PARTS.includes(layer[i])) return true
    }
    return false
  })
}

export function tradeStations(scenario: ScenarioKey): TradeStation[] {
  return (PROGRESSION[scenario]?.tradeStations ?? []) as TradeStation[]
}

/**
 * Stations that output the given shape, best match first.
 *
 * A station is a match when it produces the shape outright. Failing that, one
 * whose output only differs by which quarters are filled still tells you where
 * the shape comes from — the game's tier-3 station, for instance, emits
 * `----XgXg` and you stack two of those into `XgXgXgXg`.
 */
export function stationsProducing(scenario: ScenarioKey, code: string): TradeStation[] {
  const exact: TradeStation[] = []
  const related: TradeStation[] = []

  for (const station of tradeStations(scenario)) {
    if (station.outputs.includes(code)) exact.push(station)
    else if (station.outputs.some((output) => sharesTradeParts(output, code))) related.push(station)
  }

  return [...exact, ...related]
}

/** Stations that ask for the given shape — what you are feeding, and why. */
export function stationsConsuming(scenario: ScenarioKey, code: string): TradeStation[] {
  return tradeStations(scenario).filter((station) => station.inputs.includes(code))
}

/** The inputs of a station that the app can actually plan a factory for. */
export function buildableInputs(station: TradeStation): string[] {
  return station.inputs.filter((input) => parseShapeCode(input).ok)
}

/** Same gem in the same colour, regardless of how the quarters are arranged. */
function sharesTradeParts(a: string, b: string): boolean {
  const gems = (code: string) => {
    const found = new Set<string>()
    for (const layer of code.split(':')) {
      for (let i = 0; i < layer.length; i += 2) {
        if (TRADE_PARTS.includes(layer[i])) found.add(layer.slice(i, i + 2))
      }
    }
    return found
  }

  const left = gems(a)
  if (left.size === 0) return false
  const right = gems(b)
  return [...left].some((gem) => right.has(gem))
}
