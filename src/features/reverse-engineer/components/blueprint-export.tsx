'use client'

import { CheckIcon, CopyIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { buildingNameKo, PART_NAMES_KO } from '@/lib/shapez/namesKo'
import { generateModule } from '@/lib/shapez/module'
import type { ModuleResult } from '@/lib/shapez/module'
import type { BuildNode } from '@/lib/shapez/plan'

interface BlueprintExportProps {
  root: BuildNode
  /** Used as the blueprint's icon so it's recognisable in the game's list. */
  shapeCode: string
}

/**
 * One pasteable module for the whole plan.
 *
 * The stacker spans two floors with its inputs one above the other, so a tree
 * of merges lays out as parallel straight lines on stacked floors and no belt
 * ever has to turn. What the module leaves out is what it cannot place: the
 * extractors, which only go on resource patches, and the paint pipes.
 */
export function BlueprintExport({ root, shapeCode }: BlueprintExportProps) {
  const [result, setResult] = useState<ModuleResult | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    generateModule(root, shapeCode)
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
        <h3 className="text-sm font-medium">모듈 청사진</h3>
        <p className="text-sm text-muted-foreground">{result.reason}</p>
        <p className="text-xs text-muted-foreground">
          아직 입출력 위치를 재지 못한 기계가 있습니다 — 절반 파괴기·핀 누름기·교환기·굽은 결합기·
          반시계 회전기·180° 회전기. 청사진 뷰어의 「건물 포트 분석」으로 재서 보내주시면 바로
          넣겠습니다.
        </p>
      </section>
    )
  }

  const counts = result.placements.reduce<Record<string, number>>((tally, placement) => {
    if (placement.type.startsWith('Belt')) return tally
    tally[placement.type] = (tally[placement.type] ?? 0) + 1
    return tally
  }, {})

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">
            모듈 청사진
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              건물 {result.placements.length}개 · 가로 {result.size.width}칸 · 기계 층{' '}
              {result.size.floors}개
            </span>
          </h3>
          <p className="text-xs text-muted-foreground">
            복사한 뒤 게임에서 <kbd className="rounded border px-1">Ctrl</kbd>+
            <kbd className="rounded border px-1">V</kbd> 로 한 번에 붙여넣으세요.
          </p>
        </div>

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

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">넣어야 하는 것</p>
        <ul className="flex flex-wrap gap-1.5">
          {result.inputs.map((input, index) => (
            <li key={index}>
              <Badge variant="outline">
                {input.at.z + 1}층 — {PART_NAMES_KO[input.part] ?? input.part}
              </Badge>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          층마다 맨 왼쪽 벨트가 입구입니다. 완성된 도형은 {result.output.z + 1}층 맨 오른쪽으로
          나옵니다.
        </p>
        <p className="text-xs text-muted-foreground">
          기계는 단계마다 1대씩입니다. 위 「필요 건물」만큼 <strong className="font-medium text-foreground">이 모듈을 여러 개</strong> 붙여넣어 처리량을 맞추세요.
        </p>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">쓰는 기계</p>
        <ul className="flex flex-wrap gap-1.5 text-xs">
          {Object.entries(counts).map(([type, count]) => (
            <li key={type}>
              <Badge variant="secondary">
                {buildingNameKo(type.replace(/InternalVariant$/, 'Variant'), type)}×{count}
              </Badge>
            </li>
          ))}
        </ul>
      </div>

      {result.notes.map((note) => (
        <p key={note} className="text-xs text-muted-foreground">
          · {note}
        </p>
      ))}
    </section>
  )
}
