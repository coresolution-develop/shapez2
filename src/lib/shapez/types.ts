/**
 * Core shapez 2 domain types.
 *
 * Ported 1:1 from the official `shapez2` python package (Loupau38/shapez2-python),
 * which mirrors the game's own shape logic. Keep the semantics identical — the
 * solver relies on this being an exact simulator.
 */

export const LAYER_SEPARATOR = ':'
export const EMPTY_CHAR = '-'

export type ColorCode = 'u' | 'r' | 'g' | 'b' | 'c' | 'm' | 'y' | 'w'

export const COLORS: readonly ColorCode[] = ['u', 'r', 'g', 'b', 'c', 'm', 'y', 'w']

/** Colors a painter can actually apply (uncolored is the absence of paint). */
export const PAINTABLE_COLORS: readonly ColorCode[] = ['r', 'g', 'b', 'c', 'm', 'y', 'w']

export function isColorCode(char: string): char is ColorCode {
  return (COLORS as readonly string[]).includes(char)
}

export interface PartType {
  code: string
  hasColor: boolean
  canChangeColor: boolean
  connectsHorizontally: boolean
  crystalBehavior: boolean
  replacedByCrystal: boolean
}

function partType(code: string, overrides: Partial<PartType> = {}): PartType {
  return {
    code,
    hasColor: true,
    canChangeColor: true,
    connectsHorizontally: true,
    crystalBehavior: false,
    replacedByCrystal: false,
    ...overrides,
  }
}

export const PIN_PART = partType('P', {
  hasColor: false,
  canChangeColor: false,
  connectsHorizontally: false,
  replacedByCrystal: true,
})

export const CRYSTAL_PART = partType('c', {
  canChangeColor: false,
  crystalBehavior: true,
})

export const PART_TYPES: Record<string, PartType> = {
  C: partType('C'),
  R: partType('R'),
  S: partType('S'),
  W: partType('W'),
  H: partType('H'),
  G: partType('G'),
  F: partType('F'),
  P: PIN_PART,
  c: CRYSTAL_PART,
}

export interface ShapesConfig {
  id: 'quad' | 'hex'
  label: string
  numPartsPerLayer: number
  /** Types an extractor can mine, in order of map-generation rarity. */
  mineableParts: string[]
  partsByCode: Record<string, PartType>
}

export const QUAD_CONFIG: ShapesConfig = {
  id: 'quad',
  label: 'Quad (4분면)',
  numPartsPerLayer: 4,
  mineableParts: ['C', 'R', 'S', 'W'],
  partsByCode: {
    C: PART_TYPES.C,
    R: PART_TYPES.R,
    S: PART_TYPES.S,
    W: PART_TYPES.W,
    P: PIN_PART,
    c: CRYSTAL_PART,
  },
}

export const HEX_CONFIG: ShapesConfig = {
  id: 'hex',
  label: 'Hex (6분면)',
  numPartsPerLayer: 6,
  mineableParts: ['H', 'G', 'F'],
  partsByCode: {
    H: PART_TYPES.H,
    G: PART_TYPES.G,
    F: PART_TYPES.F,
    P: PIN_PART,
    c: CRYSTAL_PART,
  },
}

export const SHAPES_CONFIGS: readonly ShapesConfig[] = [QUAD_CONFIG, HEX_CONFIG]

/** Max layers per scenario. "Insane" allows a 5th layer. */
export const MAX_LAYERS = { normal: 4, insane: 5 } as const
export type ScenarioId = keyof typeof MAX_LAYERS

export interface OperationConfig {
  maxShapeLayers: number
  shapesConfig: ShapesConfig
}

export function operationConfig(
  shapesConfig: ShapesConfig,
  scenario: ScenarioId = 'normal',
): OperationConfig {
  return { maxShapeLayers: MAX_LAYERS[scenario], shapesConfig }
}

