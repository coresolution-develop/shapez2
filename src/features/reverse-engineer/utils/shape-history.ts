'use client'

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'

import { readStorage, subscribeToBrowserState, writeStorage } from '@/lib/external-store'

const RECENT_KEY = 'shapez2:recent'
const FAVOURITE_KEY = 'shapez2:favourites'
const MAX_RECENT = 12
const REMEMBER_DELAY_MS = 1200

function parse(raw: string): string[] {
  if (raw === '') return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function useStoredList(key: string): string[] {
  const raw = useSyncExternalStore(
    subscribeToBrowserState,
    () => readStorage(key),
    () => '',
  )
  return useMemo(() => parse(raw), [raw])
}

/** Recently viewed and starred shape codes, kept in localStorage. */
export function useShapeHistory(currentCode: string, isValid: boolean) {
  const recent = useStoredList(RECENT_KEY)
  const favourites = useStoredList(FAVOURITE_KEY)

  // only remember a code once the user has stopped typing on something valid
  useEffect(() => {
    if (!isValid || currentCode === '') return
    const timer = window.setTimeout(() => {
      const current = parse(readStorage(RECENT_KEY))
      if (current[0] === currentCode) return
      const next = [currentCode, ...current.filter((code) => code !== currentCode)].slice(
        0,
        MAX_RECENT,
      )
      writeStorage(RECENT_KEY, JSON.stringify(next))
    }, REMEMBER_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [currentCode, isValid])

  const toggleFavourite = useCallback((code: string) => {
    const current = parse(readStorage(FAVOURITE_KEY))
    const next = current.includes(code)
      ? current.filter((item) => item !== code)
      : [code, ...current]
    writeStorage(FAVOURITE_KEY, JSON.stringify(next))
  }, [])

  const clearRecent = useCallback(() => {
    writeStorage(RECENT_KEY, JSON.stringify([]))
  }, [])

  return { recent, favourites, toggleFavourite, clearRecent }
}
