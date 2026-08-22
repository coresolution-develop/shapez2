/**
 * Reverse-engineers a target shape into a tree of in-game operations.
 *
 * Every node is produced by actually running the simulator, and the final
 * result is compared against the target — the solver never reports a plan it
 * hasn't verified.
 */
import { applyOperation, type OperationId } from './operations'
import { cleanUpEmptyUpperLayers, makeLayersFall } from './physics'
import { walk, type BuildNode } from './plan'
import { configFor, fullShape, toShapeCode } from './shapeCode'
import { colorNameKo } from './namesKo'
import {
  MIXER_NAME_KO,
  MIXER_VARIANT,
  OPERATION_BUILDINGS,
  allUnlocks,
  unlockHint,
  type ScenarioKey,
  type Unlocks,
} from './progression'
import { planCost } from './throughput'
import {
  copyShape,
  emptyLayer,
  numParts as getNumParts,
  type ColorCode,
  type Layer,
  type OperationConfig,
  type Part,
  type Shape,
  type ShapesConfig,
} from './types'

export interface SolveSuccess {
  ok: true
  root: BuildNode
  notes: string[]
}

export interface SolveFailure {
  ok: false
  error: string
  hint?: string
}

export type SolveResult = SolveSuccess | SolveFailure

const MAX_CRYSTAL_OPS = 4

class Builder {
  private nodes = new Map<string, BuildNode>()
  private counter = 0

  constructor(
    readonly config: OperationConfig,
    readonly carve: CarveStrategy,
    readonly unlocks: Unlocks,
  ) {}

  /** Whether the player has the building this operation needs. */
  can(op: OperationId): boolean {
    return this.unlocks.operations.has(op)
  }

  canPaint(color: ColorCode): boolean {
    return color === 'u' || this.unlocks.colors.has(color)
  }

  input(partType: string): BuildNode {
    const shape = fullShape(partType, this.config.shapesConfig)
    return this.intern({
      id: '',
      op: null,
      inputs: [],
      outputIndex: 0,
      shape,
      code: toShapeCode(shape),
      sourcePart: partType,
    })
  }

  op(op: OperationId, inputs: BuildNode[], color?: ColorCode, outputIndex = 0): BuildNode {
    const outputs = applyOperation(
      op,
      inputs.map((n) => n.shape),
      this.config,
      color,
    )
    const shape = outputs[outputIndex]
    return this.intern({
      id: '',
      op,
      color,
      inputs,
      outputIndex,
      shape,
      code: toShapeCode(shape),
    })
  }

  /** Reuses structurally identical sub-trees so the plan is a DAG, not a tree. */
  private intern(node: BuildNode): BuildNode {
    const key = [
      node.op ?? `in:${node.sourcePart}`,
      node.color ?? '',
      node.outputIndex,
      node.inputs.map((i) => i.id).join('|'),
    ].join('#')
    const existing = this.nodes.get(key)
    if (existing) return existing
    node.id = `n${this.counter++}`
    this.nodes.set(key, node)
    return node
  }
}

function isCrystal(part: Part): boolean {
  return part.type?.crystalBehavior === true
}

function isPin(part: Part): boolean {
  return part.type?.code === 'P'
}

function isPlain(part: Part): boolean {
  return part.type !== null && !isCrystal(part) && !isPin(part)
}

/** A shape is only real if gravity leaves it exactly as written. */
export function isStable(shape: Shape): boolean {
  const settled = cleanUpEmptyUpperLayers(makeLayersFall(copyShape(shape).layers))
  return toShapeCode({ layers: settled }) === toShapeCode(shape)
}

/** True when `pinLayer` is exactly the pin footprint pushPin would create under `above`. */
function isPinFootprintOf(pinLayer: Layer, above: Layer): boolean {
  return pinLayer.every((part, index) =>
    above[index].type === null ? part.type === null : isPin(part),
  )
}

/**
 * How to carve pieces out of a mined shape.
 *
 * `discard` throws the unwanted half away, which is one cheap building per cut.
 * `keepBoth` uses a real cutter, so two pieces carved from the same shape share
 * one machine and halve the mining demand — better whenever both halves get
 * used, worse when only one does. The solver builds a plan each way and keeps
 * whichever needs fewer buildings.
 */
export type CarveStrategy = 'discard' | 'keepBoth'

