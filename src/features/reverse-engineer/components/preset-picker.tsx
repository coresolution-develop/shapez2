'use client'

import { useMemo, useState } from 'react'

import { ShapeView } from '@/components/shape-view'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import presets from '@/lib/shapez/presets.json'
import { parseShapeCode } from '@/lib/shapez/shapeCode'
import { HEX_CONFIG, QUAD_CONFIG } from '@/lib/shapez/types'
import type { ColorSkinId } from '@/lib/shapez/types'

interface Preset {
  scenario: string
  category: string
  label: string
  code: string
}

const SCENARIO_LABELS: Record<string, string> = {
  default: '표준',
  hard: '하드',
  insane: 'Insane',
  hexagonal: '육각',
}

const CATEGORY_LABELS: Record<string, string> = {
  milestone: '마일스톤',
  operator: '오퍼레이터 레벨',
  sidequest: '사이드 퀘스트',
  blueprint: '청사진 화폐',
}

const MAX_RESULTS = 48

interface PresetPickerProps {
  skin: ColorSkinId
  onSelect: (code: string) => void
}

export function PresetPicker({ skin, onSelect }: PresetPickerProps) {
  const [scenario, setScenario] = useState('default')
  const [category, setCategory] = useState('milestone')
  const [query, setQuery] = useState('')

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (presets as Preset[]).filter(
      (preset) =>
        preset.scenario === scenario &&
        preset.category === category &&
        (needle === '' ||
          preset.label.toLowerCase().includes(needle) ||
          preset.code.toLowerCase().includes(needle)),
    )
  }, [scenario, category, query])

  const shapesConfig = scenario === 'hexagonal' ? HEX_CONFIG : QUAD_CONFIG
  const shown = matches.slice(0, MAX_RESULTS)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="preset-scenario">시나리오</Label>
          <Select value={scenario} onValueChange={(value) => setScenario(value ?? 'default')}>
            <SelectTrigger id="preset-scenario" className="w-full">
              <SelectValue>{(value: string) => SCENARIO_LABELS[value]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(SCENARIO_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="preset-category">종류</Label>
          <Select value={category} onValueChange={(value) => setCategory(value ?? 'milestone')}>
            <SelectTrigger id="preset-category" className="w-full">
              <SelectValue>{(value: string) => CATEGORY_LABELS[value]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="preset-query">검색</Label>
          <Input
            id="preset-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="이름 또는 도형 코드"
          />
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">일치하는 도형이 없습니다.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((preset) => {
            const parsed = parseShapeCode(preset.code, shapesConfig)
            return (
              <li key={`${preset.scenario}-${preset.code}`}>
                <button
                  type="button"
                  onClick={() => onSelect(preset.code)}
                  className="flex w-full items-center gap-3 rounded-lg border bg-card p-2 text-left transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  {parsed.ok ? (
                    <ShapeView shape={parsed.shape} size={40} skin={skin} title={preset.code} />
                  ) : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{preset.label}</span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">
                      {preset.code}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {matches.length > shown.length ? (
        <p className="text-xs text-muted-foreground">
          {matches.length}개 중 {shown.length}개 표시 중 — 검색으로 좁혀 보세요.
        </p>
      ) : null}
    </div>
  )
}
