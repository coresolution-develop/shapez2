'use client'

import { CheckIcon, LinkIcon, StarIcon, XIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { ShapeView } from '@/components/shape-view'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BlueprintViewer } from '@/features/blueprint/components/blueprint-viewer'
import { BlueprintExport } from '@/features/reverse-engineer/components/blueprint-export'
import { PlanSteps } from '@/features/reverse-engineer/components/plan-steps'
import { PresetPicker } from '@/features/reverse-engineer/components/preset-picker'
import { ProgressPanel } from '@/features/reverse-engineer/components/progress-panel'
import { ThroughputPanel } from '@/features/reverse-engineer/components/throughput-panel'
import { TradePanel } from '@/features/reverse-engineer/components/trade-panel'
import { shareUrl, useSessionState } from '@/features/reverse-engineer/utils/session-state'
import { useShapeHistory } from '@/features/reverse-engineer/utils/shape-history'
import {
  PROGRESSION,
  SCENARIO_KEYS,
  allUnlocks,
  scenarioNameKo,
  unlocksFor,
} from '@/lib/shapez/progression'
import type { ScenarioKey } from '@/lib/shapez/progression'
import { parseShapeCode, parseShapeCodeForDisplay } from '@/lib/shapez/shapeCode'
import { solveShape } from '@/lib/shapez/solver'
import { isTradeShape } from '@/lib/shapez/trade'
import { computeThroughput } from '@/lib/shapez/throughput'
import type { SpeedTier, StackerVariant } from '@/lib/shapez/throughput'
import { COLOR_SKINS } from '@/lib/shapez/types'
import type { ColorSkinId } from '@/lib/shapez/types'

const scenarioLabel = (key: ScenarioKey) =>
  `${scenarioNameKo(key)} · 최대 ${PROGRESSION[key]?.maxShapeLayers ?? 4}레이어`