const CARVE_OPS: Record<CarveStrategy, [OperationId, number][]> = {
  discard: [
    ['hcut', 0],
    ['r90cw', 0],
    ['r90ccw', 0],
    ['r180', 0],
  ],
  keepBoth: [
    ['cut', 0],
    ['cut', 1],
    ['r90cw', 0],
    ['r90ccw', 0],
    ['r180', 0],
  ],
}

/** BFS over cut/rotate ops to carve a bare piece with the given occupancy. */
function findPiece(
  builder: Builder,
  partType: string,
  wanted: string,
  strategy: CarveStrategy,
): BuildNode | null {
  const start = builder.input(partType)
  if (start.code === wanted) return start

  const seen = new Set([start.code])
  let frontier: BuildNode[] = [start]

  for (let depth = 0; depth < 8 && frontier.length > 0; depth++) {
    const next: BuildNode[] = []
    for (const node of frontier) {
      for (const [op, outputIndex] of CARVE_OPS[strategy]) {
        if (!builder.can(op)) continue
        const child = builder.op(op, [node], undefined, outputIndex)
        if (child.code === wanted) return child
        if (seen.has(child.code)) continue
        seen.add(child.code)
        next.push(child)
      }
    }
    frontier = next
  }

  return null
}

function pieceCode(indices: number[], partType: string, config: ShapesConfig): string {
  const parts = Array.from({ length: config.numPartsPerLayer }, (_, i) =>
    indices.includes(i) ? `${partType}u` : '--',
  )
  return parts.join('')
}

/**
 * Builds a single-layer shape holding `indices` of one type+color.
 * Splits the run in half when the carve isn't reachable in one piece.
 */
function buildRun(
  builder: Builder,
  indices: number[],
  partType: string,
  color: ColorCode,
  config: ShapesConfig,
): BuildNode | null {
  if (color !== 'u' && !builder.canPaint(color)) return null

  const bare = findPiece(builder, partType, pieceCode(indices, partType, config), builder.carve)

  if (!bare) {
    if (indices.length < 2 || !builder.can('stack')) return null
    const mid = Math.ceil(indices.length / 2)
    const left = buildRun(builder, indices.slice(0, mid), partType, color, config)
    const right = buildRun(builder, indices.slice(mid), partType, color, config)
    if (!left || !right) return null
    return builder.op('stack', [left, right])
  }

  return color === 'u' ? bare : builder.op('paint', [bare], color)
}

/** Builds target layer `layer` as a standalone single-layer shape. */
function buildSlice(builder: Builder, layer: Layer, config: ShapesConfig): BuildNode | null | 'empty' {
  const runs: { indices: number[]; type: string; color: ColorCode }[] = []

  for (let i = 0; i < layer.length; i++) {
    const part = layer[i]
    if (!isPlain(part)) continue
    const previous = runs[runs.length - 1]
    const contiguous =
      previous &&
      previous.indices[previous.indices.length - 1] === i - 1 &&
      previous.type === part.type!.code &&
      previous.color === part.color
    if (contiguous) previous.indices.push(i)
    else runs.push({ indices: [i], type: part.type!.code, color: part.color! })
  }

  // a run can wrap around the ring — merge the last into the first when they touch
  if (runs.length > 1) {
    const first = runs[0]
    const last = runs[runs.length - 1]
    if (
      first.indices[0] === 0 &&
      last.indices[last.indices.length - 1] === layer.length - 1 &&
      first.type === last.type &&
      first.color === last.color
    ) {
      first.indices = [...last.indices, ...first.indices]
      runs.pop()
    }
  }

  if (runs.length === 0) return 'empty'

  let node: BuildNode | null = null
  for (const run of runs) {
    const piece = buildRun(builder, run.indices, run.type, run.color, config)
    if (!piece) return null
    if (node !== null && !builder.can('stack')) return null
    node = node === null ? piece : builder.op('stack', [node, piece])
  }
  return node
}

function crystalColors(shape: Shape): ColorCode[] {
  const colors = new Set<ColorCode>()
  for (const layer of shape.layers) {
    for (const part of layer) {
      if (isCrystal(part) && part.color) colors.add(part.color)
    }
  }
  return [...colors]
}

/**
 * Checks that `shape` is a legal partial build of `target` up to layer `depth`:
 * plain parts must already match, crystal slots may still be empty.
 */
