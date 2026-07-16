import './globals.css'

import type { Metadata, Viewport } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { Analytics } from '@vercel/analytics/react'
import { SessionProvider } from 'next-auth/react'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'

/** Only load Vercel Web Analytics when deployed on Vercel (avoids localhost 404 + console noise). */
const enableVercelAnalytics = process.env.VERCEL === '1'

export const metadata: Metadata = {
  title: 'RAG Eval',
  description: 'RAG evaluation console',
  icons: {
    icon: '/RAGEvalIcon.png',
    apple: '/RAGEvalIcon.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`h-full ${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="h-full bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <SessionProvider refetchOnWindowFocus={false} refetchInterval={0}>
            {children}
          </SessionProvider>
          <Toaster richColors closeButton position="top-center" />
          {enableVercelAnalytics ? <Analytics /> : null}
        </ThemeProvider>
      </body>
    </html>
  )
}
