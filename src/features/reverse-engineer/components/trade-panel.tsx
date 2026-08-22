'use client'

import { ShapeView } from '@/components/shape-view'
import { Badge } from '@/components/ui/badge'
import { parseShapeCode } from '@/lib/shapez/shapeCode'
import { stationsProducing, type TradeStation } from '@/lib/shapez/trade'
import type { ScenarioKey } from '@/lib/shapez/progression'
import type { ColorSkinId } from '@/lib/shapez/types'

interface TradePanelProps {
  scenario: ScenarioKey
  /** The gem shape the player asked about. */
  code: string
  skin: ColorSkinId
  onSelectShape: (code: string) => void
}

/**
 * What to show instead of "this cannot be built".
 *
 * A gem shape has no build plan, but it does have an origin: some trade station
 * emits it in exchange for shapes you *can* build. Those inputs are the actual
 * answer, so each one is a button that plans it.
 */
export function TradePanel({ scenario, code, skin, onSelectShape }: TradePanelProps) {
  const stations = stationsProducing(scenario, code)
  const exact = stations.some((station) => station.outputs.includes(code))

  if (stations.length === 0) {
    return (
      <div className="space-y-1.5 rounded-lg border bg-muted/40 p-3">
        <p className="text-sm font-medium">무역소에서 받는 도형입니다</p>
        <p className="text-xs text-muted-foreground">
          기계로는 만들 수 없습니다. 지금 고른 시나리오에는 이 도형을 내주는 무역소가 없습니다 —
          시나리오를 제조로 바꿔 보세요.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/40 p-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">무역소에서 받는 도형입니다</p>
        <p className="text-xs text-muted-foreground">
          기계로는 만들 수 없고, 아래 무역소에 재료를 넣으면 나옵니다. 재료 도형을 누르면 그걸
          만드는 가공 순서를 보여줍니다.
        </p>
        {exact ? null : (
          <p className="text-xs text-muted-foreground">
            이 배치 그대로 내주는 무역소는 없습니다. 같은 보석을 내주는 곳이라 받은 뒤 직접 잘라
            붙여야 합니다.
          </p>
        )}
      </div>

      <ul className="space-y-3">
        {stations.map((station) => (
          <li key={station.id}>
            <StationCard station={station} skin={skin} onSelectShape={onSelectShape} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function StationCard({
  station,
  skin,
  onSelectShape,
}: {
  station: TradeStation
  skin: ColorSkinId
  onSelectShape: (code: string) => void
}) {
  return (
    <div className="space-y-2 rounded-md border bg-background p-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-medium">{station.titleKo || station.title}</span>
        {station.convertersPerFullBelt ? (
          <span className="text-xs text-muted-foreground">
            벨트 1줄당 {station.convertersPerFullBelt}대
          </span>
        ) : null}
      </div>

      {/* rows rather than one arrow-separated line: the shapes wrap, and a
          wrapped arrow stops meaning anything */}
      <ShapeRow label="넣는 것" codes={station.inputs} skin={skin} onSelectShape={onSelectShape} />
      <ShapeRow label="받는 것" codes={station.outputs} skin={skin} onSelectShape={onSelectShape} />
    </div>
  )
}

function ShapeRow({
  label,
  codes,
  skin,
  onSelectShape,
}: {
  label: string
  codes: string[]
  skin: ColorSkinId
  onSelectShape: (code: string) => void
}) {
  if (codes.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-12 shrink-0 text-xs text-muted-foreground">{label}</span>
      {codes.map((code, index) => (
        <ShapeChip key={`${code}-${index}`} code={code} skin={skin} onSelectShape={onSelectShape} />
      ))}
    </div>
  )
}

function ShapeChip({
  code,
  skin,
  onSelectShape,
}: {
  code: string
  skin: ColorSkinId
  onSelectShape: (code: string) => void
}) {
  const parsed = parseShapeCode(code)

  // A gem input can't be planned either — but it is itself another station's
  // output, so following it walks back down the trade chain.
  return (
    <button
      type="button"
      onClick={() => onSelectShape(code)}
      title={parsed.ok ? `${code} · 가공 순서 보기` : `${code} · 이것도 무역소에서 받습니다`}
      className={`flex items-center gap-1.5 rounded-md border p-1 pr-1.5 transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none ${
        parsed.ok ? 'bg-background' : 'bg-muted/60'
      }`}
    >
      {parsed.ok ? <ShapeView shape={parsed.shape} size={28} skin={skin} title={code} /> : null}
      <code className="font-mono text-[11px] text-muted-foreground">{code}</code>
      {parsed.ok ? null : (
        <Badge variant="outline" className="px-1 py-0 text-[10px]">
          무역
        </Badge>
      )}
    </button>
  )
}