function prefixMatches(shape: Shape, target: Shape, depth: number): boolean {
  if (shape.layers.length > depth) return false
  const width = getNumParts(target)

  for (let l = 0; l < depth; l++) {
    const built = shape.layers[l] ?? emptyLayer(width)
    for (let i = 0; i < width; i++) {
      const want = target.layers[l][i]
      const got = built[i]

      if (isCrystal(want)) {
        if (got.type === null) continue
        if (isCrystal(got) && got.color === want.color) continue
        return false
      }
      if (isPin(want)) return false // non-bottom pins are out of scope
      if (want.type === null) {
        if (got.type !== null) return false
        continue
      }
      if (got.type?.code !== want.type.code || got.color !== want.color) return false
    }
  }
  return true
}

/**
 * Stacks target layers bottom-up, interleaving crystal generation where the
 * shape's open slots line up exactly with the crystals we still owe.
 */
function assemble(
  builder: Builder,
  target: Shape,
  config: ShapesConfig,
): BuildNode | null {
  const targetCode = toShapeCode(target)
  const colors = crystalColors(target)
  const visited = new Set<string>()

  const step = (depth: number, node: BuildNode | null, crystalOps: number): BuildNode | null => {
    const key = `${depth}#${node?.code ?? ''}#${crystalOps}`
    if (visited.has(key)) return null
    visited.add(key)

    if (depth === target.layers.length && node && node.code === targetCode) return node

    if (depth < target.layers.length) {
      const slice = buildSlice(builder, target.layers[depth], config)
      if (slice === null) return null // an unbuildable layer kills the branch
      if (slice === 'empty') {
        const result = step(depth + 1, node, crystalOps)
        if (result) return result
      } else {
        if (node !== null && !builder.can('stack')) return null
        const stacked = node === null ? slice : builder.op('stack', [node, slice])
        if (prefixMatches(stacked.shape, target, depth + 1)) {
          const result = step(depth + 1, stacked, crystalOps)
          if (result) return result
        }
      }
    }

    if (node !== null && crystalOps < MAX_CRYSTAL_OPS) {
      for (const color of colors) {
        if (!builder.can('crystal')) break
        const grown = builder.op('crystal', [node], color)
        if (grown.code === node.code) continue
        if (!prefixMatches(grown.shape, target, depth)) continue
        const result = step(depth, grown, crystalOps + 1)
        if (result) return result
      }
    }

    return null
  }

  return step(0, null, 0)
}

/** Keeps only the given columns, trimming layers that end up empty. */
function restrictToColumns(target: Shape, columns: Set<number>): Shape {
  const layers = target.layers.map((layer) =>
    layer.map((part, index) => (columns.has(index) ? { ...part } : { type: null, color: null })),
  )
  return { layers: cleanUpEmptyUpperLayers(layers) }
}

function columnsWith(layer: Layer, predicate: (part: Part) => boolean): Set<number> {
  const result = new Set<number>()
  layer.forEach((part, index) => {
    if (predicate(part)) result.add(index)
  })
  return result
}

function isEmptyEverywhere(target: Shape, columns: Set<number>): boolean {
  return target.layers.every((layer) => [...columns].every((c) => layer[c].type === null))
}

/**
 * Applies the construction patterns players actually use, in rough order of
 * how cheap the resulting factory is. Every candidate is verified against the
 * target before it is accepted, and results are memoised per shape code.
 */
class Solver {
  private memo = new Map<string, BuildNode | null>()
  private inProgress = new Set<string>()
  private budget = 40_000

  constructor(
    private readonly builder: Builder,
    private readonly config: ShapesConfig,
  ) {}

  solve(target: Shape): BuildNode | null {
    const code = toShapeCode(target)
    const cached = this.memo.get(code)
    if (cached !== undefined) return cached
    if (this.inProgress.has(code)) return null
    if (this.budget-- <= 0) return null

    this.inProgress.add(code)

    // Every rule that succeeds gives a valid factory; keep the smallest one.
    let result: BuildNode | null = null
    let cost = Infinity
    for (const rule of [
      this.viaAssembly,
      this.viaPinFootprint,
      this.viaExposedTopPins,
      this.viaPinnedCrystals,
      this.viaLayerSplit,
      this.viaCutFromLarger,
      this.viaSwappedHalves,
      this.viaColumnSplit,
    ]) {
      const candidate = rule.call(this, target, code)
      if (!candidate) continue
      const candidateCost = planCost(candidate)
      if (candidateCost < cost) {
        result = candidate
        cost = candidateCost
      }
    }

    this.inProgress.delete(code)
    this.memo.set(code, result)
    return result
  }

