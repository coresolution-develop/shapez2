'use client'

import { MoonIcon, SunIcon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useSyncExternalStore } from 'react'

import { Button } from '@/components/ui/button'

const noop = () => () => {}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  // the server has no idea which theme the browser resolved, so render the
  // icon only once we're on the client
  const mounted = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  )

  const isDark = mounted && resolvedTheme === 'dark'

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? '라이트 모드로 전환' : '다크 모드로 전환'}
    >
      {isDark ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
    </Button>
  )
}
