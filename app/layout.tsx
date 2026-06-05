import type { Metadata, Viewport } from 'next'
import { ThemeProvider } from 'next-themes'
import { LocalServiceWorkerRegister } from '@/components/LocalServiceWorkerRegister'
import './globals.css'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
  themeColor: '#111214',
}

export const metadata: Metadata = {
  title: 'DoneWell Audio — Acoustic Feedback Detection',
  description: 'Real-time acoustic feedback detection and EQ advisory for live sound engineers. Works offline.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'DoneWellAudio',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:rounded focus:bg-primary focus:text-primary-foreground focus:text-sm focus:font-medium focus:ring-[3px] focus:ring-ring/50 focus:outline-none">
          Skip to main content
        </a>
        <ThemeProvider attribute="class" defaultTheme="dark" storageKey="dwa-theme" disableTransitionOnChange>
          <LocalServiceWorkerRegister />
          <main id="main">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  )
}