  /** Stack the layers bottom-up, growing crystals along the way. */
  private viaAssembly(target: Shape): BuildNode | null {
    if (target.layers.some((layer) => layer.some(isPin))) return null
    if (target.layers.length > 1 && !this.builder.can('stack')) return null
    return assemble(this.builder, target, this.config)
  }

  /** A pin layer is the footprint the pin pusher stamps under the stack above. */
  private viaPinFootprint(target: Shape, code: string): BuildNode | null {
    if (!this.builder.can('pin')) return null
    const pinLayer = target.layers.findIndex((layer) => layer.some(isPin))
    if (pinLayer < 0 || pinLayer + 1 >= target.layers.length) return null
    if (!isPinFootprintOf(target.layers[pinLayer], target.layers[pinLayer + 1])) return null

    const above = this.solve({ layers: target.layers.slice(pinLayer + 1) })
    if (!above) return null
    const pinned = this.builder.op('pin', [above])

    if (pinLayer === 0) return pinned.code === code ? pinned : null

    const below = this.solve({ layers: cleanUpEmptyUpperLayers(target.layers.slice(0, pinLayer)) })
    if (!below) return null
    const stacked = this.builder.op('stack', [below, pinned])
    return stacked.code === code ? stacked : null
  }

  /**
   * Pins survive on the top layer only when whatever sat on them was cut off by
   * the layer cap, so rebuild that truncation deliberately.
   */
  private viaExposedTopPins(target: Shape, code: string): BuildNode | null {
    if (!this.builder.can('pin') || !this.builder.can('stack')) return null
    const topIndex = target.layers.length - 1
    if (topIndex !== this.builder.config.maxShapeLayers - 1) return null
    if (!target.layers[topIndex].some(isPin)) return null

    const below = this.solve({ layers: cleanUpEmptyUpperLayers(target.layers.slice(0, topIndex)) })
    if (!below) return null

    const filler = this.config.partsByCode[this.config.mineableParts[0]]
    const seed = buildSlice(
      this.builder,
      target.layers[topIndex].map((part) =>
        isPin(part) ? { type: filler, color: 'u' as ColorCode } : { type: null, color: null },
      ),
      this.config,
    )
    const rest = buildSlice(
      this.builder,
      target.layers[topIndex].map((part) => (isPin(part) ? { type: null, color: null } : part)),
      this.config,
    )
    if (!seed || seed === 'empty' || rest === null) return null

    let node = this.builder.op('stack', [below, this.builder.op('pin', [seed])])
    if (rest !== 'empty') node = this.builder.op('stack', [node, rest])
    return node.code === code ? node : null
  }

  /** The crystal generator turns pins into crystals — the usual way to fill a base layer. */
  private viaPinnedCrystals(target: Shape, code: string): BuildNode | null {
    if (!this.builder.can('pin') || !this.builder.can('crystal')) return null
    if (target.layers.length < 2) return null
    const bottom = target.layers[0]
    const colors = new Set<ColorCode>()

    for (const [index, part] of bottom.entries()) {
      const above = target.layers[1][index]
      if (isCrystal(part)) {
        if (above.type === null) return null // no part above means no pin to convert
        colors.add(part.color!)
      } else if (part.type !== null) {
        return null
      } else if (above.type !== null) {
        return null
      }
    }
    if (colors.size !== 1) return null

    const above = this.solve({ layers: target.layers.slice(1) })
    if (!above) return null
    const grown = this.builder.op('crystal', [this.builder.op('pin', [above])], [...colors][0])
    return grown.code === code ? grown : null
  }

  /** Build the lower layers and the upper layers as two shapes, then stack them. */
  private viaLayerSplit(target: Shape, code: string): BuildNode | null {
    if (!this.builder.can('stack')) return null
    for (let split = 1; split < target.layers.length; split++) {
      const below = this.solve({ layers: cleanUpEmptyUpperLayers(target.layers.slice(0, split)) })
      if (!below) continue
      const above = this.solve({ layers: target.layers.slice(split) })
      if (!above) continue
      const stacked = this.builder.op('stack', [below, above])
      if (stacked.code === code) return stacked
    }
    return null
  }

