'use client'

import { ArrowRightIcon, PackagePlusIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { ModuleCopyButton } from '@/components/module-copy-button'
import { ShapeView } from '@/components/shape-view'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { generateLaneModule, moduleSizing, MODULE_LANES } from '@/lib/shapez/module'
import { SEARCHED_MODULES, type MadeModule } from '@/lib/shapez/moduleEdges'
import { MODULE_CATALOGUE, catalogueDemo } from '@/lib/shapez/moduleCatalogue'
import { OPERATIONS, type OperationId } from '@/lib/shapez/operations'
import { OPERATION_SPECS, beltThroughput, ratedThroughput } from '@/lib/shapez/throughput'
import type { SpeedTier } from '@/lib/shapez/throughput'
import type { ColorSkinId } from '@/lib/shapez/types'

interface ModuleCatalogueProps {
  tier: SpeedTier
  skin: ColorSkinId
  onCollect: (op: OperationId) => void
}

interface Made {
  code: string | null
  reason: string | null
  warnings: string[]
  perLane: number
  machines: number
  shape: 'comb' | 'ladder' | null
}

export function ModuleCatalogue({ tier, skin, onCollect }: ModuleCatalogueProps) {
  const [made, setMade] = useState<Map<OperationId, Made> | null>(null)
  const [searched, setSearched] = useState<Map<OperationId, Made>>(new Map())

  const demos = useMemo(
    () => new Map(MODULE_CATALOGUE.map((entry) => [entry.op, catalogueDemo(entry)] as const)),
    [],
  )

  useEffect(() => {
    let cancelled = false

    Promise.all(
      MODULE_CATALOGUE.map(async (entry): Promise<[OperationId, Made]> => {
        if (SEARCHED_MODULES.has(entry.op)) {
          // these have their belts searched for, so they wait to be asked
          const { perLane, machines } = SEARCHED_MODULES.get(entry.op)!
          return [entry.op, { perLane, machines, code: null, reason: null, warnings: [], shape: null }]
        }
        const sizing = moduleSizing(
          entry.op,
          beltThroughput(tier),
          ratedThroughput(OPERATION_SPECS[entry.op], tier),
        )
        const base = { perLane: sizing.perLane, machines: sizing.machines }
        try {
          const { layout, code } = await generateLaneModule(entry.op, sizing.perLane)
          return [
            entry.op,
            {
              ...base,
              code,
              reason: layout.ok ? null : layout.reason,
              warnings: layout.ok ? layout.warnings : [],
              shape: layout.ok ? layout.shape : null,
            },
          ]
        } catch {
          return [
            entry.op,
            { ...base, code: null, reason: '청사진을 만들지 못했습니다', warnings: [], shape: null },
          ]
        }
      }),
    ).then((entries) => {
      if (!cancelled) setMade(new Map(entries))
    })

    return () => {
      cancelled = true
    }
  }, [tier])

  // ready modules first: the list is for picking something to paste
  const ordered = made
    ? [...MODULE_CATALOGUE].sort(
        (a, b) => Number(Boolean(made.get(b.op)?.code)) - Number(Boolean(made.get(a.op)?.code)),
      )
    : MODULE_CATALOGUE

  return (
    <div className="space-y-4">
      <div className="space-y-1.5 rounded-lg border bg-muted/40 p-4">
        <h2 className="text-sm font-medium">작업 모듈이란</h2>
        <p className="text-sm text-muted-foreground">
          공장은 도형 하나를 통째로 만드는 기계 뭉치가 아니라, <strong className="font-medium text-foreground">한 가지 작업만 하는 모듈</strong>을 벨트로 이어 붙여서 만듭니다. 모듈 하나에는 벨트 {MODULE_LANES}줄이 위 가장자리로 들어와 아래로 나가고, 그 {MODULE_LANES}줄을 가득 채울 만큼의 기계가 들어 있습니다.
        </p>
        <p className="text-sm text-muted-foreground">
          플랫폼까지 같이 나오니 빈 땅에 그대로 붙여넣으면 됩니다. 기계 대수는 위쪽에서 고른 속도 업그레이드 단계를 따라갑니다.
        </p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {ordered.map((entry) => {
          const state = searched.get(entry.op) ?? made?.get(entry.op)
          const demo = demos.get(entry.op)
          return (
            <li
              key={entry.op}
              className="flex flex-col gap-3 rounded-lg border bg-card p-4"
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <h3 className="text-sm font-medium">{entry.title}</h3>
                  <span className="text-xs text-muted-foreground">
                    {OPERATIONS[entry.op].labelKo}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{entry.does}</p>
              </div>

              {demo ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 p-2">
                  {demo.before.map((shape, index) => (
                    <ShapeView key={`in-${index}`} shape={shape} size={44} skin={skin} />
                  ))}
                  <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" />
                  {demo.after.map((shape, index) => (
                    <ShapeView key={`out-${index}`} shape={shape} size={44} skin={skin} />
                  ))}
                </div>
              ) : null}

              <div className="mt-auto space-y-2">
                {state && !state.reason ? (
                  <>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary" className="tabular-nums">
                        {state.machines}대
                      </Badge>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        레인당 {state.perLane}대
                      </span>
                      {state.shape ? (
                        <span className="text-xs text-muted-foreground">
                          · {state.shape === 'ladder' ? '눕혀서 세로 배치' : '가로 한 줄 배치'}
                        </span>
                      ) : null}
                    </div>

                    {SEARCHED_MODULES.has(entry.op) ? (
                      <p className="text-xs text-muted-foreground">
                        · 벨트를 찾아 놓는 모듈이라 복사에 1~2초 걸립니다.
                      </p>
                    ) : null}

                    {state.warnings.map((warning) => (
                      <p key={warning} className="text-xs text-muted-foreground">
                        · {warning}
                      </p>
                    ))}

                    <div className="flex gap-2">
                      <ModuleCopyButton
                        op={entry.op}
                        tier={tier}
                        label="모듈 복사"
                        className="h-8 flex-1 gap-1.5 text-xs"
                        onMade={(result: MadeModule) =>
                          setSearched((was) =>
                            new Map(was).set(entry.op, {
                              ...result,
                              perLane: state.perLane,
                              machines: result.machines || state.machines,
                              shape: state.shape,
                            }),
                          )
                        }
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onCollect(entry.op)}
                        title={`${OPERATIONS[entry.op].labelKo} 모듈을 모듈함에 담습니다`}
                      >
                        <PackagePlusIcon className="size-3.5" />
                        담기
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {state?.reason ?? '만드는 중…'}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
