'use client'

import { CheckIcon, CopyIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { ShapeView } from '@/components/shape-view'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { generateAssembly } from '@/lib/shapez/layout'
import type { PlanAssembly, PlanSegment } from '@/lib/shapez/layout'
import { OPERATIONS } from '@/lib/shapez/operations'
import type { BuildNode } from '@/lib/shapez/plan'
import { parseShapeCode } from '@/lib/shapez/shapeCode'
import type { ColorSkinId } from '@/lib/shapez/types'

interface BlueprintExportProps {
  root: BuildNode
  /** Used as the blueprint's icon so it's recognisable in the game's list. */
  shapeCode: string
  skin: ColorSkinId
}

/**
 * Emits real, pasteable blueprints for a plan.
 *
 * A plan for anything interesting is not one straight line — it forks, and the
 * forks meet at a 결합기 or 교환기. Those two machines are the one thing still
 * unmeasured (`portData.ts`), so instead of refusing the whole plan we emit a
 * blueprint per straight run and say which runs feed which machine. The player
 * places two or three of those machines by hand; everything else is pasted.
 */
export function BlueprintExport({ root, shapeCode, skin }: BlueprintExportProps) {
  const [assembly, setAssembly] = useState<PlanAssembly | null>(null)

  useEffect(() => {
    let cancelled = false
    generateAssembly(root, shapeCode, { leadIn: 1, leadOut: 1 })
      .then((value) => {
        if (!cancelled) setAssembly(value)
      })
      .catch(() => {
        if (!cancelled) setAssembly(null)
      })
    return () => {
      cancelled = true
    }
  }, [root, shapeCode])

  if (assembly === null) return null

  const buildable = assembly.segments.filter((segment) => segment.layout.ok)
  const order = new Map(assembly.segments.map((segment, index) => [segment.id, index + 1]))
  // a junction can be fed by another junction's output, not just by a line
  const junctionOrder = new Map(assembly.junctions.map((junction, index) => [junction.id, index + 1]))
  const nameOf = (id: string) =>
    order.has(id)
      ? `${order.get(id)}번 줄`
      : junctionOrder.has(id)
        ? `${junctionOrder.get(id)}번 합치기의 결과`
        : '?'

  if (buildable.length === 0) {
    const reason = assembly.segments.find((segment) => !segment.layout.ok)?.layout
    return (
      <section className="space-y-1.5 rounded-lg border bg-muted/40 p-4">
        <h3 className="text-sm font-medium">청사진 생성</h3>
        <p className="text-sm text-muted-foreground">
          {reason && !reason.ok ? reason.reason : '이 계획으로는 청사진을 만들지 못했습니다'}
        </p>
        <p className="text-xs text-muted-foreground">
          포트를 아직 측정하지 못한 기계가 있습니다 — 절반 파괴기·핀 누름기·교환기·굽은 결합기·반시계
          회전기·180° 회전기. 청사진 뷰어의 「건물 포트 분석」으로 재서 보내주시면 바로 넣겠습니다.
        </p>
      </section>
    )
  }

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">
          청사진 생성
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {assembly.singleLine
              ? `${buildable[0].layout.ok ? buildable[0].layout.placements.length : 0}개 건물 · 1줄`
              : `${buildable.length}줄`}
          </span>
        </h3>
        <p className="text-xs text-muted-foreground">
          복사한 뒤 게임에서 <kbd className="rounded border px-1">Ctrl</kbd>+
          <kbd className="rounded border px-1">V</kbd> 로 붙여넣으세요.
          {assembly.singleLine ? '' : ' 줄마다 따로 붙여넣고, 아래 「연결」대로 이어 주세요.'}
        </p>
      </div>

      <ol className="space-y-3">
        {assembly.segments.map((segment) => (
          <li key={segment.id}>
            <SegmentCard
              segment={segment}
              index={order.get(segment.id) ?? 1}
              startsAfter={
                segment.startsAt.kind === 'junction' ? nameOf(segment.startsAt.id) : ''
              }
              endsAt={
                segment.endsAt.kind === 'junction'
                  ? `${junctionOrder.get(segment.endsAt.id) ?? '?'}번 합치기`
                  : '완성'
              }
              skin={skin}
              single={assembly.singleLine}
            />
          </li>
        ))}
      </ol>

      {assembly.junctions.length > 0 ? (
        <div className="space-y-1.5 rounded-md border bg-muted/40 p-3">
          <p className="text-sm font-medium">연결 — 직접 놓아야 하는 기계</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {assembly.junctions.map((junction, index) => (
              <li key={junction.id} className="flex flex-wrap items-center gap-1.5">
                <span className="tabular-nums">{index + 1}.</span>
                <Badge variant="secondary">{OPERATIONS[junction.op].labelKo}</Badge>
                {junction.feeds.map((feed, position) => (
                  <span key={feed}>
                    {position > 0 ? '+ ' : ''}
                    {/* stacking is order-sensitive: inputs[0] ends up underneath */}
                    {junction.op === 'stack' ? (position === 0 ? '아래 ' : '위 ') : ''}
                    <span className="text-foreground">{nameOf(feed)}</span>
                  </span>
                ))}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            결합기는 <strong className="font-medium text-foreground">넣는 순서가 중요합니다</strong> —
            「아래」로 표시된 줄이 밑에 깔립니다.
          </p>
          <p className="text-xs text-muted-foreground">
            이 기계들의 입출력 위치를 아직 측정하지 못해서 청사진에 넣지 않았습니다. 잘못 배치된
            청사진을 주는 것보다 낫다고 봤습니다.
          </p>
        </div>
      ) : null}
    </section>
  )
}

function SegmentCard({
  segment,
  index,
  startsAfter,
  endsAt,
  skin,
  single,
}: {
  segment: PlanSegment
  index: number
  /** Label for the junction this line's shape comes out of, if any. */
  startsAfter: string
  /** Label for where the line's output goes. */
  endsAt: string
  skin: ColorSkinId
  single: boolean
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  const result = segment.chain[segment.chain.length - 1]
  const parsed = parseShapeCode(result.code)
  const from =
    segment.startsAt.kind === 'extractor'
      ? `채굴 — ${segment.startsAt.part}`
      : startsAfter
  const to = segment.endsAt.kind === 'output' ? '완성' : endsAt

  return (
    <div className="space-y-2 rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {single ? null : (
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums">
              {index}번 줄
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {from} → {to}
          </span>
          {parsed.ok ? (
            <ShapeView shape={parsed.shape} size={24} skin={skin} title={result.code} />
          ) : null}
        </div>

        {segment.layout.ok ? (
          <Button
            size="sm"
            onClick={() => {
              void navigator.clipboard
                .writeText(segment.layout.ok ? segment.layout.code : '')
                .then(() => setCopied(true))
                .catch(() => setCopied(false))
            }}
          >
            {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
            {copied ? '복사됨' : '청사진 복사'}
          </Button>
        ) : null}
      </div>

      {segment.layout.ok ? (
        <>
          <ol className="flex flex-wrap items-center gap-1.5 text-xs">
            {segment.layout.placements.map((placement, position) => (
              <li key={position}>
                <Badge variant={placement.type.startsWith('Belt') ? 'outline' : 'secondary'}>
                  {placement.type.startsWith('Belt')
                    ? '벨트'
                    : (OPERATIONS[
                        segment.layout.ok
                          ? (segment.layout.steps.find((step) => step.x === placement.x)?.op ??
                            'paint')
                          : 'paint'
                      ].labelKo ?? placement.type)}
                </Badge>
              </li>
            ))}
          </ol>
          {segment.layout.notes.map((note) => (
            <p key={note} className="text-xs text-muted-foreground">
              · {note}
            </p>
          ))}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{segment.layout.reason}</p>
      )}
    </div>
  )
}
