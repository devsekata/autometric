import { auth } from '@/auth'
import { NextResponse } from 'next/server'

export const proxy = auth((req) => {
  const isLoggedIn = !!req.auth
  const { pathname } = req.nextUrl

  // Protect the welcome page and all dashboard routes
  if ((pathname === '/' || pathname.startsWith('/organizations')) && !isLoggedIn) {
    return Response.redirect(new URL('/login', req.url))
  }

  // Redirect logged-in users away from login → welcome page
  if (pathname.startsWith('/login') && isLoggedIn) {
    return Response.redirect(new URL('/', req.url))
  }

  const res = NextResponse.next()
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
  return res
})

export const config = {
  matcher: ['/', '/organizations/:path*', '/login', '/auth-error'],
}
