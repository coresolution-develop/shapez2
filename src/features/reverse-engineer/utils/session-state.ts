'use client'

import { useCallback, useMemo, useSyncExternalStore } from 'react'

import {
  notifyExternalStore,
  readSearch,
  subscribeToBrowserState,
} from '@/lib/external-store'
import type { SpeedTier, StackerVariant } from '@/lib/shapez/throughput'
import type { ScenarioKey } from '@/lib/shapez/progression'
import type { ColorSkinId } from '@/lib/shapez/types'

/**
 * Everything worth keeping in the URL, so a setup can be bookmarked, shared or
 * opened on a phone next to the game.
 */
export interface SessionState {
  code: string
  scenario: ScenarioKey
  skin: ColorSkinId
  target: number
  tier: SpeedTier
  stackerVariant: StackerVariant
  /** 0 disables the progress limit entirely. */
  milestone: number
  sideUpgrades: string[]
}

export const DEFAULT_STATE: SessionState = {
  code: 'RbRbRbRb:CrCrCrCr',
  scenario: 'default',
  skin: 'RGB',
  target: 60,
  tier: 100,
  stackerVariant: 'straight',
  milestone: 0,
  sideUpgrades: [],
}

const KEYS = {
  code: 's',
  scenario: 'sc',
  skin: 'k',
  target: 't',
  tier: 'u',
  stackerVariant: 'st',
  milestone: 'm',
  sideUpgrades: 'x',
} as const

function readParams(search: string): SessionState {
  const params = new URLSearchParams(search)
  const number = (key: string, fallback: number) => {
    const raw = params.get(key)
    const value = raw === null ? NaN : Number(raw)
    return Number.isFinite(value) ? value : fallback
  }

  return {
    code: params.get(KEYS.code) ?? DEFAULT_STATE.code,
    scenario: (params.get(KEYS.scenario) as ScenarioKey) ?? DEFAULT_STATE.scenario,
    skin: (params.get(KEYS.skin) as ColorSkinId) ?? DEFAULT_STATE.skin,
    target: Math.max(1, number(KEYS.target, DEFAULT_STATE.target)),
    tier: number(KEYS.tier, DEFAULT_STATE.tier) as SpeedTier,
    stackerVariant: (params.get(KEYS.stackerVariant) as StackerVariant) ?? DEFAULT_STATE.stackerVariant,
    milestone: Math.max(0, number(KEYS.milestone, DEFAULT_STATE.milestone)),
    sideUpgrades: params.get(KEYS.sideUpgrades)?.split(',').filter(Boolean) ?? [],
  }
}

function toSearch(state: SessionState): string {
  const params = new URLSearchParams()
  const set = (key: string, value: string, fallback: string) => {
    if (value !== fallback) params.set(key, value)
  }

  set(KEYS.code, state.code, DEFAULT_STATE.code)
  set(KEYS.scenario, state.scenario, DEFAULT_STATE.scenario)
  set(KEYS.skin, state.skin, DEFAULT_STATE.skin)
  set(KEYS.target, String(state.target), String(DEFAULT_STATE.target))
  set(KEYS.tier, String(state.tier), String(DEFAULT_STATE.tier))
  set(KEYS.stackerVariant, state.stackerVariant, DEFAULT_STATE.stackerVariant)
  set(KEYS.milestone, String(state.milestone), String(DEFAULT_STATE.milestone))
  set(KEYS.sideUpgrades, state.sideUpgrades.join(','), '')

  const query = params.toString()
  return query === '' ? '' : `?${query}`
}

/**
 * The URL *is* the state. Reads come from `location.search`, writes go back
 * through `replaceState` so typing never spams browser history, and the whole
 * setup stays shareable and bookmarkable.
 */
export function useSessionState() {
  const search = useSyncExternalStore(
    subscribeToBrowserState,
    readSearch,
    () => '', // the server has no URL state to read
  )

  const state = useMemo(() => readParams(search), [search])
  const hydrated = typeof window !== 'undefined'

  const update = useCallback(
    <K extends keyof SessionState>(key: K, value: SessionState[K]) => {
      const next = { ...readParams(window.location.search), [key]: value }
      const url = `${window.location.pathname}${toSearch(next)}`
      if (url !== `${window.location.pathname}${window.location.search}`) {
        window.history.replaceState(null, '', url)
        notifyExternalStore()
      }
    },
    [],
  )

  return { state, update, hydrated }
}

export function shareUrl(state: SessionState): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}${window.location.pathname}${toSearch(state)}`
}