  /**
   * The swapper trades halves without applying gravity, so it is the only way
   * to join two crystal halves — stacking would shatter them.
   */
  private viaSwappedHalves(target: Shape, code: string): BuildNode | null {
    if (!this.builder.can('swap')) return null
    const width = getNumParts(target)
    const takeParts = Math.ceil(width / 2)
    const eastColumns = new Set(Array.from({ length: width - takeParts }, (_, i) => i))
    const westColumns = new Set(Array.from({ length: takeParts }, (_, i) => width - takeParts + i))
    const filler = this.config.partsByCode[this.config.mineableParts[0]]

    const padWith = (columns: Set<number>): Shape => ({
      layers: target.layers.map((layer) =>
        layer.map((part, index) =>
          columns.has(index) ? { type: filler, color: 'u' as ColorCode } : { ...part },
        ),
      ),
    })

    const carriesEast = padWith(westColumns)
    const carriesWest = padWith(eastColumns)
    if (!isStable(carriesEast) || !isStable(carriesWest)) return null

    const a = this.solve(carriesEast)
    if (!a) return null
    const b = this.solve(carriesWest)
    if (!b) return null

    const swapped = this.builder.op('swap', [a, b], undefined, 0)
    return swapped.code === code ? swapped : null
  }

  /**
   * Crystals can't be grown where a shape is already solid, so build a wider
   * shape whose spare half acts as scaffolding and cut it away afterwards.
   */
  private viaCutFromLarger(target: Shape, code: string): BuildNode | null {
    if (!this.builder.can('cut')) return null
    if (!target.layers.some((layer) => layer.some(isCrystal))) return null

    const width = getNumParts(target)
    const takeParts = Math.ceil(width / 2)
    const halves: [Set<number>, number][] = [
      // [columns to pad, index of the cut output that keeps the target]
      [new Set(Array.from({ length: width - takeParts }, (_, i) => i)), 0],
      [new Set(Array.from({ length: takeParts }, (_, i) => width - takeParts + i)), 1],
    ]

    const filler = this.config.partsByCode[this.config.mineableParts[0]]

    for (const [padColumns, outputIndex] of halves) {
      if (!isEmptyEverywhere(target, padColumns)) continue

      const padded: Shape = {
        layers: target.layers.map((layer) =>
          layer.map((part, index) =>
            padColumns.has(index) ? { type: filler, color: 'u' as ColorCode } : { ...part },
          ),
        ),
      }
      if (!isStable(padded)) continue

      const node = this.solve(padded)
      if (!node) continue
      const halved = this.builder.op('cut', [node], undefined, outputIndex)
      if (halved.code === code) return halved
    }
    return null
  }

  /** Build disjoint column groups separately and stack them together. */
  private viaColumnSplit(target: Shape, code: string): BuildNode | null {
    if (!this.builder.can('stack')) return null
    const width = getNumParts(target)
    const takeParts = Math.ceil(width / 2)
    const allColumns = Array.from({ length: width }, (_, i) => i)

    const candidates: Set<number>[] = []
    const pinLayer = target.layers.find((layer) => layer.some(isPin))
    if (pinLayer) candidates.push(columnsWith(pinLayer, isPin))
    candidates.push(new Set(allColumns.slice(0, width - takeParts)))

    for (const group of candidates) {
      const other = new Set(allColumns.filter((c) => !group.has(c)))
      if (group.size === 0 || other.size === 0) continue
      if (isEmptyEverywhere(target, group) || isEmptyEverywhere(target, other)) continue

      const towerA = restrictToColumns(target, group)
      const towerB = restrictToColumns(target, other)
      if (!isStable(towerA) || !isStable(towerB)) continue

      const nodeA = this.solve(towerA)
      if (!nodeA) continue
      const nodeB = this.solve(towerB)
      if (!nodeB) continue

      for (const [bottom, top] of [
        [nodeB, nodeA],
        [nodeA, nodeB],
      ]) {
        const stacked = this.builder.op('stack', [bottom, top])
        if (stacked.code === code) return stacked
      }
    }
    return null
  }
}

export interface SolveOptions {
  /** Restricts the plan to buildings the player has. Defaults to everything. */
  unlocks?: Unlocks
  /** Used to name the milestone or upgrade that would unlock a missing building. */
  scenario?: ScenarioKey
}