/** `type === null` means an empty slot; pins carry a `null` color. */
export interface Part {
  type: PartType | null
  color: ColorCode | null
}

export type Layer = Part[]

export const EMPTY_PART: Part = { type: null, color: null }

export function emptyPart(): Part {
  return { type: null, color: null }
}

export function emptyLayer(numParts: number): Layer {
  return Array.from({ length: numParts }, emptyPart)
}

/** Layers are ordered bottom to top. */
export interface Shape {
  layers: Layer[]
}

export function numParts(shape: Shape): number {
  return shape.layers[0].length
}

export function copyShape(shape: Shape): Shape {
  return { layers: shape.layers.map((layer) => layer.map((p) => ({ ...p }))) }
}

export function isEmptyShape(shape: Shape): boolean {
  return shape.layers.every((layer) => layer.every((p) => p.type === null))
}

export function partsEqual(a: Part, b: Part): boolean {
  return a.type?.code === b.type?.code && a.color === b.color
}

/** RGB values per color, per in-game color mode (skin). */
export const COLOR_SKINS: Record<string, Record<ColorCode, string>> = {
  RGB: {
    u: '#a49ea5',
    r: '#ff0000',
    g: '#00ff00',
    b: '#0000ff',
    c: '#00ffff',
    m: '#ff00ff',
    y: '#ffff00',
    w: '#ffffff',
  },
  RYB: {
    u: '#a49ea5',
    r: '#ff0000',
    g: '#ffff00',
    b: '#0000ff',
    c: '#00ff00',
    m: '#a729cf',
    y: '#d5850d',
    w: '#564d4e',
  },
  CMYK: {
    u: '#a49ea5',
    r: '#00ffff',
    g: '#ff00ff',
    b: '#ffff00',
    c: '#ff0000',
    m: '#00ff00',
    y: '#0000ff',
    w: '#564d4e',
  },
}

export type ColorSkinId = keyof typeof COLOR_SKINS

export const COLOR_NAMES_KO: Record<ColorCode, string> = {
  u: '무색',
  r: '빨강',
  g: '초록',
  b: '파랑',
  c: '시안',
  m: '마젠타',
  y: '노랑',
  w: '흰색',
}

export const PART_NAMES_KO: Record<string, string> = {
  C: '원형',
  R: '사각',
  S: '별',
  W: '다이아몬드',
  H: '육각',
  G: '기어',
  F: '꽃',
  P: '핀',
  c: '크리스탈',
}

/** Paint mixing recipes, derived the same way the game builds them. */
export const MIX_RECIPES: Record<string, ColorCode> = (() => {
  const recipes: Record<string, ColorCode> = {}
  const key = (a: ColorCode, b: ColorCode) => [a, b].sort().join('')
  const secondary: Record<string, [ColorCode, ColorCode]> = {
    c: ['g', 'b'],
    m: ['r', 'b'],
    y: ['r', 'g'],
  }
  const primaries: ColorCode[] = ['r', 'g', 'b']

  for (const [result, [i1, i2]] of Object.entries(secondary) as [ColorCode, [ColorCode, ColorCode]][]) {
    recipes[key(i1, i2)] = result
    const notI = primaries.find((p) => p !== i1 && p !== i2)!
    recipes[key(result, notI)] = 'w'
    recipes[key(result, i1)] = i1
    recipes[key(result, i2)] = i2
  }
  for (const p of primaries) {
    const sec = (Object.entries(secondary) as [ColorCode, [ColorCode, ColorCode]][])
      .filter(([, inputs]) => inputs.includes(p))
      .map(([r]) => r)
    recipes[key(sec[0], sec[1])] = p
  }
  for (const c of COLORS) {
    recipes[key(c, c)] = c
    recipes[key('w', c)] = c
    recipes[key('u', c)] = c
  }
  return recipes
})()

export function mixColors(a: ColorCode, b: ColorCode): ColorCode | null {
  return MIX_RECIPES[[a, b].sort().join('')] ?? null
}
