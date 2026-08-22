'use client'

import { CheckIcon, CopyIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MODULE_LANES, generateLaneModule, moduleSizing } from '@/lib/shapez/module'
import { OPERATIONS } from '@/lib/shapez/operations'
import type { OperationId } from '@/lib/shapez/operations'
import { walk } from '@/lib/shapez/plan'
import type { BuildNode } from '@/lib/shapez/plan'
import { OPERATION_SPECS, beltThroughput, ratedThroughput } from '@/lib/shapez/throughput'
import type { SpeedTier } from '@/lib/shapez/throughput'

interface LaneModulesProps {
  root: BuildNode
  tier: SpeedTier
}

interface Entry {
  op: OperationId
  perLane: number
  machines: number
  code: string | null
  reason: string | null
  warnings: string[]
}

/** Every operation the plan performs, once each, deepest first. */
function operationsIn(root: BuildNode): OperationId[] {
  const seen = new Set<OperationId>()
  walk(root, (node) => {
    if (node.op !== null) seen.add(node.op)
  })
  return [...seen]
}

/**
 * A module per operation the plan uses, in the format the game's platforms
 * expect: twelve belts in one edge and twelve out the other.
 *
 * This is a different thing from the module above it. That one is the whole
 * plan on one platform with a single machine per step; these are the modules a
 * factory is actually built from — one operation, enough machines to keep a
 * belt full, pasted as many times as the throughput asks for.
 */
export function LaneModules({ root, tier }: LaneModulesProps) {
  const ops = useMemo(() => operationsIn(root), [root])
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [copied, setCopied] = useState<OperationId | null>(null)

  useEffect(() => {
    let cancelled = false

    Promise.all(
      ops.map(async (op): Promise<Entry> => {
        const sizing = moduleSizing(
          op,
          beltThroughput(tier),
          ratedThroughput(OPERATION_SPECS[op], tier),
        )
        try {
          const { layout, code } = await generateLaneModule(op, sizing.perLane)
          return {
            op,
            perLane: sizing.perLane,
            machines: sizing.machines,
            code,
            reason: layout.ok ? null : layout.reason,
            warnings: layout.ok ? layout.warnings : [],
          }
        } catch {
          return {
            op,
            perLane: sizing.perLane,
            machines: sizing.machines,
            code: null,
            reason: '청사진을 만들지 못했습니다',
            warnings: [],
          }
        }
      }),
    ).then((result) => {
      if (!cancelled) setEntries(result)
    })

    return () => {
      cancelled = true
    }
  }, [ops, tier])

  useEffect(() => {
    if (copied === null) return
    const timer = window.setTimeout(() => setCopied(null), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  if (entries === null) return null

  return (
    <div className="space-y-2">
      <div className="space-y-0.5">
        <h3 className="text-sm font-medium">작업 모듈 (벨트 {MODULE_LANES}줄)</h3>
        <p className="text-xs text-muted-foreground">
          작업 하나를 플랫폼 한 칸에 담은 모듈입니다. 위 가장자리로 {MODULE_LANES}줄이 들어와
          아래로 나가고, 레인이 가득 찬 채 나갈 만큼 기계가 들어 있습니다.{' '}
          <strong className="font-medium text-foreground">플랫폼까지 같이 나오니</strong> 빈 땅에
          그대로 붙여넣으면 됩니다.
        </p>
      </div>

      <ul className="space-y-1.5">
        {entries.map((entry) => (
          <li
            key={entry.op}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-muted/30 px-3 py-2"
          >
            <span className="text-sm font-medium">{OPERATIONS[entry.op].labelKo}</span>

            {entry.code ? (
              <>
                <Badge variant="secondary" className="tabular-nums">
                  {entry.machines}대
                </Badge>
                <span className="text-xs text-muted-foreground tabular-nums">
                  레인당 {entry.perLane}대
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(entry.code!)
                      .then(() => setCopied(entry.op))
                      .catch(() => setCopied(null))
                  }}
                >
                  {copied === entry.op ? (
                    <CheckIcon className="size-3.5" />
                  ) : (
                    <CopyIcon className="size-3.5" />
                  )}
                  {copied === entry.op ? '복사됨' : '모듈 복사'}
                </Button>
              </>
            ) : (
              <span className="basis-full text-xs text-muted-foreground sm:basis-auto">
                {entry.reason}
              </span>
            )}

            {entry.warnings.map((warning) => (
              <span key={warning} className="basis-full text-xs text-muted-foreground">
                · {warning}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </div>
  )
}
