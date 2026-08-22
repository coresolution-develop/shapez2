'use client'

/**
 * Small helpers for reading browser-owned state (the URL, localStorage) the way
 * React wants it read: as an external store with a stable string snapshot.
 * Parsing happens in `useMemo` at the call site, so snapshots stay referentially
 * stable and don't cause render loops.
 */
const listeners = new Set<() => void>()

/** Tells every subscriber that browser-owned state changed. */
export function notifyExternalStore(): void {
  for (const listener of listeners) listener()
}

export function subscribeToBrowserState(listener: () => void): () => void {
  listeners.add(listener)
  window.addEventListener('popstate', listener)
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('popstate', listener)
    window.removeEventListener('storage', listener)
  }
}

export function readSearch(): string {
  return window.location.search
}

export function readStorage(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // private browsing or a full quota — this state just won't persist
  }
  notifyExternalStore()
}
