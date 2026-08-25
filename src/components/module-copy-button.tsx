'use client'

import { CheckIcon, CopyIcon, LoaderIcon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { SEARCHED_MODULES, makeModule, type MadeModule } from '@/lib/shapez/moduleEdges'
import type { OperationId } from '@/lib/shapez/operations'
import type { SpeedTier } from '@/lib/shapez/throughput'

/**
 * One module's blueprint, made when it is asked for.
 *
 * Nothing is built until the button is pressed. Six of the ten come back in a
 * blink and four have their belts searched for and take up to a couple of
 * seconds, so building every module a screen mentions would freeze it for
 * several seconds to prepare blueprints nobody may copy. The wait is paid by
 * the button that was clicked, and that button says it is waiting.
 */
export function ModuleCopyButton({
  op,
  tier,
  className,
  label = '청사진',
  onMade,
}: {
  op: OperationId
  tier: SpeedTier
  className?: string
  label?: string
  /** Whatever the module had to say for itself, once it has been made. */
  onMade?: (made: MadeModule) => void
}) {
  const [state, setState] = useState<'idle' | 'making' | 'copied' | 'failed'>('idle')

  const copy = () => {
    setState('making')
    // let the button repaint before a search takes the thread
    window.setTimeout(() => {
      void makeModule(op, tier)
        .then(async (made) => {
          onMade?.(made)
          const { code } = made
          if (!code) return setState('failed')
          await navigator.clipboard.writeText(code)
          setState('copied')
          window.setTimeout(() => setState('idle'), 1600)
        })
        .catch(() => setState('failed'))
    }, 50)
  }

  return (
    <Button
      size="sm"
      variant={state === 'copied' ? 'secondary' : 'outline'}
      className={className ?? 'h-7 gap-1.5 px-2 text-xs'}
      disabled={state === 'making'}
      onClick={copy}
      title={
        SEARCHED_MODULES.has(op)
          ? '벨트를 찾아 놓는 모듈이라 1~2초 걸립니다'
          : '모듈 청사진을 클립보드에 복사합니다'
      }
    >
      {state === 'making' ? (
        <LoaderIcon className="size-3 animate-spin" />
      ) : state === 'copied' ? (
        <CheckIcon className="size-3" />
      ) : (
        <CopyIcon className="size-3" />
      )}
      {state === 'making'
        ? '만드는 중'
        : state === 'copied'
          ? '복사됨'
          : state === 'failed'
            ? '실패'
            : label}
    </Button>
  )
}