export function ReverseEngineerView() {
  const { state, update, hydrated } = useSessionState()
  const { code, scenario, skin, target, tier, stackerVariant, milestone, sideUpgrades } = state

  const parsed = useMemo(() => parseShapeCode(code), [code])
  // gems and black-painted shapes have no plan, but they can still be drawn
  const display = useMemo(() => parseShapeCodeForDisplay(code), [code])
  const scenarioKey = scenario
  const maxShapeLayers = PROGRESSION[scenarioKey]?.maxShapeLayers ?? 4

  const unlocks = useMemo(
    () =>
      milestone > 0 ? unlocksFor({ scenario: scenarioKey, milestone, sideUpgrades }) : allUnlocks(),
    [scenarioKey, milestone, sideUpgrades],
  )

  const solution = useMemo(() => {
    if (!parsed.ok) return null
    return solveShape(
      parsed.shape,
      { maxShapeLayers, shapesConfig: parsed.config },
      { unlocks, scenario: scenarioKey },
    )
  }, [parsed, maxShapeLayers, unlocks, scenarioKey])

  const throughput = useMemo(() => {
    if (!solution?.ok) return null
    return computeThroughput(solution.root, { target, tier, stackerVariant })
  }, [solution, target, tier, stackerVariant])

  const { recent, favourites, toggleFavourite, clearRecent } = useShapeHistory(code, parsed.ok)
  const starred = favourites.includes(code)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>목표 도형</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="shape-code">도형 코드</Label>
              <div className="flex gap-2">
                <Input
                  id="shape-code"
                  value={code}
                  onChange={(event) => update('code', event.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  className="font-mono"
                  aria-invalid={!parsed.ok}
                  aria-describedby="shape-code-help"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => toggleFavourite(code)}
                  disabled={!parsed.ok}
                  aria-pressed={starred}
                  aria-label={starred ? '즐겨찾기 해제' : '즐겨찾기 추가'}
                  title={starred ? '즐겨찾기 해제' : '즐겨찾기 추가'}
                >
                  <StarIcon className={`size-4 ${starred ? 'fill-current' : ''}`} />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(shareUrl(state))
                      .then(() => setCopied(true))
                      .catch(() => setCopied(false))
                  }}
                  aria-label="현재 설정 링크 복사"
                  title="현재 설정 링크 복사"
                >
                  {copied ? <CheckIcon className="size-4" /> : <LinkIcon className="size-4" />}
                </Button>
              </div>
              <p id="shape-code-help" className="text-xs text-muted-foreground">
                아래 레이어부터 <code className="font-mono">:</code> 로 구분, 각 파트는 우상단부터
                시계방향.
              </p>
            </div>

            {parsed.ok ? (
              <div className="flex items-center gap-4">
                <ShapeView shape={parsed.shape} size={128} skin={skin} title={code} />
                <div className="text-sm">
                  <p className="font-medium">{parsed.config.label}</p>
                  <p className="text-muted-foreground">{parsed.shape.layers.length}개 레이어</p>
                </div>
              </div>
            ) : display.ok ? (
              // drawable but not plannable; the stations that trade it are laid
              // out on the right, where the plan would otherwise be
              <div className="flex items-center gap-4">
                <ShapeView shape={display.shape} size={128} skin={skin} title={code} />
                <div className="text-sm">
                  <p className="font-medium">{display.config.label}</p>
                  <p className="text-muted-foreground">{display.shape.layers.length}개 레이어</p>
                  <p className="mt-1 text-xs text-muted-foreground">{parsed.error}</p>
                </div>
              </div>
            ) : (
              <p role="alert" className="text-sm text-destructive">
                {parsed.error}
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="scenario">시나리오</Label>
                <Select
                  value={scenario}
                  onValueChange={(value) => update('scenario', (value ?? 'default') as ScenarioKey)}
                >
                  <SelectTrigger id="scenario" className="w-full">
                    <SelectValue>{(value: ScenarioKey) => scenarioLabel(value)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {SCENARIO_KEYS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {scenarioLabel(value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="skin">색상 모드</Label>
                <Select
                  value={skin}
                  onValueChange={(value) => update('skin', (value ?? 'RGB') as ColorSkinId)}
                >
                  <SelectTrigger id="skin" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.keys(COLOR_SKINS).map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <ProgressPanel
          scenarioKey={scenarioKey}
          milestone={milestone}
          sideUpgrades={sideUpgrades}
          skin={skin}
          onMilestoneChange={(value) => update('milestone', value)}
          onSideUpgradesChange={(value) => update('sideUpgrades', value)}
          onSelectShape={(value) => update('code', value)}
        />

        {hydrated && (favourites.length > 0 || recent.length > 0) ? (
          <section className="space-y-3 rounded-lg border bg-card p-4">
            {favourites.length > 0 ? (
              <ShapeStrip
                title="즐겨찾기"
                codes={favourites}
                skin={skin}
                onSelect={(value) => update('code', value)}
              />
            ) : null}
            {recent.length > 0 ? (
              <ShapeStrip
                title="최근 본 도형"
                codes={recent}
                skin={skin}
                onSelect={(value) => update('code', value)}
                onClear={clearRecent}
              />
            ) : null}
          </section>
        ) : null}
      </div>

      <Tabs defaultValue="plan">
        <TabsList>
          <TabsTrigger value="plan">가공 순서</TabsTrigger>
          <TabsTrigger value="presets">게임 내 도형 찾기</TabsTrigger>
          <TabsTrigger value="blueprint">청사진 뷰어</TabsTrigger>
        </TabsList>

        <TabsContent value="plan" className="mt-4">
          {solution === null && isTradeShape(code) ? (
            <TradePanel
              scenario={scenarioKey}
              code={code.trim()}
              skin={skin}
              onSelectShape={(next) => update('code', next)}
            />
          ) : solution === null ? (
            <p className="text-sm text-muted-foreground">
              유효한 도형 코드를 입력하면 가공 순서를 계산합니다.
            </p>
          ) : solution.ok ? (
            <div className="space-y-4">
              {solution.notes.map((note) => (
                <p key={note} className="rounded-md border bg-muted/50 p-3 text-sm">
                  {note}
                </p>
              ))}
              {throughput ? (
                <ThroughputPanel
                  plan={throughput}
                  target={target}
                  tier={tier}
                  stackerVariant={stackerVariant}
                  onTargetChange={(value) => update('target', value)}
                  onTierChange={(value) => update('tier', value as SpeedTier)}
                  onStackerVariantChange={(value) =>
                    update('stackerVariant', value as StackerVariant)
                  }
                />
              ) : null}
              <BlueprintExport root={solution.root} shapeCode={code} skin={skin} />
              <PlanSteps root={solution.root} skin={skin} loads={throughput?.loads} />
            </div>
          ) : (
            <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
              <p className="font-medium text-destructive">{solution.error}</p>
              {solution.hint ? (
                <p className="text-sm text-muted-foreground">{solution.hint}</p>
              ) : null}
              {milestone > 0 ? (
                <Button variant="outline" size="sm" onClick={() => update('milestone', 0)}>
                  진행도 제한 끄고 다시 계산
                </Button>
              ) : null}
            </div>
          )}
        </TabsContent>

        <TabsContent value="presets" className="mt-4">
          <PresetPicker skin={skin} onSelect={(value) => update('code', value)} />
        </TabsContent>

        <TabsContent value="blueprint" className="mt-4">
          <BlueprintViewer skin={skin} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

interface ShapeStripProps {
  title: string
  codes: string[]
  skin: ColorSkinId
  onSelect: (code: string) => void
  onClear?: () => void
}

function ShapeStrip({ title, codes, skin, onSelect, onClear }: ShapeStripProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <XIcon className="size-3" />
            비우기
          </button>
        ) : null}
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {codes.map((entry) => {
          const parsed = parseShapeCode(entry)
          if (!parsed.ok) return null
          return (
            <li key={entry}>
              <button
                type="button"
                onClick={() => onSelect(entry)}
                title={entry}
                className="rounded-md border bg-background p-1 transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <ShapeView shape={parsed.shape} size={34} skin={skin} title={entry} />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
