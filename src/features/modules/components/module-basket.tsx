'use client'

import { MinusIcon, PlusIcon, Trash2Icon } from 'lucide-react'

import { ModuleCopyButton } from '@/components/module-copy-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  basketCost,
  machinesInModule,
  setBasketCount,
  type BasketEntry,
} from '@/lib/shapez/moduleBasket'
import { EDGE_NAMES_KO, MODULE_WIRING, moduleCapacity } from '@/lib/shapez/moduleEdges'
import { OPERATIONS, type OperationId } from '@/lib/shapez/operations'
import type { SpeedTier } from '@/lib/shapez/throughput'

interface ModuleBasketProps {
  basket: BasketEntry[]
  tier: SpeedTier
  onChange: (basket: BasketEntry[]) => void
}

/**
 * The modules put aside to build, gathered in one place.
 *
 * Everything up to now answered one question at a time — what does *this* shape
 * need, what does a swapper module look like — and a factory is not one shape.
 * Working out that the whole thing wants two cutters, a painter and four
 * rotators meant holding it in your head across three tabs. This holds it
 * instead, adds up what it will cost in platforms and machines, and hands over
 * every blueprint from the same screen.
 *
 * It lives in the URL with the rest of the setup, so a half-planned factory is
 * a link rather than a tab you dare not close.
 */
export function ModuleBasket({ basket, tier, onChange }: ModuleBasketProps) {
  const total = basket.reduce((sum, entry) => sum + entry.count, 0)

  if (total === 0) {
    return (
      <section className="rounded-lg border border-dashed bg-card p-8 text-center">
        <p className="text-sm font-medium">모듈함이 비어 있습니다</p>
        <p className="mx-auto mt-1.5 max-w-md text-xs text-muted-foreground">
          <strong className="font-medium text-foreground">가공 순서</strong>의 모듈 배치도나{' '}
          <strong className="font-medium text-foreground">작업 모듈</strong> 카탈로그에서 담기를
          누르면 여기 쌓입니다. 공장 하나에 필요한 모듈을 다 담아 두고 한 화면에서 지으세요.
        </p>
      </section>
    )
  }

  const { machines } = basketCost(basket, tier)
  const setCount = (op: OperationId, count: number) =>
    onChange(setBasketCount(basket, op, count))

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg border bg-card p-4">
        <h3 className="text-sm font-medium">내 모듈함</h3>
        <span className="text-xs text-muted-foreground">
          플랫폼 <strong className="font-medium tabular-nums text-foreground">{total}</strong>장 ·
          기계 <strong className="font-medium tabular-nums text-foreground">
            {machines.toLocaleString()}
          </strong>
          대
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 gap-1.5 px-2 text-xs text-muted-foreground"
          onClick={() => onChange([])}
        >
          <Trash2Icon className="size-3" />
          비우기
        </Button>
      </div>

      <ul className="space-y-2">
        {basket.map((entry) => (
          <BasketRow
            key={entry.op}
            entry={entry}
            tier={tier}
            onCount={(count) => setCount(entry.op, count)}
          />
        ))}
      </ul>

      <p className="text-xs text-muted-foreground">
        모듈 한 장이 분당 {moduleCapacity(tier).toLocaleString()}개까지 처리합니다. 같은 모듈을 여러
        장 담았다면 청사진은 한 번만 복사해서 그만큼 붙여넣으면 됩니다.
      </p>
    </section>
  )
}

function BasketRow({
  entry,
  tier,
  onCount,
}: {
  entry: BasketEntry
  tier: SpeedTier
  onCount: (count: number) => void
}) {
  const wiring = MODULE_WIRING[entry.op]
  const sides = [...wiring.inputs, ...wiring.outputs].filter((port) => port.edge !== 'intake' && port.edge !== 'outlet')

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border bg-muted/30 p-3">
      <span className="text-sm font-medium">{OPERATIONS[entry.op].labelKo} 모듈</span>
      <span className="text-xs text-muted-foreground tabular-nums">
        기계 {machinesInModule(entry.op, tier)}대
      </span>
      {sides.length > 0 ? (
        <Badge variant="outline" className="font-normal">
          {sides.map((port) => EDGE_NAMES_KO[port.edge]).join('·')} 가장자리도 씁니다
        </Badge>
      ) : null}

      <div className="ml-auto flex items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={() => onCount(entry.count - 1)}
          aria-label={`${OPERATIONS[entry.op].labelKo} 모듈 하나 빼기`}
        >
          <MinusIcon className="size-3" />
        </Button>
        <span className="w-6 text-center text-sm font-medium tabular-nums">{entry.count}</span>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={() => onCount(entry.count + 1)}
          aria-label={`${OPERATIONS[entry.op].labelKo} 모듈 하나 더`}
        >
          <PlusIcon className="size-3" />
        </Button>
      </div>

      <ModuleCopyButton op={entry.op} tier={tier} />
    </li>
  )
}
