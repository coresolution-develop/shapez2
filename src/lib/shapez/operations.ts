import { breakCrystals, cleanUpEmptyUpperLayers, crystalsFused, makeLayersFall } from './physics'
import {
  copyShape,
  emptyLayer,
  emptyPart,
  numParts as getNumParts,
  type ColorCode,
  type Layer,
  type OperationConfig,
  type Shape,
} from './types'

export class InvalidOperationInputs extends Error {}

function assertSameNumParts(name: string, shapes: Shape[]): void {
  const expected = getNumParts(shapes[0])
  for (const shape of shapes.slice(1)) {
    if (getNumParts(shape) !== expected) {
      throw new InvalidOperationInputs(
        `'${name}' 연산은 레이어당 파트 수가 다른 도형을 지원하지 않습니다`,
      )
    }
  }
}

/** Splits the shape along the vertical axis. Returns `[west, east]`. */
export function cut(shape: Shape): [Shape, Shape] {
  const numParts = getNumParts(shape)
  const takeParts = Math.ceil(numParts / 2)
  const cutPoints: [number, number][] = [
    [0, numParts - 1],
    [numParts - takeParts, numParts - takeParts - 1],
  ]

  const layers = copyShape(shape).layers

  for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    for (const [a, b] of cutPoints) {
      if (crystalsFused(layers[layerIndex][a], layers[layerIndex][b])) {
        breakCrystals(layers, layerIndex, a)
      }
    }
  }

  const westLayers: Layer[] = []
  const eastLayers: Layer[] = []

  for (const layer of layers) {
    westLayers.push([
      ...Array.from({ length: numParts - takeParts }, emptyPart),
      ...layer.slice(numParts - takeParts),
    ])
    eastLayers.push([
      ...layer.slice(0, numParts - takeParts),
      ...Array.from({ length: takeParts }, emptyPart),
    ])
  }

  return [
    { layers: cleanUpEmptyUpperLayers(makeLayersFall(westLayers)) },
    { layers: cleanUpEmptyUpperLayers(makeLayersFall(eastLayers)) },
  ]
}

/** Keeps only the east half — the west half is destroyed. */
export function halfCut(shape: Shape): Shape {
  return cut(shape)[1]
}

export function rotate90CW(shape: Shape): Shape {
  return {
    layers: shape.layers.map((layer) => [layer[layer.length - 1], ...layer.slice(0, -1)].map((p) => ({ ...p }))),
  }
}

export function rotate90CCW(shape: Shape): Shape {
  return {
    layers: shape.layers.map((layer) => [...layer.slice(1), layer[0]].map((p) => ({ ...p }))),
  }
}

export function rotate180(shape: Shape): Shape {
  const takeParts = Math.ceil(getNumParts(shape) / 2)
  return {
    layers: shape.layers.map((layer) => [...layer.slice(takeParts), ...layer.slice(0, takeParts)].map((p) => ({ ...p }))),
  }
}

/** Exchanges the west halves of two shapes. */
export function swapHalves(shapeA: Shape, shapeB: Shape): [Shape, Shape] {
  assertSameNumParts('swap', [shapeA, shapeB])

  const numLayers = Math.max(shapeA.layers.length, shapeB.layers.length)
  const numParts = getNumParts(shapeA)
  const takeParts = Math.ceil(numParts / 2)

  const pad = (shape: Shape): Layer[] => [
    ...shape.layers,
    ...Array.from({ length: numLayers - shape.layers.length }, () => emptyLayer(numParts)),
  ]

  const [aWest, aEast] = cut(shapeA).map(pad)
  const [bWest, bEast] = cut(shapeB).map(pad)

  const resultA: Layer[] = []
  const resultB: Layer[] = []

  for (let i = 0; i < numLayers; i++) {
    resultA.push([...aEast[i].slice(0, -takeParts), ...bWest[i].slice(-takeParts)].map((p) => ({ ...p })))
    resultB.push([...bEast[i].slice(0, -takeParts), ...aWest[i].slice(-takeParts)].map((p) => ({ ...p })))
  }

  return [
    { layers: cleanUpEmptyUpperLayers(resultA) },
    { layers: cleanUpEmptyUpperLayers(resultB) },
  ]
}

export function stack(bottomShape: Shape, topShape: Shape, config: OperationConfig): Shape {
  assertSameNumParts('stack', [bottomShape, topShape])

  const numParts = getNumParts(bottomShape)
  const newLayers: Layer[] = [
    ...copyShape(bottomShape).layers,
    emptyLayer(numParts),
    ...copyShape(topShape).layers,
  ]

  const fallen = cleanUpEmptyUpperLayers(makeLayersFall(newLayers))
  return { layers: fallen.slice(0, config.maxShapeLayers) }
}

