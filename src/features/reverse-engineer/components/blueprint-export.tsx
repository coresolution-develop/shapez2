'use client'

import { CheckIcon, CopyIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { generateLineBlueprint } from '@/lib/shapez/layout'
import type { LayoutResult } from '@/lib/shapez/layout'
import { OPERATIONS } from '@/lib/shapez/operations'
import type { BuildNode } from '@/lib/shapez/plan'

interface BlueprintExportProps {
  root: BuildNode
  /** Used as the blueprint's icon so it's recognisable in the game's list. */
  shapeCode: string
}

/**
 * Emits a real, pasteable blueprint for plans that are a straight line of
 * machines. Anything else is refused with the reason — the port geometry for
 * merges and for several machines hasn't been measured, and a blueprint whose
 * belts don't connect is worse than none.
 */
export function BlueprintExport({ root, shapeCode }: BlueprintExportProps) {
  const [result, setResult] = useState<LayoutResult | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    generateLineBlueprint(root, shapeCode, { leadIn: 1, leadOut: 1 })
      .then((value) => {
        if (!cancelled) setResult(value)
      })
      .catch(() => {
        if (!cancelled) setResult({ ok: false, reason: '청사진을 만들지 못했습니다' })
      })
    return () => {
      cancelled = true
    }
  }, [root, shapeCode])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  if (result === null) return null

  if (!result.ok) {
    return (
      <section className="space-y-1.5 rounded-lg border bg-muted/40 p-4">
        <h3 className="text-sm font-medium">청사진 생성</h3>
        <p className="text-sm text-muted-foreground">{result.reason}</p>
        <p className="text-xs text-muted-foreground">
          지금은 한 도형이 기계를 일렬로 통과하는 계획만 만들 수 있습니다. 회전기·색칠기·결정체 생성기, 그리고
          마지막 단계의 절단까지 지원합니다.
        </p>
      </section>
    )
  }

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          청사진 생성
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {result.placements.length}개 건물 · {result.size.width}칸
          </span>
        </h3>
        <Button
          size="sm"
          onClick={() => {
            void navigator.clipboard
              .writeText(result.code)
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }}
        >
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
          {copied ? '복사됨' : '청사진 복사'}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        복사한 뒤 게임에서 <kbd className="rounded border px-1">Ctrl</kbd>+
        <kbd className="rounded border px-1">V</kbd> 로 붙여넣으세요.
      </p>

      <ol className="flex flex-wrap items-center gap-1.5 text-xs">
        {result.placements.map((placement, index) => (
          <li key={index}>
            <Badge variant={placement.type.startsWith('Belt') ? 'outline' : 'secondary'}>
              {placement.type.startsWith('Belt')
                ? '벨트'
                : (OPERATIONS[
                    result.steps.find((step) => step.x === placement.x)?.op ?? 'paint'
                  ].labelKo ?? placement.type)}
            </Badge>
          </li>
        ))}
      </ol>

      {result.notes.map((note) => (
        <p key={note} className="text-xs text-muted-foreground">
          · {note}
        </p>
      ))}
    </section>
  )
}
