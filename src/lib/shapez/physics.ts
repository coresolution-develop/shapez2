import { emptyPart, type Layer, type Part } from './types'

export type ConnectFn = (a: Part, b: Part) => boolean

/** Two parts hold hands horizontally (pins never do). */
export function gravityConnected(a: Part, b: Part): boolean {
  if (a.type === null || b.type === null) return false
  return a.type.connectsHorizontally && b.type.connectsHorizontally
}

/** Two crystals touching each other shatter together. */
export function crystalsFused(a: Part, b: Part): boolean {
  if (a.type === null || b.type === null) return false
  return a.type.crystalBehavior && b.type.crystalBehavior
}

function correctedIndex(length: number, index: number): number {
  if (index > length - 1) return index - length
  if (index < 0) return length + index
  return index
}

/**
 * Walks outward from `index` in both directions until the chain breaks.
 * Mirrors the game's ring-walk (not a flood fill).
 */
export function connectedSingleLayer(layer: Layer, index: number, connected: ConnectFn): number[] {
  if (layer[index].type === null) return []

  const result = [index]
  let previous = index

  for (let i = index + 1; i < layer.length + index; i++) {
    const current = correctedIndex(layer.length, i)
    if (!connected(layer[previous], layer[current])) break
    result.push(current)
    previous = current
  }

  previous = index
  for (let i = index - 1; i > -layer.length + index; i--) {
    const current = correctedIndex(layer.length, i)
    if (result.includes(current)) break
    if (!connected(layer[previous], layer[current])) break
    result.push(current)
    previous = current
  }

  return result
}

export function connectedMultiLayer(
  layers: Layer[],
  layerIndex: number,
  partIndex: number,
  connected: ConnectFn,
): [number, number][] {
  if (layers[layerIndex][partIndex].type === null) return []

  const result: [number, number][] = [[layerIndex, partIndex]]
  const has = (l: number, p: number) => result.some(([a, b]) => a === l && b === p)

  for (let cursor = 0; cursor < result.length; cursor++) {
    const [curLayer, curPart] = result[cursor]

    for (const index of connectedSingleLayer(layers[curLayer], curPart, connected)) {
      if (!has(curLayer, index)) result.push([curLayer, index])
    }

    if (curLayer > 0 && !has(curLayer - 1, curPart)) {
      if (connected(layers[curLayer][curPart], layers[curLayer - 1][curPart])) {
        result.push([curLayer - 1, curPart])
      }
    }

    if (curLayer < layers.length - 1 && !has(curLayer + 1, curPart)) {
      if (connected(layers[curLayer][curPart], layers[curLayer + 1][curPart])) {
        result.push([curLayer + 1, curPart])
      }
    }
  }

  return result
}

/** Destroys the whole fused crystal cluster containing the given part. */
export function breakCrystals(layers: Layer[], layerIndex: number, partIndex: number): void {
  for (const [l, p] of connectedMultiLayer(layers, layerIndex, partIndex, crystalsFused)) {
    layers[l][p] = emptyPart()
  }
}

/**
 * Applies shape gravity: unsupported crystals shatter, unsupported connected
 * groups drop to the lowest free layer. Mutates and returns `layers`.
 */
export function makeLayersFall(layers: Layer[]): Layer[] {
  const numParts = layers[0].length

  const separateInGroups = (layer: Layer): number[][] => {
    const handled = new Set<number>()
    const groups: number[][] = []
    for (let partIndex = 0; partIndex < layer.length; partIndex++) {
      if (handled.has(partIndex)) continue
      const group = connectedSingleLayer(layer, partIndex, gravityConnected)
      if (group.length > 0) {
        groups.push(group)
        group.forEach((i) => handled.add(i))
      }
    }
    return groups
  }

  let supported: (boolean | null)[][] = []

  const isPartSupported = (
    layerIndex: number,
    partIndex: number,
    visited: [number, number][],
  ): boolean => {
    const cached = supported[layerIndex][partIndex]
    if (cached !== null) return cached

    const curPart = layers[layerIndex][partIndex]
    const wasVisited = (l: number, p: number) => visited.some(([a, b]) => a === l && b === p)

    const inner = (): boolean => {
      if (curPart.type === null) return false
      if (layerIndex === 0) return true

      const toGive: [number, number][] = [...visited, [layerIndex, partIndex]]

      if (!wasVisited(layerIndex - 1, partIndex) && isPartSupported(layerIndex - 1, partIndex, toGive)) {
        return true
      }

      const next = correctedIndex(numParts, partIndex + 1)
      if (
        !wasVisited(layerIndex, next) &&
        gravityConnected(curPart, layers[layerIndex][next]) &&
        isPartSupported(layerIndex, next, toGive)
      ) {
        return true
      }

      const prev = correctedIndex(numParts, partIndex - 1)
      if (
        !wasVisited(layerIndex, prev) &&
        gravityConnected(curPart, layers[layerIndex][prev]) &&
        isPartSupported(layerIndex, prev, toGive)
      ) {
        return true
      }

      // a crystal can be held up by the fused crystal above it
      if (
        layerIndex + 1 < layers.length &&
        !wasVisited(layerIndex + 1, partIndex) &&
        crystalsFused(curPart, layers[layerIndex + 1][partIndex]) &&
        isPartSupported(layerIndex + 1, partIndex, toGive)
      ) {
        return true
      }

      return false
    }

    const result = inner()
    supported[layerIndex][partIndex] = result
    return result
  }

  const computeSupport = () => {
    supported = layers.map(() => Array.from({ length: numParts }, () => null as boolean | null))
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      for (let partIndex = 0; partIndex < numParts; partIndex++) {
        isPartSupported(layerIndex, partIndex, [])
      }
    }
  }

  computeSupport()

  // an unsupported crystal shatters instead of falling
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    for (let partIndex = 0; partIndex < numParts; partIndex++) {
      const part = layers[layerIndex][partIndex]
      if (part.type !== null && part.type.crystalBehavior && !supported[layerIndex][partIndex]) {
        layers[layerIndex][partIndex] = emptyPart()
      }
    }
  }

  // shattering can change what else is supported
  computeSupport()

  for (let layerIndex = 1; layerIndex < layers.length; layerIndex++) {
    for (const group of separateInGroups(layers[layerIndex])) {
      if (group.some((p) => supported[layerIndex][p])) continue

      let fallTo = layerIndex
      for (let candidate = layerIndex; candidate >= 0; candidate--) {
        fallTo = candidate
        if (candidate === 0) break
        const blocked = group.some((partIndex) => layers[candidate - 1][partIndex].type !== null)
        if (blocked) break
      }

      for (const partIndex of group) {
        layers[fallTo][partIndex] = layers[layerIndex][partIndex]
        layers[layerIndex][partIndex] = emptyPart()
      }
    }
  }

  return layers
}

/** Drops trailing layers that are entirely empty (always keeps at least one). */
export function cleanUpEmptyUpperLayers(layers: Layer[]): Layer[] {
  let last = 0
  for (let i = layers.length - 1; i >= 0; i--) {
    last = i
    if (layers[i].some((p) => p.type !== null)) break
  }
  return layers.slice(0, last + 1)
}
