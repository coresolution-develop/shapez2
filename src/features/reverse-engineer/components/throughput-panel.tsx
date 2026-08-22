'use client'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PART_NAMES_KO, COLOR_NAMES_KO } from '@/lib/shapez/types'
import { SPEED_TIERS, beltThroughput } from '@/lib/shapez/throughput'
import type { SpeedTier, StackerVariant, ThroughputPlan } from '@/lib/shapez/throughput'

const TIER_LABELS: Record<number, string> = {
  50: '업그레이드 없음 (50%)',
  75: '1단계 (75%)',
  100: '2단계 (100%)',
  125: '3단계 (125%)',
  150: '최대 (150%)',
}

const STACKER_LABELS: Record<StackerVariant, string> = {
  straight: '직선형 (20/분)',
  bent: '굽은형 (30/분)',
}

interface ThroughputPanelProps {
  plan: ThroughputPlan
  target: number
  tier: SpeedTier
  stackerVariant: StackerVariant
  onTargetChange: (value: number) => void
  onTierChange: (value: SpeedTier) => void
  onStackerVariantChange: (value: StackerVariant) => void
}

export function ThroughputPanel({
  plan,
  target,
  tier,
  stackerVariant,
  onTargetChange,
  onTierChange,
  onStackerVariantChange,
}: ThroughputPanelProps) {
  return (
    <section className="space-y-4 rounded-lg border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="target-rate">목표 처리량 (개/분)</Label>
          <Input
            id="target-rate"
            type="number"
            min={1}
            step={10}
            value={target}
            onChange={(event) => onTargetChange(Math.max(1, Number(event.target.value) || 1))}
            className="tabular-nums"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="speed-tier">속도 업그레이드</Label>
          <Select
            value={String(tier)}
            onValueChange={(value) => onTierChange(Number(value ?? 100) as SpeedTier)}
          >
            <SelectTrigger id="speed-tier" className="w-full">
              <SelectValue>{(value: string) => TIER_LABELS[Number(value)]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SPEED_TIERS.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {TIER_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="stacker-variant">스태커 종류</Label>
          <Select
            value={stackerVariant}
            onValueChange={(value) => onStackerVariantChange((value ?? 'straight') as StackerVariant)}
          >
            <SelectTrigger id="stacker-variant" className="w-full">
              <SelectValue>{(value: string) => STACKER_LABELS[value as StackerVariant]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STACKER_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Figure
          label="필요 건물"
          value={`${plan.totalBuildings}대`}
          detail={`벨트 1줄 = ${beltThroughput(tier)}개/분`}
        />
        <Figure
          label="출력 벨트"
          value={`${plan.outputBelts}줄`}
          detail={`${plan.target}개/분 기준`}
        />
        <Figure
          label="필요 추출기"
          value={`${plan.extractors.reduce((sum, entry) => sum + entry.count, 0)}대`}
          detail={plan.extractors
            .map((entry) => `${PART_NAMES_KO[entry.part] ?? entry.part} ${entry.count}`)
            .join(', ')}
        />
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">건물별 소요량</h3>
        <ul className="flex flex-wrap gap-2">
          {plan.buildings.map((entry) => (
            <li key={entry.spec.building}>
              <Badge variant="secondary" className="gap-1.5 py-1">
                <span>{entry.spec.nameKo}</span>
                <span className="font-semibold tabular-nums">{entry.count}대</span>
                <span className="text-muted-foreground tabular-nums">
                  ({round(entry.opRate)}/분)
                </span>
              </Badge>
            </li>
          ))}
        </ul>
      </div>

      {plan.fluids.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">페인트 소요량</h3>
          <ul className="flex flex-wrap gap-2">
            {plan.fluids.map((fluid) => (
              <li key={fluid.color}>
                <Badge variant="outline" className="gap-1.5 py-1">
                  <span>{COLOR_NAMES_KO[fluid.color]}</span>
                  <span className="font-semibold tabular-nums">
                    {round(fluid.litresPerMinute)}L/분
                  </span>
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        건물 속도는 100% 기준값에 업그레이드 배율을 곱해 계산합니다. 페인터·크리스탈 생성기는
        100% 미만 단계가 없어서 하위 두 단계에서도 기본 속도로 계산됩니다. 벨트 분배 손실이나
        레인 배치는 반영하지 않은 이론값입니다.
      </p>
    </section>
  )
}

function Figure({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{detail || '—'}</p>
    </div>
  )
}

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
