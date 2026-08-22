/**
 * Turns a build plan into an actual, pasteable blueprint.
 *
 * Scope is deliberately narrow: a single straight production line, left to
 * right, one machine per step with a belt between each. That covers chains of
 * one-in-one-out machines, which is where the confirmed port data is solid.
 * Anything needing a machine whose geometry hasn't been measured, or a step
 * that merges two shapes, is refused rather than guessed at — a blueprint that
 * doesn't connect is worse than no blueprint.
 */
import { encodeBuildingBlueprint, type BuildingPlacement } from './blueprint'
import type { OperationId } from './operations'
import type { BuildNode } from './plan'
import { isRoutable } from './portData'
import type { ColorCode } from './types'

/** Internal variant ids for the buildings we can place. */
export const BUILDING_IDS = {
  belt: 'BeltDefaultForwardInternalVariant',
  extractor: 'ExtractorDefaultInternalVariant',
} as const

/** Which building performs each operation, where we know it. */
const OPERATION_BUILDING: Partial<Record<OperationId, string>> = {
  cut: 'CutterDefaultInternalVariant',
  r90cw: 'RotatorOneQuadInternalVariant',
  paint: 'PainterDefaultInternalVariant',
  crystal: 'CrystalGeneratorDefaultInternalVariant',
}

export interface LayoutOptions {
  /**
   * Extractors only go on a resource patch, so including one makes the whole
   * blueprint unplaceable on open ground. Off by default — the player puts the
   * miner down themselves and feeds the line.
   */
  includeExtractor?: boolean
  /** Spare belts before the first machine and after the last, to hook into. */
  leadIn?: number
  leadOut?: number
}

export interface LayoutStep {
  op: OperationId
  building: string
  color?: ColorCode
  /** Where the machine sits along the line. */
  x: number
}

export interface LayoutSuccess {
  ok: true
  code: string
  steps: LayoutStep[]
  placements: BuildingPlacement[]
  /** Tiles wide × tall the finished line occupies. */
  size: { width: number; height: number }
  notes: string[]
}

export interface LayoutFailure {
  ok: false
  reason: string
  /** The operation that stopped us, when there is one. */
  blockedBy?: OperationId
}

export type LayoutResult = LayoutSuccess | LayoutFailure

/**
 * Reduces a plan to a straight chain, if it is one.
 *
 * Returns the nodes in build order when every step has exactly one input, i.e.
 * a single shape flowing through a series of machines.
 */
export function asLinearChain(root: BuildNode): BuildNode[] | null {
  const chain: BuildNode[] = []
  let node: BuildNode | null = root

  while (node) {
    chain.unshift(node)
    if (node.op === null) return chain // reached the extractor
    if (node.inputs.length !== 1) return null // a merge — not a straight line
    node = node.inputs[0]
  }

  return null
}

/**
 * Lays a chain out west to east. Every confirmed machine takes its input on
 * local -X and delivers on +X, so a row at rotation 0 with a belt in each gap
 * wires itself up.
 */
export function generateLineLayout(root: BuildNode, options: LayoutOptions = {}): LayoutResult {
  const chain = asLinearChain(root)
  if (!chain) {
    return {
      ok: false,
      reason: '두 도형을 합치는 단계(적층·교환)가 있어서 직선 라인으로 배치할 수 없습니다',
    }
  }
  return layoutChain(chain, options)
}

/**
 * Lays out an already-linear run of nodes.
 *
 * Split out from `generateLineLayout` so a segment of a branching plan — a run
 * between two merges — can be laid out on its own.
 */
export function layoutChain(chain: BuildNode[], options: LayoutOptions = {}): LayoutResult {
  const { includeExtractor = false, leadIn = 1, leadOut = 1 } = options

  for (const node of chain) {
    if (node.op === null) continue
    const building = OPERATION_BUILDING[node.op]
    if (!building) {
      return { ok: false, reason: `${node.op} 연산을 수행하는 건물의 포트를 아직 모릅니다`, blockedBy: node.op }
    }
    if (!isRoutable(building)) {
      return {
        ok: false,
        reason: `${building}의 입출력 위치가 아직 완전히 확인되지 않았습니다`,
        blockedBy: node.op,
      }
    }
    if (node.op === 'cut' && node !== chain[chain.length - 1]) {
      // a cutter makes two halves; only the last step may throw one away
      return {
        ok: false,
        reason: '절단은 출력이 2개라 라인 중간에는 배치할 수 없습니다 (마지막 단계만 가능)',
        blockedBy: node.op,
      }
    }
  }

  const machines = chain.filter((node) => node.op !== null)
  if (machines.length === 0) {
    return { ok: false, reason: '가공 단계가 없는 계획이라 만들 배치가 없습니다' }
  }

  const placements: BuildingPlacement[] = []
  const steps: LayoutStep[] = []
  const notes: string[] = []
  let x = 0

  if (includeExtractor && chain[0].op === null) {
    placements.push({ type: BUILDING_IDS.extractor, x, y: 0 })
    x += 1
    placements.push({ type: BUILDING_IDS.belt, x, y: 0 })
    x += 1
    notes.push('맨 앞 추출기는 자원 패치 위에만 놓입니다. 이 청사진은 평지에 붙여넣을 수 없습니다.')
  } else {
    for (let i = 0; i < leadIn; i++) {
      placements.push({ type: BUILDING_IDS.belt, x, y: 0 })
      x += 1
    }
  }

  for (const [index, node] of machines.entries()) {
    const building = OPERATION_BUILDING[node.op!]!
    placements.push({ type: building, x, y: 0 })
    steps.push({ op: node.op!, building, color: node.color, x })
    x += 1

    const isLast = index === machines.length - 1
    const gaps = isLast ? leadOut : 1
    for (let i = 0; i < gaps; i++) {
      placements.push({ type: BUILDING_IDS.belt, x, y: 0 })
      x += 1
    }
  }

  if (!includeExtractor) {
    notes.push('추출기는 포함하지 않았습니다. 자원 패치 위에 따로 놓고 맨 앞 벨트에 연결하세요.')
  }
  if (machines.some((node) => node.op === 'paint' || node.op === 'crystal')) {
    notes.push('색칠기·결정체 생성기는 파이프로 물감을 따로 연결해야 합니다. 배관은 포함되지 않습니다.')
  }

  return {
    ok: true,
    code: '',
    steps,
    placements,
    size: { width: x, height: 2 },
    notes,
  }
}

