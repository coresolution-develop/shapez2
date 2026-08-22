/** The shared vocabulary for a build plan: a DAG of operations. */
import type { OperationId } from './operations'
import type { ColorCode, Shape } from './types'

export interface BuildNode {
  id: string
  /** `null` for an extractor input. */
  op: OperationId | null
  color?: ColorCode
  inputs: BuildNode[]
  /** Which output of a 2-output op (cut/swap) this node takes. */
  outputIndex: number
  shape: Shape
  code: string
  /** Set for extractor nodes. */
  sourcePart?: string
}

export function walk(
  node: BuildNode,
  visit: (node: BuildNode) => void,
  seen = new Set<string>(),
): void {
  if (seen.has(node.id)) return
  seen.add(node.id)
  visit(node)
  for (const input of node.inputs) walk(input, visit, seen)
}

/** Flattens the plan into build order: every node appears after its inputs. */
export function orderedSteps(root: BuildNode): BuildNode[] {
  const seen = new Set<string>()
  const steps: BuildNode[] = []

  const visit = (node: BuildNode) => {
    if (seen.has(node.id)) return
    seen.add(node.id)
    for (const input of node.inputs) visit(input)
    steps.push(node)
  }

  visit(root)
  return steps
}

export interface PlanStats {
  buildings: Record<string, number>
  totalBuildings: number
  extractors: Record<string, number>
  depth: number
}

export function planStats(root: BuildNode): PlanStats {
  const buildings: Record<string, number> = {}
  const extractors: Record<string, number> = {}

  walk(root, (node) => {
    if (node.op === null) {
      extractors[node.sourcePart!] = (extractors[node.sourcePart!] ?? 0) + 1
    } else {
      buildings[node.op] = (buildings[node.op] ?? 0) + 1
    }
  })

  const depthCache = new Map<string, number>()
  const depthOf = (node: BuildNode): number => {
    const cached = depthCache.get(node.id)
    if (cached !== undefined) return cached
    const value = node.inputs.length === 0 ? 1 : 1 + Math.max(...node.inputs.map(depthOf))
    depthCache.set(node.id, value)
    return value
  }

  return {
    buildings,
    totalBuildings: Object.values(buildings).reduce((a, b) => a + b, 0),
    extractors,
    depth: depthOf(root),
  }
}
