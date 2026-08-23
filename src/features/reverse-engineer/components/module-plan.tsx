import { ArrowDownIcon } from 'lucide-react'

import { ShapeView } from '@/components/shape-view'
import { Badge } from '@/components/ui/badge'
import { EDGE_NAMES_KO, MODULE_WIRING, moduleCapacity, modulesNeeded } from '@/lib/shapez/moduleEdges'
import { OPERATIONS } from '@/lib/shapez/operations'
import { orderedSteps } from '@/lib/shapez/plan'
import type { BuildNode } from '@/lib/shapez/plan'
import { PART_NAMES_KO } from '@/lib/shapez/namesKo'
import type { NodeLoad, SpeedTier } from '@/lib/shapez/throughput'
import type { ColorSkinId } from '@/lib/shapez/types'

interface ModulePlanProps {
  root: BuildNode
  skin: ColorSkinId
  tier: SpeedTier
  loads: Map<string, NodeLoad>
}

/**
 * The plan again, but as modules to lay down rather than machines to count.
 *
 * The throughput panel says how many rotators a shape wants; it does not say
 * that they come as one module, nor which edge of it the shapes leave by, nor
 * what to point that edge at. Everything needed to answer that is already known
 * — the module for each operation, the edge each of its belts meets the world
 * on, and how much one gets through — so this puts it in one place, in the
 * order a factory gets built in.
 */
export function ModulePlan({ root, skin, tier, loads }: ModulePlanProps) {
  const steps = orderedSteps(root).filter((node) => node.op !== null)
  if (steps.length === 0) return null

  const numbers = new Map(steps.map((node, index) => [node.id, index + 1]))
  const capacity = moduleCapacity(tier)
  const total = steps.reduce(
    (sum, node) => sum + modulesNeeded(loads.get(node.id)?.opRate ?? 0, tier),
    0,
  )

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">
          모듈 배치도
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            플랫폼 {total}장
          </span>
        </h3>
        <p className="text-xs text-muted-foreground">
          번호 순서대로 지으면 됩니다. 모듈 한 장이 분당 {capacity.toLocaleString()}개까지 처리하니
          대부분은 한 장으로 충분합니다.
        </p>
      </div>

      <ol className="space-y-2">
        {steps.map((node, index) => {
          const op = node.op!
          const wiring = MODULE_WIRING[op]
          const load = loads.get(node.id)
          const count = modulesNeeded(load?.opRate ?? 0, tier)
          const feeds = node.inputs.map((input) =>
            input.op === null
              ? `${PART_NAMES_KO[input.sourcePart ?? ''] ?? input.sourcePart} 채굴`
              : `${numbers.get(input.id)}번`,
          )

          return (
            <li key={node.id} className="rounded-md border bg-muted/30 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-6 shrink-0 text-sm font-semibold text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                <span className="text-sm font-medium">{OPERATIONS[op].labelKo} 모듈</span>
                {count > 1 ? (
                  <Badge variant="secondary" className="tabular-nums">
                    ×{count}
                  </Badge>
                ) : null}
                <ShapeView shape={node.shape} size={28} skin={skin} title={node.code} />
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {Math.round(load?.opRate ?? 0)}/분
                </span>
              </div>

              <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                {wiring.inputs.map((port, at) => (
                  <li key={port.edge}>
                    <strong className="font-medium text-foreground">
                      {EDGE_NAMES_KO[port.edge]} 가장자리
                    </strong>
                    로 {port.carries} — {feeds[at] ?? feeds[0]}에서
                  </li>
                ))}
                {wiring.outputs.map((port) => (
                  <li key={port.edge}>
                    <strong className="font-medium text-foreground">
                      {EDGE_NAMES_KO[port.edge]} 가장자리
                    </strong>
                    로 {port.carries}
                  </li>
                ))}
              </ul>
            </li>
          )
        })}
      </ol>

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ArrowDownIcon className="size-3.5 shrink-0" />
        마지막 모듈의 아래쪽 가장자리에서 완성된 도형이 나옵니다.
      </div>
    </section>
  )
}
