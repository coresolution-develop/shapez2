import { ThemeToggle } from '@/components/theme-toggle'
import { ReverseEngineerView } from '@/features/reverse-engineer/components/reverse-engineer-view'
import { GAME_VERSION } from '@/lib/shapez/progression'

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-10">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">shapez 2 도우미</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
            목표 도형의 가공 순서와 필요 건물 수를 게임 규칙 그대로 계산합니다. 진행도를 설정하면
            지금 지을 수 있는 건물로만 계획을 짭니다.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <ReverseEngineerView />

      <footer className="mt-10 border-t pt-6 text-xs text-muted-foreground">
        도형 규칙과 프리셋 도형은 공식 <code className="font-mono">shapez2</code> 파이썬 패키지를,
        시나리오 해금 순서와 한국어 명칭은 게임 {GAME_VERSION} 설치본을 기준으로 합니다.
      </footer>
    </main>
  )
}