/** Paints the topmost layer only. */
export function topPaint(shape: Shape, color: ColorCode): Shape {
  const layers = copyShape(shape).layers
  const top = layers[layers.length - 1].map((part) =>
    part.type !== null && part.type.canChangeColor ? { type: part.type, color } : part,
  )
  return { layers: [...layers.slice(0, -1), top] }
}

/** Lifts the shape and inserts a pin under every non-empty bottom-layer part. */
export function pushPin(shape: Shape, config: OperationConfig): Shape {
  const layers = copyShape(shape).layers
  const pinType = config.shapesConfig.partsByCode.P

  const pins: Layer = layers[0].map((part) =>
    part.type === null ? emptyPart() : { type: pinType, color: null },
  )

  let newLayers: Layer[]
  if (layers.length < config.maxShapeLayers) {
    newLayers = [pins, ...layers]
  } else {
    newLayers = [pins, ...layers.slice(0, config.maxShapeLayers - 1)]
    const removedLayer = layers[config.maxShapeLayers - 1]
    for (let partIndex = 0; partIndex < newLayers[newLayers.length - 1].length; partIndex++) {
      if (crystalsFused(newLayers[newLayers.length - 1][partIndex], removedLayer[partIndex])) {
        breakCrystals(newLayers, config.maxShapeLayers - 1, partIndex)
      }
    }
  }

  return { layers: cleanUpEmptyUpperLayers(makeLayersFall(newLayers)) }
}

/** Fills every empty slot and pin with a crystal of the given color. */
export function genCrystal(shape: Shape, color: ColorCode, config: OperationConfig): Shape {
  const crystalType = config.shapesConfig.partsByCode.c
  return {
    layers: shape.layers.map((layer) =>
      layer.map((part) =>
        part.type === null || part.type.replacedByCrystal
          ? { type: crystalType, color }
          : { ...part },
      ),
    ),
  }
}

export const OPERATION_IDS = [
  'cut',
  'hcut',
  'r90cw',
  'r90ccw',
  'r180',
  'swap',
  'stack',
  'paint',
  'pin',
  'crystal',
] as const

export type OperationId = (typeof OPERATION_IDS)[number]

export interface OperationMeta {
  id: OperationId
  /** Building name as it appears in game. */
  building: string
  labelKo: string
  inputs: number
  outputs: number
  needsColor: boolean
}

export const OPERATIONS: Record<OperationId, OperationMeta> = {
  cut: { id: 'cut', building: 'Cutter', labelKo: '절단', inputs: 1, outputs: 2, needsColor: false },
  hcut: { id: 'hcut', building: 'Half Destroyer', labelKo: '반파괴', inputs: 1, outputs: 1, needsColor: false },
  r90cw: { id: 'r90cw', building: 'Rotator (CW)', labelKo: '시계 90°', inputs: 1, outputs: 1, needsColor: false },
  r90ccw: { id: 'r90ccw', building: 'Rotator (CCW)', labelKo: '반시계 90°', inputs: 1, outputs: 1, needsColor: false },
  r180: { id: 'r180', building: 'Rotator (180°)', labelKo: '180° 회전', inputs: 1, outputs: 1, needsColor: false },
  swap: { id: 'swap', building: 'Swapper', labelKo: '반쪽 교환', inputs: 2, outputs: 2, needsColor: false },
  stack: { id: 'stack', building: 'Stacker', labelKo: '적층', inputs: 2, outputs: 1, needsColor: false },
  paint: { id: 'paint', building: 'Painter', labelKo: '도색', inputs: 1, outputs: 1, needsColor: true },
  pin: { id: 'pin', building: 'Pin Pusher', labelKo: '핀 삽입', inputs: 1, outputs: 1, needsColor: false },
  crystal: { id: 'crystal', building: 'Crystal Generator', labelKo: '크리스탈 생성', inputs: 1, outputs: 1, needsColor: true },
}

/** Runs an operation and returns all of its outputs. */
export function applyOperation(
  op: OperationId,
  inputs: Shape[],
  config: OperationConfig,
  color?: ColorCode,
): Shape[] {
  switch (op) {
    case 'cut':
      return cut(inputs[0])
    case 'hcut':
      return [halfCut(inputs[0])]
    case 'r90cw':
      return [rotate90CW(inputs[0])]
    case 'r90ccw':
      return [rotate90CCW(inputs[0])]
    case 'r180':
      return [rotate180(inputs[0])]
    case 'swap':
      return swapHalves(inputs[0], inputs[1])
    case 'stack':
      return [stack(inputs[0], inputs[1], config)]
    case 'paint':
      if (!color) throw new InvalidOperationInputs('도색 연산에는 색상이 필요합니다')
      return [topPaint(inputs[0], color)]
    case 'pin':
      return [pushPin(inputs[0], config)]
    case 'crystal':
      if (!color) throw new InvalidOperationInputs('크리스탈 생성에는 색상이 필요합니다')
      return [genCrystal(inputs[0], color, config)]
  }
}
