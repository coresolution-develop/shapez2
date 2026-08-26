'use client'

import { CheckIcon, CopyIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { generateFactoryModule } from '@/lib/shapez/factoryModule'
import type { FactoryModuleResult } from '@/lib/shapez/factoryModule'
import { factoryPlan } from '@/lib/shapez/factoryPlan'
import { PART_NAMES_KO } from '@/lib/shapez/namesKo'
import type { BuildNode } from '@/lib/shapez/plan'
import { tilesOf } from '@/lib/shapez/route'
import { generateShapeModule } from '@/lib/shapez/shapeModule'
import type { ShapeModuleResult } from '@/lib/shapez/shapeModule'
import { beltThroughput } from '@/lib/shapez/throughput'
import type { SpeedTier, StackerVariant } from '@/lib/shapez/throughput'

interface BlueprintExportProps {
  root: BuildNode
  /** Used as the blueprint's icon so it's recognisable in the game's list. */
  shapeCode: string
  tier: SpeedTier
  stackerVariant: StackerVariant
}

interface Made {
  code: string | null
  reason: string | null
  machines: number
  buildings: number
  size: { width: number; height: number; floors: number }
  inputs: string[]
  notes: string[]
  /** Shapes a minute one of these puts out. */
  rate: number
}

/**
 * The whole plan as something to paste, in two sizes.
 *
 * They are the same factory built to different appetites and the difference is
 * worth showing rather than choosing for the player. The small one puts a
 * single machine at each step, which fits anywhere and makes about a sixth of a
 * belt. The full one holds as many machines as it takes to keep a belt busy,
 * which is six times the output for about four times the buildings — and the
 * number that decides between them is the rate, so both say theirs plainly.
 */
export function BlueprintExport({ root, shapeCode, tier, stackerVariant }: BlueprintExportProps) {
  const [small, setSmall] = useState<Made | null>(null)
  const [full, setFull] = useState<Made | null>(null)
  const [copied, setCopied] = useState<'small' | 'full' | null>(null)

  useEffect(() => {
    let cancelled = false
    const belt = beltThroughput(tier)

    // one machine a step keeps up with whatever the hungriest step would have
    // needed several of, which is what sets the small one's rate
    const sized = factoryPlan(root, {
      lanes: 1,
      tier,
      stackerVariant,
      tilesOf: (type) => tilesOf(type, 0).length,
    })
    const hungriest = Math.max(1, ...sized.steps.map((step) => step.machines))

    void Promise.all([
      generateShapeModule(root, shapeCode).then(({ layout, code }) =>
        setSmall(cancelled ? null : fromShape(layout, code, belt / hungriest)),
      ),
      generateFactoryModule(root, { tier, stackerVariant, icon: shapeCode }).then(
        ({ layout, code }) => setFull(cancelled ? null : fromFactory(layout, code, belt)),
      ),
    ]).catch(() => {
      if (cancelled) return
      setSmall((held) => held ?? { ...blank, reason: '청사진을 만들지 못했습니다' })
      setFull((held) => held ?? { ...blank, reason: '청사진을 만들지 못했습니다' })
    })

    return () => {
      cancelled = true
    }
  }, [root, shapeCode, tier, stackerVariant])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(null), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  if (small === null && full === null) return null

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">모듈 청사진</h3>
        <p className="text-xs text-muted-foreground">
          계획 전체가 플랫폼 한 장에 들어갑니다. 복사한 뒤 게임에서{' '}
          <kbd className="rounded border px-1">Ctrl</kbd>+<kbd className="rounded border px-1">V</kbd>{' '}
          로 붙여넣으세요. 추출기와 물감 파이프는 들어 있지 않습니다.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card
          title="벨트 하나 가득"
          hint="느린 단계에는 기계를 여러 대 놓아서 벨트 한 줄을 가득 채웁니다. 크게 지을 때 이쪽입니다."
          made={full}
          copied={copied === 'full'}
          onCopy={() => setCopied('full')}
        />
        <Card
          title="작게 한 장"
          hint="단계마다 기계 한 대씩입니다. 제일 작고 어디든 들어가지만, 제일 느린 단계가 전체 속도를 정합니다."
          made={small}
          copied={copied === 'small'}
          onCopy={() => setCopied('small')}
        />
      </div>
    </section>
  )
}

const blank: Made = {
  code: null,
  reason: null,
  machines: 0,
  buildings: 0,
  size: { width: 0, height: 0, floors: 0 },
  inputs: [],
  notes: [],
  rate: 0,
}

function fromShape(layout: ShapeModuleResult, code: string | null, rate: number): Made {
  if (!layout.ok) return { ...blank, reason: layout.reason }
  return {
    code,
    reason: null,
    machines: layout.machines,
    buildings: layout.placements.length,
    size: layout.size,
    inputs: layout.inputs.map((one) => one.part),
    notes: layout.notes,
    rate,
  }
}

function fromFactory(layout: FactoryModuleResult, code: string | null, rate: number): Made {
  if (!layout.ok) return { ...blank, reason: layout.reason }
  return {
    code,
    reason: null,
    machines: layout.machines,
    buildings: layout.placements.length,
    size: layout.size,
    inputs: layout.inputs.map((one) => one.part),
    notes: layout.notes,
    rate,
  }
}

function Card({
  title,
  hint,
  made,
  copied,
  onCopy,
}: {
  title: string
  hint: string
  made: Made | null
  copied: boolean
  onCopy: () => void
}) {
  if (made === null) {
    return (
      <div className="rounded-md border bg-muted/30 p-3">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">만드는 중…</p>
      </div>
    )
  }

  if (made.reason || !made.code) {
    return (
      <div className="rounded-md border bg-muted/30 p-3">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{made.reason ?? '만들지 못했습니다'}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="text-sm font-medium">{title}</p>
        <Badge variant="secondary" className="tabular-nums">
          분당 {Math.round(made.rate).toLocaleString()}개
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>

      <p className="text-xs text-muted-foreground tabular-nums">
        기계 {made.machines}대 · 건물 {made.buildings}개 · {made.size.width}×{made.size.height}
        {made.size.floors > 1 ? ` · ${made.size.floors}개 층` : ''}
      </p>

      {made.inputs.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          왼쪽 가장자리로 넣을 것:{' '}
          {made.inputs.map((part) => PART_NAMES_KO[part] ?? part).join(', ')} — 완성된 도형은 맨
          오른쪽으로 나옵니다.
        </p>
      ) : null}

      {made.notes.map((note) => (
        <p key={note} className="text-xs text-muted-foreground">
          · {note}
        </p>
      ))}

      <Button
        size="sm"
        variant={copied ? 'secondary' : 'default'}
        className="mt-auto"
        onClick={() => {
          void navigator.clipboard.writeText(made.code ?? '').then(onCopy).catch(() => {})
        }}
      >
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        {copied ? '복사됨' : '청사진 복사'}
      </Button>
    </div>
  )
}
