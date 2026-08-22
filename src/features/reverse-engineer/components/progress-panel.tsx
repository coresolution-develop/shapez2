'use client'

import { ShapeView } from '@/components/shape-view'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { milestoneNameKo } from '@/lib/shapez/namesKo'
import presets from '@/lib/shapez/presets.json'
import { PROGRESSION, unlocksFor } from '@/lib/shapez/progression'
import type { ScenarioKey } from '@/lib/shapez/progression'
import { parseShapeCode } from '@/lib/shapez/shapeCode'
import { HEX_CONFIG, QUAD_CONFIG } from '@/lib/shapez/types'
import type { ColorSkinId } from '@/lib/shapez/types'

interface ProgressPanelProps {
  scenarioKey: ScenarioKey
  milestone: number
  sideUpgrades: string[]
  skin: ColorSkinId
  onMilestoneChange: (value: number) => void
  onSideUpgradesChange: (value: string[]) => void
  onSelectShape: (code: string) => void
}

export function ProgressPanel({
  scenarioKey,
  milestone,
  sideUpgrades,
  skin,
  onMilestoneChange,
  onSideUpgradesChange,
  onSelectShape,
}: ProgressPanelProps) {
  const scenario = PROGRESSION[scenarioKey] ?? PROGRESSION.default
  const limited = milestone > 0
  const unlocks = limited ? unlocksFor({ scenario: scenarioKey, milestone, sideUpgrades }) : null

  const goals = (presets as { scenario: string; category: string; label: string; code: string }[])
    .filter(
      (preset) =>
        preset.scenario === scenarioKey &&
        preset.category === 'milestone' &&
        preset.label.startsWith(`M${milestone} `),
    )
    .slice(0, 8)

  const shapesConfig = scenarioKey === 'hexagonal' ? HEX_CONFIG : QUAD_CONFIG

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4">
      <div className="space-y-1.5">
        <Label htmlFor="milestone">내 진행 상황</Label>
        <Select
          value={String(milestone)}
          onValueChange={(value) => onMilestoneChange(Number(value ?? 0))}
        >
          <SelectTrigger id="milestone" className="w-full">
            <SelectValue>
              {(value: string) =>
                Number(value) === 0
                  ? '제한 없음 (모든 건물 사용)'
                  : (() => {
                      const entry = scenario.milestones.find((m) => m.index === Number(value))
                      return `마일스톤 ${value} 완료 · ${
                        entry ? milestoneNameKo(entry.id, entry.title) : ''
                      }`
                    })()
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">제한 없음 (모든 건물 사용)</SelectItem>
            {scenario.milestones.map((entry) => (
              <SelectItem key={entry.index} value={String(entry.index)}>
                마일스톤 {entry.index} 완료 · {milestoneNameKo(entry.id, entry.title)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          설정하면 그 시점에 지을 수 있는 건물로만 가공 순서를 짭니다.
        </p>
        <p className="text-xs text-muted-foreground">
          해금 데이터는 게임 빌드 1058 기준이라 현재 버전과 다를 수 있고,{' '}
          <strong className="font-medium text-foreground">제조 모드는 아직 지원하지 않습니다</strong>.
          맞지 않으면 「제한 없음」으로 두세요.
        </p>
      </div>

      {limited ? (
        <>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              추가로 구매한 사이드 업그레이드
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {scenario.sideUpgrades.map((upgrade) => {
                const active = sideUpgrades.includes(upgrade.id)
                return (
                  <li key={upgrade.id}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        onSideUpgradesChange(
                          active
                            ? sideUpgrades.filter((id) => id !== upgrade.id)
                            : [...sideUpgrades, upgrade.id],
                        )
                      }
                      className={`rounded-md border px-2 py-1 text-xs transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none ${
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'bg-background hover:bg-accent'
                      }`}
                    >
                      {upgrade.title}
                      {upgrade.cost === null ? '' : ` · ${upgrade.cost}RP`}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>

          {unlocks ? (
            <p className="text-xs text-muted-foreground">
              사용 가능한 가공: {[...unlocks.operations].length}종
              {unlocks.colors.size > 0
                ? ` · 도색 가능한 색 ${unlocks.colors.size}가지`
                : ' · 도색 불가'}
            </p>
          ) : null}

          {goals.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                마일스톤 {milestone} 납품 도형
              </p>
              <ul className="flex flex-wrap gap-2">
                {goals.map((goal) => {
                  const parsed = parseShapeCode(goal.code, shapesConfig)
                  return (
                    <li key={goal.code}>
                      <button
                        type="button"
                        onClick={() => onSelectShape(goal.code)}
                        className="flex items-center gap-1.5 rounded-md border bg-background p-1.5 transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                        title={goal.code}
                      >
                        {parsed.ok ? (
                          <ShapeView shape={parsed.shape} size={32} skin={skin} title={goal.code} />
                        ) : null}
                        <code className="font-mono text-[11px] text-muted-foreground">
                          {goal.code}
                        </code>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : (
            <Badge variant="secondary">이 마일스톤에는 납품 도형이 없습니다</Badge>
          )}
        </>
      ) : null}
    </section>
  )
}