/** Lists the buildings a plan needs that the player hasn't unlocked yet. */
function missingBuildings(root: BuildNode, unlocks: Unlocks, scenario: ScenarioKey): string[] {
  const missing = new Set<string>()

  walk(root, (node) => {
    if (node.op === null) return
    if (!unlocks.operations.has(node.op)) {
      const building = OPERATION_BUILDINGS[node.op]
      missing.add(unlockHint(scenario, building.variant, building.nameKo))
    }
    if (node.op === 'paint' && node.color && !unlocks.colors.has(node.color)) {
      const paint = OPERATION_BUILDINGS.paint
      const needsMixer = !['r', 'g', 'b'].includes(node.color)
      missing.add(
        needsMixer
          ? unlockHint(scenario, MIXER_VARIANT, `${MIXER_NAME_KO} (${colorNameKo(node.color)} 제조)`)
          : unlockHint(scenario, paint.variant, paint.nameKo),
      )
    }
  })

  return [...missing]
}

export function solveShape(
  target: Shape,
  opConfig: OperationConfig,
  options: SolveOptions = {},
): SolveResult {
  const config = opConfig.shapesConfig
  const unlocks = options.unlocks ?? allUnlocks()
  const scenario = options.scenario ?? 'default'

  if (target.layers.every((layer) => layer.every((p) => p.type === null))) {
    return { ok: false, error: '빈 도형은 만들 수 없습니다' }
  }

  if (target.layers.length > opConfig.maxShapeLayers) {
    return {
      ok: false,
      error: `레이어가 ${target.layers.length}개입니다. 현재 시나리오 최대치는 ${opConfig.maxShapeLayers}개입니다`,
      hint: 'Insane 시나리오를 선택하면 5레이어까지 허용됩니다.',
    }
  }

  if (!isStable(target)) {
    const settled = cleanUpEmptyUpperLayers(makeLayersFall(copyShape(target).layers))
    return {
      ok: false,
      error: '중력 규칙상 존재할 수 없는 도형입니다 (떠 있는 조각이 있습니다)',
      hint: `게임에서는 ${toShapeCode({ layers: settled })} 로 무너집니다.`,
    }
  }

  // Carving strategies trade mining waste against cutter count, and which wins
  // depends on the shape — so build both plans and keep the cheaper one.
  const solveWith = (available: Unlocks): BuildNode | null => {
    let best: BuildNode | null = null
    let bestCost = Infinity
    for (const carve of ['discard', 'keepBoth'] as const) {
      const candidate = new Solver(new Builder(opConfig, carve, available), config).solve(target)
      if (!candidate) continue
      const cost = planCost(candidate)
      if (cost < bestCost) {
        best = candidate
        bestCost = cost
      }
    }
    return best
  }

  const root = solveWith(unlocks)

  if (!root) {
    // Distinguish "you can't build this yet" from "we can't work it out at all".
    // Only worth re-solving when the player is actually limited.
    const everything = allUnlocks()
    const restricted = everything.operations.size !== unlocks.operations.size
    const unrestricted = restricted ? solveWith(everything) : null
    if (unrestricted) {
      const missing = missingBuildings(unrestricted, unlocks, scenario)
      return {
        ok: false,
        error: '지금 해금된 건물로는 만들 수 없는 도형입니다',
        hint:
          missing.length > 0
            ? `필요: ${missing.join(', ')}`
            : '진행도를 올리거나 진행도 제한을 끄고 다시 시도해 보세요.',
      }
    }

    const hasMidPin = target.layers.some((layer, index) => index > 0 && layer.some(isPin))
    const bottomPinMismatch =
      target.layers[0].some(isPin) &&
      (target.layers.length < 2 || !isPinFootprintOf(target.layers[0], target.layers[1]))

    let hint = '색상·레이어를 단순화한 도형으로 먼저 시도해 보세요.'
    if (hasMidPin || bottomPinMismatch) {
      hint = '핀이 맨 아래 레이어 전체 패턴으로 놓인 경우만 자동 역설계를 지원합니다.'
    } else if (crystalColors(target).length > 1) {
      hint = '서로 다른 색 결정체가 섞인 도형은 단계별 결정체 생성이 필요해 자동 해법을 못 찾을 수 있습니다.'
    }

    return { ok: false, error: '이 도형의 가공 순서를 자동으로 찾지 못했습니다', hint }
  }

  const notes: string[] = []
  const usedTypes = new Set<string>()
  walk(root, (node) => {
    if (node.op === null && node.sourcePart) usedTypes.add(node.sourcePart)
  })
  const rare = [...usedTypes].filter((t) => t === 'S' || t === 'W' || t === 'F' || t === 'G')
  if (rare.length > 0) {
    notes.push(`희귀 자원 사용: ${rare.join(', ')} — 채굴 가능한 지역이 제한적입니다.`)
  }

  return { ok: true, root, notes }
}

export { configFor }
