import { ShapeView } from '@/components/shape-view'
import { Badge } from '@/components/ui/badge'
import { OPERATIONS } from '@/lib/shapez/operations'
import { orderedSteps, planStats } from '@/lib/shapez/plan'
import type { BuildNode } from '@/lib/shapez/plan'
import type { NodeLoad } from '@/lib/shapez/throughput'
import { COLOR_NAMES_KO, PART_NAMES_KO } from '@/lib/shapez/types'
import type { ColorSkinId } from '@/lib/shapez/types'

interface PlanStepsProps {
  root: BuildNode
  skin: ColorSkinId
  loads?: Map<string, NodeLoad>
}

export function PlanSteps({ root, skin, loads }: PlanStepsProps) {
  const steps = orderedSteps(root)
  const stats = planStats(root)
  const stepNumbers = new Map(steps.map((node, index) => [node.id, index + 1]))

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="설계상 가공 단계" value={`${stats.totalBuildings}단계`} />
        <Stat label="최장 가공 경로" value={`${stats.depth}단`} />
        <Stat
          label="필요 자원"
          value={Object.keys(stats.extractors)
            .map((part) => PART_NAMES_KO[part] ?? part)
            .join(', ')}
        />
        <Stat
          label="사용 건물"
          value={Object.entries(stats.buildings)
            .map(([op, count]) => `${OPERATIONS[op as keyof typeof OPERATIONS].labelKo}×${count}`)
            .join(', ')}
        />
      </dl>

      <ol className="space-y-2">
        {steps.map((node) => (
          <li
            key={node.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3"
          >
            <span className="w-7 shrink-0 text-sm font-semibold text-muted-foreground tabular-nums">
              {stepNumbers.get(node.id)}
            </span>

            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              {node.op === null ? (
                <Badge variant="secondary">
                  채굴 — {PART_NAMES_KO[node.sourcePart!] ?? node.sourcePart}
                </Badge>
              ) : (
                <>
                  <div className="flex items-center gap-1">
                    {node.inputs.map((input) => (
                      <span
                        key={input.id}
                        className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs tabular-nums"
                        title={input.code}
                      >
                        <ShapeView shape={input.shape} size={28} skin={skin} title={input.code} />#
                        {stepNumbers.get(input.id)}
                      </span>
                    ))}
                  </div>
                  <Badge>
                    {OPERATIONS[node.op].labelKo}
                    {node.color ? ` · ${COLOR_NAMES_KO[node.color]}` : ''}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {OPERATIONS[node.op].building}
                    {node.outputIndex === 1 ? ' (두 번째 출력)' : ''}
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              {loads?.get(node.id) ? (
                <span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-medium tabular-nums">
                  {loads.get(node.id)!.buildings}대
                  <span className="ml-1 font-normal text-muted-foreground">
                    · {formatRate(loads.get(node.id)!.opRate)}/분
                  </span>
                </span>
              ) : null}
              <code className="font-mono text-xs text-muted-foreground">{node.code}</code>
              <ShapeView shape={node.shape} size={44} skin={skin} title={node.code} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function formatRate(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium break-keep">{value || '—'}</dd>
    </div>
  )
}
