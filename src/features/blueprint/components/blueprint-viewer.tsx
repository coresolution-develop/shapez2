'use client'

import { useEffect, useState } from 'react'

import { ShapeView } from '@/components/shape-view'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { LayerMap } from '@/features/blueprint/components/layer-map'
import { PortReport } from '@/features/blueprint/components/port-report'
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  buildingCategory,
} from '@/features/blueprint/utils/categories'
import { BlueprintError, decodeBlueprint, findBlueprintCodes, summarize } from '@/lib/shapez/blueprint'
import type { Blueprint, BlueprintSummary } from '@/lib/shapez/blueprint'
import type { ColorSkinId } from '@/lib/shapez/types'

interface BlueprintViewerProps {
  skin: ColorSkinId
}

interface DecodeResult {
  code: string
  blueprint?: Blueprint
  summary?: BlueprintSummary
  error?: string
}

export function BlueprintViewer({ skin }: BlueprintViewerProps) {
  const [raw, setRaw] = useState('')
  const [result, setResult] = useState<DecodeResult | null>(null)

  const code = findBlueprintCodes(raw)[0] ?? raw.trim()

  useEffect(() => {
    if (code === '') return

    let cancelled = false
    decodeBlueprint(code)
      .then((decoded) => {
        if (!cancelled) setResult({ code, blueprint: decoded, summary: summarize(decoded) })
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setResult({
          code,
          error: cause instanceof BlueprintError ? cause.message : '청사진을 읽지 못했습니다',
        })
      })

    return () => {
      cancelled = true
    }
  }, [code])

  // ignore results from a code the user has already replaced
  const active = code === '' || result?.code !== code ? null : result
  const blueprint = active?.blueprint ?? null
  const summary = active?.summary ?? null
  const error = active?.error ?? null

  const layers = summary?.bounds
    ? Array.from(
        { length: summary.bounds.layers },
        (_, index) => summary.bounds!.min.z + index,
      )
    : []

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <Label htmlFor="blueprint-code">청사진 코드</Label>
        <Textarea
          id="blueprint-code"
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          placeholder="게임에서 청사진을 복사(Ctrl+C)한 뒤 여기에 붙여넣으세요. SHAPEZ2-1-... 로 시작합니다."
          spellCheck={false}
          rows={4}
          className="font-mono text-xs"
          aria-invalid={error !== null}
        />
        <p className="text-xs text-muted-foreground">
          주변 텍스트가 섞여 있어도 코드만 찾아냅니다.
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {blueprint && summary ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Figure
              label="종류"
              value={summary.kind === 'island' ? '플랫폼 청사진' : '건물 청사진'}
              detail={`게임 버전 ${summary.version}`}
            />
            <Figure
              label="건물 수"
              value={`${summary.totalBuildings}개`}
              detail={summary.totalIslands > 0 ? `플랫폼 ${summary.totalIslands}개` : '—'}
            />
            <Figure
              label="크기"
              value={
                summary.bounds
                  ? `${summary.bounds.width} × ${summary.bounds.height}`
                  : '—'
              }
              detail={summary.bounds ? `${summary.bounds.layers}개 층` : '—'}
            />
            <Figure
              label="점유 타일"
              value={`${blueprint.buildings.reduce((sum, b) => sum + b.tiles.length, 0)}칸`}
              detail="회전 반영"
            />
          </div>

          {blueprint.icons.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-sm font-medium">아이콘</h3>
              <ul className="flex flex-wrap items-center gap-3">
                {blueprint.icons.map((icon, index) => (
                  <li key={index} className="flex items-center gap-2 rounded-lg border bg-card p-2">
                    {icon.kind === 'shape' && icon.shape ? (
                      <>
                        <ShapeView shape={icon.shape} size={40} skin={skin} title={icon.shapeCode} />
                        <code className="font-mono text-xs text-muted-foreground">
                          {icon.shapeCode}
                        </code>
                      </>
                    ) : (
                      <span className="text-xs">아이콘: {icon.icon}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {summary.unknownTypes.length > 0 ? (
            <p className="rounded-md border bg-muted/50 p-3 text-sm">
              이 버전 데이터에 없는 건물 {summary.unknownTypes.length}종이 있습니다 (
              {summary.unknownTypes.slice(0, 3).join(', ')}
              {summary.unknownTypes.length > 3 ? ' 외' : ''}). 최신 게임 버전의 청사진일 수 있어
              배치도에서 1칸으로 표시됩니다.
            </p>
          ) : null}

          <section className="space-y-2">
            <h3 className="text-sm font-medium">건물 구성</h3>
            <ul className="flex flex-wrap gap-2">
              {summary.byTitle.map((entry) => (
                <li key={entry.variant}>
                  <Badge variant="secondary" className="gap-1.5 py-1">
                    <span
                      aria-hidden
                      className="size-2 rounded-full"
                      style={{ backgroundColor: CATEGORY_COLORS[buildingCategory(entry.variant)] }}
                    />
                    <span>{entry.title}</span>
                    <span className="font-semibold tabular-nums">{entry.count}</span>
                  </Badge>
                </li>
              ))}
            </ul>
          </section>

          <PortReport buildings={blueprint.buildings} />

          {summary.bounds ? (
            <section className="space-y-3">
              <div className="flex flex-wrap items-center gap-4">
                <h3 className="text-sm font-medium">층별 배치도</h3>
                <ul className="flex flex-wrap gap-3">
                  {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                    <li key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span
                        aria-hidden
                        className="size-2.5 rounded-sm"
                        style={{ backgroundColor: CATEGORY_COLORS[key as keyof typeof CATEGORY_COLORS] }}
                      />
                      {label}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-wrap gap-4">
                {layers.map((layer) => (
                  <LayerMap
                    key={layer}
                    buildings={blueprint.buildings}
                    layer={layer}
                    bounds={{
                      minX: summary.bounds!.min.x,
                      minY: summary.bounds!.min.y,
                      width: summary.bounds!.width,
                      height: summary.bounds!.height,
                    }}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function Figure({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}
