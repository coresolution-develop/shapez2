'use client'

import { CheckIcon, CopyIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import type { BuildingEntry } from '@/lib/shapez/blueprint'
import { derivePorts } from '@/lib/shapez/ports'
import type { Port } from '@/lib/shapez/ports'

interface PortReportProps {
  buildings: BuildingEntry[]
}

const formatPorts = (ports: Port[]) =>
  ports.length === 0
    ? '—'
    : ports
        .map((port) => `(${port.offset[0]},${port.offset[1]})${port.medium === 'fluid' ? '~' : ''}`)
        .join(' ')

/**
 * Runs the port analysis on whatever the player pasted. The game ships no port
 * data, so this is how new machines get their belt geometry confirmed — paste a
 * working factory and the sides it uses fall out of the layout.
 */
export function PortReport({ buildings }: PortReportProps) {
  const derived = useMemo(() => derivePorts(buildings), [buildings])
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  const rows = useMemo(
    () =>
      [...derived.entries()]
        .map(([type, model]) => ({
          type,
          model,
          complete: model.inputs.length > 0 && model.outputs.length > 0,
        }))
        .sort(
          (a, b) => Number(a.complete) - Number(b.complete) || b.model.instances - a.model.instances,
        ),
    [derived],
  )

  if (rows.length === 0) return null

  const partial = rows.filter((row) => !row.complete)
  const asText = rows
    .map(
      ({ type, model }) =>
        `${type}\tin=${formatPorts(model.inputs)}\tout=${formatPorts(model.outputs)}\tn=${model.instances}`,
    )
    .join('\n')

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          건물 포트 분석
          {partial.length > 0 ? (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              한쪽만 잡힌 건물 {partial.length}종
            </span>
          ) : null}
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard
              .writeText(asText)
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }}
        >
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
          결과 복사
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        벨트가 향하는 면은 입력, 벨트가 시작하는 면은 출력입니다. 알아낸 포트를 타고 이웃으로
        연쇄 추론합니다. 좌표는 건물 기준 로컬 값이고, <code className="font-mono">~</code> 표시는
        파이프(유체) 포트입니다.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b">
              <th className="py-1.5 pr-3 font-medium">건물</th>
              <th className="py-1.5 pr-3 font-medium">입력</th>
              <th className="py-1.5 pr-3 font-medium">출력</th>
              <th className="py-1.5 pr-3 font-medium text-right">표본</th>
              <th className="py-1.5 font-medium">상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ type, model, complete }) => (
              <tr key={type} className="border-b last:border-0">
                <td className="py-1.5 pr-3 font-mono">{type.replace(/InternalVariant$/, '')}</td>
                <td className="py-1.5 pr-3 font-mono tabular-nums">{formatPorts(model.inputs)}</td>
                <td className="py-1.5 pr-3 font-mono tabular-nums">{formatPorts(model.outputs)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{model.instances}</td>
                <td className="py-1.5">
                  {complete ? (
                    <span className="text-muted-foreground">양쪽 확인</span>
                  ) : (
                    <span className="font-medium text-primary">한쪽만</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        표본이 1개뿐인 건물은 우연히 붙은 벨트일 수 있어 신뢰도가 낮습니다. 한쪽만 잡힌 건물은
        그 방향이 다른 기계에 직접 물려 있어 아직 추적이 닿지 않은 경우입니다.
      </p>
    </section>
  )
}

