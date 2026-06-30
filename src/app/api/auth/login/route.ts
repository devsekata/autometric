import { NextRequest, NextResponse } from 'next/server'
import { encode } from '@auth/core/jwt'
import { validateCredentials } from '@/lib/auth/validateCredentials'

// Custom login endpoint — accepts JSON for Postman / API clients
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const email    = typeof body?.email    === 'string' ? body.email.trim()    : ''
    const password = typeof body?.password === 'string' ? body.password.trim() : ''

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required.' }, { status: 400 })
    }

    const user = await validateCredentials(email, password)
    if (!user) {
      return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 })
    }

    const token = await encode({
      token:   { id: user.id, email: user.email, name: user.name },
      secret:  process.env.AUTH_SECRET!,
      maxAge:  30 * 24 * 60 * 60,
      salt:    'authjs.session-token',
    })

    const res = NextResponse.json({ success: true, id: user.id, email: user.email, name: user.name })
    res.cookies.set('authjs.session-token', token, {
      httpOnly: true,
      sameSite: 'lax',
      path:     '/',
      maxAge:   30 * 24 * 60 * 60,
    })

    return res
  } catch (err) {
    console.error('[POST /api/auth/login]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