/** A machine that takes two shapes, so it sits between two lines. */
export interface PlanJunction {
  id: string
  op: OperationId
  /** Ids feeding it — each is either a segment or another junction. */
  feeds: string[]
  /** How many merges sit between this and the finished shape. */
  depth: number
}

export interface PlanSegment {
  id: string
  /** In build order; the last node is what comes off the end of the line. */
  chain: BuildNode[]
  /** Where this line's shape starts: an extractor, or a junction's output. */
  startsAt: { kind: 'extractor'; part: string } | { kind: 'junction'; id: string }
  /** What consumes it: the finished shape, or a junction. */
  endsAt: { kind: 'output' } | { kind: 'junction'; id: string; inputIndex: number }
  /** How many merges sit between this line and the finished shape. */
  depth: number
  layout: LayoutResult
}

export interface PlanAssembly {
  segments: PlanSegment[]
  junctions: PlanJunction[]
  /** True when the whole plan came out as one line and needs no assembly. */
  singleLine: boolean
}

/**
 * Cuts a plan into straight lines joined by two-input machines.
 *
 * Most real shapes need stacking, so the whole plan is rarely one line — but
 * the runs *between* the merges are, and each of those is a blueprint we can
 * emit today. The merges are reported as junctions for the player to place by
 * hand, which is honest about the one thing still missing (see `portData.ts`:
 * the stacker's second input has never been observed).
 */
export function planAssembly(root: BuildNode, options: LayoutOptions = {}): PlanAssembly {
  const isMerge = (node: BuildNode) => node.op !== null && node.inputs.length > 1

  const segments: PlanSegment[] = []
  const junctions: PlanJunction[] = []
  const visited = new Set<string>()

  /** `depth` counts merges between here and the finished shape. */
  const resolveJunction = (node: BuildNode, depth: number): void => {
    if (junctions.some((entry) => entry.id === node.id)) return
    junctions.push({
      id: node.id,
      op: node.op!,
      feeds: node.inputs.map((input) => input.id),
      depth,
    })
    node.inputs.forEach((input, inputIndex) => {
      resolve(input, { kind: 'junction', id: node.id, inputIndex }, depth + 1)
    })
  }

  /** Files whatever produces `endsAt`'s shape as a line, recursing upstream. */
  const resolve = (node: BuildNode, endsAt: PlanSegment['endsAt'], depth: number): void => {
    if (isMerge(node)) return resolveJunction(node, depth)
    if (visited.has(node.id)) return
    visited.add(node.id)

    // walk back while each step still takes exactly one shape
    const chain: BuildNode[] = []
    let head: BuildNode = node
    while (true) {
      chain.unshift(head)
      if (head.op === null) break
      const [next] = head.inputs
      if (!next || isMerge(next)) break
      head = next
    }

    const upstream = head.op === null ? null : head.inputs[0]
    const machines = chain.filter((entry) => entry.op !== null)

    segments.push({
      id: node.id,
      chain,
      startsAt:
        upstream && isMerge(upstream)
          ? { kind: 'junction', id: upstream.id }
          : { kind: 'extractor', part: chain[0].sourcePart ?? '' },
      endsAt,
      depth,
      layout:
        machines.length === 0
          ? { ok: false, reason: '이 갈래는 채굴한 도형을 그대로 씁니다 — 벨트만 연결하세요' }
          : layoutChain(chain, options),
    })

    if (upstream && isMerge(upstream)) resolveJunction(upstream, depth)
  }

  resolve(root, { kind: 'output' }, 0)

  // deepest first, so line 1 and junction 1 are what you build first
  segments.sort((a, b) => b.depth - a.depth)
  junctions.sort((a, b) => b.depth - a.depth)

  return { segments, junctions, singleLine: junctions.length === 0 }
}

/** Splits the plan into lines and encodes a blueprint for each one it can. */
export async function generateAssembly(
  root: BuildNode,
  icon?: string,
  options: LayoutOptions = {},
): Promise<PlanAssembly> {
  const assembly = planAssembly(root, options)

  const segments = await Promise.all(
    assembly.segments.map(async (segment) => {
      if (!segment.layout.ok) return segment
      const code = await encodeBuildingBlueprint(
        segment.layout.placements,
        icon ? [`shape:${icon}`, null, null, null] : [null, null, null, null],
      )
      return { ...segment, layout: { ...segment.layout, code } }
    }),
  )

  return { ...assembly, segments }
}

/** Lays the chain out and encodes it as a blueprint string. */
export async function generateLineBlueprint(
  root: BuildNode,
  icon?: string,
  options: LayoutOptions = {},
): Promise<LayoutResult> {
  const layout = generateLineLayout(root, options)
  if (!layout.ok) return layout

  const code = await encodeBuildingBlueprint(
    layout.placements,
    icon ? [`shape:${icon}`, null, null, null] : [null, null, null, null],
  )
  return { ...layout, code }
}
