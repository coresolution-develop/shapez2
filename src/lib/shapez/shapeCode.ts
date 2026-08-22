import {
  EMPTY_CHAR,
  HEX_CONFIG,
  LAYER_SEPARATOR,
  QUAD_CONFIG,
  SHAPES_CONFIGS,
  emptyPart,
  isColorCode,
  type ColorCode,
  type Layer,
  type Part,
  type Shape,
  type ShapesConfig,
} from './types'

export interface ParseSuccess {
  ok: true
  shape: Shape
  config: ShapesConfig
}

export interface ParseFailure {
  ok: false
  error: string
}

export type ParseResult = ParseSuccess | ParseFailure

/**
 * Parts that only ever come out of a 제조 (Converter) trade station — the gems
 * and the vortex shape. No machine produces them, so the simulator has no rules
 * for them; they are named here only so the error says what they actually are.
 */
export const TRADE_PARTS = ['X', 'Y']

/**
 * Parses a shape code such as `CuRuCuRu:P-cg----`.
 * Layers are bottom-to-top, parts run clockwise from the top-right.
 */
export function parseShapeCode(code: string, forceConfig?: ShapesConfig): ParseResult {
  const trimmed = code.trim()
  if (trimmed === '') return { ok: false, error: '도형 코드가 비어 있습니다' }

  const layerCodes = trimmed.split(LAYER_SEPARATOR)
  const expectedLength = layerCodes[0].length

  for (const [index, layer] of layerCodes.entries()) {
    if (layer === '') {
      return { ok: false, error: `${index + 1}번째 레이어가 비어 있습니다` }
    }
    if (layer.length % 2 !== 0) {
      return { ok: false, error: `${index + 1}번째 레이어의 길이가 짝수가 아닙니다` }
    }
    if (layer.length !== expectedLength) {
      return {
        ok: false,
        error: `${index + 1}번째 레이어의 길이가 다릅니다 (${expectedLength}자여야 함)`,
      }
    }
  }

  const candidates = forceConfig ? [forceConfig] : SHAPES_CONFIGS
  let error: string | null = null

  for (const config of candidates) {
    // A config with the wrong part count is simply not this code's config; only
    // report that if no config fits, so a genuine "unknown part" error from the
    // config that *did* fit isn't buried under a misleading length complaint.
    if (expectedLength !== config.numPartsPerLayer * 2) continue
    const attempt = parseWithConfig(layerCodes, config)
    if (attempt.ok) return attempt
    error ??= attempt.error
  }

  return {
    ok: false,
    error:
      error ?? `레이어당 ${expectedLength / 2}개 파트는 지원되지 않습니다 (quad=4, hex=6)`,
  }
}

function parseWithConfig(layerCodes: string[], config: ShapesConfig): ParseResult {
  const layers: Layer[] = []

  for (const [layerIndex, layerCode] of layerCodes.entries()) {
    const layer: Layer = []

    for (let i = 0; i < layerCode.length; i += 2) {
      const typeChar = layerCode[i]
      const colorChar = layerCode[i + 1]

      if (typeChar === EMPTY_CHAR) {
        if (colorChar !== EMPTY_CHAR) {
          return {
            ok: false,
            error: `${layerIndex + 1}번째 레이어 ${i + 2}번째 문자는 '${EMPTY_CHAR}'여야 합니다`,
          }
        }
        layer.push(emptyPart())
        continue
      }

      const type = config.partsByCode[typeChar]
      if (!type) {
        if (TRADE_PARTS.includes(typeChar)) {
          return {
            ok: false,
            error: `${typeChar}는 무역소에서 받는 도형이라 기계로 만들 수 없습니다`,
          }
        }
        return { ok: false, error: `유효하지 않은 도형 문자: ${typeChar}` }
      }

      if (type.hasColor) {
        if (!isColorCode(colorChar)) {
          return { ok: false, error: `유효하지 않은 색상 문자: ${colorChar}` }
        }
        layer.push({ type, color: colorChar })
      } else {
        if (colorChar !== EMPTY_CHAR) {
          return {
            ok: false,
            error: `${layerIndex + 1}번째 레이어 ${i + 2}번째 문자는 '${EMPTY_CHAR}'여야 합니다`,
          }
        }
        layer.push({ type, color: null })
      }
    }

    layers.push(layer)
  }

  return { ok: true, shape: { layers }, config }
}

export function partToCode(part: Part): string {
  return (part.type === null ? EMPTY_CHAR : part.type.code) + (part.color === null ? EMPTY_CHAR : part.color)
}

export function toShapeCode(shape: Shape): string {
  return shape.layers.map((layer) => layer.map(partToCode).join('')).join(LAYER_SEPARATOR)
}

export function shapesEqual(a: Shape, b: Shape): boolean {
  return toShapeCode(a) === toShapeCode(b)
}

/** Builds a single-layer, fully filled shape — what an extractor outputs. */
export function fullShape(typeCode: string, config: ShapesConfig, color: ColorCode = 'u'): Shape {
  const type = config.partsByCode[typeCode]
  if (!type) throw new Error(`Unknown part type: ${typeCode}`)
  return {
    layers: [Array.from({ length: config.numPartsPerLayer }, () => ({ type, color }))],
  }
}

export function configFor(shape: Shape): ShapesConfig {
  return shape.layers[0].length === HEX_CONFIG.numPartsPerLayer ? HEX_CONFIG : QUAD_CONFIG
}
