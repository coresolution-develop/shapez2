import type { Metadata } from 'next'
import { Geist_Mono } from 'next/font/google'

import { ThemeProvider } from '@/components/theme-provider'

import './globals.css'

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'shapez 2 도형 역설계',
  description:
    'shapez 2 목표 도형의 가공 순서와 필요 건물 수를 게임 규칙 그대로 계산하고, 청사진 코드를 읽어 줍니다.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ko" className={`${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
