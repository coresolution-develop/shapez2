'use client'

import { CheckIcon, ChevronRightIcon, CopyIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { BuildingEntry } from '@/lib/shapez/blueprint'
import { UNKNOWN_PORTS, portsFor } from '@/lib/shapez/portData'
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

/** Machines we still need geometry for, either never seen or only half measured. */
const WANTED = new Set<string>(UNKNOWN_PORTS)

type Status = 'wanted' | 'new' | 'known'

const STATUS_LABEL: Record<Status, string> = {
  wanted: '찾던 것',
  new: '새로 확인',
  known: '이미 확인됨',
}

const STATUS_ORDER: Record<Status, number> = { wanted: 0, new: 1, known: 2 }

/**
 * Measures belt geometry from whatever the player pasted.
 *
 * This is how the app learns new machines: the game ships no port data, so a
 * working factory is the only source. It's tucked away by default and only
 * opens itself when the blueprint actually contains something we don't know.
 */
export function PortReport({ buildings }: PortReportProps) {
  const derived = useMemo(() => derivePorts(buildings), [buildings])
  const [copied, setCopied] = useState(false)
  const [override, setOverride] = useState<boolean | null>(null)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  const rows = useMemo(() => {
    const entries = [...derived.entries()].map(([type, model]) => {
      const confirmed = portsFor(type)
      const status: Status =
        WANTED.has(type) || confirmed?.partialBelts ? 'wanted' : confirmed ? 'known' : 'new'
      return { type, model, status }
    })
    return entries.sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.model.instances - a.model.instances,
    )
  }, [derived])

  if (rows.length === 0) return null

  const useful = rows.filter((row) => row.status !== 'known')
  const open = override ?? useful.length > 0

  const asText = rows
    .map(
      ({ type, model }) =>
        `${type}\tin=${formatPorts(model.inputs)}\tout=${formatPorts(model.outputs)}\tn=${model.instances}`,
    )
    .join('\n')

  return (
    <details
      open={open}
      onToggle={(event) => setOverride(event.currentTarget.open)}
      className="rounded-lg border bg-muted/30"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 p-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          aria-hidden
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
        />
        건물 포트 분석
        {useful.length > 0 ? (
          <Badge variant="default" className="ml-1">
            {useful.length}종 새로 확인
          </Badge>
        ) : (
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            새로 알아낸 건물 없음
          </span>
        )}
      </summary>

      <div className="space-y-3 border-t p-3">
        <p className="text-xs text-muted-foreground">
          게임 데이터에는 건물의 입출력 면 정보가 없어서, 실제로 돌아가는 공장에서 역산합니다.
          여기서 알아낸 기하가 있어야 청사진 생성이 그 기계를 배치할 수 있습니다.{' '}
          <strong className="font-medium text-foreground">
            아직 못 구한 기계가 들어간 큰 공장
          </strong>
          을 붙여넣을수록 쓸모가 있습니다.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th className="py-1.5 pr-3 font-medium">건물</th>
                <th className="py-1.5 pr-3 font-medium">입력</th>
                <th className="py-1.5 pr-3 font-medium">출력</th>
                <th className="py-1.5 pr-3 text-right font-medium">표본</th>
                <th className="py-1.5 font-medium">상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ type, model, status }) => (
                <tr
                  key={type}
                  className={`border-b last:border-0 ${status === 'known' ? 'text-muted-foreground/60' : ''}`}
                >
                  <td className="py-1.5 pr-3 font-mono">{type.replace(/InternalVariant$/, '')}</td>
                  <td className="py-1.5 pr-3 font-mono tabular-nums">
                    {formatPorts(model.inputs)}
                  </td>
                  <td className="py-1.5 pr-3 font-mono tabular-nums">
                    {formatPorts(model.outputs)}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{model.instances}</td>
                  <td className="py-1.5">
                    <span
                      className={
                        status === 'wanted'
                          ? 'font-medium text-primary'
                          : status === 'new'
                            ? 'font-medium'
                            : ''
                      }
                    >
                      {STATUS_LABEL[status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            표본이 1~2개면 우연히 옆에 붙은 벨트일 수 있어 믿기 어렵습니다.
          </p>
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
      </div>
    </details>
  )
}
