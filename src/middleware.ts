import { type NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { guestRegex } from '@/lib/constants'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Playwright waits for a 200 on /ping before starting the suite.
  if (pathname.startsWith('/ping')) {
    return new Response('pong', { status: 200 })
  }

  if (pathname.startsWith('/api/auth')) {
    return NextResponse.next()
  }

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    // Derive from the request protocol at runtime (env vars are inlined into the
    // edge middleware at build time, so an env-based flag would be baked wrong).
    secureCookie: request.nextUrl.protocol === 'https:',
  })

  if (!token) {
    const redirectUrl = encodeURIComponent(request.url)
    return NextResponse.redirect(new URL(`/api/auth/guest?redirectUrl=${redirectUrl}`, request.url))
  }

  const isGuest = guestRegex.test(token?.email ?? '')

  if (token && !isGuest && ['/login', '/register'].includes(pathname)) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/',
    '/chat/:id',
    '/eval/:path*',
    '/query-logs',
    '/metrics',
    '/api/:path*',
    '/login',
    '/register',
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
}
