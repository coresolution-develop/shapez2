/**
 * The game's own Korean names.
 *
 * Pulled straight out of an installed copy of shapez 2 (see
 * `scripts/extractKoreanNames.py`), because the whole point is that a building
 * is called here what the player sees it called in game. Transliterations like
 * "스태커" or "페인터" are wrong — the game says 결합기 and 색칠기.
 *
 * Milestone titles are not in here: those live in the compressed scenario
 * bundles, so they stay in English until there's a way to read them.
 */
import namesData from './namesKo.json'
import type { ColorCode } from './types'

interface Names {
  buildingVariants: Record<string, string>
  islands: Record<string, string>
  colors: Record<string, string>
  sideGoals: Record<string, string>
}

const NAMES = namesData as Names

/** Korean name for a building variant, falling back to whatever we were given. */
export function buildingNameKo(variant: string, fallback = variant): string {
  return NAMES.buildingVariants[variant] ?? fallback
}

export function islandNameKo(island: string, fallback = island): string {
  return NAMES.islands[island] ?? fallback
}

export function colorNameKo(color: ColorCode): string {
  return NAMES.colors[color] ?? color
}

/** Side quest names are keyed by the id in the scenario's group title. */
export function sideGoalNameKo(id: string, fallback = id): string {
  return NAMES.sideGoals[id] ?? fallback
}

/**
 * Shape parts have no individual names in the game's UI — `원, 별, 정사각형`
 * only shows up in one side quest title. These follow that wording, except the
 * windmill, which the game never names on its own.
 */
export const PART_NAMES_KO: Record<string, string> = {
  C: '원',
  R: '정사각형',
  S: '별',
  W: '다이아몬드',
  H: '육각형',
  G: '기어',
  F: '꽃',
  P: '지지 핀',
  c: '결정체',
}

/** Buildings each operation runs on, named the way the game names them. */
export const OPERATION_VARIANTS = {
  cut: 'CutterDefaultVariant',
  hcut: 'CutterHalfVariant',
  r90cw: 'RotatorOneQuadVariant',
  r90ccw: 'RotatorOneQuadCCWVariant',
  r180: 'RotatorHalfVariant',
  stack: 'StackerStraightVariant',
  swap: 'HalvesSwapperDefaultVariant',
  paint: 'PainterDefaultVariant',
  pin: 'PinPusherDefaultVariant',
  crystal: 'CrystalGeneratorDefaultVariant',
} as const
