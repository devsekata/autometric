import { auth } from '@/auth'
import { NextResponse } from 'next/server'

export const proxy = auth((req) => {
  const isLoggedIn = !!req.auth
  const { pathname } = req.nextUrl

  if (pathname.startsWith('/dashboard') && !isLoggedIn) {
    return Response.redirect(new URL('/login', req.url))
  }

  if (pathname.startsWith('/login') && isLoggedIn) {
    return Response.redirect(new URL('/dashboard', req.url))
  }

  if (pathname.startsWith('/login')) {
    const res = NextResponse.next()
    res.headers.set('Cache-Control', 'no-store')
    return res
  }
})

export const config = {
  matcher: ['/dashboard/:path*', '/login', '/auth-error'],
}
